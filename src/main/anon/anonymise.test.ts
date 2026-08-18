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

async function tagsOf(file: string): Promise<dicomParser.DataSet> {
  const buf = await fs.readFile(file)
  return dicomParser.parseDicom(new Uint8Array(buf))
}

describe('anonymiseFile', () => {
  it('produces a parseable DICOM object with the identifying tags blanked', async () => {
    const result = await anonymiseFile(path.join(fixtures, '01_ras_physician.dcm'), outDir, 'out.dcm')
    const ds = await tagsOf(result.outputPath)

    // PatientName, PatientID and ReferringPhysicianName must carry no value.
    for (const tag of ['x00100010', 'x00100020', 'x00080090']) {
      expect(ds.string(tag) ?? '').toBe('')
    }
    // Pixel data survives — anonymisation must not destroy the image.
    expect(ds.elements['x7fe00010']).toBeDefined()
  })

  it('reports the sha256 of the bytes it wrote, for the S3 presign step', async () => {
    const result = await anonymiseFile(path.join(fixtures, '02_ras_uids.dcm'), outDir, 'hashed.dcm')
    const written = await fs.readFile(result.outputPath)
    expect(result.sha256).toBe(createHash('sha256').update(written).digest('hex'))
    expect(result.byteLength).toBe(written.byteLength)
  })

  it('is deterministic, so repeated runs keep UIDs and hashes stable', async () => {
    const a = await anonymiseFile(path.join(fixtures, '02_ras_uids.dcm'), outDir, 'a.dcm')
    const b = await anonymiseFile(path.join(fixtures, '02_ras_uids.dcm'), outDir, 'b.dcm')
    expect(a.sha256).toBe(b.sha256)
  })

  it('rewrites UIDs into the Radiopaedia anonymised root', async () => {
    const result = await anonymiseFile(path.join(fixtures, '01_ras_physician.dcm'), outDir, 'uids.dcm')
    const ds = await tagsOf(result.outputPath)
    for (const tag of ['x0020000d', 'x0020000e']) {
      expect(ds.string(tag)).toMatch(/^1\.2\.826\.0\.1\.3680043\.10\.341\./)
    }
  })
})
