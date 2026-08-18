import fs from 'node:fs/promises'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import type { OAuthConfig, TokenSet } from './oauth'

export interface StoredConfig {
  oauth?: OAuthConfig
  tokens?: TokenSet
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

/**
 * Persist credentials, with the tokens encrypted through the OS keychain
 * (Keychain on macOS, libsecret on Linux, DPAPI on Windows). The client secret
 * is treated the same way. If the platform has no secure backend available the
 * tokens are dropped rather than written in the clear — the user re-authorises.
 */
export async function saveConfig(config: StoredConfig): Promise<void> {
  const canEncrypt = safeStorage.isEncryptionAvailable()
  const payload: Record<string, unknown> = {
    oauth: config.oauth ? { ...config.oauth, clientSecret: undefined } : undefined
  }

  if (canEncrypt) {
    const secrets = JSON.stringify({ tokens: config.tokens, clientSecret: config.oauth?.clientSecret })
    payload.secrets = safeStorage.encryptString(secrets).toString('base64')
  }

  await fs.mkdir(path.dirname(configPath()), { recursive: true })
  await fs.writeFile(configPath(), JSON.stringify(payload, null, 2), { mode: 0o600 })
}

export async function loadConfig(): Promise<StoredConfig> {
  let raw: string
  try {
    raw = await fs.readFile(configPath(), 'utf8')
  } catch {
    return {}
  }

  const parsed = JSON.parse(raw) as Record<string, unknown>
  const config: StoredConfig = { oauth: parsed.oauth as OAuthConfig | undefined }

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

export async function clearTokens(): Promise<void> {
  const config = await loadConfig()
  delete config.tokens
  await saveConfig(config)
}
