import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { AnonResult, IngestResult, Stack } from '@shared/types'
import { cleanupTempDir } from './ingest'

/**
 * Per-run state held in the main process.
 *
 * Originals and anonymised output both live under a working directory that is
 * removed when the run is reset or the app quits, so identifiable data never
 * outlives the session.
 */
class Session {
  ingest: IngestResult | null = null
  anon: AnonResult | null = null
  private workDirPath: string | null = null

  async workDir(): Promise<string> {
    if (!this.workDirPath) {
      this.workDirPath = await fs.mkdtemp(path.join(app.getPath('temp'), 'radiopaedia-work-'))
    }
    return this.workDirPath
  }

  /** Every stack the user has ticked, across all studies and series. */
  selectedStacks(): Stack[] {
    if (!this.ingest) return []
    return this.ingest.studies.flatMap((study) =>
      study.series.flatMap((series) => series.stacks.filter((stack) => stack.selected))
    )
  }

  /** Apply the renderer's selection back onto the tree held here. */
  applySelection(selectedIds: string[]): void {
    const wanted = new Set(selectedIds)
    for (const study of this.ingest?.studies ?? []) {
      for (const series of study.series) {
        for (const stack of series.stacks) stack.selected = wanted.has(stack.id)
      }
    }
  }

  async reset(): Promise<void> {
    await cleanupTempDir(this.ingest?.tempDir ?? null)
    await cleanupTempDir(this.workDirPath)
    this.ingest = null
    this.anon = null
    this.workDirPath = null
  }
}

export const session = new Session()
