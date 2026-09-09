import type { Transfer } from './types'

/**
 * How fast the upload is going, and how long it has left.
 *
 * The rate is the average over the whole run rather than the last second or
 * two. A per-file rate swings by an order of magnitude between a 40 KB
 * localiser and a 12 MB reconstruction, and an estimate that jumps between
 * "twenty seconds" and "four minutes" while you watch it is one nobody can plan
 * around; the average settles instead of chasing.
 *
 * Bytes Radiopaedia already had — it deduplicates by hash, so a re-upload sends
 * almost nothing — are counted as done but never as sent. Counting them as sent
 * would report a speed the network never reached.
 */

/**
 * Before this much has gone, there is no rate worth quoting: the first file
 * finishes after the TCP and TLS handshakes are paid for, so its apparent speed
 * is a fraction of the real one.
 */
const ENOUGH_MS = 1500
const ENOUGH_BYTES = 256 * 1024

/** Bytes a second, or null while it is too early to say. */
export function bytesPerSecond(transfer: Transfer): number | null {
  if (transfer.elapsedMs < ENOUGH_MS || transfer.sent < ENOUGH_BYTES) return null
  return (transfer.sent * 1000) / transfer.elapsedMs
}

/** What is left to send: the total less what has gone and what was deduplicated. */
export function bytesLeft(transfer: Transfer): number {
  return Math.max(0, transfer.total - transfer.sent - transfer.skipped)
}

/**
 * Seconds to go, or null when there is no rate to divide by yet.
 *
 * Deduplicated bytes are subtracted from what is left rather than divided by
 * the rate, since they cost a hash comparison and no time at all.
 */
export function secondsLeft(transfer: Transfer): number | null {
  const rate = bytesPerSecond(transfer)
  if (rate === null || rate <= 0) return null
  return bytesLeft(transfer) / rate
}

/**
 * A duration as something to plan around, never as a countdown to the second.
 *
 * The estimate is an average over a network that is not steady, so a figure
 * like "3:47 left" claims a precision it does not have and is wrong within the
 * second. Rounded and hedged says the same thing honestly.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  if (seconds < 10) return 'a few seconds'
  if (seconds < 60) return 'under a minute'

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? '' : 's'}`

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  const hourPart = `${hours} hour${hours === 1 ? '' : 's'}`
  return rest === 0 ? `about ${hourPart}` : `about ${hourPart} ${rest} min`
}

/** How much of the upload is behind it, 0–1, counting deduplicated bytes as done. */
export function fractionDone(transfer: Transfer): number {
  if (transfer.total <= 0) return 0
  return Math.min(1, (transfer.sent + transfer.skipped) / transfer.total)
}
