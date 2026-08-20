import type { Stack } from '@shared/types'

/**
 * A selected stack with the labels the check dialog and the viewer both need.
 *
 * Flattened out of the study tree because the check is about the selection as a
 * whole, not about where each stack sits in it.
 */
export interface StackEntry {
  stack: Stack
  /** Series, and the stack within it when the series was split. */
  label: string
  /** Modality, which is often what tells two same-named series apart. */
  modality: string | null
  /** Study and series, the heading the viewer shows. */
  heading: string
}

/**
 * Split the selection into what has been opened full size and what has not.
 *
 * Opening a stack in the viewer is the only moment the app can be sure the
 * images were on screen large enough to read a patient banner, so that is what
 * counts as looked at. It is a weaker claim than "checked" — the viewer shows
 * one image at a time and nobody scrubs every frame — which is why the dialog
 * asks rather than concludes, and never reports a selection as clean.
 */
export function splitByReview(
  entries: readonly StackEntry[],
  opened: ReadonlySet<string>
): { seen: StackEntry[]; unseen: StackEntry[] } {
  const seen: StackEntry[] = []
  const unseen: StackEntry[] = []
  for (const entry of entries) {
    ;(opened.has(entry.stack.id) ? seen : unseen).push(entry)
  }
  return { seen, unseen }
}
