import { useState } from 'react'
import type { AppInfo } from '@shared/types'
import { APP_NAME, APP_TAGLINE } from '../about'

interface Props {
  onPick: (kind: 'folder' | 'zip') => void
  onDropPaths: (paths: string[]) => void
  busy: boolean
  /** Set when the account is not ready to receive a case; importing is blocked. */
  blocked: { reason: string } | null
  /** Null until the main process answers; the heading renders without it. */
  info: AppInfo | null
}

export function SourceStep({ onPick, onDropPaths, busy, blocked, info }: Props): React.JSX.Element {
  const [over, setOver] = useState(false)

  return (
    <div className="home">
      <div className="home-title">
        <h1>{APP_NAME}</h1>
        <p className="muted">{APP_TAGLINE}</p>
        {/* Version and platform, so a bug report can quote them. The blank keeps
            the layout still while the main process answers. */}
        <p className="muted small">{info ? `Version ${info.version} · ${info.os} · ${info.arch}` : ' '}</p>
      </div>

      <div
        className={over ? 'drop over' : 'drop'}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          if (blocked) return
          // Electron 32 removed File.path; the preload resolves the real path.
          const paths = [...e.dataTransfer.files]
            .map((file) => window.api.getPathForFile(file))
            .filter((path) => path !== '')
          if (paths.length > 0) onDropPaths(paths)
        }}
      >
        <div>
          <h2>Add a study</h2>
          <p className="muted" style={{ margin: 0 }}>
            Drop a folder or a zip of DICOM files here. Nothing leaves this computer until you upload.
          </p>
        </div>
        {blocked && <div className="notice error">{blocked.reason}</div>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="primary" disabled={busy || blocked !== null} onClick={() => onPick('folder')}>
            Choose folder
          </button>
          <button disabled={busy || blocked !== null} onClick={() => onPick('zip')}>
            Choose zip
          </button>
        </div>
      </div>
    </div>
  )
}
