import { useEffect, useState } from 'react'
import { quotaExhausted, type AccountState } from '../quota'

/** Doorkeeper's out-of-band redirect: the code is shown on screen to copy. */
const OOB_REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob'

interface Props {
  account: AccountState
  onChange: (account: AccountState) => void
}

/**
 * Sign-in state and draft quota, shown from the first screen.
 *
 * The quota is checked before any import so a full account is discovered up
 * front, rather than after importing, previewing and anonymising a whole study.
 */
export function AccountBar({ account, onChange }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  // Radiopaedia refuses non-https redirect URIs, so the out-of-band URN is the
  // realistic default for a desktop app; their application form says as much.
  const [redirectUri, setRedirectUri] = useState(OOB_REDIRECT_URI)
  // Radiopaedia declares permitted scopes on the application itself; sending one
  // explicitly is what triggers "The requested scope is invalid".
  const [scope, setScope] = useState('')
  const [code, setCode] = useState('')
  const [awaitingCode, setAwaitingCode] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = (): void => {
    void window.api
      .authStatus()
      .then((status) => {
        if (status.clientId) setClientId(status.clientId)
        if (status.redirectUri) setRedirectUri(status.redirectUri)
        if (status.scope !== null) setScope(status.scope)
        if (!status.authenticated) {
          onChange({ authenticated: false, username: null, quota: null })
          return
        }
        void window.api
          .currentUser()
          .then((user) => onChange({ authenticated: true, username: user.username, quota: user.quota }))
          .catch(() => onChange({ authenticated: true, username: null, quota: null }))
      })
      .catch((e: unknown) => {
        // Keychain declined, config unreadable — stay signed out and say why.
        setError(e instanceof Error ? e.message : String(e))
        onChange({ authenticated: false, username: null, quota: null })
      })
  }

  useEffect(load, [])

  const beginSignIn = (): void => {
    setBusy(true)
    setError(null)
    void window.api
      .configureAuth({ clientId, clientSecret: clientSecret || undefined, redirectUri, scope })
      .then(() => window.api.beginSignIn())
      .then((res) => {
        if (res.needsCode) {
          // Out-of-band: Radiopaedia shows the code, the user brings it back.
          setAwaitingCode(true)
          return
        }
        return load()
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }

  const completeSignIn = (): void => {
    setBusy(true)
    setError(null)
    void window.api
      .completeSignIn(code)
      .then((user) => {
        onChange({ authenticated: true, username: user.username, quota: user.quota })
        setAwaitingCode(false)
        setCode('')
        setOpen(false)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }

  const full = quotaExhausted(account.quota)

  return (
    <div className="account">
      {account.authenticated ? (
        <>
          <span className="muted small">{account.username ?? 'Signed in'}</span>
          {account.quota && (
            <span className={full ? 'badge full' : 'badge'}>
              {account.quota.allowedDraftCases === null
                ? `${account.quota.draftCaseCount} drafts`
                : `${account.quota.draftCaseCount}/${account.quota.allowedDraftCases} drafts`}
            </span>
          )}
          <button className="small ghost" onClick={() => void window.api.signOut().then(load)}>
            Sign out
          </button>
        </>
      ) : (
        <button className="small" onClick={() => setOpen((v) => !v)}>
          Sign in to Radiopaedia
        </button>
      )}

      {open && !account.authenticated && (
        <div className="account-panel card rows">
          {!awaitingCode ? (
            <>
              <p className="muted small" style={{ margin: 0 }}>
                Create your own application on Radiopaedia with scope <code>cases</code> — these credentials stay on
                this computer and are never bundled with the app. Its Redirect URI must be an https address or the
                out-of-band URN below; a plain <code>http://127.0.0.1</code> address is rejected by their form.
              </p>
              <label className="field">
                Application ID
                <input value={clientId} onChange={(e) => setClientId(e.target.value)} />
              </label>
              <label className="field">
                Client secret — leave empty for a public application
                <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
              </label>
              <label className="field">
                Redirect URI (must match the application exactly)
                <input value={redirectUri} onChange={(e) => setRedirectUri(e.target.value)} />
              </label>
              <label className="field">
                Scope — leave empty. Radiopaedia declares the permitted scopes on the application itself, and
                requesting one here is rejected.
                <input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="cases" />
              </label>
              {error && <div className="notice error">{error}</div>}
              <div>
                <button className="primary" disabled={busy || !clientId || !redirectUri} onClick={beginSignIn}>
                  {busy ? 'Opening your browser…' : 'Open Radiopaedia to authorise'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted small" style={{ margin: 0 }}>
                Authorise the application in the browser window that just opened, then paste the code Radiopaedia
                shows you.
              </p>
              <label className="field">
                Authorization code
                <input
                  value={code}
                  autoFocus
                  spellCheck={false}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && code.trim() !== '') completeSignIn()
                  }}
                />
              </label>
              {error && <div className="notice error">{error}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="primary" disabled={busy || code.trim() === ''} onClick={completeSignIn}>
                  {busy ? 'Signing in…' : 'Complete sign in'}
                </button>
                <button
                  className="ghost"
                  disabled={busy}
                  onClick={() => {
                    setAwaitingCode(false)
                    setError(null)
                  }}
                >
                  Back
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
