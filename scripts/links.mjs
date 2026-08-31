/**
 * The download buttons in the README, written from the version in package.json.
 *
 * A link that carries a version goes stale the moment the version changes —
 * silently, and on the front page, where a stale link is a 404 for whoever
 * came to try the app. Which is why this is generated rather than typed. It
 * runs on `npm version` as well as on demand, so the links are already right
 * in the commit that bumps the version.
 *
 * The filenames themselves live in `scripts/downloads.mjs`, which the
 * documentation home page reads too.
 *
 * Run with: npm run links
 */
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { BREW_INSTALL, BREW_UNQUARANTINE, REPO, downloads, version } from './downloads.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const readme = path.join(root, 'README.md')

const START = '<!-- downloads: npm run links -->'
const END = '<!-- /downloads -->'

/** A shields badge, which is how every other button in this README is drawn. */
function badge(label, message, colour, logo) {
  const text = `${encodeURIComponent(label)}-${encodeURIComponent(message)}-${colour}`
  return `https://img.shields.io/badge/${text}?style=for-the-badge&logo=${logo}&logoColor=white`
}

/** Shields has no logo named "macos"; each platform's is its own. */
const BADGE = {
  mac: { colour: '111111', logo: 'apple' },
  linux: { colour: 'FCC624', logo: 'linux' },
  windows: { colour: '0078D6', logo: 'windows' }
}

function block(v) {
  const { platforms } = downloads(v)
  const byId = Object.fromEntries(platforms.map((p) => [p.id, p]))

  const row = (id) => {
    const p = byId[id]
    const { colour, logo } = BADGE[id]
    const button = `[![${p.name}](${badge(p.name, p.primary.label, colour, logo)})](${p.primary.url})`
    const rest = p.others.map((o) => `${o.label}: [${o.kind}](${o.url})`).join(' · ')
    return `| ${button} | ${rest} |`
  }

  return [
    START,
    '',
    `Version **${v}**. Nothing is signed, so the first launch needs one extra step per`,
    `platform: [how to open it](https://gmadevs.github.io/Radiouploader/guide/install).`,
    '',
    '| | Also built |',
    '|---|---|',
    row('mac'),
    row('linux'),
    row('windows'),
    '',
    'On macOS, with Homebrew — the second line because the app is not signed and',
    'Homebrew quarantines what it downloads:',
    '',
    '```bash',
    BREW_INSTALL,
    BREW_UNQUARANTINE,
    '```',
    '',
    `Older versions, and the notes that come with each, are on the [releases page](${REPO}/releases).`,
    '',
    END
  ].join('\n')
}

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
