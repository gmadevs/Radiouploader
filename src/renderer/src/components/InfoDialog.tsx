import type { AppInfo } from '@shared/types'
import { APP_NAME, APP_TAGLINE, ISSUES_URL, supportMailto } from '../about'

interface Props {
  info: AppInfo | null
  onClose: () => void
}

/** What each step of the wizard is for, in the order they happen. */
const STEPS: { title: string; body: string }[] = [
  {
    title: 'Sign in first',
    body:
      'Radiopaedia limits how many draft cases an account may hold, so the app checks the quota before you import anything rather than after the work is done.'
  },
  {
    title: 'Drop a study in',
    body:
      'A folder, a zip, or a handful of files. Everything is read on this computer; nothing is sent anywhere until you press Upload.'
  },
  {
    title: 'Choose what to upload',
    body:
      'Series that hold more than one acquisition — phases, b-values, echoes, magnitude and phase maps — are split apart so each can be picked separately. Trim drops the dead slices at either end.'
  },
  {
    title: 'Open for review',
    body:
      'Opens a series full size. Erase drags a black box over burnt-in text — a patient banner, an annotation — and it is painted into the pixels of every image in that series before upload. Contrast sets the window the images are read at. Anonymisation cleans the tags; the pixels are your job.'
  },
  {
    title: 'Case details, then upload',
    body:
      'One study per DICOM study, oldest first, with the interval between them preserved in the caption. The case arrives on Radiopaedia as a draft, so nothing is published until you say so there.'
  }
]

/** Version, a short tutorial, and where to report what went wrong. */
export function InfoDialog({ info, onClose }: Props): React.JSX.Element {
  return (
    <div className="viewer-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="info" role="dialog" aria-label={`About ${APP_NAME}`}>
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
            <strong>Check the images before you upload.</strong> The anonymiser works on DICOM tags. Text burnt into
            the pixels is invisible to it — blank it yourself with Open for review.
          </div>

          <h3 style={{ marginTop: 4 }}>Something went wrong?</h3>
          <p className="muted small" style={{ margin: 0 }}>
            Report it with the version below and, if you can, what the study was: modality, how it was exported, and
            whether the images previewed.
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
          {info ? (
            <>
              Version {info.version} · {info.os} · {info.arch} · Electron {info.electron}
            </>
          ) : (
            'Reading version…'
          )}
          <span className="spacer" />
          <span>AGPL-3.0-only · not affiliated with Radiopaedia.org</span>
        </footer>
      </div>
    </div>
  )
}
