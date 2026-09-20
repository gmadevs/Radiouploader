import { describe, expect, it } from 'vitest'
import { nextInCycle } from './focusTrap'

const row = ['erase', 'crop', 'contrast', 'done']

describe('nextInCycle', () => {
  it('walks forwards and back', () => {
    expect(nextInCycle(row, 'crop', false)).toBe('contrast')
    expect(nextInCycle(row, 'crop', true)).toBe('erase')
  })

  it('comes round the end rather than walking off it', () => {
    expect(nextInCycle(row, 'done', false)).toBe('erase')
    expect(nextInCycle(row, 'erase', true)).toBe('done')
  })

  it('pulls focus back in from outside, at the end it was heading for', () => {
    expect(nextInCycle(row, null, false)).toBe('erase')
    expect(nextInCycle(row, null, true)).toBe('done')
    // Something inside the dialog that is not itself a stop — the dialog box.
    expect(nextInCycle(row, 'the dialog', false)).toBe('erase')
  })

  it('stays put on the only control there is', () => {
    expect(nextInCycle(['close'], 'close', false)).toBe('close')
    expect(nextInCycle(['close'], 'close', true)).toBe('close')
  })

  it('has nowhere to go in an empty dialog', () => {
    expect(nextInCycle([], null, false)).toBeNull()
  })
})
