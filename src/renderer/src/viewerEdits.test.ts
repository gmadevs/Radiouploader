import { describe, expect, it } from 'vitest'
import type { Stack } from '@shared/types'
import { editsOf, sameEdits } from './viewerEdits'

const stack = (patch: Partial<Stack> = {}): Stack =>
  ({
    id: 's1',
    label: 'All images',
    slices: [],
    selected: true,
    trimStart: 0,
    trimEnd: 0,
    masks: [],
    crop: null,
    window: null,
    dropped: [],
    ...patch
  }) as Stack

const box = { x: 0.1, y: 0.1, width: 0.3, height: 0.2 }

describe('sameEdits', () => {
  it('is true for a stack nothing was done to', () => {
    expect(sameEdits(editsOf(stack()), editsOf(stack()))).toBe(true)
  })

  it('notices a mask that was drawn', () => {
    expect(sameEdits(editsOf(stack()), editsOf(stack({ masks: [box] })))).toBe(false)
  })

  it('notices a mask that was moved, not only one that was added', () => {
    const moved = { ...box, x: 0.2 }
    expect(sameEdits(editsOf(stack({ masks: [box] })), editsOf(stack({ masks: [moved] })))).toBe(false)
  })

  it('compares masks by value, so the same rectangle drawn twice is the same stack', () => {
    expect(sameEdits(editsOf(stack({ masks: [box] })), editsOf(stack({ masks: [{ ...box }] })))).toBe(true)
  })

  it('notices a crop, including one cleared again', () => {
    expect(sameEdits(editsOf(stack()), editsOf(stack({ crop: box })))).toBe(false)
    expect(sameEdits(editsOf(stack({ crop: box })), editsOf(stack()))).toBe(false)
  })

  it('notices a window, and tells one window from another', () => {
    expect(sameEdits(editsOf(stack()), editsOf(stack({ window: { centre: 40, width: 400 } })))).toBe(false)
    expect(
      sameEdits(
        editsOf(stack({ window: { centre: 40, width: 400 } })),
        editsOf(stack({ window: { centre: 40, width: 1500 } }))
      )
    ).toBe(false)
  })

  it('notices a dropped image', () => {
    expect(sameEdits(editsOf(stack()), editsOf(stack({ dropped: [3] })))).toBe(false)
    expect(sameEdits(editsOf(stack({ dropped: [3] })), editsOf(stack({ dropped: [3] })))).toBe(true)
  })

  it('is not fooled by a stack that gives nothing where another gives an empty list', () => {
    expect(sameEdits(editsOf(stack({ masks: undefined, dropped: undefined })), editsOf(stack()))).toBe(true)
  })
})
