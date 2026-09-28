/**
 * Drawing on binary masks: one byte per pixel, row-major, 1 inside.
 *
 * Taken from Radioillustrator (github.com/gmadevs/RadioIllustrator), which is
 * where these were first written and tested. A pixel (x, y) covers [x, x+1), so
 * its centre is at x + 0.5, and everything here decides by centres.
 */

export type Point = [number, number]

/** Paint (1) or erase (0) a round brush along the segment a → b. */
export function stroke(
  mask: Uint8Array,
  width: number,
  height: number,
  a: Point,
  b: Point,
  radius: number,
  value: 0 | 1
): void {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1])
  // Close enough together that a fast stroke is a line and not a row of beads.
  const steps = Math.max(1, Math.ceil(length / Math.max(0.5, radius / 3)))
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    disc(mask, width, height, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, radius, value)
  }
}

function disc(
  mask: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  value: 0 | 1
): void {
  const r2 = radius * radius
  const y0 = Math.max(0, Math.floor(cy - radius))
  const y1 = Math.min(height - 1, Math.ceil(cy + radius))
  const x0 = Math.max(0, Math.floor(cx - radius))
  const x1 = Math.min(width - 1, Math.ceil(cx + radius))
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx
      if (dx * dx + dy * dy <= r2) mask[y * width + x] = value
    }
  }
  // A brush smaller than a pixel reaches no centre, and would draw nothing.
  if (radius < 0.71) {
    const x = Math.floor(cx)
    const y = Math.floor(cy)
    if (x >= 0 && y >= 0 && x < width && y < height) mask[y * width + x] = value
  }
}

/** Set every pixel whose centre lies inside the polygon, by the even-odd rule. */
export function fillPolygon(mask: Uint8Array, width: number, height: number, points: Point[], value: 0 | 1): void {
  if (points.length < 3) return
  const crossings: number[] = []
  for (let y = 0; y < height; y++) {
    const cy = y + 0.5
    crossings.length = 0
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i]
      const [x2, y2] = points[(i + 1) % points.length]
      if ((y1 <= cy && y2 > cy) || (y2 <= cy && y1 > cy)) {
        crossings.push(x1 + ((cy - y1) / (y2 - y1)) * (x2 - x1))
      }
    }
    crossings.sort((a, b) => a - b)
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil(crossings[k] - 0.5))
      const to = Math.min(width - 1, Math.floor(crossings[k + 1] - 0.5))
      for (let x = from; x <= to; x++) mask[y * width + x] = value
    }
  }
}

export function isEmpty(mask: Uint8Array): boolean {
  for (let i = 0; i < mask.length; i++) if (mask[i]) return false
  return true
}
