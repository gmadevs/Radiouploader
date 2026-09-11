import { describe, expect, it, vi } from 'vitest'

const openExternal = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ shell: { openExternal } }))

const { OOB_REDIRECT_URI, buildAuthorization, openAuthorizationPage } = await import('./oauth')

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
