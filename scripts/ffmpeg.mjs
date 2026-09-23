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
 * The builds are eugeneware/ffmpeg-static's, pinned by release and by the
 * SHA-256 of each binary. A download that hashes differently is refused rather
 * than shipped: this is an executable the app runs on patient data, and one
 * that changed under a fixed release name is not one anybody looked at.
 *
 * Kept out of the repository — 45 to 80 MB each — and fetched by the dist
 * scripts and by CI before the tests, which decode real bitstreams through it.
 * node_modules/.cache rather than resources/, because it is ignored by git and
 * is where a tool's downloads are expected to live; an npm ci that empties it
 * is answered by the next run of this.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const RELEASE = 'b6.1.1'
const BASE = `https://github.com/eugeneware/ffmpeg-static/releases/download/${RELEASE}`

/** SHA-256 of the unzipped binary, and of the licence that travels with it. */
const PINNED = {
  'darwin-x64': {
    binary: 'ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894',
    licence: '2e1d16c72fd74e12063776371da757322f8b77589386532f4fd8634bde7de1af'
  },
  'darwin-arm64': {
    binary: 'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584',
    licence: 'cb48bf09a11f5fb576cddb0431c8f5ed0a60157a9ec942adffc13907cbe083f2'
  },
  'linux-x64': {
    binary: 'e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99',
    licence: '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903'
  },
  'linux-arm64': {
    binary: '6bb182d0d75d23028db82e9e4f723ca69b853d055698486e6984ddb2c06fb8ce',
    licence: '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903'
  },
  'win32-x64': {
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

  const bytes = gunzipSync(await download(`${BASE}/ffmpeg-${target}.gz`))
  if (sha256(bytes) !== pinned.binary) {
    throw new Error(`ffmpeg-${target} from ${RELEASE} does not hash to the pinned SHA-256; refusing it`)
  }
  const text = await download(`${BASE}/${target}.LICENSE`)
  if (sha256(text) !== pinned.licence) {
    throw new Error(`${target}.LICENSE from ${RELEASE} does not hash to the pinned SHA-256; refusing it`)
  }

  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(binary, bytes, { mode: 0o755 })
  fs.writeFileSync(licence, text)
  console.log(`${target.padEnd(13)}: ${(bytes.length / 1024 ** 2).toFixed(0)} MB`)
}

const [platform = process.platform, ...arches] = process.argv.slice(2)
const wanted = arches.length > 0 ? arches : PACKAGED[platform]
if (!wanted) throw new Error(`No ffmpeg is packaged for ${platform}`)
for (const arch of wanted) await fetchTarget(`${platform}-${arch}`)
