import crypto from 'node:crypto'
import http from 'node:http'
import { AddressInfo } from 'node:net'
import { shell } from 'electron'

export const RADIOPAEDIA_ORIGIN = 'https://radiopaedia.org'
const AUTHORIZE_URL = `${RADIOPAEDIA_ORIGIN}/oauth/authorize`
const TOKEN_URL = `${RADIOPAEDIA_ORIGIN}/oauth/token`

/**
 * Scope requested at authorization.
 *
 * Empty on purpose. Radiopaedia's API reference never sends a scope parameter,
 * and neither does their own uploader — the permitted scopes are declared on
 * the application itself. Requesting one explicitly is what produces "The
 * requested scope is invalid, unknown, or malformed", so the parameter is
 * omitted unless the user deliberately sets it.
 */
export const DEFAULT_SCOPE = ''

/**
 * Out-of-band redirect.
 *
 * Radiopaedia's Doorkeeper rejects any redirect URI that is not https — a plain
 * `http://127.0.0.1/...` loopback, the usual native-app pattern from RFC 8252,
 * is refused by the application form. Their form points at this URN instead:
 * the authorization page displays the code and the user pastes it into the app.
 */
export const OOB_REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob'

export function isOobRedirect(redirectUri: string): boolean {
  return redirectUri === OOB_REDIRECT_URI
}

export interface OAuthConfig {
  clientId: string
  /** Doorkeeper confidential apps issue a secret; public apps use PKCE instead. */
  clientSecret?: string
  /** Must match a redirect URI registered on the Radiopaedia application. */
  redirectUri: string
  /**
   * Scope to request. Leave empty to omit the parameter entirely and let the
   * application's own scopes apply, which is what Radiopaedia's uploader does.
   */
  scope?: string
}

export interface TokenSet {
  accessToken: string
  refreshToken: string | null
  /** Epoch milliseconds. */
  expiresAt: number
}

function toTokenSet(body: Record<string, unknown>): TokenSet {
  const accessToken = body.access_token
  if (typeof accessToken !== 'string') {
    throw new Error('Token response did not contain an access_token')
  }
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 24 * 3600
  return {
    accessToken,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    // Refresh a minute early so a request never starts with a token about to die.
    expiresAt: Date.now() + (expiresIn - 60) * 1000
  }
}

async function postToken(params: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params).toString()
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const detail = typeof body.error_description === 'string' ? body.error_description : String(body.error ?? res.status)
    throw new Error(`OAuth token request failed: ${detail}`)
  }
  return toTokenSet(body)
}

export interface PendingAuthorization {
  url: string
  state: string
  codeVerifier: string
}

/**
 * Build the authorization URL and the PKCE material that goes with it.
 *
 * PKCE is always sent; Doorkeeper ignores it for confidential apps and requires
 * it for public ones, so this works either way.
 */
export function buildAuthorization(config: OAuthConfig): PendingAuthorization {
  const state = crypto.randomBytes(16).toString('hex')
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')

  const authUrl = new URL(AUTHORIZE_URL)
  authUrl.searchParams.set('client_id', config.clientId)
  authUrl.searchParams.set('redirect_uri', config.redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  const scope = config.scope ?? DEFAULT_SCOPE
  if (scope.trim() !== '') authUrl.searchParams.set('scope', scope.trim())
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')

  return { url: authUrl.toString(), state, codeVerifier }
}

/** Exchange an authorization code for tokens. */
export async function exchangeCode(config: OAuthConfig, code: string, codeVerifier: string): Promise<TokenSet> {
  const params: Record<string, string> = {
    client_id: config.clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier
  }
  if (config.clientSecret) params.client_secret = config.clientSecret
  return postToken(params)
}

/** Open the authorization page in the user's own browser. */
export async function openAuthorizationPage(pending: PendingAuthorization): Promise<void> {
  await shell.openExternal(pending.url)
}

/**
 * Loopback flow, for an application registered with an https redirect URI.
 *
 * Kept for completeness — Radiopaedia's form refuses plain http loopback, so
 * most users will go through the out-of-band flow instead.
 */
export async function authorizeViaLoopback(config: OAuthConfig): Promise<TokenSet> {
  const redirect = new URL(config.redirectUri)
  const pending = buildAuthorization(config)
  const { state } = pending

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${(server.address() as AddressInfo).port}`)
      if (url.pathname !== redirect.pathname) {
        res.writeHead(404).end()
        return
      }
      const returnedState = url.searchParams.get('state')
      const returnedCode = url.searchParams.get('code')
      const error = url.searchParams.get('error')

      const finish = (message: string): void => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`<!doctype html><meta charset="utf-8"><title>Radiopaedia Uploader</title>
          <body style="font:16px/1.5 system-ui;padding:3rem;text-align:center">${message}</body>`)
        server.close()
      }

      if (error) {
        finish('Authorisation was declined. You can close this window.')
        reject(new Error(`Authorisation declined: ${error}`))
      } else if (returnedState !== state) {
        // A mismatched state means the response is not the one we initiated.
        finish('Authorisation failed. You can close this window.')
        reject(new Error('OAuth state mismatch — authorisation response rejected'))
      } else if (!returnedCode) {
        finish('Authorisation failed. You can close this window.')
        reject(new Error('Authorisation response contained no code'))
      } else {
        finish('Signed in. You can close this window and return to the uploader.')
        resolve(returnedCode)
      }
    })

    server.on('error', reject)
    server.listen(Number(redirect.port || 80), '127.0.0.1', () => {
      void openAuthorizationPage(pending)
    })

    // Give the user a bounded window to complete sign-in rather than leaking a listener.
    setTimeout(() => {
      server.close()
      reject(new Error('Timed out waiting for authorisation'))
    }, 5 * 60_000).unref()
  })

  return exchangeCode(config, code, pending.codeVerifier)
}

/** Exchange a refresh token for a fresh access token. */
export async function refresh(config: OAuthConfig, refreshToken: string): Promise<TokenSet> {
  const params: Record<string, string> = {
    client_id: config.clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  }
  if (config.clientSecret) params.client_secret = config.clientSecret
  const next = await postToken(params)
  // Doorkeeper may rotate refresh tokens; keep the old one if it did not.
  return { ...next, refreshToken: next.refreshToken ?? refreshToken }
}
