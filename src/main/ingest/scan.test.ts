import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32 } from 'node:zlib'
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
  // The archive is assembled here, byte by byte, rather than by shelling out to
  // `zip`: Windows runners have no such binary, and the entry name is the whole
  // point of the traversal test below, so it has to be writable directly.
  function storedZip(entries: [string, Buffer][]): Buffer {
    const locals: Buffer[] = []
    const central: Buffer[] = []
    let offset = 0

    for (const [name, data] of entries) {
      const nameBytes = Buffer.from(name, 'utf8')
      const crc = crc32(data)

      const local = Buffer.alloc(30)
      local.writeUInt32LE(0x04034b50, 0)
      local.writeUInt16LE(20, 4) // version needed
      local.writeUInt16LE(0, 8) // stored, not deflated
      local.writeUInt32LE(crc, 14)
      local.writeUInt32LE(data.length, 18)
      local.writeUInt32LE(data.length, 22)
      local.writeUInt16LE(nameBytes.length, 26)
      locals.push(local, nameBytes, data)

      const entry = Buffer.alloc(46)
      entry.writeUInt32LE(0x02014b50, 0)
      entry.writeUInt16LE(20, 4) // version made by
      entry.writeUInt16LE(20, 6) // version needed
      entry.writeUInt16LE(0, 10) // stored
      entry.writeUInt32LE(crc, 16)
      entry.writeUInt32LE(data.length, 20)
      entry.writeUInt32LE(data.length, 24)
      entry.writeUInt16LE(nameBytes.length, 28)
      entry.writeUInt32LE(offset, 42)
      central.push(entry, nameBytes)

      offset += 30 + nameBytes.length + data.length
    }

    const directory = Buffer.concat(central)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(entries.length, 8)
    end.writeUInt16LE(entries.length, 10)
    end.writeUInt32LE(directory.length, 12)
    end.writeUInt32LE(offset, 16)

    return Buffer.concat([...locals, directory, end])
  }

  async function makeZip(entries: [string, Buffer][]): Promise<string> {
    const zipPath = path.join(await tempDir(), 'archive.zip')
    await fs.writeFile(zipPath, storedZip(entries))
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
    // An entry name that walks out of the destination. No archiver would write
    // one, which is why it is written here instead.
    const zipPath = await makeZip([['../evil', Buffer.alloc(512)]])

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
