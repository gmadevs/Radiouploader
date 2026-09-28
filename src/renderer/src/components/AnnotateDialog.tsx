import { useEffect, useMemo, useRef, useState } from 'react'
import { paintStructures, type Grid } from '@shared/annotate/paint'
import { fillPolygon, stroke, type Point } from '@shared/annotate/raster'
import {
  History,
  PALETTE,
  createStructure,
  fromMessage,
  maskAt,
  paletteColor,
  reinterpolate,
  setKey,
  toMessage,
  type Structure
} from '@shared/annotate/structures'
import { applyWindow } from '@shared/dicomImage'
import { isKept } from '@shared/selection'
import type { PreviewFrame, Series, Stack, WindowLevel } from '@shared/types'
import { CT_WINDOW_PRESETS, matchingPreset, usesHounsfield } from '@shared/windowPresets'
import { closesPolygon, indicesToWrite, stripMarks, vertexReach, type SavedAnnotation } from '../annotateEdit'
import { loadFrame, previewErrorText } from '../dicomPreview'
import { useFocusTrap } from '../focusTrap'
import { useWheelScrub } from '../wheelScrub'

interface Props {
  stack: Stack
  /** Study and series, so the dialog says what is being drawn on. */
  heading: string
  /** A CT can be windowed by number; nothing else can. */
  modality: string | null
  /** The drawing from the last time this stack was open, if there was one. */
  saved: SavedAnnotation | null
  onSave: (saved: SavedAnnotation) => void
  onAdded: (studyId: string, series: Series, replaced: string | null) => void
  onClose: () => void
}

type Tool = 'brush' | 'eraser' | 'polygon'

const TOOLS: { id: Tool; label: string; key: string; title: string }[] = [
  { id: 'brush', label: 'Brush', key: 'B', title: 'Paint the structure. Hold Alt to erase.' },
  { id: 'eraser', label: 'Eraser', key: 'E', title: 'Erase from the structure' },
  {
    id: 'polygon',
    label: 'Polygon',
    key: 'P',
    title: 'Click the corners, then click the first one, double-click or press Return. Hold Alt as you close it to cut the shape out.'
  }
]

/** The same size the viewer asks for, so a drawing lands where it was aimed. */
const VIEWER_EDGE = 1024

const MIN_RADIUS = 0.5
const MAX_RADIUS = 40

const show = (value: number): string => String(Math.round(value * 10) / 10)

function newStructures(saved: SavedAnnotation | null): Structure[] {
  if (saved && saved.structures.length > 0) {
    return saved.structures.map((message) => fromMessage(message, saved.grid.width, saved.grid.height))
  }
  return [createStructure('Structure 1', paletteColor(0))]
}

/**
 * Drawing structures on a stack, to add a coloured copy of it to the case.
 *
 * The drawing is a mask per structure on the images it was drawn on; the
 * images between two of them are filled in, so a canal drawn on every fifth
 * slice is coloured on all of them. Nothing here changes the stack itself.
 * **Add to the case** sends the drawing to the main process, which paints it
 * into every image at full size and writes the result as a series of its own
 * beside this one — which is what the anonymiser and the upload then see.
 *
 * Closing keeps the drawing for the next time the dialog is opened on this
 * stack. Adding again replaces the copy added before.
 */
export function AnnotateDialog({ stack, heading, modality, saved, onSave, onAdded, onClose }: Props): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useFocusTrap(dialogRef)

  /** The images that are going up, by their index in the stack; the slider runs over these. */
  const kept = useMemo(() => stack.slices.map((_slice, i) => i).filter((i) => isKept(stack, i)), [stack])
  const [position, setPosition] = useState(() => Math.floor(kept.length / 2))
  const at = Math.min(position, Math.max(kept.length - 1, 0))
  const index = kept[at] ?? 0

  const [frame, setFrame] = useState<PreviewFrame | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The size every mask is drawn at: the first frame's, and every other frame has to match. */
  const [grid, setGrid] = useState<Grid | null>(saved?.grid ?? null)

  // The structures are edited in place — a mask is a quarter of a megabyte, and
  // copying one per pointer move to keep React's rules would be the slow part of
  // drawing — so the component re-renders on a counter instead.
  const structures = useRef<Structure[] | null>(null)
  structures.current ??= newStructures(saved)
  const [, setVersion] = useState(0)
  const bump = (): void => setVersion((v) => v + 1)
  const history = useRef(new History())

  const [activeId, setActiveId] = useState(() => structures.current![0]?.id ?? null)
  const active = structures.current.find((s) => s.id === activeId) ?? structures.current[0] ?? null

  const [tool, setTool] = useState<Tool>('brush')
  const [radius, setRadius] = useState(3)
  const [window_, setWindow] = useState<WindowLevel | null>(saved?.window ?? stack.window ?? null)
  const [polygon, setPolygon] = useState<Point[]>([])
  const [pointer, setPointer] = useState<Point | null>(null)
  const [onlyDrawn, setOnlyDrawn] = useState(saved?.onlyDrawn ?? false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null)

  const greyscale = frame?.kind === 'grey'
  const level: WindowLevel | null = window_ ?? (frame?.kind === 'grey' ? frame.window : null)
  const presets = usesHounsfield(modality) && greyscale
  const preset = presets ? matchingPreset(level) : null

  useEffect(() => {
    const slice = stack.slices[index]
    if (!slice) return
    let cancelled = false
    loadFrame(slice.path, slice.frame, VIEWER_EDGE)
      .then((loaded) => {
        if (cancelled) return
        setFrame(loaded)
        if (grid === null) {
          setGrid({ width: loaded.width, height: loaded.height })
          setError(null)
        } else if (loaded.width !== grid.width || loaded.height !== grid.height) {
          setError('This image is a different size from the others in the stack, so it cannot be drawn on.')
        } else {
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setFrame(null)
        setError(previewErrorText(err))
      })
    return () => {
      cancelled = true
    }
    // The grid is read, not followed: it is set once, by the first frame.
  }, [stack.slices, index])

  const drawable = frame !== null && grid !== null && error === null

  // The picture is the same function the written files come from, at the size
  // of this frame: the colours on screen are the colours that go up.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !frame || !grid || error) return
    const rgba =
      frame.kind === 'grey'
        ? applyWindow(frame, level ?? frame.window).rgba
        : new Uint8ClampedArray(frame.rgba)
    paintStructures(rgba, frame.width, frame.height, 4, structures.current!, index, grid)
    canvas.width = frame.width
    canvas.height = frame.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), frame.width, frame.height), 0, 0)
    ctx.fillStyle = '#000'
    for (const mask of stack.masks ?? []) {
      ctx.fillRect(mask.x * frame.width, mask.y * frame.height, mask.width * frame.width, mask.height * frame.height)
    }
  })

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
    return { width: frame.width * scale, height: frame.height * scale }
  }, [frame, stage])

  const go = (next: number): void => {
    setPolygon([])
    setPosition(Math.min(Math.max(next, 0), kept.length - 1))
  }
  useWheelScrub(stageRef, (steps) => go(at + steps))

  const pixelCount = grid ? grid.width * grid.height : 0

  /** Make a change to one key undoable, and fill the images round it again. */
  const record = (structure: Structure, image: number, before: Uint8Array | undefined, after: Uint8Array | undefined): void => {
    if (!grid) return
    history.current.push({ structure, index: image, before: before?.slice(), after: after?.slice() })
    setKey(structure, image, after)
    reinterpolate(structure, grid.width, grid.height)
    bump()
  }

  /** The mask to start an edit from: an image filled in becomes a key when it is drawn on. */
  const startingMask = (structure: Structure): Uint8Array =>
    (maskAt(structure, index) ?? new Uint8Array(pixelCount)).slice()

  const finishPolygon = (subtract: boolean): void => {
    if (!active || !grid || polygon.length < 3) {
      setPolygon([])
      return
    }
    active.visible = true
    const mask = startingMask(active)
    fillPolygon(mask, grid.width, grid.height, polygon, subtract ? 0 : 1)
    record(active, index, active.keys.get(index), mask)
    setPolygon([])
  }

  const clearImage = (): void => {
    if (!active) return
    record(active, index, active.keys.get(index), new Uint8Array(pixelCount))
  }

  const removeKey = (): void => {
    if (!active || !active.keys.has(index)) return
    record(active, index, active.keys.get(index), undefined)
  }

  const copyFrom = (step: number): void => {
    if (!active) return
    const source = kept[at + step]
    const mask = source === undefined ? undefined : maskAt(active, source)
    if (mask) record(active, index, active.keys.get(index), mask.slice())
  }

  const undo = (redo = false): void => {
    if (!grid) return
    const edit = redo ? history.current.redo() : history.current.undo()
    if (!edit) return
    reinterpolate(edit.structure, grid.width, grid.height)
    setActiveId(edit.structure.id)
    const place = kept.indexOf(edit.index)
    if (place >= 0) go(place)
    bump()
  }

  // A drag is a paint stroke or a change of window, decided when it starts.
  const drag = useRef<
    | { kind: 'paint'; structure: Structure; image: number; value: 0 | 1; last: Point; before: Uint8Array | undefined; mask: Uint8Array }
    | { kind: 'window'; x: number; y: number; from: WindowLevel }
    | null
  >(null)

  const gridPoint = (event: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return [
      ((event.clientX - rect.left) / rect.width) * (grid?.width ?? 1),
      ((event.clientY - rect.top) / rect.height) * (grid?.height ?? 1)
    ]
  }

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!drawable || !grid) return
    // The right button sets the window, whatever the tool, as in the viewer.
    if (event.button === 2) {
      if (!greyscale || !level) return
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { kind: 'window', x: event.clientX, y: event.clientY, from: level }
      return
    }
    if (event.button !== 0 || !active) return
    const point = gridPoint(event)

    if (tool === 'polygon') {
      if (closesPolygon(polygon, point, vertexReach(grid, fitted?.width ?? 0))) finishPolygon(event.altKey)
      else setPolygon((current) => [...current, point])
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    active.visible = true
    const value: 0 | 1 = tool === 'eraser' || event.altKey ? 0 : 1
    const mask = startingMask(active)
    stroke(mask, grid.width, grid.height, point, point, radius, value)
    // Shown while it is drawn; recorded and filled round when it ends.
    const before = active.keys.get(index)
    active.keys.set(index, mask)
    active.fields.delete(index)
    drag.current = { kind: 'paint', structure: active, image: index, value, last: point, before, mask }
    bump()
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const point = gridPoint(event)
    setPointer(point)
    const current = drag.current
    if (!current || !grid) return
    if (current.kind === 'window') {
      const unit = Math.max(current.from.width, 1) / 300
      setWindow({
        centre: current.from.centre + (event.clientY - current.y) * unit,
        width: Math.max(current.from.width + (event.clientX - current.x) * unit, 1)
      })
      return
    }
    stroke(current.mask, grid.width, grid.height, current.last, point, radius, current.value)
    current.last = point
    bump()
  }

  const endDrag = (): void => {
    const current = drag.current
    drag.current = null
    if (current?.kind === 'paint') record(current.structure, current.image, current.before, current.mask)
  }

  const snapshot = (seriesId: string | null): SavedAnnotation | null =>
    grid === null
      ? null
      : {
          grid,
          structures: structures.current!.map(toMessage),
          seriesId,
          window: window_,
          onlyDrawn
        }

  const close = (): void => {
    const drawing = snapshot(saved?.seriesId ?? null)
    if (drawing) onSave(drawing)
    onClose()
  }

  const indices = indicesToWrite(structures.current, kept, onlyDrawn)
  const anything = structures.current.some(
    (s) => s.visible && [...s.keys.values()].some((mask) => mask.some((v) => v))
  )

  const add = async (): Promise<void> => {
    if (!grid) return
    setBusy(true)
    setFailure(null)
    try {
      const replaces = saved?.seriesId ?? null
      const { studyId, series } = await window.api.commitAnnotation(stack.id, {
        grid,
        indices,
        structures: structures.current!.map(toMessage),
        window: greyscale ? window_ : null,
        replaces
      })
      const next = snapshot(series.id)
      if (next) onSave(next)
      onAdded(studyId, series, replaces)
      onClose()
    } catch (err) {
      setFailure(previewErrorText(err))
      setBusy(false)
    }
  }

  // Read through a ref so the listener is added once and still sees this render.
  const keys = useRef<(event: KeyboardEvent) => void>(() => {})
  keys.current = (event: KeyboardEvent): void => {
    const typing = event.target instanceof HTMLInputElement && event.target.type === 'text'
    if (event.key === 'Escape') {
      if (polygon.length > 0) setPolygon([])
      else close()
      return
    }
    if (typing) return
    const command = event.metaKey || event.ctrlKey
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      undo(event.shiftKey)
      return
    }
    if (command && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      undo(true)
      return
    }
    if (command || busy) return
    switch (event.key) {
      case 'Enter':
        finishPolygon(event.altKey)
        break
      case 'Backspace':
        if (polygon.length > 0) setPolygon((current) => current.slice(0, -1))
        break
      case 'ArrowUp':
      case 'ArrowLeft':
      case 'PageUp':
        go(at - 1)
        break
      case 'ArrowDown':
      case 'ArrowRight':
      case 'PageDown':
        go(at + 1)
        break
      case 'Home':
        go(0)
        break
      case 'End':
        go(kept.length - 1)
        break
      case '[':
        setRadius((r) => Math.max(MIN_RADIUS, Math.round((r - 0.5) * 2) / 2))
        break
      case ']':
        setRadius((r) => Math.min(MAX_RADIUS, Math.round((r + 0.5) * 2) / 2))
        break
      case 'c':
        copyFrom(-1)
        break
      case 'C':
        copyFrom(1)
        break
      default: {
        const chosen = TOOLS.find((t) => t.key.toLowerCase() === event.key.toLowerCase())
        if (chosen) {
          setTool(chosen.id)
          setPolygon([])
        } else return
      }
    }
    event.preventDefault()
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => keys.current(event)
    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [])

  const addStructure = (): void => {
    const n = structures.current!.length
    const structure = createStructure(`Structure ${n + 1}`, paletteColor(n))
    structures.current!.push(structure)
    setActiveId(structure.id)
    bump()
  }

  const deleteStructure = (structure: Structure): void => {
    history.current.forget(structure)
    structures.current = structures.current!.filter((s) => s !== structure)
    setActiveId(structures.current[0]?.id ?? null)
    bump()
  }

  const edit = (structure: Structure, patch: Partial<Pick<Structure, 'name' | 'color' | 'opacity' | 'outline' | 'visible' | 'interpolate'>>): void => {
    Object.assign(structure, patch)
    bump()
  }

  const marks = active ? stripMarks(active, kept) : []
  const isKey = active?.keys.has(index) ?? false
  const span = Math.max(kept.length - 1, 1)

  return (
    <div className="viewer-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className="viewer annotate"
        role="dialog"
        aria-modal="true"
        aria-label={`Annotate ${stack.label}`}
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="viewer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>Annotate</h2>
            <div className="muted small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {heading}
              {stack.label ? ` · ${stack.label}` : ''}
            </div>
          </div>
          <div className="tools segmented">
            {TOOLS.map((option) => (
              <button
                key={option.id}
                className={tool === option.id ? 'small on' : 'small'}
                title={`${option.title} (${option.key})`}
                onClick={() => {
                  setTool(option.id)
                  setPolygon([])
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="tools">
            <button className="small ghost" disabled={!history.current.canUndo} title="Undo (⌘Z)" onClick={() => undo()}>
              Undo
            </button>
            <button
              className="small ghost"
              disabled={!history.current.canRedo}
              title="Redo (⇧⌘Z)"
              onClick={() => undo(true)}
            >
              Redo
            </button>
          </div>
          <div className="exits">
            <button onClick={close} title="Close and keep the drawing for the next time">
              Close
            </button>
          </div>
        </header>

        <div className="annotate-body">
          <div className={`viewer-stage drawing ${tool}`} ref={stageRef}>
            {error ? (
              <div className="placeholder">
                This image cannot be drawn on
                <br />
                {error}
              </div>
            ) : (
              <div
                className="image-box"
                style={fitted ? { width: `${fitted.width}px`, height: `${fitted.height}px` } : undefined}
              >
                <canvas
                  ref={canvasRef}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onPointerLeave={() => setPointer(null)}
                  onDoubleClick={() => tool === 'polygon' && finishPolygon(false)}
                  onContextMenu={(e) => e.preventDefault()}
                />
                {grid && (
                  <svg className="draw-layer" viewBox={`0 0 ${grid.width} ${grid.height}`} preserveAspectRatio="none">
                    {tool !== 'polygon' && pointer && (
                      <circle cx={pointer[0]} cy={pointer[1]} r={radius} className="brush-ring" />
                    )}
                    {polygon.length > 0 && (
                      <>
                        <polyline
                          points={[...polygon, ...(pointer ? [pointer] : [])].map(([x, y]) => `${x},${y}`).join(' ')}
                          className="polygon-line"
                          style={{ stroke: active?.color }}
                        />
                        <circle cx={polygon[0][0]} cy={polygon[0][1]} r={vertexReach(grid, fitted?.width ?? 0) / 2} className="polygon-start" />
                      </>
                    )}
                  </svg>
                )}
              </div>
            )}
          </div>

          <aside className="annotate-aside">
            <div className="muted small">Structures</div>
            {structures.current.map((structure) => (
              <div
                key={structure.id}
                className={structure === active ? 'structure on' : 'structure'}
                onClick={() => setActiveId(structure.id)}
              >
                <input
                  type="checkbox"
                  checked={structure.visible}
                  title="Show this structure, and write it into the copy"
                  aria-label={`Show ${structure.name}`}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => edit(structure, { visible: e.target.checked })}
                />
                <span className="swatch" style={{ background: structure.color }} />
                <input
                  type="text"
                  value={structure.name}
                  aria-label="Structure name"
                  onFocus={() => setActiveId(structure.id)}
                  onChange={(e) => edit(structure, { name: e.target.value })}
                />
              </div>
            ))}
            <button className="small" onClick={addStructure}>
              New structure
            </button>

            {active && (
              <div className="structure-detail">
                <div className="swatches">
                  {PALETTE.map((colour) => (
                    <button
                      key={colour.hex}
                      className={active.color === colour.hex ? 'swatch-button on' : 'swatch-button'}
                      style={{ background: colour.hex }}
                      title={colour.name}
                      aria-label={colour.name}
                      onClick={() => edit(active, { color: colour.hex })}
                    />
                  ))}
                  <input
                    type="color"
                    value={active.color}
                    title="Any other colour"
                    aria-label="Any other colour"
                    onChange={(e) => edit(active, { color: e.target.value })}
                  />
                </div>
                <label className="viewer-slider">
                  <span>Opacity</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={active.opacity}
                    onChange={(e) => edit(active, { opacity: Number(e.target.value) })}
                  />
                  <span className="n">{Math.round(active.opacity * 100)}%</span>
                </label>
                <label className="setting">
                  <input type="checkbox" checked={active.outline} onChange={(e) => edit(active, { outline: e.target.checked })} />
                  <span>Outline</span>
                </label>
                <label className="setting">
                  <input
                    type="checkbox"
                    checked={active.interpolate}
                    onChange={(e) => edit(active, { interpolate: e.target.checked })}
                  />
                  <span>Fill the images between drawn ones</span>
                </label>
                <button className="small ghost" onClick={() => deleteStructure(active)}>
                  Delete structure
                </button>
              </div>
            )}

            <div className="muted small annotate-help">
              Draw on a few images and the ones between are filled in. <kbd>Alt</kbd> erases with the brush and cuts
              with the polygon. <kbd>C</kbd> and <kbd>⇧C</kbd> copy the drawing from the image before or after. The
              right button sets the contrast.
            </div>
          </aside>
        </div>

        <div className="viewer-controls">
          <div className="viewer-row">
            <div className="viewer-slider">
              <span>Image</span>
              <div className="strip-track">
                <div className="key-strip" aria-hidden="true">
                  {marks.map((mark) => (
                    <span
                      key={mark.position}
                      className={`mark ${mark.kind}`}
                      style={{
                        left: `${(mark.position / span) * 100}%`,
                        background: mark.kind === 'empty' ? undefined : active?.color
                      }}
                    />
                  ))}
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(kept.length - 1, 0)}
                  value={at}
                  aria-label="Image"
                  onChange={(e) => go(Number(e.target.value))}
                />
              </div>
              <span className="n">
                {at + 1} / {kept.length}
              </span>
            </div>
            <button
              className="small ghost"
              disabled={!drawable || !active}
              title="Mark this image as where the structure ends: it shrinks to nothing between the last drawn image and this one"
              onClick={clearImage}
            >
              Clear image
            </button>
            <button
              className="small ghost"
              disabled={!isKey}
              title="Forget what was drawn on this image and fill it in from its neighbours again"
              onClick={removeKey}
            >
              Fill from neighbours
            </button>
          </div>
          <div className="viewer-row">
            <label className="viewer-slider">
              <span>Brush</span>
              <input
                type="range"
                min={MIN_RADIUS}
                max={MAX_RADIUS}
                step={0.5}
                value={radius}
                aria-label="Brush size"
                onChange={(e) => setRadius(Number(e.target.value))}
              />
              <span className="n">{show(radius)} px</span>
            </label>
            {presets &&
              CT_WINDOW_PRESETS.map((option) => (
                <button
                  key={option.name}
                  className={preset?.name === option.name ? 'small on' : 'small ghost'}
                  title={`${option.hint}: width ${option.window.width}, centre ${option.window.centre} HU`}
                  onClick={() => setWindow(option.window)}
                >
                  {option.name}
                </button>
              ))}
          </div>
          {failure && <div className="notice error">{failure}</div>}
          <div className="viewer-actions">
            <label className="setting" title="Leave out the images before the first and after the last one with colour on it">
              <input type="checkbox" checked={onlyDrawn} onChange={(e) => setOnlyDrawn(e.target.checked)} />
              <span>Only the annotated images</span>
            </label>
            <div className="spacer" />
            <span className="muted small">
              {indices.length} image{indices.length === 1 ? '' : 's'}, written in colour with this contrast
              {saved?.seriesId ? ' · replaces the copy added before' : ''}
            </span>
            <button className="primary" disabled={!drawable || busy || !anything} onClick={() => void add()}>
              {busy ? 'Writing…' : saved?.seriesId ? 'Update the case' : 'Add to the case'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
