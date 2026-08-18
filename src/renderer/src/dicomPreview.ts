/**
 * Minimal shape of a decoded cornerstone image. The package's own types point
 * at an unpublished path, so the fields actually used here are declared locally.
 */
interface DecodedImage {
  rows: number
  columns: number
  windowCenter?: number | number[]
  windowWidth?: number | number[]
  slope?: number
  intercept?: number
  minPixelValue: number
  maxPixelValue: number
  color: boolean
  photometricInterpretation?: string
  getPixelData(): Int16Array | Uint16Array | Uint8Array | Float32Array
}

type Loader = typeof import('@cornerstonejs/dicom-image-loader')

let loaderPromise: Promise<Loader> | null = null

/**
 * Load the image loader on first use.
 *
 * The import is dynamic on purpose: pulled into the main chunk it forms a
 * circular graph with @cornerstonejs/core that throws "Class extends value
 * undefined" at module-evaluation time and takes the whole renderer down. As a
 * separate chunk it evaluates in the right order, and the several megabytes of
 * WASM codecs stay off the startup path.
 */
function getLoader(): Promise<Loader> {
  loaderPromise ??= import('@cornerstonejs/dicom-image-loader').then((loader) => {
    // Two workers is enough for thumbnails and keeps memory modest when a study
    // has hundreds of slices.
    loader.init({ maxWebWorkers: 2 })
    return loader
  })
  return loaderPromise
}

/** Cache decoded images by file path — scrubbing a stack revisits slices constantly. */
const cache = new Map<string, DecodedImage>()
const MAX_CACHED = 240

async function decode(filePath: string): Promise<DecodedImage> {
  const cached = cache.get(filePath)
  if (cached) return cached

  const loader = await getLoader()
  const buffer = await window.api.readPreview(filePath)
  const imageId = loader.wadouri.fileManager.add(new Blob([buffer], { type: 'application/dicom' }))
  const image = (await (loader.wadouri.loadImage(imageId) as { promise: Promise<unknown> }).promise) as DecodedImage

  if (cache.size >= MAX_CACHED) {
    // Simple FIFO eviction; insertion order is iteration order for a Map.
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(filePath, image)
  return image
}

function firstOf(value: number | number[] | undefined): number | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Decode one slice and paint it into a canvas, applying the modality rescale and
 * the window from the header. Falls back to the actual pixel range when the
 * header carries no window, which is common on derived series.
 */
export async function renderSlice(filePath: string, canvas: HTMLCanvasElement): Promise<void> {
  const image = await decode(filePath)
  const pixels = image.getPixelData()

  canvas.width = image.columns
  canvas.height = image.rows
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get a 2D context')

  const output = ctx.createImageData(image.columns, image.rows)
  const data = output.data

  if (image.color) {
    // Colour frames arrive already converted to RGBA by the loader.
    for (let i = 0; i < image.rows * image.columns; i++) {
      data[i * 4] = pixels[i * 4]
      data[i * 4 + 1] = pixels[i * 4 + 1]
      data[i * 4 + 2] = pixels[i * 4 + 2]
      data[i * 4 + 3] = 255
    }
    ctx.putImageData(output, 0, 0)
    return
  }

  const slope = image.slope ?? 1
  const intercept = image.intercept ?? 0
  let centre = firstOf(image.windowCenter)
  let width = firstOf(image.windowWidth)

  if (centre === undefined || width === undefined || width <= 0) {
    const min = image.minPixelValue * slope + intercept
    const max = image.maxPixelValue * slope + intercept
    centre = (min + max) / 2
    width = Math.max(max - min, 1)
  }

  const invert = image.photometricInterpretation === 'MONOCHROME1'
  const low = centre - width / 2
  const scale = 255 / width

  for (let i = 0; i < pixels.length; i++) {
    const value = pixels[i] * slope + intercept
    let grey = (value - low) * scale
    grey = grey < 0 ? 0 : grey > 255 ? 255 : grey
    if (invert) grey = 255 - grey
    const o = i * 4
    data[o] = data[o + 1] = data[o + 2] = grey
    data[o + 3] = 255
  }

  ctx.putImageData(output, 0, 0)
}

/** Drop cached pixel data when a new import starts. */
export function clearPreviewCache(): void {
  cache.clear()
  void loaderPromise?.then((loader) => loader.wadouri.fileManager.purge())
}
