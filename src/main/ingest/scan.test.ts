import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { readInstance } from './dicom'
import { cleanupTempDir, createTempDir, extractZip, scanFolder } from './scan'

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

describe('scanFolder', () => {
  it('finds DICOM files in nested directories and ignores the rest', async () => {
    const dir = await tempDir()
    await fs.mkdir(path.join(dir, 'STUDY', 'SERIES'), { recursive: true })
    await fs.copyFile(path.join(fixtures, '01_ras_physician.dcm'), path.join(dir, 'STUDY', 'SERIES', 'IM001'))
    await fs.copyFile(path.join(fixtures, '02_ras_uids.dcm'), path.join(dir, 'STUDY', 'a.dcm'))
    await fs.writeFile(path.join(dir, 'STUDY', 'notes.txt'), 'x'.repeat(4096))
    await fs.writeFile(path.join(dir, 'STUDY', 'DICOMDIR'), Buffer.alloc(4096))

    const { candidates, scannedFileCount } = await scanFolder(dir)
    expect(scannedFileCount).toBe(4)
    expect(candidates.map((c) => path.basename(c)).sort()).toEqual(['IM001', 'a.dcm'])
  })

  it('skips files too small to hold a DICOM header', async () => {
    const dir = await tempDir()
    await fs.writeFile(path.join(dir, 'tiny.dcm'), 'not dicom')
    const { candidates } = await scanFolder(dir)
    expect(candidates).toEqual([])
  })
})

describe('extractZip', () => {
  async function makeZip(entries: [string, Buffer][]): Promise<string> {
    // Build the archive with the system zip so the test exercises a real file.
    const staging = await tempDir()
    for (const [name, data] of entries) {
      const target = path.join(staging, name)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, data)
    }
    const zipPath = path.join(await tempDir(), 'archive.zip')
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    await promisify(execFile)('zip', ['-r', '-q', zipPath, '.'], { cwd: staging })
    return zipPath
  }

  it('extracts nested entries so they can be scanned', async () => {
    const dicom = await fs.readFile(path.join(fixtures, '01_ras_physician.dcm'))
    const zipPath = await makeZip([
      ['study/series1/IM001.dcm', dicom],
      ['study/series2/IM002.dcm', dicom]
    ])

    const dest = await tempDir()
    await extractZip(zipPath, dest)
    const { candidates } = await scanFolder(dest)
    expect(candidates).toHaveLength(2)
  })

  it('refuses entries that would escape the destination directory', async () => {
    const dest = await tempDir()
    // Craft a zip whose entry name walks out of the destination.
    const staging = await tempDir()
    await fs.writeFile(path.join(staging, 'payload'), Buffer.alloc(512))
    const zipPath = path.join(await tempDir(), 'evil.zip')
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    await promisify(execFile)('zip', ['-q', zipPath, 'payload'], { cwd: staging })
    // Rewrite the stored name to a traversal path of the same length.
    const raw = await fs.readFile(zipPath)
    const patched = Buffer.from(raw.toString('latin1').replaceAll('payload', '../evil'), 'latin1')
    await fs.writeFile(zipPath, patched)

    // yauzl rejects traversal names itself; the guard in extractZip is the
    // second layer. Either one refusing is the behaviour we need.
    await expect(extractZip(zipPath, dest)).rejects.toThrow(/outside the destination|invalid relative path/)
    await expect(fs.stat(path.join(path.dirname(dest), 'evil'))).rejects.toThrow()
  })
})

describe('readInstance', () => {
  it('extracts the identifiers and geometry used for grouping', async () => {
    const meta = await readInstance(path.join(fixtures, '01_ras_physician.dcm'))
    expect(meta.studyInstanceUid).toBeTruthy()
    expect(meta.seriesInstanceUid).toBeTruthy()
    expect(meta.modality).toBeTruthy()
    expect(meta.imageType.length).toBeGreaterThan(0)
    expect(meta.numberOfFrames).toBe(1)
  })

  it('rejects a file that is not a DICOM object', async () => {
    const dir = await tempDir()
    const bogus = path.join(dir, 'bogus.dcm')
    await fs.writeFile(bogus, Buffer.alloc(1024, 7))
    await expect(readInstance(bogus)).rejects.toThrow()
  })
})

describe('cleanupTempDir', () => {
  it('removes the directory and tolerates being called twice', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cleanup-'))
    await fs.writeFile(path.join(dir, 'f'), 'x')
    await cleanupTempDir(dir)
    await expect(fs.stat(dir)).rejects.toThrow()
    await expect(cleanupTempDir(dir)).resolves.toBeUndefined()
  })
})
