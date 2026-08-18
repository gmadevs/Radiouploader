import type { Study } from '@shared/types'

export interface StudyDraftInput {
  /** Internal Study.id from the ingest tree. */
  studyId: string
  modality: string
  findings: string
  stackIds: string[]
}

export interface PlannedStudy extends StudyDraftInput {
  /** ISO yyyy-mm-dd actually sent to Radiopaedia. */
  studyDate: string
  intervalDays: number | null
}

/** Add whole days to an ISO yyyy-mm-dd date. */
export function addDays(isoDate: string, days: number): string {
  const ms = Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Work out the date to send for each study.
 *
 * Real study dates are identifying and the anonymiser blanks them anyway, so
 * they are never sent. What matters clinically is the spacing between studies,
 * so each one is placed at `anchorDate + its interval from the earliest study`.
 * Studies with no readable date fall back to the anchor, which keeps them on the
 * case in their existing order without inventing an interval.
 *
 * Returns the studies in chronological order, dropping any with no selection.
 */
export function planStudies(studies: Study[], drafts: StudyDraftInput[], anchorDate: string): PlannedStudy[] {
  const byId = new Map(studies.map((s) => [s.id, s]))

  return drafts
    .filter((draft) => draft.stackIds.length > 0 && byId.has(draft.studyId))
    .map((draft) => {
      const study = byId.get(draft.studyId)!
      return {
        ...draft,
        intervalDays: study.intervalDays,
        studyDate: addDays(anchorDate, study.intervalDays ?? 0)
      }
    })
    .sort((a, b) => (a.studyDate < b.studyDate ? -1 : a.studyDate > b.studyDate ? 1 : 0))
}

/**
 * Default anchor: place the most recent study on `today` so the whole timeline
 * sits in the past, which is what a reader expects of a published case.
 */
export function defaultAnchorDate(studies: Study[], today = new Date()): string {
  const span = Math.max(0, ...studies.map((s) => s.intervalDays ?? 0))
  return addDays(today.toISOString().slice(0, 10), -span)
}
