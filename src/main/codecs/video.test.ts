import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dicomParser from 'dicom-parser'
import * as dcmio from 'dicomanon'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseHeader } from '@shared/dicomImage'
import { anonymiseFile } from '../anon/anonymise'
import { decodeEncapsulatedFrame } from './decode'
import { decodeVideoFile, ffmpegVersion, isVideoSyntax, readVideoFrame, videoBitstream } from './video'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.join(here, '__fixtures__')
const anonFixtures = path.join(here, '../anon/__fixtures__')

// What scripts/videoFixtures.mjs draws: twelve 64x48 frames, the left half red
// and the right half blue, with a grey strip along the top that steps up by 15
// a frame from 20.
const WIDTH = 64
const HEIGHT = 48
const FRAMES = 12

let dir: string
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-test-'))
})
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

type Dict = Record<string, { vr: string; Value: unknown[] }>

/**
 * A DICOM file carrying a fixture's stream, as an ultrasound machine writes
 * one: the stream in the pixel data, cut into `fragments` pieces, and the
 * header describing it as the standard says to — YBR_PARTIAL_420, 8 bits.
 */
async function videoDicom(name: string, syntax: string, fragments = 1, header: Partial<{ rows: number; columns: number }> = {}): Promise<string> {
  const stream = new Uint8Array(await fs.readFile(path.join(fixtures, name)))
  const buf = await fs.readFile(path.join(anonFixtures, 'TestPattern_JPEG-Baseline_YBRFull.dcm'))
  const message = dcmio.Message.readFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
  const dict = message.dict as unknown as Dict
  // dcmio writes pixel data encapsulated only for the syntaxes on its own list,
  // which stops at .103; anything past it is written as H.264 and the UID
  // swapped afterwards, byte for byte, which the equal lengths allow.
  const standIn = '1.2.840.10008.1.2.4.102'
  if (syntax.length !== standIn.length) throw new Error(`No stand-in the length of ${syntax}`)
  ;(message.meta as unknown as Dict)['00020010'] = { vr: 'UI', Value: [standIn] }
  dict['00280010'] = { vr: 'US', Value: [header.rows ?? HEIGHT] }
  dict['00280011'] = { vr: 'US', Value: [header.columns ?? WIDTH] }
  dict['00280002'] = { vr: 'US', Value: [3] }
  dict['00280004'] = { vr: 'CS', Value: ['YBR_PARTIAL_420'] }
  dict['00280006'] = { vr: 'US', Value: [0] }
  dict['00280100'] = { vr: 'US', Value: [8] }
  dict['00280101'] = { vr: 'US', Value: [8] }
  dict['00280102'] = { vr: 'US', Value: [7] }
  dict['00280008'] = { vr: 'IS', Value: [String(FRAMES)] }

  // Cut anywhere, including mid-packet: a fragment boundary means nothing in a
  // video, and the stream has to come back whole however it was cut. Even
  // lengths, as the standard wants of a fragment.
  const size = Math.ceil(stream.length / fragments / 2) * 2
  const pieces = Array.from({ length: fragments }, (_, i) => stream.slice(i * size, (i + 1) * size))
    .filter((piece) => piece.length > 0)
    .map((piece) => {
      const even = new Uint8Array(piece.length + (piece.length % 2))
      even.set(piece)
      return even.buffer
    })
  dict['7FE00010'] = { vr: 'OB', Value: pieces }

  const out = path.join(dir, `${name}-${fragments}.dcm`)
  const written = Buffer.from(message.write())
  const at = written.indexOf(standIn, 0, 'latin1')
  written.write(syntax, at, 'latin1')
  await fs.writeFile(out, written)
  return out
}

/** One pixel of a decoded RGB frame. */
function pixel(bytes: Uint8Array, x: number, y: number): [number, number, number] {
  const o = (y * WIDTH + x) * 3
  return [bytes[o], bytes[o + 1], bytes[o + 2]]
}

/** Within what a lossy codec is allowed to move a flat colour. */
const near = (actual: number, expected: number, tolerance = 12): boolean => Math.abs(actual - expected) <= tolerance

const CASES = [
  { name: 'video-h264.mpegts', syntax: '1.2.840.10008.1.2.4.102', what: 'H.264 in MPEG-TS' },
  { name: 'video-h264.mp4', syntax: '1.2.840.10008.1.2.4.102', what: 'H.264 in MP4, whose index may sit at the end' },
  { name: 'video-hevc.mpegts', syntax: '1.2.840.10008.1.2.4.107', what: 'HEVC in MPEG-TS' },
  { name: 'video-mpeg2.mpg', syntax: '1.2.840.10008.1.2.4.100', what: 'MPEG-2 in a program stream' }
]

describe('ffmpegVersion', () => {
  it('names the decoder by running it, without the builder’s suffix', async () => {
    expect(await ffmpegVersion()).toMatch(/^ffmpeg \d+\.\d+(\.\d+)?$/)
  })
})

describe('decodeVideoFile', () => {
  for (const { name, syntax, what } of CASES) {
    it(`decodes ${what} into every frame, in order, in the right colours`, async () => {
      expect(isVideoSyntax(syntax)).toBe(true)
      const video = await decodeVideoFile(await videoDicom(name, syntax), path.join(dir, `${name}.rgb`), {
        rows: HEIGHT,
        columns: WIDTH
      })
      expect(video.frames).toBe(FRAMES)

      for (let frame = 0; frame < FRAMES; frame++) {
        const { bytes, photometric, samplesPerPixel } = await readVideoFrame(video, frame)
        expect(photometric).toBe('RGB')
        expect(samplesPerPixel).toBe(3)
        // Red on the left and blue on the right: a colour conversion with the
        // channels crossed gets exactly this wrong, and still looks like a picture.
        const [lr, , lb] = pixel(bytes, 10, 30)
        const [rr, , rb] = pixel(bytes, 54, 30)
        expect(lr > 180 && lb < 60).toBe(true)
        expect(rb > 180 && rr < 60).toBe(true)
        // The strip names the frame: out of order, dropped or repeated, and
        // this is the number that is wrong.
        expect(near(pixel(bytes, 32, 3)[1], 20 + frame * 15)).toBe(true)
      }
    })
  }

  it('joins a stream cut into several fragments back into one', async () => {
    const source = await videoDicom('video-h264.mpegts', '1.2.840.10008.1.2.4.102', 3)
    const bytes = new Uint8Array(await fs.readFile(source))
    const element = dicomParser.parseDicom(bytes).elements.x7fe00010
    expect(element.fragments?.length).toBe(3)

    const video = await decodeVideoFile(source, path.join(dir, 'fragments.rgb'), { rows: HEIGHT, columns: WIDTH })
    expect(video.frames).toBe(FRAMES)
    expect(videoBitstream(bytes).length).toBeGreaterThanOrEqual((await fs.stat(path.join(fixtures, 'video-h264.mpegts'))).size)
  })

  it('refuses a stream whose pictures are not the size the header says', async () => {
    const source = await videoDicom('video-h264.mpegts', '1.2.840.10008.1.2.4.102', 1, { rows: 40, columns: 64 })
    await expect(decodeVideoFile(source, path.join(dir, 'wrong-size.rgb'), { rows: 40, columns: 64 })).rejects.toThrow(
      /64x48 where the header says 64x40/
    )
  })

  it('says so when the pixel data is not a stream at all', async () => {
    const source = await videoDicom('video-h264.mpegts', '1.2.840.10008.1.2.4.102')
    const bytes = new Uint8Array(await fs.readFile(source))
    const garbage = path.join(dir, 'garbage.dcm')
    // Same file, with the stream overwritten by bytes no decoder can read.
    const offset = dicomParser.parseDicom(bytes).elements.x7fe00010.fragments![0].position
    bytes.fill(0x5a, offset, offset + 4000)
    await fs.writeFile(garbage, bytes)
    await expect(decodeVideoFile(garbage, path.join(dir, 'garbage.rgb'), { rows: HEIGHT, columns: WIDTH })).rejects.toThrow()
  })

  it('refuses a frame the video does not hold', async () => {
    const video = await decodeVideoFile(
      await videoDicom('video-mpeg2.mpg', '1.2.840.10008.1.2.4.100'),
      path.join(dir, 'past.rgb'),
      { rows: HEIGHT, columns: WIDTH }
    )
    await expect(readVideoFrame(video, FRAMES)).rejects.toThrow(/holds 12 frames, and frame 13/)
  })
})

describe('anonymiseFile — video', () => {
  /** The frame an output file holds, decoded by the app's own path as a viewer would. */
  async function pictureOf(file: string): Promise<Uint8Array> {
    const bytes = new Uint8Array(await fs.readFile(file))
    const ds = dicomParser.parseDicom(bytes)
    const element = ds.elements.x7fe00010
    const encoded = dicomParser.readEncapsulatedPixelDataFromFragments(ds, element, 0, element.fragments!.length)
    const decoded = await decodeEncapsulatedFrame(encoded, parseHeader(bytes))
    expect(decoded.photometric).toBe('RGB')
    return decoded.bytes
  }

  it('splits a video into single JPEG frames, blanked where it was masked', async () => {
    const source = await videoDicom('video-h264.mpegts', '1.2.840.10008.1.2.4.102')
    const video = await decodeVideoFile(source, path.join(dir, 'anon.rgb'), { rows: HEIGHT, columns: WIDTH })
    // The top eighth, where a machine writes the patient's name.
    const masks = [{ x: 0, y: 0, width: 1, height: 0.125 }]
    const results = await anonymiseFile(
      source,
      dir,
      Array.from({ length: FRAMES }, (_, frame) => ({ frame, outputName: `video-${frame}.dcm`, instanceNumber: frame + 1, masks })),
      video
    )
    expect(results).toHaveLength(FRAMES)

    for (const [frame, result] of results.entries()) {
      const ds = dicomParser.parseDicom(new Uint8Array(await fs.readFile(result.outputPath)))
      // A picture Radiopaedia can show, rather than a video stream it cannot,
      // and a small one: a frame is kilobytes, where plain samples were 9 kB
      // here and two megabytes at an ultrasound's size.
      expect(ds.string('x00020010')).toBe('1.2.840.10008.1.2.4.50')
      expect(ds.string('x00280004')).toBe('YBR_FULL')
      expect(ds.string('x00282110')).toBe('01')
      expect(ds.string('x00280008')).toBe('1')
      expect(ds.uint16('x00280002')).toBe(3)
      expect(ds.string('x00200013')).toBe(String(frame + 1))
      expect(result.byteLength).toBeLessThan(WIDTH * HEIGHT * 3)

      // The mask went into the samples before the JPEG did: the strip is black
      // and stays black through the compression; the red below it is still red.
      const bytes = await pictureOf(result.outputPath)
      expect(Math.max(...pixel(bytes, 32, 3))).toBeLessThan(12)
      expect(pixel(bytes, 10, 30)[0]).toBeGreaterThan(180)
      expect(pixel(bytes, 54, 30)[2]).toBeGreaterThan(180)
    }
    // Twelve different pictures, so S3 keeps twelve.
    expect(new Set(results.map((r) => r.sha256)).size).toBe(FRAMES)
  })

  it('writes a file Radiopaedia’s re-run of the anonymiser leaves byte for byte alone', async () => {
    // Radiopaedia anonymises every upload again with the same library and
    // refuses a file it would change. Encapsulated pixel data is the part of a
    // file most likely to be written differently the second time.
    const source = await videoDicom('video-h264.mp4', '1.2.840.10008.1.2.4.102')
    const video = await decodeVideoFile(source, path.join(dir, 'rerun.rgb'), { rows: HEIGHT, columns: WIDTH })
    const [result] = await anonymiseFile(source, dir, [{ frame: 3, outputName: 'rerun.dcm', instanceNumber: 1 }], video)

    const written = await fs.readFile(result.outputPath)
    const message = dcmio.Message.readFile(written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength) as ArrayBuffer)
    message.dict = dcmio.Anonymize(message.dict as never) as never
    expect(Buffer.from(message.write()).equals(written)).toBe(true)
  })

  it('reads an HEVC file too, whose syntax the anonymiser does not list as encapsulated', async () => {
    const source = await videoDicom('video-hevc.mpegts', '1.2.840.10008.1.2.4.107')
    const video = await decodeVideoFile(source, path.join(dir, 'hevc-anon.rgb'), { rows: HEIGHT, columns: WIDTH })
    const results = await anonymiseFile(
      source,
      dir,
      [0, 11].map((frame) => ({ frame, outputName: `hevc-${frame}.dcm`, instanceNumber: frame + 1 })),
      video
    )
    for (const result of results) {
      const ds = dicomParser.parseDicom(new Uint8Array(await fs.readFile(result.outputPath)))
      expect(ds.string('x00020010')).toBe('1.2.840.10008.1.2.4.50')
      expect(pixel(await pictureOf(result.outputPath), 10, 30)[0]).toBeGreaterThan(180)
    }
  })

  it('will not write a video it was not given the decode of', async () => {
    const source = await videoDicom('video-h264.mpegts', '1.2.840.10008.1.2.4.102')
    await expect(anonymiseFile(source, dir, [{ frame: 0, outputName: 'no-decode.dcm', instanceNumber: 1 }])).rejects.toThrow(
      /is a video, and was not decoded/
    )
  })
})
