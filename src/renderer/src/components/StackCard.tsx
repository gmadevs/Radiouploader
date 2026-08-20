import { useEffect, useRef, useState } from 'react'
import type { PreviewFrame, Stack } from '@shared/types'
import { loadFrame, paintFrame } from '../dicomPreview'

interface Props {
  stack: Stack
  onToggle: (id: string, selected: boolean) => void
  onTrim: (id: string, trimStart: number, trimEnd: number) => void
  /** Open the full-size viewer, where text can be blanked and contrast set. */
  onOpen: (stack: Stack) => void
}

/** One stack: a scrubable preview, the trim range, and the include control. */
export function StackCard({ stack, onToggle, onTrim, onOpen }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [frame, setFrame] = useState<PreviewFrame | null>(null)
  // Open on the middle image — the ends of a volume are rarely informative.
  const [index, setIndex] = useState(() => Math.floor(stack.slices.length / 2))
  const [error, setError] = useState<string | null>(null)
  // Trimming is the exception, so the controls stay out of the way until asked for.
  const [showTrim, setShowTrim] = useState(false)

  const last = stack.slices.length - 1
  const kept = stack.trimEnd - stack.trimStart + 1
  const trimmed = kept < stack.slices.length

  useEffect(() => {
    const slice = stack.slices[index]
    if (!slice) return

    let cancelled = false
    loadFrame(slice.path, slice.frame)
      .then((loaded) => {
        if (cancelled) return
        setFrame(loaded)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setFrame(null)
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [stack.slices, index])

  // The card shows the stack as it will be uploaded, masks and window included.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !frame) return
    paintFrame(canvas, frame, { window: stack.window, masks: stack.masks })
  }, [frame, stack.window, stack.masks])

  /** Moving a trim handle jumps the preview there, so the cut is visible. */
  const setStart = (value: number): void => {
    const start = Math.min(value, stack.trimEnd)
    onTrim(stack.id, start, stack.trimEnd)
    setIndex(start)
  }
  const setEnd = (value: number): void => {
    const end = Math.max(value, stack.trimStart)
    onTrim(stack.id, stack.trimStart, end)
    setIndex(end)
  }

  const outsideTrim = index < stack.trimStart || index > stack.trimEnd
  const maskCount = stack.masks?.length ?? 0

  return (
    <div className={stack.selected ? 'stack on' : 'stack'}>
      <div className="stack-preview">
        {error ? (
          <div className="placeholder">
            Preview unavailable
            <br />
            {error}
          </div>
        ) : (
          <canvas ref={canvasRef} className={outsideTrim ? 'dropped' : undefined} />
        )}
        {outsideTrim && <div className="dropped-tag">not uploaded</div>}
        {!error && (
          <button
            className="small open-viewer"
            title="Open for review — blank out burnt-in text and set the contrast"
            onClick={() => onOpen(stack)}
          >
            Open for review
          </button>
        )}
        {stack.slices.length > 1 && (
          <input
            type="range"
            min={0}
            max={last}
            value={index}
            aria-label={`Image of ${stack.label}`}
            onChange={(e) => setIndex(Number(e.target.value))}
          />
        )}
      </div>

      {showTrim && (
        <div className="trim">
          <label>
            <span>First</span>
            <input
              type="range"
              min={0}
              max={last}
              value={stack.trimStart}
              aria-label={`First image of ${stack.label}`}
              onChange={(e) => setStart(Number(e.target.value))}
            />
            <span className="n">{stack.trimStart + 1}</span>
          </label>
          <label>
            <span>Last</span>
            <input
              type="range"
              min={0}
              max={last}
              value={stack.trimEnd}
              aria-label={`Last image of ${stack.label}`}
              onChange={(e) => setEnd(Number(e.target.value))}
            />
            <span className="n">{stack.trimEnd + 1}</span>
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            {trimmed && (
              <button className="small ghost" onClick={() => onTrim(stack.id, 0, last)}>
                Reset
              </button>
            )}
            <button className="small ghost" onClick={() => setShowTrim(false)}>
              Done
            </button>
          </div>
        </div>
      )}

      <div className="stack-meta">
        <input
          type="checkbox"
          id={stack.id}
          checked={stack.selected}
          onChange={(e) => onToggle(stack.id, e.target.checked)}
        />
        <label htmlFor={stack.id}>
          <h3>{stack.label}</h3>
          <div className="muted small">
            {trimmed ? (
              <>
                {kept} of {stack.slices.length} images · {stack.trimStart + 1}–{stack.trimEnd + 1}
              </>
            ) : (
              <>
                {stack.slices.length} image{stack.slices.length === 1 ? '' : 's'}
              </>
            )}
            {maskCount > 0 && <> · {maskCount} blanked</>}
            {stack.window && <> · contrast set</>}
          </div>
        </label>
        {stack.slices.length > 2 && !showTrim && (
          <button
            className={trimmed ? 'small trim-toggle on' : 'small trim-toggle'}
            title="Choose the first and last image to upload"
            onClick={() => setShowTrim(true)}
          >
            Trim
          </button>
        )}
      </div>
    </div>
  )
}
