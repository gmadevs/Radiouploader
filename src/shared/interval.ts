/**
 * Describe where a study sits on a case timeline.
 *
 * Radiopaedia's study endpoint has no date parameter — the documented fields are
 * modality, findings, position and caption — so the interval is carried in the
 * caption, which is also where a reader looks for it.
 */
export function describeInterval(days: number | null): string {
  if (days === null) return 'Date unknown'
  if (days === 0) return 'Baseline'
  if (days < 31) return `${days} day${days === 1 ? '' : 's'} later`
  if (days < 365) {
    const months = Math.round(days / 30.44)
    return `${months} month${months === 1 ? '' : 's'} later`
  }
  const years = days / 365.25
  const rounded = years < 10 ? years.toFixed(1).replace(/\.0$/, '') : years.toFixed(0)
  return `${rounded} year${rounded === '1' ? '' : 's'} later`
}
