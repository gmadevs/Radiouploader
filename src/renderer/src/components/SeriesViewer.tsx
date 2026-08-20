import { useEffect, useMemo, useRef, useState } from 'react'
import type { MaskRect, PreviewFrame, Stack, WindowLevel } from '@shared/types'
import { loadFrame, paintFrame } from '../dicomPreview'

interface Props {
  stack: Stack
  /** Series and study the stack came from, so the header says what is open. */
  heading: string
  onChange: (patch: { masks?: MaskRect[]; window?: WindowLevel | null }) => void
  onClose: () => void
}

type Tool = 'contrast' | 'erase'

/** As large as the main process will decode; asking for more is pointless. */
const VIEWER_EDGE = 1024

/** Below this a drag is a mis-click rather than a rectangle. */
const MIN_MASK_SIDE = 0.004

function clampUnit(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

function rectBetween(a: { x: number; y: number }, b: { x: number; y: number }): MaskRect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

/** Round for display: a window of 40.0001 helps nobody. */
const show = (value: number): string => String(Math.round(value * 10) / 10)

/**
 * One stack at full size, with the two things that cannot be fixed later:
 * blanking burnt-in text, and choosing the window the images are read at.
 *
 * Both are properties of the stack rather than of the image on screen. Text is
 * burnt into the same corner of every frame of an ultrasound or a reconstructed
 * series, and a window that suits one slice suits the rest — so a mask drawn
 * here applies to the whole stack, and the scrubber is for checking that it
 * really does cover the text everywhere.
 */
export function SeriesViewer({ stack, heading, onChange, onClose }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null)
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(Math.floor(stack.slices.length / 2), stack.trimStart), stack.trimEnd)
  )
  const [frame, setFrame] = useState<PreviewFrame | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('erase')
  /** The rectangle being dragged out, drawn but not yet part of the stack. */
  const [pending, setPending] = useState<MaskRect | null>(null)

  const masks = stack.masks ?? []
  const greyscale = frame?.kind === 'grey'
  // The stack's window if one was chosen, otherwise whatever the file asks for.
  const level: WindowLevel | null = stack.window ?? (frame?.kind === 'grey' ? frame.window : null)

  useEffect(() => {
    const slice = stack.slices[index]
    if (!slice) return

    let cancelled = false
    loadFrame(slice.path, slice.frame, VIEWER_EDGE)
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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !frame) return
    paintFrame(canvas, frame, { window: level, masks: pending ? [...masks, pending] : masks })
  }, [frame, level, masks, pending])

  // The canvas is sized to the image's own aspect ratio inside the stage, so a
  // 512-pixel scan fills the window and a pointer position maps straight onto
  // the image — a letterboxed element box would put every mask in the wrong place.
  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) =>
      setStage({ width: entry.contentRect.width, height: entry.contentRect.height })
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const fitted = useMemo(() => {
    if (!frame || !stage || stage.width === 0 || stage.height === 0) return undefined
    const scale = Math.min(stage.width / frame.width, stage.height / frame.height)
    return { width: `${frame.width * scale}px`, height: `${frame.height * scale}px` }
  }, [frame, stage])

  /** The range of the data, which is what the window sliders have to cover. */
  const bounds = useMemo(() => {
    if (frame?.kind !== 'grey') return null
    let min = Infinity
    let max = -Infinity
    for (const value of frame.values) {
      if (value < min) min = value
      if (value > max) max = value
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return { min: 0, max: 255 }
    return { min, max }
  }, [frame])

  const setLevel = (next: Partial<WindowLevel>): void => {
    if (!level) return
    onChange({ window: { centre: next.centre ?? level.centre, width: Math.max(next.width ?? level.width, 1) } })
  }

  /** Pointer position as a fraction of the image, whatever it is scaled to. */
  const pointAt = (event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: clampUnit((event.clientX - rect.left) / rect.width),
      y: clampUnit((event.clientY - rect.top) / rect.height)
    }
  }

  const drag = useRef<{ tool: Tool; from: { x: number; y: number }; level: WindowLevel | null } | null>(null)

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!frame) return
    if (tool === 'contrast' && !greyscale) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const from = pointAt(event)
    drag.current = { tool, from, level }
    if (tool === 'erase') setPending({ ...from, width: 0, height: 0 })
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const active = drag.current
    if (!active) return
    const to = pointAt(event)

    if (active.tool === 'erase') {
      setPending(rectBetween(active.from, to))
      return
    }
    // Drag right to widen the window, down to raise its centre — the same
    // directions every DICOM viewer uses. Steps are relative to the window in
    // force at mouse-down, so a narrow window stays finely adjustable.
    const step = Math.max(active.level?.width ?? 1, 1) / 300
    const rect = event.currentTarget.getBoundingClientRect()
    setLevel({
      centre: (active.level?.centre ?? 0) + (to.y - active.from.y) * rect.height * step,
      width: Math.max((active.level?.width ?? 1) + (to.x - active.from.x) * rect.width * step, 1)
    })
  }

  const endDrag = (): void => {
    const active = drag.current
    drag.current = null
    if (active?.tool !== 'erase') return

    setPending((rect) => {
      if (rect && rect.width >= MIN_MASK_SIDE && rect.height >= MIN_MASK_SIDE) {
        onChange({ masks: [...masks, rect] })
      }
      return null
    })
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0))
      else if (event.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, stack.slices.length - 1))
      else return
      event.preventDefault()
    }
    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [onClose, stack.slices.length])

  const outsideTrim = index < stack.trimStart || index > stack.trimEnd

  return (
    <div className="viewer-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="viewer" role="dialog" aria-label={`${heading} — ${stack.label}`}>
        <header className="viewer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{stack.label}</h2>
            <div className="muted small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {heading}
            </div>
          </div>
          <div className="tools">
            <button
              className={tool === 'erase' ? 'small on' : 'small'}
              onClick={() => setTool('erase')}
              title="Drag over burnt-in text to blank it out on every image of this series"
            >
              Erase
            </button>
            <button
              className={tool === 'contrast' ? 'small on' : 'small'}
              onClick={() => setTool('contrast')}
              disabled={!greyscale}
              title={
                greyscale
                  ? 'Drag to set the window: sideways for width, up and down for centre'
                  : 'Colour images carry no window to adjust'
              }
            >
              Contrast
            </button>
          </div>
          <button onClick={onClose}>Done</button>
        </header>

        <div className={tool === 'erase' ? 'viewer-stage erasing' : 'viewer-stage'} ref={stageRef}>
          {error ? (
            <div className="placeholder">
              Preview unavailable
              <br />
              {error}
              <br />
              <span className="muted small">
                Neither erasing nor contrast can be applied to an image that cannot be decoded.
              </span>
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              style={fitted}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            />
          )}
          {outsideTrim && <div className="dropped-tag">not uploaded</div>}
        </div>

        <div className="viewer-controls">
          <label className="viewer-slider">
            <span>Image</span>
            <input
              type="range"
              min={0}
              max={stack.slices.length - 1}
              value={index}
              disabled={stack.slices.length < 2}
              aria-label="Image"
              onChange={(e) => setIndex(Number(e.target.value))}
            />
            <span className="n">
              {index + 1}/{stack.slices.length}
            </span>
          </label>

          {greyscale && level && bounds && (
            <>
              <label className="viewer-slider">
                <span>Level</span>
                <input
                  type="range"
                  min={bounds.min}
                  max={bounds.max}
                  step={Math.max((bounds.max - bounds.min) / 500, 0.01)}
                  value={level.centre}
                  aria-label="Window centre"
                  onChange={(e) => setLevel({ centre: Number(e.target.value) })}
                />
                <span className="n">{show(level.centre)}</span>
              </label>
              <label className="viewer-slider">
                <span>Window</span>
                <input
                  type="range"
                  min={1}
                  max={Math.max((bounds.max - bounds.min) * 2, 2)}
                  step={Math.max((bounds.max - bounds.min) / 500, 0.01)}
                  value={level.width}
                  aria-label="Window width"
                  onChange={(e) => setLevel({ width: Number(e.target.value) })}
                />
                <span className="n">{show(level.width)}</span>
              </label>
            </>
          )}

          <div className="viewer-actions">
            <span className="muted small">
              {masks.length === 0
                ? 'Drag over any burnt-in text to blank it on every image'
                : `${masks.length} area${masks.length === 1 ? '' : 's'} blanked on every image`}
            </span>
            <div className="spacer" />
            {masks.length > 0 && (
              <>
                <button className="small ghost" onClick={() => onChange({ masks: masks.slice(0, -1) })}>
                  Undo box
                </button>
                <button className="small ghost" onClick={() => onChange({ masks: [] })}>
                  Clear boxes
                </button>
              </>
            )}
            {stack.window && (
              <button className="small ghost" onClick={() => onChange({ window: null })}>
                Reset contrast
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
