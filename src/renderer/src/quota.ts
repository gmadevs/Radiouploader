export interface Quota {
  draftCaseCount: number
  allowedDraftCases: number
}

export interface AccountState {
  authenticated: boolean
  username: string | null
  quota: Quota | null
}

/**
 * True when the account cannot hold another draft case.
 *
 * An allowance of 0 means "not reported" rather than "none permitted", so it
 * never blocks; Radiopaedia can also report a count above the allowance after a
 * limit change, which does.
 */
export function quotaExhausted(quota: Quota | null): boolean {
  return quota !== null && quota.allowedDraftCases > 0 && quota.draftCaseCount >= quota.allowedDraftCases
}
