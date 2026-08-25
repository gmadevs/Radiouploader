import { describe, expect, it } from 'vitest'
import { AXES, boxRange, cross, dot, isAxisAligned, normalise, rotate, square, type Frame } from './geometry'

const close = (a: number[], b: number[]): void => a.forEach((value, i) => expect(value).toBeCloseTo(b[i]))

describe('rotate', () => {
  it('turns a quarter circle about an axis', () => {
    close(rotate(AXES.x, AXES.z, Math.PI / 2), [0, 1, 0])
    close(rotate(AXES.y, AXES.z, Math.PI / 2), [-1, 0, 0])
  })

  it('leaves the axis it turns about alone', () => {
    close(rotate(AXES.z, AXES.z, 1.2), [0, 0, 1])
  })

  it('keeps the length, which is what the sampler depends on', () => {
    const turned = rotate(normalise([1, 2, 3]), normalise([3, -1, 2]), 0.7)
    expect(Math.hypot(...turned)).toBeCloseTo(1)
  })
})

describe('square', () => {
  it('leaves a frame that is already square where it is', () => {
    const frame: Frame = { u: AXES.x, v: AXES.y, n: AXES.z }
    const fixed = square(frame)
    close(fixed.u, [1, 0, 0])
    close(fixed.v, [0, 1, 0])
    close(fixed.n, [0, 0, 1])
  })

  it('pulls a drifted frame back to right angles', () => {
    // What a few hundred rotations leave behind.
    const drifted: Frame = { u: [1, 0.02, 0], v: [0, 1, 0.01], n: [0.01, 0, 1] }
    const fixed = square(drifted)
    expect(dot(fixed.u, fixed.v)).toBeCloseTo(0)
    expect(dot(fixed.u, fixed.n)).toBeCloseTo(0)
    expect(dot(fixed.v, fixed.n)).toBeCloseTo(0)
    expect(Math.hypot(...fixed.u)).toBeCloseTo(1)
  })

  it('keeps the frame right-handed, so the geometry it writes is not mirrored', () => {
    const fixed = square({ u: [1, 0.1, 0], v: [0, 1, 0], n: [0, 0, 1] })
    close(cross(fixed.u, fixed.v), fixed.n)
  })
})

describe('boxRange', () => {
  const size = { x: 10, y: 20, z: 30 }

  it('measures a side along one of the axes', () => {
    expect(boxRange(size, AXES.y)).toEqual({ min: 0, max: 20 })
  })

  it('measures what an oblique direction crosses, not what a side is', () => {
    const across = boxRange(size, normalise([1, 1, 0]))
    expect(across.max).toBeCloseTo(30 / Math.SQRT2)
    expect(across.min).toBe(0)
  })

  it('handles a direction that points backwards', () => {
    expect(boxRange(size, [0, 0, -1])).toEqual({ min: -30, max: 0 })
  })
})

describe('isAxisAligned', () => {
  it('knows the volume’s own axes from anything else', () => {
    expect(isAxisAligned(AXES.z)).toBe(true)
    expect(isAxisAligned([0, 0, -1])).toBe(true)
    expect(isAxisAligned(normalise([0, 1, 1]))).toBe(false)
    expect(isAxisAligned(rotate(AXES.z, AXES.x, 0.001))).toBe(false)
  })
})
