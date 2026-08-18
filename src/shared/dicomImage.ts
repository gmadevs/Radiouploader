import dicomParser from 'dicom-parser'

/**
 * Preview decoder for uncompressed DICOM.
 *
 * This deliberately does not use @cornerstonejs/dicom-image-loader: it drags in
 * @cornerstonejs/core, whose viewport and rendering-engine class hierarchy is
 * circular enough to throw "Class extends value undefined" once bundled — and
 * none of it is needed here, since the pixels are painted onto a plain canvas.
 *
 * Compressed transfer syntaxes are reported rather than silently mis-rendered.
 * Adding them means bringing in the standalone @cornerstonejs/codec-* WASM
 * packages, which do not depend on core.
 */

const TRANSFER_SYNTAX_NAMES: Record<string, string> = {
  '1.2.840.10008.1.2.4.50': 'JPEG baseline',
  '1.2.840.10008.1.2.4.51': 'JPEG extended',
  '1.2.840.10008.1.2.4.57': 'JPEG lossless',
  '1.2.840.10008.1.2.4.70': 'JPEG lossless',
  '1.2.840.10008.1.2.4.80': 'JPEG-LS',
  '1.2.840.10008.1.2.4.81': 'JPEG-LS',
  '1.2.840.10008.1.2.4.90': 'JPEG 2000',
  '1.2.840.10008.1.2.4.91': 'JPEG 2000',
  '1.2.840.10008.1.2.4.201': 'HTJ2K',
  '1.2.840.10008.1.2.4.202': 'HTJ2K',
  '1.2.840.10008.1.2.5': 'RLE'
}

const EXPLICIT_VR_BIG_ENDIAN = '1.2.840.10008.1.2.2'

export class UnsupportedTransferSyntaxError extends Error {
  constructor(transferSyntax: string) {
    const name = TRANSFER_SYNTAX_NAMES[transferSyntax] ?? transferSyntax
    super(`${name} is not supported for preview yet`)
    this.name = 'UnsupportedTransferSyntaxError'
  }
}

export interface ParsedImage {
  rows: number
  columns: number
  samplesPerPixel: number
  bitsAllocated: number
  signed: boolean
  planarConfiguration: number
  photometric: string
  slope: number
  intercept: number
  windowCentre: number | null
  windowWidth: number | null
  frames: number
  bigEndian: boolean
  pixelDataOffset: number
  byteArray: Uint8Array
}

function firstNumber(value: string | undefined): number | null {
  if (value === undefined) return null
  const n = Number.parseFloat(value.split('\\')[0])
  return Number.isFinite(n) ? n : null
}

export function parseImage(buffer: ArrayBuffer): ParsedImage {
  const byteArray = new Uint8Array(buffer)
  const ds = dicomParser.parseDicom(byteArray)

  const transferSyntax = ds.string('x00020010') ?? '1.2.840.10008.1.2'
  const pixelData = ds.elements['x7fe00010']
  if (!pixelData) throw new Error('No pixel data in this file')
  // Encapsulated pixel data has an undefined length and is split into fragments.
  if (pixelData.encapsulatedPixelData === true || TRANSFER_SYNTAX_NAMES[transferSyntax]) {
    throw new UnsupportedTransferSyntaxError(transferSyntax)
  }

  const image: ParsedImage = {
    rows: ds.uint16('x00280010') ?? 0,
    columns: ds.uint16('x00280011') ?? 0,
    samplesPerPixel: ds.uint16('x00280002') ?? 1,
    bitsAllocated: ds.uint16('x00280100') ?? 16,
    signed: (ds.uint16('x00280103') ?? 0) === 1,
    planarConfiguration: ds.uint16('x00280006') ?? 0,
    photometric: ds.string('x00280004') ?? 'MONOCHROME2',
    slope: firstNumber(ds.string('x00281053')) ?? 1,
    intercept: firstNumber(ds.string('x00281052')) ?? 0,
    windowCentre: firstNumber(ds.string('x00281050')),
    windowWidth: firstNumber(ds.string('x00281051')),
    frames: Math.max(1, Number.parseInt(ds.string('x00280008') ?? '1', 10) || 1),
    bigEndian: transferSyntax === EXPLICIT_VR_BIG_ENDIAN,
    pixelDataOffset: pixelData.dataOffset,
    byteArray
  }

  if (image.rows === 0 || image.columns === 0) throw new Error('Image has no dimensions')
  return image
}

/** Pull one frame out of the pixel data as a numeric array. */
export function readFrame(image: ParsedImage, frame: number): Int16Array | Uint16Array | Uint8Array {
  const pixelsPerFrame = image.rows * image.columns * image.samplesPerPixel
  const bytesPerSample = image.bitsAllocated <= 8 ? 1 : 2
  const start = image.pixelDataOffset + frame * pixelsPerFrame * bytesPerSample

  if (start + pixelsPerFrame * bytesPerSample > image.byteArray.length) {
    throw new Error(`Frame ${frame + 1} is past the end of the pixel data`)
  }

  if (bytesPerSample === 1) {
    return image.byteArray.subarray(start, start + pixelsPerFrame)
  }

  const out = image.signed ? new Int16Array(pixelsPerFrame) : new Uint16Array(pixelsPerFrame)
  const bytes = image.byteArray
  for (let i = 0; i < pixelsPerFrame; i++) {
    const o = start + i * 2
    // DICOM is little-endian except under Explicit VR Big Endian.
    const raw = image.bigEndian ? (bytes[o] << 8) | bytes[o + 1] : bytes[o] | (bytes[o + 1] << 8)
    out[i] = image.signed ? (raw << 16) >> 16 : raw
  }
  return out
}

/** Window from the header, falling back to the actual range of this frame. */
function windowFor(image: ParsedImage, pixels: ArrayLike<number>): { low: number; scale: number } {
  let centre = image.windowCentre
  let width = image.windowWidth

  if (centre === null || width === null || width <= 0) {
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < pixels.length; i++) {
      const v = pixels[i] * image.slope + image.intercept
      if (v < min) min = v
      if (v > max) max = v
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
      min = 0
      max = 255
    }
    centre = (min + max) / 2
    width = Math.max(max - min, 1)
  }

  return { low: centre - width / 2, scale: 255 / width }
}


export interface DecodedFrame {
  width: number
  height: number
  /** RGBA, ready for ImageData. Backed by a plain ArrayBuffer. */
  rgba: Uint8ClampedArray<ArrayBuffer>
}

/** Decode one frame to RGBA, applying rescale, window and photometric inversion. */
export function decodeFrame(image: ParsedImage, frame: number): DecodedFrame {
  const pixels = readFrame(image, Math.min(Math.max(frame, 0), image.frames - 1))
  const pixelCount = image.rows * image.columns
  const rgba = new Uint8ClampedArray(new ArrayBuffer(pixelCount * 4))

  if (image.samplesPerPixel === 3) {
    // Planar configuration 1 stores all reds, then all greens, then all blues.
    const planar = image.planarConfiguration === 1
    for (let i = 0; i < pixelCount; i++) {
      const o = i * 4
      if (planar) {
        rgba[o] = pixels[i]
        rgba[o + 1] = pixels[i + pixelCount]
        rgba[o + 2] = pixels[i + pixelCount * 2]
      } else {
        rgba[o] = pixels[i * 3]
        rgba[o + 1] = pixels[i * 3 + 1]
        rgba[o + 2] = pixels[i * 3 + 2]
      }
      rgba[o + 3] = 255
    }
    return { width: image.columns, height: image.rows, rgba }
  }

  const { low, scale } = windowFor(image, pixels)
  const invert = image.photometric === 'MONOCHROME1'

  for (let i = 0; i < pixelCount; i++) {
    const value = pixels[i] * image.slope + image.intercept
    let grey = (value - low) * scale
    if (invert) grey = 255 - grey
    const o = i * 4
    rgba[o] = rgba[o + 1] = rgba[o + 2] = grey
    rgba[o + 3] = 255
  }

  return { width: image.columns, height: image.rows, rgba }
}
