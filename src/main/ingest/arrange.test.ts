import { describe, expect, it } from 'vitest'
import type { Stack } from '@shared/types'
import { bySlice, carriedEdits } from './arrange'

/** One phase of a dynamic series: the same positions, at its own time point. */
function phase(index: number, locations: (number | null)[]): Stack {
  return {
    id: `s::stack-${index}`,
    kind: 'phase',
    label: `Phase ${index}`,
    component: 'magnitude',
    bValue: null,
    echoNumber: null,
    phaseIndex: index,
    acquisitionTime: null,
    slices: locations.map((sliceLocation, k) => ({
      path: `/tmp/p${index}-s${k}.dcm`,
      frame: 0,
      instanceNumber: index * 10 + k,
      sliceLocation,
      sopInstanceUid: null
    })),
    selected: true,
    trimStart: 0,
    trimEnd: locations.length - 1,
    dropped: [],
    masks: [],
    crop: null,
    plane: 'Coronal',
    sharedPlane: true,
    bytes: 1000,
    compression: null,
    window: null,
    unsupported: null
  }
}

describe('bySlice', () => {
  it('makes a stack per slice position, its images in time order', () => {
    // Given out of order, as a picker that sorts by label might hand them.
    const stacks = bySlice('s', [phase(2, [0, 3, 6]), phase(1, [0, 3, 6]), phase(3, [0, 3, 6])])!
    expect(stacks.map((stack) => stack.label)).toEqual(['Slice 1', 'Slice 2', 'Slice 3'])
    expect(stacks[1].slices.map((slice) => slice.path)).toEqual(['/tmp/p1-s1.dcm', '/tmp/p2-s1.dcm', '/tmp/p3-s1.dcm'])
    expect(stacks.every((stack) => stack.selected && stack.phaseIndex === null)).toBe(true)
    // Three phases of 1000 bytes make 3000, shared between three slices.
    expect(stacks.map((stack) => stack.bytes)).toEqual([1000, 1000, 1000])
    expect(new Set(stacks.map((stack) => stack.id)).size).toBe(3)
  })

  it('turns one image per phase into a single run in time', () => {
    // A 4D angiogram exported as a MIP per phase.
    const stacks = bySlice('s', [phase(1, [5]), phase(2, [5]), phase(3, [5])])!
    expect(stacks).toHaveLength(1)
    expect(stacks[0].label).toBe('All phases')
    expect(stacks[0].slices).toHaveLength(3)
  })

  it('refuses phases that do not hold the same slices', () => {
    expect(bySlice('s', [phase(1, [0, 3]), phase(2, [0, 3, 6])])).toBeNull()
    expect(bySlice('s', [phase(1, [0, 3]), phase(2, [0, 4])])).toBeNull()
    expect(bySlice('s', [phase(1, [0, null]), phase(2, [0, null])])).toBeNull()
    expect(bySlice('s', [phase(1, [0, 3])])).toBeNull()
  })
})

describe('carriedEdits', () => {
  it('carries every blanked area, and a crop only where every stack had it', () => {
    const a = { ...phase(1, [0]), masks: [{ x: 0, y: 0, width: 0.5, height: 0.1 }], crop: { x: 0, y: 0, width: 0.5, height: 1 } }
    const b = { ...phase(2, [0]), masks: [{ x: 0, y: 0, width: 0.5, height: 0.1 }, { x: 0, y: 0.9, width: 1, height: 0.1 }] }
    const edits = carriedEdits([a, b])
    expect(edits.masks).toHaveLength(2)
    expect(edits.crop).toBeNull()
    expect(carriedEdits([a, { ...b, crop: a.crop }]).crop).toEqual(a.crop)
  })
})
