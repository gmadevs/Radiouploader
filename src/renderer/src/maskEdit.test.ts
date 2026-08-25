import { describe, expect, it } from 'vitest'
import { MIN_MASK_SIDE, moveMask, resizeMask } from './maskEdit'

const box = { x: 0.2, y: 0.2, width: 0.3, height: 0.2 }

describe('moveMask', () => {
  it('moves the box without changing its size', () => {
    const moved = moveMask(box, 0.1, -0.05)
    expect(moved.x).toBeCloseTo(0.3)
    expect(moved.y).toBeCloseTo(0.15)
    expect(moved.width).toBe(box.width)
    expect(moved.height).toBe(box.height)
  })

  it('stops at the edge instead of shrinking', () => {
    // A redaction that got smaller because the drag went too far would uncover
    // what it was hiding.
    const pushed = moveMask(box, -5, -5)
    expect(pushed).toMatchObject({ x: 0, y: 0, width: 0.3, height: 0.2 })
    const shoved = moveMask(box, 5, 5)
    expect(shoved).toMatchObject({ x: 0.7, y: 0.8, width: 0.3, height: 0.2 })
  })

  it('leaves a box wider than the image where it is', () => {
    const wide = { x: 0, y: 0, width: 1, height: 1 }
    expect(moveMask(wide, 0.3, 0.3)).toEqual(wide)
  })
})

describe('resizeMask', () => {
  it('drags one corner and leaves the opposite one alone', () => {
    const resized = resizeMask(box, 'se', 0.1, 0.1)
    expect(resized.x).toBeCloseTo(0.2)
    expect(resized.y).toBeCloseTo(0.2)
    expect(resized.width).toBeCloseTo(0.4)
    expect(resized.height).toBeCloseTo(0.3)
  })

  it('moves the origin when the north-west corner is dragged', () => {
    const resized = resizeMask(box, 'nw', 0.05, 0.05)
    expect(resized.x).toBeCloseTo(0.25)
    expect(resized.y).toBeCloseTo(0.25)
    expect(resized.width).toBeCloseTo(0.25)
    expect(resized.height).toBeCloseTo(0.15)
  })

  it('flips rather than refusing when a corner is dragged past the other', () => {
    const resized = resizeMask(box, 'se', -0.4, -0.3)
    // The fixed corner is still 0.2, 0.2 — the box now hangs off it the other way.
    expect(resized.x).toBeCloseTo(0.1)
    expect(resized.y).toBeCloseTo(0.1)
    expect(resized.width).toBeCloseTo(0.1)
    expect(resized.height).toBeCloseTo(0.1)
  })

  it('keeps the box inside the image', () => {
    const resized = resizeMask(box, 'se', 5, 5)
    expect(resized.x + resized.width).toBeCloseTo(1)
    expect(resized.y + resized.height).toBeCloseTo(1)
  })

  it('never pinches a box to nothing', () => {
    const pinched = resizeMask(box, 'se', -0.3, -0.2)
    expect(pinched.width).toBe(MIN_MASK_SIDE)
    expect(pinched.height).toBe(MIN_MASK_SIDE)
  })

  it('keeps the minimum inside the image at the far edge', () => {
    const atEdge = { x: 0.5, y: 0.5, width: 0.5, height: 0.5 }
    const pinched = resizeMask(atEdge, 'nw', 0.5, 0.5)
    expect(pinched.width).toBe(MIN_MASK_SIDE)
    expect(pinched.x + pinched.width).toBeLessThanOrEqual(1)
    expect(pinched.y + pinched.height).toBeLessThanOrEqual(1)
  })
})
