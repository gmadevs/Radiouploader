import { describe, expect, it } from 'vitest'
import { extent, normalExtent, reformatSlice, sampleAt, slabOffsets, type Volume } from './reformat'

/**
 * A volume whose value is its own z index, so a reformat can be checked by
 * reading the number back: anything sampled at slice k must be k.
 */
function ramp(columns = 4, rows = 4, depth = 5, spacing = { x: 1, y: 1, z: 1 }): Volume {
  const samples = new Float32Array(columns * rows * depth)
  for (let z = 0; z < depth; z++) {
    for (let i = 0; i < rows * columns; i++) samples[z * rows * columns + i] = z
  }
  return { samples, columns, rows, depth, spacing }
}

/** A volume that is zero everywhere except one bright voxel. */
function speck(at: { x: number; y: number; z: number }, value = 100): Volume {
  const volume = ramp(8, 8, 8)
  const samples = new Float32Array(8 * 8 * 8)
  samples[(at.z * 8 + at.y) * 8 + at.x] = value
  return { ...volume, samples }
}

describe('sampleAt', () => {
  it('reads a voxel back exactly at its own coordinates', () => {
    expect(sampleAt(ramp(), 1, 2, 3)).toBe(3)
  })

  it('interpolates between slices rather than snapping to one', () => {
    expect(sampleAt(ramp(), 0, 0, 2.5)).toBeCloseTo(2.5)
    expect(sampleAt(ramp(), 0, 0, 2.25)).toBeCloseTo(2.25)
  })

  it('clamps outside the volume instead of reading past the end', () => {
    expect(sampleAt(ramp(), -5, -5, -5)).toBe(0)
    expect(sampleAt(ramp(), 99, 99, 99)).toBe(4)
  })
})

describe('extent', () => {
  it('measures the gaps, not the voxels', () => {
    // Five slices 2 mm apart span 8 mm from the first centre to the last.
    expect(extent(ramp(4, 4, 5, { x: 1, y: 1, z: 2 }))).toEqual({ x: 3, y: 3, z: 8 })
  })

  it('knows which axis a plane looks along', () => {
    const volume = ramp(4, 4, 5, { x: 1, y: 1, z: 2 })
    expect(normalExtent(volume, 'axial')).toBe(8)
    expect(normalExtent(volume, 'coronal')).toBe(3)
    expect(normalExtent(volume, 'sagittal')).toBe(3)
  })
})

describe('reformatSlice', () => {
  it('gives an isotropic grid whatever the slice spacing was', () => {
    // 4 columns 1 mm apart, 5 slices 5 mm apart: 3 mm across and 20 mm deep.
    const volume = ramp(4, 4, 5, { x: 1, y: 1, z: 5 })
    const image = reformatSlice(volume, {
      plane: 'coronal',
      projection: 'slice',
      thickness: 0,
      offset: 1.5,
      spacing: 1,
      pixelSpacing: 1
    })
    expect(image.width).toBe(4)
    expect(image.height).toBe(21)
    expect(image.spacing).toBe(1)
  })

  it('puts the last slice at the top of a coronal image', () => {
    // Slices are sorted towards the head, so the head belongs at the top.
    const image = reformatSlice(ramp(4, 4, 5), {
      plane: 'coronal',
      projection: 'slice',
      thickness: 0,
      offset: 1.5,
      spacing: 1,
      pixelSpacing: 1
    })
    expect(image.samples[0]).toBeCloseTo(4)
    expect(image.samples[image.samples.length - 1]).toBeCloseTo(0)
  })

  it('takes the brightest sample of the slab for a MIP', () => {
    const volume = speck({ x: 4, y: 4, z: 4 })
    const flat = reformatSlice(volume, {
      plane: 'axial',
      projection: 'mip',
      thickness: 8,
      offset: 3.5,
      spacing: 1,
      pixelSpacing: 1
    })
    // The bright voxel is inside the slab, so the ray through it finds it even
    // though the slab is centred half a millimetre away.
    expect(Math.max(...flat.samples)).toBeCloseTo(100)
    // And nothing else is lit.
    expect(flat.samples.filter((v) => v > 1)).toHaveLength(1)
  })

  it('takes the darkest for a MinIP, which is the point of one', () => {
    const volume = speck({ x: 4, y: 4, z: 4 }, -100)
    const flat = reformatSlice(volume, { plane: 'axial', projection: 'minip', thickness: 8, offset: 3.5, spacing: 1, pixelSpacing: 1 })
    expect(Math.min(...flat.samples)).toBeCloseTo(-100)
  })

  it('averages the slab for a mean, so one bright voxel is diluted', () => {
    const volume = speck({ x: 4, y: 4, z: 4 })
    const flat = reformatSlice(volume, { plane: 'axial', projection: 'mean', thickness: 8, offset: 3.5, spacing: 1, pixelSpacing: 1 })
    const brightest = Math.max(...flat.samples)
    expect(brightest).toBeGreaterThan(0)
    expect(brightest).toBeLessThan(100)
  })

  it('reads one sample for a plain slice, whatever the thickness says', () => {
    const volume = ramp(4, 4, 5)
    const image = reformatSlice(volume, { plane: 'axial', projection: 'slice', thickness: 20, offset: 2, spacing: 1, pixelSpacing: 1 })
    for (const value of image.samples) expect(value).toBeCloseTo(2)
  })
})

describe('slabOffsets', () => {
  it('covers the volume at the spacing asked for', () => {
    const volume = ramp(4, 4, 11, { x: 1, y: 1, z: 1 })
    expect(slabOffsets(volume, 'axial', 2)).toEqual([0, 2, 4, 6, 8, 10])
  })

  it('centres what it cannot divide evenly, so both ends lose the same', () => {
    const volume = ramp(4, 4, 11, { x: 1, y: 1, z: 1 })
    const offsets = slabOffsets(volume, 'axial', 3)
    expect(offsets).toEqual([0.5, 3.5, 6.5, 9.5])
  })

  it('gives one image for a volume thinner than the spacing', () => {
    expect(slabOffsets(ramp(4, 4, 2, { x: 1, y: 1, z: 1 }), 'axial', 10)).toHaveLength(1)
  })
})
