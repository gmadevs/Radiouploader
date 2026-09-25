import { useEffect, useRef } from 'react'
import type { AppInfo, UpdateStatus } from '@shared/types'
import { APP_NAME, APP_TAGLINE, ISSUES_URL, RELEASES_URL, buildLine, supportMailto } from '../about'
import { useFocusTrap } from '../focusTrap'
import { UpdateNotice } from './UpdateNotice'

interface Props {
  info: AppInfo | null
  /** What the launch-time check found, or null while it has not answered. */
  update: UpdateStatus | null
  onSetUpdateChecks: (enabled: boolean) => void
  onClose: () => void
}

/** What each step of the wizard is for, in the order they happen. */
const STEPS: { title: string; body: string }[] = [
  {
    title: 'Sign in',
    body: 'Sign in to Radiopaedia before importing a study. The header shows how many of your draft cases are in use.'
  },
  {
    title: 'Add a study',
    body:
      'Drop a folder, a zip file or a set of DICOM files. The app reads them on this computer, and your images are not sent anywhere until you upload them.'
  },
  {
    title: 'Choose what to upload',
    body:
      'Series that contain several acquisitions (phases, b-values, echoes, magnitude and phase images) are split into separate stacks, which you can select separately. Trim removes images at either end of a stack.'
  },
  {
    title: 'Open for review',
    body:
      'Opens a stack in the viewer. Erase blanks burnt-in text, such as a patient banner, on every image of the stack, and the blank area is written into the pixels before upload. Crop removes margins. Contrast sets the window; for CT there are presets such as Brain, Lung and Bone. The anonymiser removes identifying tags, not text in the images, so check the images yourself.'
  },
  {
    title: 'Check before anonymising',
    body:
      'Anonymise and continue first shows a check: areas that look like burnt-in text, and the selected stacks you have not opened in the viewer. It finds large banners and can miss small or faint text, so it never reports a stack as free of text.'
  },
  {
    title: 'Case details and upload',
    body:
      'Each DICOM study becomes a study in the case, oldest first, with the interval between them in its caption. The case is uploaded as a draft and is not published until you publish it on Radiopaedia.'
  }
]

/** Version, a short tutorial, and where to report what went wrong. */
export function InfoDialog({ info, update, onSetUpdateChecks, onClose }: Props): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef)

  // The other three close on Escape, and a dialog that does not is one people
  // press it at twice before reaching for the mouse.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="viewer-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="info"
        role="dialog"
        aria-modal="true"
        aria-label={`About ${APP_NAME}`}
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="viewer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{APP_NAME}</h2>
            <div className="muted small">{APP_TAGLINE}</div>
          </div>
          <button onClick={onClose}>Close</button>
        </header>

        <div className="info-body">
          <ol className="tutorial">
            {STEPS.map((step) => (
              <li key={step.title}>
                <h3>{step.title}</h3>
                <p className="muted small">{step.body}</p>
              </li>
            ))}
          </ol>

          <div className="notice warn">
            <strong>Check the images before you upload.</strong> The anonymiser removes identifying DICOM tags. It does
            not remove text burnt into the images; erase that in Open for review.
          </div>

          <h3 style={{ marginTop: 4 }}>Updates</h3>
          {update?.latest ? (
            <UpdateNotice update={update} />
          ) : (
            <p className="muted small" style={{ margin: 0 }}>
              {/* Not "you are up to date": a check that could not reach GitHub
                  answers exactly as one that found nothing, and this app does
                  not dress a silence up as a result. */}
              {update?.enabled === false
                ? 'The update check at launch is off.'
                : 'No newer version was found when the app started.'}{' '}
              <a href={RELEASES_URL} target="_blank" rel="noreferrer">
                Releases on GitHub
              </a>
            </p>
          )}
          <label className="setting">
            <input
              type="checkbox"
              checked={update?.enabled !== false}
              onChange={(e) => onSetUpdateChecks(e.target.checked)}
            />
            <span>
              Look for a newer version at launch
              <span className="muted small" style={{ display: 'block' }}>
                Asks GitHub for the latest release number. No information about you, your account or your studies is
                sent, and nothing is downloaded or installed.
              </span>
            </span>
          </label>

          <h3 style={{ marginTop: 4 }}>Reporting a problem</h3>
          <p className="muted small" style={{ margin: 0 }}>
            Include the version shown below and, if you can, the modality, how the study was exported and whether the
            images appeared in the preview. Never attach patient images.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {/* target=_blank so both go through the window-open handler, which
                hands them to the desktop's browser and mail client. */}
            <a href={ISSUES_URL} target="_blank" rel="noreferrer">
              <button>Open an issue on GitHub</button>
            </a>
            <a href={supportMailto(info)} target="_blank" rel="noreferrer">
              <button>Send an email</button>
            </a>
          </div>
        </div>

        <footer className="info-foot muted small">
          {info ? `Version ${buildLine(info)}` : 'Reading version…'}
          <span className="spacer" />
          <span>AGPL-3.0-only · not affiliated with Radiopaedia.org</span>
        </footer>
      </div>
    </div>
  )
}
