import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import { once } from 'node:events'
import path from 'node:path'
import dicomParser from 'dicom-parser'
import type { DecodedSamples } from './decode'

/**
 * DICOM video: MPEG-2, H.264 and HEVC.
 *
 * Unlike every other compressed syntax, a video's frames are not fragments that
 * can be decoded one at a time. The pixel data holds one stream — inside a
 * container, MPEG-TS or MP4 for H.264 and HEVC and anything from an elementary
 * stream to a program stream for MPEG-2 (PS3.5 8.2.5–8.2.8) — where most frames
 * are differences from the ones before them. So a video is decoded whole, once,
 * into plain RGB on disk, and from then on a frame of it is a byte range like a
 * frame of any uncompressed cine: the preview reads it, the mask paints it and
 * the split writes it out.
 *
 * The decoder is ffmpeg, shipped with the app and run as a child process of
 * this one — no WASM codec reads these, and Chromium's own decoders sit in a
 * renderer, which would put hundreds of megabytes of patient pixels through the
 * IPC bridge. scripts/ffmpeg.mjs says where the binaries come from.
 */

/** MPEG-2, the four MPEG-4 AVC/H.264 profiles and their stereo and BD variants, and HEVC. */
const VIDEO_SYNTAXES = new Set([
  '1.2.840.10008.1.2.4.100',
  '1.2.840.10008.1.2.4.100.1',
  '1.2.840.10008.1.2.4.101',
  '1.2.840.10008.1.2.4.101.1',
  '1.2.840.10008.1.2.4.102',
  '1.2.840.10008.1.2.4.102.1',
  '1.2.840.10008.1.2.4.103',
  '1.2.840.10008.1.2.4.103.1',
  '1.2.840.10008.1.2.4.104',
  '1.2.840.10008.1.2.4.104.1',
  '1.2.840.10008.1.2.4.105',
  '1.2.840.10008.1.2.4.105.1',
  '1.2.840.10008.1.2.4.106',
  '1.2.840.10008.1.2.4.106.1',
  '1.2.840.10008.1.2.4.107',
  '1.2.840.10008.1.2.4.108'
])

export function isVideoSyntax(transferSyntax: string | null | undefined): boolean {
  return transferSyntax !== null && transferSyntax !== undefined && VIDEO_SYNTAXES.has(transferSyntax)
}

/** A video decoded to plain RGB, three bytes a pixel, one frame after another. */
export interface DecodedVideo {
  path: string
  frames: number
  rows: number
  columns: number
}

const executable = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'

/**
 * Where the ffmpeg for this machine is.
 *
 * Packaged, electron-builder has put the one for this architecture beside the
 * app's other resources. Anywhere else — the dev build, the tests — it is the
 * one scripts/ffmpeg.mjs fetched into node_modules/.cache, found by walking up
 * from here, since this file runs from src/ under the tests and from out/ once
 * built.
 */
export function ffmpegPath(): string {
  const resources = (process as { resourcesPath?: string }).resourcesPath
  if (resources) {
    const packaged = path.join(resources, 'ffmpeg', executable)
    if (existsSync(packaged)) return packaged
  }
  const target = `${process.platform}-${process.arch}`
  for (let dir = import.meta.dirname; ; dir = path.dirname(dir)) {
    const fetched = path.join(dir, 'node_modules', '.cache', 'ffmpeg', target, executable)
    if (existsSync(fetched)) return fetched
    if (path.dirname(dir) === dir) break
  }
  throw new Error(`The video decoder is missing from this build (no ffmpeg for ${target}); run npm run ffmpeg`)
}

let version: Promise<string | null> | null = null

/**
 * The decoder this build reads video with, as "ffmpeg 6.1.1", or null when it
 * has none that runs.
 *
 * Asked of the binary rather than read from anywhere, because the question is
 * whether this install can decode a video — present, executable and built for
 * this machine — and only running it answers that. The About panel and a
 * problem report quote it, and the install job checks every installer by it.
 */
export function ffmpegVersion(): Promise<string | null> {
  version ??= new Promise((resolve) => {
    let binary: string
    try {
      binary = ffmpegPath()
    } catch {
      resolve(null)
      return
    }
    const child = spawn(binary, ['-hide_banner', '-version'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
    child.on('error', () => resolve(null))
    child.on('close', (code) => {
      // "ffmpeg version 6.1.1-tessus ..." — the number, without the builder's suffix.
      const number = /^ffmpeg version n?(\d+(?:\.\d+)*)/.exec(out)?.[1]
      resolve(code === 0 && number ? `ffmpeg ${number}` : null)
    })
  })
  return version
}

/**
 * The whole video stream out of a file's pixel data.
 *
 * Every fragment belongs to the one stream — the fragmentable syntaxes may cut
 * it anywhere, and a cut means nothing — so they are joined in order and the
 * offset table, which would point at frames a video does not store apart, is
 * not consulted.
 */
export function videoBitstream(bytes: Uint8Array): Uint8Array {
  const dataSet = dicomParser.parseDicom(bytes)
  const element = dataSet.elements.x7fe00010
  if (!element?.fragments?.length) throw new Error('This file has no video stream in its pixel data')
  return dicomParser.readEncapsulatedPixelDataFromFragments(dataSet, element, 0, element.fragments.length)
}

/**
 * The header ffmpeg writes before each frame when asked for PPM: "P6", the
 * width, the height and the largest value, then exactly one whitespace byte.
 * Null until the whole header has arrived.
 */
function ppmHeader(bytes: Buffer): { width: number; height: number; length: number } | null {
  const text = bytes.subarray(0, Math.min(bytes.length, 64)).toString('latin1')
  const match = /^P6\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(text)
  if (match) {
    if (match[3] !== '255') throw new Error(`The video decoded to ${match[3]}-level samples, not 8-bit`)
    return { width: Number(match[1]), height: Number(match[2]), length: match[0].length }
  }
  if (bytes.length >= 64 || (bytes.length >= 2 && text.slice(0, 2) !== 'P6')) {
    throw new Error('The video decoder wrote something that is not a frame')
  }
  return null
}

/**
 * Decode a video file into plain RGB at `output`, and count its frames.
 *
 * Asked for PPM rather than bare samples because PPM says, frame by frame, how
 * big it is: a stream whose pictures are not the size the DICOM header claims
 * is refused here, where it can be named, instead of being cut into frames at
 * the wrong places and uploaded as noise. The headers are dropped on the way
 * to disk, so what is written is the frames alone, back to back.
 */
export async function decodeVideo(
  input: string,
  output: string,
  expected: { rows: number; columns: number }
): Promise<number> {
  const child = spawn(
    ffmpegPath(),
    [
      '-hide_banner', '-nostdin', '-loglevel', 'error',
      '-i', input,
      // The first video stream only; an audio track or a second view is not a picture.
      '-map', '0:v:0',
      // Every frame the stream holds, once each: no rate conversion dropping or
      // repeating frames to hit a frame rate nobody asked for.
      '-fps_mode', 'passthrough',
      '-f', 'image2pipe', '-c:v', 'ppm', '-pix_fmt', 'rgb24',
      'pipe:1'
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000)
  })
  const exited = new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? -1))
  })
  // Awaited below on the way out; a throw before then must not leave it unheard.
  exited.catch(() => {})

  const sink = createWriteStream(output)
  const frameBytes = expected.rows * expected.columns * 3
  let pending: Buffer = Buffer.alloc(0)
  let remaining = 0
  let frames = 0

  try {
    for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
      pending = pending.length > 0 ? Buffer.concat([pending, chunk]) : chunk
      for (;;) {
        if (remaining > 0) {
          const take = Math.min(remaining, pending.length)
          if (take === 0) break
          if (!sink.write(pending.subarray(0, take))) await once(sink, 'drain')
          pending = pending.subarray(take)
          remaining -= take
          continue
        }
        if (pending.length === 0) break
        const header = ppmHeader(pending)
        if (header === null) break
        if (header.width !== expected.columns || header.height !== expected.rows) {
          throw new Error(
            `The video is ${header.width}x${header.height} where the header says ${expected.columns}x${expected.rows}`
          )
        }
        pending = pending.subarray(header.length)
        remaining = frameBytes
        frames++
      }
    }
    const code = await exited
    if (code !== 0) throw new Error(`The video could not be decoded: ${stderr.trim() || `ffmpeg exited with ${code}`}`)
    if (remaining > 0) throw new Error('The video stream ends in the middle of a frame')
    if (frames === 0) throw new Error('The video stream holds no frames')
  } catch (error) {
    child.kill()
    throw error
  } finally {
    sink.end()
    await once(sink, 'close')
  }
  return frames
}

/**
 * Decode the video in a DICOM file, writing its frames to `rawPath`.
 *
 * The stream goes through a file beside it rather than a pipe: an MP4 may keep
 * its index at the end, which ffmpeg can only reach by seeking.
 */
export async function decodeVideoFile(
  sourcePath: string,
  rawPath: string,
  expected: { rows: number; columns: number }
): Promise<DecodedVideo> {
  const streamPath = `${rawPath}.stream`
  await fs.writeFile(streamPath, videoBitstream(new Uint8Array(await fs.readFile(sourcePath))))
  try {
    const frames = await decodeVideo(streamPath, rawPath, expected)
    return { path: rawPath, frames, ...expected }
  } finally {
    await fs.rm(streamPath, { force: true })
  }
}

/** One frame of a decoded video, as the samples the rest of the app reads. */
export async function readVideoFrame(video: DecodedVideo, frame: number): Promise<DecodedSamples> {
  if (frame < 0 || frame >= video.frames) {
    throw new Error(`The video holds ${video.frames} frames, and frame ${frame + 1} is not one of them`)
  }
  const length = video.rows * video.columns * 3
  const handle = await fs.open(video.path, 'r')
  try {
    const bytes = new Uint8Array(length)
    const { bytesRead } = await handle.read(bytes, 0, length, frame * length)
    if (bytesRead !== length) throw new Error(`Frame ${frame + 1} of the video is cut short`)
    return { bytes, bitsAllocated: 8, samplesPerPixel: 3, signed: false, planarConfiguration: 0, photometric: 'RGB' }
  } finally {
    await handle.close()
  }
}
