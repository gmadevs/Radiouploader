import { useState } from 'react'

interface Props {
  onPick: (kind: 'folder' | 'zip') => void
  onDropPath: (path: string) => void
  busy: boolean
}

export function SourceStep({ onPick, onDropPath, busy }: Props): React.JSX.Element {
  const [over, setOver] = useState(false)

  return (
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
        const file = e.dataTransfer.files[0]
        // Electron exposes the real filesystem path on dropped files.
        const path = (file as File & { path?: string })?.path
        if (path) onDropPath(path)
      }}
    >
      <div>
        <h1>Add a study</h1>
        <p className="muted" style={{ margin: 0 }}>
          Drop a folder or a zip of DICOM files here. Nothing leaves this computer until you upload.
        </p>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="primary" disabled={busy} onClick={() => onPick('folder')}>
          Choose folder
        </button>
        <button disabled={busy} onClick={() => onPick('zip')}>
          Choose zip
        </button>
      </div>
    </div>
  )
}
