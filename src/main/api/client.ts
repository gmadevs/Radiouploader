import { authorize, refresh, RADIOPAEDIA_ORIGIN, type OAuthConfig, type TokenSet } from './oauth'
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
  modality: string
  findings: string
  /** ISO yyyy-mm-dd. Defaults to today. */
  studyDate?: string
  caption?: string
}

export interface UserQuota {
  draftCaseCount: number
  allowedDraftCases: number
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

  /** Run the interactive sign-in and persist the resulting tokens. */
  async signIn(): Promise<void> {
    this.tokens = await authorize(this.config)
    await this.persist()
  }

  async signOut(): Promise<void> {
    this.tokens = null
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
      username: typeof body.username === 'string' ? body.username : null,
      quota: quotas
        ? {
            draftCaseCount: Number(quotas.draft_case_count ?? 0),
            allowedDraftCases: Number(quotas.allowed_draft_cases ?? 0)
          }
        : null
    }
  }

  /** Create a draft case and return its id. */
  async createCase(draft: CaseDraft): Promise<string> {
    const body = await this.postJson('cases', {
      title: draft.title,
      presentation: draft.presentation,
      system_id: draft.systemId,
      diagnostic_certainty_id: draft.diagnosticCertaintyId,
      age: draft.age,
      gender: draft.gender,
      body: draft.body
    })
    const id = body.id
    if (id === undefined || id === null) throw new Error('Radiopaedia did not return a case id')
    return String(id)
  }

  /** Add a study to a case and return its id. */
  async createStudy(caseId: string, draft: StudyDraft): Promise<string> {
    const body = await this.postJson(`cases/${caseId}/studies`, {
      modality: draft.modality,
      findings: draft.findings,
      study_date: draft.studyDate ?? new Date().toISOString().slice(0, 10),
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
