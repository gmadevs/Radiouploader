import type { ImageHeader } from '@shared/dicomImage'
import type { DecodedSamples } from './decode'

/**
 * RLE Lossless (1.2.840.10008.1.2.5), decoded here in plain JavaScript.
 *
 * It is the one compressed syntax in DICOM with no codec in the
 * `@cornerstonejs/codec-*` set, and it needs none: the format is PackBits — a
 * run length and a byte — over byte planes, which is a page of code and no
 * dependency. Until this existed an RLE cine could not be uploaded at all,
 * because a run has to be decoded before its frames can be sent one at a time.
 *
 * Two things about it are not obvious and are where a decoder goes wrong.
 *
 * The segments are **byte planes, most significant first**. A sixteen-bit image
 * is two segments — every high byte, then every low byte — so the samples have
 * to be woven back together rather than concatenated; a colour image is one
 * plane per channel per byte, in that order. Getting the order backwards
 * produces an image rather than an error, and it is noise that looks like one.
 *
 * And RLE performs **no colour transform**, unlike every codec next door. What
 * the file says its photometric interpretation is stays true of the samples
 * that come out, which is why nothing here rewrites it.
 */

/** The fixed header on every RLE frame: a count and fifteen offsets. */
const HEADER_BYTES = 64
const MAX_SEGMENTS = 15

/**
 * Undo one PackBits segment.
 *
 * The control byte is signed: zero or above means the next `n + 1` bytes are
 * literal, below zero means the next byte repeats `1 - n` times, and -128 means
 * nothing at all. Encoders pad a segment to an even length, so decoding stops
 * on the pixel count rather than on the end of the data.
 */
function unpack(encoded: Uint8Array, start: number, end: number, count: number): Uint8Array {
  const out = new Uint8Array(count)
  let read = start
  let written = 0

  while (read < end && written < count) {
    const control = (encoded[read] << 24) >> 24
    read++
    if (control >= 0) {
      const run = Math.min(control + 1, count - written, end - read)
      out.set(encoded.subarray(read, read + run), written)
      read += control + 1
      written += run
    } else if (control !== -128) {
      if (read >= end) break
      const run = Math.min(1 - control, count - written)
      out.fill(encoded[read], written, written + run)
      read++
      written += run
    }
  }

  if (written < count) {
    throw new Error(`RLE frame ended after ${written} of ${count} bytes: the pixel data is truncated`)
  }
  return out
}

/** Decode one RLE frame into interleaved little-endian samples. */
export function decodeRleFrame(encoded: Uint8Array, header: ImageHeader): DecodedSamples {
  if (encoded.length < HEADER_BYTES) throw new Error('RLE frame is too short to hold its own segment table')

  const bytesPerSample = header.bitsAllocated <= 8 ? 1 : 2
  if (header.bitsAllocated > 16) {
    throw new Error(`RLE at ${header.bitsAllocated} bits per sample is not something this app reads`)
  }

  const table = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength)
  const declared = table.getUint32(0, true)
  const wanted = header.samplesPerPixel * bytesPerSample
  // A count that disagrees with the header is not a file to guess at: the
  // segments are what say which byte of which channel is which.
  if (declared !== wanted) {
    throw new Error(
      `RLE frame has ${declared} segments where ${header.samplesPerPixel} samples of ${bytesPerSample} byte(s) need ${wanted}`
    )
  }
  if (declared < 1 || declared > MAX_SEGMENTS) throw new Error(`RLE frame claims ${declared} segments`)

  const offsets: number[] = []
  for (let i = 0; i < declared; i++) offsets.push(table.getUint32(4 + i * 4, true))

  const pixels = header.rows * header.columns
  const planes = offsets.map((offset, i) => {
    const end = i + 1 < declared ? offsets[i + 1] : encoded.length
    if (offset < HEADER_BYTES || offset > encoded.length || end < offset) {
      throw new Error(`RLE segment ${i + 1} starts outside the frame it belongs to`)
    }
    return unpack(encoded, offset, Math.min(end, encoded.length), pixels)
  })

  // Weave the planes back into samples. Segment `s * bytesPerSample + b` holds
  // byte `b` of channel `s`, counting from the most significant — so it lands
  // at the far end of the sample, everything downstream being little-endian.
  const out = new Uint8Array(pixels * header.samplesPerPixel * bytesPerSample)
  for (let sample = 0; sample < header.samplesPerPixel; sample++) {
    for (let byte = 0; byte < bytesPerSample; byte++) {
      const plane = planes[sample * bytesPerSample + byte]
      const target = sample * bytesPerSample + (bytesPerSample - 1 - byte)
      const stride = header.samplesPerPixel * bytesPerSample
      for (let i = 0; i < pixels; i++) out[i * stride + target] = plane[i]
    }
  }

  return {
    bytes: out,
    bitsAllocated: bytesPerSample === 1 ? 8 : 16,
    samplesPerPixel: header.samplesPerPixel,
    signed: header.signed,
    // The segments are planes, but what comes out of here is interleaved — and
    // an encapsulated object declares 0 whatever its codec does internally.
    planarConfiguration: 0,
    photometric: header.photometric
  }
}
