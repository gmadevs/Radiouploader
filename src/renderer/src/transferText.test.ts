import { describe, expect, it } from 'vitest'
import type { Transfer } from '@shared/types'
import { describeTransfer, formatRate } from './transferText'

const MB = 1024 * 1024
const transfer = (over: Partial<Transfer> = {}): Transfer => ({
  sent: 10 * MB,
  skipped: 0,
  total: 100 * MB,
  elapsedMs: 10_000,
  ...over
})

describe('formatRate', () => {
  it('keeps a digit where the digit changes the wait', () => {
    expect(formatRate(1.4 * MB)).toBe('1.4 MB/s')
    expect(formatRate(24 * MB)).toBe('24 MB/s')
    expect(formatRate(300 * 1024)).toBe('300 KB/s')
  })
})

describe('describeTransfer', () => {
  it('says how much has gone, how fast and how long is left', () => {
    expect(describeTransfer(transfer())).toBe('10 MB of 100 MB · 1 MB/s · about 2 minutes left')
  })

  // A rate quoted out of the first half-second is one that halves as it is
  // read, and a time remaining computed from it is worse.
  it('quotes no speed before there is one to quote', () => {
    expect(describeTransfer(transfer({ elapsedMs: 300, sent: 1024 }))).toBe('1 KB of 100 MB')
  })

  it('counts what Radiopaedia already held as done, and says so', () => {
    expect(describeTransfer(transfer({ sent: 10 * MB, skipped: 80 * MB }))).toBe(
      '90 MB of 100 MB · 1 MB/s · under a minute left · 80 MB already there'
    )
  })

  it('stops promising seconds once everything has gone', () => {
    expect(describeTransfer(transfer({ sent: 100 * MB, elapsedMs: 20_000 }))).toBe('100 MB of 100 MB · 5 MB/s')
  })
})
