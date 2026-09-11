import { clipboard, dialog, shell, type BrowserWindow, type MessageBoxOptions } from 'electron'

/**
 * Hand a link to the system, and say whether it took it.
 *
 * On Linux Electron passes the address to xdg-open, and a minimal system
 * running the AppImage may have none — then openExternal rejects. True means
 * only that the system accepted the address, not that a window appeared.
 */
export async function openExternally(url: string): Promise<boolean> {
  try {
    await shell.openExternal(url)
    return true
  } catch {
    return false
  }
}

/**
 * Open a link, or put its address in front of the user when that fails.
 *
 * For the links the page opens on its own — release notes, the case on
 * Radiopaedia, the issue tracker, the support address. Each of them used to be
 * a button that did nothing where there was no xdg-open, with nothing said.
 * The main process has no panel to show an address in, so a dialog does it.
 */
export async function openOrOffer(url: string, parent?: BrowserWindow): Promise<void> {
  if (await openExternally(url)) return

  // A mailto link carries a subject and a body; the address is what someone
  // writing from their own account can use.
  const email = url.startsWith('mailto:') ? decodeURIComponent(url.slice('mailto:'.length).split('?')[0]) : null
  const options: MessageBoxOptions = {
    type: 'warning',
    message: email ? 'This computer did not open an email app.' : 'This computer did not open a browser.',
    detail: email ? `Write to ${email} from any email account.` : `Open this address in a browser yourself:\n\n${url}`,
    buttons: ['Copy the address', 'Close'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  }
  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
  if (response === 0) clipboard.writeText(email ?? url)
}
