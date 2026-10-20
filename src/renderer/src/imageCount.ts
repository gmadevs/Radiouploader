import { keptCount, keptSlices, MAX_EVERY, type Kept } from '@shared/selection'
import { extentOf } from './stackDetail'

/**
 * How many images a stack sends, against what a case can use.
 *
 * Radiopaedia's case publishing guidelines ask for 20 to 70 images per stack
 * and discourage more than 100, because a long stack takes too long to load on
 * a slow connection. The card marks a stack above 70 and a stack above 100,
 * and offers the two ways to bring it down that keep the whole of the anatomy:
 * keeping one image in every few, or averaging neighbours into thicker slices.
 * A trim brings it down too, but by cutting anatomy off, which is a different
 * decision.
 */

export const SUGGESTED_MAX = 70
export const USUAL_MAX = 100

export type CountLevel = 'fine' | 'many' | 'too-many'

export function countLevel(count: number): CountLevel {
  if (count > USUAL_MAX) return 'too-many'
  if (count > SUGGESTED_MAX) return 'many'
  return 'fine'
}

/** The line under a stack's name, or null where the count needs no remark. */
export function countWarning(count: number): string | null {
  switch (countLevel(count)) {
    case 'too-many':
      return `Radiopaedia discourages more than ${USUAL_MAX} images in a stack.`
    case 'many':
      return `Radiopaedia suggests 20 to ${SUGGESTED_MAX} images in a stack.`
    default:
      return null
  }
}

export interface StepOption {
  every: number
  count: number
}

/** Each step the card offers, with the number of images it would leave. */
export function stepOptions(stack: Kept): StepOption[] {
  return Array.from({ length: MAX_EVERY }, (_, i) => ({ every: i + 1, count: keptCount({ ...stack, every: i + 1 }) }))
}

export interface AverageOption {
  /** How many neighbouring images go into one. */
  slices: number
  /** Millimetres each averaged image covers. */
  thickness: number
  count: number
}

/** The most images averaged into one. Past it a slab is a projection, not a slice. */
export const MAX_AVERAGED = 10

/**
 * Each way of averaging the kept images into thicker slices.
 *
 * Empty where averaging means nothing: a stack whose images do not say where
 * they are, or a cine whose frames are all at the same place. The count is
 * whole groups only, which is what the main process writes: the images left
 * over are split between the two ends.
 */
export function averageOptions(stack: Kept): AverageOption[] {
  const kept = keptSlices(stack)
  const extent = extentOf(kept)
  if (extent === null) return []
  const options: AverageOption[] = []
  for (let slices = 2; slices <= MAX_AVERAGED; slices++) {
    const count = Math.floor(kept.length / slices)
    if (count < 2) break
    options.push({ slices, thickness: Math.round(extent.spacing * slices * 10) / 10, count })
  }
  return options
}

/**
 * The option to offer first: the least reduction that brings the stack to 70
 * or under, or the strongest one there is when none does.
 */
export function suggestedOption<T extends { count: number }>(options: T[]): T | null {
  if (options.length === 0) return null
  return options.find((option) => option.count <= SUGGESTED_MAX) ?? options[options.length - 1]
}
