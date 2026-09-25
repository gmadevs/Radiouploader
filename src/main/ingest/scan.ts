import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import { createSessionDir } from '../tempDirs'

/** Files that are never image instances even though they sit next to them. */
const IGNORED_NAMES = new Set(['DICOMDIR', '.DS_Store', 'Thumbs.db'])

/**
 * A DICOM part-10 file carries the magic "DICM" at offset 128. Some exports
 * omit the preamble, so a failed magic check is not conclusive — those files
 * are still handed to the parser, which decides.
 */
async function hasDicmMagic(filePath: string): Promise<boolean> {
  let handle: fs.FileHandle | undefined
  try {
    handle = await fs.open(filePath, 'r')
    const buf = Buffer.alloc(4)
    const { bytesRead } = await handle.read(buf, 0, 4, 128)
    return bytesRead === 4 && buf.toString('latin1') === 'DICM'
  } catch {
    return false
  } finally {
    await handle?.close()
  }
}

export interface ScanResult {
  /** Candidate DICOM files, in stable sorted order. */
  candidates: string[]
  /** Everything walked, to report "scanned N files, found M DICOM". */
  scannedFileCount: number
}

/** Recursively collect candidate DICOM files under a directory. */
export async function scanFolder(root: string): Promise<ScanResult> {
  const candidates: string[] = []
  let scannedFileCount = 0

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      scannedFileCount++
      if (IGNORED_NAMES.has(entry.name)) continue
      const stat = await fs.stat(full).catch(() => null)
      // A part-10 header alone is 132 bytes; anything smaller cannot be an instance.
      if (!stat || stat.size < 256) continue
      if (await hasDicmMagic(full)) {
        candidates.push(full)
      } else if (!path.extname(entry.name) || path.extname(entry.name).toLowerCase() === '.dcm') {
        // No preamble but plausibly DICOM: let the parser arbitrate.
        candidates.push(full)
      }
    }
  }

  await walk(root)
  candidates.sort()
  return { candidates, scannedFileCount }
}

/** Create the session temp directory that holds the files extracted from a zip. */
export async function createTempDir(): Promise<string> {
  return createSessionDir('import')
}

/**
 * Room left over once an archive is out: the anonymised copies, and whatever
 * else on the machine wants the disk, have to fit in it too.
 */
export const HEADROOM_BYTES = 512 * 1024 * 1024

export async function diskFree(dir: string): Promise<number> {
  const { bavail, bsize } = await fs.statfs(dir)
  return bavail * bsize
}

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    // Closed by hand: the entries are listed first and read afterwards, and
    // autoClose would shut the file at the end of the listing.
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, file) => {
      if (err || !file) reject(err ?? new Error('Could not open zip'))
      else resolve(file)
    })
  })
}

/** The central directory, read to the end without opening anything. */
function listEntries(zipFile: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: yauzl.Entry[] = []
    zipFile.on('error', reject)
    zipFile.on('end', () => resolve(entries))
    zipFile.on('entry', (entry: yauzl.Entry) => {
      entries.push(entry)
      zipFile.readEntry()
    })
    zipFile.readEntry()
  })
}

function readStream(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (err, stream) => {
      if (err || !stream) reject(err ?? new Error(`Could not read ${entry.fileName}`))
      else resolve(stream)
    })
  })
}

export const gigabytes = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`

/**
 * Extract a zip into a fresh temp directory.
 *
 * Entry paths are resolved against the destination and rejected if they escape
 * it, so a crafted archive cannot write outside the temp dir.
 *
 * The whole directory is read before a byte is written, for the size: an
 * archive that unpacks to more than the disk holds — a study of several
 * thousand slices on a full laptop, or a zip bomb — is refused up front, with
 * the numbers, rather than found out when the disk fills halfway through. What
 * the entries claim is what is checked, and yauzl holds each one to its claim
 * as it is read.
 */
export async function extractZip(
  zipPath: string,
  destDir: string,
  freeSpace: (dir: string) => Promise<number> = diskFree
): Promise<void> {
  const zipFile = await openZip(zipPath)
  try {
    const entries = await listEntries(zipFile)

    const targets = entries.map((entry) => {
      const target = path.resolve(destDir, entry.fileName)
      const rel = path.relative(destDir, target)
      // `..` itself or a step up — not merely a name that starts with two dots.
      if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
        throw new Error(`The zip contains a file that would be extracted outside its folder, so it was not opened: ${entry.fileName}`)
      }
      return target
    })

    const needed = entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0)
    const free = await freeSpace(destDir)
    if (needed + HEADROOM_BYTES > free) {
      throw new Error(
        `${path.basename(zipPath)} unpacks to ${gigabytes(needed)} and the disk has ${gigabytes(free)} free. ` +
          'Unzip it somewhere with more room and choose the folder instead.'
      )
    }

    for (const [index, entry] of entries.entries()) {
      const target = targets[index]
      if (entry.fileName.endsWith('/')) {
        await fs.mkdir(target, { recursive: true })
        continue
      }
      await fs.mkdir(path.dirname(target), { recursive: true })
      await pipeline(await readStream(zipFile, entry), createWriteStream(target))
    }
  } finally {
    zipFile.close()
  }
}

/** Remove a session temp directory, ignoring failures. */
export async function cleanupTempDir(dir: string | null): Promise<void> {
  if (!dir) return
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
}
