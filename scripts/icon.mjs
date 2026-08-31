/**
 * The app icon, cut out of the artwork rather than by hand.
 *
 * The art arrives as a rounded square drawn on white paper, in whatever size
 * and proportion the tool that made it chose. What the platforms want is a
 * square PNG with the paper **transparent**: macOS applies no mask of its own,
 * so a white background is not ignored — it is shown, as a white box with the
 * icon sitting inside it.
 *
 * Doing that once by hand would work and then go stale the day the art changes,
 * which is the same argument the screenshots are generated for. One command
 * instead, and the source of record stays the file the artist gave.
 *
 * There is no image library in this project and none is added for this: Chromium
 * is already here, and a canvas does the whole job.
 *
 * Run with: npm run icon
 */
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const resources = path.join(root, 'resources')

/** What the .icns, the .ico and the Linux icon are all generated from. */
const SIZE = 1024

/**
 * How much of that square the artwork is allowed.
 *
 * Not all of it: a macOS icon is drawn on a grid where the rounded square is
 * 824 of 1024, and one that reaches the edges sits noticeably larger than its
 * neighbours in the Dock. 840 is what the icon this replaces measured, so the
 * app keeps the presence it already had.
 */
const SHAPE = 840

/** Names tried in order; the first that exists is the artwork. */
const SOURCES = ['icon-src.png', 'icon-src.jpeg', 'icon-src.jpg']

/**
 * Every file cut from the artwork, and how big.
 *
 * The home screen shows the same mark at 96 CSS pixels and the bundler inlines
 * it as a data URI, so it gets a 256-pixel cut of its own: the 1024 one is half
 * a megabyte, and base64 of it would sit in the renderer bundle to be drawn at
 * a twelfth of its size. No Dock grid applies inside a window, so that one is
 * full-bleed.
 */
const OUTPUTS = [
  {
    size: SIZE,
    shape: SHAPE,
    targets: [path.join(resources, 'icon.png'), path.join(root, 'docs/public/favicon.png')]
  },
  { size: 256, shape: 256, targets: [path.join(root, 'src/renderer/src/assets/logo.png')] }
]

app.whenReady().then(run).catch((err) => {
  console.error(err)
  app.exit(1)
})

async function run() {
  let source = null
  for (const name of SOURCES) {
    const file = path.join(resources, name)
    const bytes = await fs.readFile(file).catch(() => null)
    if (bytes) {
      source = { name, bytes }
      break
    }
  }
  if (!source) {
    console.error(`PROBLEMS: no artwork in resources/ — expected one of ${SOURCES.join(', ')}`)
    app.exit(1)
    return
  }

  const type = source.name.endsWith('.png') ? 'image/png' : 'image/jpeg'
  const dataUrl = `data:${type};base64,${source.bytes.toString('base64')}`

  const win = new BrowserWindow({ show: false, width: SIZE, height: SIZE })
  await win.loadURL('about:blank')

  let last = null
  for (const { size, shape, targets } of OUTPUTS) {
    const result = await win.webContents.executeJavaScript(
      `(${cutOut.toString()})(${JSON.stringify(dataUrl)}, ${size}, ${shape})`
    )
    if (typeof result === 'string') {
      console.error(`PROBLEMS: ${result}`)
      app.exit(1)
      return
    }
    last = result

    const png = Buffer.from(result.png.replace(/^data:image\/png;base64,/, ''), 'base64')
    for (const target of targets) {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, png)
      console.log(
        `${path.relative(root, target).padEnd(32)}: ${size}x${size}, ${Math.round(png.byteLength / 1024)} KB`
      )
    }
  }
  console.log(
    `from ${source.name}: shape ${last.width}x${last.height} at ${last.scale.toFixed(2)}x` +
      (last.scale > 1 ? ' — enlarged, so a bigger original would be better' : '')
  )
  console.log('ICON OK')
  app.exit(0)
}

/**
 * Runs in the page. Everything below this line is Chromium's, not Node's.
 *
 * The paper is found by flooding in from the edges rather than by testing every
 * pixel for whiteness: the brightest parts of the artwork itself are not white,
 * but they are close enough that a plain threshold would eat them, and they are
 * never connected to the border. What the flood reaches is paper; what it does
 * not is the icon, whatever colour it happens to be.
 */
function cutOut(dataUrl, size, shape) {
  return new Promise((resolve) => {
    const image = new Image()
    image.onerror = () => resolve('the artwork could not be decoded')
    image.onload = () => {
      const w = image.naturalWidth
      const h = image.naturalHeight
      const source = document.createElement('canvas')
      source.width = w
      source.height = h
      const sourceCtx = source.getContext('2d', { willReadFrequently: true })
      sourceCtx.drawImage(image, 0, 0)

      const data = sourceCtx.getImageData(0, 0, w, h)
      const px = data.data
      const luminance = (i) => 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]

      // Paper, and the halo a JPEG leaves around a hard edge: the first is what
      // the flood spreads through, the second is what it is allowed to take
      // when it is already touching paper.
      const PAPER = 230
      const HALO = 200

      const isPaper = new Uint8Array(w * h)
      const queue = []
      const consider = (x, y) => {
        if (x < 0 || y < 0 || x >= w || y >= h) return
        const i = y * w + x
        if (isPaper[i] || luminance(i) < PAPER) return
        isPaper[i] = 1
        queue.push(i)
      }
      for (let x = 0; x < w; x++) {
        consider(x, 0)
        consider(x, h - 1)
      }
      for (let y = 0; y < h; y++) {
        consider(0, y)
        consider(w - 1, y)
      }
      for (let head = 0; head < queue.length; head++) {
        const i = queue[head]
        const x = i % w
        const y = (i - x) / w
        consider(x - 1, y)
        consider(x + 1, y)
        consider(x, y - 1)
        consider(x, y + 1)
      }
      // One pass outwards into the halo, so the edge does not keep a pale fringe.
      const fringe = []
      for (let i = 0; i < isPaper.length; i++) {
        if (isPaper[i] || luminance(i) < HALO) continue
        const x = i % w
        const y = (i - x) / w
        const touches =
          (x > 0 && isPaper[i - 1]) ||
          (x < w - 1 && isPaper[i + 1]) ||
          (y > 0 && isPaper[i - w]) ||
          (y < h - 1 && isPaper[i + w])
        if (touches) fringe.push(i)
      }
      for (const i of fringe) isPaper[i] = 1

      let left = w
      let top = h
      let right = -1
      let bottom = -1
      for (let i = 0; i < isPaper.length; i++) {
        if (isPaper[i]) {
          px[i * 4 + 3] = 0
          continue
        }
        const x = i % w
        const y = (i - x) / w
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
      if (right < left || bottom < top) {
        resolve('the artwork is all paper — nothing to cut out')
        return
      }
      sourceCtx.putImageData(data, 0, 0)

      // Fitted rather than stretched, and centred. The shape is rarely exactly
      // square, and squaring it turns the round part of a drawing into an
      // ellipse — which on this icon is the nodule, the whole subject of it.
      const shapeWidth = right - left + 1
      const shapeHeight = bottom - top + 1
      const scale = shape / Math.max(shapeWidth, shapeHeight)

      const out = document.createElement('canvas')
      out.width = size
      out.height = size
      const ctx = out.getContext('2d')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(
        source,
        left,
        top,
        shapeWidth,
        shapeHeight,
        (size - shapeWidth * scale) / 2,
        (size - shapeHeight * scale) / 2,
        shapeWidth * scale,
        shapeHeight * scale
      )

      resolve({ png: out.toDataURL('image/png'), width: shapeWidth, height: shapeHeight, scale })
    }
    image.src = dataUrl
  })
}
