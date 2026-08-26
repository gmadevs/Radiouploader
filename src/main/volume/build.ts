import { blackSamples, cropBoundsOf, cropSamples, croppedPosition, keepsWholeImage, type ImageHeader } from '@shared/dicomImage'
import type { MaskRect, Stack } from '@shared/types'
import { readStoredSamples } from '../preview'
import type { Volume } from './reformat'

/**
 * Turning a stack of images into a volume that can be cut another way.
 *
 * The volume stays in the main process and never crosses the bridge: a chest CT
 * at half a millimetre is hundreds of megabytes, and the bridge carries
 * preview-sized frames precisely so that it does not have to carry this.
 *
 * Everything is checked before anything is read. A stack that cannot make a
 * volume says why — spacing that jumps, images of different sizes, colour — and
 * the answer is the same shape as the reason, so the user is told rather than
 * shown a reformat built on an assumption that did not hold.
 */

/** Bigger than this and the volume is refused rather than allocated. */
const MAX_BYTES = 512 * 1024 * 1024

/** Slice gaps this far from the usual one mean a slice is missing or the geometry is not a stack. */
const SPACING_TOLERANCE = 0.1

export interface BuiltVolume {
  volume: Volume
  /** The instance the derived images inherit their tags from. */
  sourcePath: string
  sourceFrame: number
  /** Kept so a projection can stay in the parent's units without converting the volume. */
  header: ImageHeader
}

/**
 * How fine a reformat of this volume is: the finest the volume itself is.
 *
 * Not a choice the dialog offers. Anything coarser throws away data that is
 * already in memory, and anything finer invents it.
 */
export function pixelSpacingOf(built: BuiltVolume): number {
  return Math.min(built.volume.spacing.x, built.volume.spacing.y)
}

export class VolumeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VolumeError'
  }
}

/** Millimetres between slices, from the positions the ingest already worked out. */
function sliceSpacing(locations: (number | null)[]): number {
  if (locations.some((location) => location === null)) {
    throw new VolumeError('These images do not say where they sit, so they cannot be stacked into a volume')
  }
  const sorted = [...(locations as number[])].sort((a, b) => a - b)
  const gaps = sorted.slice(1).map((location, i) => location - sorted[i])
  if (gaps.length === 0) throw new VolumeError('A volume needs more than one image')

  const middle = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
  if (middle <= 0) {
    throw new VolumeError('These images all sit at the same place, so there is no depth to reformat')
  }
  const worst = Math.max(...gaps.map((gap) => Math.abs(gap - middle) / middle))
  if (worst > SPACING_TOLERANCE) {
    throw new VolumeError(
      `The gap between images varies by ${Math.round(worst * 100)}%, so a reformat of them would be stretched where the images are missing`
    )
  }
  return middle
}

/**
 * Blank the stack's masked areas in the samples themselves.
 *
 * A reformat reads pixels, not the mask that will be painted over them at
 * anonymisation, so without this a banner blanked on the parent would come
 * back through the derived series it was cut out of.
 */
function blank(
  samples: Int16Array | Uint16Array | Uint8Array,
  header: ImageHeader,
  masks: readonly MaskRect[],
  window: { centre: number; width: number } | null
): void {
  if (masks.length === 0) return
  const [fill] = blackSamples(header, window, samples)

  for (const mask of masks) {
    const left = Math.min(Math.max(Math.round(mask.x * header.columns), 0), header.columns)
    const top = Math.min(Math.max(Math.round(mask.y * header.rows), 0), header.rows)
    const right = Math.min(Math.max(Math.round((mask.x + mask.width) * header.columns), 0), header.columns)
    const bottom = Math.min(Math.max(Math.round((mask.y + mask.height) * header.rows), 0), header.rows)
    for (let y = top; y < bottom; y++) samples.fill(fill, y * header.columns + left, y * header.columns + right)
  }
}

/**
 * Read a stack into a volume.
 *
 * Slices arrive already ordered and already trimmed — this reads what would be
 * uploaded, not what the file happens to contain.
 */
export async function buildVolume(stack: Stack): Promise<BuiltVolume> {
  const slices = stack.slices
  if (slices.length < 3) {
    throw new VolumeError('A reformat needs at least three images to have something to cut through')
  }

  const spacing = { z: sliceSpacing(slices.map((slice) => slice.sliceLocation)), x: 0, y: 0 }

  const first = await readStoredSamples(slices[0].path, slices[0].frame)
  const header = first.header
  if (header.samplesPerPixel !== 1) {
    throw new VolumeError('Only greyscale images can be reformatted; this stack is in colour')
  }
  if (header.pixelSpacing === null) {
    throw new VolumeError('These images do not say how big a pixel is, so a reformat would have no scale')
  }
  if (header.slope <= 0) {
    throw new VolumeError('These images carry a negative rescale, which would turn a maximum into a minimum')
  }
  spacing.x = header.pixelSpacing.column
  spacing.y = header.pixelSpacing.row

  /**
   * The crop is applied here, while the volume is built, for the same reason
   * the masks are: a reformat reads pixels, so a margin cut off the parent
   * would come back through a plane taken across it.
   *
   * What comes out is a header describing the cropped grid — smaller, and with
   * its corner moved — because that is what the derived images are written
   * from. Leaving the parent's own header here would put every reformat of a
   * cropped stack at the position of a corner that was thrown away.
   */
  const wanted = stack.crop ? cropBoundsOf(stack.crop, header.columns, header.rows) : null
  const bounds = wanted && !keepsWholeImage(wanted, header.columns, header.rows) ? wanted : null
  const cropped: ImageHeader = bounds
    ? {
        ...header,
        rows: bounds.rows,
        columns: bounds.columns,
        imagePosition: croppedPosition(header, bounds)
      }
    : header

  const voxels = cropped.rows * cropped.columns * slices.length
  const bytes = voxels * (header.bitsAllocated <= 8 ? 1 : 2)
  if (bytes > MAX_BYTES) {
    throw new VolumeError(
      `This stack would need ${Math.round(bytes / (1024 * 1024))} MB in memory to reformat, which is more than this app will take`
    )
  }

  const samples =
    header.bitsAllocated <= 8
      ? new Uint8Array(voxels)
      : header.signed
        ? new Int16Array(voxels)
        : new Uint16Array(voxels)

  /** What is read from a file, before the crop takes a rectangle out of it. */
  const perSlice = header.rows * header.columns
  const masks = stack.masks ?? []
  // The lowest sample there is: air, background, whatever this modality calls
  // nothing. An oblique plane leaves the volume halfway across the picture and
  // this is what it finds out there.
  let low = Infinity
  const read = first.samples.slice(0, perSlice)
  blank(read, header, masks, stack.window)
  const firstSlice = bounds ? cropSamples(read, header.columns, bounds) : read
  samples.set(firstSlice, 0)
  for (const value of firstSlice) if (value < low) low = value

  const perCropped = cropped.rows * cropped.columns
  for (let i = 1; i < slices.length; i++) {
    const { header: other, samples: whole } = await readStoredSamples(slices[i].path, slices[i].frame)
    // Checked before the crop is taken, so a stack of mixed sizes is caught by
    // the size it really is rather than by the rectangle asked of it.
    if (other.rows !== header.rows || other.columns !== header.columns) {
      throw new VolumeError('The images in this stack are not all the same size, so they do not stack')
    }
    if (other.slope !== header.slope || other.intercept !== header.intercept) {
      throw new VolumeError('The images in this stack are not all in the same units, so a projection of them would not be either')
    }
    const read = whole.slice(0, perSlice)
    blank(read, header, masks, stack.window)
    const frame = bounds ? cropSamples(read, header.columns, bounds) : read
    samples.set(frame, i * perCropped)
    for (const value of frame) if (value < low) low = value
  }

  return {
    volume: {
      samples,
      columns: cropped.columns,
      rows: cropped.rows,
      depth: slices.length,
      spacing,
      low: Number.isFinite(low) ? low : 0
    },
    sourcePath: slices[0].path,
    sourceFrame: slices[0].frame,
    header: cropped
  }
}
