import { createRequire } from 'node:module'
import { UnsupportedTransferSyntaxError } from '@shared/dicomImage'
import type { ImageHeader } from '@shared/dicomImage'

/**
 * Decoding compressed pixel data.
 *
 * The codecs are the standalone `@cornerstonejs/codec-*` WASM builds, loaded on
 * first use and kept for the life of the process. Deliberately not
 * `@cornerstonejs/dicom-image-loader`: it drags in `@cornerstonejs/core`, whose
 * class hierarchy is circular enough to throw `Class extends value undefined`
 * once bundled, and none of it is wanted here — the pixels are painted onto a
 * plain canvas in the renderer.
 *
 * `require` rather than `import`, because these are CommonJS Emscripten modules
 * that find their own `.wasm` next to themselves through `__filename`. That
 * only holds while they stay external to the bundle, which `externalizeDepsPlugin`
 * in the electron-vite config sees to.
 *
 * Everything here runs in the main process: a decoded frame is a megabyte or
 * two and a decoded run is hundreds, which is the whole reason only finished
 * preview frames cross the bridge.
 */

const require = createRequire(import.meta.url)

/** What a codec hands back, which is not always what the file's header said. */
export interface DecodedSamples {
  bytes: Uint8Array
  bitsAllocated: number
  samplesPerPixel: number
  signed: boolean
  planarConfiguration: number
  /** The photometric interpretation of the decoded samples. */
  photometric: string
}

interface FrameInfo {
  width: number
  height: number
  bitsPerSample: number
  componentCount: number
  isSigned: boolean
}

interface WasmDecoder {
  getEncodedBuffer(length: number): Uint8Array
  getDecodedBuffer(): Uint8Array
  decode(): void
  getFrameInfo(): FrameInfo
  getInterleaveMode?(): number
  delete?(): void
}

type DecoderFactory = () => Promise<{ new (): WasmDecoder }>

/**
 * One instance per codec, created on first use.
 *
 * Instantiating a WASM module costs tens of milliseconds and allocates its own
 * heap, so scrubbing a cine must not do it per frame.
 */
function lazyCodec(entry: string, className: string): DecoderFactory {
  let pending: Promise<{ new (): WasmDecoder }> | null = null
  return () => {
    pending ??= (async () => {
      const factory = require(entry) as (options?: object) => Promise<Record<string, unknown>>
      const module = await factory()
      const ctor = module[className]
      if (typeof ctor !== 'function') throw new Error(`${entry} has no ${className}`)
      return ctor as { new (): WasmDecoder }
    })()
    return pending
  }
}

const libjpegTurbo = lazyCodec('@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs', 'JPEGDecoder')
const charls = lazyCodec('@cornerstonejs/codec-charls/decodewasmjs', 'JpegLSDecoder')
const openjpeg = lazyCodec('@cornerstonejs/codec-openjpeg/decodewasmjs', 'J2KDecoder')
const openjph = lazyCodec('@cornerstonejs/codec-openjph/wasmjs', 'HTJ2KDecoder')

/** Which codec reads which transfer syntax. */
const CODECS: Record<string, DecoderFactory> = {
  '1.2.840.10008.1.2.4.50': libjpegTurbo, // JPEG baseline
  '1.2.840.10008.1.2.4.51': libjpegTurbo, // JPEG extended; 12-bit ones will refuse below
  '1.2.840.10008.1.2.4.80': charls, // JPEG-LS lossless
  '1.2.840.10008.1.2.4.81': charls, // JPEG-LS near-lossless
  '1.2.840.10008.1.2.4.90': openjpeg, // JPEG 2000 lossless
  '1.2.840.10008.1.2.4.91': openjpeg, // JPEG 2000
  '1.2.840.10008.1.2.4.201': openjph, // HTJ2K
  '1.2.840.10008.1.2.4.202': openjph,
  '1.2.840.10008.1.2.4.203': openjph
}

/** Syntaxes decoded by a plain JavaScript decoder rather than by WASM. */
const JPEG_LOSSLESS = new Set(['1.2.840.10008.1.2.4.57', '1.2.840.10008.1.2.4.70'])

/**
 * Whether this app can turn the given transfer syntax into samples.
 *
 * Asked before anything commits to a file: a compressed run can only be split
 * if its frames can be decoded first, and a mask can only be painted on an
 * image this can read back.
 */
export function canDecode(transferSyntax: string): boolean {
  return transferSyntax in CODECS || JPEG_LOSSLESS.has(transferSyntax)
}

/**
 * The colours the decoded samples are actually in.
 *
 * A codec is free to undo a colour transform on the way out, and every one of
 * them does it differently, so the file's own photometric interpretation stops
 * being true the moment the frame is decoded. Getting this wrong swaps the red
 * and blue of an ultrasound doppler and leaves it looking plausible.
 */
function photometricOf(transferSyntax: string, header: ImageHeader, info: FrameInfo): string {
  if (info.componentCount < 3) return header.photometric
  // libjpeg-turbo converts a JPEG's own YCbCr to RGB while decoding.
  if (CODECS[transferSyntax] === libjpegTurbo) return 'RGB'
  // The JPEG 2000 codecs invert the multi-component transform themselves.
  if (header.photometric === 'YBR_ICT' || header.photometric === 'YBR_RCT') return 'RGB'
  return header.photometric
}

async function decodeWithWasm(
  transferSyntax: string,
  encoded: Uint8Array,
  header: ImageHeader
): Promise<DecodedSamples> {
  const Decoder = await CODECS[transferSyntax]()
  const decoder = new Decoder()
  try {
    decoder.getEncodedBuffer(encoded.length).set(encoded)
    decoder.decode()
    const info = decoder.getFrameInfo()
    if (info.width !== header.columns || info.height !== header.rows) {
      throw new Error(
        `Compressed frame is ${info.width}x${info.height} where the header says ${header.columns}x${header.rows}`
      )
    }
    // The decoded buffer is a view onto the codec's own heap, which the next
    // decode reuses and a heap growth invalidates. Copy before letting go.
    const bytes = decoder.getDecodedBuffer().slice()
    // JPEG-LS in interleave mode 0 writes one component plane after another.
    const planar = decoder.getInterleaveMode?.() === 0 && info.componentCount > 1 ? 1 : 0
    return {
      bytes,
      bitsAllocated: info.bitsPerSample <= 8 ? 8 : 16,
      samplesPerPixel: info.componentCount,
      signed: info.isSigned,
      planarConfiguration: planar,
      photometric: photometricOf(transferSyntax, header, info)
    }
  } finally {
    decoder.delete?.()
  }
}

interface LosslessDecoder {
  decode(buffer: ArrayBufferLike, offset?: number, length?: number): Uint8Array | Int16Array | Uint16Array
  numComponents: number
  numBytes: number
}

/**
 * Lossless JPEG (processes 14 and 14/SV1) has no WASM codec in the set, and a
 * plain JavaScript decoder is enough: the format is old, and the files that use
 * it are the CTs and CRs of twenty-year-old archives rather than cine runs.
 */
async function decodeLosslessJpeg(encoded: Uint8Array, header: ImageHeader): Promise<DecodedSamples> {
  const { Decoder } = require('jpeg-lossless-decoder-js') as { Decoder: { new (): LosslessDecoder } }
  const decoder = new Decoder()
  const decoded = decoder.decode(encoded.buffer, encoded.byteOffset, encoded.byteLength)
  const bytes = new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength)
  return {
    bytes: bytes.slice(),
    bitsAllocated: decoder.numBytes <= 1 ? 8 : 16,
    samplesPerPixel: decoder.numComponents,
    signed: header.signed,
    planarConfiguration: 0,
    photometric: header.photometric
  }
}

/**
 * Decode one encapsulated frame into the plain samples the rest of the app
 * reads, along with the geometry those samples are really in.
 *
 * A syntax with no decoder is refused by name rather than guessed at: reading a
 * bitstream as samples produces an image, and that image is noise that looks
 * like an image.
 */
export async function decodeEncapsulatedFrame(
  encoded: Uint8Array,
  header: ImageHeader
): Promise<DecodedSamples> {
  const transferSyntax = header.transferSyntax
  if (JPEG_LOSSLESS.has(transferSyntax)) return decodeLosslessJpeg(encoded, header)
  if (transferSyntax in CODECS) return decodeWithWasm(transferSyntax, encoded, header)
  throw new UnsupportedTransferSyntaxError(transferSyntax)
}
