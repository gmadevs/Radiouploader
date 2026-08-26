import { applyWindow, cropBoundsOf } from '@shared/dicomImage'
import type { CropRect, MaskRect, PreviewFrame, WindowLevel } from '@shared/types'

/**
 * Painting only. Decoding happens in the main process, which reads a single
 * frame's byte range instead of moving a whole DICOM file across the bridge.
 *
 * Greyscale frames arrive unwindowed, so choosing a window is a pass over
 * values already here — fast enough to redo on every step of a drag.
 */
export async function loadFrame(filePath: string, frame: number, maxEdge?: number): Promise<PreviewFrame> {
  return window.api.readPreviewFrame(filePath, frame, maxEdge)
}

/**
 * The readable half of a failed preview.
 *
 * An error raised in the main process reaches the renderer wrapped by Electron:
 * "Error invoking remote method 'preview:frame': UnsupportedTransferSyntaxError:
 * JPEG baseline is not supported for preview yet". Only the last clause says
 * anything to whoever is looking at the missing image.
 */
export function previewErrorText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^\w*Error:\s*/, '')
}

export interface PaintOptions {
  /** Overrides the window the file asks for; ignored on colour images. */
  window?: WindowLevel | null
  /** Drawn as solid black, the same regions the upload will have blanked. */
  masks?: MaskRect[]
  /**
   * Draw only this part of the frame, so the canvas shows what is going to be
   * uploaded rather than what the file holds. The viewer does not pass it: an
   * editor that hides what is being cut away cannot be used to aim the cut.
   */
  crop?: CropRect | null
}

export function paintFrame(canvas: HTMLCanvasElement, frame: PreviewFrame, options: PaintOptions = {}): void {
  const rgba = frame.kind === 'grey' ? applyWindow(frame, options.window ?? frame.window).rgba : frame.rgba

  // The whole frame is drawn first, masks and all, and the crop then takes a
  // rectangle out of it — because a mask is a fraction of the uncropped image,
  // which is the picture it was drawn on.
  const source = new OffscreenCanvas(frame.width, frame.height)
  const sourceCtx = source.getContext('2d')
  if (!sourceCtx) throw new Error('Could not get a 2D context')
  // The bridge hands back a plain array-like; ImageData needs a clamped array.
  sourceCtx.putImageData(new ImageData(new Uint8ClampedArray(rgba), frame.width, frame.height), 0, 0)
  sourceCtx.fillStyle = '#000'
  for (const mask of options.masks ?? []) {
    sourceCtx.fillRect(
      mask.x * frame.width,
      mask.y * frame.height,
      mask.width * frame.width,
      mask.height * frame.height
    )
  }

  const crop = options.crop ? cropBoundsOf(options.crop, frame.width, frame.height) : null
  canvas.width = crop ? crop.columns : frame.width
  canvas.height = crop ? crop.rows : frame.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get a 2D context')
  ctx.drawImage(source, crop?.x ?? 0, crop?.y ?? 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
}

/** Where a frame lands inside a canvas that is not its shape, in canvas pixels. */
export interface FitRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Fit a frame into a box, keeping its proportions.
 *
 * Returned rather than applied, because whatever draws on top of the image —
 * a crosshair — and whatever reads a position back out of it have to agree
 * with the drawing about where the image actually is.
 */
export function fitRect(boxWidth: number, boxHeight: number, frameWidth: number, frameHeight: number): FitRect {
  const scale = Math.min(boxWidth / frameWidth, boxHeight / frameHeight)
  const width = frameWidth * scale
  const height = frameHeight * scale
  return { x: (boxWidth - width) / 2, y: (boxHeight - height) / 2, width, height }
}

/**
 * Paint a frame to fill a canvas of its own size, letterboxed.
 *
 * The panelled reformat view needs this rather than `paintFrame`: four images
 * of four different shapes share a grid, so each canvas is the cell and the
 * image is drawn into it rather than the other way round.
 */
export function paintFitted(
  canvas: HTMLCanvasElement,
  frame: PreviewFrame,
  window?: WindowLevel | null
): FitRect | null {
  const box = canvas.getBoundingClientRect()
  if (box.width === 0 || box.height === 0) return null

  // Draw at the screen's own resolution: a reformat is looked at closely.
  const ratio = globalThis.devicePixelRatio || 1
  canvas.width = Math.round(box.width * ratio)
  canvas.height = Math.round(box.height * ratio)

  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const rgba = frame.kind === 'grey' ? applyWindow(frame, window ?? frame.window).rgba : frame.rgba
  const source = new OffscreenCanvas(frame.width, frame.height)
  const sourceCtx = source.getContext('2d')
  if (!sourceCtx) return null
  sourceCtx.putImageData(new ImageData(new Uint8ClampedArray(rgba), frame.width, frame.height), 0, 0)

  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const fit = fitRect(canvas.width, canvas.height, frame.width, frame.height)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(source, fit.x, fit.y, fit.width, fit.height)
  return fit
}
