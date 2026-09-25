import crypto from 'node:crypto'
import { openExternally } from '../openLink'

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

/** The token endpoint said no, with the status that says whether it will say yes later. */
export class OAuthError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'OAuthError'
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
    throw new OAuthError(res.status, `OAuth token request failed: ${detail}`)
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

/**
 * Open the authorization page in the user's own browser, and say whether that
 * worked.
 *
 * Thrown, a failure left sign-in on its first screen with no address to go to
 * by hand, so the caller is told instead and shows the address in its panel.
 */
export async function openAuthorizationPage(pending: PendingAuthorization): Promise<boolean> {
  return openExternally(pending.url)
}

/**
 * The code out of whatever was pasted.
 *
 * With the out-of-band URN Radiopaedia shows the code on a page, and that is
 * what gets pasted. With an https redirect URI it sends the browser there with
 * the code in the address, and the address is what is at hand — so a URL is
 * read for its `code`, and for its `state`, which has to be the one this
 * sign-in sent or the answer belongs to some other request.
 *
 * There used to be a loopback listener for that case. It could never have
 * answered: the browser speaks TLS to an https address, and the listener was
 * plain http on port 80 whatever the address said.
 */
export function codeFrom(pasted: string, state: string): string {
  const trimmed = pasted.trim()
  let url: URL | null = null
  try {
    url = /^https?:\/\//i.test(trimmed) ? new URL(trimmed) : null
  } catch {
    url = null
  }
  if (url === null) return trimmed

  const error = url.searchParams.get('error')
  if (error) throw new Error(`Authorisation declined: ${error}`)
  const returnedState = url.searchParams.get('state')
  if (returnedState !== null && returnedState !== state) {
    throw new Error('That address belongs to a different sign-in. Start the sign-in again and paste the new address.')
  }
  const code = url.searchParams.get('code')
  if (!code) throw new Error('That address has no authorisation code in it')
  return code
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
