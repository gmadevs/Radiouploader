import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dicomParser from 'dicom-parser'
import * as dcmio from 'dicomanon'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonymiseFile } from './anonymise'

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__')
let outDir: string

beforeAll(async () => {
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anon-test-'))
})
afterAll(async () => {
  await fs.rm(outDir, { recursive: true, force: true })
})

/** A single whole-instance task, which is what a non-multiframe file needs. */
const whole = (outputName: string) => [{ frame: 0, outputName, instanceNumber: 1 }]

async function tagsOf(file: string): Promise<dicomParser.DataSet> {
  return dicomParser.parseDicom(new Uint8Array(await fs.readFile(file)))
}

describe('anonymiseFile', () => {
  it('produces a parseable DICOM object with the identifying tags blanked', async () => {
    const [result] = await anonymiseFile(path.join(fixtures, '01_ras_physician.dcm'), outDir, whole('out.dcm'))
    const ds = await tagsOf(result.outputPath)

    // PatientName, PatientID and ReferringPhysicianName must carry no value.
    for (const tag of ['x00100010', 'x00100020', 'x00080090']) {
      expect(ds.string(tag) ?? '').toBe('')
    }
    // Pixel data survives — anonymisation must not destroy the image.
    expect(ds.elements['x7fe00010']).toBeDefined()
  })

  it('satisfies the rules Radiopaedia re-checks on upload', async () => {
    const [result] = await anonymiseFile(path.join(fixtures, '01_ras_physician.dcm'), outDir, whole('rules.dcm'))
    const ds = await tagsOf(result.outputPath)

    expect(ds.string('x00120062')).toBe('YES')
    // SOPInstanceUID is best removed entirely.
    expect(ds.elements['x00080018']).toBeUndefined()
    for (const tag of ['x0020000d', 'x0020000e']) {
      expect(ds.string(tag)).toMatch(/^1\.2\.826\.0\.1\.3680043\.10\.341\./)
    }
  })

  it('reports the sha256 of the bytes it wrote, for the S3 presign step', async () => {
    const [result] = await anonymiseFile(path.join(fixtures, '02_ras_uids.dcm'), outDir, whole('hashed.dcm'))
    const written = await fs.readFile(result.outputPath)
    expect(result.sha256).toBe(createHash('sha256').update(written).digest('hex'))
    expect(result.byteLength).toBe(written.byteLength)
  })

  it('is deterministic, so repeated runs keep UIDs and hashes stable', async () => {
    const source = path.join(fixtures, '02_ras_uids.dcm')
    const [a] = await anonymiseFile(source, outDir, whole('a.dcm'))
    const [b] = await anonymiseFile(source, outDir, whole('b.dcm'))
    expect(a.sha256).toBe(b.sha256)
  })
})

describe('anonymiseFile — multiframe', () => {
  const source = () => path.join(fixtures, 'multiframe_4.dcm')
  const tasks = (prefix: string) =>
    [0, 1, 2, 3].map((frame) => ({
      frame,
      outputName: `${prefix}-${frame}.dcm`,
      instanceNumber: frame + 1
    }))

  it('writes one single-frame instance per frame', async () => {
    const results = await anonymiseFile(source(), outDir, tasks('split'))
    expect(results).toHaveLength(4)

    for (const result of results) {
      const ds = await tagsOf(result.outputPath)
      // Radiopaedia does not expand multiframe objects, so each frame must
      // arrive as its own instance or the run shows as a single picture.
      expect(ds.string('x00280008')).toBe('1')
      expect(ds.elements['x7fe00010'].length).toBe(8 * 8 * 2)
    }
  })

  it('carries the right pixels into each frame', async () => {
    const results = await anonymiseFile(source(), outDir, tasks('pixels'))

    for (const result of results) {
      const ds = await tagsOf(result.outputPath)
      const px = ds.elements['x7fe00010']
      const value = ds.uint16('x7fe00010', 0)
      // The fixture fills frame n with the constant 1000 * (n + 1).
      expect(value).toBe(1000 * (result.frame + 1))
      expect(px.length).toBe(128)
    }
  })

  it('numbers the instances by position, so the stack keeps its order', async () => {
    const results = await anonymiseFile(source(), outDir, tasks('order'))
    const numbers = await Promise.all(
      results.map(async (r) => (await tagsOf(r.outputPath)).string('x00200013'))
    )
    expect(numbers).toEqual(['1', '2', '3', '4'])
  })

  it('gives every frame a distinct hash, so S3 stores them separately', async () => {
    const results = await anonymiseFile(source(), outDir, tasks('hash'))
    expect(new Set(results.map((r) => r.sha256)).size).toBe(4)
  })

  it('still anonymises each split frame', async () => {
    const [first] = await anonymiseFile(source(), outDir, tasks('anon'))
    const ds = await tagsOf(first.outputPath)
    expect(ds.string('x00120062')).toBe('YES')
    expect(ds.string('x00100010') ?? '').toBe('')
  })

  it('refuses a frame beyond the end rather than writing rubbish', async () => {
    await expect(
      anonymiseFile(source(), outDir, [{ frame: 9, outputName: 'bad.dcm', instanceNumber: 1 }])
    ).rejects.toThrow(/runs past the pixel data/)
  })

  it('reads the source once for any number of frames', async () => {
    // Four outputs from one call is the contract that keeps a 250 MB cine from
    // being re-read per frame.
    const results = await anonymiseFile(source(), outDir, tasks('once'))
    expect(results.map((r) => r.sourcePath)).toEqual(Array(4).fill(source()))
  })

  /**
   * A compressed cine — an XA run or an ultrasound loop — built here rather than
   * committed as a fixture: the JPEG fixture's own bitstream repeated as four
   * frames. Written through the anonymiser's own writer, so the fragments and
   * the basic offset table are the real thing rather than a hand-made table.
   */
  async function compressedCine(): Promise<string> {
    const buf = await fs.readFile(path.join(fixtures, 'TestPattern_JPEG-Baseline_YBRFull.dcm'))
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    const message = dcmio.Message.readFile(bytes)
    const dict = message.dict as unknown as Record<string, { vr: string; Value: unknown[] }>
    const frame = dict['7FE00010'].Value[0] as ArrayBuffer
    dict['00280008'] = { vr: 'IS', Value: ['4'] }
    dict['7FE00010'] = { vr: 'OB', Value: [frame, frame, frame, frame] }
    const outputPath = path.join(outDir, 'jpeg-cine.dcm')
    await fs.writeFile(outputPath, Buffer.from(message.write()))
    return outputPath
  }

  it('splits a compressed run by decoding it, and writes the frames out uncompressed', async () => {
    // A frame cannot be cut out of a bitstream by offset, so each one is
    // decoded and written back as plain samples. Sending the file whole is no
    // answer: Radiopaedia does not expand multiframe objects, so a run of four
    // would be published as one picture.
    const results = await anonymiseFile(
      await compressedCine(),
      outDir,
      [0, 1, 2, 3].map((frame) => ({ frame, outputName: `cine-${frame}.dcm`, instanceNumber: frame + 1 }))
    )
    expect(results).toHaveLength(4)

    for (const result of results) {
      const ds = await tagsOf(result.outputPath)
      expect(ds.string('x00020010')).toBe('1.2.840.10008.1.2.1')
      expect(ds.string('x00280008')).toBe('1')
      // 640 x 400, three samples of eight bits, as the JPEG decodes to.
      expect(ds.elements['x7fe00010'].length).toBe(640 * 400 * 3)
      expect(ds.uint16('x00280100')).toBe(8)
      expect(ds.uint16('x00280002')).toBe(3)
      // The file said YBR_FULL; libjpeg-turbo hands back RGB, and the tag has
      // to say what the pixels are rather than what the bitstream was.
      expect(ds.string('x00280004')).toBe('RGB')
    }
    // Same picture four times over, but each carries its own instance number,
    // so S3 stores four objects rather than deduplicating the run to one.
    expect(new Set(results.map((r) => r.sha256)).size).toBe(4)
  })

  /** PackBits with literal runs only, which is a legal encoding of anything. */
  function packBits(bytes: number[]): number[] {
    const out: number[] = []
    for (let i = 0; i < bytes.length; i += 128) {
      const chunk = bytes.slice(i, i + 128)
      out.push(chunk.length - 1, ...chunk)
    }
    return out
  }

  /** One RLE frame of 16-bit greyscale: the high byte plane, then the low one. */
  function rleFrame(values: number[]): ArrayBuffer {
    const segments = [
      packBits(values.map((v) => (v >> 8) & 0xff)),
      packBits(values.map((v) => v & 0xff))
    ]
    const table = new Uint8Array(64)
    const view = new DataView(table.buffer)
    view.setUint32(0, 2, true)
    view.setUint32(4, 64, true)
    view.setUint32(8, 64 + segments[0].length, true)

    const out = new Uint8Array(64 + segments[0].length + segments[1].length)
    out.set(table, 0)
    out.set(segments[0], 64)
    out.set(segments[1], 64 + segments[0].length)
    return out.buffer
  }

  /** Four 8x8 frames of RLE, each a different picture. */
  async function rleCine(): Promise<{ path: string; frames: number[][] }> {
    const buf = await fs.readFile(path.join(fixtures, 'TestPattern_JPEG-Baseline_YBRFull.dcm'))
    const message = dcmio.Message.readFile(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    )
    const dict = message.dict as unknown as Record<string, { vr: string; Value: unknown[] }>
    const meta = message.meta as unknown as Record<string, { vr: string; Value: unknown[] }>

    const frames = [0, 1, 2, 3].map((f) => Array.from({ length: 64 }, (_, i) => (f + 1) * 1000 + i))
    meta['00020010'] = { vr: 'UI', Value: ['1.2.840.10008.1.2.5'] }
    dict['00280010'] = { vr: 'US', Value: [8] }
    dict['00280011'] = { vr: 'US', Value: [8] }
    dict['00280002'] = { vr: 'US', Value: [1] }
    dict['00280100'] = { vr: 'US', Value: [16] }
    dict['00280101'] = { vr: 'US', Value: [16] }
    dict['00280102'] = { vr: 'US', Value: [15] }
    dict['00280103'] = { vr: 'US', Value: [0] }
    dict['00280004'] = { vr: 'CS', Value: ['MONOCHROME2'] }
    delete dict['00280006']
    dict['00280008'] = { vr: 'IS', Value: ['4'] }
    dict['7FE00010'] = { vr: 'OB', Value: frames.map(rleFrame) }

    const outputPath = path.join(outDir, 'rle-cine.dcm')
    await fs.writeFile(outputPath, Buffer.from(message.write()))
    return { path: outputPath, frames }
  }

  it('splits an RLE run, which used to be the one that could not be uploaded at all', async () => {
    // RLE is the last compressed syntax without a WASM codec, and it needs
    // none: PackBits over byte planes is a page of plain JavaScript. Until it
    // was written a run like this was refused by name in the picker.
    const cine = await rleCine()
    const results = await anonymiseFile(
      cine.path,
      outDir,
      [0, 1, 2, 3].map((frame) => ({ frame, outputName: `rle-${frame}.dcm`, instanceNumber: frame + 1 }))
    )
    expect(results).toHaveLength(4)

    for (const [frame, result] of results.entries()) {
      const ds = await tagsOf(result.outputPath)
      expect(ds.string('x00020010')).toBe('1.2.840.10008.1.2.1')
      expect(ds.string('x00280008')).toBe('1')
      expect(ds.uint16('x00280010')).toBe(8)
      expect(ds.uint16('x00280011')).toBe(8)
      expect(ds.elements['x7fe00010'].length).toBe(8 * 8 * 2)
      // The samples themselves, woven back from the two byte planes. Reading
      // them the other way round produces an image rather than an error.
      const values = Array.from({ length: 64 }, (_, i) => ds.uint16('x7fe00010', i) ?? 0)
      expect(values).toEqual(cine.frames[frame])
    }
  })

  it('refuses a compressed run it has no decoder for, rather than guessing', async () => {
    const buf = await fs.readFile(path.join(fixtures, 'TestPattern_JPEG-Baseline_YBRFull.dcm'))
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    const message = dcmio.Message.readFile(bytes)
    const dict = message.dict as unknown as Record<string, { vr: string; Value: unknown[] }>
    dict['00280008'] = { vr: 'IS', Value: ['4'] }
    // MPEG-4: encapsulated like the others, and nothing here reads it.
    ;(message.meta as Record<string, { vr: string; Value: unknown[] }>)['00020010'] = {
      vr: 'UI',
      Value: ['1.2.840.10008.1.2.4.102']
    }
    const outputPath = path.join(outDir, 'mpeg-cine.dcm')
    await fs.writeFile(outputPath, Buffer.from(message.write()))

    await expect(
      anonymiseFile(outputPath, outDir, [{ frame: 1, outputName: 'mpeg.dcm', instanceNumber: 1 }])
    ).rejects.toThrow(/is not a format this app decodes/)
  })
})

describe('anonymiseFile — redaction and window', () => {
  const source = () => path.join(fixtures, '01_ras_physician.dcm')
  /** The left half of the image, which is where these tests put the text. */
  const leftHalf = [{ x: 0, y: 0, width: 0.5, height: 1 }]

  /** Stored samples of an 8x8 fixture, little-endian as written. */
  async function pixelsOf(file: string): Promise<number[]> {
    const ds = await tagsOf(file)
    const element = ds.elements['x7fe00010']
    return Array.from({ length: element.length / 2 }, (_, i) => ds.uint16('x7fe00010', i) ?? 0)
  }

  it('blanks the masked columns with the dark end of the window in force', async () => {
    const [result] = await anonymiseFile(source(), outDir, [
      { frame: 0, outputName: 'masked.dcm', instanceNumber: 1, masks: leftHalf }
    ])
    const pixels = await pixelsOf(result.outputPath)
    const original = await pixelsOf(source())

    for (let row = 0; row < 8; row++) {
      for (let column = 0; column < 8; column++) {
        const i = row * 8 + column
        // The fixture is MONOCHROME1 with C 8192 / W 9638, so black is the top
        // of the window — filling with zero would have painted the text white.
        if (column < 4) expect(pixels[i]).toBe(8192 + 9638 / 2)
        else expect(pixels[i]).toBe(original[i])
      }
    }
  })

  it('fills with the dark end of a window chosen in the viewer', async () => {
    const [result] = await anonymiseFile(source(), outDir, [
      {
        frame: 0,
        outputName: 'masked-window.dcm',
        instanceNumber: 1,
        masks: leftHalf,
        window: { centre: 600, width: 1200 }
      }
    ])
    expect((await pixelsOf(result.outputPath))[0]).toBe(1200)
  })

  it('writes the chosen window, so Radiopaedia shows the contrast that was set', async () => {
    const [result] = await anonymiseFile(source(), outDir, [
      { frame: 0, outputName: 'window.dcm', instanceNumber: 1, window: { centre: 600, width: 1200 } }
    ])
    const ds = await tagsOf(result.outputPath)
    expect(ds.string('x00281050')).toBe('600')
    expect(ds.string('x00281051')).toBe('1200')
  })

  it('leaves the file its own window when none was chosen', async () => {
    // Both tasks come from one call, which is what happens when the same file
    // belongs to two stacks: the second must not inherit the first's window.
    const [, second] = await anonymiseFile(source(), outDir, [
      { frame: 0, outputName: 'w-a.dcm', instanceNumber: 1, window: { centre: 600, width: 1200 } },
      { frame: 0, outputName: 'w-b.dcm', instanceNumber: 1 }
    ])
    const ds = await tagsOf(second.outputPath)
    expect(ds.string('x00281050')).toBe('8192')
    expect(ds.string('x00281051')).toBe('9638')
  })

  it('does not leak a mask into another task from the same file', async () => {
    const [, second] = await anonymiseFile(source(), outDir, [
      { frame: 0, outputName: 'm-a.dcm', instanceNumber: 1, masks: leftHalf },
      { frame: 0, outputName: 'm-b.dcm', instanceNumber: 1 }
    ])
    expect(await pixelsOf(second.outputPath)).toEqual(await pixelsOf(source()))
  })

  it('masks every frame of a multiframe run that is split', async () => {
    const results = await anonymiseFile(path.join(fixtures, 'multiframe_4.dcm'), outDir, [
      { frame: 0, outputName: 'mf-0.dcm', instanceNumber: 1, masks: leftHalf },
      { frame: 1, outputName: 'mf-1.dcm', instanceNumber: 2, masks: leftHalf }
    ])
    for (const result of results) {
      const pixels = await pixelsOf(result.outputPath)
      expect(pixels[0]).toBe(8192 + 9638 / 2)
      // The frame's own constant survives outside the mask: 1000 * (frame + 1).
      expect(pixels[7]).toBe(1000 * (result.frame + 1))
    }
  })

  it('blanks a compressed image by decoding it and writing it back uncompressed', async () => {
    // A mask painted into a bitstream corrupts the image instead of redacting
    // it, so the file is decoded first and leaves as plain samples.
    const [result] = await anonymiseFile(path.join(fixtures, 'TestPattern_JPEG-Baseline_YBRFull.dcm'), outDir, [
      { frame: 0, outputName: 'jpeg-masked.dcm', instanceNumber: 1, masks: leftHalf }
    ])
    const ds = await tagsOf(result.outputPath)
    expect(ds.string('x00020010')).toBe('1.2.840.10008.1.2.1')
    expect(ds.elements['x7fe00010'].length).toBe(640 * 400 * 3)

    const pixels = new Uint8Array(await fs.readFile(result.outputPath))
    const at = (x: number, y: number): number[] => {
      const o = ds.elements['x7fe00010'].dataOffset + (y * 640 + x) * 3
      return [pixels[o], pixels[o + 1], pixels[o + 2]]
    }
    // The left half is black on every row; the right half kept its picture.
    expect(at(10, 200)).toEqual([0, 0, 0])
    expect(at(300, 200)).toEqual([0, 0, 0])
    expect(at(500, 200).some((v) => v > 0)).toBe(true)
  })

  it('leaves a compressed image alone when there is nothing to blank', async () => {
    // Decoding it would upload a file sixteen times the size for no reason.
    const [result] = await anonymiseFile(path.join(fixtures, 'TestPattern_JPEG-Baseline_YBRFull.dcm'), outDir, [
      { frame: 0, outputName: 'jpeg-untouched.dcm', instanceNumber: 1 }
    ])
    const ds = await tagsOf(result.outputPath)
    expect(ds.string('x00020010')).toBe('1.2.840.10008.1.2.4.50')
    expect(ds.string('x00280004')).toBe('YBR_FULL')
  })
})

describe('anonymiseFile — crop', () => {
  const source = () => path.join(fixtures, '01_ras_physician.dcm')
  /** The right half of the 8x8 fixture. */
  const rightHalf = { x: 0.5, y: 0, width: 0.5, height: 1 }

  async function pixelsOf(file: string): Promise<number[]> {
    const ds = await tagsOf(file)
    const element = ds.elements['x7fe00010']
    return Array.from({ length: element.length / 2 }, (_, i) => ds.uint16('x7fe00010', i) ?? 0)
  }

  type Dict = Record<string, { vr: string; Value: unknown[] }>

  /**
   * The fixture with a place in the patient, which it does not otherwise have.
   * Deliberately not square: PixelSpacing is written between rows first, and a
   * crop that pairs it the other way round moves the image by the difference.
   */
  async function placed(name: string, extra: Dict = {}): Promise<string> {
    const bytes = new Uint8Array(await fs.readFile(source()))
    const message = dcmio.Message.readFile(bytes.buffer.slice(0) as ArrayBuffer)
    const dict = message.dict as unknown as Dict
    dict['00200032'] = { vr: 'DS', Value: ['0', '0', '0'] }
    dict['00200037'] = { vr: 'DS', Value: ['1', '0', '0', '0', '1', '0'] }
    dict['00280030'] = { vr: 'DS', Value: ['2', '0.5'] }
    Object.assign(dict, extra)
    const outputPath = path.join(outDir, name)
    await fs.writeFile(outputPath, Buffer.from(message.write()))
    return outputPath
  }

  it('cuts the image down and rewrites the size to match', async () => {
    const [result] = await anonymiseFile(source(), outDir, [
      { frame: 0, outputName: 'cropped.dcm', instanceNumber: 1, crop: rightHalf }
    ])
    const ds = await tagsOf(result.outputPath)
    expect(ds.uint16('x00280011')).toBe(4)
    expect(ds.uint16('x00280010')).toBe(8)

    const original = await pixelsOf(source())
    const pixels = await pixelsOf(result.outputPath)
    expect(pixels).toHaveLength(32)
    for (let row = 0; row < 8; row++) {
      for (let column = 0; column < 4; column++) {
        expect(pixels[row * 4 + column]).toBe(original[row * 8 + column + 4])
      }
    }
  })

  it('moves ImagePositionPatient to the corner that is left', async () => {
    // Two columns in at 0.5 mm between columns, four rows down at 2 mm between
    // rows: the tag has to name the pixel that is now first, or a volume built
    // from these images sits where the discarded corner used to be.
    const [result] = await anonymiseFile(await placed('placed.dcm'), outDir, [
      { frame: 0, outputName: 'placed-cropped.dcm', instanceNumber: 1, crop: { x: 0.25, y: 0.5, width: 0.5, height: 0.5 } }
    ])
    const ds = await tagsOf(result.outputPath)
    expect(ds.string('x00200032')).toBe('1\\8\\0')
  })

  it('leaves the position alone when only the far edges came off', async () => {
    const [result] = await anonymiseFile(await placed('placed-2.dcm'), outDir, [
      { frame: 0, outputName: 'corner-kept.dcm', instanceNumber: 1, crop: { x: 0, y: 0, width: 0.5, height: 0.5 } }
    ])
    expect((await tagsOf(result.outputPath)).string('x00200032')).toBe('0\\0\\0')
  })

  it('drops a position it has no way to move', async () => {
    // Without an orientation there is no direction to walk the corner along.
    // A position describing a grid the pixels are no longer on is worse than
    // none: order survives it, since the upload sends them as they were shown.
    const file = await placed('unpointed.dcm', { '00200037': { vr: 'DS', Value: [] } })
    const [result] = await anonymiseFile(file, outDir, [
      { frame: 0, outputName: 'unpointed-cropped.dcm', instanceNumber: 1, crop: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 } }
    ])
    expect((await tagsOf(result.outputPath)).elements['x00200032']).toBeUndefined()
  })

  it('blanks before it cuts, so a mask outside the crop goes with everything else', async () => {
    const original = await pixelsOf(source())
    const [result] = await anonymiseFile(source(), outDir, [
      {
        frame: 0,
        outputName: 'masked-cropped.dcm',
        instanceNumber: 1,
        masks: [{ x: 0, y: 0, width: 0.5, height: 1 }],
        crop: rightHalf
      }
    ])
    const pixels = await pixelsOf(result.outputPath)
    for (let row = 0; row < 8; row++) {
      for (let column = 0; column < 4; column++) {
        expect(pixels[row * 4 + column]).toBe(original[row * 8 + column + 4])
      }
    }
  })

  it('does not carry one task’s crop into the next task from the same file', async () => {
    const [, second] = await anonymiseFile(source(), outDir, [
      { frame: 0, outputName: 'crop-a.dcm', instanceNumber: 1, crop: rightHalf },
      { frame: 0, outputName: 'crop-b.dcm', instanceNumber: 2 }
    ])
    const ds = await tagsOf(second.outputPath)
    expect(ds.uint16('x00280011')).toBe(8)
    expect((await pixelsOf(second.outputPath))).toHaveLength(64)
  })

  it('leaves a compressed file compressed when the crop keeps the whole image', async () => {
    // Otherwise a rectangle dragged out to the edges would decode and rewrite
    // every file in the stack to produce the bytes it already had.
    const [result] = await anonymiseFile(
      path.join(fixtures, 'TestPattern_JPEG-Baseline_YBRFull.dcm'),
      outDir,
      [{ frame: 0, outputName: 'jpeg-whole.dcm', instanceNumber: 1, crop: { x: 0, y: 0, width: 1, height: 1 } }]
    )
    expect((await tagsOf(result.outputPath)).string('x00020010')).toBe('1.2.840.10008.1.2.4.50')
  })

  it('crops a compressed image by decoding it, and says so in the transfer syntax', async () => {
    const source = path.join(fixtures, 'TestPattern_JPEG-Baseline_YBRFull.dcm')
    const before = await tagsOf(source)
    const [result] = await anonymiseFile(source, outDir, [
      { frame: 0, outputName: 'jpeg-cropped.dcm', instanceNumber: 1, crop: { x: 0, y: 0, width: 0.5, height: 0.5 } }
    ])
    const ds = await tagsOf(result.outputPath)
    expect(ds.string('x00020010')).toBe('1.2.840.10008.1.2.1')
    expect(ds.uint16('x00280011')).toBe(Math.round((before.uint16('x00280011') ?? 0) / 2))
    expect(ds.uint16('x00280010')).toBe(Math.round((before.uint16('x00280010') ?? 0) / 2))
  })
})

describe('anonymiseFile — enhanced multiframe', () => {
  type Dict = Record<string, { vr: string; Value: unknown[] }>
  const ds = (...values: number[]): { vr: string; Value: string[] } => ({ vr: 'DS', Value: values.map(String) })

  /**
   * An enhanced object built from the 8x8 fixture: geometry, pixel size and
   * rescale stated in the functional groups and nowhere else, which is what
   * makes lifting a frame out of one different from splitting a cine.
   */
  async function enhanced(name: string, zs: number[]): Promise<string> {
    const buf = await fs.readFile(path.join(fixtures, '01_ras_physician.dcm'))
    const message = dcmio.Message.readFile(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    )
    const dict = message.dict as unknown as Dict

    const one = dict['7FE00010'].Value[0] as ArrayBuffer
    const all = new Uint8Array(one.byteLength * zs.length)
    for (let i = 0; i < zs.length; i++) all.set(new Uint8Array(one), i * one.byteLength)
    dict['7FE00010'] = { vr: 'OW', Value: [all.buffer as ArrayBuffer] }
    dict['00280008'] = { vr: 'IS', Value: [String(zs.length)] }

    // The top level says none of it, which is the point.
    delete dict['00200032']
    delete dict['00200037']
    delete dict['00280030']
    delete dict['00281052']
    delete dict['00281053']

    dict['52009229'] = {
      vr: 'SQ',
      Value: [
        {
          '00209116': { vr: 'SQ', Value: [{ '00200037': ds(1, 0, 0, 0, 1, 0) }] },
          '00289110': { vr: 'SQ', Value: [{ '00280030': ds(0.5, 0.5), '00180050': ds(3) }] },
          '00289145': { vr: 'SQ', Value: [{ '00281052': ds(-1024), '00281053': ds(2) }] }
        }
      ]
    }
    dict['52009230'] = {
      vr: 'SQ',
      Value: zs.map((z) => ({ '00209113': { vr: 'SQ', Value: [{ '00200032': ds(0, 0, z) }] } }))
    }

    const outputPath = path.join(outDir, name)
    await fs.writeFile(outputPath, Buffer.from(message.write()))
    return outputPath
  }

  it('gives a frame lifted out the tags it needs to stand on its own', async () => {
    const file = await enhanced('enhanced.dcm', [0, 3, 6])
    const results = await anonymiseFile(
      file,
      outDir,
      [0, 1, 2].map((frame) => ({ frame, outputName: `enh-${frame}.dcm`, instanceNumber: frame + 1 }))
    )
    expect(results).toHaveLength(3)

    const ds2 = await tagsOf(results[2].outputPath)
    // The frame's own position, not the object's — it had none.
    expect(ds2.string('x00200032')).toBe('0\\0\\6')
    // Stated once for every frame, so it comes from the shared group.
    expect(ds2.string('x00200037')).toBe('1\\0\\0\\0\\1\\0')
    expect(ds2.string('x00280030')).toBe('0.5\\0.5')
    expect(ds2.string('x00180050')).toBe('3')
    // Without these the Hounsfield units quietly become stored values.
    expect(ds2.string('x00281052')).toBe('-1024')
    expect(ds2.string('x00281053')).toBe('2')

    expect(ds2.string('x00280008')).toBe('1')
    // The sequences themselves cannot come along: they describe three frames
    // and this file holds one. The anonymiser drops them.
    expect(ds2.elements['x52009229']).toBeUndefined()
    expect(ds2.elements['x52009230']).toBeUndefined()
  })

  it('does not carry one frame’s position into the next', async () => {
    const file = await enhanced('enhanced-2.dcm', [0, 3, 6])
    const results = await anonymiseFile(
      file,
      outDir,
      [0, 1, 2].map((frame) => ({ frame, outputName: `enh2-${frame}.dcm`, instanceNumber: frame + 1 }))
    )
    const positions = await Promise.all(results.map(async (r) => (await tagsOf(r.outputPath)).string('x00200032')))
    expect(positions).toEqual(['0\\0\\0', '0\\0\\3', '0\\0\\6'])
  })

  it('crops a promoted position rather than the one the file never had', async () => {
    // The corner has to be promoted before the crop reads it, or the crop finds
    // nothing to move and deletes a position it could have kept.
    const file = await enhanced('enhanced-crop.dcm', [0, 3])
    const [, second] = await anonymiseFile(file, outDir, [
      { frame: 0, outputName: 'enh-crop-0.dcm', instanceNumber: 1, crop: { x: 0.5, y: 0, width: 0.5, height: 1 } },
      { frame: 1, outputName: 'enh-crop-1.dcm', instanceNumber: 2, crop: { x: 0.5, y: 0, width: 0.5, height: 1 } }
    ])
    const tags = await tagsOf(second.outputPath)
    expect(tags.uint16('x00280011')).toBe(4)
    // Four columns in at half a millimetre each, along the row direction.
    expect(tags.string('x00200032')).toBe('2\\0\\3')
  })
})
