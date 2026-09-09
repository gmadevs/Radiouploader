import fs from 'node:fs/promises'
import { app } from 'electron'
import type { UpdateStatus } from '@shared/types'
import { isNewerVersion } from '@shared/version'
import { loadConfig, saveConfig } from './api/store'

/**
 * Is there a newer release than the one running?
 *
 * Nothing is downloaded and nothing is installed: the app is unsigned on every
 * platform, so an installer it fetched for itself would be an unsigned binary
 * arriving over the wire with no one having looked at it. It says a version
 * exists and hands over the command or the page that gets it.
 *
 * This is the one request the app makes on its own, before anything is
 * imported and while the home screen still says nothing leaves this computer —
 * which is why it is a request to GitHub for a version number and nothing else,
 * why it can be turned off, and why the page that describes it says so.
 */

const REPO = 'gmadevs/Radiouploader'
const LATEST_RELEASE = `https://api.github.com/repos/${REPO}/releases/latest`
export const RELEASES_PAGE = `https://github.com/${REPO}/releases`

/** Long enough for a slow connection, short enough that nobody waits on it. */
const TIMEOUT_MS = 6000

/**
 * Where Homebrew records what it installed.
 *
 * The Caskroom is the evidence, not the presence of `brew`: plenty of people
 * have Homebrew and installed this app by dragging it out of the disk image,
 * and `brew upgrade radiouploader` fails for them with "no available formula".
 */
const CASKROOMS = ['/opt/homebrew/Caskroom/radiouploader', '/usr/local/Caskroom/radiouploader']

interface GithubRelease {
  tag_name?: string
  html_url?: string
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate)
    return true
  } catch {
    return false
  }
}

/** The bundle this process is running out of, e.g. /Applications/Radiouploader.app. */
function bundlePath(): string {
  const exe = app.getPath('exe')
  const marker = exe.indexOf('.app/')
  return marker === -1 ? '/Applications/Radiouploader.app' : exe.slice(0, marker + 4)
}

/**
 * The command that upgrades this install, or null when there is not one.
 *
 * The second line is not optional and not decoration. Homebrew quarantines
 * every cask download the way a browser would, and this app is unsigned, so an
 * upgraded copy that keeps the quarantine flag is one macOS refuses to open —
 * the same step the install instructions carry, at the same moment.
 *
 * Two lines rather than one joined with `&&`, because that one was 103
 * characters and a command that long wraps in a narrow window. What is copied
 * out of a wrapped rendering carries the wrap, the break lands mid-command, and
 * `xattr -dr com.apple.quarantine` without its path answers "Not enough
 * arguments for option -d" — which is a paste that failed, reported as though
 * the app had given out a broken command. Neither line here reaches 62.
 */
export async function upgradeCommand(): Promise<string | null> {
  if (process.platform !== 'darwin') return null

  const installedByBrew = await Promise.all(CASKROOMS.map(exists))
  if (!installedByBrew.some(Boolean)) return null

  // A cask installs to /Applications, where there is no space to worry about —
  // but the path is read off this process rather than assumed, and a command
  // handed over to be pasted has to survive whatever comes back.
  const bundle = bundlePath()
  const target = bundle.includes(' ') ? `'${bundle}'` : bundle
  return `brew upgrade --cask radiouploader\nxattr -dr com.apple.quarantine ${target}`
}

async function latestRelease(): Promise<{ version: string; url: string } | null> {
  const response = await fetch(LATEST_RELEASE, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Radiouploader/${app.getVersion()}` },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!response.ok) return null

  const release = (await response.json()) as GithubRelease
  // /releases/latest is the newest published, non-draft, non-prerelease one, so
  // a beta cut after this build does not present itself as an upgrade.
  return release.tag_name ? { version: release.tag_name, url: release.html_url ?? RELEASES_PAGE } : null
}

/**
 * What to tell the user about updates, if anything.
 *
 * A check that could not run — no network, GitHub down, a rate limit — is
 * silence. There is no state in the app this failure changes and nothing the
 * user can do about it, so an error over the home screen would be noise about
 * the app's own housekeeping.
 */
export async function checkForUpdate(current: string): Promise<UpdateStatus> {
  const config = await loadConfig()
  const enabled = config.updates?.enabled !== false
  const quiet: UpdateStatus = { current, latest: null, url: null, command: null, enabled }
  if (!enabled) return quiet

  try {
    const release = await latestRelease()
    if (!release || !isNewerVersion(release.version, current)) return quiet
    // Dismissed once, so it is not raised again every launch until there is
    // something newer than the version that was waved away.
    if (config.updates?.skipped && !isNewerVersion(release.version, config.updates.skipped)) return quiet

    return {
      current,
      // Without the tag's v, since it is displayed beside this build's number.
      latest: release.version.replace(/^v/, ''),
      url: release.url,
      command: await upgradeCommand(),
      enabled
    }
  } catch {
    return quiet
  }
}

/** Remember that this version was waved away, so the next launch is quiet. */
export async function skipVersion(version: string): Promise<void> {
  const config = await loadConfig()
  await saveConfig({ ...config, updates: { ...config.updates, skipped: version } })
}

/** Turn the launch-time check on or off. Off means no request is made at all. */
export async function setUpdateChecks(enabled: boolean): Promise<void> {
  const config = await loadConfig()
  await saveConfig({ ...config, updates: { ...config.updates, enabled } })
}
