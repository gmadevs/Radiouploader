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

/**
 * The quota as a sentence, for the account panel.
 *
 * Null where there is nothing true to say: an account whose details could not
 * be read has a count of nothing, and "0 drafts" is a worse answer than no
 * line at all. A full one says what it stops, since that is the question the
 * number is being read to answer.
 */
export function describeQuota(quota: Quota | null): string | null {
  if (quota === null) return null
  const n = quota.draftCaseCount
  if (quota.allowedDraftCases === null) return `${n} draft ${n === 1 ? 'case' : 'cases'}, with no limit on the account.`
  if (quotaExhausted(quota)) {
    return `${n} of ${quota.allowedDraftCases} drafts used. A new case cannot be created until one is published or deleted on Radiopaedia.`
  }
  return `${n} of ${quota.allowedDraftCases} drafts used.`
}
