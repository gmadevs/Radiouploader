import { createRequire } from 'node:module'

/**
 * JPEG baseline, for the frames of a video.
 *
 * A video is decoded into its frames so a mask can be painted on them, and
 * written back as plain samples those frames were two megabytes each: a clip of
 * a few megabytes went up as hundreds. The frames are lossy already — the video
 * kept only differences between them — so they are compressed again, after the
 * mask and the crop, as JPEG baseline: a format every DICOM reader and
 * Radiopaedia take, and one the app already reads back.
 *
 * Quality 95. Measured on a 1024x768 colour frame: 83 kB and 49 dB against the
 * decoded frame, where 90 is 67 kB and 45 dB and 75 is 48 kB and 38 dB. These
 * are medical images and the saving between them is small next to the
 * two megabytes each started at.
 *
 * Nothing that was lossless is ever put through this — only video, which never
 * was.
 *
 * libjpeg-turbo's full WASM build carries the encoder; it is loaded on first
 * use, as the decoders are, and kept.
 */

export const VIDEO_FRAME_QUALITY = 95

const require = createRequire(import.meta.url)

interface WasmEncoder {
  getDecodedBuffer(info: { width: number; height: number; bitsPerSample: number; componentCount: number; isSigned: boolean }): Uint8Array
  getEncodedBuffer(): Uint8Array
  setQuality(quality: number): void
  encode(): void
  delete?(): void
}

let pending: Promise<{ new (): WasmEncoder }> | null = null

function jpegEncoder(): Promise<{ new (): WasmEncoder }> {
  pending ??= (async () => {
    const factory = require('@cornerstonejs/codec-libjpeg-turbo-8bit/wasmjs') as () => Promise<Record<string, unknown>>
    const ctor = (await factory()).JPEGEncoder
    if (typeof ctor !== 'function') throw new Error('libjpeg-turbo has no JPEGEncoder')
    return ctor as { new (): WasmEncoder }
  })()
  return pending
}

/**
 * Compress one frame of interleaved 8-bit RGB. Chroma is kept at full
 * resolution — no subsampling — so the result is YBR_FULL, the one
 * photometric interpretation DICOM names without ambiguity for JPEG baseline.
 */
export async function encodeJpegRgb(
  rgb: Uint8Array,
  width: number,
  height: number,
  quality = VIDEO_FRAME_QUALITY
): Promise<Uint8Array> {
  if (rgb.length < width * height * 3) throw new Error('Frame data runs past the end of the pixel data')
  const Encoder = await jpegEncoder()
  const encoder = new Encoder()
  try {
    encoder.getDecodedBuffer({ width, height, bitsPerSample: 8, componentCount: 3, isSigned: false }).set(rgb.subarray(0, width * height * 3))
    encoder.setQuality(quality)
    encoder.encode()
    // A view onto the codec's own heap, which the next encode reuses.
    return encoder.getEncodedBuffer().slice()
  } finally {
    encoder.delete?.()
  }
}
