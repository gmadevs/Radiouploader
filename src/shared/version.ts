/**
 * Comparing two versions of this app, for the check that runs at launch.
 *
 * A release tag is `v1.2.0` and package.json says `1.2.0`, so the `v` is
 * stripped rather than compared; and a prerelease is *older* than the release
 * it leads to, which is the one rule that string comparison gets backwards —
 * `1.3.0-beta.1 > 1.3.0` as text, and offering a beta as an upgrade over the
 * final would be the result.
 */

interface Parsed {
  /** major, minor, patch — missing parts are 0, so `1.3` is `1.3.0`. */
  release: [number, number, number]
  /** The dot-separated identifiers after a `-`; empty for a plain release. */
  pre: string[]
}

export function parseVersion(version: string): Parsed | null {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version.trim())
  if (!match) return null
  return {
    release: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
    pre: match[4] ? match[4].split('.') : []
  }
}

/** Semver's own rule: numeric identifiers compare as numbers, and rank below text. */
function comparePre(a: string[], b: string[]): number {
  // A release outranks any prerelease of the same numbers, and empty means release.
  if (a.length === 0 || b.length === 0) return a.length === 0 ? (b.length === 0 ? 0 : 1) : -1

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i]
    const right = b[i]
    // The shorter run of identifiers is the lower one: 1.0.0-rc < 1.0.0-rc.1.
    if (left === undefined) return -1
    if (right === undefined) return 1
    if (left === right) continue

    const leftNumber = /^\d+$/.test(left)
    const rightNumber = /^\d+$/.test(right)
    if (leftNumber && rightNumber) return Number(left) - Number(right)
    if (leftNumber !== rightNumber) return leftNumber ? -1 : 1
    return left < right ? -1 : 1
  }
  return 0
}

/** Negative when `a` is older, positive when it is newer, 0 when they match. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return 0

  for (let i = 0; i < 3; i++) {
    if (left.release[i] !== right.release[i]) return left.release[i] - right.release[i]
  }
  return comparePre(left.pre, right.pre)
}

/**
 * Is `candidate` a version worth telling the user about?
 *
 * Anything that cannot be parsed answers no. A release published with a tag
 * this does not understand is a reason to say nothing, not a reason to offer an
 * upgrade to a version whose number means nothing here.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  if (parseVersion(candidate) === null || parseVersion(current) === null) return false
  return compareVersions(candidate, current) > 0
}
