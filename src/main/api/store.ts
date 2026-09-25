import fs from 'node:fs/promises'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import type { InterruptedUpload } from '../interruptedUpload'
import type { OAuthConfig, TokenSet } from './oauth'

export interface StoredConfig {
  oauth?: OAuthConfig
  tokens?: TokenSet
  /**
   * The launch-time update check: whether it runs, and the version that was
   * waved away so it is not offered again. Neither is a secret, so both sit in
   * the plain part of the file — a config the user cannot read is one they
   * cannot check the app against.
   */
  updates?: { enabled?: boolean; skipped?: string }
  /** An upload that stopped partway, to carry on after a restart. No patient identifiers. */
  interruptedUpload?: InterruptedUpload
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

/**
 * Persist credentials, with the tokens encrypted through the OS keychain
 * (Keychain on macOS, libsecret on Linux, DPAPI on Windows). The client secret
 * is treated the same way. If the platform has no secure backend available the
 * tokens are dropped rather than written in the clear — the user re-authorises.
 *
 * Written beside the file and renamed over it, so a crash mid-write leaves the
 * old config rather than half of a new one.
 */
async function saveConfig(config: StoredConfig): Promise<void> {
  const canEncrypt = safeStorage.isEncryptionAvailable()
  const payload: Record<string, unknown> = {
    oauth: config.oauth ? { ...config.oauth, clientSecret: undefined } : undefined,
    updates: config.updates,
    interruptedUpload: config.interruptedUpload
  }

  if (canEncrypt) {
    const secrets = JSON.stringify({ tokens: config.tokens, clientSecret: config.oauth?.clientSecret })
    payload.secrets = safeStorage.encryptString(secrets).toString('base64')
  }

  const target = configPath()
  const partial = `${target}.writing`
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(partial, JSON.stringify(payload, null, 2), { mode: 0o600 })
  await fs.rename(partial, target)
}

let writes: Promise<unknown> = Promise.resolve()

/**
 * Change the stored config, one change at a time.
 *
 * Every writer reads the file, changes its own part and writes the whole of it
 * back, and the refreshed token, the skipped version and the credentials form
 * can all be doing that at once. Two interleaved read-then-writes lose
 * whichever wrote first — a refreshed token, say, that the server has already
 * rotated the old one out for — so they queue.
 */
export function updateConfig(change: (config: StoredConfig) => StoredConfig): Promise<void> {
  const next = writes.then(async () => saveConfig(change(await loadConfig())))
  // A failed write must not wedge the ones behind it.
  writes = next.catch(() => {})
  return next
}

export async function loadConfig(): Promise<StoredConfig> {
  let raw: string
  try {
    raw = await fs.readFile(configPath(), 'utf8')
  } catch {
    return {}
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    // An unreadable config used to fail every sign-in for good. Set aside, not
    // deleted, since it is the only copy of whatever was in it; the next save
    // starts a fresh one and the user enters the credentials again.
    await fs.rename(configPath(), `${configPath()}.unreadable`).catch(() => {})
    return {}
  }
  if (parsed === null || typeof parsed !== 'object') return {}
  const config: StoredConfig = {
    oauth: parsed.oauth as OAuthConfig | undefined,
    updates: parsed.updates as StoredConfig['updates'],
    interruptedUpload: parsed.interruptedUpload as InterruptedUpload | undefined
  }

  if (typeof parsed.secrets === 'string' && safeStorage.isEncryptionAvailable()) {
    try {
      const secrets = JSON.parse(safeStorage.decryptString(Buffer.from(parsed.secrets, 'base64'))) as {
        tokens?: TokenSet
        clientSecret?: string
      }
      config.tokens = secrets.tokens
      if (config.oauth && secrets.clientSecret) config.oauth.clientSecret = secrets.clientSecret
    } catch {
      // A keychain the user declined, or a different machine — force re-auth.
    }
  }
  return config
}
