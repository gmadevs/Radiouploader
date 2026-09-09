import type { Transfer } from '@shared/types'
import { bytesPerSecond, formatDuration, secondsLeft } from '@shared/transfer'
import { formatSize } from './stackDetail'

/**
 * The line under the upload bar: how much has gone, how fast, and how long is
 * left.
 *
 * Each part appears only once it means something. There is no rate for the
 * first second or two of a transfer — the handshakes are paid for out of it —
 * and quoting one then would put a number on screen that halves as you watch
 * it, followed by a time remaining computed from it.
 */

/**
 * A speed at the precision it is worth reading.
 *
 * Finer than the file sizes elsewhere in the app on purpose: a study is either
 * a few hundred megabytes or it is not, but the difference between 1 MB/s and
 * 1.9 MB/s is the difference between a wait and a coffee.
 */
export function formatRate(perSecond: number): string {
  const mb = perSecond / (1024 * 1024)
  if (mb >= 10) return `${Math.round(mb)} MB/s`
  if (mb >= 1) return `${Math.round(mb * 10) / 10} MB/s`
  return `${Math.max(1, Math.round(perSecond / 1024))} KB/s`
}

export function describeTransfer(transfer: Transfer): string {
  const parts = [`${formatSize(transfer.sent + transfer.skipped)} of ${formatSize(transfer.total)}`]

  const rate = bytesPerSecond(transfer)
  if (rate !== null) parts.push(formatRate(rate))

  const left = secondsLeft(transfer)
  // Nothing left to send is not "a few seconds": the images are up and what is
  // happening now is Radiopaedia attaching them to the study.
  if (left !== null && left > 0) parts.push(`${formatDuration(left)} left`)

  // Radiopaedia deduplicates by hash. Uploading a series it already holds
  // finishes in no time at all, and without a word for it that reads as a bar
  // that has broken rather than as work that was already done.
  if (transfer.skipped > 0) parts.push(`${formatSize(transfer.skipped)} already there`)

  return parts.join(' · ')
}
