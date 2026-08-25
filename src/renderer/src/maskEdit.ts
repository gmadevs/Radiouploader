import type { MaskRect } from '@shared/types'

/**
 * Moving and resizing a mask that has already been drawn.
 *
 * All of it works in fractions of the image, the same units the mask is stored
 * in, so nothing here depends on the size the viewer happens to be showing.
 *
 * Kept out of the component because these are the rules that matter: a mask
 * must stay inside the image, and it must never become so small that it is
 * effectively gone while still counting as a redaction.
 */

/** Below this a box is a mis-click rather than a rectangle. */
export const MIN_MASK_SIDE = 0.004

/** The corner being dragged. */
export type MaskHandle = 'nw' | 'ne' | 'sw' | 'se'

function clampUnit(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

/**
 * Move the whole box, keeping its size.
 *
 * The box stops at the edge of the image rather than being trimmed by it: a
 * redaction that quietly shrank because the drag went too far would uncover
 * what it was put there to hide.
 */
export function moveMask(rect: MaskRect, dx: number, dy: number): MaskRect {
  return {
    ...rect,
    x: Math.min(Math.max(rect.x + dx, 0), Math.max(1 - rect.width, 0)),
    y: Math.min(Math.max(rect.y + dy, 0), Math.max(1 - rect.height, 0))
  }
}

/**
 * One axis of a resize: the edge that stays put, and where the dragged one has
 * got to. Dragging past the fixed edge flips the box rather than refusing to
 * move, which is what every drawing tool does.
 */
function axis(fixed: number, moved: number): { start: number; length: number } {
  const length = Math.abs(moved - fixed)
  if (length >= MIN_MASK_SIDE) return { start: Math.min(fixed, moved), length }
  // Pinched shut. Keep the minimum on the side the pointer is, unless that
  // would leave the image, in which case it goes the other way.
  const forward = moved >= fixed
  const start = forward
    ? Math.min(fixed, 1 - MIN_MASK_SIDE)
    : Math.max(Math.min(fixed - MIN_MASK_SIDE, 1 - MIN_MASK_SIDE), 0)
  return { start, length: MIN_MASK_SIDE }
}

/** Drag one corner; the opposite one stays where it is. */
export function resizeMask(rect: MaskRect, handle: MaskHandle, dx: number, dy: number): MaskRect {
  const west = handle === 'nw' || handle === 'sw'
  const north = handle === 'nw' || handle === 'ne'

  const horizontal = axis(west ? rect.x + rect.width : rect.x, clampUnit((west ? rect.x : rect.x + rect.width) + dx))
  const vertical = axis(north ? rect.y + rect.height : rect.y, clampUnit((north ? rect.y : rect.y + rect.height) + dy))

  return { x: horizontal.start, y: vertical.start, width: horizontal.length, height: vertical.length }
}
