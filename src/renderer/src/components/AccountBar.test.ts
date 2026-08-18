import { describe, expect, it } from 'vitest'
import { quotaExhausted } from './AccountBar'

describe('quotaExhausted', () => {
  it('is true only once the allowance is used up', () => {
    expect(quotaExhausted({ draftCaseCount: 4, allowedDraftCases: 5 })).toBe(false)
    expect(quotaExhausted({ draftCaseCount: 5, allowedDraftCases: 5 })).toBe(true)
    // Radiopaedia can report a count above the allowance after a limit change.
    expect(quotaExhausted({ draftCaseCount: 7, allowedDraftCases: 5 })).toBe(true)
  })

  it('does not block when the quota is unknown or unlimited', () => {
    expect(quotaExhausted(null)).toBe(false)
    expect(quotaExhausted({ draftCaseCount: 12, allowedDraftCases: 0 })).toBe(false)
  })
})
