import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { AnonResult, IngestResult, MaskRect, Stack, StackSelection, WindowLevel } from '@shared/types'
import { cleanupTempDir } from './ingest'

/**
 * Per-run state held in the main process.
 *
 * Originals and anonymised output both live under a working directory that is
 * removed when the run is reset or the app quits, so identifiable data never
 * outlives the session.
 */
/** Keep masks inside the image and drop any that cover nothing. */
function sanitiseMasks(masks: MaskRect[] | undefined): MaskRect[] {
  const unit = (v: number): number => (Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0)
  return (masks ?? [])
    .map((mask) => {
      const x = unit(mask.x)
      const y = unit(mask.y)
      return { x, y, width: Math.min(unit(mask.width), 1 - x), height: Math.min(unit(mask.height), 1 - y) }
    })
    .filter((mask) => mask.width > 0 && mask.height > 0)
}

function sanitiseWindow(window: WindowLevel | null | undefined): WindowLevel | null {
  if (!window) return null
  const { centre, width } = window
  if (!Number.isFinite(centre) || !Number.isFinite(width) || width <= 0) return null
  return { centre, width }
}

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

  /**
   * Apply the renderer's selection, trim, masks and window back onto the tree
   * held here. Everything is re-checked rather than trusted: these values reach
   * the anonymiser, and a mask that lands outside the image would silently
   * leave burnt-in text on the upload.
   */
  applySelection(selection: StackSelection[]): void {
    const byId = new Map(selection.map((s) => [s.id, s]))
    for (const study of this.ingest?.studies ?? []) {
      for (const series of study.series) {
        for (const stack of series.stacks) {
          const chosen = byId.get(stack.id)
          // A stack the app cannot upload stays untickable here too: the
          // renderer's copy is a suggestion, and this is the tree that is read.
          stack.selected = chosen !== undefined && stack.unsupported === null
          if (!chosen || !stack.selected) continue
          // Clamp against the real length; the renderer's copy could be stale.
          const last = stack.slices.length - 1
          stack.trimStart = Math.min(Math.max(chosen.trimStart, 0), last)
          stack.trimEnd = Math.min(Math.max(chosen.trimEnd, stack.trimStart), last)
          stack.masks = sanitiseMasks(chosen.masks)
          stack.window = sanitiseWindow(chosen.window)
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
