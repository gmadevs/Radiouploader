import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dicomParser from 'dicom-parser'
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
})
