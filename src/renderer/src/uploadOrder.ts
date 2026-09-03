import type { StackEntry } from './burnIn'

/**
 * The selection read back as the case will be: the order the series are posted
 * in, which is the order they appear in on Radiopaedia.
 *
 * Grouped by series rather than listed flat, because a split series is several
 * uploads that came from one acquisition and they move together — dragging the
 * b=1000 stack out from between its neighbours would be a reorder nobody could
 * express in the tree the rest of the app reads.
 *
 * Kept out of the dialog so the grouping can be tested; what it must get right
 * is that the groups come out in the order the entries did, since that order is
 * the only statement the app makes about the case.
 */

export interface OrderGroup {
  studyId: string
  seriesId: string
  /** The series name, which every entry in the group shares. */
  name: string
  entries: StackEntry[]
}

export interface OrderStudy {
  studyId: string
  heading: string
  groups: OrderGroup[]
}

/** Group consecutive entries by series, and those by study. */
export function uploadOrder(entries: readonly StackEntry[]): OrderStudy[] {
  const studies: OrderStudy[] = []
  for (const entry of entries) {
    let study = studies[studies.length - 1]
    if (study?.studyId !== entry.studyId) {
      study = { studyId: entry.studyId, heading: entry.study, groups: [] }
      studies.push(study)
    }
    const last = study.groups[study.groups.length - 1]
    if (last?.seriesId === entry.seriesId) last.entries.push(entry)
    else study.groups.push({ studyId: entry.studyId, seriesId: entry.seriesId, name: entry.series, entries: [entry] })
  }
  return studies
}
