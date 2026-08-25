import { describe, expect, it } from 'vitest'
import { AGE_OPTIONS } from './radiopaedia'

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
