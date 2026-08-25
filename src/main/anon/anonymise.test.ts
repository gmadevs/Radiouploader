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

  it('refuses a compressed run it has no decoder for, rather than guessing', async () => {
    const buf = await fs.readFile(path.join(fixtures, 'TestPattern_JPEG-Baseline_YBRFull.dcm'))
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    const message = dcmio.Message.readFile(bytes)
    const dict = message.dict as unknown as Record<string, { vr: string; Value: unknown[] }>
    dict['00280008'] = { vr: 'IS', Value: ['4'] }
    // RLE: encapsulated like the others, and nothing here reads it.
    ;(message.meta as Record<string, { vr: string; Value: unknown[] }>)['00020010'] = {
      vr: 'UI',
      Value: ['1.2.840.10008.1.2.5']
    }
    const outputPath = path.join(outDir, 'rle-cine.dcm')
    await fs.writeFile(outputPath, Buffer.from(message.write()))

    await expect(
      anonymiseFile(outputPath, outDir, [{ frame: 1, outputName: 'rle.dcm', instanceNumber: 1 }])
    ).rejects.toThrow(/RLE is not a format this app decodes/)
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
