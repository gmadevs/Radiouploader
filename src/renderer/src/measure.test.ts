import { describe, expect, it } from 'vitest'
import type { PreviewFrame } from '@shared/types'
import { angleAt, createMeasurement, describe as describeMeasurement, distance, handleAt, isDegenerate, roiArea, roiStats } from './measure'

const square = { row: 0.5, column: 0.5, detector: false }

function grey(width: number, height: number, value: (x: number, y: number) => number, scale = square): PreviewFrame {
  const values = new Float32Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) values[y * width + x] = value(x, y)
  return { kind: 'grey', width, height, values, window: { centre: 0, width: 100 }, invert: false, compressed: false, scale }
}

describe('a length', () => {
  it('is in millimetres along each axis by its own spacing', () => {
    expect(distance([0, 0], [30, 40], square)).toBe(25)
    // Rectangular pixels: rows 2 mm apart, columns 1 mm.
    expect(distance([0, 0], [0, 10], { row: 2, column: 1, detector: false })).toBe(20)
    expect(distance([0, 0], [10, 0], { row: 2, column: 1, detector: false })).toBe(10)
  })

  it('says pixels where the file gives no scale', () => {
    const ruler = createMeasurement('ruler', 0, [[0, 0], [30, 40]], '#ff0')
    expect(describeMeasurement(ruler, { ...grey(64, 64, () => 0), scale: null }, 'CT')).toEqual(['50 px'])
    expect(describeMeasurement(ruler, grey(64, 64, () => 0), 'CT')).toEqual(['25.0 mm'])
  })
})

describe('an angle', () => {
  it('is measured at the vertex', () => {
    expect(angleAt([10, 0], [0, 0], [0, 10], null)).toBeCloseTo(90)
    expect(angleAt([10, 0], [0, 0], [-10, 0], null)).toBeCloseTo(180)
    expect(angleAt([10, 0], [0, 0], [10, 10], null)).toBeCloseTo(45)
  })

  // On the grid the arms are at 45°; in the patient one is twice as long.
  it('is the patient’s angle on pixels that are not square', () => {
    expect(angleAt([10, 0], [0, 0], [10, 10], { row: 2, column: 1, detector: false })).toBeCloseTo(63.43, 1)
  })
})

describe('an ROI', () => {
  it('takes the pixels whose centres are inside the ellipse', () => {
    const frame = grey(20, 20, (x) => (x < 10 ? 0 : 100))
    if (frame.kind !== 'grey') throw new Error('grey')
    const left = roiStats(frame.values, 20, 20, [0, 0], [10, 10])
    expect(left?.mean).toBe(0)
    expect(left?.sd).toBe(0)
    const across = roiStats(frame.values, 20, 20, [5, 5], [15, 15])
    expect(across?.mean).toBeCloseTo(50, 0)
    expect(across?.min).toBe(0)
    expect(across?.max).toBe(100)
  })

  it('gives the sample standard deviation', () => {
    const frame = grey(2, 1, (x) => (x === 0 ? 1 : 3))
    if (frame.kind !== 'grey') throw new Error('grey')
    expect(roiStats(frame.values, 2, 1, [0, 0], [2, 1])?.sd).toBeCloseTo(Math.SQRT2)
  })

  it('has the area of its ellipse in square centimetres', () => {
    // 20 × 20 pixels of 0.5 mm: a circle of 5 mm radius.
    expect(roiArea([0, 0], [20, 20], square)).toBeCloseTo((Math.PI * 25) / 100)
  })

  it('names Hounsfield units on a CT only', () => {
    const roi = createMeasurement('roi', 0, [[0, 0], [10, 10]], '#ff0')
    const frame = grey(10, 10, () => 40)
    expect(describeMeasurement(roi, frame, 'CT')[0]).toBe('Mean 40.0 HU, SD 0.0')
    expect(describeMeasurement(roi, frame, 'MR')[0]).toBe('Mean 40.0, SD 0.0')
  })
})

describe('editing', () => {
  it('finds the point under the pointer on this image only', () => {
    const a = createMeasurement('ruler', 2, [[0, 0], [10, 0]], '#ff0')
    const b = createMeasurement('ruler', 3, [[10, 0], [20, 0]], '#ff0')
    expect(handleAt([a, b], 2, [9, 1], 3)).toEqual({ id: a.id, point: 1 })
    expect(handleAt([a, b], 2, [20, 0], 3)).toBeNull()
  })

  it('throws away a click that was not a drag', () => {
    expect(isDegenerate(createMeasurement('ruler', 0, [[5, 5], [5.5, 5]], '#ff0'))).toBe(true)
    expect(isDegenerate(createMeasurement('roi', 0, [[5, 5], [30, 6]], '#ff0'))).toBe(true)
    expect(isDegenerate(createMeasurement('roi', 0, [[5, 5], [30, 30]], '#ff0'))).toBe(false)
  })
})
