/**
 * Which images of a stack are really going up.
 *
 * Two things take images out of a stack and they are not the same shape. The
 * **trim** is a range, for the dead ends of a series — the localisers before
 * the anatomy, the tail after it. A **drop** is one image, for the one that is
 * blurred, doubled, or shows the wrong thing while its neighbours are fine.
 *
 * Both are indices into `slices` as it arrived, and the rule that combines them
 * lives here rather than at each of the three places that needs it: the
 * anonymiser reads it through the session, the volume behind a reformat reads
 * it again, and the picker counts with it. Three implementations of "kept"
 * would drift, and the way they would drift is a count that says one thing
 * while the upload does another.
 */
import type { Stack } from './types'

/** The fields of a stack that decide what is kept. */
export type Kept = Pick<Stack, 'slices' | 'trimStart' | 'trimEnd' | 'dropped'>

/** Is this image, by its index in the stack as it arrived, going to be uploaded? */
export function isKept(stack: Kept, index: number): boolean {
  return index >= stack.trimStart && index <= stack.trimEnd && !(stack.dropped ?? []).includes(index)
}

/** The slices that are going up, in order, with the trim and the drops applied. */
export function keptSlices(stack: Kept): Stack['slices'] {
  return stack.slices.filter((_slice, index) => isKept(stack, index))
}

/** How many images of the stack are going up. */
export function keptCount(stack: Kept): number {
  let kept = 0
  for (let index = 0; index < stack.slices.length; index++) if (isKept(stack, index)) kept++
  return kept
}

/**
 * Drop an image, or put it back.
 *
 * Sorted, because the list is shown as much as it is read — and a set of
 * indices that comes back in the order they were clicked reads as noise.
 */
export function toggleDropped(dropped: readonly number[], index: number): number[] {
  return dropped.includes(index)
    ? dropped.filter((i) => i !== index)
    : [...dropped, index].sort((a, b) => a - b)
}

/**
 * Re-check a list of dropped indices against the stack it belongs to.
 *
 * The renderer's copy reaches the anonymiser, so nothing in it is trusted: an
 * index outside the stack, a fraction, a duplicate, or the whole stack dropped
 * would each fail somewhere further along and further from the cause.
 */
export function sanitiseDropped(dropped: readonly number[] | undefined, length: number): number[] {
  const seen = new Set<number>()
  for (const index of dropped ?? []) {
    if (!Number.isInteger(index) || index < 0 || index >= length) continue
    seen.add(index)
  }
  return [...seen].sort((a, b) => a - b)
}
