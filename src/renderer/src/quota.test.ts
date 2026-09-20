import { describe, expect, it } from 'vitest'
import { describeQuota, quotaExhausted } from './quota'

describe('quotaExhausted', () => {
  it('is true only once the allowance is used up', () => {
    expect(quotaExhausted({ draftCaseCount: 4, allowedDraftCases: 5 })).toBe(false)
    expect(quotaExhausted({ draftCaseCount: 5, allowedDraftCases: 5 })).toBe(true)
    // Radiopaedia can report a count above the allowance after a limit change.
    expect(quotaExhausted({ draftCaseCount: 7, allowedDraftCases: 5 })).toBe(true)
  })

  it('does not block when the quota is unknown or unlimited', () => {
    expect(quotaExhausted(null)).toBe(false)
    // The API reports an uncapped allowance as null, not as a large number.
    expect(quotaExhausted({ draftCaseCount: 120, allowedDraftCases: null })).toBe(false)
  })

  it('blocks an account with a zero allowance', () => {
    expect(quotaExhausted({ draftCaseCount: 0, allowedDraftCases: 0 })).toBe(true)
  })
})

describe('describeQuota', () => {
  it('counts what is used against what is allowed', () => {
    expect(describeQuota({ draftCaseCount: 2, allowedDraftCases: 5 })).toBe('2 of 5 drafts used.')
  })

  it('says what a full quota stops, not only that it is full', () => {
    const full = describeQuota({ draftCaseCount: 5, allowedDraftCases: 5 })
    expect(full).toContain('5 of 5 drafts used.')
    expect(full).toContain('cannot be created')
  })

  it('does not invent a limit for an uncapped account', () => {
    expect(describeQuota({ draftCaseCount: 120, allowedDraftCases: null })).toBe(
      '120 draft cases, with no limit on the account.'
    )
    expect(describeQuota({ draftCaseCount: 1, allowedDraftCases: null })).toBe(
      '1 draft case, with no limit on the account.'
    )
  })

  it('says nothing where the account could not be read', () => {
    expect(describeQuota(null)).toBeNull()
  })
})
