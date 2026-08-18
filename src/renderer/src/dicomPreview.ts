import { decodeFrame, parseImage, type ParsedImage } from '@shared/dicomImage'

export { UnsupportedTransferSyntaxError } from '@shared/dicomImage'

/** Cache parsed headers per file; scrubbing a stack revisits the same file constantly. */
const cache = new Map<string, ParsedImage>()
const MAX_CACHED_FILES = 24

async function load(filePath: string): Promise<ParsedImage> {
  const cached = cache.get(filePath)
  if (cached) return cached

  const image = parseImage(await window.api.readPreview(filePath))
  if (cache.size >= MAX_CACHED_FILES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(filePath, image)
  return image
}

/**
 * Decode one frame and paint it into a canvas.
 *
 * Throws UnsupportedTransferSyntaxError for compressed data so the caller can
 * say so plainly rather than showing a broken image.
 */
export async function renderSlice(filePath: string, frame: number, canvas: HTMLCanvasElement): Promise<void> {
  const image = await load(filePath)
  const { width, height, rgba } = decodeFrame(image, frame)

  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get a 2D context')
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0)
}

/** Drop cached pixel data when a new import starts. */
export function clearPreviewCache(): void {
  cache.clear()
}
