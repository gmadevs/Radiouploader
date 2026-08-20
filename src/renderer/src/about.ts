/** Who this app says it is. Kept in one place so the strings cannot drift. */

export const APP_NAME = 'Radiouploader'

/** Radiopaedia is not involved in this app, and the home screen says so. */
export const APP_TAGLINE = 'Unofficial case uploader for radiopaedia.org'

export const ISSUES_URL = 'https://github.com/gmadevs/Radiouploader/issues'

/** Plus-addressed, so mail about the app sorts itself into its own label. */
export const SUPPORT_EMAIL = 'gmadeveloping+radiouploader@gmail.com'

/**
 * A mailto with the build already quoted. Half of any bug report is knowing
 * which version it came from, and nobody types that from memory.
 */
export function supportMailto(info: { version: string; os: string; arch: string; electron: string } | null): string {
  const subject = `${APP_NAME} ${info?.version ?? ''} — problem report`.trim()
  const body = [
    'What happened:',
    '',
    'What I expected:',
    '',
    'The study: modality, how it was exported, whether the images previewed.',
    '',
    '---',
    info ? `${APP_NAME} ${info.version} · ${info.os} · ${info.arch} · Electron ${info.electron}` : APP_NAME
  ].join('\n')
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
