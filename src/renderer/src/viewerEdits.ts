import type { CropRect, MaskRect, Stack, WindowLevel } from '@shared/types'

/**
 * The four things the viewer changes about a stack, taken together.
 *
 * The viewer writes each of them to the stack as it is drawn — there is no
 * draft sitting somewhere waiting to be saved — so the only way it can offer a
 * way out is to remember what the stack was on the way in and put that back.
 *
 * Kept beside the component rather than in it because this is the comparison
 * that decides whether there is anything to discard, and a wrong answer either
 * offers to throw away nothing or hides the way out of a mess.
 */
export interface StackEdits {
  masks: readonly MaskRect[]
  crop: CropRect | null
  window: WindowLevel | null
  dropped: readonly number[]
}

export function editsOf(stack: Stack): StackEdits {
  return {
    masks: stack.masks ?? [],
    crop: stack.crop ?? null,
    window: stack.window ?? null,
    dropped: stack.dropped ?? []
  }
}

function sameRect(a: MaskRect | CropRect | null, b: MaskRect | CropRect | null): boolean {
  if (a === null || b === null) return a === b
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/**
 * Is the stack as it was when the viewer opened?
 *
 * Compared field by field rather than by serialising the two: a mask is four
 * numbers and a dropped image is one, and a comparison that leant on the order
 * the keys happen to be written in would pass or fail for reasons nothing here
 * controls. The masks are in the order they were drawn, and `toggleDropped`
 * keeps its list sorted, so both are compared in place.
 */
export function sameEdits(a: StackEdits, b: StackEdits): boolean {
  if (a.masks.length !== b.masks.length) return false
  if (!a.masks.every((mask, i) => sameRect(mask, b.masks[i]))) return false
  if (!sameRect(a.crop, b.crop)) return false

  if ((a.window === null) !== (b.window === null)) return false
  if (a.window && b.window && (a.window.centre !== b.window.centre || a.window.width !== b.window.width)) return false

  if (a.dropped.length !== b.dropped.length) return false
  return a.dropped.every((index, i) => index === b.dropped[i])
}
