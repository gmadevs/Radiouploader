import type { WindowLevel } from '@shared/types'
import type { Volume } from './reformat'

/**
 * Choosing the window a reformat is first shown with.
 *
 * The file's own WindowCenter and WindowWidth are preferred — they are what the
 * scanner or the radiographer chose, and on a CT they are usually the right
 * lung or soft-tissue window. But they are not always about the pixels that are
 * actually here: a 3D FLAIR came through with a window so far below its own
 * values that every voxel of brain was above the top of it, and the reformat
 * was a white cut-out of a head on black.
 *
 * So the file's window is used unless it hides the data, and "hides" is
 * measured rather than guessed: if hardly any of the volume falls inside it,
 * the volume's own spread is used instead. Either way the dialog lets it be
 * changed, and what the user chooses is what gets written.
 */

/**
 * How much of the volume's own spread the window has to cover to be believed.
 *
 * Counting voxels inside the window is the obvious measure and the wrong one:
 * on the FLAIR that prompted this, the window sat over the air around the head,
 * so a quarter of the volume was "inside" it while every voxel of brain was
 * above the top and white.
 */
const ENOUGH_OVERLAP = 0.2

/** Ignore the extremes: a handful of hot voxels should not set the width. */
const LOW = 0.01
const HIGH = 0.99

/** Every nth voxel, so a 300 MB volume costs a few milliseconds to measure. */
function subsample(volume: Volume, slope: number, intercept: number): Float32Array {
  const total = volume.samples.length
  const wanted = Math.min(total, 200_000)
  const stride = Math.max(1, Math.floor(total / wanted))
  const taken = new Float32Array(Math.ceil(total / stride))
  for (let i = 0, j = 0; i < total; i += stride, j++) taken[j] = volume.samples[i] * slope + intercept
  return taken
}

function percentile(sorted: Float32Array, fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))))
  return sorted[index]
}

/**
 * The window to open a reformat with, given what the file says and what the
 * volume actually contains.
 */
export function defaultWindow(
  volume: Volume,
  header: { windowCentre: number | null; windowWidth: number | null; slope: number; intercept: number },
  chosen: WindowLevel | null
): WindowLevel {
  // A window the user picked in the viewer is a decision, not a suggestion.
  if (chosen) return chosen

  const values = subsample(volume, header.slope, header.intercept)
  const sorted = values.slice().sort()
  const low = percentile(sorted, LOW)
  const high = percentile(sorted, HIGH)

  const stated =
    header.windowCentre !== null && header.windowWidth !== null && header.windowWidth > 0
      ? { centre: header.windowCentre, width: header.windowWidth }
      : null

  if (stated !== null) {
    const spread = high - low
    // Nothing to compare against: one value throughout, or a volume of air.
    if (!Number.isFinite(spread) || spread <= 0) return stated
    const overlap =
      Math.max(0, Math.min(stated.centre + stated.width / 2, high) - Math.max(stated.centre - stated.width / 2, low)) /
      spread
    if (overlap >= ENOUGH_OVERLAP) return stated
  }

  if (!Number.isFinite(low) || high <= low) return { centre: 128, width: 256 }
  return { centre: (low + high) / 2, width: high - low }
}
