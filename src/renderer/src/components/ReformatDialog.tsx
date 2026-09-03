import { useEffect, useMemo, useRef, useState } from 'react'
import { AXES, boxRange, cross, dot, negate, rotate, square, type Frame, type Vec3 } from '@shared/geometry'
import type { PreviewFrame, Projection, ReformatPlan, Series, Stack, VolumeInfo, WindowLevel } from '@shared/types'
import { previewErrorText } from '../dicomPreview'
import { ReformatPanel } from './ReformatPanel'

interface Props {
  stack: Stack
  /** Study and series, so the dialog says what is being cut up. */
  heading: string
  onAdded: (studyId: string, series: Series) => void
  onClose: () => void
}

type PaneId = 'axial' | 'coronal' | 'sagittal'

const PANES: PaneId[] = ['axial', 'coronal', 'sagittal']
const PANE_NAMES: Record<PaneId, string> = { axial: 'Axial', coronal: 'Coronal', sagittal: 'Sagittal' }

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
 * Turn the planes that are not the one being dragged.
 *
 * A crosshair at a workstation turns the *other* two planes about the one you
 * are dragging on: the picture under your hand stays put and its crosshair
 * sweeps round it. Turning all three — which is what one shared set of axes
 * does — leaves the crosshair painted at the same angle over an image that
 * spins underneath, which is both wrong and unusable.
 *
 * Each frame stays right-handed, u × v = n, which is what lets an angle
 * measured on screen be applied as a rotation without guessing at a sign.
 */
function turnOthers(planes: Record<PaneId, Frame>, about: PaneId, radians: number): Record<PaneId, Frame> {
  const axis = planes[about].n
  const turned = { ...planes }
  for (const pane of PANES) {
    if (pane === about) continue
    const frame = planes[pane]
    turned[pane] = square({
      u: rotate(frame.u, axis, radians),
      v: rotate(frame.v, axis, radians),
      n: rotate(frame.n, axis, radians)
    })
  }
  return turned
}

/**
 * Cutting a stack another way, and flattening slabs of it.
 *
 * Laid out the way a workstation lays it out: the three planes as navigators
 * with a shared crosshair, and the image that will actually be added to the
 * case in the fourth corner. Drag the crosshair in any pane and the other two
 * follow it; drag its arms and all three turn, because they are one set of axes
 * and not three separate views.
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
  const [output, setOutput] = useState<PaneId>('coronal')
  const [projection, setProjection] = useState<Projection>('slice')
  const [thickness, setThickness] = useState(5)
  const [spacing, setSpacing] = useState(5)
  const [window_, setWindow] = useState<WindowLevel | null>(null)
  /** The three planes as they stand, and the point all three pass through. */
  const [planes, setPlanes] = useState<Record<PaneId, Frame> | null>(null)
  const [focus, setFocus] = useState<Vec3>([0, 0, 0])

  const size = info?.size ?? { x: 0, y: 0, z: 0 }
  const frame = planes?.[output] ?? { u: AXES.x, v: negate(AXES.z), n: AXES.y }

  /** Where a plane through the focus sits along its own normal, from the near edge. */
  const offsetOf = (direction: Vec3): number => dot(focus, direction) - boxRange(size, direction).min
  const spanOf = (direction: Vec3): number => {
    const { min, max } = boxRange(size, direction)
    return max - min
  }

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    window.api
      .openVolume(stack.id)
      .then((opened) => {
        if (cancelled) return
        setInfo(opened)
        setPlanes(opened.frames)
        const wanted = Math.max(opened.finestSpacing, step(opened.size.y / 24))
        setSpacing(wanted)
        setThickness(wanted)
        setFocus([opened.size.x / 2, opened.size.y / 2, opened.size.z / 2])
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

    if (planes === null) return
    const wanted: [string, Promise<PreviewFrame>][] = [
      ...PANES.map((pane): [string, Promise<PreviewFrame>] => {
        const paneAxes = planes[pane]
        return [
          pane,
          window.api.reformatFrame(
            { frame: paneAxes, projection: 'slice', thickness: 0, spacing, offset: offsetOf(paneAxes.n) },
            PANE_EDGE
          )
        ]
      }),
      [
        'result',
        window.api.reformatFrame({ frame, projection, thickness, spacing, offset: offsetOf(frame.n) }, RESULT_EDGE)
      ]
    ]

    void Promise.all(wanted.map(async ([key, promise]) => [key, await promise] as const))
      .then((pairs) => {
        // A drag fires faster than these come back; only the newest is drawn.
        if (ticket === request.current) setFrames(Object.fromEntries(pairs))
      })
      .catch((err: unknown) => ticket === request.current && setError(previewErrorText(err)))
  }, [info, planes, focus, frame, projection, thickness, spacing])

  useEffect(() => {
    if (info === null) return
    let cancelled = false
    window.api
      .reformatCount({ frame, projection, thickness, spacing })
      .then((next) => !cancelled && setCount(next))
    return () => {
      cancelled = true
    }
  }, [info, frame, projection, thickness, spacing])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [onClose])

  const result = frames.result ?? null
  const level = window_ ?? (result?.kind === 'grey' ? result.window : null)

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

  /** Put the focus somewhere on a pane, keeping its position along that pane's normal. */
  const pick = (pane: PaneId) => (u: number, v: number): void => {
    if (planes === null) return
    const axes = planes[pane]
    const across = boxRange(size, axes.u)
    const down = boxRange(size, axes.v)
    const along = dot(focus, axes.n)
    const uMm = across.min + u * (across.max - across.min)
    const vMm = down.min + v * (down.max - down.min)
    setFocus([
      axes.u[0] * uMm + axes.v[0] * vMm + axes.n[0] * along,
      axes.u[1] * uMm + axes.v[1] * vMm + axes.n[1] * along,
      axes.u[2] * uMm + axes.v[2] * vMm + axes.n[2] * along
    ])
  }

  const rotateAbout = (pane: PaneId, radians: number): void =>
    setPlanes((current) => (current === null ? current : turnOthers(current, pane, radians)))

  /** Where the other two planes cross this one, as fractions of its image. */
  const crosshair = (pane: PaneId): { u: number; v: number; angle: number } => {
    const axes = planes?.[pane] ?? frame
    const across = boxRange(size, axes.u)
    const down = boxRange(size, axes.v)
    const u = (dot(focus, axes.u) - across.min) / Math.max(across.max - across.min, 1e-6)
    const v = (dot(focus, axes.v) - down.min) / Math.max(down.max - down.min, 1e-6)
    // The other planes meet this one along the line perpendicular to both
    // normals; drawn at that angle, the crosshair shows how the axes are turned.
    const other = PANES.find((id) => id !== pane) as PaneId
    const line = cross(axes.n, (planes?.[other] ?? frame).n)
    return { u, v, angle: Math.atan2(dot(line, axes.v), dot(line, axes.u)) }
  }

  const move = (direction: Vec3, millimetres: number): void => {
    const { min, max } = boxRange(size, direction)
    const wanted = Math.min(Math.max(millimetres, 0), max - min)
    const change = wanted - offsetOf(direction)
    setFocus((current) => [
      current[0] + direction[0] * change,
      current[1] + direction[1] * change,
      current[2] + direction[2] * change
    ])
  }

  const add = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const plan: ReformatPlan = { frame, projection, thickness, spacing, window: level }
      const { studyId, series } = await window.api.commitReformat(plan)
      onAdded(studyId, series)
      onClose()
    } catch (err) {
      setError(previewErrorText(err))
      setBusy(false)
    }
  }

  /**
   * What the plane is called: matched against the ones this volume started on
   * rather than against the volume's axes, since those are the acquisition's
   * and this is the patient's.
   */
  const nameOf = (direction: Vec3): string => {
    const named = PANES.find((pane) => info && Math.abs(dot(direction, info.frames[pane].n)) > 0.999)
    return named ? PANE_NAMES[named] : 'Oblique'
  }

  const tilted = nameOf(frame.n) === 'Oblique'
  const throughSpan = spanOf(frame.n)

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
            {PANES.map((pane) => (
              <button
                key={pane}
                className={output === pane ? 'small on' : 'small'}
                disabled={info === null}
                title={`Build the series from the ${PANE_NAMES[pane].toLowerCase()} pane`}
                onClick={() => setOutput(pane)}
              >
                {PANE_NAMES[pane]}
              </button>
            ))}
            {tilted && (
              <button
                className="small ghost"
                title="Put the three planes back where they started"
                onClick={() => info && setPlanes(info.frames)}
              >
                Straighten
              </button>
            )}
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
            {PANES.map((pane) => (
              <ReformatPanel
                key={pane}
                label={PANE_NAMES[pane]}
                title="Drag the middle to move the crosshair, an arm to turn the axes; the wheel steps through"
                frame={frames[pane] ?? null}
                window={level}
                lines={crosshair(pane)}
                onPick={pick(pane)}
                onRotate={(radians) => rotateAbout(pane, radians)}
                onScroll={(steps) => {
                  const axes = planes?.[pane] ?? frame
                  move(axes.n, offsetOf(axes.n) + steps * spacing)
                }}
              />
            ))}
            <ReformatPanel
              result
              label={`${nameOf(frame.n)} · ${PROJECTIONS.find((p) => p.id === projection)?.label ?? ''}`}
              title="The image that will be added. Drag to window it; the wheel steps through the series"
              frame={result}
              window={level}
              onWindow={onWindowDrag}
              onScroll={(steps) => move(frame.n, offsetOf(frame.n) + steps * spacing)}
            />
          </div>
        )}

        <div className="viewer-controls">
          <div className="viewer-slider">
            <span>Through</span>
            <input
              type="range"
              min={0}
              max={Math.max(throughSpan, 1)}
              step={0.5}
              value={Math.min(offsetOf(frame.n), throughSpan)}
              disabled={info === null}
              aria-label="Position through the volume"
              onChange={(e) => move(frame.n, Number(e.target.value))}
            />
            <span className="n">{step(offsetOf(frame.n))} mm</span>
          </div>

          <div className="viewer-slider">
            <span>Slab</span>
            <input
              type="range"
              min={info?.finestSpacing ?? 1}
              max={Math.max(Math.min(throughSpan, 100), 2)}
              step={0.5}
              value={thickness}
              disabled={info === null || projection === 'slice'}
              aria-label="Slab thickness"
              onChange={(e) => setThickness(Number(e.target.value))}
            />
            <span className="n">{projection === 'slice' ? '—' : `${step(thickness)} mm`}</span>
          </div>

          <div className="viewer-slider">
            <span>Every</span>
            <input
              type="range"
              min={info?.finestSpacing ?? 1}
              max={Math.max(Math.min(throughSpan / 2, 20), 2)}
              step={0.5}
              value={spacing}
              disabled={info === null}
              aria-label="Spacing between the images produced"
              onChange={(e) => setSpacing(Number(e.target.value))}
            />
            <span className="n">{step(spacing)} mm</span>
          </div>

          <div className="viewer-actions">
            <div className="tools">
              {PROJECTIONS.map((option) => {
                // A projection through colour would take the red of one voxel
                // and the green of another and paint a colour that is nowhere
                // in the study. A colour series cuts; it does not project.
                const throughColour = (info?.colour ?? false) && option.id !== 'slice'
                return (
                  <button
                    key={option.id}
                    className={projection === option.id ? 'small on' : 'small'}
                    disabled={info === null || throughColour}
                    title={
                      throughColour
                        ? 'These images are in colour, and a projection through colour mixes the colours of different voxels'
                        : option.title
                    }
                    onClick={() => setProjection(option.id)}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            {level && (
              <span className="muted small" style={{ flex: 'none' }}>
                {step(level.centre)} / {step(level.width)}
              </span>
            )}
            {window_ && (
              <button className="small ghost" onClick={() => setWindow(null)}>
                Reset contrast
              </button>
            )}
            <div className="spacer" />
            <span className="muted small">
              {info === null
                ? ''
                : `${count} image${count === 1 ? '' : 's'} · ${step(spacing)} mm apart, interpolated from ${step(info.spacing.z)} mm slices${
                    info.anatomical ? '' : ' · these files do not say which way they face, so the planes are the acquisition’s'
                  }${info.colour ? ' · in colour, so it can be cut but not projected through' : ''}`}
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
