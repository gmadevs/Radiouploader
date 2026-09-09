import { useState } from 'react'
import type { UpdateStatus } from '@shared/types'

interface Props {
  update: UpdateStatus
  /**
   * Stop offering this version; a later one is still offered. Left out where
   * there is nothing to send the notice away from — in the Info dialog it is
   * the answer to a question that was just asked.
   */
  onDismiss?: () => void
}

/**
 * A newer release exists, and here is how to get it.
 *
 * Nothing is downloaded here: the app is unsigned, so it has no business
 * fetching and running an installer on its own — the user goes and gets it, the
 * same way they installed it. Where Homebrew did the install there is a command
 * to paste, and it carries the quarantine step with it, because an upgraded
 * unsigned app that keeps macOS's quarantine flag is one that will not open.
 *
 * It sits on the home screen and nowhere else. Between an import and an upload
 * the version running is the version that anonymised the images, and stopping
 * to upgrade in the middle of that is worse than finishing first.
 */
export function UpdateNotice({ update, onDismiss }: Props): React.JSX.Element | null {
  const [copied, setCopied] = useState(false)
  if (!update.latest) return null

  const copy = (command: string): void => {
    void window.api.copyText(command).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  return (
    <div className="notice update">
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>Version {update.latest} is available.</strong>{' '}
        <span className="muted">You are running {update.current}.</span>
        {update.command && (
          <div className="command" title="Homebrew installed this copy, so this is what upgrades it">
            <code>{update.command}</code>
          </div>
        )}
      </div>
      <div className="update-actions">
        {update.command && (
          <button className="small" onClick={() => copy(update.command!)}>
            {copied ? 'Copied' : 'Copy command'}
          </button>
        )}
        {update.url && (
          <a href={update.url} target="_blank" rel="noreferrer">
            <button className="small">{update.command ? 'Release notes' : 'Download'}</button>
          </a>
        )}
        {onDismiss && (
          <button className="small ghost" title="Stop offering this version" onClick={onDismiss}>
            Not now
          </button>
        )}
      </div>
    </div>
  )
}
