/**
 * Moving one item of a list past its neighbours.
 *
 * Kept out of the component because the rule worth pinning is what happens at
 * the ends: a move that would leave the list is refused rather than wrapped
 * round to the other side. Wrapping is what a list of tabs does; a series
 * pushed off the front of a case reappearing at the back is a surprise nobody
 * asked for, and one that is easy to do by holding a button down.
 */
export function moveBy<T>(list: readonly T[], index: number, delta: number): T[] {
  const to = index + delta
  if (index < 0 || index >= list.length || to < 0 || to >= list.length || delta === 0) {
    return [...list]
  }

  const moved = [...list]
  const [item] = moved.splice(index, 1)
  moved.splice(to, 0, item)
  return moved
}
