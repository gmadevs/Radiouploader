import type { Progress } from '@shared/types'
import { fractionDone } from '@shared/transfer'

/**
 * How far along the running job is, as one number for both bars to read.
 *
 * An upload's is its bytes rather than its files: the file counter restarts at
 * every series, and forty localisers weigh what one reconstruction does.
 * Everything else has nothing better than its own count.
 *
 * A phase that counts nothing — the scan, still finding out how many files
 * there are — reports nothing. It used to fill the bar instead, which said the
 * work was over at the moment it started; that was survivable in a bar six
 * pixels tall in a corner and is not in one across the window.
 */
export function fractionOf(progress: Progress | null): number {
  if (progress === null) return 0
  if (progress.transfer) return fractionDone(progress.transfer)
  if (progress.total > 0) return Math.min(1, progress.done / progress.total)
  return 0
}
