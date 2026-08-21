/**
 * The documentation's screenshots, taken from the real app.
 *
 * Hand-cropped screenshots go stale silently: the UI moves, the picture does
 * not, and nobody notices until a reader follows a page that describes a button
 * which no longer exists. These are regenerated from the current build with one
 * command instead — `npm run shots` — and written straight into docs/public.
 *
 * Sign-in, the folder picker and the upload are stubbed at the IPC layer, so no
 * test hook exists in the app itself and everything between them is the real
 * wiring: real ingest, real preview decoding, real anonymisation.
 *
 * Run with: npm run shots
 */
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain } from 'electron'
import { makeSampleStudy } from './sampleStudy.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const shotsDir = path.join(root, 'docs/public/shots')
const sampleDir = path.join(root, '.sample-study')

await import(path.join(root, 'out/main/index.js'))

const problems = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(run).catch((err) => {
  console.error(err)
  app.exit(1)
})

async function run() {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    console.error('PROBLEMS: main process created no window')
    app.exit(1)
    return
  }

  // A fixed size, so every screenshot on the site has the same proportions.
  win.setSize(1280, 860)
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 3) problems.push(`console: ${e.message}`)
  })

  console.log(`sample study  : ${makeSampleStudy(sampleDir)} files`)
  await fs.mkdir(shotsDir, { recursive: true })

  stub('auth:status', () => ({
    configured: true,
    authenticated: true,
    redirectUri: 'urn:ietf:wg:oauth:2.0:oob',
    scope: null,
    usesOutOfBandFlow: true,
    clientId: 'sample-application-id'
  }))
  stub('api:currentUser', () => ({
    username: 'your-account',
    quota: { draftCaseCount: 0, allowedDraftCases: 5 }
  }))
  stub('source:pick', () => [sampleDir])
  // The only step that would leave this computer. Everything it needs from the
  // response is what the confirmation screen prints.
  stub('upload:run', () => ({ caseId: '000000', url: 'https://radiopaedia.org/cases/000000' }))

  win.webContents.reload()
  await new Promise((r) => win.webContents.once('did-finish-load', r))
  await sleep(900)

  await shot('01-source', 'the first screen')

  await click('Choose folder')
  await settle(4000)
  await shot('02-review', 'the review step')

  // Trim lives behind a hover, so it is clicked rather than pointed at.
  await evaluate(`document.querySelectorAll('.trim-toggle')[0]?.click()`)
  await sleep(600)
  await shot('03-trim', 'the trim controls')
  await click('Done')
  await sleep(400)

  await openViewerOn('Upper abdomen')
  await settle(2500)
  await shot('04-viewer', 'the ultrasound, banner and all')

  await click('Erase')
  await dragOverBanner()
  await sleep(700)
  await shot('05-erase', 'the banner blanked')

  await click('Done')
  await sleep(600)

  await click('Anonymise and continue')
  await settle(2500)
  await shot('06-check', 'the check before anonymising')

  await click('I have checked — anonymise')
  await settle(6000)
  await fillCaseForm()
  await sleep(600)
  await shot('07-case', 'the case form')

  await click('Upload to Radiopaedia')
  await settle(2500)
  await shot('08-done', 'the confirmation')

  if (problems.length > 0) {
    console.error('PROBLEMS:\n' + problems.join('\n'))
    app.exit(1)
  } else {
    console.log('SHOTS OK')
    app.exit(0)
  }

  // ------------------------------------------------------------- the helpers

  function stub(channel, fn) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, fn)
  }

  function evaluate(source) {
    return win.webContents.executeJavaScript(source)
  }

  /** Wait for the app to stop being busy, or give up and say so. */
  async function settle(budget) {
    const deadline = Date.now() + budget
    while (Date.now() < deadline) {
      await sleep(250)
      const busy = await evaluate(`!!document.querySelector('.progress')`)
      if (!busy) return sleep(500)
    }
    problems.push(`still busy after ${budget}ms`)
  }

  async function click(label) {
    const result = await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === ${JSON.stringify(label)})
      if (!b) return 'missing'
      if (b.disabled) return 'disabled'
      b.click()
      return 'ok'
    })()`)
    if (result !== 'ok') problems.push(`button ${JSON.stringify(label)}: ${result}`)
    await sleep(400)
  }

  /** Open the viewer on the series whose description contains `name`. */
  async function openViewerOn(name) {
    const result = await evaluate(`(() => {
      const series = [...document.querySelectorAll('.series')]
        .find((s) => s.querySelector('h3')?.textContent.includes(${JSON.stringify(name)}))
      const open = series?.querySelector('.open-viewer')
      if (!open) return 'missing'
      open.click()
      return 'ok'
    })()`)
    if (result !== 'ok') problems.push(`series ${JSON.stringify(name)}: ${result}`)
  }

  /**
   * Drag a mask over the burnt-in banner.
   *
   * Sent through sendInputEvent rather than dispatched from the page: the
   * eraser takes a pointer capture, and a synthetic PointerEvent has no pointer
   * to capture, so the drag would fall apart on the first move.
   */
  async function dragOverBanner() {
    const rect = await evaluate(
      `(() => { const c = document.querySelector('.viewer-stage canvas'); if (!c) return null
                const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })()`
    )
    if (!rect) {
      problems.push('no canvas to drag on')
      return
    }
    // The banner sits in the top-left eighth of the image.
    const from = { x: Math.round(rect.x + rect.w * 0.01), y: Math.round(rect.y + rect.h * 0.01) }
    const to = { x: Math.round(rect.x + rect.w * 0.84), y: Math.round(rect.y + rect.h * 0.19) }

    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...from })
    for (let i = 1; i <= 6; i++) {
      win.webContents.sendInputEvent({
        type: 'mouseMove',
        button: 'left',
        x: Math.round(from.x + ((to.x - from.x) * i) / 6),
        y: Math.round(from.y + ((to.y - from.y) * i) / 6)
      })
      await sleep(60)
    }
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...to })
  }

  /**
   * Type into the case form.
   *
   * React tracks the value on the DOM node, so assigning `.value` is ignored on
   * the next render; the prototype setter is what a real keystroke ends up
   * calling, which is why it is reached for here.
   */
  async function fillCaseForm() {
    const result = await evaluate(`(() => {
      const set = (labelText, value) => {
        // The label's own text node, not textContent: on a select that would
        // also pull in every option.
        const field = [...document.querySelectorAll('label.field')]
          .find((l) => l.childNodes[0]?.textContent?.trim().startsWith(labelText))
        const input = field?.querySelector('input, textarea, select')
        if (!input) return labelText
        const proto = input.tagName === 'SELECT' ? HTMLSelectElement : input.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement
        Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        return null
      }
      const missing = [
        set('Title', 'Solitary pulmonary nodule, six months on'),
        set('Presentation', 'Incidental finding on a staging CT, reviewed at follow-up.'),
        set('System', '4'),
        set('Diagnostic certainty', '3'),
        set('Age', '61 years'),
        set('Findings', 'A subpleural nodule in the left upper lobe, larger than on the baseline study.')
      ].filter(Boolean)
      return missing.length ? 'missing: ' + missing.join(', ') : 'ok'
    })()`)
    if (result !== 'ok') problems.push(`case form: ${result}`)
  }

  async function shot(name, description) {
    const image = await win.webContents.capturePage()
    await fs.writeFile(path.join(shotsDir, `${name}.png`), image.toPNG())
    console.log(`${name.padEnd(14)}: ${description}`)
  }
}
