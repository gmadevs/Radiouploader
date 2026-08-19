import { describe, expect, it } from 'vitest'
import { encodeForm } from './client'

describe('encodeForm', () => {
  it('encodes the case parameters as a form body', () => {
    const body = encodeForm({ title: 'Acute infarct', system_id: 3, diagnostic_certainty_id: 2 })
    expect(body).toBe('title=Acute+infarct&system_id=3&diagnostic_certainty_id=2')
  })

  it('omits empty values instead of sending null', () => {
    // Radiopaedia's own plugin only sets the parameters that have a value, and
    // a null age or gender has no meaning to the API.
    expect(encodeForm({ title: 'x', age: null, gender: undefined, presentation: '' })).toBe('title=x')
  })

  it('keeps a zero, which is a real value rather than an absent one', () => {
    expect(encodeForm({ position: 0 })).toBe('position=0')
  })

  it('escapes characters that would otherwise break the body', () => {
    const body = encodeForm({ body: '<p>Left & right</p>', caption: '3 months later' })
    expect(body).toContain('body=%3Cp%3ELeft+%26+right%3C%2Fp%3E')
    expect(body).toContain('caption=3+months+later')
  })
})
