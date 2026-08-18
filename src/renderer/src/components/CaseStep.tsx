import { useEffect, useState } from 'react'
import type { Study } from '@shared/types'

export interface StudyForm {
  modality: string
  findings: string
}

export interface CaseForm {
  title: string
  presentation: string
  age: string
  gender: '' | 'Male' | 'Female'
  body: string
  /** Date given to the earliest study; the rest keep their real spacing. */
  anchorDate: string
  /** Keyed by Study.id. */
  studies: Record<string, StudyForm>
}

interface AuthState {
  configured: boolean
  authenticated: boolean
  clientId: string | null
  redirectUri: string | null
}

interface Props {
  form: CaseForm
  onChange: (form: CaseForm) => void
  /** Studies that have at least one stack selected, oldest first. */
  studies: Study[]
  warnings: { tag: string; text: string; level: number; count: number }[]
}

/** "3 months later" style label for a follow-up study. */
function describeInterval(days: number | null): string {
  if (days === null) return 'date unknown'
  if (days === 0) return 'baseline'
  if (days < 31) return `${days} day${days === 1 ? '' : 's'} later`
  const months = Math.round(days / 30.44)
  if (days < 365) return `${months} month${months === 1 ? '' : 's'} later`
  const years = days / 365.25
  return `${years.toFixed(years < 10 ? 1 : 0)} years later`
}

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

const MODALITIES = ['CT', 'MRI', 'X-ray', 'Ultrasound', 'Fluoroscopy', 'Angiography', 'Nuclear medicine', 'PET-CT', 'Mammography']

export function CaseStep({ form, onChange, studies, warnings }: Props): React.JSX.Element {
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [user, setUser] = useState<{ username: string | null; quota: { draftCaseCount: number; allowedDraftCases: number } | null } | null>(null)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [redirectUri, setRedirectUri] = useState('http://127.0.0.1:8910/callback')
  const [error, setError] = useState<string | null>(null)

  const refreshAuth = (): void => {
    void window.api.authStatus().then((status) => {
      setAuth(status)
      if (status.clientId) setClientId(status.clientId)
      if (status.redirectUri) setRedirectUri(status.redirectUri)
      if (status.authenticated) void window.api.currentUser().then(setUser).catch(() => setUser(null))
    })
  }

  useEffect(refreshAuth, [])

  const set = <K extends keyof CaseForm>(key: K, value: CaseForm[K]): void => onChange({ ...form, [key]: value })

  return (
    <div style={{ display: 'grid', gap: 20, maxWidth: 780, margin: '0 auto' }}>
      <div className="card">
        <h2>Radiopaedia account</h2>
        {auth?.authenticated ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
            <span className="notice ok">Signed in{user?.username ? ` as ${user.username}` : ''}</span>
            {user?.quota && (
              <span className="muted small">
                {user.quota.draftCaseCount} of {user.quota.allowedDraftCases} draft cases used
              </span>
            )}
            <div style={{ flex: 1 }} />
            <button className="small" onClick={() => void window.api.signOut().then(refreshAuth)}>
              Sign out
            </button>
          </div>
        ) : (
          <div className="rows" style={{ marginTop: 10 }}>
            <p className="muted small" style={{ margin: 0 }}>
              Create an application at radiopaedia.org with scope <code>cases</code> and the redirect URI below, then
              paste its credentials here.
            </p>
            <div className="row2">
              <label className="field">
                Application ID
                <input value={clientId} onChange={(e) => setClientId(e.target.value)} />
              </label>
              <label className="field">
                Client secret
                <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
              </label>
            </div>
            <label className="field">
              Redirect URI (must match the application exactly)
              <input value={redirectUri} onChange={(e) => setRedirectUri(e.target.value)} />
            </label>
            {error && <div className="notice error">{error}</div>}
            <div>
              <button
                className="primary"
                disabled={!clientId || !redirectUri}
                onClick={() => {
                  setError(null)
                  void window.api
                    .configureAuth({ clientId, clientSecret: clientSecret || undefined, redirectUri })
                    .then(() => window.api.signIn())
                    .then(() => refreshAuth())
                    .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                }}
              >
                Sign in with Radiopaedia
              </button>
            </div>
          </div>
        )}
      </div>

      {warnings.length > 0 && (
        <div className="card">
          <h2>Anonymisation warnings</h2>
          <p className="muted small" style={{ marginTop: 4 }}>
            These fields were kept because they carry imaging parameters, but they are free text and could contain
            personal data.
          </p>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            {warnings.slice(0, 8).map((w) => (
              <li key={w.tag}>
                <code>{w.tag}</code> — {w.text} <span style={{ opacity: 0.6 }}>({w.count} images)</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card rows">
        <h2>Case</h2>
        <label className="field">
          Title
          <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Acute middle cerebral artery infarct" />
        </label>
        <label className="field">
          Presentation
          <textarea value={form.presentation} onChange={(e) => set('presentation', e.target.value)} />
        </label>
        <div className="row2">
          <label className="field">
            Age
            <input value={form.age} onChange={(e) => set('age', e.target.value)} placeholder="e.g. 45 years" />
          </label>
          <label className="field">
            Gender
            <select value={form.gender} onChange={(e) => set('gender', e.target.value as CaseForm['gender'])}>
              <option value="">Not stated</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </label>
        </div>
        <label className="field">
          Case discussion
          <textarea value={form.body} onChange={(e) => set('body', e.target.value)} />
        </label>
      </div>

      <div className="card rows">
        <h2>{studies.length > 1 ? `Studies (${studies.length})` : 'Study'}</h2>

        {studies.length > 1 && (
          <>
            <p className="muted small" style={{ margin: 0 }}>
              The real study dates are removed during anonymisation. The spacing between them is what carries meaning,
              so it is preserved: pick a date for the baseline and the follow-ups move with it.
            </p>
            <label className="field" style={{ maxWidth: 240 }}>
              Baseline date
              <input
                type="date"
                value={form.anchorDate}
                onChange={(e) => set('anchorDate', e.target.value)}
              />
            </label>
          </>
        )}

        {studies.map((study, i) => {
          const entry = form.studies[study.id] ?? { modality: 'MRI', findings: '' }
          const update = (patch: Partial<StudyForm>): void =>
            onChange({ ...form, studies: { ...form.studies, [study.id]: { ...entry, ...patch } } })

          return (
            <div
              key={study.id}
              style={{
                borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                paddingTop: i === 0 ? 0 : 14,
                display: 'grid',
                gap: 12
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <h3>{study.studyDescription ?? `Study ${i + 1}`}</h3>
                <span className="badge">{describeInterval(study.intervalDays)}</span>
                <span className="muted small">
                  uploaded as {addDays(form.anchorDate, study.intervalDays ?? 0)}
                </span>
              </div>

              <div className="row2">
                <label className="field">
                  Modality
                  <select value={entry.modality} onChange={(e) => update({ modality: e.target.value })}>
                    {MODALITIES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <div />
              </div>

              <label className="field">
                Findings
                <textarea value={entry.findings} onChange={(e) => update({ findings: e.target.value })} />
              </label>
            </div>
          )
        })}
      </div>
    </div>
  )
}
