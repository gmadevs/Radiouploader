export interface Quota {
  draftCaseCount: number
  /** null means unlimited, which is how Radiopaedia reports an uncapped account. */
  allowedDraftCases: number | null
}

export interface AccountState {
  authenticated: boolean
  username: string | null
  quota: Quota | null
}

/**
 * True when the account cannot hold another draft case.
 *
 * A null allowance means unlimited and never blocks. Radiopaedia can report a
 * count above the allowance after a limit change, which does block.
 */
export function quotaExhausted(quota: Quota | null): boolean {
  if (quota === null || quota.allowedDraftCases === null) return false
  return quota.draftCaseCount >= quota.allowedDraftCases
}
