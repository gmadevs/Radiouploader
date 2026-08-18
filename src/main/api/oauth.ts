import crypto from 'node:crypto'
import http from 'node:http'
import { AddressInfo } from 'node:net'
import { shell } from 'electron'

export const RADIOPAEDIA_ORIGIN = 'https://radiopaedia.org'
const AUTHORIZE_URL = `${RADIOPAEDIA_ORIGIN}/oauth/authorize`
const TOKEN_URL = `${RADIOPAEDIA_ORIGIN}/oauth/token`

/** The only scope the uploader needs; it is what the application form asks for. */
export const SCOPE = 'cases'

export interface OAuthConfig {
  clientId: string
  /** Doorkeeper confidential apps issue a secret; public apps use PKCE instead. */
  clientSecret?: string
  /** Must match a redirect URI registered on the Radiopaedia application. */
  redirectUri: string
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

/**
 * Run the authorization-code flow.
 *
 * Following RFC 8252 for native apps: the authorization page opens in a real
 * browser window and the code comes back to a loopback listener bound to the
 * port in `redirectUri`. PKCE is always sent; Doorkeeper ignores it for
 * confidential apps and requires it for public ones, so this works either way.
 */
export async function authorize(config: OAuthConfig): Promise<TokenSet> {
  const redirect = new URL(config.redirectUri)
  const state = crypto.randomBytes(16).toString('hex')
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')

  const authUrl = new URL(AUTHORIZE_URL)
  authUrl.searchParams.set('client_id', config.clientId)
  authUrl.searchParams.set('redirect_uri', config.redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', SCOPE)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')

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
      void shell.openExternal(authUrl.toString())
    })

    // Give the user a bounded window to complete sign-in rather than leaking a listener.
    setTimeout(() => {
      server.close()
      reject(new Error('Timed out waiting for authorisation'))
    }, 5 * 60_000).unref()
  })

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
