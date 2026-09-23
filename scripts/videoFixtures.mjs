/**
 * Write the video bitstreams the decoder tests wrap in DICOM:
 *
 *   node scripts/videoFixtures.mjs [ffmpeg]
 *
 * A DICOM video is a container, not a bare stream — MPEG-TS or MP4 for H.264
 * and HEVC, anything from an elementary stream to a program stream for MPEG-2
 * (PS3.5 8.2.5–8.2.8) — so there is one fixture per codec and container the
 * decoder has to open, and the tests wrap each in the pixel data element.
 *
 * Every one is the same twelve frames, drawn so that a decode can be checked
 * rather than merely completed: the left half red and the right half blue,
 * which is what a swapped colour conversion gets wrong without looking wrong,
 * and a strip along the top whose grey steps up frame by frame, which is what
 * frames out of order, dropped or repeated get wrong.
 *
 * Generated, never real: this is a public repository. Needs an ffmpeg with
 * libx264 and libx265, which the bundled one has; the one on the path is used
 * unless another is named.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ffmpeg = process.argv[2] ?? 'ffmpeg'
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/main/codecs/__fixtures__')

export const WIDTH = 64
export const HEIGHT = 48
export const FRAMES = 12

// geq draws in RGB here, so the red and blue halves are what was asked for
// before any encoder's colour conversion, and the strip is grey in every channel.
const strip = `20+N*15`
const picture = [
  `r='if(lt(Y,8),${strip},if(lt(X,W/2),220,20))'`,
  `g='if(lt(Y,8),${strip},20)'`,
  `b='if(lt(Y,8),${strip},if(lt(X,W/2),20,220))'`
].join(':')

const FIXTURES = [
  { file: 'video-h264.mpegts', codec: ['-c:v', 'libx264', '-profile:v', 'high'], format: 'mpegts' },
  { file: 'video-h264.mp4', codec: ['-c:v', 'libx264', '-profile:v', 'high'], format: 'mp4' },
  { file: 'video-hevc.mpegts', codec: ['-c:v', 'libx265', '-x265-params', 'log-level=error'], format: 'mpegts' },
  { file: 'video-mpeg2.mpg', codec: ['-c:v', 'mpeg2video', '-q:v', '2'], format: 'vob' }
]

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(dir, { recursive: true })
  for (const { file, codec, format } of FIXTURES) {
    const out = path.join(dir, file)
    const result = spawnSync(
      ffmpeg,
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', `color=black:s=${WIDTH}x${HEIGHT}:r=25,format=gbrp`,
        '-vf', `geq=${picture},format=yuv420p`,
        '-frames:v', String(FRAMES),
        ...codec,
        // Deterministic output, so regenerating does not rewrite the fixtures.
        '-fflags', '+bitexact', '-flags:v', '+bitexact', '-map_metadata', '-1',
        '-f', format, out
      ],
      { stdio: 'inherit' }
    )
    if (result.status !== 0) throw new Error(`ffmpeg could not write ${file}`)
    console.log(`${file.padEnd(18)}: ${fs.statSync(out).size} bytes`)
  }
}
