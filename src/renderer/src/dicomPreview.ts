import { applyWindow } from '@shared/dicomImage'
import type { MaskRect, PreviewFrame, WindowLevel } from '@shared/types'

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

export interface PaintOptions {
  /** Overrides the window the file asks for; ignored on colour images. */
  window?: WindowLevel | null
  /** Drawn as solid black, the same regions the upload will have blanked. */
  masks?: MaskRect[]
}

export function paintFrame(canvas: HTMLCanvasElement, frame: PreviewFrame, options: PaintOptions = {}): void {
  canvas.width = frame.width
  canvas.height = frame.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get a 2D context')

  const rgba = frame.kind === 'grey' ? applyWindow(frame, options.window ?? frame.window).rgba : frame.rgba
  // The bridge hands back a plain array-like; ImageData needs a clamped array.
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), frame.width, frame.height), 0, 0)

  ctx.fillStyle = '#000'
  for (const mask of options.masks ?? []) {
    ctx.fillRect(mask.x * frame.width, mask.y * frame.height, mask.width * frame.width, mask.height * frame.height)
  }
}
