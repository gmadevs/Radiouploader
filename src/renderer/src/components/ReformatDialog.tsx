import { useEffect, useMemo, useRef, useState } from 'react'
import type { Plane, PreviewFrame, Projection, ReformatPlan, Series, Stack, VolumeInfo } from '@shared/types'
import { paintFrame, previewErrorText } from '../dicomPreview'
import { useWheelScrub } from '../wheelScrub'

interface Props {
  stack: Stack
  /** Study and series, so the dialog says what is being cut up. */
  heading: string
  onAdded: (studyId: string, series: Series) => void
  onClose: () => void
}

const PLANES: { id: Plane; label: string }[] = [
  { id: 'axial', label: 'Axial' },
  { id: 'coronal', label: 'Coronal' },
  { id: 'sagittal', label: 'Sagittal' }
]

const PROJECTIONS: { id: Projection; label: string; title: string }[] = [
  { id: 'slice', label: 'Slice', title: 'One plane through the volume' },
  { id: 'mip', label: 'MIP', title: 'The brightest sample through the slab: vessels, contrast, bone' },
  { id: 'minip', label: 'MinIP', title: 'The darkest sample through the slab: airways, emphysema, fat' },
  { id: 'mean', label: 'Mean', title: 'The average through the slab: quieter noise, softer detail' }
]

/** Round to something a slider can land on and a person can read. */
const step = (value: number): number => Math.round(value * 10) / 10

/**
 * Cutting a stack another way, and flattening slabs of it.
 *
 * The volume this works on stays in the main process — a chest CT is hundreds
 * of megabytes — so everything here is a request for one preview-sized image at
 * a time, exactly like the viewer's.
 *
 * The planes are the acquisition's own, not the patient's: on an axial study
 * coronal and sagittal mean what they say, and on an oblique one they mean
 * "across the acquisition". Which is the reason this shows the result before
 * anything can be added to a case.
 */
export function ReformatDialog({ stack, heading, onAdded, onClose }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [info, setInfo] = useState<VolumeInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [frame, setFrame] = useState<PreviewFrame | null>(null)
  const [count, setCount] = useState(0)
  const [plan, setPlan] = useState<ReformatPlan>({
    plane: 'coronal',
    projection: 'slice',
    thickness: 5,
    spacing: 5
  })
  const [offset, setOffset] = useState(0)
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null)

  const span = info?.extent[plan.plane] ?? 0

  // A coronal of a 5 mm study is a wide, shallow picture; it has to be scaled to
  // the window like any other image, or it sits in the middle at its own size.
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

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    window.api
      .openVolume(stack.id)
      .then((opened) => {
        if (cancelled) return
        setInfo(opened)
        // Aim at something a reader would scroll through rather than a whole
        // acquisition's worth of reformats.
        const wanted = Math.max(opened.finestSpacing, step(opened.extent.coronal / 24))
        setPlan((current) => ({ ...current, spacing: wanted, thickness: wanted }))
        setOffset(opened.extent.coronal / 2)
      })
      .catch((err: unknown) => !cancelled && setError(previewErrorText(err)))
      .finally(() => !cancelled && setBusy(false))

    return () => {
      cancelled = true
      void window.api.closeVolume()
    }
  }, [stack.id])

  // Every control change is one round trip for one image. The volume is already
  // in memory over there, so this is a resample and not a read.
  useEffect(() => {
    if (info === null) return
    let cancelled = false
    window.api
      .reformatFrame({ ...plan, offset }, 1024)
      .then((next) => !cancelled && setFrame(next))
      .catch((err: unknown) => !cancelled && setError(previewErrorText(err)))
    return () => {
      cancelled = true
    }
  }, [info, plan, offset])

  useEffect(() => {
    if (info === null) return
    let cancelled = false
    window.api.reformatCount(plan).then((next) => !cancelled && setCount(next))
    return () => {
      cancelled = true
    }
  }, [info, plan])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas && frame) paintFrame(canvas, frame)
  }, [frame])

  // Keep the position inside the plane that is showing now.
  useEffect(() => {
    setOffset((current) => Math.min(current, span))
  }, [span])

  useWheelScrub(stageRef, (steps) =>
    setOffset((current) => Math.min(Math.max(current + steps * plan.spacing, 0), span))
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [onClose])

  const add = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const { studyId, series } = await window.api.commitReformat(plan)
      onAdded(studyId, series)
      onClose()
    } catch (err) {
      setError(previewErrorText(err))
      setBusy(false)
    }
  }

  const set = (patch: Partial<ReformatPlan>): void => setPlan((current) => ({ ...current, ...patch }))

  return (
    <div className="viewer-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="viewer" role="dialog" aria-label={`Reformat ${stack.label}`}>
        <header className="viewer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>Reformat</h2>
            <div className="muted small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {heading} · {stack.label}
            </div>
          </div>
          <div className="tools">
            {PLANES.map((option) => (
              <button
                key={option.id}
                className={plan.plane === option.id ? 'small on' : 'small'}
                disabled={info === null}
                onClick={() => {
                  set({ plane: option.id })
                  setOffset((info?.extent[option.id] ?? 0) / 2)
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button onClick={onClose}>Cancel</button>
        </header>

        <div className="viewer-stage" ref={stageRef}>
          {error ? (
            <div className="placeholder">
              This stack cannot be reformatted
              <br />
              {error}
            </div>
          ) : frame ? (
            <div className="image-box" style={fitted}>
              <canvas ref={canvasRef} />
            </div>
          ) : (
            <div className="placeholder">Reading the images into a volume…</div>
          )}
        </div>

        <div className="viewer-controls">
          <div className="viewer-slider">
            <span>Through</span>
            <input
              type="range"
              min={0}
              max={Math.max(span, 1)}
              step={0.5}
              value={offset}
              disabled={info === null}
              aria-label="Position through the volume"
              onChange={(e) => setOffset(Number(e.target.value))}
            />
            <span className="n">{step(offset)} mm</span>
          </div>

          <div className="viewer-slider">
            <span>Slab</span>
            <input
              type="range"
              min={info?.finestSpacing ?? 1}
              max={Math.max(Math.min(span, 100), 2)}
              step={0.5}
              value={plan.thickness}
              disabled={info === null || plan.projection === 'slice'}
              aria-label="Slab thickness"
              onChange={(e) => set({ thickness: Number(e.target.value) })}
            />
            <span className="n">{plan.projection === 'slice' ? '—' : `${step(plan.thickness)} mm`}</span>
          </div>

          <div className="viewer-slider">
            <span>Every</span>
            <input
              type="range"
              min={info?.finestSpacing ?? 1}
              max={Math.max(Math.min(span / 2, 20), 2)}
              step={0.5}
              value={plan.spacing}
              disabled={info === null}
              aria-label="Spacing between the images produced"
              onChange={(e) => set({ spacing: Number(e.target.value) })}
            />
            <span className="n">{step(plan.spacing)} mm</span>
          </div>

          <div className="viewer-actions">
            <div className="tools">
              {PROJECTIONS.map((option) => (
                <button
                  key={option.id}
                  className={plan.projection === option.id ? 'small on' : 'small'}
                  disabled={info === null}
                  title={option.title}
                  onClick={() => set({ projection: option.id })}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="spacer" />
            <span className="muted small">
              {info === null
                ? ''
                : `${count} image${count === 1 ? '' : 's'} · ${step(plan.spacing)} mm apart, interpolated from ${step(info.spacing.z)} mm slices`}
            </span>
            <button className="primary" disabled={info === null || busy || count === 0} onClick={() => void add()}>
              Add to the case
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
