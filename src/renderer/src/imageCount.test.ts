import { describe, expect, it } from 'vitest'
import type { SliceRef } from '@shared/types'
import { averageOptions, countLevel, countWarning, stepOptions, suggestedOption } from './imageCount'

function slices(count: number, spacing: number | null = 1): SliceRef[] {
  return Array.from({ length: count }, (_, i) => ({
    path: `/tmp/${i}.dcm`,
    frame: 0,
    instanceNumber: i + 1,
    sliceLocation: spacing === null ? null : i * spacing,
    sopInstanceUid: null
  }))
}

const stack = (count: number, spacing: number | null = 1, every = 1) => ({
  slices: slices(count, spacing),
  trimStart: 0,
  trimEnd: count - 1,
  dropped: [],
  every
})

describe('countLevel', () => {
  it('marks a stack above 70 and above 100', () => {
    expect(countLevel(70)).toBe('fine')
    expect(countLevel(71)).toBe('many')
    expect(countLevel(100)).toBe('many')
    expect(countLevel(101)).toBe('too-many')
  })

  it('says nothing about a stack that is fine', () => {
    expect(countWarning(40)).toBeNull()
    expect(countWarning(150)).toContain('more than 100')
    expect(countWarning(80)).toContain('20 to 70')
  })
})

describe('stepOptions', () => {
  it('counts what each step leaves', () => {
    const options = stepOptions(stack(300))
    expect(options[0]).toEqual({ every: 1, count: 300 })
    expect(options[2]).toEqual({ every: 3, count: 100 })
    expect(options[4]).toEqual({ every: 5, count: 60 })
  })

  it('suggests the smallest step that brings the stack to 70', () => {
    expect(suggestedOption(stepOptions(stack(300)))?.every).toBe(5)
    expect(suggestedOption(stepOptions(stack(50)))?.every).toBe(1)
  })
})

describe('averageOptions', () => {
  it('names each averaging by the thickness it gives', () => {
    const options = averageOptions(stack(300, 1))
    expect(options[1]).toEqual({ slices: 3, thickness: 3, count: 100 })
    expect(options[3]).toEqual({ slices: 5, thickness: 5, count: 60 })
  })

  it('reads the thickness off the slice spacing', () => {
    expect(averageOptions(stack(160, 0.625))[3]).toEqual({ slices: 5, thickness: 3.1, count: 32 })
  })

  it('offers nothing for images that do not say where they are', () => {
    expect(averageOptions(stack(200, null))).toEqual([])
  })

  it('averages what the step keeps', () => {
    expect(averageOptions(stack(300, 1, 2))[0]).toEqual({ slices: 2, thickness: 4, count: 75 })
  })
})
