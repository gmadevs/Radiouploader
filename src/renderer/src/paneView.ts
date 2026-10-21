import type { FitRect } from './dicomPreview'

/**
 * Zooming into a pane and moving about in it.
 *
 * Kept in fractions of the fitted image rather than in canvas pixels, because
 * the canvas is resized under it whenever the window is, and a view in pixels
 * would point somewhere else after every resize.
 */
export interface PaneView {
  /** 1 is the whole image fitted to the pane. */
  zoom: number
  /** How far the image is moved from the middle, in widths and heights of the fitted image. */
  x: number
  y: number
}

export const FITTED: PaneView = { zoom: 1, x: 0, y: 0 }

/** Eight times is past the preview's own pixels on any pane this dialog has. */
export const MAX_ZOOM = 8

/** Where the image is drawn once the view is applied to the rectangle it fits. */
export function viewRect(fit: FitRect, view: PaneView): FitRect {
  const width = fit.width * view.zoom
  const height = fit.height * view.zoom
  return {
    x: fit.x + (fit.width - width) / 2 + view.x * fit.width,
    y: fit.y + (fit.height - height) / 2 + view.y * fit.height,
    width,
    height
  }
}

/**
 * Keep the image over the whole of the space it fitted.
 *
 * At most half the extra size either way, so a pan can show any edge but never
 * leave black where the image used to be, and zooming back out to 1 puts it
 * back in the middle without a separate rule.
 */
function clamp(view: PaneView): PaneView {
  const zoom = Math.min(Math.max(view.zoom, 1), MAX_ZOOM)
  const reach = (zoom - 1) / 2
  return {
    zoom,
    x: reach > 0 ? Math.min(Math.max(view.x, -reach), reach) : 0,
    y: reach > 0 ? Math.min(Math.max(view.y, -reach), reach) : 0
  }
}

/** Zoom by `factor`, keeping the point of the image under `at` (canvas pixels) where it is. */
export function zoomAt(fit: FitRect, view: PaneView, at: { x: number; y: number }, factor: number): PaneView {
  const shown = viewRect(fit, view)
  const u = (at.x - shown.x) / shown.width
  const v = (at.y - shown.y) / shown.height
  const zoom = Math.min(Math.max(view.zoom * factor, 1), MAX_ZOOM)
  return clamp({
    zoom,
    x: (at.x - u * fit.width * zoom - fit.x - (fit.width - fit.width * zoom) / 2) / fit.width,
    y: (at.y - v * fit.height * zoom - fit.y - (fit.height - fit.height * zoom) / 2) / fit.height
  })
}

/** Move the image by a drag of `dx`, `dy` canvas pixels. */
export function panBy(fit: FitRect, view: PaneView, dx: number, dy: number): PaneView {
  return clamp({ ...view, x: view.x + dx / fit.width, y: view.y + dy / fit.height })
}

/**
 * How much one wheel event zooms.
 *
 * A trackpad pinch arrives as a stream of small deltas with ctrlKey set, and
 * Chromium sizes them so that exp(-delta / 100) is the pinch's own scale, which
 * is why that is the curve: a pinch follows the fingers and lands back where it
 * started. A mouse notch is a single delta of 100 or more, which on the same
 * curve went to eight times in as many notches; capped, a notch is about 1.3×.
 */
const MOST_PER_EVENT = 25

export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  if (!Number.isFinite(pixels)) return 1
  return Math.exp(-Math.max(Math.min(pixels, MOST_PER_EVENT), -MOST_PER_EVENT) * 0.01)
}
