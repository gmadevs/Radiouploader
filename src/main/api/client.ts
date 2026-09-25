import type { CaseSummary } from '@shared/types'
import {
  buildAuthorization,
  codeFrom,
  exchangeCode,
  OAuthError,
  openAuthorizationPage,
  refresh,
  RADIOPAEDIA_ORIGIN,
  type OAuthConfig,
  type PendingAuthorization,
  type TokenSet
} from './oauth'
import { loadConfig, updateConfig } from './store'

const API_BASE = `${RADIOPAEDIA_ORIGIN}/api/v1/`

export interface CaseDraft {
  title: string
  presentation: string
  /** Radiopaedia system id (e.g. central nervous system). */
  systemId: number | null
  diagnosticCertaintyId: number | null
  age: string | null
  gender: 'Male' | 'Female' | null
  body: string | null
}

export interface StudyDraft {
  /** Must be one of Radiopaedia's modality values, or blank. */
  modality: string
  /** HTML; paragraphs wrapped in <p>. */
  findings: string
  /** Display order in the case. Position 1 is the case discussion. */
  position?: number
  /** Plain text, no HTML. */
  caption?: string
}

export interface UserQuota {
  draftCaseCount: number
  /** null means an unlimited allowance, which is how the API reports it. */
  allowedDraftCases: number | null
}

export interface SignInStart {
  /** The authorization page, for opening by hand. */
  url: string
  /** Whether the system took the address. True is not proof a window appeared. */
  opened: boolean
}

/** Thrown for non-2xx API responses, carrying the status so callers can react to 429. */
export class RadiopaediaApiError extends Error {
  constructor(readonly status: number, message: string, readonly body: string) {
    super(message)
    this.name = 'RadiopaediaApiError'
  }
}

export class RadiopaediaClient {
  private tokens: TokenSet | null = null
  /** Set between beginSignIn() and completeSignIn() in the out-of-band flow. */
  private pending: PendingAuthorization | null = null
  /** The refresh in flight, which every request that needs a token waits on. */
  private refreshing: Promise<void> | null = null

  constructor(private config: OAuthConfig) {}

  static async fromStoredConfig(): Promise<RadiopaediaClient | null> {
    const stored = await loadConfig()
    if (!stored.oauth?.clientId) return null
    const client = new RadiopaediaClient(stored.oauth)
    client.tokens = stored.tokens ?? null
    return client
  }

  get isAuthenticated(): boolean {
    return this.tokens !== null
  }

  /**
   * Open the authorization page.
   *
   * Opens the browser if it can and hands back the address either way; the
   * caller follows up with completeSignIn() once the user has pasted the code,
   * or the address the browser was sent on to.
   */
  async beginSignIn(): Promise<SignInStart> {
    this.pending = buildAuthorization(this.config)
    const opened = await openAuthorizationPage(this.pending)
    return { url: this.pending.url, opened }
  }

  /** Finish the sign-in with the code Radiopaedia gave, or the address it was in. */
  async completeSignIn(pasted: string): Promise<void> {
    if (!this.pending) throw new Error('Start the sign-in before submitting a code')
    const code = codeFrom(pasted, this.pending.state)
    if (code === '') throw new Error('Paste the authorisation code from Radiopaedia')

    this.tokens = await exchangeCode(this.config, code, this.pending.codeVerifier)
    this.pending = null
    await this.persist()
  }

  async signOut(): Promise<void> {
    this.tokens = null
    this.pending = null
    await this.persist()
  }

  private async persist(): Promise<void> {
    const tokens = this.tokens ?? undefined
    await updateConfig((stored) => ({ ...stored, oauth: this.config, tokens }))
  }

  /** Forget the tokens, and say so in the words the renderer offers a sign-in for. */
  private async expire(): Promise<never> {
    this.tokens = null
    await this.persist()
    throw new Error('Session expired. Sign in again.')
  }

  /**
   * Swap the refresh token for new tokens, once however many ask.
   *
   * Doorkeeper may rotate the refresh token, so two refreshes racing with the
   * same one end with the second refused — and that refusal used to sign the
   * user out in the middle of an upload that had four requests in flight.
   * A refusal (400, 401) is a token that is spent or revoked, which only a new
   * sign-in fixes; anything else, such as no network, is thrown as it is and
   * leaves the tokens alone.
   */
  private renew(): Promise<void> {
    this.refreshing ??= (async () => {
      const refreshToken = this.tokens?.refreshToken
      if (!refreshToken) return this.expire()
      try {
        this.tokens = await refresh(this.config, refreshToken)
      } catch (error) {
        if (error instanceof OAuthError && (error.status === 400 || error.status === 401)) return this.expire()
        throw error
      }
      await this.persist()
    })().finally(() => (this.refreshing = null))
    return this.refreshing
  }

  /** Return a valid access token, refreshing it when it is about to expire. */
  async accessToken(): Promise<string> {
    if (this.refreshing) await this.refreshing
    if (!this.tokens) throw new Error('Not signed in to Radiopaedia')
    if (Date.now() >= this.tokens.expiresAt) await this.renew()
    return this.tokens!.accessToken
  }

  /**
   * Issue an authenticated request against an absolute or API-relative URL.
   *
   * The token goes to radiopaedia.org and nowhere else, whatever the URL says.
   * A 401 is a token the server no longer takes, whatever its expiry claimed —
   * revoked on the site, or the app's clock wrong — so it is renewed and the
   * request sent once more; a second 401 means a new sign-in, and says so
   * rather than surfacing as a bare status. Resending is safe: a request the
   * server refused as unauthorised is one it did not act on.
   */
  async request(pathOrUrl: string, init: RequestInit = {}): Promise<Response> {
    const target = new URL(pathOrUrl, API_BASE)
    if (target.origin !== RADIOPAEDIA_ORIGIN) {
      throw new Error(`The Radiopaedia token is sent only to radiopaedia.org, not to ${target.origin}`)
    }
    const url = target.toString()

    const send = async (token: string): Promise<Response> => {
      const headers = new Headers(init.headers)
      headers.set('Authorization', `Bearer ${token}`)
      if (!headers.has('Accept')) headers.set('Accept', 'application/json')
      return fetch(url, { ...init, headers })
    }

    const token = await this.accessToken()
    let res = await send(token)
    if (res.status === 401) {
      // Another request may already have renewed it.
      if (this.tokens?.accessToken === token) await this.renew()
      res = await send(await this.accessToken())
      if (res.status === 401) await this.expire()
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const hint = res.status === 429 ? 'Too many requests to Radiopaedia, try again in a moment' : res.statusText
      throw new RadiopaediaApiError(res.status, `${res.status} ${hint} (${url})`, body)
    }
    return res
  }

  /**
   * POST a JSON body, exactly as the API reference specifies.
   *
   * All three deliveries were tried while chasing `system_id` being ignored — a
   * JSON body, a form-encoded body, and query-string parameters as Radiopaedia's
   * own OsiriX plugin sends them. The result is identical every time, so the
   * encoding is not the variable and this stays on the documented contract.
   */
  private async postJson(path: string, payload: unknown): Promise<Record<string, unknown>> {
    const res = await this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    return (await res.json()) as Record<string, unknown>
  }

  async currentUser(): Promise<{ username: string | null; quota: UserQuota | null }> {
    const res = await this.request('users/current')
    const body = (await res.json()) as Record<string, any>
    const quotas = body.quotas
    return {
      // The documented field is `login`; `username` is accepted as a fallback.
      username: typeof body.login === 'string' ? body.login : typeof body.username === 'string' ? body.username : null,
      quota: quotas
        ? {
            draftCaseCount: Number(quotas.draft_case_count ?? 0),
            allowedDraftCases:
              quotas.allowed_draft_cases === null || quotas.allowed_draft_cases === undefined
                ? null
                : Number(quotas.allowed_draft_cases)
          }
        : null
    }
  }

  /**
   * The caller's own cases, newest first, as far back as the API will page.
   *
   * There is no filter parameter, so the whole listing comes down and the
   * caller picks out what it wants. Paging is an opaque cursor carried in an
   * `X-Next-Cursor` header rather than a page number, and a listing that
   * repeats a cursor would page for ever, so a repeat stops it.
   */
  async listCases(): Promise<CaseSummary[]> {
    const cases: CaseSummary[] = []
    const seen = new Set<string>()
    let cursor: string | null = null

    // Radiopaedia's own client stops at 200 pages of 100; so does this.
    for (let page = 0; page < 200; page++) {
      const query = new URLSearchParams({ per_page: '100' })
      if (cursor !== null) query.set('cursor', cursor)

      const res = await this.request(`cases?${query.toString()}`)
      const body = (await res.json()) as Record<string, unknown>[]
      if (!Array.isArray(body) || body.length === 0) break

      for (const item of body) {
        cases.push({
          id: String(item.id),
          title: typeof item.title === 'string' ? item.title : null,
          status: typeof item.status === 'string' ? item.status : null,
          visibility: typeof item.visibility === 'string' ? item.visibility : null,
          updatedAt: typeof item.updated_at === 'string' ? item.updated_at : null
        })
      }

      cursor = res.headers.get('X-Next-Cursor')
      if (cursor === null || cursor === '' || seen.has(cursor)) break
      seen.add(cursor)
    }
    return cases
  }

  /**
   * The cases that can still take images.
   *
   * Only a draft can: Radiopaedia refuses new imaging on a case that has gone
   * for review or been published, and a case that has been deleted on the site
   * simply stops appearing in the listing.
   */
  async draftCases(): Promise<CaseSummary[]> {
    return (await this.listCases()).filter((existing) => existing.status === 'draft')
  }

  /** Create a draft case and return its id. */
  async createCase(draft: CaseDraft): Promise<string> {
    // The reference calls system_id required and the picker enforces it, so it
    // is refused here too rather than sent as null for the server to reject.
    if (draft.systemId === null) {
      throw new Error('Choose a system before uploading. Radiopaedia requires one on every case.')
    }

    const payload = {
      title: draft.title,
      presentation: draft.presentation,
      system_id: draft.systemId,
      diagnostic_certainty_id: draft.diagnosticCertaintyId,
      age: draft.age,
      gender: draft.gender,
      body: draft.body
    }
    const body = await this.postJson('cases', payload)
    const id = body.id
    if (id === undefined || id === null) throw new Error('Radiopaedia did not return a case id')
    return String(id)
  }

  /** Add a study to a case and return its id. */
  async createStudy(caseId: string, draft: StudyDraft): Promise<string> {
    const body = await this.postJson(`cases/${caseId}/studies`, {
      modality: draft.modality,
      findings: draft.findings,
      position: draft.position,
      caption: draft.caption
    })
    const id = body.id
    if (id === undefined || id === null) throw new Error('Radiopaedia did not return a study id')
    return String(id)
  }
}
