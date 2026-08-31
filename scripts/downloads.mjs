/**
 * Where each installer of a given version lives, in one place.
 *
 * GitHub has no stable URL for "the newest installer": `/releases/latest`
 * resolves to the newest release's *page*, and a direct download needs the
 * asset's own filename, which electron-builder writes the version into. So
 * every download link carries the version, and a link that carries a version
 * goes stale the moment the version changes — silently, on the front page,
 * where stale means a 404 for whoever came to try the app.
 *
 * Two front pages ask for the same links now: the README, written by
 * `npm run links`, and the documentation home page, which reads this at build
 * time through `docs/.vitepress/config.ts`. Two copies of the filenames would
 * drift, and the one that drifted would be the one nobody ran the generator
 * for, so both take them from here.
 */
import fs from 'node:fs'

export const REPO = 'https://github.com/gmadevs/Radiouploader'

/**
 * Installing on macOS with Homebrew, from a tap of this project's own.
 *
 * Two lines rather than one, and the second is not optional: Homebrew marks
 * every cask download the way a browser would, and current Homebrew has no
 * `--no-quarantine` to turn that off any more — the flag is gone, and nothing
 * in it releases a download from quarantine. Nothing here is signed, so macOS
 * then refuses the first launch of the app Homebrew has just installed, and
 * whoever typed one command is left at a dialog.
 *
 * Removing the mark is left to the person installing rather than done by the
 * cask in a postflight: waiving Gatekeeper on an unsigned binary is a decision
 * that should be made in the open.
 */
export const BREW_INSTALL = 'brew install --cask gmadevs/radiouploader/radiouploader'

/** What the install above needs afterwards, since the app is not signed. */
export const BREW_UNQUARANTINE = 'xattr -dr com.apple.quarantine /Applications/Radiouploader.app'

/** The version the app is at, which is also the tag its release is under. */
export const version = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version

/**
 * What electron-builder names each target, which is not one convention but
 * three: the dmg and the AppImage take the product name and a dash, the deb
 * takes the package name and underscores and calls x64 amd64, and NSIS writes
 * "Setup" in the middle. Checked against the files a real tag produced rather
 * than read off the documentation — v0.1.0-beta.1 for all three, and v1.0.0
 * again for the mac pair, which is where dropping the suffix could have moved
 * a name.
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

/**
 * The three platforms, each with the build most people want and the rest
 * behind it. `first` is what that platform does on an unsigned binary the
 * first time it is opened — the same step the install guide gives, said
 * where somebody is about to download rather than after they have.
 */
export function downloads(v = version) {
  const url = (asset) => `${REPO}/releases/download/v${v}/${asset(v)}`

  return {
    version: v,
    releases: `${REPO}/releases`,
    brew: BREW_INSTALL,
    brewUnquarantine: BREW_UNQUARANTINE,
    platforms: [
      {
        id: 'mac',
        name: 'macOS',
        primary: { label: 'Apple silicon', kind: '.dmg', url: url(ASSETS.macArm) },
        others: [{ label: 'Intel', kind: '.dmg', url: url(ASSETS.macIntel) }],
        first: 'Gatekeeper blocks an unsigned app: allow it in System Settings → Privacy & Security.'
      },
      {
        id: 'windows',
        name: 'Windows',
        primary: { label: 'x64 installer', kind: '.exe', url: url(ASSETS.windows) },
        others: [],
        first: 'SmartScreen warns until the binary builds reputation: More info → Run anyway.'
      },
      {
        id: 'linux',
        name: 'Linux',
        primary: { label: 'AppImage x64', kind: '.AppImage', url: url(ASSETS.appImage) },
        others: [
          { label: 'AppImage arm64', kind: '.AppImage', url: url(ASSETS.appImageArm) },
          { label: 'Debian amd64', kind: '.deb', url: url(ASSETS.deb) },
          { label: 'Debian arm64', kind: '.deb', url: url(ASSETS.debArm) }
        ],
        first: 'chmod +x the AppImage, or install the deb.'
      }
    ]
  }
}
