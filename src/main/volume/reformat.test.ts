import { describe, expect, it } from 'vitest'
import { AXES, negate, normalise, rotate, type Frame } from '@shared/geometry'
import { extent, imageOrigin, normalExtent, reformatSlice, sampleAt, slabOffsets, type Volume } from './reformat'

/** The three anatomical frames, which are three particular bases and no more. */
const FRAMES: Record<'axial' | 'coronal' | 'sagittal', Frame> = {
  axial: { u: AXES.x, v: AXES.y, n: AXES.z },
  coronal: { u: AXES.x, v: negate(AXES.z), n: AXES.y },
  sagittal: { u: AXES.y, v: negate(AXES.z), n: negate(AXES.x) }
}

/**
 * A volume whose value is its own z index, so a reformat can be checked by
 * reading the number back: anything sampled at slice k must be k.
 */
function ramp(columns = 4, rows = 4, depth = 5, spacing = { x: 1, y: 1, z: 1 }): Volume {
  const samples = new Float32Array(columns * rows * depth)
  for (let z = 0; z < depth; z++) {
    for (let i = 0; i < rows * columns; i++) samples[z * rows * columns + i] = z
  }
  return { samples, columns, rows, depth, channels: 1, spacing, low: 0 }
}

/** A volume that is zero everywhere except one bright voxel. */
function speck(at: { x: number; y: number; z: number }, value = 100): Volume {
  const samples = new Float32Array(8 * 8 * 8)
  samples[(at.z * 8 + at.y) * 8 + at.x] = value
  return { samples, columns: 8, rows: 8, depth: 8, channels: 1, spacing: { x: 1, y: 1, z: 1 }, low: Math.min(0, value) }
}

describe('sampleAt', () => {
  it('reads a voxel back exactly at its own coordinates', () => {
    expect(sampleAt(ramp(), 1, 2, 3)).toBe(3)
  })

  it('interpolates between slices rather than snapping to one', () => {
    expect(sampleAt(ramp(), 0, 0, 2.5)).toBeCloseTo(2.5)
    expect(sampleAt(ramp(), 0, 0, 2.25)).toBeCloseTo(2.25)
  })

  it('returns the floor outside the volume, not the nearest edge', () => {
    // An oblique plane leaves the box halfway across the picture. Clamping
    // would smear the last row of voxels across everything beyond it.
    const volume = ramp()
    expect(sampleAt(volume, -0.5, 0, 0)).toBe(volume.low)
    expect(sampleAt(volume, 0, 0, 99)).toBe(volume.low)
  })
})

describe('extent', () => {
  it('measures the gaps, not the voxels', () => {
    expect(extent(ramp(4, 4, 5, { x: 1, y: 1, z: 2 }))).toEqual({ x: 3, y: 3, z: 8 })
  })

  it('knows which way a frame looks', () => {
    const volume = ramp(4, 4, 5, { x: 1, y: 1, z: 2 })
    expect(normalExtent(volume, FRAMES.axial)).toBe(8)
    expect(normalExtent(volume, FRAMES.coronal)).toBe(3)
    expect(normalExtent(volume, FRAMES.sagittal)).toBe(3)
  })

  it('measures the diagonal a tilted frame crosses', () => {
    const volume = ramp(4, 4, 4, { x: 1, y: 1, z: 1 })
    const tilted = { ...FRAMES.axial, n: normalise([0, 1, 1]) }
    expect(normalExtent(volume, tilted)).toBeCloseTo(6 / Math.SQRT2)
  })
})

describe('reformatSlice', () => {
  const request = { projection: 'slice' as const, thickness: 0, offset: 1.5, pixelSpacing: 1 }

  it('gives an isotropic grid whatever the slice spacing was', () => {
    // 4 columns 1 mm apart, 5 slices 5 mm apart: 3 mm across and 20 mm deep.
    const image = reformatSlice(ramp(4, 4, 5, { x: 1, y: 1, z: 5 }), { ...request, frame: FRAMES.coronal })
    expect(image.width).toBe(4)
    expect(image.height).toBe(21)
    expect(image.spacing).toBe(1)
  })

  it('puts the last slice at the top of a coronal image', () => {
    const image = reformatSlice(ramp(4, 4, 5), { ...request, frame: FRAMES.coronal })
    expect(image.samples[0]).toBeCloseTo(4)
    expect(image.samples[image.samples.length - 1]).toBeCloseTo(0)
  })

  it('takes the brightest sample of the slab for a MIP', () => {
    const volume = speck({ x: 4, y: 4, z: 4 })
    const flat = reformatSlice(volume, {
      frame: FRAMES.axial,
      projection: 'mip',
      thickness: 8,
      offset: 3.5,
      pixelSpacing: 1
    })
    expect(Math.max(...flat.samples)).toBeCloseTo(100)
    expect(flat.samples.filter((v) => v > 1)).toHaveLength(1)
  })

  it('takes the darkest for a MinIP, which is the point of one', () => {
    const volume = speck({ x: 4, y: 4, z: 4 }, -100)
    const flat = reformatSlice(volume, {
      frame: FRAMES.axial,
      projection: 'minip',
      thickness: 8,
      offset: 3.5,
      pixelSpacing: 1
    })
    expect(Math.min(...flat.samples)).toBeCloseTo(-100)
  })

  it('averages the slab for a mean, so one bright voxel is diluted', () => {
    const volume = speck({ x: 4, y: 4, z: 4 })
    const flat = reformatSlice(volume, {
      frame: FRAMES.axial,
      projection: 'mean',
      thickness: 8,
      offset: 3.5,
      pixelSpacing: 1
    })
    const brightest = Math.max(...flat.samples)
    expect(brightest).toBeGreaterThan(0)
    expect(brightest).toBeLessThan(100)
  })

  it('reads one sample for a plain slice, whatever the thickness says', () => {
    const image = reformatSlice(ramp(4, 4, 5), { ...request, frame: FRAMES.axial, thickness: 20, offset: 2 })
    for (const value of image.samples) expect(value).toBeCloseTo(2)
  })

  it('finds a bright spot through a tilted slab as well as a straight one', () => {
    // The reason the oblique case is stepped finely rather than at the voxel
    // planes it does not have: a MIP that misses the peak is not a MIP.
    //
    // A block rather than a single voxel, because a tilted grid lands between
    // voxels by definition — interpolating a one-voxel spike is always a
    // fraction of it, however finely the slab is stepped.
    const volume = speck({ x: 4, y: 4, z: 4 })
    const bright = volume.samples as Float32Array
    for (const z of [4, 5]) for (const y of [4, 5]) for (const x of [4, 5]) bright[(z * 8 + y) * 8 + x] = 100
    const tilted: Frame = {
      u: rotate(AXES.x, AXES.y, 0.3),
      v: AXES.y,
      n: rotate(AXES.z, AXES.y, 0.3)
    }
    const flat = reformatSlice(volume, { frame: tilted, projection: 'mip', thickness: 6, offset: 3.5, pixelSpacing: 1 })
    expect(Math.max(...flat.samples)).toBeGreaterThan(90)
  })

  it('holds a tilted image to the same isotropic grid', () => {
    const volume = ramp(8, 8, 8)
    const tilted: Frame = { u: rotate(AXES.x, AXES.z, 0.4), v: rotate(AXES.y, AXES.z, 0.4), n: AXES.z }
    const image = reformatSlice(volume, { ...request, frame: tilted })
    // The diagonal of a 7 mm square is about 9.9 mm, so the image grows to hold it.
    expect(image.width).toBeGreaterThan(8)
    expect(image.spacing).toBe(1)
  })
})

describe('imageOrigin', () => {
  it('starts an axial image at the volume’s own corner', () => {
    expect(imageOrigin(ramp(4, 4, 5), FRAMES.axial, 2)).toEqual([0, 0, 2])
  })

  it('starts a coronal image at the far end, because it is built downwards', () => {
    const origin = imageOrigin(ramp(4, 4, 5), FRAMES.coronal, 1)
    expect(origin[1]).toBeCloseTo(1)
    expect(origin[2]).toBeCloseTo(4)
  })
})

describe('slabOffsets', () => {
  it('covers the volume at the spacing asked for', () => {
    expect(slabOffsets(ramp(4, 4, 11), FRAMES.axial, 2)).toEqual([0, 2, 4, 6, 8, 10])
  })

  it('centres what it cannot divide evenly, so both ends lose the same', () => {
    expect(slabOffsets(ramp(4, 4, 11), FRAMES.axial, 3)).toEqual([0.5, 3.5, 6.5, 9.5])
  })

  it('gives one image for a volume thinner than the spacing', () => {
    expect(slabOffsets(ramp(4, 4, 2), FRAMES.axial, 10)).toHaveLength(1)
  })
})

/**
 * A colour volume whose every voxel is (z, y, x) as red, green and blue, so a
 * sample can be checked channel by channel — and a channel read out of the
 * wrong place shows up as the wrong colour rather than as a near-miss.
 */
function colours(size = 4): Volume {
  const samples = new Float32Array(size * size * size * 3)
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const at = ((z * size + y) * size + x) * 3
        samples[at] = z
        samples[at + 1] = y
        samples[at + 2] = x
      }
    }
  }
  return { samples, columns: size, rows: size, depth: size, channels: 3, spacing: { x: 1, y: 1, z: 1 }, low: 0 }
}

describe('colour volumes', () => {
  it('reads each channel from the voxel it belongs to', () => {
    const volume = colours()
    expect(sampleAt(volume, 1, 2, 3, 0)).toBe(3)
    expect(sampleAt(volume, 1, 2, 3, 1)).toBe(2)
    expect(sampleAt(volume, 1, 2, 3, 2)).toBe(1)
  })

  it('interpolates a channel along its own axis and leaves the others alone', () => {
    const volume = colours()
    expect(sampleAt(volume, 1, 2, 2.5, 0)).toBeCloseTo(2.5)
    expect(sampleAt(volume, 1, 2, 2.5, 1)).toBe(2)
    expect(sampleAt(volume, 1, 2, 2.5, 2)).toBe(1)
  })

  it('cuts a plane with its colours intact', () => {
    const image = reformatSlice(colours(), {
      frame: FRAMES.axial,
      projection: 'slice',
      thickness: 0,
      offset: 2,
      pixelSpacing: 1
    })
    expect(image.channels).toBe(3)
    expect(image.samples).toHaveLength(image.width * image.height * 3)
    // The pixel at (1, 2) of the plane through z = 2 is (2, 2, 1).
    const at = ((2 * image.width) + 1) * 3
    expect([image.samples[at], image.samples[at + 1], image.samples[at + 2]]).toEqual([2, 2, 1])
  })

  it('refuses to project through colour rather than mixing voxels together', () => {
    expect(() =>
      reformatSlice(colours(), { frame: FRAMES.axial, projection: 'mip', thickness: 4, offset: 2, pixelSpacing: 1 })
    ).toThrow(/not projected through/)
  })
})
