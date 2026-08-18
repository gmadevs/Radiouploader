import path from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { registerIpc } from './ipc'
import { session } from './session'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#111418',
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.mjs'),
      // Patient data is handled in the main process only; the renderer gets no
      // Node access and reaches the filesystem solely through the IPC bridge.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // External links open in the user's browser, never inside the app shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl) {
    void win.loadURL(devServerUrl)
  } else {
    void win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'))
  }
  return win
}

void app.whenReady().then(() => {
  app.setAppUserModelId('io.github.gmadevs.radiouploader')
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Remove extracted originals and anonymised output before the process goes away.
app.on('before-quit', (event) => {
  if (!session.ingest && !session.anon) return
  event.preventDefault()
  void session.reset().finally(() => app.exit(0))
})
