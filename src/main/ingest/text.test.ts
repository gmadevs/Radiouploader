import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as dcmio from 'dicomanon'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readInstance } from './dicom'

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'anon', '__fixtures__', '01_ras_physician.dcm')
let dir: string

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-text-'))
})
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/** The fixture with a series description stored as these bytes, in this character set. */
async function described(name: string, charset: string, bytes: number[]): Promise<string> {
  type Dict = Record<string, { vr: string; Value: unknown[] }>
  const source = new Uint8Array(await fs.readFile(fixture))
  const message = dcmio.Message.readFile(source.buffer.slice(0) as ArrayBuffer)
  const dict = message.dict as unknown as Dict
  const placeholder = 'Q'.repeat(bytes.length + (bytes.length % 2))
  dict['0008103E'] = { vr: 'LO', Value: [placeholder] }
  dict['00080005'] = { vr: 'CS', Value: [charset] }
  const out = new Uint8Array(message.write())
  out.set(bytes.length % 2 ? [...bytes, 0x20] : bytes, Buffer.from(out).indexOf(placeholder))
  const file = path.join(dir, name)
  await fs.writeFile(file, out)
  return file
}

describe('reading a description', () => {
  it.each([
    ['ISO_IR 100', [...Buffer.from('Encéfalo', 'latin1')]],
    ['ISO_IR 192', [...Buffer.from('Encéfalo', 'utf8')]]
  ])('reads %s by its own table', async (charset, bytes) => {
    const instance = await readInstance(await described(`${charset}.dcm`, charset, bytes))
    expect(instance?.seriesDescription).toBe('Encéfalo')
  })
})
