import dicomParser from 'dicom-parser'

/**
 * Preview decoder for uncompressed DICOM.
 *
 * Split into a header parse and a per-frame decode on purpose. A cine run is
 * routinely a quarter of a gigabyte — 122 frames of 1024x1024x16-bit — so
 * nothing here ever wants the whole file in memory: the header comes from the
 * first few kilobytes, and each frame is decoded from just its own byte range.
 *
 * This deliberately does not use @cornerstonejs/dicom-image-loader: it drags in
 * @cornerstonejs/core, whose viewport and rendering-engine class hierarchy is
 * circular enough to throw "Class extends value undefined" once bundled — and
 * none of it is needed, since the pixels are painted onto a plain canvas.
 *
 * Compressed transfer syntaxes are reported rather than silently mis-rendered.
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

/** Everything needed to locate and interpret a frame, without holding pixels. */
export interface ImageHeader {
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
  /** Byte offset of the first frame's pixel data within the file. */
  pixelDataOffset: number
}

export interface DecodedFrame {
  width: number
  height: number
  /** RGBA, ready for ImageData. Backed by a plain ArrayBuffer. */
  rgba: Uint8ClampedArray<ArrayBuffer>
}

function firstNumber(value: string | undefined): number | null {
  if (value === undefined) return null
  const n = Number.parseFloat(value.split('\\')[0])
  return Number.isFinite(n) ? n : null
}

/**
 * Read the header from the start of a file.
 *
 * `bytes` does not have to be the whole file — anything that reaches past the
 * pixel data element header is enough, which in practice is a few kilobytes.
 */
export function parseHeader(bytes: Uint8Array): ImageHeader {
  const ds = dicomParser.parseDicom(bytes, { untilTag: 'x7fe00010' })

  const transferSyntax = ds.string('x00020010') ?? '1.2.840.10008.1.2'
  const pixelData = ds.elements['x7fe00010']
  if (!pixelData) throw new Error('No pixel data in this file')
  // Encapsulated pixel data has an undefined length and is split into fragments.
  if (pixelData.encapsulatedPixelData === true || TRANSFER_SYNTAX_NAMES[transferSyntax]) {
    throw new UnsupportedTransferSyntaxError(transferSyntax)
  }

  const header: ImageHeader = {
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
    pixelDataOffset: pixelData.dataOffset
  }

  if (header.rows === 0 || header.columns === 0) throw new Error('Image has no dimensions')
  return header
}

/** Bytes one frame occupies. */
export function frameByteLength(header: ImageHeader): number {
  const bytesPerSample = header.bitsAllocated <= 8 ? 1 : 2
  return header.rows * header.columns * header.samplesPerPixel * bytesPerSample
}

/** Where a frame's pixels start in the file, clamped to the frames that exist. */
export function frameOffset(header: ImageHeader, frame: number): number {
  const clamped = Math.min(Math.max(frame, 0), header.frames - 1)
  return header.pixelDataOffset + clamped * frameByteLength(header)
}

/** Read one frame's samples out of its own bytes. */
function samplesOf(header: ImageHeader, frameBytes: Uint8Array): Int16Array | Uint16Array | Uint8Array {
  const count = header.rows * header.columns * header.samplesPerPixel
  const bytesPerSample = header.bitsAllocated <= 8 ? 1 : 2

  if (frameBytes.length < count * bytesPerSample) {
    throw new Error('Frame data runs past the end of the pixel data')
  }
  if (bytesPerSample === 1) return frameBytes.subarray(0, count)

  const out = header.signed ? new Int16Array(count) : new Uint16Array(count)
  for (let i = 0; i < count; i++) {
    const o = i * 2
    // DICOM is little-endian except under Explicit VR Big Endian.
    const raw = header.bigEndian
      ? (frameBytes[o] << 8) | frameBytes[o + 1]
      : frameBytes[o] | (frameBytes[o + 1] << 8)
    out[i] = header.signed ? (raw << 16) >> 16 : raw
  }
  return out
}

/** Window from the header, falling back to the actual range of this frame. */
function windowFor(header: ImageHeader, pixels: ArrayLike<number>): { low: number; scale: number } {
  let centre = header.windowCentre
  let width = header.windowWidth

  if (centre === null || width === null || width <= 0) {
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < pixels.length; i++) {
      const v = pixels[i] * header.slope + header.intercept
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

/** Decode one frame's bytes to RGBA, applying rescale, window and inversion. */
export function decodeFrame(header: ImageHeader, frameBytes: Uint8Array): DecodedFrame {
  const pixels = samplesOf(header, frameBytes)
  const pixelCount = header.rows * header.columns
  const rgba = new Uint8ClampedArray(new ArrayBuffer(pixelCount * 4))

  if (header.samplesPerPixel === 3) {
    // Planar configuration 1 stores all reds, then all greens, then all blues.
    const planar = header.planarConfiguration === 1
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
    return { width: header.columns, height: header.rows, rgba }
  }

  const { low, scale } = windowFor(header, pixels)
  const invert = header.photometric === 'MONOCHROME1'

  for (let i = 0; i < pixelCount; i++) {
    const value = pixels[i] * header.slope + header.intercept
    let grey = (value - low) * scale
    if (invert) grey = 255 - grey
    const o = i * 4
    rgba[o] = rgba[o + 1] = rgba[o + 2] = grey
    rgba[o + 3] = 255
  }

  return { width: header.columns, height: header.rows, rgba }
}

/**
 * Shrink a frame to fit within `maxEdge`, by whole-pixel sampling.
 *
 * The preview card is a couple of hundred pixels wide, so sending a full
 * 1024x1024 frame across the IPC bridge on every slider step is four megabytes
 * of copying for detail nobody sees.
 */
export function downscale(frame: DecodedFrame, maxEdge: number): DecodedFrame {
  const longest = Math.max(frame.width, frame.height)
  if (longest <= maxEdge) return frame

  const factor = longest / maxEdge
  const width = Math.max(1, Math.round(frame.width / factor))
  const height = Math.max(1, Math.round(frame.height / factor))
  const rgba = new Uint8ClampedArray(new ArrayBuffer(width * height * 4))

  for (let y = 0; y < height; y++) {
    const sourceRow = Math.min(frame.height - 1, Math.floor(y * factor)) * frame.width
    for (let x = 0; x < width; x++) {
      const source = (sourceRow + Math.min(frame.width - 1, Math.floor(x * factor))) * 4
      const target = (y * width + x) * 4
      rgba[target] = frame.rgba[source]
      rgba[target + 1] = frame.rgba[source + 1]
      rgba[target + 2] = frame.rgba[source + 2]
      rgba[target + 3] = 255
    }
  }

  return { width, height, rgba }
}
