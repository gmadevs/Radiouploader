/**
 * Boot the built renderer in a real Electron window, fail on any console error
 * or failed load, and write a screenshot. Run with: npm run smoke
 */
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'
import '../out/main/index.js'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/**
 * Refuse to run against a stale bundle. A failed build leaves the previous out/
 * in place, and testing that instead of the current source reports success for
 * code that does not compile.
 */
async function newestMtime(dir) {
  let newest = 0
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) newest = Math.max(newest, await newestMtime(full))
    else newest = Math.max(newest, (await fs.stat(full)).mtimeMs)
  }
  return newest
}

const srcMtime = await newestMtime(path.join(root, 'src'))
const outMtime = await newestMtime(path.join(root, 'out')).catch(() => 0)
if (outMtime < srcMtime) {
  console.error('PROBLEMS: out/ is older than src/ — run `npm run build` first (did the build fail?)')
  process.exit(1)
}
const outFile = process.env.SMOKE_SCREENSHOT ?? path.join(root, 'smoke.png')
const problems = []

// NOTE: no top-level await before 'ready'. Electron emits it only once the ESM
// main module has finished evaluating, so awaiting whenReady() here deadlocks.
app.whenReady().then(run).catch((err) => {
  console.error(err)
  app.exit(1)
})

async function run() {
// The real main module creates the window and registers the IPC handlers, so
// this exercises the actual wiring rather than a stand-in window.
const win = BrowserWindow.getAllWindows()[0]
if (!win) {
  console.error('PROBLEMS: main process created no window')
  app.exit(1)
  return
}

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

await new Promise((resolve) => setTimeout(resolve, 3000))

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
