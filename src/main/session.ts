import type { AnonResult, CropRect, IngestResult, MaskRect, Series, Stack, StackSelection, WindowLevel } from '@shared/types'
import { keptSlices, sanitiseDropped } from '@shared/selection'
import { cleanupTempDir } from './ingest'
import { bySlice, carriedEdits } from './ingest/arrange'
import { createSessionDir } from './tempDirs'

/**
 * Per-run state held in the main process.
 *
 * Originals and anonymised output both live under a working directory that is
 * removed when the run is reset or the app quits, so identifiable data never
 * outlives the session — or, when the app did not get to quit, outlives it
 * only until the next launch (see tempDirs.ts).
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

/**
 * Keep a crop inside the image, and treat one that keeps everything as no crop
 * at all — a whole-image crop would otherwise decode and rewrite every
 * compressed file in the stack to produce the bytes it already had.
 */
function sanitiseCrop(crop: CropRect | null | undefined): CropRect | null {
  if (!crop) return null
  const unit = (v: number): number => (Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0)
  const x = unit(crop.x)
  const y = unit(crop.y)
  const width = Math.min(unit(crop.width), 1 - x)
  const height = Math.min(unit(crop.height), 1 - y)
  if (width <= 0 || height <= 0) return null
  return x === 0 && y === 0 && width === 1 && height === 1 ? null : { x, y, width, height }
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
  /** The phase stacks of each series laid out by slice, to go back to. */
  private phaseStacks = new Map<string, Stack[]>()

  async workDir(): Promise<string> {
    if (!this.workDirPath) {
      this.workDirPath = await createSessionDir('work')
    }
    return this.workDirPath
  }

  /**
   * Every stack the user has ticked, with the trim and the dropped images
   * already applied — so anonymisation and upload only ever see what was kept.
   */
  selectedStacks(): Stack[] {
    if (!this.ingest) return []
    return this.ingest.studies
      .flatMap((study) => study.series.flatMap((series) => series.stacks))
      .filter((stack) => stack.selected)
      .map((stack) => ({ ...stack, slices: keptSlices(stack) }))
      .filter((stack) => stack.slices.length > 0)
  }

  /**
   * Apply the renderer's selection, trim, masks, crop and window back onto the tree
   * held here. Everything is re-checked rather than trusted: these values reach
   * the anonymiser, and a mask that lands outside the image would silently
   * leave burnt-in text on the upload.
   */
  applySelection(selection: StackSelection[]): void {
    // Anonymised files are of the selection they were made from. Kept across a
    // change, the upload would send a mask drawn since without it, and match
    // images added since to nothing — so a new selection has to be anonymised
    // again before anything goes.
    this.anon = null
    const byId = new Map(selection.map((s) => [s.id, s]))
    for (const study of this.ingest?.studies ?? []) {
      for (const series of study.series) {
        for (const stack of series.stacks) {
          const chosen = byId.get(stack.id)
          // A stack the app cannot upload stays untickable here too: the
          // renderer's copy is a suggestion, and this is the tree that is read.
          stack.selected = chosen?.selected === true && stack.unsupported === null
          // The edits are kept whether or not the stack is going up: an
          // unticked one can still be reformatted, and the volume is built from
          // the pixels as the viewer left them.
          if (!chosen) continue
          // Clamp against the real length; the renderer's copy could be stale.
          const last = stack.slices.length - 1
          stack.trimStart = Math.min(Math.max(chosen.trimStart, 0), last)
          stack.trimEnd = Math.min(Math.max(chosen.trimEnd, stack.trimStart), last)
          stack.dropped = sanitiseDropped(chosen.dropped, stack.slices.length)
          stack.masks = sanitiseMasks(chosen.masks)
          stack.crop = sanitiseCrop(chosen.crop)
          stack.window = sanitiseWindow(chosen.window)
        }
      }
    }
  }

  /**
   * Lay a dynamic series out by phase or by slice, and hand back the series.
   *
   * Done here because this is the tree anonymisation and upload read; the
   * renderer's copy is replaced with what comes back. Blanked areas go with the
   * series whichever way it is turned (see carriedEdits). A trim or a dropped
   * image is a choice about one stack of one arrangement and does not.
   */
  arrange(seriesId: string, arrangement: 'phase' | 'slice'): Series {
    const series = this.ingest?.studies.flatMap((study) => study.series).find((s) => s.id === seriesId)
    if (!series || series.arrangement === undefined) throw new Error('That series cannot be rearranged')
    if (series.arrangement === arrangement) return series

    const edits = carriedEdits(series.stacks)
    let stacks: Stack[]
    if (arrangement === 'slice') {
      const turned = bySlice(series.id, series.stacks)
      if (turned === null) throw new Error('That series cannot be rearranged')
      this.phaseStacks.set(series.id, series.stacks)
      stacks = turned
    } else {
      stacks = (this.phaseStacks.get(series.id) ?? []).map((stack) => ({
        ...stack,
        selected: stack.unsupported === null,
        trimStart: 0,
        trimEnd: stack.slices.length - 1,
        dropped: []
      }))
      if (stacks.length === 0) throw new Error('That series cannot be rearranged')
    }
    series.stacks = stacks.map((stack) => ({
      ...stack,
      masks: sanitiseMasks([...stack.masks, ...edits.masks].filter(
        (mask, i, all) => all.findIndex((other) => JSON.stringify(other) === JSON.stringify(mask)) === i
      )),
      crop: edits.crop,
      window: edits.window
    }))
    series.arrangement = arrangement
    // Anonymised files are of the stacks they were made from, as for a selection.
    this.anon = null
    return series
  }

  async reset(): Promise<void> {
    this.phaseStacks.clear()
    await cleanupTempDir(this.ingest?.tempDir ?? null)
    await cleanupTempDir(this.workDirPath)
    this.ingest = null
    this.anon = null
    this.workDirPath = null
  }
}

export const session = new Session()
