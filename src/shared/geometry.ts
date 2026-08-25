/**
 * Directions in a volume's own millimetre space.
 *
 * Shared because both processes reason about the same frame: the main process
 * samples along it, and the renderer draws the crosshair for it and turns a
 * drag into a rotation of it. Two implementations would drift, and the first
 * thing to show would be a crosshair pointing where the image is not.
 *
 * Everything about a reformat that is not a pixel is one of these: which way
 * the image runs, which way it looks, and how far the volume goes that way.
 * They are unit vectors in millimetres rather than in voxels, so a rotation
 * means the same thing on a study with 0.5 mm pixels and 5 mm slices as on an
 * isotropic one.
 */

export type Vec3 = [number, number, number]

/** An image's own axes: across, down, and the way it looks. Right-handed. */
export interface Frame {
  u: Vec3
  v: Vec3
  n: Vec3
}

export const AXES: { x: Vec3; y: Vec3; z: Vec3 } = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1]
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function scale(a: Vec3, by: number): Vec3 {
  return [a[0] * by, a[1] * by, a[2] * by]
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

export function negate(a: Vec3): Vec3 {
  return [-a[0], -a[1], -a[2]]
}

export function normalise(a: Vec3): Vec3 {
  const length = Math.hypot(a[0], a[1], a[2])
  return length === 0 ? [0, 0, 0] : scale(a, 1 / length)
}

/**
 * Turn a direction around an axis, by Rodrigues' formula.
 *
 * The axis has to be a unit vector; every basis here is kept normalised for
 * that reason as much as for the sampling.
 */
export function rotate(vector: Vec3, axis: Vec3, radians: number): Vec3 {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const term = dot(axis, vector) * (1 - cos)
  return add(add(scale(vector, cos), scale(cross(axis, vector), sin)), scale(axis, term))
}

/**
 * Put a frame back at right angles to itself.
 *
 * Rotations accumulate rounding, and a basis that has drifted out of square
 * stretches the image it builds. Cheap enough to do on every change.
 */
export function square(frame: Frame): Frame {
  const n = normalise(frame.n)
  const u = normalise(add(frame.u, scale(n, -dot(frame.u, n))))
  return { u, v: cross(n, u), n }
}

/**
 * How far a box of this size runs in one direction, in millimetres.
 *
 * From the corners rather than the sides: an oblique direction crosses the box
 * diagonally, and an image along it has to be big enough to hold what it
 * crosses.
 */
export function boxRange(size: { x: number; y: number; z: number }, direction: Vec3): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const x of [0, size.x]) {
    for (const y of [0, size.y]) {
      for (const z of [0, size.z]) {
        const along = dot([x, y, z], direction)
        min = Math.min(min, along)
        max = Math.max(max, along)
      }
    }
  }
  return { min, max }
}

/**
 * Is this direction one of the volume's own axes?
 *
 * Tight on purpose. It decides whether a slab can be read at the voxel planes,
 * which is exact, or has to be stepped along, which is not — and a plane that
 * is a fraction of a degree off has no voxel planes to read. Calling a tilted
 * frame oblique costs a little accuracy in the peaks; calling an oblique frame
 * aligned would sample a plane that is not there.
 */
export function isAxisAligned(direction: Vec3): boolean {
  return Object.values(AXES).some((axis) => Math.abs(Math.abs(dot(direction, axis)) - 1) < 1e-9)
}

/**
 * What to call the plane a direction looks along.
 *
 * The names are the acquisition's own, not the patient's, and anything that is
 * not one of its three axes is "Oblique" — the honest word, and the one that
 * stops a reader taking a tilted cut for a true coronal.
 */
export function describePlane(normal: Vec3): string {
  const straight = 0.999
  if (Math.abs(dot(normal, AXES.z)) > straight) return 'Axial'
  if (Math.abs(dot(normal, AXES.y)) > straight) return 'Coronal'
  if (Math.abs(dot(normal, AXES.x)) > straight) return 'Sagittal'
  return 'Oblique'
}
