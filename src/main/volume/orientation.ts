import { cross, dot, negate, type Frame, type Vec3 } from '@shared/geometry'
import type { ImageHeader } from '@shared/dicomImage'

/**
 * The anatomical planes, said in the volume's own axes.
 *
 * The volume is indexed by columns, rows and slices, and what those mean
 * anatomically depends entirely on how the study was acquired. A brain FLAIR
 * acquired sagittally has its columns running front to back and its slices
 * running left to right, so the plane of the acquired images is sagittal and
 * "the first two axes" is not axial in any sense a reader would accept.
 *
 * DICOM says which is which: ImageOrientationPatient gives the row and column
 * directions in the patient, their cross product gives the slice direction, and
 * those three are an orthonormal basis. A direction in the patient becomes a
 * direction in the volume by taking its components along them.
 *
 * Patient coordinates are LPS: +x to the patient's left, +y posterior, +z to
 * the head. The frames below are the conventional views — feet-first for axial,
 * from the front for coronal, from the left for sagittal — each right-handed so
 * that an angle measured on screen turns the planes the way the hand went.
 */
export function anatomicalFrames(header: ImageHeader): Record<'axial' | 'coronal' | 'sagittal', Frame> | null {
  const cosines = header.imageOrientation
  if (cosines === null) return null

  const row: Vec3 = [cosines[0], cosines[1], cosines[2]]
  const column: Vec3 = [cosines[3], cosines[4], cosines[5]]
  const slice = cross(row, column)

  /** A direction in the patient, said in the volume's axes. */
  const inVolume = (direction: Vec3): Vec3 => [dot(direction, row), dot(direction, column), dot(direction, slice)]

  const left: Vec3 = [1, 0, 0]
  const posterior: Vec3 = [0, 1, 0]
  const head: Vec3 = [0, 0, 1]

  return {
    axial: { u: inVolume(left), v: inVolume(posterior), n: inVolume(head) },
    coronal: { u: inVolume(left), v: inVolume(negate(head)), n: inVolume(posterior) },
    sagittal: { u: inVolume(posterior), v: inVolume(negate(head)), n: inVolume(negate(left)) }
  }
}

/**
 * The volume's own axes, for a file that does not say where it was pointing.
 *
 * The planes are then the acquisition's rather than the patient's, and calling
 * them axial, coronal and sagittal is a guess — which is why the dialog says as
 * much when it has to fall back to these.
 */
export const ACQUISITION_FRAMES: Record<'axial' | 'coronal' | 'sagittal', Frame> = {
  axial: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  coronal: { u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0] },
  sagittal: { u: [0, 1, 0], v: [0, 0, -1], n: [-1, 0, 0] }
}

/** A direction in the volume's axes, said in the patient's. */
export function toPatient(header: ImageHeader, direction: Vec3): Vec3 | null {
  const cosines = header.imageOrientation
  if (cosines === null) return null

  const row: Vec3 = [cosines[0], cosines[1], cosines[2]]
  const column: Vec3 = [cosines[3], cosines[4], cosines[5]]
  const slice = cross(row, column)
  return [
    row[0] * direction[0] + column[0] * direction[1] + slice[0] * direction[2],
    row[1] * direction[0] + column[1] * direction[1] + slice[1] * direction[2],
    row[2] * direction[0] + column[2] * direction[1] + slice[2] * direction[2]
  ]
}
