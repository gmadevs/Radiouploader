import path from 'node:path'
import { downscale, downscaleGrey, type DecodedFrame, type GreyFrame } from '@shared/dicomImage'
import type {
  PreviewFrame,
  ReformatPlan,
  ReformatRequestMessage,
  Series,
  Stack,
  Study,
  VolumeInfo,
  WindowLevel
} from '@shared/types'
import { keptSlices } from '@shared/selection'
import { session } from '../session'
import { buildVolume, pixelSpacingOf, VolumeError, type BuiltVolume } from './build'
import { ACQUISITION_FRAMES, anatomicalFrames } from './orientation'
import { defaultWindow } from './window'
import { extent, reformatSlice, slabOffsets } from './reformat'
import { describePlan, writeReformatted } from './write'

/**
 * The reformatting session: one volume at a time, held here and nowhere else.
 *
 * A volume is the largest thing this app ever has in memory, so exactly one is
 * kept and it is dropped as soon as the window that asked for it closes. None
 * of it crosses the bridge — the renderer asks for reformatted frames the same
 * size it asks for any other preview.
 */

interface OpenVolume {
  stackId: string
  built: BuiltVolume
  parent: { study: Study; series: Series; stack: Stack }
  /** Worked out on first use and kept, so it does not move between images. */
  window?: WindowLevel
}

let open: OpenVolume | null = null

function find(stackId: string): OpenVolume['parent'] {
  for (const study of session.ingest?.studies ?? []) {
    for (const series of study.series) {
      for (const stack of series.stacks) {
        if (stack.id === stackId) return { study, series, stack }
      }
    }
  }
  throw new VolumeError('That series is no longer part of this import')
}

/** Read a stack into a volume and report what can be made from it. */
export async function openVolume(stackId: string): Promise<VolumeInfo> {
  const parent = find(stackId)
  // Trimmed, and without the images dropped one at a time, because a reformat
  // of images that will not be uploaded would be a reformat of something nobody
  // else can see. A hole left in the middle by a drop is not smoothed over
  // here: buildVolume measures the gaps and refuses a stack that has one.
  const stack: Stack = { ...parent.stack, slices: keptSlices(parent.stack) }

  const built = await buildVolume(stack)
  open = { stackId, built, parent }

  const anatomical = anatomicalFrames(built.header)
  return {
    columns: built.volume.columns,
    rows: built.volume.rows,
    depth: built.volume.depth,
    spacing: built.volume.spacing,
    size: extent(built.volume),
    finestSpacing: pixelSpacingOf(built),
    frames: anatomical ?? ACQUISITION_FRAMES,
    anatomical: anatomical !== null,
    colour: built.volume.channels > 1
  }
}

/**
 * The window a reformat opens with, worked out once when the volume is built.
 *
 * Once, because it must not move under the user: recomputing it per image would
 * make every step through the stack a different picture.
 */
function openingWindow(): WindowLevel {
  if (open === null) throw new VolumeError('No volume is open to reformat')
  open.window ??= defaultWindow(open.built.volume, open.built.header, open.parent.stack.window)
  return open.window
}

/** One reformatted image, at preview size. */
export function previewReformat(request: ReformatRequestMessage, maxEdge: number): PreviewFrame {
  if (open === null) throw new VolumeError('No volume is open to reformat')

  const image = reformatSlice(open.built.volume, { ...request, pixelSpacing: pixelSpacingOf(open.built) })
  const { slope, intercept, photometric } = open.built.header

  // Colour arrives as pixels rather than as values to be windowed: there is no
  // window to apply to RGB, and a slider offering one would be a control that
  // does nothing.
  if (image.channels > 1) {
    const rgba = new Uint8ClampedArray(image.width * image.height * 4)
    for (let i = 0; i < image.width * image.height; i++) {
      rgba[i * 4] = image.samples[i * 3]
      rgba[i * 4 + 1] = image.samples[i * 3 + 1]
      rgba[i * 4 + 2] = image.samples[i * 3 + 2]
      rgba[i * 4 + 3] = 255
    }
    const frame: DecodedFrame = { width: image.width, height: image.height, rgba }
    return { kind: 'colour', compressed: false, ...downscale(frame, maxEdge) }
  }

  const values = new Float32Array(image.samples.length)
  for (let i = 0; i < values.length; i++) values[i] = image.samples[i] * slope + intercept

  const frame: GreyFrame = {
    width: image.width,
    height: image.height,
    values,
    window: openingWindow(),
    invert: photometric === 'MONOCHROME1'
  }
  return { kind: 'grey', compressed: false, ...downscaleGrey(frame, maxEdge) }
}

/** How many images a plan would produce, which is what the dialog counts. */
export function planCount(plan: ReformatPlan): number {
  if (open === null) return 0
  return slabOffsets(open.built.volume, plan.frame, plan.spacing).length
}

/**
 * Write the reformat as a series and put it in the tree beside its parent.
 *
 * It goes into the session's own tree as well as being returned, because that
 * tree is the one anonymisation and upload read: a series the renderer knew
 * about and the main process did not would simply never be uploaded.
 */
export async function commitReformat(plan: ReformatPlan): Promise<{ studyId: string; series: Series }> {
  if (open === null) throw new VolumeError('No volume is open to reformat')

  const workDir = await session.workDir()
  const outputDir = path.join(workDir, 'reformatted', `${Date.now()}`)
  const colour = open.built.volume.channels > 1
  const series = await writeReformatted(open.built, plan, outputDir, {
    seriesId: open.parent.series.id,
    seriesNumber: open.parent.series.seriesNumber,
    description: open.parent.series.description,
    modality: open.parent.series.modality,
    // RGB has no window, and writing one onto it would be a tag that lies.
    window: colour ? null : (plan.window ?? openingWindow())
  })

  const study = open.parent.study
  study.series.splice(study.series.indexOf(open.parent.series) + 1, 0, series)
  return { studyId: study.id, series }
}

/** Let the volume go. It is the biggest thing this process ever holds. */
export function closeVolume(): void {
  open = null
}

export { VolumeError, describePlan }
