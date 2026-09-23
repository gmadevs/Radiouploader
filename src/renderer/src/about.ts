import type { AppInfo } from '@shared/types'

/** Who this app says it is. Kept in one place so the strings cannot drift. */

export const APP_NAME = 'Radiouploader'

/** Radiopaedia is not involved in this app, and the home screen says so. */
export const APP_TAGLINE = 'Unofficial case uploader for radiopaedia.org'

export const ISSUES_URL = 'https://github.com/gmadevs/Radiouploader/issues'

/** Where a new version comes from, since the app downloads nothing itself. */
export const RELEASES_URL = 'https://github.com/gmadevs/Radiouploader/releases'

/** Plus-addressed, so mail about the app sorts itself into its own label. */
export const SUPPORT_EMAIL = 'gmadeveloping+radiouploader@gmail.com'

/**
 * A mailto with the build already quoted. Half of any bug report is knowing
 * which version it came from, and nobody types that from memory.
 */
/**
 * The build in one line, as the About panel shows it and a report quotes it.
 * The video decoder is named, or its absence is: "no video decoder" is the
 * whole explanation of a clip that would not open.
 */
export function buildLine(info: AppInfo): string {
  const decoder = info.videoDecoder ?? 'no video decoder'
  return `${info.version} · ${info.os} · ${info.arch} · Electron ${info.electron} · ${decoder}`
}

export function supportMailto(info: AppInfo | null): string {
  const subject = `${APP_NAME} ${info?.version ?? ''} — problem report`.trim()
  const body = [
    'What happened:',
    '',
    'What I expected:',
    '',
    'The study: modality, how it was exported, whether the images previewed.',
    '',
    '---',
    info ? `${APP_NAME} ${buildLine(info)}` : APP_NAME
  ].join('\n')
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
