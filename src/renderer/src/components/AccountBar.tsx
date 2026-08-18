import { useEffect, useState } from 'react'

export interface Quota {
  draftCaseCount: number
  allowedDraftCases: number
}

export interface AccountState {
  authenticated: boolean
  username: string | null
  quota: Quota | null
}

/** True when the account cannot hold another draft case. */
export function quotaExhausted(quota: Quota | null): boolean {
  return quota !== null && quota.allowedDraftCases > 0 && quota.draftCaseCount >= quota.allowedDraftCases
}

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
  const [redirectUri, setRedirectUri] = useState('http://127.0.0.1:8910/callback')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = (): void => {
    void window.api
      .authStatus()
      .then((status) => {
        if (status.clientId) setClientId(status.clientId)
        if (status.redirectUri) setRedirectUri(status.redirectUri)
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

  const signIn = (): void => {
    setBusy(true)
    setError(null)
    void window.api
      .configureAuth({ clientId, clientSecret: clientSecret || undefined, redirectUri })
      .then(() => window.api.signIn())
      .then((user) => {
        onChange({ authenticated: true, username: user.username, quota: user.quota })
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
              {account.quota.draftCaseCount}/{account.quota.allowedDraftCases} drafts
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
          <p className="muted small" style={{ margin: 0 }}>
            Create an application on Radiopaedia with scope <code>cases</code> and the redirect URI below, then paste
            its credentials here.
          </p>
          <label className="field">
            Application ID
            <input value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </label>
          <label className="field">
            Client secret
            <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
          </label>
          <label className="field">
            Redirect URI (must match the application exactly)
            <input value={redirectUri} onChange={(e) => setRedirectUri(e.target.value)} />
          </label>
          {error && <div className="notice error">{error}</div>}
          <div>
            <button className="primary" disabled={busy || !clientId || !redirectUri} onClick={signIn}>
              {busy ? 'Waiting for your browser…' : 'Sign in'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
