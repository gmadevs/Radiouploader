import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredConfig } from './store'

vi.mock('electron', () => ({ shell: {}, dialog: {} }))
// The keychain is not what is under test; a plain object stands in for it.
let stored: StoredConfig = {}
vi.mock('./store', () => ({
  loadConfig: async () => stored,
  updateConfig: async (change: (config: StoredConfig) => StoredConfig) => {
    stored = change(stored)
  }
}))

const { RadiopaediaClient } = await import('./client')

const config = { clientId: 'app', redirectUri: 'urn:ietf:wg:oauth:2.0:oob' }
const later = () => Date.now() + 3600_000

async function signedIn(tokens: { accessToken: string; refreshToken: string | null; expiresAt: number }) {
  stored = { oauth: config, tokens }
  return (await RadiopaediaClient.fromStoredConfig())!
}

/**
 * Stub the network: the token endpoint answers `token`, everything else is
 * handed to `api` with the bearer it was sent.
 */
function stubNetwork(api: (bearer: string) => Response, token: () => Response = () => fresh('new')) {
  const calls = { token: 0, api: [] as string[] }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/oauth/token')) {
        calls.token++
        return token()
      }
      const bearer = new Headers(init.headers).get('Authorization')!.replace('Bearer ', '')
      calls.api.push(bearer)
      return api(bearer)
    })
  )
  return calls
}

const fresh = (access: string) =>
  new Response(JSON.stringify({ access_token: access, refresh_token: `${access}-refresh`, expires_in: 7200 }))

beforeEach(() => {
  stored = {}
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RadiopaediaClient.request', () => {
  it('renews a token the server stopped taking, and sends the request again', async () => {
    const client = await signedIn({ accessToken: 'old', refreshToken: 'r', expiresAt: later() })
    const calls = stubNetwork((bearer) => new Response('{}', { status: bearer === 'old' ? 401 : 200 }))

    const res = await client.request('users/current')

    expect(res.status).toBe(200)
    expect(calls.api).toEqual(['old', 'new'])
    expect(stored.tokens?.accessToken).toBe('new')
  })

  it('asks for a new sign-in when even a renewed token is refused', async () => {
    const client = await signedIn({ accessToken: 'old', refreshToken: 'r', expiresAt: later() })
    stubNetwork(() => new Response('{}', { status: 401 }))

    await expect(client.request('users/current')).rejects.toThrow(/Session expired/)
    expect(client.isAuthenticated).toBe(false)
    expect(stored.tokens).toBeUndefined()
  })

  it('asks for a new sign-in when the refresh token itself is refused', async () => {
    const client = await signedIn({ accessToken: 'old', refreshToken: 'r', expiresAt: 0 })
    stubNetwork(
      () => new Response('{}'),
      () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
    )

    await expect(client.request('users/current')).rejects.toThrow(/Session expired/)
    expect(client.isAuthenticated).toBe(false)
  })

  it('keeps the tokens when the refresh could not reach the site at all', async () => {
    const client = await signedIn({ accessToken: 'old', refreshToken: 'r', expiresAt: 0 })
    stubNetwork(
      () => new Response('{}'),
      () => {
        throw new TypeError('fetch failed')
      }
    )

    await expect(client.request('users/current')).rejects.toThrow(/fetch failed/)
    expect(client.isAuthenticated).toBe(true)
  })

  it('refreshes once for however many requests find the token expired', async () => {
    // Doorkeeper may rotate the refresh token, so a second refresh with the
    // same one would be refused and sign the user out mid-upload.
    const client = await signedIn({ accessToken: 'old', refreshToken: 'r', expiresAt: 0 })
    const calls = stubNetwork(() => new Response('{}'))

    await Promise.all([client.request('a'), client.request('b'), client.request('c'), client.request('d')])

    expect(calls.token).toBe(1)
    expect(calls.api).toEqual(['new', 'new', 'new', 'new'])
  })

  it('sends the token to radiopaedia.org and nowhere else', async () => {
    const client = await signedIn({ accessToken: 'old', refreshToken: 'r', expiresAt: later() })
    const calls = stubNetwork(() => new Response('{}'))

    await expect(client.request('https://example.org/steal')).rejects.toThrow(/sent only to radiopaedia.org/)
    await expect(client.request('https://radiopaedia.org/direct_s3_uploads')).resolves.toBeDefined()
    expect(calls.api).toEqual(['old'])
  })
})
