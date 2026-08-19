import {
  authorizeViaLoopback,
  buildAuthorization,
  exchangeCode,
  isOobRedirect,
  openAuthorizationPage,
  refresh,
  RADIOPAEDIA_ORIGIN,
  type OAuthConfig,
  type PendingAuthorization,
  type TokenSet
} from './oauth'
import { loadConfig, saveConfig } from './store'

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

  constructor(private config: OAuthConfig) {}

  get usesOutOfBandFlow(): boolean {
    return isOobRedirect(this.config.redirectUri)
  }

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
   * With an https redirect URI the code returns to a loopback listener and this
   * completes the sign-in on its own. With the out-of-band URN there is nowhere
   * for the code to land, so this only opens the browser and the caller must
   * follow up with completeSignIn() once the user has pasted the code.
   */
  async beginSignIn(): Promise<{ needsCode: boolean }> {
    if (!this.usesOutOfBandFlow) {
      this.tokens = await authorizeViaLoopback(this.config)
      await this.persist()
      return { needsCode: false }
    }

    this.pending = buildAuthorization(this.config)
    await openAuthorizationPage(this.pending)
    return { needsCode: true }
  }

  /** Finish the out-of-band flow with the code Radiopaedia displayed. */
  async completeSignIn(code: string): Promise<void> {
    if (!this.pending) throw new Error('Start the sign-in before submitting a code')
    const trimmed = code.trim()
    if (trimmed === '') throw new Error('Paste the authorization code from Radiopaedia')

    this.tokens = await exchangeCode(this.config, trimmed, this.pending.codeVerifier)
    this.pending = null
    await this.persist()
  }

  async signOut(): Promise<void> {
    this.tokens = null
    this.pending = null
    await this.persist()
  }

  private async persist(): Promise<void> {
    const stored = await loadConfig()
    await saveConfig({ ...stored, oauth: this.config, tokens: this.tokens ?? undefined })
  }

  /** Return a valid access token, refreshing it when it is about to expire. */
  async accessToken(): Promise<string> {
    if (!this.tokens) throw new Error('Not signed in to Radiopaedia')
    if (Date.now() < this.tokens.expiresAt) return this.tokens.accessToken

    if (!this.tokens.refreshToken) {
      this.tokens = null
      await this.persist()
      throw new Error('Session expired — please sign in again')
    }
    this.tokens = await refresh(this.config, this.tokens.refreshToken)
    await this.persist()
    return this.tokens.accessToken
  }

  /** Issue an authenticated request against an absolute or API-relative URL. */
  async request(pathOrUrl: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.accessToken()
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : new URL(pathOrUrl, API_BASE).toString()
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    if (!headers.has('Accept')) headers.set('Accept', 'application/json')

    const res = await fetch(url, { ...init, headers })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const hint = res.status === 429 ? 'Rate limited by Radiopaedia — retry in a moment' : res.statusText
      throw new RadiopaediaApiError(res.status, `${res.status} ${hint} (${url})`, body)
    }
    return res
  }

  /**
   * POST a JSON body, exactly as the API reference specifies.
   *
   * Form-encoded bodies and query-string parameters were both tried while
   * chasing `system_id` being ignored, and neither made any difference — so
   * this stays on the documented contract.
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

  /** Create a draft case and return its id. */
  async createCase(draft: CaseDraft): Promise<string> {
    // system_id is required by the API. The picker enforces it too, but a case
    // created without one is awkward to fix afterwards, so refuse here as well.
    if (draft.systemId === null) {
      throw new Error('Choose a system before uploading — Radiopaedia requires one on every case')
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

  /** Move the case out of "uploading" once every series has been attached. */
  async markUploadFinished(caseId: string): Promise<void> {
    await this.request(`cases/${caseId}/mark_upload_finished`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })
  }
}
