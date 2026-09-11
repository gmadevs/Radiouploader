import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  shell: { openExternal: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
  clipboard: { writeText: vi.fn() }
}))
vi.mock('electron', () => electron)

const { openExternally, openOrOffer } = await import('./openLink')

// What Electron answers on a Linux with no xdg-open.
const noBrowser = (): Error => new Error('Failed to launch process')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('openExternally', () => {
  it('says the system took the address', async () => {
    electron.shell.openExternal.mockResolvedValueOnce(undefined)
    expect(await openExternally('https://radiopaedia.org')).toBe(true)
  })

  it('says it did not, rather than throwing, when there is nothing to open it with', async () => {
    electron.shell.openExternal.mockRejectedValueOnce(noBrowser())
    expect(await openExternally('https://radiopaedia.org')).toBe(false)
  })
})

describe('openOrOffer', () => {
  it('asks nothing when the link opened', async () => {
    electron.shell.openExternal.mockResolvedValueOnce(undefined)
    await openOrOffer('https://github.com/gmadevs/Radiouploader/releases')
    expect(electron.dialog.showMessageBox).not.toHaveBeenCalled()
  })

  it('shows the address and copies it when asked, where no browser opened', async () => {
    const url = 'https://github.com/gmadevs/Radiouploader/releases'
    electron.shell.openExternal.mockRejectedValueOnce(noBrowser())
    electron.dialog.showMessageBox.mockResolvedValueOnce({ response: 0 })
    await openOrOffer(url)
    expect(electron.dialog.showMessageBox.mock.calls[0][0].detail).toContain(url)
    expect(electron.clipboard.writeText).toHaveBeenCalledWith(url)
  })

  it('leaves the clipboard alone when the dialog is closed', async () => {
    electron.shell.openExternal.mockRejectedValueOnce(noBrowser())
    electron.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 })
    await openOrOffer('https://radiopaedia.org/cases/000000/edit')
    expect(electron.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('offers the email address rather than the whole mailto link', async () => {
    electron.shell.openExternal.mockRejectedValueOnce(noBrowser())
    electron.dialog.showMessageBox.mockResolvedValueOnce({ response: 0 })
    await openOrOffer('mailto:someone%2Bapp@example.org?subject=Radiouploader&body=Version%201.3.2')
    expect(electron.clipboard.writeText).toHaveBeenCalledWith('someone+app@example.org')
  })
})
