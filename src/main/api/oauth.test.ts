import { describe, expect, it, vi } from 'vitest'

const openExternal = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ shell: { openExternal } }))

const { OOB_REDIRECT_URI, buildAuthorization, codeFrom, openAuthorizationPage } = await import('./oauth')

const pending = buildAuthorization({ clientId: 'application', redirectUri: OOB_REDIRECT_URI })

describe('openAuthorizationPage', () => {
  it('says the browser was asked to open the page when the system took the address', async () => {
    openExternal.mockResolvedValueOnce(undefined)
    expect(await openAuthorizationPage(pending)).toBe(true)
    expect(openExternal).toHaveBeenLastCalledWith(pending.url)
  })

  it('says it could not, rather than throwing, when there is nothing to open it with', async () => {
    // What Electron answers on a Linux with no xdg-open, where the AppImage's
    // sign-in used to stop on its first screen with no address to go to.
    openExternal.mockRejectedValueOnce(new Error('Failed to launch process'))
    expect(await openAuthorizationPage(pending)).toBe(false)
  })
})

describe('codeFrom', () => {
  it('takes a pasted code as it is', () => {
    expect(codeFrom('  abc123 \n', pending.state)).toBe('abc123')
  })

  it('reads the code out of the address an https redirect sent the browser to', () => {
    const address = `https://example.org/callback?code=xyz&state=${pending.state}`
    expect(codeFrom(address, pending.state)).toBe('xyz')
  })

  it('refuses an address that answers a different sign-in', () => {
    expect(() => codeFrom('https://example.org/callback?code=xyz&state=other', pending.state)).toThrow(
      /different sign-in/
    )
  })

  it('says the authorisation was declined rather than looking for a code', () => {
    expect(() => codeFrom('https://example.org/callback?error=access_denied', pending.state)).toThrow(
      /declined: access_denied/
    )
  })

  it('says so when an address carries no code at all', () => {
    expect(() => codeFrom('https://example.org/callback', pending.state)).toThrow(/no authorisation code/)
  })
})
