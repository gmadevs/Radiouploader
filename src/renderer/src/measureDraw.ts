import type { Grid, LegendBitmap } from '@shared/annotate/paint'
import type { Point } from '@shared/annotate/raster'
import { ellipseOf, type Measurement } from './measure'

/**
 * The measurements of one image, as pixels.
 *
 * Drawn here for the reason the legend is: they carry text, and text needs a
 * canvas the main process does not have. The bitmap is the one laid over the
 * image on screen and the one sent with the drawing, so the copy carries the
 * picture that was looked at. It is cut to what was drawn, so an image with a
 * ruler in one corner does not send a megapixel of nothing.
 */

const FONT = '-apple-system, "Helvetica Neue", Arial, sans-serif'

/** Line and text sizes, from the grid, so they read the same on a 256-pixel CT and a 1024-pixel radiograph. */
export function measureSizes(grid: Grid): { line: number; font: number; tick: number; head: number } {
  const edge = Math.min(grid.width, grid.height)
  // Smaller than the legend's: a legend is one box in a corner, and these sit
  // on the anatomy, several to an image.
  const line = Math.max(1.25, edge * 0.004)
  const font = Math.max(9, Math.round(edge * 0.026))
  return { line, font, tick: font * 0.4, head: font * 0.7 }
}

function strokeOutlined(ctx: OffscreenCanvasRenderingContext2D, color: string, line: number): void {
  ctx.lineWidth = line + 2
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)'
  ctx.stroke()
  ctx.lineWidth = line
  ctx.strokeStyle = color
  ctx.stroke()
}

/** Text with a dark edge, so it reads on bone and on air alike; kept inside the grid. */
function label(
  ctx: OffscreenCanvasRenderingContext2D,
  lines: string[],
  at: Point,
  color: string,
  font: number,
  grid: Grid
): void {
  if (lines.length === 0) return
  ctx.font = `500 ${font}px ${FONT}`
  ctx.textBaseline = 'top'
  const height = font * 1.25
  const width = Math.max(...lines.map((text) => ctx.measureText(text).width))
  const x = Math.min(Math.max(at[0], 2), grid.width - width - 2)
  const y = Math.min(Math.max(at[1], 2), grid.height - height * lines.length - 2)
  ctx.lineJoin = 'round'
  lines.forEach((text, i) => {
    ctx.lineWidth = Math.max(1.5, font / 6)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)'
    ctx.strokeText(text, x, y + i * height)
    ctx.fillStyle = color
    ctx.fillText(text, x, y + i * height)
  })
}

function draw(ctx: OffscreenCanvasRenderingContext2D, measurement: Measurement, grid: Grid): void {
  const { line, font, tick, head } = measureSizes(grid)
  const [a, b, c] = measurement.points
  const color = measurement.color
  ctx.lineCap = 'round'

  switch (measurement.kind) {
    case 'ruler': {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      // Short ticks across each end, which is how a ruler says where it stops.
      const nx = (-(b[1] - a[1]) / length) * tick
      const ny = ((b[0] - a[0]) / length) * tick
      ctx.beginPath()
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(b[0], b[1])
      for (const [x, y] of [a, b]) {
        ctx.moveTo(x - nx, y - ny)
        ctx.lineTo(x + nx, y + ny)
      }
      strokeOutlined(ctx, color, line)
      label(ctx, measurement.label, [b[0] + font * 0.5, b[1] + font * 0.3], color, font, grid)
      break
    }
    case 'arrow': {
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0])
      ctx.beginPath()
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(b[0] - Math.cos(angle) * head * 0.6, b[1] - Math.sin(angle) * head * 0.6)
      strokeOutlined(ctx, color, line)
      ctx.beginPath()
      ctx.moveTo(b[0], b[1])
      ctx.lineTo(b[0] - Math.cos(angle - 0.45) * head, b[1] - Math.sin(angle - 0.45) * head)
      ctx.lineTo(b[0] - Math.cos(angle + 0.45) * head, b[1] - Math.sin(angle + 0.45) * head)
      ctx.closePath()
      ctx.lineWidth = 2
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)'
      ctx.stroke()
      ctx.fillStyle = color
      ctx.fill()
      break
    }
    case 'angle': {
      ctx.beginPath()
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(b[0], b[1])
      if (c) ctx.lineTo(c[0], c[1])
      strokeOutlined(ctx, color, line)
      if (c) {
        const from = Math.atan2(a[1] - b[1], a[0] - b[0])
        const to = Math.atan2(c[1] - b[1], c[0] - b[0])
        let sweep = to - from
        while (sweep > Math.PI) sweep -= 2 * Math.PI
        while (sweep < -Math.PI) sweep += 2 * Math.PI
        const radius = Math.min(font * 1.5, Math.hypot(a[0] - b[0], a[1] - b[1]) / 2, Math.hypot(c[0] - b[0], c[1] - b[1]) / 2)
        ctx.beginPath()
        ctx.arc(b[0], b[1], radius, from, from + sweep, sweep < 0)
        strokeOutlined(ctx, color, line * 0.75)
        // Outside the angle, on the line that halves it, so the text is not on the arms.
        const middle = from + sweep / 2
        const out = radius + font * 0.4
        label(ctx, measurement.label, [b[0] - Math.cos(middle) * out - font, b[1] - Math.sin(middle) * out - font * 0.6], color, font, grid)
      }
      break
    }
    case 'roi': {
      const { cx, cy, rx, ry } = ellipseOf(a, b)
      ctx.beginPath()
      ctx.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2)
      strokeOutlined(ctx, color, line)
      label(ctx, measurement.label, [cx - rx, cy + ry + font * 0.3], color, font, grid)
      break
    }
  }
}

/** The measurements on one image, drawn and cut to their extent; null where there are none. */
export function renderMeasurements(measurements: readonly Measurement[], index: number, grid: Grid): LegendBitmap | null {
  const here = measurements.filter((measurement) => measurement.index === index)
  if (here.length === 0) return null

  const canvas = new OffscreenCanvas(grid.width, grid.height)
  // Read back on every move of a point, which is what this flag is for.
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  for (const measurement of here) draw(ctx, measurement, grid)

  const { data } = ctx.getImageData(0, 0, grid.width, grid.height)
  let x0 = grid.width
  let y0 = grid.height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (data[(y * grid.width + x) * 4 + 3] === 0) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) return null
  const width = x1 - x0 + 1
  const height = y1 - y0 + 1
  return { x: x0, y: y0, width, height, rgba: ctx.getImageData(x0, y0, width, height).data }
}
