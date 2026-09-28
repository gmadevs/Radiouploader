import type { Grid } from '@shared/annotate/paint'
import type { Point } from '@shared/annotate/raster'
import { maskAt, type Structure, type StructureMessage } from '@shared/annotate/structures'
import type { WindowLevel } from '@shared/types'

/**
 * The parts of the annotation dialog that are arithmetic rather than React,
 * kept here so they can be tested without a DOM.
 */

/** A drawing kept between two openings of the dialog on one stack. */
export interface SavedAnnotation {
  grid: Grid
  structures: StructureMessage[]
  /** The annotated series last added to the case, which the next one replaces. */
  seriesId: string | null
  window: WindowLevel | null
  onlyDrawn: boolean
  legend: boolean
}

export type StripMark = { position: number; kind: 'key' | 'empty' | 'filled' }

/**
 * What the strip above the image slider shows for one structure: which images
 * were drawn on, which were filled in between them, and which were cleared to
 * mark where the structure ends. Positions are in the images being kept, which
 * is what the slider runs over.
 */
export function stripMarks(structure: Structure, kept: number[]): StripMark[] {
  const marks: StripMark[] = []
  kept.forEach((index, position) => {
    const key = structure.keys.get(index)
    if (key) marks.push({ position, kind: key.some((v) => v) ? 'key' : 'empty' })
    else if (structure.interpolate && structure.filled.has(index)) marks.push({ position, kind: 'filled' })
  })
  return marks
}

/**
 * Whether a click closes the polygon: on its first vertex, within `reach` grid
 * pixels, once there are enough vertices to enclose something.
 */
export function closesPolygon(points: Point[], at: Point, reach: number): boolean {
  if (points.length < 3) return false
  const [x, y] = points[0]
  return Math.hypot(at[0] - x, at[1] - y) <= reach
}

/**
 * How close to the first vertex counts as on it: about ten screen pixels,
 * however large the image is drawn.
 */
export function vertexReach(grid: Grid, displayedWidth: number): number {
  return displayedWidth > 0 ? (10 * grid.width) / displayedWidth : 2
}

/**
 * The images to write: every one being kept, or only those from the first to
 * the last with any colour on it. Filled images count, so a structure that
 * fades out towards a cleared image is written to the end of its fade.
 */
export function indicesToWrite(structures: Structure[], kept: number[], onlyDrawn: boolean): number[] {
  if (!onlyDrawn) return kept
  const coloured = (index: number): boolean =>
    structures.some((structure) => structure.visible && (maskAt(structure, index)?.some((v) => v) ?? false))
  const first = kept.findIndex(coloured)
  if (first < 0) return kept
  const last = kept.findLastIndex(coloured)
  return kept.slice(first, last + 1)
}
