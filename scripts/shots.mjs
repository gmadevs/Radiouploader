/**
 * The documentation's screenshots, taken from the real app.
 *
 * Hand-cropped screenshots go stale silently: the UI moves, the picture does
 * not, and nobody notices until a reader follows a page that describes a button
 * which no longer exists. These are regenerated from the current build with one
 * command instead — `npm run shots` — and written straight into docs/public.
 *
 * Sign-in, the folder picker, the upload and the update check are stubbed at the
 * IPC layer, so no test hook exists in the app itself and everything between
 * them is the real wiring: real ingest, real preview decoding, real
 * anonymisation.
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
/** Page expressions for the labels of the buttons on screen, and of the lit ones. */
const buttonLabels = `[...document.querySelectorAll('button')].map((b) => b.textContent.trim())`
const litButtonLabels = `[...document.querySelectorAll('button.on')].map((b) => b.textContent.trim())`
/** The bytes of the last PNG written, which the next one must not repeat. */
let lastShot = null

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
  // Whether a release exists on GitHub is not a property of this build, and a
  // banner that appears the day after a release would rewrite these PNGs with
  // nothing in the app changed. Stubbed for the same reason sign-in is.
  stub('update:check', () => ({ current: '1.0.0', latest: null, url: null, command: null, enabled: true }))
  // The only step that would leave this computer. Everything it needs from the
  // response is what the confirmation screen prints.
  stub('upload:run', () => ({ caseId: '000000', url: 'https://radiopaedia.org/cases/000000' }))

  win.webContents.reload()
  await new Promise((r) => win.webContents.once('did-finish-load', r))
  /**
   * Take the scrollbar out of the picture.
   *
   * macOS shows scrollbars only while scrolling — until a mouse is plugged in,
   * when it shows them always. Chromium follows that, so a classic scrollbar
   * appears down the right edge, takes fifteen pixels of layout with it and
   * moves everything that is right-aligned or centred: eight of these ten PNGs
   * were rewritten by connecting a mouse, with nothing in the app changed.
   *
   * Injected here rather than in the app, which needs its scrollbars. The caret
   * goes the same way: a focused field blinks, and a capture that waits for the
   * picture to hold still would wait on it for ever.
   */
  await win.webContents.insertCSS('::-webkit-scrollbar { display: none } * { caret-color: transparent !important }')
  await sleep(900)

  await shot('01-source', 'the first screen')

  await click('Choose folder')
  await settle(4000)
  await shot('02-review', 'the review step', `document.querySelectorAll('.series').length > 0 && !document.querySelector('.progress')`)

  // Trim lives behind a hover, so it is clicked rather than pointed at.
  await evaluate(`document.querySelectorAll('.trim-toggle')[0]?.click()`)
  await sleep(600)
  await shot('03-trim', 'the trim controls', `!!document.querySelector('.trim')`)
  await click('Done')
  await sleep(400)

  await openReformatOn('Chest 1.0 mm')
  await settle(6000)
  await click('MIP')
  await shot('09-reformat', 'a coronal MIP of the chest CT', isOn('MIP'))
  await click('Cancel')
  await sleep(500)

  await openViewerOn('Upper abdomen')
  await settle(2500)
  await shot(
    '04-viewer',
    'the ultrasound, banner and all',
    `!!document.querySelector('.viewer-stage canvas') && !document.querySelector('.reformat-grid')`
  )

  await click('Erase')
  // A drag that lands before the tool has changed does the old tool's work.
  await until(isOn('Erase'), 'the eraser to be the tool in hand')
  await dragOverBanner()
  await sleep(700)
  await shot('05-erase', 'the banner blanked')

  // The crop stays on for the rest of the run, so the steps after this one are
  // driven with a stack that really has been cut down.
  await click('Crop')
  await until(isOn('Crop'), 'the crop to be the tool in hand')
  // Round the sector: the strip above it is the margin the banner was sitting
  // in, and the point of the picture is that it can be cut rather than blanked.
  await dragOnCanvas({ x: 0.02, y: 0.17 }, { x: 0.99, y: 0.95 })
  await sleep(700)
  await shot('10-crop', 'the sector kept and the margins cut away', `!!document.querySelector('.crop')`)

  await click('Done')
  await sleep(600)

  await click('Anonymise and continue')
  await settle(2500)
  await shot('06-check', 'the check before anonymising', hasButton('I have checked — anonymise'))

  await click('I have checked — anonymise')
  await settle(6000)
  await until(
    `[...document.querySelectorAll('label.field')].some((l) => l.childNodes[0]?.textContent?.trim().startsWith('Title'))`,
    'the case form'
  )
  await fillCaseForm()
  await shot(
    '07-case',
    'the case form',
    `[...document.querySelectorAll('label.field input')].some((i) => i.value === 'Solitary pulmonary nodule, six months on')`
  )

  await click('Upload to Radiopaedia')
  await settle(2500)
  await shot('08-done', 'the confirmation', `!!document.querySelector('a[href$="/cases/000000/edit"]')`)

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

  /** Whether a condition holds: a page expression, or a check made here. */
  function holds(ready) {
    return typeof ready === 'function' ? ready() : evaluate(ready)
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

  /** Press a button once it is there and enabled: a busy machine renders it late. */
  async function click(label) {
    const deadline = Date.now() + 15_000
    let result
    do {
      result = await evaluate(`(() => {
        const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === ${JSON.stringify(label)})
        if (!b) return 'missing'
        if (b.disabled) return 'disabled'
        b.click()
        return 'ok'
      })()`)
      if (result === 'ok') break
      await sleep(250)
    } while (Date.now() < deadline)
    if (result !== 'ok') problems.push(`button ${JSON.stringify(label)}: ${result}`)
    await sleep(400)
  }

  /** Wait for the page to say something is so, or record what never became so. */
  async function until(ready, what, budget = 15_000) {
    const deadline = Date.now() + budget
    while (Date.now() < deadline) {
      if (await holds(ready)) return
      await sleep(250)
    }
    problems.push(`gave up waiting for ${what}`)
  }

  /**
   * A check: the button with this label is the one switched on.
   *
   * The page is asked for the labels and the match is made here, rather than
   * writing the label into the expression the page runs. A label spliced into
   * source has to be escaped for a language it is not text in — `JSON.stringify`
   * leaves U+2028 and U+2029 alone, which are line terminators in JavaScript —
   * and a label compared in this process is never code at all.
   */
  function isOn(label) {
    return async () => (await evaluate(litButtonLabels)).includes(label)
  }

  /** A check: a button with this label is on screen. */
  function hasButton(label) {
    return async () => (await evaluate(buttonLabels)).includes(label)
  }

  /** Open the reformat dialog on the series whose description contains `name`. */
  async function openReformatOn(name) {
    const result = await evaluate(`(() => {
      const series = [...document.querySelectorAll('.series')]
        .find((s) => s.querySelector('h3')?.textContent.includes(${JSON.stringify(name)}))
      const button = [...(series?.querySelectorAll('.stack-actions button') ?? [])]
        .find((b) => b.textContent.trim() === 'Reformat')
      if (!button) return 'missing'
      button.click()
      return 'ok'
    })()`)
    if (result !== 'ok') problems.push(`reformat ${JSON.stringify(name)}: ${result}`)
  }

  /** Open the viewer on the series whose description contains `name`. */
  async function openViewerOn(name) {
    const result = await evaluate(`(() => {
      const series = [...document.querySelectorAll('.series')]
        .find((s) => s.querySelector('h3')?.textContent.includes(${JSON.stringify(name)}))
      const open = [...(series?.querySelectorAll('.stack-actions button') ?? [])]
        .find((b) => b.textContent.trim() === 'Open for review')
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
  /** The banner sits in the top-left eighth of the image. */
  async function dragOverBanner() {
    return dragOnCanvas({ x: 0.01, y: 0.01 }, { x: 0.84, y: 0.19 })
  }

  /** Drag between two points given as fractions of the viewer's canvas. */
  async function dragOnCanvas(start, end) {
    const rect = await evaluate(
      `(() => { const c = document.querySelector('.viewer-stage canvas'); if (!c) return null
                const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })()`
    )
    if (!rect) {
      problems.push('no canvas to drag on')
      return
    }
    const from = { x: Math.round(rect.x + rect.w * start.x), y: Math.round(rect.y + rect.h * start.y) }
    const to = { x: Math.round(rect.x + rect.w * end.x), y: Math.round(rect.y + rect.h * end.y) }

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
        // Age and gender are not set here: the app fills them from the sample
        // study's own patient tags, and the screenshot should show that.

        set('Findings', 'A subpleural nodule in the left upper lobe, larger than on the baseline study.')
      ].filter(Boolean)
      return missing.length ? 'missing: ' + missing.join(', ') : 'ok'
    })()`)
    if (result !== 'ok') problems.push(`case form: ${result}`)
  }

  /**
   * Capture the window once it shows the step the shot is named after.
   *
   * A fixed wait before capturing is a guess at how long the app will take, and
   * on a busy machine the guess came up short: one run wrote six of these PNGs
   * each showing the screen of the step before, and still said SHOTS OK. So a
   * capture waits for three things instead — the page to be in the state the
   * shot is of, where `ready` says what that is; the picture to differ from the
   * last one written; and the picture to hold still across three captures in a
   * row, which images still decoding and panes still drawing do not. A shot
   * that never gets there is not written, and the run fails naming it.
   */
  async function shot(name, description, ready) {
    const deadline = Date.now() + 30_000
    let waiting = 'the page to be ready'
    let last = null
    let steady = 0
    while (Date.now() < deadline) {
      await sleep(400)
      if (ready && !(await holds(ready))) {
        waiting = 'the page to be ready'
        last = null
        steady = 0
        continue
      }
      /**
       * Take the pointer out of the window first.
       *
       * The real cursor stays wherever the person at the machine left it, and a
       * stack card under it opens the controls it keeps for a hover — which
       * rewrote two of these PNGs between one run and the next with nothing in
       * the app changed. Leaving the window clears every hover at once, and
       * nothing here is mid-drag when a shot is taken.
       */
      win.webContents.sendInputEvent({ type: 'mouseLeave', x: 0, y: 0 })
      const png = (await win.webContents.capturePage()).toPNG()
      if (lastShot && png.equals(lastShot)) {
        waiting = 'the window to show something other than the previous shot'
        last = null
        steady = 0
        continue
      }
      if (last && png.equals(last)) steady++
      else {
        waiting = 'the picture to hold still'
        last = png
        steady = 0
      }
      if (steady >= 2) {
        await fs.writeFile(path.join(shotsDir, `${name}.png`), png)
        lastShot = png
        console.log(`${name.padEnd(14)}: ${description}`)
        return
      }
    }
    problems.push(`${name}: not written — gave up after 30 s waiting for ${waiting}`)
  }
}
