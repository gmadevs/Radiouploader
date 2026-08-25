import { describe, expect, it } from 'vitest'
import { dot, type Vec3 } from '@shared/geometry'
import type { ImageHeader } from '@shared/dicomImage'
import { anatomicalFrames, toPatient } from './orientation'

/** Whole numbers, and no negative zero to trip an equality on. */
const whole = (values: number[]): number[] => values.map((value) => Math.round(value) || 0)

/** Only the orientation matters here; the rest of the header is scenery. */
function header(orientation: number[] | null): ImageHeader {
  return {
    rows: 4,
    columns: 4,
    samplesPerPixel: 1,
    bitsAllocated: 16,
    signed: false,
    planarConfiguration: 0,
    photometric: 'MONOCHROME2',
    slope: 1,
    intercept: 0,
    windowCentre: null,
    windowWidth: null,
    frames: 1,
    bigEndian: false,
    pixelDataOffset: 0,
    transferSyntax: '1.2.840.10008.1.2.1',
    encapsulated: false,
    burnedInAnnotation: null,
    pixelSpacing: { row: 1, column: 1 },
    imagePosition: [0, 0, 0],
    imageOrientation: orientation
  }
}

/** Rows across the patient, columns down them: an ordinary axial acquisition. */
const AXIAL = [1, 0, 0, 0, 1, 0]
/**
 * Rows front to back, columns head to foot: a sagittal 3D acquisition, which is
 * how brain FLAIR is run and where the volume's axes stop meaning anything
 * anatomical.
 */
const SAGITTAL_ACQUISITION = [0, 1, 0, 0, 0, -1]

describe('anatomicalFrames', () => {
  it('is the volume’s own axes for an axial acquisition', () => {
    const frames = anatomicalFrames(header(AXIAL))!
    expect(whole(frames.axial.n)).toEqual([0, 0, 1])
    expect(whole(frames.coronal.n)).toEqual([0, 1, 0])
    expect(whole(frames.sagittal.n)).toEqual([-1, 0, 0])
  })

  it('finds the axial plane of a sagittally acquired study', () => {
    // The failure this exists for: the pane labelled Axial showed a profile of
    // a head, because the acquired plane of a 3D FLAIR is the sagittal one.
    const frames = anatomicalFrames(header(SAGITTAL_ACQUISITION))!
    // Head is -columns here, so the axial plane looks along -y of the volume.
    expect(whole(frames.axial.n)).toEqual([0, -1, 0])
    // And the sagittal plane looks along the slices, which run left to right.
    expect(whole(frames.sagittal.n)).toEqual([0, 0, 1])
  })

  it('keeps every frame right-handed, whatever the acquisition', () => {
    for (const orientation of [AXIAL, SAGITTAL_ACQUISITION, [1, 0, 0, 0, 0, -1]]) {
      const frames = anatomicalFrames(header(orientation))!
      for (const frame of Object.values(frames)) {
        expect(dot(frame.u, frame.v)).toBeCloseTo(0)
        // u × v = n is what lets an angle on screen turn the planes the way the
        // hand went, in every pane and every acquisition.
        const uv: Vec3 = [
          frame.u[1] * frame.v[2] - frame.u[2] * frame.v[1],
          frame.u[2] * frame.v[0] - frame.u[0] * frame.v[2],
          frame.u[0] * frame.v[1] - frame.u[1] * frame.v[0]
        ]
        expect(dot(uv, frame.n)).toBeCloseTo(1)
      }
    }
  })

  it('says nothing when the file does not say where it was pointing', () => {
    expect(anatomicalFrames(header(null))).toBeNull()
  })
})

describe('toPatient', () => {
  it('reads a volume direction back in the patient’s own axes', () => {
    // Slices of a sagittal acquisition run to the patient's left.
    expect(whole(toPatient(header(SAGITTAL_ACQUISITION), [0, 0, 1])!)).toEqual([-1, 0, 0])
  })

  it('is the identity on an axial acquisition', () => {
    expect(whole(toPatient(header(AXIAL), [0, 0, 1])!)).toEqual([0, 0, 1])
  })
})
