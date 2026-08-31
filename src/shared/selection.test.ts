import { describe, expect, it } from 'vitest'
import type { SliceRef } from './types'
import { isKept, keptCount, keptSlices, sanitiseDropped, toggleDropped } from './selection'

function slices(count: number): SliceRef[] {
  return Array.from({ length: count }, (_, i) => ({
    path: `/tmp/${i}.dcm`,
    frame: 0,
    instanceNumber: i,
    sliceLocation: i,
    sopInstanceUid: null
  }))
}

const stack = (count: number, trimStart = 0, trimEnd = count - 1, dropped: number[] = []) => ({
  slices: slices(count),
  trimStart,
  trimEnd,
  dropped
})

describe('keptSlices', () => {
  it('keeps everything when nothing is trimmed or dropped', () => {
    expect(keptSlices(stack(4))).toHaveLength(4)
  })

  it('drops one image from the middle without moving the rest', () => {
    const kept = keptSlices(stack(5, 0, 4, [2]))
    expect(kept.map((s) => s.instanceNumber)).toEqual([0, 1, 3, 4])
  })

  it('applies the trim and the drops together', () => {
    expect(keptSlices(stack(10, 2, 6, [4])).map((s) => s.instanceNumber)).toEqual([2, 3, 5, 6])
  })

  // A drop outside the trim changes nothing: it is already not being uploaded.
  it('ignores a drop that is outside the trim', () => {
    expect(keptCount(stack(10, 2, 6, [8]))).toBe(5)
  })
})

describe('isKept', () => {
  it('is false for a dropped image and for one outside the trim', () => {
    const s = stack(6, 1, 4, [3])
    expect(isKept(s, 0)).toBe(false)
    expect(isKept(s, 3)).toBe(false)
    expect(isKept(s, 2)).toBe(true)
  })
})

describe('toggleDropped', () => {
  it('adds an index, and puts it back on a second press', () => {
    expect(toggleDropped([], 3)).toEqual([3])
    expect(toggleDropped([3], 3)).toEqual([])
  })

  it('keeps the list in order however it was clicked', () => {
    expect(toggleDropped([5, 1], 3)).toEqual([1, 3, 5])
  })
})

describe('sanitiseDropped', () => {
  it('throws away what could not be an index', () => {
    expect(sanitiseDropped([-1, 0, 2.5, 4, 99], 5)).toEqual([0, 4])
  })

  it('deduplicates and sorts', () => {
    expect(sanitiseDropped([3, 1, 3], 5)).toEqual([1, 3])
  })

  it('treats a missing list as nothing dropped', () => {
    expect(sanitiseDropped(undefined, 5)).toEqual([])
  })
})
