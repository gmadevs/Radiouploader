/**
 * Boot the built renderer in a real Electron window, fail on any console error
 * or failed load, and write a screenshot. Run with: npm run smoke
 */
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outFile = process.env.SMOKE_SCREENSHOT ?? path.join(root, 'smoke.png')
const problems = []

// NOTE: no top-level await before 'ready'. Electron emits it only once the ESM
// main module has finished evaluating, so awaiting whenReady() here deadlocks.
app.whenReady().then(run).catch((err) => {
  console.error(err)
  app.exit(1)
})

async function run() {
const win = new BrowserWindow({
  width: 1280,
  height: 860,
  show: false,
  backgroundColor: '#111418',
  webPreferences: {
    preload: path.join(root, 'out/preload/index.mjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false
  }
})

win.webContents.on('console-message', (event) => {
  // level 3 is "error" in Chromium's logging levels.
  if (event.level === 'error' || event.level === 3) problems.push(`console: ${event.message}`)
})
win.webContents.on('did-fail-load', (_e, code, description) => {
  problems.push(`did-fail-load: ${code} ${description}`)
})
win.webContents.on('render-process-gone', (_e, details) => {
  problems.push(`render-process-gone: ${details.reason}`)
})

await win.loadFile(path.join(root, 'out/renderer/index.html'))
await new Promise((resolve) => setTimeout(resolve, 2500))

const reachedDom = await win.webContents.executeJavaScript(
  `({ root: !!document.querySelector('#root')?.firstChild,
      steps: [...document.querySelectorAll('.step')].map(e => e.textContent.trim()),
      bridge: typeof window.api?.ingest })`
)

const image = await win.webContents.capturePage()
await fs.writeFile(outFile, image.toPNG())

console.log('renderer mounted:', reachedDom.root)
console.log('wizard steps   :', JSON.stringify(reachedDom.steps))
console.log('preload bridge :', reachedDom.bridge)
console.log('screenshot     :', outFile)

if (problems.length > 0) {
  console.error('PROBLEMS:\n' + problems.join('\n'))
  app.exit(1)
} else if (!reachedDom.root || reachedDom.bridge !== 'function') {
  console.error('PROBLEMS: renderer did not mount, or the preload bridge is missing')
  app.exit(1)
} else {
  console.log('SMOKE OK')
  app.exit(0)
}
}
