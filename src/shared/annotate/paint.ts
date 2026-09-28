import { maskAt, type Structure } from './structures'

/**
 * Laying the structures over an image.
 *
 * One function for the dialog and for the files it writes, so the series that
 * goes up is the picture that was on screen. The masks are drawn on the frame
 * the dialog was shown, which is the image itself up to 1024 pixels and a
 * reduction of it beyond, so they are read here by nearest pixel at whatever
 * size the image is.
 */

export interface Grid {
  width: number
  height: number
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Paint the structures of one image into its pixels, in place.
 *
 * `pixels` is interleaved, `channels` samples per pixel (4 for the canvas, 3
 * for a DICOM file), and is taken as opaque. Each structure is a translucent
 * fill and, with `outline`, an opaque line one mask pixel wide along its edge.
 * Later structures go over earlier ones.
 */
export function paintStructures(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: 3 | 4,
  structures: Structure[],
  index: number,
  grid: Grid
): void {
  const layers = structures
    .filter((structure) => structure.visible)
    .map((structure) => ({ structure, mask: maskAt(structure, index) }))
    .filter((layer): layer is { structure: Structure; mask: Uint8Array } => layer.mask !== undefined)
  if (layers.length === 0) return

  const gw = grid.width
  const gh = grid.height
  // Which mask pixel each image column and row reads, worked out once.
  const columnOf = Int32Array.from({ length: width }, (_, x) => Math.min(gw - 1, Math.floor((x * gw) / width)))
  const rowOf = Int32Array.from({ length: height }, (_, y) => Math.min(gh - 1, Math.floor((y * gh) / height)))

  for (const { structure, mask } of layers) {
    const [r, g, b] = hexToRgb(structure.color)
    const fill = Math.min(Math.max(structure.opacity, 0), 1)
    for (let y = 0; y < height; y++) {
      const my = rowOf[y]
      for (let x = 0; x < width; x++) {
        const mx = columnOf[x]
        const m = my * gw + mx
        if (!mask[m]) continue
        const edge =
          structure.outline &&
          (mx === 0 || my === 0 || mx === gw - 1 || my === gh - 1 || !mask[m - 1] || !mask[m + 1] || !mask[m - gw] || !mask[m + gw])
        const alpha = edge ? 1 : fill
        const o = (y * width + x) * channels
        // Rounded here: a Uint8Array truncates and a clamped one rounds, and the
        // file and the screen are one of each.
        pixels[o] = Math.round(r * alpha + pixels[o] * (1 - alpha))
        pixels[o + 1] = Math.round(g * alpha + pixels[o + 1] * (1 - alpha))
        pixels[o + 2] = Math.round(b * alpha + pixels[o + 2] * (1 - alpha))
      }
    }
  }
}
