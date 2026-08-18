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

  /**
   * Every stack the user has ticked, with the trim already applied — so
   * anonymisation and upload only ever see the images that were kept.
   */
  selectedStacks(): Stack[] {
    if (!this.ingest) return []
    return this.ingest.studies
      .flatMap((study) => study.series.flatMap((series) => series.stacks))
      .filter((stack) => stack.selected)
      .map((stack) => ({ ...stack, slices: stack.slices.slice(stack.trimStart, stack.trimEnd + 1) }))
      .filter((stack) => stack.slices.length > 0)
  }

  /** Apply the renderer's selection and trim back onto the tree held here. */
  applySelection(selection: { id: string; trimStart: number; trimEnd: number }[]): void {
    const byId = new Map(selection.map((s) => [s.id, s]))
    for (const study of this.ingest?.studies ?? []) {
      for (const series of study.series) {
        for (const stack of series.stacks) {
          const chosen = byId.get(stack.id)
          stack.selected = chosen !== undefined
          if (!chosen) continue
          // Clamp against the real length; the renderer's copy could be stale.
          const last = stack.slices.length - 1
          stack.trimStart = Math.min(Math.max(chosen.trimStart, 0), last)
          stack.trimEnd = Math.min(Math.max(chosen.trimEnd, stack.trimStart), last)
        }
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
