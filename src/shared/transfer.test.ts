import { describe, expect, it } from 'vitest'
import { bytesLeft, bytesPerSecond, formatDuration, fractionDone, secondsLeft } from './transfer'
import type { Transfer } from './types'

const MB = 1024 * 1024
const transfer = (over: Partial<Transfer> = {}): Transfer => ({
  sent: 10 * MB,
  skipped: 0,
  total: 100 * MB,
  elapsedMs: 10_000,
  ...over
})

describe('bytesPerSecond', () => {
  it('averages what has gone over the time it took', () => {
    expect(bytesPerSecond(transfer())).toBeCloseTo(MB, 0)
  })

  it('says nothing before the first second or two', () => {
    expect(bytesPerSecond(transfer({ elapsedMs: 400 }))).toBeNull()
    expect(bytesPerSecond(transfer({ sent: 1000 }))).toBeNull()
  })

  // Radiopaedia deduplicates by hash: a file it already holds is never sent,
  // and counting it as sent would report a speed the network never reached.
  it('leaves deduplicated bytes out of the rate', () => {
    expect(bytesPerSecond(transfer({ skipped: 80 * MB }))).toBeCloseTo(MB, 0)
  })
})

describe('secondsLeft', () => {
  it('divides what is left by the rate', () => {
    expect(secondsLeft(transfer())).toBeCloseTo(90, 0)
  })

  it('subtracts deduplicated bytes rather than dividing them', () => {
    expect(secondsLeft(transfer({ skipped: 80 * MB }))).toBeCloseTo(10, 0)
  })

  it('has nothing to say until there is a rate', () => {
    expect(secondsLeft(transfer({ elapsedMs: 100 }))).toBeNull()
  })

  it('never goes negative when more went up than was counted', () => {
    expect(bytesLeft(transfer({ sent: 120 * MB }))).toBe(0)
    expect(secondsLeft(transfer({ sent: 120 * MB }))).toBe(0)
  })
})

describe('fractionDone', () => {
  it('counts deduplicated bytes as done', () => {
    expect(fractionDone(transfer({ sent: 10 * MB, skipped: 40 * MB }))).toBeCloseTo(0.5, 3)
  })

  it('stays inside the bar', () => {
    expect(fractionDone(transfer({ sent: 200 * MB }))).toBe(1)
    expect(fractionDone(transfer({ total: 0 }))).toBe(0)
  })
})

describe('formatDuration', () => {
  it('hedges rather than counting down to the second', () => {
    expect(formatDuration(4)).toBe('a few seconds')
    expect(formatDuration(45)).toBe('under a minute')
    expect(formatDuration(90)).toBe('about 2 minutes')
    expect(formatDuration(60 * 60)).toBe('about 1 hour')
    expect(formatDuration(75 * 60)).toBe('about 1 hour 15 min')
  })

  it('says nothing about a duration that is not one', () => {
    expect(formatDuration(Number.NaN)).toBe('')
  })
})
