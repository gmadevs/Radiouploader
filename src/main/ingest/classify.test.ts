import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { classifySource, ingest } from './index'
import { cleanupTempDir, createTempDir } from './scan'

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '../anon/__fixtures__')
const temps: string[] = []

afterEach(async () => {
  await Promise.all(temps.splice(0).map((d) => cleanupTempDir(d)))
})

async function tempDir(): Promise<string> {
  const dir = await createTempDir()
  temps.push(dir)
  return dir
}

describe('classifySource', () => {
  it('recognises a directory', async () => {
    const dir = await tempDir()
    expect(await classifySource([dir])).toEqual({ kind: 'folder', sourcePath: dir })
  })

  it('recognises a zip by extension, case-insensitively', async () => {
    const dir = await tempDir()
    const zip = path.join(dir, 'Study.ZIP')
    await fs.writeFile(zip, 'x')
    expect(await classifySource([zip])).toEqual({ kind: 'zip', sourcePath: zip })
  })

  it('treats a single non-zip file as an explicit file list', async () => {
    const dir = await tempDir()
    const file = path.join(dir, 'IM001')
    await fs.writeFile(file, 'x')
    expect(await classifySource([file])).toEqual({ kind: 'files', sourcePath: file })
  })

  it('treats several dropped files as a list', async () => {
    const dir = await tempDir()
    const files = [path.join(dir, 'a.dcm'), path.join(dir, 'b.dcm')]
    await Promise.all(files.map((f) => fs.writeFile(f, 'x')))
    const result = await classifySource(files)
    expect(result.kind).toBe('files')
    expect(result.sourcePath).toBe(dir)
  })

  it('rejects an empty drop rather than importing nothing quietly', async () => {
    await expect(classifySource([])).rejects.toThrow(/Nothing to import/)
  })
})

describe('ingest', () => {
  it('reads a folder of DICOM files', async () => {
    const dir = await tempDir()
    await fs.copyFile(path.join(fixtures, '01_ras_physician.dcm'), path.join(dir, 'a.dcm'))
    const result = await ingest([dir])
    expect(result.sourceKind).toBe('folder')
    expect(result.studies).toHaveLength(1)
  })

  it('reads DICOM files dropped individually, without scanning their folder', async () => {
    const dir = await tempDir()
    const wanted = path.join(dir, 'a.dcm')
    await fs.copyFile(path.join(fixtures, '01_ras_physician.dcm'), wanted)
    // A second file in the same folder must be ignored when it was not dropped.
    await fs.copyFile(path.join(fixtures, '02_ras_uids.dcm'), path.join(dir, 'b.dcm'))

    const result = await ingest([wanted])
    expect(result.sourceKind).toBe('files')
    expect(result.scannedFileCount).toBe(1)
    const slices = result.studies.flatMap((s) => s.series.flatMap((r) => r.stacks.flatMap((k) => k.slices)))
    expect(slices.map((s) => s.path)).toEqual([wanted])
  })

  it('reports a dropped file that is not DICOM instead of throwing', async () => {
    const dir = await tempDir()
    const junk = path.join(dir, 'notes.txt')
    await fs.writeFile(junk, 'not dicom at all')
    const result = await ingest([junk])
    expect(result.studies).toHaveLength(0)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].path).toBe(junk)
  })
})
