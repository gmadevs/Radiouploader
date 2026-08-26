import type { SliceRef } from '@shared/types'

/**
 * The few facts about a stack that decide whether it is worth uploading, in the
 * words the picker shows them in.
 *
 * All of it is read off what the ingest already worked out, so nothing here
 * opens a file. Kept out of the card because these are the rules worth pinning:
 * what a millimetre figure means, and when there is not one to give.
 */

/** How far a stack runs, and how far apart its images are. */
export interface Extent {
  /** Millimetres from the first image to the last. */
  span: number
  /** Millimetres between neighbours, as the middle gap rather than the mean. */
  spacing: number
}

/**
 * Measure a stack along its own normal.
 *
 * The middle gap rather than the average one: a stack with a slice missing has
 * one gap of twice the rest, and an average quietly reports a spacing that no
 * pair of images actually has.
 *
 * Null when there is nothing true to say — images that do not carry a position,
 * or a cine, whose frames are all at the same place and have no depth at all.
 */
export function extentOf(slices: readonly SliceRef[]): Extent | null {
  const locations = slices
    .map((slice) => slice.sliceLocation)
    .filter((location): location is number => location !== null)
  if (locations.length < 2) return null

  const sorted = [...locations].sort((a, b) => a - b)
  const span = sorted[sorted.length - 1] - sorted[0]
  if (span <= 0) return null

  const gaps = sorted.slice(1).map((location, i) => location - sorted[i]).filter((gap) => gap > 0)
  if (gaps.length === 0) return null
  const middle = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]

  return { span, spacing: middle }
}

/** A millimetre figure at the precision a reader can act on. */
export function millimetres(value: number): string {
  return value >= 100 ? String(Math.round(value)) : String(Math.round(value * 10) / 10)
}

/**
 * A size in the unit that makes it readable.
 *
 * Binary units, since that is what a file manager will say about the same file.
 * Only gigabytes get a decimal: a study is either a few hundred megabytes or it
 * is not, and "1.2 GB" is the one case where the digit changes a decision.
 */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const kb = bytes / 1024
  if (kb < 1) return `${Math.round(bytes)} B`
  const mb = kb / 1024
  if (mb < 1) return `${Math.round(kb)} KB`
  const gb = mb / 1024
  if (gb < 1) return `${Math.round(mb)} MB`
  return `${Math.round(gb * 10) / 10} GB`
}

/** What one image of the stack weighs, which is what a slider costs to scrub. */
export function perImage(bytes: number, images: number): string {
  return formatSize(images > 0 ? bytes / images : 0)
}
