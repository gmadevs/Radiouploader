import { describe, expect, it } from 'vitest'
import type { Progress } from '@shared/types'
import { fractionOf } from './progressBar'

const phase = (patch: Partial<Progress>): Progress => ({ phase: 'parsing', done: 0, total: 0, ...patch })

describe('fractionOf', () => {
  it('counts files where files are what there is', () => {
    expect(fractionOf(phase({ done: 5, total: 20 }))).toBe(0.25)
  })

  it('counts an upload in bytes, not in files', () => {
    // Half the bytes gone with nearly every file done: forty localisers weigh
    // what one reconstruction does, and the bar has to say so.
    const progress = phase({
      phase: 'uploading',
      done: 40,
      total: 41,
      transfer: { sent: 25, skipped: 25, total: 100, elapsedMs: 1000 }
    })
    expect(fractionOf(progress)).toBe(0.5)
  })

  it('counts bytes Radiopaedia already held as done', () => {
    const progress = phase({ phase: 'uploading', transfer: { sent: 0, skipped: 80, total: 80, elapsedMs: 10 } })
    expect(fractionOf(progress)).toBe(1)
  })

  it('reports nothing for a phase that has nothing to count yet', () => {
    // The scan, still finding the files. This used to fill the bar.
    expect(fractionOf(phase({ phase: 'scanning', done: 0, total: 0 }))).toBe(0)
  })

  it('is nothing at all when nothing is running', () => {
    expect(fractionOf(null)).toBe(0)
  })

  it('never goes past the end, whatever the counts say', () => {
    expect(fractionOf(phase({ done: 12, total: 10 }))).toBe(1)
  })
})
