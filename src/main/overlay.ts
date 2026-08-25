import type { MaskRect } from '@shared/types'

/**
 * Looking for text burnt into the pixels.
 *
 * This can only ever raise suspicion. It finds obvious overlays — a patient
 * banner, a hospital name, a scanner's own annotation — and it will miss text
 * that is faint, small, or written over anatomy. **A negative result means
 * nothing was found, never that the images are clean**, and everything built on
 * top of this has to say so, or it will stop people looking.
 *
 * Two things make an overlay what it is, and both are cheap:
 *
 *  - it is drawn rather than acquired, so its pixels sit at the ends of the
 *    range — pure white or pure black — with hard edges between them;
 *  - it is burnt into the same place on every image, so it does not change
 *    while the anatomy underneath does.
 *
 * The second test is the one that separates text from bone, air and the edge of
 * an ultrasound sector, all of which are bright and sharp too. It needs two
 * images to run, so a stack of one is judged on brightness and edges alone and
 * is that much easier to fool.
 */

/** Displayed values this close to the ends of the range read as drawn, not acquired. */
const BRIGHT = 245
const DARK = 10

/** Sum of the steps to the next pixel across and down. Text edges are cliffs. */
const EDGE = 60

/** How far a pixel may move between frames and still count as unchanging. */
const STABLE = 2

/** Cells are about this many across the image, so a word covers one or two. */
const GRID = 24

/**
 * A cell has to be this densely covered in candidate pixels to count.
 *
 * Measured rather than guessed. On the sample study the banner fills 30 to 43
 * per cent of the cells it lands in, while the brightest edges of the CT and
 * the diffusion images reach 13 — an edge only ever draws a line across a cell,
 * and a line is about one pixel in twenty of it. Anything between the two is
 * where this is wrong in one direction or the other; it is set nearer the edges
 * than the text, because a cell wrongly flagged costs a look and a cell wrongly
 * cleared costs a published banner.
 */
const CELL_SHARE = 0.2

/** One cell on its own is noise; text runs along a line. */
const MIN_CELLS = 2

export interface OverlayRegions {
  /** Boxes that look like overlaid text, in fractions of the image. */
  regions: MaskRect[]
  /** Share of the image they cover, which is what orders the worst first. */
  coverage: number
}

/**
 * Regions of `frame` that look like burnt-in text.
 *
 * `other` is a second frame of the same stack, from far enough away in the
 * stack that the anatomy has moved on; pass null when there is only one image.
 * Both are 8-bit luminance as displayed, since what matters is what a reader
 * would see rather than what the file stores.
 */
export function findOverlayRegions(
  frame: Uint8Array,
  other: Uint8Array | null,
  width: number,
  height: number,
  ignore: readonly MaskRect[] = []
): OverlayRegions {
  if (width < GRID || height < GRID) return { regions: [], coverage: 0 }

  // Blanked areas are not looked at. Painting them black instead would draw a
  // hard straight edge and this would report the redaction as burnt-in text.
  const blanked = ignore.map((rect) => ({
    left: Math.floor(rect.x * width) - 1,
    top: Math.floor(rect.y * height) - 1,
    right: Math.ceil((rect.x + rect.width) * width) + 1,
    bottom: Math.ceil((rect.y + rect.height) * height) + 1
  }))

  const cell = Math.max(4, Math.floor(Math.min(width, height) / GRID))
  const cols = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)
  const hits = new Int32Array(cols * rows)

  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = y * width + x
      const value = frame[i]
      if (value < BRIGHT && value > DARK) continue
      if (Math.abs(value - frame[i + 1]) + Math.abs(value - frame[i + width]) < EDGE) continue
      if (other !== null && Math.abs(value - other[i]) > STABLE) continue
      if (blanked.some((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom)) continue
      hits[Math.floor(y / cell) * cols + Math.floor(x / cell)]++
    }
  }

  const needed = Math.max(4, Math.round(cell * cell * CELL_SHARE))
  const marked = new Uint8Array(cols * rows)
  for (let i = 0; i < hits.length; i++) marked[i] = hits[i] >= needed ? 1 : 0

  const regions: MaskRect[] = []
  let coverage = 0
  for (const group of connected(marked, cols, rows)) {
    if (group.length < MIN_CELLS) continue
    let left = cols
    let top = rows
    let right = 0
    let bottom = 0
    for (const index of group) {
      const cx = index % cols
      const cy = Math.floor(index / cols)
      left = Math.min(left, cx)
      top = Math.min(top, cy)
      right = Math.max(right, cx + 1)
      bottom = Math.max(bottom, cy + 1)
    }
    const rect = {
      x: (left * cell) / width,
      y: (top * cell) / height,
      width: Math.min((right * cell) / width, 1) - (left * cell) / width,
      height: Math.min((bottom * cell) / height, 1) - (top * cell) / height
    }
    regions.push(rect)
    coverage += rect.width * rect.height
  }
  return { regions, coverage }
}

/** Cells that touch, gathered into groups — a line of text is one of them. */
function connected(marked: Uint8Array, cols: number, rows: number): number[][] {
  const seen = new Uint8Array(marked.length)
  const groups: number[][] = []

  for (let start = 0; start < marked.length; start++) {
    if (marked[start] === 0 || seen[start] === 1) continue
    const group: number[] = []
    const queue = [start]
    seen[start] = 1
    while (queue.length > 0) {
      const index = queue.pop() as number
      group.push(index)
      const x = index % cols
      const y = Math.floor(index / cols)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ]) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
        const next = ny * cols + nx
        if (marked[next] === 1 && seen[next] === 0) {
          seen[next] = 1
          queue.push(next)
        }
      }
    }
    groups.push(group)
  }
  return groups
}
