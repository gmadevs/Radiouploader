import { describe, expect, it } from 'vitest'
import { AGE_OPTIONS, nearestAgeOption } from './radiopaedia'

describe('AGE_OPTIONS', () => {
  it('runs one year at a time to 18, then five at a time', () => {
    expect(AGE_OPTIONS.slice(0, 3)).toEqual(['1 year', '2 years', '3 years'])
    expect(AGE_OPTIONS).toContain('18 years')
    expect(AGE_OPTIONS).not.toContain('19 years')
    expect(AGE_OPTIONS).toContain('20 years')
    expect(AGE_OPTIONS).not.toContain('21 years')
    expect(AGE_OPTIONS.at(-1)).toBe('100 years')
  })

  it('writes every value the way the site does, singular at one', () => {
    for (const age of AGE_OPTIONS.slice(1)) expect(age).toMatch(/^\d+ years$/)
  })
})

describe('nearestAgeOption', () => {
  it('keeps a whole year below eighteen', () => {
    expect(nearestAgeOption(7)).toBe('7 years')
    expect(nearestAgeOption(7.4)).toBe('7 years')
    expect(nearestAgeOption(7.6)).toBe('8 years')
    expect(nearestAgeOption(1)).toBe('1 year')
  })

  it('goes to the nearest five above it', () => {
    expect(nearestAgeOption(42)).toBe('40 years')
    expect(nearestAgeOption(43)).toBe('45 years')
    expect(nearestAgeOption(67)).toBe('65 years')
  })

  it('gives a tie to the younger value, which claims less', () => {
    // 19 sits exactly between the last whole year and the first five.
    expect(nearestAgeOption(19)).toBe('18 years')
    expect(nearestAgeOption(22.5)).toBe('20 years')
  })

  it('says nothing rather than inventing an age it cannot express', () => {
    // The list starts at a year, and a six-month-old is not a one-year-old.
    expect(nearestAgeOption(0.5)).toBeNull()
    expect(nearestAgeOption(0)).toBeNull()
    expect(nearestAgeOption(Number.NaN)).toBeNull()
  })

  it('stops at the end of the list rather than running past it', () => {
    expect(nearestAgeOption(140)).toBe('100 years')
  })
})
