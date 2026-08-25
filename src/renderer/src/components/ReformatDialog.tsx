import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  Plane,
  PreviewFrame,
  Projection,
  ReformatPlan,
  Series,
  Stack,
  VolumeInfo,
  WindowLevel
} from '@shared/types'
import { previewErrorText } from '../dicomPreview'
import { ReformatPanel } from './ReformatPanel'

interface Props {
  stack: Stack
  /** Study and series, so the dialog says what is being cut up. */
  heading: string
  onAdded: (studyId: string, series: Series) => void
  onClose: () => void
}

type Axis = 'x' | 'y' | 'z'

/**
 * How each plane lies against the volume's own axes.
 *
 * The same table as the reformatter's in the main process, and it has to stay
 * the same: this is what turns a click in a pane into a position in the volume,
 * and the two disagreeing would put the crosshair somewhere the image is not.
 */
const PANES: Record<Plane, { u: Axis; v: Axis; n: Axis; flipV: boolean; label: string }> = {
  axial: { u: 'x', v: 'y', n: 'z', flipV: false, label: 'Axial' },
  coronal: { u: 'x', v: 'z', n: 'y', flipV: true, label: 'Coronal' },
  sagittal: { u: 'y', v: 'z', n: 'x', flipV: true, label: 'Sagittal' }
}

const PROJECTIONS: { id: Projection; label: string; title: string }[] = [
  { id: 'slice', label: 'Slice', title: 'One plane through the volume' },
  { id: 'mip', label: 'MIP', title: 'The brightest sample through the slab: vessels, contrast, bone' },
  { id: 'minip', label: 'MinIP', title: 'The darkest sample through the slab: airways, emphysema, fat' },
  { id: 'mean', label: 'Mean', title: 'The average through the slab: quieter noise, softer detail' }
]

/** Round to something a slider can land on and a person can read. */
const step = (value: number): number => Math.round(value * 10) / 10

/** Navigator panes are small; the one being built is looked at. */
const PANE_EDGE = 512
const RESULT_EDGE = 1024

/**
 * Cutting a stack another way, and flattening slabs of it.
 *
 * Laid out the way a workstation lays it out: the three orthogonal planes as
 * navigators with a shared crosshair, and the image that will actually be added
 * to the case in the fourth corner. Drag the crosshair in any pane and the
 * other two follow it, because the question this view exists to answer is not
 * "what does this reformat look like" but "where is it being taken from".
 *
 * The volume itself stays in the main process — a chest CT is hundreds of
 * megabytes — so all of this is four requests for four preview-sized images.
 */
export function ReformatDialog({ stack, heading, onAdded, onClose }: Props): React.JSX.Element {
  const [info, setInfo] = useState<VolumeInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [frames, setFrames] = useState<Record<string, PreviewFrame | null>>({})
  const [count, setCount] = useState(0)
  const [plan, setPlan] = useState<ReformatPlan>({ plane: 'coronal', projection: 'slice', thickness: 5, spacing: 5 })
  /** Where the three planes cross, in millimetres along each of the volume's axes. */
  const [at, setAt] = useState<Record<Axis, number>>({ x: 0, y: 0, z: 0 })
  const [window_, setWindow] = useState<WindowLevel | null>(null)

  /** The extent of each axis, which is what a fraction of a pane means in millimetres. */
  const size: Record<Axis, number> = useMemo(
    () => ({ x: info?.extent.sagittal ?? 0, y: info?.extent.coronal ?? 0, z: info?.extent.axial ?? 0 }),
    [info]
  )
  const offset = at[PANES[plan.plane].n]

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    window.api
      .openVolume(stack.id)
      .then((opened) => {
        if (cancelled) return
        setInfo(opened)
        // Aim at a series a reader would scroll through, not a whole acquisition.
        const wanted = Math.max(opened.finestSpacing, step(opened.extent.coronal / 24))
        setPlan((current) => ({ ...current, spacing: wanted, thickness: wanted }))
        setAt({
          x: opened.extent.sagittal / 2,
          y: opened.extent.coronal / 2,
          z: opened.extent.axial / 2
        })
      })
      .catch((err: unknown) => !cancelled && setError(previewErrorText(err)))
      .finally(() => !cancelled && setBusy(false))

    return () => {
      cancelled = true
      void window.api.closeVolume()
    }
  }, [stack.id])

  // Four images per change of anything. They are resamples of a volume that is
  // already in memory over there, so this is arithmetic rather than reading.
  const request = useRef(0)
  useEffect(() => {
    if (info === null) return
    const ticket = ++request.current

    const wanted: [string, Promise<PreviewFrame>][] = [
      ...(Object.keys(PANES) as Plane[]).map(
        (plane): [string, Promise<PreviewFrame>] => [
          plane,
          window.api.reformatFrame(
            { plane, projection: 'slice', thickness: 0, spacing: plan.spacing, offset: at[PANES[plane].n] },
            PANE_EDGE
          )
        ]
      ),
      ['result', window.api.reformatFrame({ ...plan, offset }, RESULT_EDGE)]
    ]

    void Promise.all(wanted.map(async ([key, promise]) => [key, await promise] as const))
      .then((pairs) => {
        // A drag fires faster than these come back; only the newest is drawn.
        if (ticket === request.current) setFrames(Object.fromEntries(pairs))
      })
      .catch((err: unknown) => ticket === request.current && setError(previewErrorText(err)))
  }, [info, plan, at, offset])

  useEffect(() => {
    if (info === null) return
    let cancelled = false
    window.api.reformatCount(plan).then((next) => !cancelled && setCount(next))
    return () => {
      cancelled = true
    }
  }, [info, plan])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [onClose])

  const result = frames.result ?? null
  const level = window_ ?? (result?.kind === 'grey' ? result.window : null)

  /** The spread of the image, which is what the window sliders have to cover. */
  const bounds = useMemo(() => {
    if (result?.kind !== 'grey') return null
    let min = Infinity
    let max = -Infinity
    for (const value of result.values) {
      if (value < min) min = value
      if (value > max) max = value
    }
    return Number.isFinite(min) && max > min ? { min, max } : null
  }, [result])

  const setLevel = (next: Partial<WindowLevel>): void => {
    if (!level) return
    setWindow({ centre: next.centre ?? level.centre, width: Math.max(next.width ?? level.width, 1) })
  }

  /** Windowing by drag: right widens, down raises the centre, as everywhere else. */
  const dragFrom = useRef<WindowLevel | null>(null)
  const onWindowDrag = (dx: number, dy: number, first: boolean): void => {
    if (first) {
      dragFrom.current = level
      return
    }
    const from = dragFrom.current
    if (!from) return
    const unit = Math.max(from.width, 1) / 300
    setWindow({ centre: from.centre + dy * unit, width: Math.max(from.width + dx * unit, 1) })
  }

  const move = (axis: Axis, millimetres: number): void =>
    setAt((current) => ({ ...current, [axis]: Math.min(Math.max(millimetres, 0), size[axis]) }))

  const add = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const { studyId, series } = await window.api.commitReformat({ ...plan, window: level })
      onAdded(studyId, series)
      onClose()
    } catch (err) {
      setError(previewErrorText(err))
      setBusy(false)
    }
  }

  const set = (patch: Partial<ReformatPlan>): void => setPlan((current) => ({ ...current, ...patch }))

  /** Where the other two planes cross this one, as fractions of its image. */
  const crosshair = (plane: Plane): { u: number; v: number } => {
    const pane = PANES[plane]
    const u = size[pane.u] > 0 ? at[pane.u] / size[pane.u] : 0.5
    const v = size[pane.v] > 0 ? at[pane.v] / size[pane.v] : 0.5
    return { u, v: pane.flipV ? 1 - v : v }
  }

  const pick = (plane: Plane) => (u: number, v: number) => {
    const pane = PANES[plane]
    move(pane.u, u * size[pane.u])
    move(pane.v, (pane.flipV ? 1 - v : v) * size[pane.v])
  }

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
            {(Object.keys(PANES) as Plane[]).map((plane) => (
              <button
                key={plane}
                className={plan.plane === plane ? 'small on' : 'small'}
                disabled={info === null}
                title={`Build the series from the ${PANES[plane].label.toLowerCase()} plane`}
                onClick={() => set({ plane })}
              >
                {PANES[plane].label}
              </button>
            ))}
          </div>
          <button onClick={onClose}>Cancel</button>
        </header>

        {error ? (
          <div className="viewer-stage">
            <div className="placeholder">
              This stack cannot be reformatted
              <br />
              {error}
            </div>
          </div>
        ) : (
          <div className="reformat-grid">
            {(Object.keys(PANES) as Plane[]).map((plane) => (
              <ReformatPanel
                key={plane}
                label={PANES[plane].label}
                title="Drag to move the crosshair; the wheel steps through this plane"
                frame={frames[plane] ?? null}
                window={level}
                lines={crosshair(plane)}
                onPick={pick(plane)}
                onScroll={(steps) => move(PANES[plane].n, at[PANES[plane].n] + steps * plan.spacing)}
              />
            ))}
            <ReformatPanel
              result
              label={`${PANES[plan.plane].label} · ${PROJECTIONS.find((p) => p.id === plan.projection)?.label ?? ''}`}
              title="The image that will be added. Drag to window it; the wheel steps through the series"
              frame={result}
              window={level}
              onWindow={onWindowDrag}
              onScroll={(steps) => move(PANES[plan.plane].n, offset + steps * plan.spacing)}
            />
          </div>
        )}

        <div className="viewer-controls">
          <div className="viewer-slider">
            <span>Through</span>
            <input
              type="range"
              min={0}
              max={Math.max(size[PANES[plan.plane].n], 1)}
              step={0.5}
              value={offset}
              disabled={info === null}
              aria-label="Position through the volume"
              onChange={(e) => move(PANES[plan.plane].n, Number(e.target.value))}
            />
            <span className="n">{step(offset)} mm</span>
          </div>

          <div className="viewer-slider">
            <span>Slab</span>
            <input
              type="range"
              min={info?.finestSpacing ?? 1}
              max={Math.max(Math.min(size[PANES[plan.plane].n], 100), 2)}
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
              max={Math.max(Math.min(size[PANES[plan.plane].n] / 2, 20), 2)}
              step={0.5}
              value={plan.spacing}
              disabled={info === null}
              aria-label="Spacing between the images produced"
              onChange={(e) => set({ spacing: Number(e.target.value) })}
            />
            <span className="n">{step(plan.spacing)} mm</span>
          </div>

          {level && bounds && (
            <>
              <div className="viewer-slider">
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
                <span className="n">{step(level.centre)}</span>
              </div>
              <div className="viewer-slider">
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
                <span className="n">{step(level.width)}</span>
              </div>
            </>
          )}

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
            {window_ && (
              <button className="small ghost" onClick={() => setWindow(null)}>
                Reset contrast
              </button>
            )}
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
