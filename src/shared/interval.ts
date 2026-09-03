/**
 * Describe where a study sits on a case timeline.
 *
 * Radiopaedia's study endpoint has no date parameter — the documented fields are
 * modality, findings, position and caption — so the interval is carried in the
 * caption, which is also where a reader looks for it.
 */
export function describeInterval(days: number | null, isBaseline = true): string {
  if (days === null) return 'Date unknown'
  // Two studies of one day are both nought days from the earliest, and only one
  // of them is the baseline. Calling the second one that would put the same
  // word under both halves of a same-day comparison — the CT and the MR that
  // followed it — and lose the only thing the caption had to say about them.
  if (days === 0) return isBaseline ? 'Baseline' : 'Same day'
  if (days < 31) return `${days} day${days === 1 ? '' : 's'} later`
  if (days < 365) {
    const months = Math.round(days / 30.44)
    return `${months} month${months === 1 ? '' : 's'} later`
  }
  const years = days / 365.25
  const rounded = years < 10 ? years.toFixed(1).replace(/\.0$/, '') : years.toFixed(0)
  return `${rounded} year${rounded === '1' ? '' : 's'} later`
}

/**
 * A time of day as a clock reads it, from seconds since midnight.
 *
 * Shown only where it settles something — two studies of the same date, where
 * the date alone does not say which came first.
 */
export function clockTime(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null
  const minutes = Math.floor(seconds / 60)
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
