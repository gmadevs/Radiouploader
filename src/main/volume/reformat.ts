import { AXES, boxRange, dot, isAxisAligned, type Frame, type Vec3 } from '@shared/geometry'

/**
 * Reformatting a stack along any plane, and projecting slabs of it.
 *
 * All of it works on stored sample values rather than rescaled ones. Maximum,
 * minimum and mean all commute with a linear rescale, so a slab projected here
 * and rescaled afterwards is the same number as one rescaled first — which lets
 * the derived instance keep its parent's RescaleSlope and RescaleIntercept and
 * stay in Hounsfield units without a conversion pass over the whole volume.
 *
 * A plane is a frame — across, down, and the way it looks — in the volume's own
 * millimetre space. The three anatomical planes are three particular frames and
 * have no special case here: an oblique one is sampled exactly the same way,
 * which is what makes rotating them cost nothing.
 */

export interface Volume {
  /** Stored samples: index ((z * rows + y) * columns + x) * channels + channel. */
  samples: ArrayLike<number>
  columns: number
  rows: number
  depth: number
  /**
   * Samples per voxel: 1 for greyscale, 3 for RGB.
   *
   * Colour is carried through rather than flattened to a grey. A DTI colour map
   * says which way the fibres run *in the colour*, and a reformat of it that
   * threw the colour away would be a reformat of nothing anyone asked for.
   */
  channels: number
  /** Millimetres between neighbouring columns, rows and slices. */
  spacing: { x: number; y: number; z: number }
  /** The lowest sample in the volume, which is what lies outside it. */
  low: number
}

export type Projection = 'slice' | 'mip' | 'minip' | 'mean'

export interface ReformatRequest {
  frame: Frame
  projection: Projection
  /** Slab thickness in millimetres. Anything under one sample is one sample. */
  thickness: number
  /** Where the slab sits along the frame's normal, in mm from the volume's near edge. */
  offset: number
  /** Millimetres per pixel of the result, the same in both directions. */
  pixelSpacing: number
}

export interface ReformatSlice {
  /** width * height * channels, interleaved. */
  samples: Float32Array
  width: number
  height: number
  channels: number
  /** Millimetres per pixel, both axes; isotropic by construction. */
  spacing: number
}

/** The volume's extent along each of its own axes, in millimetres. */
export function extent(volume: Volume): { x: number; y: number; z: number } {
  return {
    x: Math.max(volume.columns - 1, 0) * volume.spacing.x,
    y: Math.max(volume.rows - 1, 0) * volume.spacing.y,
    z: Math.max(volume.depth - 1, 0) * volume.spacing.z
  }
}

/** How far the volume runs in one direction, in millimetres. */
export function range(volume: Volume, direction: Vec3): { min: number; max: number } {
  return boxRange(extent(volume), direction)
}

/** How thick the volume is along a frame's normal, in millimetres. */
export function normalExtent(volume: Volume, frame: Frame): number {
  const { min, max } = range(volume, frame.n)
  return max - min
}

/**
 * One sample of the volume, linear between the eight neighbours around it.
 *
 * Outside the volume it returns the volume's own floor rather than the nearest
 * edge value: an oblique plane leaves the box halfway across the picture, and
 * clamping would smear the last row of voxels across everything beyond it.
 */
export function sampleAt(volume: Volume, x: number, y: number, z: number, channel = 0): number {
  const { columns, rows, depth, channels, samples } = volume
  if (x < 0 || y < 0 || z < 0 || x > columns - 1 || y > rows - 1 || z > depth - 1) return volume.low

  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const z0 = Math.floor(z)
  const x1 = Math.min(x0 + 1, columns - 1)
  const y1 = Math.min(y0 + 1, rows - 1)
  const z1 = Math.min(z0 + 1, depth - 1)
  const fx = x - x0
  const fy = y - y0
  const fz = z - z0

  const at = (xi: number, yi: number, zi: number): number =>
    samples[((zi * rows + yi) * columns + xi) * channels + channel]

  const c00 = at(x0, y0, z0) * (1 - fx) + at(x1, y0, z0) * fx
  const c10 = at(x0, y1, z0) * (1 - fx) + at(x1, y1, z0) * fx
  const c01 = at(x0, y0, z1) * (1 - fx) + at(x1, y0, z1) * fx
  const c11 = at(x0, y1, z1) * (1 - fx) + at(x1, y1, z1) * fx

  const c0 = c00 * (1 - fy) + c10 * fy
  const c1 = c01 * (1 - fy) + c11 * fy
  return c0 * (1 - fz) + c1 * fz
}

/**
 * Where a slab is read, in millimetres along the normal from the slab's centre.
 *
 * On one of the volume's own axes those are the voxel planes themselves, which
 * makes a maximum a maximum of the data. A maximum of interpolated samples is
 * not: a step straddling the brightest voxel returns the average of it and its
 * neighbour, and a vessel comes out half as bright as it is. An oblique plane
 * has no voxel planes to read, so it is stepped at half the finest spacing —
 * as close to the same thing as sampling can get.
 */
function slabSteps(volume: Volume, frame: Frame, centre: number, thickness: number): number[] {
  const half = Math.max(thickness, 0) / 2
  if (half <= 0) return [centre]

  if (isAxisAligned(frame.n)) {
    const axis = (['x', 'y', 'z'] as const).find((name) => Math.abs(Math.abs(dot(frame.n, AXES[name])) - 1) < 1e-9)
    const step = axis === undefined ? 0 : volume.spacing[axis]
    if (step > 0) {
      const first = Math.ceil((centre - half) / step - 1e-6)
      const last = Math.floor((centre + half) / step + 1e-6)
      if (last >= first) return Array.from({ length: last - first + 1 }, (_, i) => (first + i) * step)
    }
  }

  const fine = Math.min(volume.spacing.x, volume.spacing.y, volume.spacing.z) / 2
  const count = Math.max(1, Math.round((half * 2) / fine) + 1)
  return Array.from({ length: count }, (_, i) => centre - half + (i * half * 2) / Math.max(count - 1, 1))
}

/**
 * Build one reformatted image.
 *
 * The output grid is isotropic whatever the volume's spacing was: a CT at 0.7 mm
 * in plane and 5 mm between slices reformats into square pixels, which is the
 * whole point of doing this rather than looking at the stack sideways.
 */
export function reformatSlice(volume: Volume, request: ReformatRequest): ReformatSlice {
  const { frame } = request
  const spacing = Math.max(request.pixelSpacing, 0.01)

  const across = range(volume, frame.u)
  const down = range(volume, frame.v)
  const through = range(volume, frame.n)

  const width = Math.max(2, Math.round((across.max - across.min) / spacing) + 1)
  const height = Math.max(2, Math.round((down.max - down.min) / spacing) + 1)

  const centre = through.min + request.offset
  const steps = request.projection === 'slice' ? [centre] : slabSteps(volume, frame, centre, request.thickness)
  const count = steps.length

  // A maximum through colour would take the red of one voxel, the green of
  // another and the blue of a third, and paint a colour that is nowhere in the
  // volume. The dialog does not offer it; this is the same statement in code.
  const channels = volume.channels
  if (channels > 1 && request.projection !== 'slice') {
    throw new Error('A colour volume can be cut on any plane, but not projected through')
  }

  const samples = new Float32Array(width * height * channels)
  const { x: dx, y: dy, z: dz } = volume.spacing

  for (let iv = 0; iv < height; iv++) {
    const v = down.min + iv * spacing
    for (let iu = 0; iu < width; iu++) {
      const u = across.min + iu * spacing

      for (let c = 0; c < channels; c++) {
        let value = request.projection === 'minip' ? Infinity : request.projection === 'mip' ? -Infinity : 0
        for (const n of steps) {
          // p = u·U + v·V + n·N, in the volume's millimetres, then into voxels.
          const px = (u * frame.u[0] + v * frame.v[0] + n * frame.n[0]) / dx
          const py = (u * frame.u[1] + v * frame.v[1] + n * frame.n[1]) / dy
          const pz = (u * frame.u[2] + v * frame.v[2] + n * frame.n[2]) / dz
          const sample = sampleAt(volume, px, py, pz, c)

          if (request.projection === 'mip') value = Math.max(value, sample)
          else if (request.projection === 'minip') value = Math.min(value, sample)
          else value += sample
        }

        samples[(iv * width + iu) * channels + c] =
          request.projection === 'mean' || request.projection === 'slice' ? value / count : value
      }
    }
  }

  return { samples, width, height, channels, spacing }
}

/** Where the first pixel of such an image sits, in the volume's millimetres. */
export function imageOrigin(volume: Volume, frame: Frame, offset: number): Vec3 {
  const across = range(volume, frame.u)
  const down = range(volume, frame.v)
  const through = range(volume, frame.n)
  const n = through.min + offset
  return [
    across.min * frame.u[0] + down.min * frame.v[0] + n * frame.n[0],
    across.min * frame.u[1] + down.min * frame.v[1] + n * frame.n[1],
    across.min * frame.u[2] + down.min * frame.v[2] + n * frame.n[2]
  ]
}

/** Where each image of a reformatted series sits along the normal, in mm. */
export function slabOffsets(volume: Volume, frame: Frame, spacing: number): number[] {
  const span = normalExtent(volume, frame)
  const step = Math.max(spacing, 0.01)
  const count = Math.max(1, Math.floor(span / step) + 1)
  // Centred on the volume, so the images that get dropped are at both ends
  // rather than all at the far one.
  const start = (span - (count - 1) * step) / 2
  return Array.from({ length: count }, (_, i) => start + i * step)
}
