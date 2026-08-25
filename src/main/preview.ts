import fs from 'node:fs/promises'
import dicomParser from 'dicom-parser'
import {
  decodeFrame,
  decodeGreyFrame,
  downscale,
  downscaleGrey,
  frameByteLength,
  frameOffset,
  parseHeader,
  type ImageHeader
} from '@shared/dicomImage'
import type { PreviewFrame } from '@shared/types'
import { decodeEncapsulatedFrame } from './codecs/decode'
import { encodedFrame } from './codecs/frames'

/**
 * Frame previews, decoded here rather than in the renderer.
 *
 * Sending whole DICOM files across the IPC bridge does not scale: a cine run is
 * routinely 250 MB, and shipping one costs three copies — the read, the
 * ArrayBuffer slice and the structured clone — which is how this used to fail
 * with "RangeError: Failed to allocate memory". Only the finished pixels of one
 * frame cross the bridge now.
 */

/**
 * Enough for any conventional header; retried larger if an exporter is unusual.
 * Compressed files need the whole thing — the fragments that hold the frames
 * live inside the pixel data element, so there is no header to read short of it.
 */
const HEADER_PROBE_SIZES = [64 * 1024, 1024 * 1024, 16 * 1024 * 1024]

/** The preview card is a couple of hundred pixels wide even at 2x. */
export const MAX_PREVIEW_EDGE = 512

/** As large as the viewer is ever shown, so a mask can be placed precisely. */
export const MAX_VIEWER_EDGE = 1024

/** Headers are small, so caching them costs little and saves a read per frame. */
const headers = new Map<string, ImageHeader>()
const MAX_CACHED_HEADERS = 64

/** The header of one file, cached — read for the pixels, and for the tags about them. */
export async function imageHeader(filePath: string): Promise<ImageHeader> {
  const cached = headers.get(filePath)
  if (cached) return cached

  const { size } = await fs.stat(filePath)
  let lastError: unknown

  for (const probe of [...HEADER_PROBE_SIZES, size]) {
    const length = Math.min(probe, size)
    const handle = await fs.open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, 0)
      const header = parseHeader(new Uint8Array(buffer.subarray(0, bytesRead)))

      if (headers.size >= MAX_CACHED_HEADERS) {
        const oldest = headers.keys().next().value
        if (oldest !== undefined) headers.delete(oldest)
      }
      headers.set(filePath, header)
      return header
    } catch (err) {
      lastError = err
      if (length >= size) break
    } finally {
      await handle.close()
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Could not read the DICOM header')
}

/**
 * The most recently parsed compressed file.
 *
 * Finding a frame inside encapsulated pixel data means parsing the file, so
 * scrubbing a cine would re-read and re-parse it once per frame. One file is
 * held instead — the compressed copy, which is the small one. The 250 MB a cine
 * costs elsewhere in this app is what a run weighs decoded.
 */
let openFile: { path: string; dataSet: dicomParser.DataSet } | null = null

async function encapsulatedFrame(filePath: string, frame: number, frames: number): Promise<Uint8Array> {
  if (openFile?.path !== filePath) {
    const bytes = new Uint8Array(await fs.readFile(filePath))
    openFile = { path: filePath, dataSet: dicomParser.parseDicom(bytes) }
  }
  return encodedFrame(openFile.dataSet, frame, frames)
}

/** Decode one frame of one file, shrunk to fit `maxEdge`. */
export async function readPreviewFrame(
  filePath: string,
  frame: number,
  maxEdge: number = MAX_PREVIEW_EDGE
): Promise<PreviewFrame> {
  const header = await imageHeader(filePath)

  if (header.encapsulated) {
    const encoded = await encapsulatedFrame(filePath, frame, header.frames)
    const decoded = await decodeEncapsulatedFrame(encoded, header)
    // What came out of the codec is what the pixels are now: the file's own
    // bit depth, planar configuration and colour space describe the bitstream,
    // not the samples it unpacks to.
    const asDecoded: ImageHeader = { ...header, ...decoded, encapsulated: false }
    return asDecoded.samplesPerPixel > 1
      ? { kind: 'colour', compressed: true, ...downscale(decodeFrame(asDecoded, decoded.bytes), maxEdge) }
      : { kind: 'grey', compressed: true, ...downscaleGrey(decodeGreyFrame(asDecoded, decoded.bytes), maxEdge) }
  }

  const length = frameByteLength(header)
  const offset = frameOffset(header, frame)

  const handle = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, offset)
    const bytes = new Uint8Array(buffer.subarray(0, bytesRead))

    if (header.samplesPerPixel > 1) {
      return { kind: 'colour', compressed: false, ...downscale(decodeFrame(header, bytes), maxEdge) }
    }
    return { kind: 'grey', compressed: false, ...downscaleGrey(decodeGreyFrame(header, bytes), maxEdge) }
  } finally {
    await handle.close()
  }
}

/** Forget cached headers when a new import starts. */
export function clearPreviewHeaders(): void {
  headers.clear()
  openFile = null
}
