import type { Grid, LegendBitmap } from '@shared/annotate/paint'
import type { Structure } from '@shared/annotate/structures'

/**
 * The legend of an annotated copy: a box in the lower left corner with each
 * structure's colour and name, sized to the image so it reads the same on a
 * 256-pixel CT and a 1024-pixel radiograph. Drawn here because text needs a
 * canvas; the pixels go to the main process with the drawing.
 */

/** Structures that go in the legend: shown, and drawn on at least one image. */
export function legendEntries(structures: Structure[]): Structure[] {
  return structures.filter(
    (structure) => structure.visible && [...structure.keys.values()].some((mask) => mask.some((v) => v))
  )
}

export interface LegendLayout {
  font: number
  pad: number
  swatch: number
  line: number
  x: number
  y: number
  width: number
  height: number
}

/** Where the box goes and how big its parts are, given the widest name. */
export function legendLayout(count: number, textWidth: number, grid: Grid): LegendLayout {
  const font = Math.max(11, Math.round(Math.min(grid.width, grid.height) * 0.032))
  const pad = Math.round(font * 0.6)
  const swatch = Math.round(font * 0.9)
  const line = Math.round(font * 1.4)
  const width = Math.min(grid.width - pad, Math.ceil(pad * 3 + swatch + textWidth))
  const height = Math.min(grid.height - pad, pad * 2 + line * count - (line - font))
  return { font, pad, swatch, line, x: pad, y: grid.height - pad - height, width, height }
}

const FONT = '-apple-system, "Helvetica Neue", Arial, sans-serif'

export function renderLegend(structures: Structure[], grid: Grid): LegendBitmap | null {
  const entries = legendEntries(structures)
  if (entries.length === 0) return null

  const measure = new OffscreenCanvas(1, 1).getContext('2d')
  if (!measure) return null
  const probe = legendLayout(entries.length, 0, grid)
  measure.font = `600 ${probe.font}px ${FONT}`
  const textWidth = Math.max(...entries.map((s) => measure.measureText(s.name).width))
  const layout = legendLayout(entries.length, textWidth, grid)

  const canvas = new OffscreenCanvas(layout.width, layout.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
  ctx.fillRect(0, 0, layout.width, layout.height)
  ctx.font = `600 ${layout.font}px ${FONT}`
  ctx.textBaseline = 'middle'
  entries.forEach((structure, i) => {
    const cy = layout.pad + layout.font / 2 + i * layout.line
    ctx.fillStyle = structure.color
    ctx.fillRect(layout.pad, Math.round(cy - layout.swatch / 2), layout.swatch, layout.swatch)
    ctx.fillStyle = '#fff'
    ctx.fillText(structure.name, layout.pad * 2 + layout.swatch, cy)
  })

  const { data } = ctx.getImageData(0, 0, layout.width, layout.height)
  return { x: layout.x, y: layout.y, width: layout.width, height: layout.height, rgba: data }
}
