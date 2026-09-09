import { describe, expect, it } from 'vitest'
import { compareVersions, isNewerVersion, parseVersion } from './version'

describe('parseVersion', () => {
  it('takes the v off a release tag', () => {
    expect(parseVersion('v1.2.0')?.release).toEqual([1, 2, 0])
  })

  it('fills in the parts a short version leaves out', () => {
    expect(parseVersion('2.1')?.release).toEqual([2, 1, 0])
  })

  it('refuses anything that is not a version', () => {
    expect(parseVersion('nightly')).toBeNull()
    expect(parseVersion('')).toBeNull()
  })
})

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('1.3.0', '1.2.9')).toBeGreaterThan(0)
    expect(compareVersions('2.0.0', '10.0.0')).toBeLessThan(0)
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0)
  })

  it('compares numbers as numbers, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
  })
})

describe('isNewerVersion', () => {
  it('offers a later release', () => {
    expect(isNewerVersion('1.3.0', '1.2.0')).toBe(true)
  })

  it('does not offer the version already running', () => {
    expect(isNewerVersion('1.2.0', '1.2.0')).toBe(false)
  })

  it('does not offer an older release', () => {
    expect(isNewerVersion('v1.1.0', '1.2.0')).toBe(false)
  })

  // A beta leads to the release, so it is not an upgrade over it — the text
  // comparison says the opposite, which is the reason this is here at all.
  it('does not offer a prerelease of the version already running', () => {
    expect(isNewerVersion('1.3.0-beta.1', '1.3.0')).toBe(false)
    expect(isNewerVersion('1.3.0', '1.3.0-beta.1')).toBe(true)
  })

  it('orders one prerelease against another', () => {
    expect(isNewerVersion('1.3.0-beta.2', '1.3.0-beta.1')).toBe(true)
    expect(isNewerVersion('1.3.0-rc.1', '1.3.0-beta.9')).toBe(true)
  })

  // A tag nobody here can read is a reason to stay quiet, not to offer it.
  it('says nothing about a tag it cannot parse', () => {
    expect(isNewerVersion('nightly', '1.2.0')).toBe(false)
    expect(isNewerVersion('1.3.0', 'unknown')).toBe(false)
  })
})
