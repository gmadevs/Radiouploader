import fs from 'node:fs/promises'
import path from 'node:path'
import type { IngestResult, Progress, SourceKind } from '@shared/types'
import { readInstance, type InstanceMeta } from './dicom'
import { cleanupTempDir, createTempDir, extractZip, scanFolder } from './scan'
import { buildStudies } from './series'

export { cleanupTempDir }

/** Parse candidate files with bounded concurrency so a large study stays responsive. */
async function parseAll(
  files: string[],
  onProgress?: (p: Progress) => void
): Promise<{ instances: InstanceMeta[]; failures: { path: string; reason: string }[] }> {
  const instances: InstanceMeta[] = []
  const failures: { path: string; reason: string }[] = []
  const concurrency = 8
  let cursor = 0
  let done = 0

  async function worker(): Promise<void> {
    while (cursor < files.length) {
      const file = files[cursor++]
      try {
        instances.push(await readInstance(file))
      } catch (err) {
        failures.push({ path: file, reason: err instanceof Error ? err.message : String(err) })
      }
      done++
      if (done % 25 === 0 || done === files.length) {
        onProgress?.({ phase: 'parsing', done, total: files.length })
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker))
  return { instances, failures }
}

/**
 * Decide what a set of dropped or chosen paths actually is.
 *
 * Dropping is not typed, so the kind is read off the filesystem rather than
 * guessed from an extension: a single directory is a folder, a single .zip is an
 * archive, and anything else is treated as an explicit list of files.
 */
export async function classifySource(paths: string[]): Promise<{ kind: SourceKind; sourcePath: string }> {
  if (paths.length === 0) throw new Error('Nothing to import')

  if (paths.length === 1) {
    const only = paths[0]
    const stat = await fs.stat(only)
    if (stat.isDirectory()) return { kind: 'folder', sourcePath: only }
    if (path.extname(only).toLowerCase() === '.zip') return { kind: 'zip', sourcePath: only }
  }
  return { kind: 'files', sourcePath: paths.length === 1 ? paths[0] : path.dirname(paths[0]) }
}

/**
 * Read a folder, a zip or a list of files and return the study/series/stack tree.
 *
 * Zip sources are extracted into a temp directory that the caller must clean up
 * via the returned `tempDir` — the anonymised output is written elsewhere, so
 * the originals never leave this directory.
 */
export async function ingest(
  paths: string[],
  onProgress?: (p: Progress) => void
): Promise<IngestResult> {
  const { kind, sourcePath } = await classifySource(paths)
  let tempDir: string | null = null

  try {
    let candidates: string[]
    let scannedFileCount: number

    if (kind === 'files') {
      // An explicit list is taken as given; the parser rejects what is not DICOM.
      candidates = [...paths].sort()
      scannedFileCount = paths.length
    } else {
      let scanRoot = sourcePath
      if (kind === 'zip') {
        onProgress?.({ phase: 'scanning', done: 0, total: 0, detail: path.basename(sourcePath) })
        tempDir = await createTempDir()
        await extractZip(sourcePath, tempDir)
        scanRoot = tempDir
      }
      onProgress?.({ phase: 'scanning', done: 0, total: 0 })
      const scan = await scanFolder(scanRoot)
      candidates = scan.candidates
      scannedFileCount = scan.scannedFileCount
    }

    const { instances, failures } = await parseAll(candidates, onProgress)

    return {
      sourceKind: kind,
      sourcePath,
      tempDir,
      studies: buildStudies(instances),
      failures,
      scannedFileCount
    }
  } catch (err) {
    await cleanupTempDir(tempDir)
    throw err
  }
}
