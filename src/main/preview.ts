import fs from 'node:fs/promises'
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

/**
 * Frame previews, decoded here rather than in the renderer.
 *
 * Sending whole DICOM files across the IPC bridge does not scale: a cine run is
 * routinely 250 MB, and shipping one costs three copies — the read, the
 * ArrayBuffer slice and the structured clone — which is how this used to fail
 * with "RangeError: Failed to allocate memory". Only the finished pixels of one
 * frame cross the bridge now.
 */

/** Enough for any conventional header; retried larger if an exporter is unusual. */
const HEADER_PROBE_SIZES = [64 * 1024, 1024 * 1024, 16 * 1024 * 1024]

/** The preview card is a couple of hundred pixels wide even at 2x. */
export const MAX_PREVIEW_EDGE = 512

/** As large as the viewer is ever shown, so a mask can be placed precisely. */
export const MAX_VIEWER_EDGE = 1024

/** Headers are small, so caching them costs little and saves a read per frame. */
const headers = new Map<string, ImageHeader>()
const MAX_CACHED_HEADERS = 64

async function headerFor(filePath: string): Promise<ImageHeader> {
  const cached = headers.get(filePath)
  if (cached) return cached

  const { size } = await fs.stat(filePath)
  let lastError: unknown

  for (const probe of HEADER_PROBE_SIZES) {
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
      // A compressed transfer syntax will not parse at any size; reading more
      // of the file would only waste time.
      if (err instanceof Error && err.name === 'UnsupportedTransferSyntaxError') throw err
      if (length >= size) break
    } finally {
      await handle.close()
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Could not read the DICOM header')
}

/** Decode one frame of one file, shrunk to fit `maxEdge`. */
export async function readPreviewFrame(
  filePath: string,
  frame: number,
  maxEdge: number = MAX_PREVIEW_EDGE
): Promise<PreviewFrame> {
  const header = await headerFor(filePath)
  const length = frameByteLength(header)
  const offset = frameOffset(header, frame)

  const handle = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, offset)
    const bytes = new Uint8Array(buffer.subarray(0, bytesRead))

    if (header.samplesPerPixel > 1) {
      return { kind: 'colour', ...downscale(decodeFrame(header, bytes), maxEdge) }
    }
    return { kind: 'grey', ...downscaleGrey(decodeGreyFrame(header, bytes), maxEdge) }
  } finally {
    await handle.close()
  }
}

/** Forget cached headers when a new import starts. */
export function clearPreviewHeaders(): void {
  headers.clear()
}
