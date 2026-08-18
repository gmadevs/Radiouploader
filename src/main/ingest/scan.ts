import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'

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

/** Create the session temp directory that holds extracted and anonymised files. */
export async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'radiopaedia-uploader-'))
}

/**
 * Extract a zip into a fresh temp directory and scan it.
 * Entry paths are resolved against the destination and rejected if they escape
 * it, so a crafted archive cannot write outside the temp dir.
 */
export async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const zipFile = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, file) => {
      if (err || !file) reject(err ?? new Error('Could not open zip')); else resolve(file)
    })
  })

  await new Promise<void>((resolve, reject) => {
    zipFile.on('error', reject)
    zipFile.on('end', resolve)
    zipFile.on('entry', (entry: yauzl.Entry) => {
      const target = path.resolve(destDir, entry.fileName)
      const rel = path.relative(destDir, target)
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        reject(new Error(`Refusing to extract entry outside the destination: ${entry.fileName}`))
        return
      }
      if (entry.fileName.endsWith('/')) {
        fs.mkdir(target, { recursive: true }).then(() => zipFile.readEntry(), reject)
        return
      }
      zipFile.openReadStream(entry, (err, stream) => {
        if (err || !stream) {
          reject(err ?? new Error(`Could not read ${entry.fileName}`))
          return
        }
        fs.mkdir(path.dirname(target), { recursive: true })
          .then(() => pipeline(stream, createWriteStream(target)))
          .then(() => zipFile.readEntry())
          .catch(reject)
      })
    })
    zipFile.readEntry()
  })
}

/** Remove a session temp directory, ignoring failures. */
export async function cleanupTempDir(dir: string | null): Promise<void> {
  if (!dir) return
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
}
