import dicomParser from 'dicom-parser'
import type { MaskRect, WindowLevel } from './types'

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
const IMPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2'

/**
 * Transfer syntaxes whose pixel data is plain samples. It is a whitelist, not a
 * list of codecs, because everything that consults it is deciding whether to
 * write into the pixel data or cut it up by byte offset — both of which corrupt
 * a bitstream — so an unrecognised UID has to count as compressed.
 */
const UNCOMPRESSED_SYNTAXES = new Set([IMPLICIT_VR_LITTLE_ENDIAN, '1.2.840.10008.1.2.1', EXPLICIT_VR_BIG_ENDIAN])

/**
 * Name the compression of a transfer syntax, or null when its pixel data is
 * plain samples and can be read, masked and sliced by offset. A file with no
 * meta header is implicit VR little endian, as the standard says.
 */
export function compressionOf(transferSyntax: string | null | undefined): string | null {
  const uid = transferSyntax ?? IMPLICIT_VR_LITTLE_ENDIAN
  if (UNCOMPRESSED_SYNTAXES.has(uid)) return null
  return TRANSFER_SYNTAX_NAMES[uid] ?? uid
}

export class UnsupportedTransferSyntaxError extends Error {
  constructor(transferSyntax: string) {
    const name = TRANSFER_SYNTAX_NAMES[transferSyntax] ?? transferSyntax
    super(`${name} is not supported for preview yet`)
    this.name = 'UnsupportedTransferSyntaxError'
  }
}

/** How the samples of a frame are laid out in the file. */
export interface PixelGeometry {
  rows: number
  columns: number
  samplesPerPixel: number
  bitsAllocated: number
  signed: boolean
  planarConfiguration: number
  bigEndian: boolean
}

/** Everything needed to locate and interpret a frame, without holding pixels. */
export interface ImageHeader extends PixelGeometry {
  photometric: string
  slope: number
  intercept: number
  windowCentre: number | null
  windowWidth: number | null
  frames: number
  /** Byte offset of the first frame's pixel data. Meaningless when encapsulated. */
  pixelDataOffset: number
  /** The file's own transfer syntax, which decides how the pixels are read. */
  transferSyntax: string
  /**
   * Compressed pixel data, stored as fragments rather than at an offset. Frames
   * have to be pulled out through the fragment table and decoded; there is
   * nothing to address arithmetically.
   */
  encapsulated: boolean
}

export interface DecodedFrame {
  width: number
  height: number
  /** RGBA, ready for ImageData. Backed by a plain ArrayBuffer. */
  rgba: Uint8ClampedArray<ArrayBuffer>
}

/**
 * A greyscale frame before any window is applied.
 *
 * Kept separate from DecodedFrame so the viewer can rewindow an image without
 * going back to the file: the values here are already rescaled, and turning
 * them into pixels is a single pass the renderer can afford on every drag.
 */
export interface GreyFrame {
  width: number
  height: number
  /** One rescaled value per pixel (slope and intercept already applied). */
  values: Float32Array
  /** The window the file asks for, or the frame's own range as a fallback. */
  window: WindowLevel
  /** MONOCHROME1: low values are white. */
  invert: boolean
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

  const transferSyntax = ds.string('x00020010') ?? IMPLICIT_VR_LITTLE_ENDIAN
  const pixelData = ds.elements['x7fe00010']
  if (!pixelData) throw new Error('No pixel data in this file')

  const header: ImageHeader = {
    transferSyntax,
    // Encapsulated pixel data has an undefined length and is split into
    // fragments. Both marks are checked: an exporter can write fragments under
    // a syntax this list does not name, and the arithmetic below would then be
    // reading a bitstream as if it were samples.
    encapsulated: pixelData.encapsulatedPixelData === true || compressionOf(transferSyntax) !== null,
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
export function frameByteLength(geometry: PixelGeometry): number {
  const bytesPerSample = geometry.bitsAllocated <= 8 ? 1 : 2
  return geometry.rows * geometry.columns * geometry.samplesPerPixel * bytesPerSample
}

/** Where a frame's pixels start in the file, clamped to the frames that exist. */
export function frameOffset(header: ImageHeader, frame: number): number {
  const clamped = Math.min(Math.max(frame, 0), header.frames - 1)
  return header.pixelDataOffset + clamped * frameByteLength(header)
}

/** Read one frame's samples out of its own bytes. */
export function frameSamples(
  geometry: PixelGeometry,
  frameBytes: Uint8Array
): Int16Array | Uint16Array | Uint8Array {
  const count = geometry.rows * geometry.columns * geometry.samplesPerPixel
  const bytesPerSample = geometry.bitsAllocated <= 8 ? 1 : 2

  if (frameBytes.length < count * bytesPerSample) {
    throw new Error('Frame data runs past the end of the pixel data')
  }
  if (bytesPerSample === 1) return frameBytes.subarray(0, count)

  const out = geometry.signed ? new Int16Array(count) : new Uint16Array(count)
  for (let i = 0; i < count; i++) {
    const o = i * 2
    // DICOM is little-endian except under Explicit VR Big Endian.
    const raw = geometry.bigEndian
      ? (frameBytes[o] << 8) | frameBytes[o + 1]
      : frameBytes[o] | (frameBytes[o + 1] << 8)
    out[i] = geometry.signed ? (raw << 16) >> 16 : raw
  }
  return out
}

/** Window from the header, falling back to the actual range of this frame. */
function windowFor(header: ImageHeader, values: ArrayLike<number>): WindowLevel {
  const centre = header.windowCentre
  const width = header.windowWidth
  if (centre !== null && width !== null && width > 0) return { centre, width }

  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    min = 0
    max = 255
  }
  return { centre: (min + max) / 2, width: Math.max(max - min, 1) }
}

/**
 * Decode one greyscale frame to rescaled values, without choosing a window.
 *
 * The viewer needs this: rewindowing an image on a mouse drag has to be a pass
 * over values already in the renderer, not a round trip to the file.
 */
export function decodeGreyFrame(header: ImageHeader, frameBytes: Uint8Array): GreyFrame {
  if (header.samplesPerPixel !== 1) throw new Error('This image is colour, not greyscale')

  const pixels = frameSamples(header, frameBytes)
  const pixelCount = header.rows * header.columns
  const values = new Float32Array(new ArrayBuffer(pixelCount * 4))
  for (let i = 0; i < pixelCount; i++) values[i] = pixels[i] * header.slope + header.intercept

  return {
    width: header.columns,
    height: header.rows,
    values,
    window: windowFor(header, values),
    invert: header.photometric === 'MONOCHROME1'
  }
}

/** Paint rescaled values through a window. */
export function applyWindow(frame: GreyFrame, window: WindowLevel): DecodedFrame {
  const low = window.centre - window.width / 2
  const scale = 255 / (window.width > 0 ? window.width : 1)
  const rgba = new Uint8ClampedArray(new ArrayBuffer(frame.values.length * 4))

  for (let i = 0; i < frame.values.length; i++) {
    let grey = (frame.values[i] - low) * scale
    if (frame.invert) grey = 255 - grey
    const o = i * 4
    rgba[o] = rgba[o + 1] = rgba[o + 2] = grey
    rgba[o + 3] = 255
  }

  return { width: frame.width, height: frame.height, rgba }
}

/** Decode one frame's bytes to RGBA, applying rescale, window and inversion. */
export function decodeFrame(header: ImageHeader, frameBytes: Uint8Array): DecodedFrame {
  if (header.samplesPerPixel === 3) {
    const pixels = frameSamples(header, frameBytes)
    const pixelCount = header.rows * header.columns
    const rgba = new Uint8ClampedArray(new ArrayBuffer(pixelCount * 4))
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

  const frame = decodeGreyFrame(header, frameBytes)
  return applyWindow(frame, frame.window)
}

/** Clamp a fraction of the image to a whole-pixel column or row. */
function edge(fraction: number, size: number): number {
  return Math.min(Math.max(Math.round(fraction * size), 0), size)
}

/**
 * The stored sample values that read as black on this image.
 *
 * Zero is not black in general: on a CT it is soft tissue, and on MONOCHROME1
 * it is white. What reads as black is the dark end of the window the image is
 * displayed with, taken back through the rescale to a stored value — so a
 * redaction stays black whatever window the viewer ends up using. With no
 * window to go on, the darkest value present in the frame is the safe answer.
 */
export function blackSamples(
  header: Pick<ImageHeader, 'photometric' | 'samplesPerPixel' | 'bitsAllocated' | 'signed' | 'slope' | 'intercept'>,
  window: WindowLevel | null,
  pixels?: ArrayLike<number>
): number[] {
  if (header.samplesPerPixel > 1) {
    // YBR stores black as luminance 0 with both chroma channels centred; zero
    // in all three would come out bright green.
    return header.photometric.startsWith('YBR') ? [0, 128, 128] : [0, 0, 0]
  }

  const max = header.bitsAllocated <= 8 ? 255 : header.signed ? 32767 : 65535
  const min = header.bitsAllocated <= 8 ? 0 : header.signed ? -32768 : 0
  const invert = header.photometric === 'MONOCHROME1'
  const clamp = (v: number): number => Math.min(Math.max(Math.round(v), min), max)

  if (window && window.width > 0) {
    const dark = invert ? window.centre + window.width / 2 : window.centre - window.width / 2
    const slope = header.slope === 0 ? 1 : header.slope
    return [clamp((dark - header.intercept) / slope)]
  }

  if (pixels && pixels.length > 0) {
    let lowest = pixels[0]
    let highest = pixels[0]
    for (let i = 1; i < pixels.length; i++) {
      if (pixels[i] < lowest) lowest = pixels[i]
      if (pixels[i] > highest) highest = pixels[i]
    }
    // A negative slope flips which end of the stored range is the dark one.
    const darkIsLow = invert === header.slope < 0
    return [clamp(darkIsLow ? lowest : highest)]
  }

  return [invert ? max : 0]
}

/**
 * Blank out rectangles of a frame, in place.
 *
 * `frameBytes` is the raw pixel data as stored, so this is the last chance to
 * remove burnt-in text before the file is written: what it overwrites is gone
 * from the bytes that get uploaded, not merely hidden by the viewer.
 */
export function fillMasks(
  frameBytes: Uint8Array,
  geometry: PixelGeometry,
  masks: MaskRect[],
  fill: number[]
): void {
  if (masks.length === 0 || fill.length === 0) return

  const { rows, columns, samplesPerPixel, bitsAllocated, signed, bigEndian } = geometry
  const wide = bitsAllocated > 8
  const bytesPerSample = wide ? 2 : 1
  const planar = samplesPerPixel > 1 && geometry.planarConfiguration === 1
  const plane = rows * columns
  const view = new DataView(frameBytes.buffer, frameBytes.byteOffset, frameBytes.byteLength)

  const write = (index: number, value: number): void => {
    const o = index * bytesPerSample
    if (o + bytesPerSample > frameBytes.length) return
    if (!wide) frameBytes[o] = value & 0xff
    else if (signed) view.setInt16(o, value, !bigEndian)
    else view.setUint16(o, value, !bigEndian)
  }

  for (const mask of masks) {
    const x0 = edge(mask.x, columns)
    const x1 = edge(mask.x + mask.width, columns)
    const y0 = edge(mask.y, rows)
    const y1 = edge(mask.y + mask.height, rows)

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        for (let s = 0; s < samplesPerPixel; s++) {
          const index = planar ? s * plane + y * columns + x : (y * columns + x) * samplesPerPixel + s
          write(index, fill[Math.min(s, fill.length - 1)])
        }
      }
    }
  }
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

/** The same sampling as `downscale`, for values that are not pixels yet. */
export function downscaleGrey(frame: GreyFrame, maxEdge: number): GreyFrame {
  const longest = Math.max(frame.width, frame.height)
  if (longest <= maxEdge) return frame

  const factor = longest / maxEdge
  const width = Math.max(1, Math.round(frame.width / factor))
  const height = Math.max(1, Math.round(frame.height / factor))
  const values = new Float32Array(new ArrayBuffer(width * height * 4))

  for (let y = 0; y < height; y++) {
    const sourceRow = Math.min(frame.height - 1, Math.floor(y * factor)) * frame.width
    for (let x = 0; x < width; x++) {
      values[y * width + x] = frame.values[sourceRow + Math.min(frame.width - 1, Math.floor(x * factor))]
    }
  }

  return { width, height, values, window: frame.window, invert: frame.invert }
}
