import { describe, expect, it } from 'vitest'
import type { Study } from '@shared/types'
import { addDays, defaultAnchorDate, planStudies } from './uploadPlan'

function study(id: string, intervalDays: number | null): Study {
  return {
    id,
    studyInstanceUid: id,
    studyDescription: null,
    modality: 'MR',
    studyDate: intervalDays === null ? null : addDays('2024-01-15', intervalDays),
    intervalDays,
    series: []
  }
}

const draft = (studyId: string, stackIds = ['s1']) => ({ studyId, modality: 'MRI', findings: '', stackIds })

describe('addDays', () => {
  it('crosses month and leap-year boundaries', () => {
    expect(addDays('2024-01-15', 46)).toBe('2024-03-01')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2024-01-15', -14)).toBe('2024-01-01')
  })
})

describe('planStudies', () => {
  const studies = [study('a', 0), study('b', 46), study('c', 366)]

  it('preserves the real intervals while replacing the real dates', () => {
    const planned = planStudies(studies, [draft('a'), draft('b'), draft('c')], '2020-06-01')
    expect(planned.map((p) => p.studyDate)).toEqual(['2020-06-01', '2020-07-17', '2021-06-02'])
    // The gaps sent match the gaps measured from the originals.
    expect(planned.map((p) => p.intervalDays)).toEqual([0, 46, 366])
  })

  it('sends studies in chronological order regardless of draft order', () => {
    const planned = planStudies(studies, [draft('c'), draft('a'), draft('b')], '2020-06-01')
    expect(planned.map((p) => p.studyId)).toEqual(['a', 'b', 'c'])
  })

  it('skips studies with nothing selected', () => {
    const planned = planStudies(studies, [draft('a'), draft('b', []), draft('c')], '2020-06-01')
    expect(planned.map((p) => p.studyId)).toEqual(['a', 'c'])
  })

  it('places an undated study on the anchor without inventing an interval', () => {
    const planned = planStudies([study('a', 0), study('z', null)], [draft('a'), draft('z')], '2020-06-01')
    const undated = planned.find((p) => p.studyId === 'z')!
    expect(undated.studyDate).toBe('2020-06-01')
    expect(undated.intervalDays).toBeNull()
  })
})

describe('defaultAnchorDate', () => {
  it('lands the most recent study on today', () => {
    const today = new Date('2026-08-18T10:00:00Z')
    const anchor = defaultAnchorDate([study('a', 0), study('b', 366)], today)
    expect(anchor).toBe('2025-08-17')
    expect(addDays(anchor, 366)).toBe('2026-08-18')
  })

  it('uses today itself for a single-study import', () => {
    expect(defaultAnchorDate([study('a', 0)], new Date('2026-08-18T10:00:00Z'))).toBe('2026-08-18')
  })
})
