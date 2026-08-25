/**
 * Reformatting a stack along another plane, and projecting slabs of it.
 *
 * All of it works on stored sample values rather than rescaled ones. Maximum,
 * minimum and mean all commute with a linear rescale, so a slab projected here
 * and rescaled afterwards is the same number as one rescaled first — which lets
 * the derived instance keep its parent's RescaleSlope and RescaleIntercept and
 * stay in Hounsfield units without a conversion pass over the whole volume.
 *
 * The volume is indexed in its own axes, not the patient's: `z` is the order
 * the slices were sorted into, `x` and `y` are the image's own columns and
 * rows. For an axial acquisition that makes coronal and sagittal mean what they
 * say. For an oblique one they mean "across the acquisition", which is why the
 * user sees the result before it can be added to a case.
 */

import type { Plane, ReformatRequestMessage } from '@shared/types'

export type { Plane }

/**
 * One image to build. `spacing` here is the size of a pixel in the result, not
 * the gap between one result and the next — the two were one number once, and
 * asking for images 10 mm apart quietly produced images with 10 mm pixels.
 */
export interface ReformatRequest extends ReformatRequestMessage {
  pixelSpacing: number
}

export interface Volume {
  /** Stored samples, slice by slice: index (z * rows + y) * columns + x. */
  samples: ArrayLike<number>
  columns: number
  rows: number
  depth: number
  /** Millimetres between neighbouring columns, rows and slices. */
  spacing: { x: number; y: number; z: number }
}

export interface ReformatSlice {
  samples: Float32Array
  width: number
  height: number
  /** Millimetres per pixel, both axes; isotropic by construction. */
  spacing: number
}

/** The volume's extent along each axis, in millimetres. */
export function extent(volume: Volume): { x: number; y: number; z: number } {
  return {
    x: Math.max(volume.columns - 1, 0) * volume.spacing.x,
    y: Math.max(volume.rows - 1, 0) * volume.spacing.y,
    z: Math.max(volume.depth - 1, 0) * volume.spacing.z
  }
}

/**
 * How far a plane's normal runs, and how the image is laid out on it.
 *
 * `v` points the way a reader expects: slices are sorted towards the head, so a
 * coronal or sagittal image is built from the last slice down and the head ends
 * up at the top rather than the bottom.
 */
function axes(plane: Plane): { u: 'x' | 'y' | 'z'; v: 'x' | 'y' | 'z'; n: 'x' | 'y' | 'z'; flipV: boolean } {
  switch (plane) {
    case 'axial':
      return { u: 'x', v: 'y', n: 'z', flipV: false }
    case 'coronal':
      return { u: 'x', v: 'z', n: 'y', flipV: true }
    case 'sagittal':
      return { u: 'y', v: 'z', n: 'x', flipV: true }
  }
}

/** How thick the volume is along a plane's normal, in millimetres. */
export function normalExtent(volume: Volume, plane: Plane): number {
  return extent(volume)[axes(plane).n]
}

/** One sample of the volume, linear between the eight neighbours around it. */
export function sampleAt(volume: Volume, x: number, y: number, z: number): number {
  const { columns, rows, depth, samples } = volume
  const cx = Math.min(Math.max(x, 0), columns - 1)
  const cy = Math.min(Math.max(y, 0), rows - 1)
  const cz = Math.min(Math.max(z, 0), depth - 1)

  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const z0 = Math.floor(cz)
  const x1 = Math.min(x0 + 1, columns - 1)
  const y1 = Math.min(y0 + 1, rows - 1)
  const z1 = Math.min(z0 + 1, depth - 1)
  const fx = cx - x0
  const fy = cy - y0
  const fz = cz - z0

  const at = (xi: number, yi: number, zi: number): number => samples[(zi * rows + yi) * columns + xi]

  const c00 = at(x0, y0, z0) * (1 - fx) + at(x1, y0, z0) * fx
  const c10 = at(x0, y1, z0) * (1 - fx) + at(x1, y1, z0) * fx
  const c01 = at(x0, y0, z1) * (1 - fx) + at(x1, y0, z1) * fx
  const c11 = at(x0, y1, z1) * (1 - fx) + at(x1, y1, z1) * fx

  const c0 = c00 * (1 - fy) + c10 * fy
  const c1 = c01 * (1 - fy) + c11 * fy
  return c0 * (1 - fz) + c1 * fz
}

/**
 * Build one reformatted image.
 *
 * The output grid is isotropic whatever the volume's spacing was: a CT at 0.7 mm
 * in plane and 5 mm between slices reformats into square pixels, which is the
 * whole point of doing this rather than looking at the stack sideways.
 */
export function reformatSlice(volume: Volume, request: ReformatRequest): ReformatSlice {
  const { u, v, n, flipV } = axes(request.plane)
  const size = extent(volume)
  const spacing = Math.max(request.pixelSpacing, 0.01)

  const width = Math.max(2, Math.round(size[u] / spacing) + 1)
  const height = Math.max(2, Math.round(size[v] / spacing) + 1)

  /**
   * The slab is read at the voxel planes inside it rather than at even steps
   * along it. A maximum taken from interpolated samples is not a maximum of the
   * data: a step that straddles the brightest voxel returns the average of it
   * and its neighbour, and a vessel comes out half as bright as it is.
   *
   * A plain slice is the exception and is read where it was asked for, between
   * two planes if that is where it falls — there is nothing to lose by
   * interpolating one image.
   */
  const centre = request.offset / volume.spacing[n]
  const half = Math.max(request.thickness, 0) / 2 / volume.spacing[n]
  const first = Math.max(Math.ceil(centre - half - 1e-6), 0)
  const last = Math.min(Math.floor(centre + half + 1e-6), size[n] / volume.spacing[n])
  const planes: number[] =
    request.projection === 'slice' || last < first
      ? [centre]
      : Array.from({ length: last - first + 1 }, (_, i) => first + i)
  const count = planes.length

  const samples = new Float32Array(width * height)
  const position: Record<'x' | 'y' | 'z', number> = { x: 0, y: 0, z: 0 }

  for (let iv = 0; iv < height; iv++) {
    const vMm = flipV ? size[v] - iv * spacing : iv * spacing
    for (let iu = 0; iu < width; iu++) {
      const uMm = iu * spacing

      let value = request.projection === 'minip' ? Infinity : request.projection === 'mip' ? -Infinity : 0
      for (const plane of planes) {
        position[u] = uMm / volume.spacing[u]
        position[v] = vMm / volume.spacing[v]
        position[n] = plane
        const sample = sampleAt(volume, position.x, position.y, position.z)

        if (request.projection === 'mip') value = Math.max(value, sample)
        else if (request.projection === 'minip') value = Math.min(value, sample)
        else value += sample
      }

      samples[iv * width + iu] =
        request.projection === 'mean' || request.projection === 'slice' ? value / count : value
    }
  }

  return { samples, width, height, spacing }
}

/** Where each image of a reformatted series sits along the normal, in mm. */
export function slabOffsets(volume: Volume, plane: Plane, spacing: number): number[] {
  const span = normalExtent(volume, plane)
  const step = Math.max(spacing, 0.01)
  const count = Math.max(1, Math.floor(span / step) + 1)
  // Centred on the volume, so the images that get dropped are at both ends
  // rather than all at the far one.
  const start = (span - (count - 1) * step) / 2
  return Array.from({ length: count }, (_, i) => start + i * step)
}
