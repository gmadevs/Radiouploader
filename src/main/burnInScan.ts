import { applyWindow } from '@shared/dicomImage'
import type { BurnInFinding, MaskRect, PreviewFrame, Stack } from '@shared/types'
import { findOverlayRegions } from './overlay'
import { imageHeader, readPreviewFrame } from './preview'

/**
 * Run the burnt-in text check over the stacks that are about to be uploaded.
 *
 * Two images per stack rather than all of them: the check has to finish while
 * someone is looking at a dialog, and an overlay that is only on one image of a
 * hundred is not what this finds anyway. It looks at the middle image and the
 * one furthest from it, which is where the anatomy differs most and the overlay
 * does not.
 *
 * Everything here can only add a warning. A stack that comes back without a
 * finding has had nothing noticed in it, which is not a statement about what is
 * in it.
 */

/** Large enough that small print survives the downscale, small enough to be quick. */
const SCAN_EDGE = 512

/** What a reader would see: the window in force, and the inversion applied. */
function luminance(frame: PreviewFrame, stack: Stack): Uint8Array {
  const rgba =
    frame.kind === 'grey' ? applyWindow(frame, stack.window ?? frame.window).rgba : frame.rgba
  const grey = new Uint8Array(frame.width * frame.height)
  for (let i = 0; i < grey.length; i++) {
    const o = i * 4
    // Rec. 601 luma, which is what makes a red annotation as visible as a white one.
    grey[i] = Math.round(0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2])
  }
  return grey
}

/**
 * What the check does not look at.
 *
 * The areas already blanked, and everything the crop is about to throw away. A
 * banner in a margin that is being cut off is not something to warn about, and
 * a warning about text that will not be uploaded is how people learn to click
 * past the ones that matter.
 */
function ignoredAreas(stack: Stack): MaskRect[] {
  const masks = stack.masks ?? []
  const crop = stack.crop
  if (!crop) return masks

  const right = crop.x + crop.width
  const bottom = crop.y + crop.height
  return [
    ...masks,
    { x: 0, y: 0, width: 1, height: crop.y },
    { x: 0, y: bottom, width: 1, height: 1 - bottom },
    { x: 0, y: crop.y, width: crop.x, height: crop.height },
    { x: right, y: crop.y, width: 1 - right, height: crop.height }
  ].filter((rect) => rect.width > 0 && rect.height > 0)
}

async function scanStack(stack: Stack): Promise<BurnInFinding | null> {
  const slices = stack.slices
  if (slices.length === 0) return null

  const middle = Math.floor(slices.length / 2)
  // The image furthest from the middle one, so the anatomy has moved as much as
  // this stack allows.
  const far = middle > slices.length - 1 - middle ? 0 : slices.length - 1

  const header = await imageHeader(slices[middle].path).catch(() => null)
  const declared = header?.burnedInAnnotation?.toUpperCase() === 'YES'

  let frames: PreviewFrame[]
  try {
    frames = await Promise.all(
      (middle === far ? [middle] : [middle, far]).map((index) =>
        readPreviewFrame(slices[index].path, slices[index].frame, SCAN_EDGE)
      )
    )
  } catch {
    // An image that cannot be decoded cannot be checked. Saying nothing here is
    // right: the caller lists it as unchecked either way.
    return declared ? { stackId: stack.id, regions: [], declared, compared: 0 } : null
  }

  const ignore = ignoredAreas(stack)
  const [first, second] = frames
  if (first.width !== second?.width || first.height !== second?.height) {
    const { regions } = findOverlayRegions(luminance(first, stack), null, first.width, first.height, ignore)
    return regions.length > 0 || declared
      ? { stackId: stack.id, regions, declared, compared: 1 }
      : null
  }

  const { regions } = findOverlayRegions(
    luminance(first, stack),
    luminance(second, stack),
    first.width,
    first.height,
    ignore
  )
  return regions.length > 0 || declared
    ? { stackId: stack.id, regions, declared, compared: 2 }
    : null
}

/** Check every stack, and report only the ones something was noticed in. */
export async function scanForBurnIn(stacks: Stack[]): Promise<BurnInFinding[]> {
  const findings: BurnInFinding[] = []
  for (const stack of stacks) {
    const finding = await scanStack(stack)
    if (finding) findings.push(finding)
  }
  return findings
}
