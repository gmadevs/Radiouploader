/**
 * The download buttons in the README, written from the version in package.json.
 *
 * GitHub has no stable URL for "the newest installer": `/releases/latest`
 * resolves only to a release that is *not* a pre-release, and every release
 * here is one. So the links carry the version, and a link that carries a
 * version goes stale the moment the version changes — silently, and on the
 * front page, where a stale link is a 404 for whoever came to try the app.
 *
 * Which is why this is generated rather than typed. It runs on `npm version`
 * as well as on demand, so the links are already right in the commit that
 * bumps the version.
 *
 * Run with: npm run links
 */
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const readme = path.join(root, 'README.md')

const REPO = 'https://github.com/gmadevs/Radiouploader'
const START = '<!-- downloads: npm run links -->'
const END = '<!-- /downloads -->'

/**
 * What electron-builder names each target, which is not one convention but
 * three: the dmg and the AppImage take the product name and a dash, the deb
 * takes the package name and underscores and calls x64 amd64, and NSIS writes
 * "Setup" in the middle. Checked against the files v0.1.0-beta.1 produced
 * rather than read off the documentation.
 */
const ASSETS = {
  macArm: (v) => `Radiouploader-${v}-arm64.dmg`,
  macIntel: (v) => `Radiouploader-${v}.dmg`,
  appImage: (v) => `Radiouploader-${v}.AppImage`,
  appImageArm: (v) => `Radiouploader-${v}-arm64.AppImage`,
  deb: (v) => `radiouploader_${v}_amd64.deb`,
  debArm: (v) => `radiouploader_${v}_arm64.deb`,
  windows: (v) => `Radiouploader.Setup.${v}.exe`
}

/** A shields badge, which is how every other button in this README is drawn. */
function badge(label, message, colour, logo) {
  const text = `${encodeURIComponent(label)}-${encodeURIComponent(message)}-${colour}`
  return `https://img.shields.io/badge/${text}?style=for-the-badge&logo=${logo}&logoColor=white`
}

function block(version) {
  const url = (asset) => `${REPO}/releases/download/v${version}/${asset(version)}`

  return [
    START,
    '',
    `Version **${version}** — a pre-release, like every release so far. Nothing is signed, so`,
    'the first launch needs one extra step per platform:',
    `[how to open it](https://gmadevs.github.io/Radiouploader/guide/install).`,
    '',
    '| | Also built |',
    '|---|---|',
    `| [![macOS](${badge('macOS', 'Apple silicon', '111111', 'apple')})](${url(ASSETS.macArm)}) | Intel: [.dmg](${url(ASSETS.macIntel)}) |`,
    `| [![Linux](${badge('Linux', 'AppImage x64', 'FCC624', 'linux')})](${url(ASSETS.appImage)}) | arm64: [.AppImage](${url(ASSETS.appImageArm)}) · Debian: [amd64](${url(ASSETS.deb)}) · [arm64](${url(ASSETS.debArm)}) |`,
    `| [![Windows](${badge('Windows', 'Installer x64', '0078D6', 'windows')})](${url(ASSETS.windows)}) | |`,
    '',
    `Older versions, and the notes that come with each, are on the [releases page](${REPO}/releases).`,
    '',
    END
  ].join('\n')
}

const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
const text = await fs.readFile(readme, 'utf8')

const from = text.indexOf(START)
const to = text.indexOf(END)
if (from === -1 || to === -1 || to < from) {
  console.error(`PROBLEMS: README.md has no ${START} … ${END} block to write into`)
  process.exit(1)
}

const updated = text.slice(0, from) + block(version) + text.slice(to + END.length)
if (updated === text) {
  console.log(`README download links already at ${version}`)
} else {
  await fs.writeFile(readme, updated)
  console.log(`README download links written for ${version}`)
}
