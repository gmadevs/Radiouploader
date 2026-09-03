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
  return delta === 0 ? [...list] : moveTo(list, index, index + delta)
}

/**
 * Move the item at `from` to where the item at `to` is, closing the gap behind
 * it. Same rule at the ends: a move that would leave the list is refused.
 *
 * This is what a drag needs, and `moveBy` is one step of it: an arrow knows how
 * far to go, a drop knows only what it landed on.
 */
export function moveTo<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) {
    return [...list]
  }

  const moved = [...list]
  const [item] = moved.splice(from, 1)
  moved.splice(to, 0, item)
  return moved
}
