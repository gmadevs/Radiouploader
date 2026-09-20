import { useEffect, type RefObject } from 'react'

/**
 * What Tab stops on. Disabled controls are left out by the selector; anything
 * a dialog is currently hiding is left out by having no box.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Where Tab goes next, given what a dialog holds and what has focus now.
 *
 * Kept apart from the hook because this is the part that can be wrong in a way
 * nothing on screen shows: a cycle that skips the first control, or one that
 * walks off the end instead of round it, looks like a trap that works right up
 * until the last button in the row.
 */
export function nextInCycle<T>(items: readonly T[], active: T | null, backwards: boolean): T | null {
  if (items.length === 0) return null
  const at = active === null ? -1 : items.indexOf(active)
  // Focus is somewhere else entirely — the footer behind the dialog, or the
  // window itself. Tab brings it back to whichever end it was heading for.
  if (at < 0) return backwards ? items[items.length - 1] : items[0]
  return items[(at + (backwards ? -1 : 1) + items.length) % items.length]
}

/**
 * Keep Tab inside a dialog, and hand focus back when it closes.
 *
 * Nothing did this before: the footer's Back and Upload to Radiopaedia sat
 * behind a backdrop that swallowed every click, and Tab walked straight onto
 * them — so the keyboard could reach, and press, the buttons of a step that
 * was not on screen. These are ordinary elements over the page rather than a
 * <dialog>, which is why the trap is written out rather than inherited.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = ref.current
    if (root === null) return

    // Whatever opened the dialog, so closing it puts the keyboard back where it
    // was rather than at the top of the window.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null

    // The dialog itself, not its first control: landing on Erase announces a
    // tool and says nothing about the window that has just opened.
    root.focus()

    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetWidth > 0 || el.offsetHeight > 0
      )
      if (items.length === 0) return
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const next = nextInCycle(items, active !== null && root.contains(active) ? active : null, event.shiftKey)
      if (next === null) return
      event.preventDefault()
      next.focus()
    }

    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      opener?.focus()
    }
  }, [ref])
}
