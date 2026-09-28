/**
 * Filling the images between two drawn ones, through signed distance fields.
 *
 * Each drawn mask becomes a field that is negative inside and positive outside,
 * in pixels from its edge. Blending two fields and keeping the negative part
 * morphs one outline into the other, whatever the masks were drawn with.
 *
 * Plain blending works only where the two shapes overlap: two discs side by
 * side blend into nothing halfway. So position and shape are taken separately —
 * both fields are moved onto the centroid the image between should have, and
 * only then blended. An empty drawn image marks where a structure ends, and
 * towards it the other shape shrinks evenly to nothing.
 *
 * Taken from Radioillustrator, as `raster.ts` is.
 */

const INF = 1e20

/** Squared 1D distance transform (Felzenszwalb & Huttenlocher), over f. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
  }
}

/** Euclidean distance from every pixel to the nearest pixel where `seed` holds. */
function distanceTo(width: number, height: number, seed: (i: number) => boolean): Float32Array {
  const grid = new Float64Array(width * height)
  for (let i = 0; i < width * height; i++) grid[i] = seed(i) ? 0 : INF
  const n = Math.max(width, height)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x]
    edt1d(f, height, d, v, z)
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y]
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = grid[y * width + x]
    edt1d(f, width, d, v, z)
    for (let x = 0; x < width; x++) grid[y * width + x] = d[x]
  }
  const out = new Float32Array(width * height)
  for (let i = 0; i < width * height; i++) out[i] = Math.sqrt(grid[i])
  return out
}

export interface KeyField {
  sdf: Float32Array
  /** Centroid in pixels; NaN for an empty mask. */
  cx: number
  cy: number
  /** Distance from the edge to the deepest pixel inside. */
  depth: number
}

export function keyField(mask: Uint8Array, width: number, height: number): KeyField {
  let sx = 0
  let sy = 0
  let n = 0
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    sx += i % width
    sy += (i / width) | 0
    n++
  }
  if (!n) return { sdf: new Float32Array(0), cx: Number.NaN, cy: Number.NaN, depth: 0 }
  const toInside = distanceTo(width, height, (i) => mask[i] !== 0)
  const toOutside = distanceTo(width, height, (i) => mask[i] === 0)
  const sdf = new Float32Array(width * height)
  let depth = 0
  for (let i = 0; i < width * height; i++) {
    sdf[i] = mask[i] ? 0.5 - toOutside[i] : toInside[i] - 0.5
    if (-sdf[i] > depth) depth = -sdf[i]
  }
  return { sdf, cx: sx / n, cy: sy / n, depth }
}

/** The mask a fraction t of the way from key a to key b. */
export function blend(a: KeyField, b: KeyField, t: number, width: number, height: number): Uint8Array {
  const aEmpty = !Number.isFinite(a.cx)
  const bEmpty = !Number.isFinite(b.cx)
  if (aEmpty && bEmpty) return new Uint8Array(width * height)
  if (aEmpty || bEmpty) {
    // Erode what is left: whole at its own key, gone at the empty one.
    const k = aEmpty ? b : a
    const erosion = (aEmpty ? 1 - t : t) * (k.depth + 0.5)
    const out = new Uint8Array(width * height)
    for (let i = 0; i < out.length; i++) if (k.sdf[i] + erosion < 0) out[i] = 1
    return out
  }
  const tx = a.cx + (b.cx - a.cx) * t
  const ty = a.cy + (b.cy - a.cy) * t
  const ax = Math.round(tx - a.cx)
  const ay = Math.round(ty - a.cy)
  const bx = Math.round(tx - b.cx)
  const by = Math.round(ty - b.cy)
  const far = width + height
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const ya = y - ay
    const yb = y - by
    for (let x = 0; x < width; x++) {
      const xa = x - ax
      const xb = x - bx
      const fa = xa >= 0 && ya >= 0 && xa < width && ya < height ? a.sdf[ya * width + xa] : far
      const fb = xb >= 0 && yb >= 0 && xb < width && yb < height ? b.sdf[yb * width + xb] : far
      if ((1 - t) * fa + t * fb < 0) out[y * width + x] = 1
    }
  }
  return out
}
