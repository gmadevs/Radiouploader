import type { Study } from '@shared/types'
import { describeInterval } from '@shared/interval'

export interface StudyDraftInput {
  /** Internal Study.id from the ingest tree. */
  studyId: string
  modality: string
  findings: string
  /** Shown under the study; carries the follow-up interval. No HTML. */
  caption: string
  stackIds: string[]
}

export interface PlannedStudy extends StudyDraftInput {
  /**
   * Display order within the case. Position 1 is reserved for the case
   * discussion, so studies start at 2.
   */
  position: number
  intervalDays: number | null
}

/**
 * Order the studies and assign their positions.
 *
 * Real study dates are never sent: the API has no field for them and they are
 * identifying anyway. What survives is the ordering, via `position`, and the
 * interval, via the caption.
 *
 * Returns the studies oldest first, dropping any with nothing selected.
 */
export function planStudies(studies: Study[], drafts: StudyDraftInput[]): PlannedStudy[] {
  const order = new Map(studies.map((study, index) => [study.id, index]))
  const byId = new Map(studies.map((study) => [study.id, study]))

  return drafts
    .filter((draft) => draft.stackIds.length > 0 && byId.has(draft.studyId))
    .sort((a, b) => (order.get(a.studyId) ?? 0) - (order.get(b.studyId) ?? 0))
    .map((draft, index) => ({
      ...draft,
      position: index + 2,
      intervalDays: byId.get(draft.studyId)!.intervalDays
    }))
}

/** Caption suggested for a study, which the user can overwrite. */
export function defaultCaption(study: Study, isOnlyStudy: boolean): string {
  if (isOnlyStudy) return ''
  return describeInterval(study.intervalDays)
}
