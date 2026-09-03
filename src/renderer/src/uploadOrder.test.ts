import { describe, expect, it } from 'vitest'
import type { StackEntry } from './burnIn'
import { uploadOrder } from './uploadOrder'

function entry(studyId: string, seriesId: string, stackId: string): StackEntry {
  return {
    stack: { id: stackId } as StackEntry['stack'],
    label: stackId,
    modality: 'MR',
    heading: `${studyId} · ${seriesId}`,
    studyId,
    seriesId,
    study: studyId,
    series: seriesId
  }
}

describe('uploadOrder', () => {
  it('keeps the order the entries arrived in, which is the order the case gets', () => {
    const order = uploadOrder([
      entry('s1', 'a', 'a1'),
      entry('s1', 'b', 'b1'),
      entry('s2', 'c', 'c1')
    ])
    expect(order.map((study) => study.studyId)).toEqual(['s1', 's2'])
    expect(order[0].groups.map((group) => group.seriesId)).toEqual(['a', 'b'])
    expect(order[1].groups.map((group) => group.seriesId)).toEqual(['c'])
  })

  it('holds the stacks of one split series together in a single group', () => {
    const order = uploadOrder([
      entry('s1', 'a', 'a1'),
      entry('s1', 'a', 'a2'),
      entry('s1', 'b', 'b1')
    ])
    expect(order[0].groups).toHaveLength(2)
    expect(order[0].groups[0].entries.map((e) => e.stack.id)).toEqual(['a1', 'a2'])
  })

  it('says nothing about an empty selection', () => {
    expect(uploadOrder([])).toEqual([])
  })
})
