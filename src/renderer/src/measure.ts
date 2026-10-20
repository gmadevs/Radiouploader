import type { Point } from '@shared/annotate/raster'
import type { PixelScale, PreviewFrame } from '@shared/types'
import { usesHounsfield } from '@shared/windowPresets'

/**
 * Measurements drawn on an annotated copy: a length, an angle, the values in
 * an ellipse, and an arrow that points at something.
 *
 * Each belongs to one image, by its index in the stack as it arrived, the way
 * a structure's keys do; nothing is filled in between images. The text is
 * worked out when the measurement is drawn or moved, from the frame on screen,
 * and kept with it, because that is the only time the image's values are at
 * hand. The values are those of the frame the dialog shows, which is the image
 * itself up to 1024 pixels and a reduction of it, by nearest pixel, beyond.
 */

export type MeasureKind = 'ruler' | 'angle' | 'roi' | 'arrow'

export interface Measurement {
  id: string
  kind: MeasureKind
  /** The image it is on, by its index in the stack as it arrived. */
  index: number
  /**
   * In grid pixels. A ruler and an arrow are two ends (an arrow's head second),
   * an angle is an arm's end, the vertex and the other arm's end, and an ROI is
   * two opposite corners of the box its ellipse fills.
   */
  points: Point[]
  color: string
  /** What is written beside it, a line per entry. */
  label: string[]
}

/** How many points each kind is drawn with. */
export const POINTS: Record<MeasureKind, number> = { ruler: 2, angle: 3, roi: 2, arrow: 2 }

let nextId = 1

export function createMeasurement(kind: MeasureKind, index: number, points: Point[], color: string): Measurement {
  return { id: `measurement-${nextId++}`, kind, index, points, color, label: [] }
}

/** A figure at the precision a reader can use: one decimal below 100, none above. */
function figure(value: number): string {
  return Math.abs(value) >= 100 ? String(Math.round(value)) : (Math.round(value * 10) / 10).toFixed(1)
}

/** The distance between two grid points, in millimetres, or in pixels without a scale. */
export function distance(a: Point, b: Point, scale: PixelScale | null): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  return scale ? Math.hypot(dx * scale.column, dy * scale.row) : Math.hypot(dx, dy)
}

/**
 * The angle at the vertex, in degrees, between 0 and 180.
 *
 * Measured in millimetres where there is a scale: on pixels that are not
 * square, the angle on the grid is not the angle in the patient.
 */
export function angleAt(a: Point, vertex: Point, c: Point, scale: PixelScale | null): number {
  const sx = scale?.column ?? 1
  const sy = scale?.row ?? 1
  const u = [(a[0] - vertex[0]) * sx, (a[1] - vertex[1]) * sy]
  const v = [(c[0] - vertex[0]) * sx, (c[1] - vertex[1]) * sy]
  const lengths = Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1])
  if (lengths === 0) return 0
  const cosine = Math.min(1, Math.max(-1, (u[0] * v[0] + u[1] * v[1]) / lengths))
  return (Math.acos(cosine) * 180) / Math.PI
}

export interface RoiStats {
  /** How many pixels fell inside, which is what the mean and the deviation are of. */
  count: number
  mean: number
  sd: number
  min: number
  max: number
}

/** The ellipse an ROI's two corners make: its centre and its two radii, in grid pixels. */
export function ellipseOf(a: Point, b: Point): { cx: number; cy: number; rx: number; ry: number } {
  return {
    cx: (a[0] + b[0]) / 2,
    cy: (a[1] + b[1]) / 2,
    rx: Math.abs(b[0] - a[0]) / 2,
    ry: Math.abs(b[1] - a[1]) / 2
  }
}

/**
 * The values inside an ellipse: every pixel whose centre is in it.
 *
 * Null when none is, which an ellipse narrower than a pixel can be. The
 * deviation is the sample one, as a workstation reports it.
 */
export function roiStats(values: Float32Array, width: number, height: number, a: Point, b: Point): RoiStats | null {
  const { cx, cy, rx, ry } = ellipseOf(a, b)
  if (rx <= 0 || ry <= 0) return null
  const x0 = Math.max(0, Math.floor(cx - rx))
  const x1 = Math.min(width - 1, Math.ceil(cx + rx))
  const y0 = Math.max(0, Math.floor(cy - ry))
  const y1 = Math.min(height - 1, Math.ceil(cy + ry))

  let count = 0
  let sum = 0
  let squares = 0
  let min = Infinity
  let max = -Infinity
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - cy) / ry
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / rx
      if (dx * dx + dy * dy > 1) continue
      const value = values[y * width + x]
      count++
      sum += value
      squares += value * value
      if (value < min) min = value
      if (value > max) max = value
    }
  }
  if (count === 0) return null
  const mean = sum / count
  const variance = count > 1 ? Math.max(0, (squares - count * mean * mean) / (count - 1)) : 0
  return { count, mean, sd: Math.sqrt(variance), min, max }
}

/** The area of an ROI's ellipse, in square centimetres, or in pixels without a scale. */
export function roiArea(a: Point, b: Point, scale: PixelScale | null): number {
  const { rx, ry } = ellipseOf(a, b)
  const area = Math.PI * rx * ry
  return scale ? (area * scale.column * scale.row) / 100 : area
}

/**
 * The text beside a measurement, worked out from the frame it was drawn on.
 *
 * A length without a scale is in pixels and says so. Values are Hounsfield
 * units on a CT and bare numbers elsewhere, since an MR's values are the
 * scanner's own and a unit after them would name something they are not.
 */
export function describe(measurement: Measurement, frame: PreviewFrame, modality: string | null): string[] {
  const scale = frame.scale ?? null
  const [a, b, c] = measurement.points
  switch (measurement.kind) {
    case 'arrow':
      return []
    case 'ruler': {
      const length = distance(a, b, scale)
      return [scale ? `${figure(length)} mm` : `${Math.round(length)} px`]
    }
    case 'angle':
      return c ? [`${figure(angleAt(a, b, c, scale))}°`] : []
    case 'roi': {
      const area = roiArea(a, b, scale)
      const size = scale ? `${area.toFixed(2)} cm²` : `${Math.round(area)} px²`
      if (frame.kind !== 'grey') return [size]
      const stats = roiStats(frame.values, frame.width, frame.height, a, b)
      if (stats === null) return [size]
      const unit = usesHounsfield(modality) ? ' HU' : ''
      return [`Mean ${figure(stats.mean)}${unit}, SD ${figure(stats.sd)}`, size]
    }
  }
}

/**
 * The measurement point under the pointer on this image, the most recent
 * first, within `reach` grid pixels; null where there is none.
 */
export function handleAt(
  measurements: readonly Measurement[],
  index: number,
  at: Point,
  reach: number
): { id: string; point: number } | null {
  for (let m = measurements.length - 1; m >= 0; m--) {
    const measurement = measurements[m]
    if (measurement.index !== index) continue
    for (let p = measurement.points.length - 1; p >= 0; p--) {
      const [x, y] = measurement.points[p]
      if (Math.hypot(at[0] - x, at[1] - y) <= reach) return { id: measurement.id, point: p }
    }
  }
  return null
}

/** Too small to mean anything: a click where a drag was meant. */
export function isDegenerate(measurement: Measurement): boolean {
  const [a, b] = measurement.points
  if (measurement.kind === 'roi') return Math.abs(b[0] - a[0]) < 2 || Math.abs(b[1] - a[1]) < 2
  return Math.hypot(b[0] - a[0], b[1] - a[1]) < 2
}

/** What a measurement is called in the list beside the image. */
export const KIND_NAMES: Record<MeasureKind, string> = { ruler: 'Length', angle: 'Angle', roi: 'ROI', arrow: 'Arrow' }
