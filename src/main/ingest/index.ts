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
 * Read a folder or a zip and return the study/series/stack tree.
 *
 * Zip sources are extracted into a temp directory that the caller must clean up
 * via the returned `tempDir` — the anonymised output is written elsewhere, so
 * the originals never leave this directory.
 */
export async function ingest(
  sourcePath: string,
  sourceKind: SourceKind,
  onProgress?: (p: Progress) => void
): Promise<IngestResult> {
  let tempDir: string | null = null
  let scanRoot = sourcePath

  try {
    if (sourceKind === 'zip') {
      onProgress?.({ phase: 'scanning', done: 0, total: 0, detail: path.basename(sourcePath) })
      tempDir = await createTempDir()
      await extractZip(sourcePath, tempDir)
      scanRoot = tempDir
    }

    onProgress?.({ phase: 'scanning', done: 0, total: 0 })
    const { candidates, scannedFileCount } = await scanFolder(scanRoot)
    const { instances, failures } = await parseAll(candidates, onProgress)

    return {
      sourceKind,
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
