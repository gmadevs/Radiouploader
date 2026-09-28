import { describe, expect, it } from 'vitest'
import { blend, keyField } from './interpolate'
import { paintStructures } from './paint'
import { fillPolygon, stroke } from './raster'
import {
  History,
  createStructure,
  fromMessage,
  maskAt,
  reinterpolate,
  setKey,
  toMessage
} from './structures'

const W = 64
const H = 48

function circle(cx: number, cy: number, r: number): Uint8Array {
  const m = new Uint8Array(W * H)
  stroke(m, W, H, [cx, cy], [cx, cy], r, 1)
  return m
}

function centroid(m: Uint8Array): [number, number, number] {
  let sx = 0
  let sy = 0
  let n = 0
  for (let i = 0; i < m.length; i++) {
    if (!m[i]) continue
    sx += (i % W) + 0.5
    sy += Math.floor(i / W) + 0.5
    n++
  }
  return [sx / n, sy / n, n]
}

describe('drawing', () => {
  it('fills a polygon by pixel centres', () => {
    const m = new Uint8Array(W * H)
    fillPolygon(m, W, H, [[10, 10], [20, 10], [20, 20], [10, 20]], 1)
    expect(m.reduce((a, b) => a + b, 0)).toBe(100)
    expect(m[10 * W + 10]).toBe(1)
    expect(m[20 * W + 20]).toBe(0)
  })

  it('marks the pixel under a brush smaller than a pixel', () => {
    const m = new Uint8Array(W * H)
    stroke(m, W, H, [5.9, 5.1], [5.9, 5.1], 0.3, 1)
    expect(m.reduce((a, b) => a + b, 0)).toBe(1)
    expect(m[5 * W + 5]).toBe(1)
  })
})

describe('interpolation', () => {
  it('keeps a key unchanged through its own distance field', () => {
    const m = circle(30, 24, 9)
    expect(blend(keyField(m, W, H), keyField(m, W, H), 0.5, W, H)).toEqual(m)
  })

  it('moves and grows a shape between two keys that do not overlap', () => {
    const a = circle(16, 24, 6)
    const b = circle(48, 24, 10)
    const mid = blend(keyField(a, W, H), keyField(b, W, H), 0.5, W, H)
    const [cx, cy, n] = centroid(mid)
    expect(cx).toBeCloseTo(32, 0)
    expect(cy).toBeCloseTo(24, 0)
    expect(n).toBeGreaterThan(centroid(a)[2])
    expect(n).toBeLessThan(centroid(b)[2])
  })

  it('shrinks a shape towards an empty key', () => {
    const a = circle(20, 24, 8)
    const empty = new Uint8Array(W * H)
    const near = centroid(blend(keyField(a, W, H), keyField(empty, W, H), 0.25, W, H))[2]
    const far = centroid(blend(keyField(a, W, H), keyField(empty, W, H), 0.75, W, H))[2]
    expect(near).toBeGreaterThan(far)
    expect(far).toBeGreaterThan(0)
  })

  it('fills only the images between keys, and a key wins over its fill', () => {
    const s = createStructure('Spinal canal', '#ff0000')
    s.keys.set(2, circle(16, 24, 6))
    s.keys.set(6, circle(40, 24, 6))
    reinterpolate(s, W, H)
    expect([...s.filled.keys()].sort()).toEqual([3, 4, 5])
    expect(maskAt(s, 1)).toBeUndefined()
    expect(maskAt(s, 2)).toBe(s.keys.get(2))
    s.interpolate = false
    expect(maskAt(s, 4)).toBeUndefined()
  })
})

describe('structures', () => {
  it('rebuilds the same fill on the other side of the bridge', () => {
    const s = createStructure('Spinal cord', '#00ff00')
    s.keys.set(0, circle(20, 20, 5))
    s.keys.set(3, circle(30, 20, 5))
    reinterpolate(s, W, H)
    // Structured clone turns nothing into anything else here, but a copy is
    // what arrives, and a copy is what has to give the same answer.
    const back = fromMessage(structuredClone(toMessage(s)), W, H)
    expect(back.name).toBe('Spinal cord')
    expect(back.keys.get(3)).toEqual(s.keys.get(3))
    expect(back.filled.get(1)).toEqual(s.filled.get(1))
    expect(back.filled.get(2)).toEqual(s.filled.get(2))
  })

  it('refuses a drawing made on images of another size', () => {
    const s = createStructure('Mass', '#ff0000')
    s.keys.set(0, circle(20, 20, 5))
    expect(() => fromMessage(toMessage(s), W + 1, H)).toThrow(/size/)
  })

  it('undoes and redoes a key', () => {
    const s = createStructure('Mass', '#ff0000')
    const history = new History()
    const drawn = circle(20, 20, 5)
    history.push({ structure: s, index: 4, before: undefined, after: drawn })
    setKey(s, 4, drawn)
    history.undo()
    expect(s.keys.has(4)).toBe(false)
    history.redo()
    expect(s.keys.get(4)).toEqual(drawn)
    history.forget(s)
    expect(history.canUndo).toBe(false)
  })
})

describe('painting', () => {
  it('lays a structure over RGB at twice the size of the grid it was drawn on', () => {
    const grid = { width: 4, height: 4 }
    const s = createStructure('Mass', '#ff0000')
    s.opacity = 0.5
    s.outline = false
    const mask = new Uint8Array(16)
    mask[5] = 1 // column 1, row 1
    s.keys.set(0, mask)

    const pixels = new Uint8Array(8 * 8 * 3).fill(100)
    paintStructures(pixels, 8, 8, 3, [s], 0, grid)
    const at = (x: number, y: number): number[] => [...pixels.subarray((y * 8 + x) * 3, (y * 8 + x) * 3 + 3)]
    // Mask pixel (1, 1) covers image pixels 2–3 on both axes.
    expect(at(2, 2)).toEqual([178, 50, 50])
    expect(at(3, 3)).toEqual([178, 50, 50])
    expect(at(1, 1)).toEqual([100, 100, 100])
    expect(at(4, 2)).toEqual([100, 100, 100])
  })

  it('draws the edge opaque and leaves the image alone on images with nothing drawn', () => {
    const grid = { width: 5, height: 5 }
    const s = createStructure('Mass', '#0000ff')
    s.opacity = 0
    const mask = new Uint8Array(25)
    for (const i of [6, 7, 8, 11, 12, 13, 16, 17, 18]) mask[i] = 1
    s.keys.set(3, mask)

    const pixels = new Uint8ClampedArray(25 * 4).fill(200)
    paintStructures(pixels, 5, 5, 4, [s], 3, grid)
    expect([...pixels.subarray(6 * 4, 6 * 4 + 3)]).toEqual([0, 0, 255])
    // The middle is inside on every side, so only its zero-opacity fill lands.
    expect([...pixels.subarray(12 * 4, 12 * 4 + 3)]).toEqual([200, 200, 200])

    const untouched = new Uint8ClampedArray(25 * 4).fill(200)
    paintStructures(untouched, 5, 5, 4, [s], 2, grid)
    expect(untouched.every((v) => v === 200)).toBe(true)
  })
})
