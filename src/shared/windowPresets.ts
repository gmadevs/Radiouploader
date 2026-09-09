import type { WindowLevel } from './types'

/**
 * The windows a CT is read at, as buttons.
 *
 * These are Hounsfield units, which is why they are offered on CT and on
 * nothing else: on an MR the stored values are the scanner's own arbitrary
 * scale, so "80 / 40" names a different picture on every study and a list of
 * fixed numbers would be a list of wrong answers.
 *
 * Widths and centres are the conventional ones — the values a reporting
 * workstation has on its own toolbar — so that a case uploaded from here is
 * windowed the way a reader expects to see it. Each is still only a starting
 * point: the drag is there, and what the user leaves on screen is what gets
 * written to the images.
 */
export interface WindowPreset {
  name: string
  /** What it is for, in the tooltip. */
  hint: string
  window: WindowLevel
}

/** Head first, then chest and abdomen, then bone — the order a study is read in. */
export const CT_WINDOW_PRESETS: readonly WindowPreset[] = [
  { name: 'Brain', hint: 'Brain parenchyma', window: { centre: 40, width: 80 } },
  { name: 'Subdural', hint: 'Extra-axial collections against the skull', window: { centre: 75, width: 200 } },
  { name: 'Stroke', hint: 'Narrow, for early grey–white loss', window: { centre: 40, width: 40 } },
  { name: 'Temporal bone', hint: 'Petrous bone and ossicles', window: { centre: 600, width: 2800 } },
  { name: 'Lung', hint: 'Lung parenchyma', window: { centre: -600, width: 1500 } },
  { name: 'Soft tissue', hint: 'Mediastinum and soft tissues', window: { centre: 50, width: 400 } },
  { name: 'Liver', hint: 'Narrow, for liver lesions', window: { centre: 30, width: 150 } },
  { name: 'Bone', hint: 'Cortex and trabeculae', window: { centre: 400, width: 1800 } }
]

/**
 * Are this series' pixel values Hounsfield units?
 *
 * Only a CT states its values on an absolute scale, so only a CT can be handed
 * a window by number. Anything else — including a CT-derived screenshot saved
 * as a secondary capture, which is why the modality is read rather than assumed
 * from the study — is windowed by dragging and by nothing else.
 */
export function usesHounsfield(modality: string | null): boolean {
  return modality === 'CT'
}

/**
 * Half a unit, which is the roundest a window can be and still be the same one.
 *
 * A window that has been nudged by a drag is no longer the preset, and saying
 * it is would leave a button lit while the picture is not the one it names.
 */
const SAME = 0.5

/** The preset the current window is, if it is one. */
export function matchingPreset(level: WindowLevel | null): WindowPreset | null {
  if (!level) return null
  return (
    CT_WINDOW_PRESETS.find(
      (preset) =>
        Math.abs(preset.window.centre - level.centre) <= SAME && Math.abs(preset.window.width - level.width) <= SAME
    ) ?? null
  )
}
