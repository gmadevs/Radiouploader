import { describe, expect, it } from 'vitest'
import { createStructure, reinterpolate } from '@shared/annotate/structures'
import { closesPolygon, indicesToWrite, stripMarks, vertexReach } from './annotateEdit'
import { legendEntries, legendLayout } from './legend'

const W = 16
const H = 16

function dot(x: number, y: number): Uint8Array {
  const mask = new Uint8Array(W * H)
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mask[(y + dy) * W + x + dx] = 1
  return mask
}

describe('the strip over the image slider', () => {
  it('marks drawn, filled and cleared images at their place among the kept ones', () => {
    const s = createStructure('Canal', '#ff0000')
    s.keys.set(2, dot(5, 5))
    s.keys.set(5, dot(9, 9))
    s.keys.set(8, new Uint8Array(W * H))
    reinterpolate(s, W, H)
    // Image 3 was dropped, so image 4 is the third one kept.
    const kept = [1, 2, 4, 5, 6, 8]
    expect(stripMarks(s, kept)).toEqual([
      { position: 1, kind: 'key' },
      { position: 2, kind: 'filled' },
      { position: 3, kind: 'key' },
      { position: 4, kind: 'filled' },
      { position: 5, kind: 'empty' }
    ])
    s.interpolate = false
    expect(stripMarks(s, kept).map((mark) => mark.kind)).toEqual(['key', 'key', 'empty'])
  })
})

describe('closing a polygon', () => {
  it('needs three vertices and a click on the first', () => {
    expect(closesPolygon([[0, 0], [10, 0]], [0, 0], 2)).toBe(false)
    expect(closesPolygon([[0, 0], [10, 0], [10, 10]], [1, 1], 2)).toBe(true)
    expect(closesPolygon([[0, 0], [10, 0], [10, 10]], [3, 3], 2)).toBe(false)
  })

  it('reaches ten screen pixels whatever the image is drawn at', () => {
    expect(vertexReach({ width: 512, height: 512 }, 1024)).toBe(5)
    expect(vertexReach({ width: 512, height: 512 }, 256)).toBe(20)
  })
})

describe('the images written', () => {
  it('runs from the first to the last image with colour on it, fade included', () => {
    const s = createStructure('Canal', '#ff0000')
    s.keys.set(3, dot(5, 5))
    s.keys.set(6, new Uint8Array(W * H))
    reinterpolate(s, W, H)
    const kept = [0, 1, 2, 3, 4, 5, 6, 7]
    expect(indicesToWrite([s], kept, false)).toEqual(kept)
    // Image 5 is two thirds of the way to the cleared key and still has colour.
    expect(indicesToWrite([s], kept, true)).toEqual([3, 4, 5])
    s.visible = false
    expect(indicesToWrite([s], kept, true)).toEqual(kept)
  })
})

describe('the legend', () => {
  it('lists the structures that are shown and drawn on', () => {
    const drawn = createStructure('Canal', '#ff0000')
    drawn.keys.set(0, dot(5, 5))
    const empty = createStructure('Cord', '#00ff00')
    empty.keys.set(0, new Uint8Array(W * H))
    const hidden = createStructure('Mass', '#0000ff')
    hidden.keys.set(0, dot(5, 5))
    hidden.visible = false
    expect(legendEntries([drawn, empty, hidden]).map((s) => s.name)).toEqual(['Canal'])
  })

  it('sits in the lower left corner, sized to the image', () => {
    const small = legendLayout(2, 60, { width: 256, height: 256 })
    expect(small.font).toBe(11)
    expect(small.x).toBe(small.pad)
    expect(small.y + small.height).toBe(256 - small.pad)
    const large = legendLayout(2, 60, { width: 1024, height: 1024 })
    expect(large.font).toBe(33)
    // Never wider than the image, however long a name is.
    expect(legendLayout(1, 5000, { width: 256, height: 256 }).width).toBeLessThanOrEqual(256)
  })
})
