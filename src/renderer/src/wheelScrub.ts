import { useEffect, useRef, type RefObject } from 'react'

/**
 * Turning wheel and trackpad scrolling into images.
 *
 * A mouse notch arrives as one event of 100 px or so, a trackpad as a stream of
 * events a few pixels each, and a Firefox mouse reports lines rather than
 * pixels. Accumulating pixels and spending them a fixed amount at a time is what
 * makes those three feel the same.
 */

/** Scroll per image. Small enough that a gentle trackpad push still moves one. */
const STEP_PIXELS = 24

/** A line is about this tall, which is what deltaMode 1 counts in. */
const LINE_PIXELS = 16
const PAGE_PIXELS = 400

export interface WheelStep {
  /** Images to move, -1, 0 or 1. */
  steps: number
  /** Scroll not yet spent, to pass back on the next event. */
  carry: number
}

/**
 * How far one wheel event moves the stack.
 *
 * At most one image per event on purpose: a mouse notch is four steps' worth of
 * pixels, and spending them all would jump four images at a flick of the finger.
 * Events arrive fast enough that a real scroll still runs through a stack
 * quickly, and the leftover is dropped rather than banked so a slow scroll in
 * one direction cannot build up a lurch.
 */
export function wheelStep(deltaY: number, deltaMode: number, carry: number): WheelStep {
  const pixels = deltaMode === 1 ? deltaY * LINE_PIXELS : deltaMode === 2 ? deltaY * PAGE_PIXELS : deltaY
  if (!Number.isFinite(pixels) || pixels === 0) return { steps: 0, carry }

  // Turning round mid-scroll starts again, or the images would keep going the
  // old way for as long as the leftover lasted.
  const total = (Math.sign(pixels) === Math.sign(carry) ? carry : 0) + pixels
  if (Math.abs(total) < STEP_PIXELS) return { steps: 0, carry: total }
  return { steps: Math.sign(total), carry: 0 }
}

/**
 * Scrub through a stack with the wheel or the trackpad over `ref`.
 *
 * The listener is added by hand rather than through onWheel because React
 * registers wheel handlers as passive, and this one has to preventDefault: the
 * picker scrolls behind the cards, and without it a scroll over an image would
 * move the images and the page at once.
 */
export function useWheelScrub(ref: RefObject<HTMLElement | null>, onStep: (steps: number) => void): void {
  const carry = useRef(0)
  const step = useRef(onStep)
  step.current = onStep

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const onWheel = (event: WheelEvent): void => {
      // Sideways scrolling is left alone: on a trackpad it is a swipe, and on
      // this page it means nothing.
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      event.preventDefault()
      const { steps, carry: left } = wheelStep(event.deltaY, event.deltaMode, carry.current)
      carry.current = left
      if (steps !== 0) step.current(steps)
    }

    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [ref])
}
