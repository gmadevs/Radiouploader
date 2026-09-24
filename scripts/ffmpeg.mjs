/**
 * Put the ffmpeg binaries the app ships in node_modules/.cache/ffmpeg/<platform>-<arch>/:
 *
 *   node scripts/ffmpeg.mjs [platform] [arch ...]
 *
 * With no arguments, every architecture electron-builder packages for this
 * platform — both on macOS and Linux, where one machine builds both installers
 * and each must carry the binary for its own architecture, not the builder's.
 *
 * ffmpeg decodes DICOM video, which no WASM codec here reads: MPEG-2, H.264 and
 * HEVC, inside the MPEG-TS, MP4 or program-stream containers the standard
 * allows. See src/main/codecs/video.ts.
 *
 * macOS and Windows come from eugeneware/ffmpeg-static; Linux from BtbN's
 * FFmpeg-Builds, LGPL, pinned to a month-end autobuild, which BtbN keeps for about
 * two years where the daily ones go in a fortnight. ffmpeg-static's Linux x64 build
 * crashes on any MPEG-TS input on AMD EPYC and not on Intel — a segfault inside the
 * demuxer, before a frame — and MPEG-TS is the container H.264 is most often written
 * in; its arm64 build was fine but is replaced with it, so Linux has one source.
 *
 * Everything is pinned by release and by SHA-256: the archive before anything is
 * unpacked from it, then the binary and the licence that travels with it. A
 * download that hashes differently is refused rather than shipped: this is an
 * executable the app runs on patient data, and one that changed under a fixed
 * release name is not one anybody looked at.
 *
 * Kept out of the repository — 45 to 110 MB each — and fetched by the dist
 * scripts and by CI before the tests, which decode real bitstreams through it.
 * node_modules/.cache rather than resources/, because it is ignored by git and
 * is where a tool's downloads are expected to live; an npm ci that empties it
 * is answered by the next run of this.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const STATIC = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1'
const BTBN = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-31-13-27'
const btbn = (arch) => `ffmpeg-n8.1.2-50-g1a748fe2cd-${arch}-lgpl-8.1`

/**
 * Where each binary comes from and what it must hash to. A gzip holds the
 * binary alone and the licence is a file beside it; a tar.xz holds both, and
 * its own hash is checked before tar is let near it.
 */
const PINNED = {
  'darwin-x64': {
    gzip: `${STATIC}/ffmpeg-darwin-x64.gz`,
    licenceUrl: `${STATIC}/darwin-x64.LICENSE`,
    binary: 'ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894',
    licence: '2e1d16c72fd74e12063776371da757322f8b77589386532f4fd8634bde7de1af'
  },
  'darwin-arm64': {
    gzip: `${STATIC}/ffmpeg-darwin-arm64.gz`,
    licenceUrl: `${STATIC}/darwin-arm64.LICENSE`,
    binary: 'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584',
    licence: 'cb48bf09a11f5fb576cddb0431c8f5ed0a60157a9ec942adffc13907cbe083f2'
  },
  'linux-x64': {
    tarXz: `${BTBN}/${btbn('linux64')}.tar.xz`,
    archive: '7d6d93e9c39e0e461feb13c118e91e4eec2515e4da3a01d4ad6790996731bbee',
    members: { binary: `${btbn('linux64')}/bin/ffmpeg`, licence: `${btbn('linux64')}/LICENSE.txt` },
    binary: '3a66bf5ff30b8e7c9ab5bcc235ab754cac35b82591aba551c0e80b2576893da8',
    licence: 'da7eabb7bafdf7d3ae5e9f223aa5bdc1eece45ac569dc21b3b037520b4464768'
  },
  'linux-arm64': {
    tarXz: `${BTBN}/${btbn('linuxarm64')}.tar.xz`,
    archive: '56b37b6f2832ba37bd4979ae5c4521ae718efa41846a0d3ecfbbe492137c66f6',
    members: { binary: `${btbn('linuxarm64')}/bin/ffmpeg`, licence: `${btbn('linuxarm64')}/LICENSE.txt` },
    binary: '8c3dd8aeb8cd27a336b02180a5539225985c53f0d40ece1afa8442a6456331fd',
    licence: 'da7eabb7bafdf7d3ae5e9f223aa5bdc1eece45ac569dc21b3b037520b4464768'
  },
  'win32-x64': {
    gzip: `${STATIC}/ffmpeg-win32-x64.gz`,
    licenceUrl: `${STATIC}/win32-x64.LICENSE`,
    binary: '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00',
    licence: '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903'
  }
}

/** The architectures electron-builder.yml packages, per platform. */
const PACKAGED = { darwin: ['arm64', 'x64'], linux: ['x64', 'arm64'], win32: ['x64'] }

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function download(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`)
  return Buffer.from(await res.arrayBuffer())
}

/** The binary and licence out of a tar.xz whose hash has already been checked. */
function unpack(archive, members, scratch) {
  const result = spawnSync('tar', ['-xJf', archive, '-C', scratch, members.binary, members.licence], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`tar could not unpack ${path.basename(archive)}`)
  return {
    bytes: fs.readFileSync(path.join(scratch, members.binary)),
    text: fs.readFileSync(path.join(scratch, members.licence))
  }
}

async function fetchTarget(target) {
  const pinned = PINNED[target]
  if (!pinned) throw new Error(`No ffmpeg is pinned for ${target}`)

  const dir = path.join(root, 'node_modules', '.cache', 'ffmpeg', target)
  const binary = path.join(dir, target.startsWith('win32') ? 'ffmpeg.exe' : 'ffmpeg')
  const licence = path.join(dir, 'LICENSE')

  const have = (file, hash) => fs.existsSync(file) && sha256(fs.readFileSync(file)) === hash
  if (have(binary, pinned.binary) && have(licence, pinned.licence)) {
    console.log(`${target.padEnd(13)}: already here`)
    return
  }

  let bytes
  let text
  if (pinned.tarXz) {
    const archive = await download(pinned.tarXz)
    if (sha256(archive) !== pinned.archive) {
      throw new Error(`${path.basename(pinned.tarXz)} does not hash to the pinned SHA-256; refusing it`)
    }
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-'))
    try {
      const file = path.join(scratch, 'archive.tar.xz')
      fs.writeFileSync(file, archive)
      ;({ bytes, text } = unpack(file, pinned.members, scratch))
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true })
    }
  } else {
    bytes = gunzipSync(await download(pinned.gzip))
    text = await download(pinned.licenceUrl)
  }
  if (sha256(bytes) !== pinned.binary) throw new Error(`The ffmpeg for ${target} does not hash to the pinned SHA-256; refusing it`)
  if (sha256(text) !== pinned.licence) throw new Error(`The ffmpeg licence for ${target} does not hash to the pinned SHA-256; refusing it`)

  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(binary, bytes, { mode: 0o755 })
  fs.writeFileSync(licence, text)
  console.log(`${target.padEnd(13)}: ${(bytes.length / 1024 ** 2).toFixed(0)} MB`)
}

const [platform = process.platform, ...arches] = process.argv.slice(2)
const wanted = arches.length > 0 ? arches : PACKAGED[platform]
if (!wanted) throw new Error(`No ffmpeg is packaged for ${platform}`)
for (const arch of wanted) await fetchTarget(`${platform}-${arch}`)
