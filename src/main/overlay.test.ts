import { describe, expect, it } from 'vitest'
import { findOverlayRegions } from './overlay'

const WIDTH = 256
const HEIGHT = 256

/** Smooth, mid-grey, slowly varying: anatomy as far as this detector cares. */
function anatomy(seed: number): Uint8Array {
  const frame = new Uint8Array(WIDTH * HEIGHT)
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      frame[y * WIDTH + x] = 90 + Math.round(60 * Math.sin((x + seed * 20) / 18) * Math.cos(y / 22))
    }
  }
  return frame
}

/** A band of hard white-on-black marks, the shape a banner has at this size. */
function writeText(frame: Uint8Array, top: number, left: number, width: number, height: number): void {
  for (let y = top; y < top + height; y++) {
    for (let x = left; x < left + width; x++) {
      frame[y * WIDTH + x] = (x + y) % 3 === 0 ? 255 : 0
    }
  }
}

/** Does any region cover this point of the image? */
function covers(regions: { x: number; y: number; width: number; height: number }[], x: number, y: number): boolean {
  return regions.some((r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height)
}

describe('findOverlayRegions', () => {
  it('finds a banner burnt into the same place on both frames', () => {
    const first = anatomy(0)
    const second = anatomy(4)
    writeText(first, 8, 12, 120, 18)
    writeText(second, 8, 12, 120, 18)

    const { regions, coverage } = findOverlayRegions(first, second, WIDTH, HEIGHT)

    expect(regions.length).toBeGreaterThan(0)
    expect(coverage).toBeGreaterThan(0)
    // Around a tenth of the way down, a quarter across: where it was written.
    expect(covers(regions, 0.2, 0.06)).toBe(true)
  })

  it('says nothing about anatomy alone', () => {
    const { regions } = findOverlayRegions(anatomy(0), anatomy(4), WIDTH, HEIGHT)
    expect(regions).toEqual([])
  })

  it('ignores a bright edge that moves between the frames', () => {
    // Bone against air is bright and sharp too. What it is not is still: the
    // next slice puts it somewhere else, and that is the whole discriminator.
    const first = anatomy(0)
    const second = anatomy(4)
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 100; x < 140; x++) first[y * WIDTH + x] = x % 2 === 0 ? 255 : 0
      for (let x = 150; x < 190; x++) second[y * WIDTH + x] = x % 2 === 0 ? 255 : 0
    }
    expect(findOverlayRegions(first, second, WIDTH, HEIGHT).regions).toEqual([])
  })

  it('still finds a banner on a stack of one image, without the stillness test', () => {
    const only = anatomy(0)
    writeText(only, 8, 12, 120, 18)
    expect(covers(findOverlayRegions(only, null, WIDTH, HEIGHT).regions, 0.2, 0.06)).toBe(true)
  })

  it('gathers a line of text into one region rather than a cell each', () => {
    const first = anatomy(0)
    const second = anatomy(4)
    writeText(first, 8, 12, 200, 18)
    writeText(second, 8, 12, 200, 18)
    const { regions } = findOverlayRegions(first, second, WIDTH, HEIGHT)
    expect(regions).toHaveLength(1)
    expect(regions[0].width).toBeGreaterThan(0.5)
  })

  it('has nothing to say about an image too small to grid', () => {
    expect(findOverlayRegions(new Uint8Array(16), null, 4, 4)).toEqual({ regions: [], coverage: 0 })
  })
})
