import { describe, expect, it } from 'vitest'
import type { Stack } from '@shared/types'
import { splitByReview, type StackEntry } from './burnIn'

function entry(id: string, masks: Stack['masks'] = []): StackEntry {
  return {
    stack: {
      id,
      kind: 'single',
      label: 'All images',
      component: 'magnitude',
      bValue: null,
      echoNumber: null,
      phaseIndex: null,
      acquisitionTime: null,
      slices: [],
      selected: true,
      trimStart: 0,
      crop: null,
      plane: null,
      sharedPlane: true,
      bytes: 0,
      compression: null,
      trimEnd: 0,
      dropped: [],
      masks,
      window: null,
      unsupported: null
    },
    label: id,
    modality: 'US',
    heading: id
  }
}

describe('splitByReview', () => {
  it('sorts the selection by what has been opened full size', () => {
    const entries = [entry('a'), entry('b'), entry('c')]
    const { seen, unseen } = splitByReview(entries, new Set(['b']))

    expect(seen.map((e) => e.stack.id)).toEqual(['b'])
    // Order is kept, so the list reads in the same order as the review step.
    expect(unseen.map((e) => e.stack.id)).toEqual(['a', 'c'])
  })

  it('does not take an erased region as proof the stack was looked at', () => {
    // A mask can only be drawn in the viewer, so this combination should not
    // arise — but the check must never infer a review it did not observe.
    const { unseen } = splitByReview([entry('a', [{ x: 0, y: 0, width: 0.2, height: 0.1 }])], new Set())
    expect(unseen).toHaveLength(1)
  })

  it('reports nothing left to look at once every stack has been opened', () => {
    const entries = [entry('a'), entry('b')]
    expect(splitByReview(entries, new Set(['a', 'b'])).unseen).toEqual([])
  })
})
