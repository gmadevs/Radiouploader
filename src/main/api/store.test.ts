import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'store-test-'))
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  // No keychain: only the plain part of the file is written, which is all
  // these tests look at.
  safeStorage: { isEncryptionAvailable: () => false }
}))

const { loadConfig, updateConfig } = await import('./store')
const file = path.join(userData, 'config.json')

beforeEach(async () => {
  await fs.rm(userData, { recursive: true, force: true })
  await fs.mkdir(userData, { recursive: true })
})
afterAll(async () => {
  await fs.rm(userData, { recursive: true, force: true })
})

describe('store', () => {
  it('keeps every change when several are made at once', async () => {
    await Promise.all([
      updateConfig((c) => ({ ...c, oauth: { clientId: 'app', redirectUri: 'urn:ietf:wg:oauth:2.0:oob' } })),
      updateConfig((c) => ({ ...c, updates: { ...c.updates, skipped: '1.5.0' } })),
      updateConfig((c) => ({ ...c, updates: { ...c.updates, enabled: false } }))
    ])

    const config = await loadConfig()
    expect(config.oauth?.clientId).toBe('app')
    expect(config.updates).toEqual({ skipped: '1.5.0', enabled: false })
  })

  it('carries on after a change that failed', async () => {
    await expect(
      updateConfig(() => {
        throw new Error('broken change')
      })
    ).rejects.toThrow('broken change')
    await updateConfig((c) => ({ ...c, updates: { enabled: true } }))
    expect((await loadConfig()).updates).toEqual({ enabled: true })
  })

  it('starts afresh from a config it cannot read, and sets the old one aside', async () => {
    await fs.writeFile(file, '{"oauth": {"clientId": "app"')

    expect(await loadConfig()).toEqual({})
    expect(await fs.readFile(`${file}.unreadable`, 'utf8')).toContain('clientId')

    await updateConfig((c) => ({ ...c, updates: { enabled: true } }))
    expect((await loadConfig()).updates).toEqual({ enabled: true })
  })

  it('leaves no partial file behind', async () => {
    await updateConfig((c) => ({ ...c, updates: { enabled: true } }))
    expect(await fs.readdir(userData)).toEqual(['config.json'])
  })
})
