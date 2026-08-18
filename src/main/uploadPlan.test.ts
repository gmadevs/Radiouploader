import { describe, expect, it } from 'vitest'
import type { Study } from '@shared/types'
import { describeInterval } from '@shared/interval'
import { defaultCaption, planStudies } from './uploadPlan'

function study(id: string, intervalDays: number | null): Study {
  return {
    id,
    studyInstanceUid: id,
    studyDescription: null,
    modality: 'MR',
    studyDate: null,
    intervalDays,
    series: []
  }
}

const draft = (studyId: string, stackIds = ['s1']) => ({
  studyId,
  modality: 'MRI',
  findings: '',
  caption: '',
  stackIds
})

describe('describeInterval', () => {
  it('reads as a radiologist would write it', () => {
    expect(describeInterval(0)).toBe('Baseline')
    expect(describeInterval(1)).toBe('1 day later')
    expect(describeInterval(14)).toBe('14 days later')
    expect(describeInterval(46)).toBe('2 months later')
    expect(describeInterval(366)).toBe('1 year later')
    expect(describeInterval(920)).toBe('2.5 years later')
    expect(describeInterval(null)).toBe('Date unknown')
  })
})

describe('planStudies', () => {
  // buildStudies already returns studies oldest first.
  const studies = [study('a', 0), study('b', 46), study('c', 366)]

  it('numbers studies from position 2, leaving 1 for the case discussion', () => {
    const planned = planStudies(studies, [draft('a'), draft('b'), draft('c')])
    expect(planned.map((p) => p.position)).toEqual([2, 3, 4])
  })

  it('keeps chronological order regardless of draft order', () => {
    const planned = planStudies(studies, [draft('c'), draft('a'), draft('b')])
    expect(planned.map((p) => p.studyId)).toEqual(['a', 'b', 'c'])
    expect(planned.map((p) => p.position)).toEqual([2, 3, 4])
  })

  it('skips studies with nothing selected and closes the gap in positions', () => {
    const planned = planStudies(studies, [draft('a'), draft('b', []), draft('c')])
    expect(planned.map((p) => p.studyId)).toEqual(['a', 'c'])
    expect(planned.map((p) => p.position)).toEqual([2, 3])
  })

  it('carries the interval through for the caption', () => {
    const planned = planStudies(studies, [draft('a'), draft('c')])
    expect(planned.map((p) => p.intervalDays)).toEqual([0, 366])
  })
})

describe('defaultCaption', () => {
  it('leaves a single-study case uncaptioned', () => {
    expect(defaultCaption(study('a', 0), true)).toBe('')
  })

  it('describes the follow-up interval when there is more than one study', () => {
    expect(defaultCaption(study('a', 0), false)).toBe('Baseline')
    expect(defaultCaption(study('b', 366), false)).toBe('1 year later')
  })
})
