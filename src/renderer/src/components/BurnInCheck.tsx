import { useEffect, useRef, useState } from 'react'
import type { StackEntry } from '../burnIn'
import { loadFrame, paintFrame, previewErrorText } from '../dicomPreview'

interface Props {
  /** Stacks already opened full size; counted, not listed. */
  seenCount: number
  /** Stacks going to upload that have never been on screen full size. */
  unseen: StackEntry[]
  busy: boolean
  /** Open one from the list; the dialog stays behind the viewer. */
  onOpen: (entry: StackEntry) => void
  onBack: () => void
  onConfirm: () => void
}

/** A middle image of one stack, as it will be uploaded — masks and window included. */
function Thumb({ entry }: { entry: StackEntry }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)
  const { stack } = entry

  useEffect(() => {
    // The middle image, for the same reason the stack card opens there: the
    // ends of a volume are rarely where the banner is legible.
    const slice = stack.slices[Math.floor(stack.slices.length / 2)]
    if (!slice) return

    let cancelled = false
    loadFrame(slice.path, slice.frame, 256)
      .then((frame) => {
        if (cancelled || !canvasRef.current) return
        paintFrame(canvasRef.current, frame, { window: stack.window, masks: stack.masks })
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(previewErrorText(err))
      })
    return () => {
      cancelled = true
    }
  }, [stack.slices, stack.window, stack.masks])

  return (
    <div className="shot">
      {error ? (
        // Nothing can be checked or erased here inside the app, so say so
        // rather than showing an empty square.
        <div className="placeholder">
          Cannot be shown
          <br />
          {error}
        </div>
      ) : (
        <canvas ref={canvasRef} />
      )}
    </div>
  )
}

/**
 * The last stop before anonymisation, which is where a mask stops being an
 * overlay and becomes pixels.
 *
 * Deliberately not a plain "have you checked?" tick box: one of those becomes a
 * reflex by the third import. It lists the selected stacks that have never been
 * opened full size, with a thumbnail each, so the answer costs a look rather
 * than a click — and it never reports the rest as clean, because opening a
 * stack is not the same as having read every frame of it.
 */
export function BurnInCheck({ seenCount, unseen, busy, onOpen, onBack, onConfirm }: Props): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  const total = seenCount + unseen.length

  return (
    <div className="viewer-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onBack()}>
      <div className="info" role="dialog" aria-label="Check for burnt-in text">
        <header className="viewer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>Before anonymising</h2>
            <div className="muted small">
              {total} series · {selectionSummary(seenCount, unseen.length)}
            </div>
          </div>
        </header>

        <div className="info-body">
          <div className="notice warn">
            <strong>Anonymisation does not touch the pixels.</strong> Names, dates and hospital banners burnt into the
            images upload exactly as they are. Only what you blank with <strong>Open for review</strong> is removed.
          </div>

          {unseen.length > 0 ? (
            <>
              <p className="muted small" style={{ margin: 0 }}>
                {unseen.length === 1
                  ? 'One selected series has not been opened full size yet:'
                  : `${unseen.length} selected series have not been opened full size yet:`}{' '}
                open anything that could carry text — ultrasound, screen captures, reconstructions.
              </p>
              <div className="check-grid">
                {unseen.map((entry) => (
                  <button
                    key={entry.stack.id}
                    className="check-item"
                    title="Open for review — blank out burnt-in text and set the contrast"
                    onClick={() => onOpen(entry)}
                  >
                    <Thumb entry={entry} />
                    <span className="cap">
                      <span className="name">{entry.label}</span>
                      {entry.modality ?? '—'} · {entry.stack.slices.length} image
                      {entry.stack.slices.length === 1 ? '' : 's'}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>
              Every selected series has been opened full size. That is not the same as having read every image in
              them — go back if any of these carry text you have not looked for.
            </p>
          )}
        </div>

        <footer className="info-foot">
          <button onClick={onBack} disabled={busy}>
            Back to the series
          </button>
          <span className="spacer" />
          <button className="primary" onClick={onConfirm} disabled={busy}>
            I have checked — anonymise
          </button>
        </footer>
      </div>
    </div>
  )
}

function selectionSummary(seen: number, unseen: number): string {
  if (unseen === 0) return 'all opened for review'
  if (seen === 0) return 'none opened for review yet'
  return `${unseen} not opened for review`
}
