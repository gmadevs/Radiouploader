import { useEffect, useMemo, useRef, useState } from 'react'
import type { CropRect, MaskRect, PreviewFrame, Stack, WindowLevel } from '@shared/types'
import { keptCount, toggleDropped } from '@shared/selection'
import { loadFrame, paintFrame, previewErrorText } from '../dicomPreview'
import { MIN_MASK_SIDE, moveMask, resizeMask, type MaskHandle } from '../maskEdit'
import { useWheelScrub } from '../wheelScrub'

interface Props {
  stack: Stack
  /** Series and study the stack came from, so the header says what is open. */
  heading: string
  onChange: (patch: {
    masks?: MaskRect[]
    crop?: CropRect | null
    window?: WindowLevel | null
    dropped?: number[]
  }) => void
  onClose: () => void
}

type Tool = 'contrast' | 'erase' | 'crop'

/** As large as the main process will decode; asking for more is pointless. */
const VIEWER_EDGE = 1024

/** The corners offered on a selected mask, clockwise from the top left. */
const HANDLES: MaskHandle[] = ['nw', 'ne', 'se', 'sw']

/**
 * Below this a crop is a mis-drag rather than a rectangle.
 *
 * Coarser than the mask minimum on purpose. A stray mask leaves a speck on the
 * image; a stray crop leaves nothing but the speck.
 */
const MIN_CROP_SIDE = 0.05

/** A fraction of the image as a percentage, for saying how much is kept. */
const percent = (value: number): string => `${Math.round(value * 100)}%`

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
 * One stack at full size, with the three things that cannot be fixed later:
 * blanking burnt-in text, cutting the image down, and choosing the window the
 * images are read at.
 *
 * All three are properties of the stack rather than of the image on screen.
 * Text is burnt into the same corner of every frame of an ultrasound or a
 * reconstructed series, and a window that suits one slice suits the rest — so a
 * mask drawn here applies to the whole stack, and the scrubber is for checking
 * that it really does cover the text everywhere.
 *
 * The image is always shown whole, even where a crop is about to throw most of
 * it away, and what goes is shaded rather than hidden. A cut you cannot see
 * past is one you cannot aim.
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
  /** The same, for the crop — kept apart so it is never painted as a redaction. */
  const [pendingCrop, setPendingCrop] = useState<CropRect | null>(null)
  /** Which mask is being edited, if any. Cleared when the masks change under it. */
  const [chosen, setChosen] = useState<number | null>(null)

  const masks = stack.masks ?? []
  /** What is being kept: the crop under the pointer if there is one, else the stack's. */
  const crop = pendingCrop ?? stack.crop
  const imageRef = useRef<HTMLDivElement>(null)
  const selected = chosen !== null && chosen < masks.length ? chosen : null

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
        setError(previewErrorText(err))
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
    if (tool === 'crop') setPendingCrop({ ...from, width: 0, height: 0 })
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const active = drag.current
    if (!active) return
    const to = pointAt(event)

    if (active.tool === 'erase') {
      setPending(rectBetween(active.from, to))
      return
    }
    if (active.tool === 'crop') {
      setPendingCrop(rectBetween(active.from, to))
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

    if (active?.tool === 'erase') {
      setPending((rect) => {
        if (rect && rect.width >= MIN_MASK_SIDE && rect.height >= MIN_MASK_SIDE) {
          onChange({ masks: [...masks, rect] })
        }
        return null
      })
    }
    if (active?.tool === 'crop') {
      setPendingCrop((rect) => {
        // A click rather than a drag means the pointer was put down to think,
        // not to throw the image away.
        if (rect && rect.width >= MIN_CROP_SIDE && rect.height >= MIN_CROP_SIDE) onChange({ crop: rect })
        return null
      })
    }
  }

  /**
   * Moving and resizing an existing box.
   *
   * Every move is computed from the rectangle as it was at pointer-down plus
   * the total travel, never from the last frame — accumulating deltas drifts,
   * and a redaction that drifts is one that stops covering what it was put over.
   */
  const edit = useRef<{ index: number; handle: MaskHandle | 'move'; from: { x: number; y: number }; rect: MaskRect } | null>(
    null
  )

  /** Pointer position as a fraction of the image, from the box around it. */
  const pointOnImage = (event: React.PointerEvent): { x: number; y: number } | null => {
    const rect = imageRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return null
    return {
      x: clampUnit((event.clientX - rect.left) / rect.width),
      y: clampUnit((event.clientY - rect.top) / rect.height)
    }
  }

  const startEdit = (event: React.PointerEvent, index: number, handle: MaskHandle | 'move'): void => {
    const from = pointOnImage(event)
    if (!from) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setChosen(index)
    edit.current = { index, handle, from, rect: masks[index] }
  }

  const onEditMove = (event: React.PointerEvent): void => {
    const active = edit.current
    if (!active) return
    const to = pointOnImage(event)
    if (!to) return
    const dx = to.x - active.from.x
    const dy = to.y - active.from.y
    const moved =
      active.handle === 'move' ? moveMask(active.rect, dx, dy) : resizeMask(active.rect, active.handle, dx, dy)
    onChange({ masks: masks.map((mask, i) => (i === active.index ? moved : mask)) })
  }

  const endEdit = (): void => {
    edit.current = null
  }

  /** The crop is one rectangle rather than a list, so it edits on its own. */
  const cropEdit = useRef<{ handle: MaskHandle | 'move'; from: { x: number; y: number }; rect: CropRect } | null>(null)

  const startCropEdit = (event: React.PointerEvent, handle: MaskHandle | 'move'): void => {
    const from = pointOnImage(event)
    if (!from || !stack.crop) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    cropEdit.current = { handle, from, rect: stack.crop }
  }

  const onCropEditMove = (event: React.PointerEvent): void => {
    const active = cropEdit.current
    if (!active) return
    const to = pointOnImage(event)
    if (!to) return
    const dx = to.x - active.from.x
    const dy = to.y - active.from.y
    // The same rules a mask moves and resizes by: stay inside the image, and
    // never collapse to nothing. There is no second implementation of them.
    onChange({
      crop:
        active.handle === 'move' ? moveMask(active.rect, dx, dy) : resizeMask(active.rect, active.handle, dx, dy)
    })
  }

  const endCropEdit = (): void => {
    cropEdit.current = null
  }

  const stepImage = (steps: number): void =>
    setIndex((i) => Math.min(Math.max(i + steps, 0), stack.slices.length - 1))

  // The same movement the arrow keys make, on the wheel and the trackpad. The
  // slider is for jumping across a stack, not for looking through one.
  useWheelScrub(stageRef, stepImage)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // Escape lets go of the box before it closes the window, so the key that
      // means "never mind" cannot throw away the review by one press too many.
      if (event.key === 'Escape') {
        if (selected === null) onClose()
        else setChosen(null)
      } else if (event.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0))
      else if (event.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, stack.slices.length - 1))
      else if ((event.key === 'Delete' || event.key === 'Backspace') && selected !== null) {
        onChange({ masks: masks.filter((_, i) => i !== selected) })
        setChosen(null)
      } else return
      event.preventDefault()
    }
    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [onClose, stack.slices.length, selected, masks, onChange])

  const dropped = stack.dropped ?? []
  const droppedHere = dropped.includes(index)
  const outsideTrim = index < stack.trimStart || index > stack.trimEnd
  /**
   * The last image cannot be dropped.
   *
   * A stack with nothing left in it is not uploaded at all, and it would go
   * without saying so — the series would simply not be in the case. Whoever
   * wants that wants the tick box in the picker, which says what it does.
   */
  const lastOne = !droppedHere && keptCount(stack) <= 1

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
              title={
                frame?.compressed
                  ? 'Drag over burnt-in text to blank it out on every image of this series. A compressed image cannot be written into, so blanking one uploads it decoded — a larger file.'
                  : 'Drag over burnt-in text to blank it out on every image of this series'
              }
            >
              Erase
            </button>
            <button
              className={tool === 'crop' ? 'small on' : 'small'}
              onClick={() => setTool('crop')}
              title={
                frame?.compressed
                  ? 'Drag a rectangle to keep; everything outside it comes off every image of this series. A compressed image cannot be cut into, so cropping one uploads it decoded — a larger file.'
                  : 'Drag a rectangle to keep; everything outside it comes off every image of this series'
              }
            >
              Crop
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

        <div
          className={
            tool === 'erase' ? 'viewer-stage erasing' : tool === 'crop' ? 'viewer-stage cropping' : 'viewer-stage'
          }
          ref={stageRef}
        >
          {error ? (
            <div className="placeholder">
              Preview unavailable
              <br />
              {error}
              <br />
              <span className="muted small">
                None of erasing, cropping or contrast can be applied to an image that cannot be decoded.
              </span>
            </div>
          ) : (
            <div className="image-box" style={fitted} ref={imageRef}>
              <canvas
                ref={canvasRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              />
              {/* Only while erasing: in contrast mode the drag belongs to the
                  window, and an outline over every box would be in the way. */}
              {tool === 'erase' && !pending && (
                <div className="mask-layer">
                  {masks.map((mask, i) => (
                    <div
                      key={i}
                      className={i === selected ? 'mask on' : 'mask'}
                      style={{
                        left: `${mask.x * 100}%`,
                        top: `${mask.y * 100}%`,
                        width: `${mask.width * 100}%`,
                        height: `${mask.height * 100}%`
                      }}
                      title="Drag to move, or a corner to resize. Delete removes it."
                      onPointerDown={(e) => startEdit(e, i, 'move')}
                      onPointerMove={onEditMove}
                      onPointerUp={endEdit}
                      onPointerCancel={endEdit}
                    >
                      {HANDLES.map((handle) => (
                        <span
                          key={handle}
                          className={`handle ${handle}`}
                          onPointerDown={(e) => startEdit(e, i, handle)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {/* What the crop throws away is shaded rather than hidden, on
                  every tool: the point of the shade is to be able to see what
                  is about to go, and to notice when it is the wrong thing. */}
              {/* A pointer put down and not moved makes a rectangle of nothing,
                  and shading the whole image for the length of a click reads as
                  a fault. It appears once the drag has some size to it. */}
              {crop && crop.width > 0 && crop.height > 0 && (
                <div className="crop-layer">
                  <div className="crop-shade" style={{ left: 0, top: 0, width: '100%', height: `${crop.y * 100}%` }} />
                  <div
                    className="crop-shade"
                    style={{
                      left: 0,
                      top: `${(crop.y + crop.height) * 100}%`,
                      width: '100%',
                      height: `${(1 - crop.y - crop.height) * 100}%`
                    }}
                  />
                  <div
                    className="crop-shade"
                    style={{
                      left: 0,
                      top: `${crop.y * 100}%`,
                      width: `${crop.x * 100}%`,
                      height: `${crop.height * 100}%`
                    }}
                  />
                  <div
                    className="crop-shade"
                    style={{
                      left: `${(crop.x + crop.width) * 100}%`,
                      top: `${crop.y * 100}%`,
                      width: `${(1 - crop.x - crop.width) * 100}%`,
                      height: `${crop.height * 100}%`
                    }}
                  />
                  <div
                    className={tool === 'crop' && !pendingCrop ? 'crop' : 'crop still'}
                    style={{
                      left: `${crop.x * 100}%`,
                      top: `${crop.y * 100}%`,
                      width: `${crop.width * 100}%`,
                      height: `${crop.height * 100}%`
                    }}
                    title="Drag to move, or a corner to resize"
                    onPointerDown={(e) => startCropEdit(e, 'move')}
                    onPointerMove={onCropEditMove}
                    onPointerUp={endCropEdit}
                    onPointerCancel={endCropEdit}
                  >
                    {tool === 'crop' &&
                      !pendingCrop &&
                      HANDLES.map((handle) => (
                        <span
                          key={handle}
                          className={`handle ${handle}`}
                          onPointerDown={(e) => startCropEdit(e, handle)}
                        />
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {droppedHere ? (
            <div className="dropped-tag">dropped</div>
          ) : (
            outsideTrim && <div className="dropped-tag">not uploaded</div>
          )}
        </div>

        <div className="viewer-controls">
          <div className="viewer-row">
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
            <button
              className={droppedHere ? 'small on' : 'small ghost'}
              disabled={lastOne}
              title={
                lastOne
                  ? 'This is the only image left in the series. Untick the series in the picker to leave it out altogether.'
                  : droppedHere
                    ? 'Put this image back into the upload'
                    : 'Leave this one image out of the upload. The rest of the series is unaffected, and it can be put back.'
              }
              onClick={() => onChange({ dropped: toggleDropped(dropped, index) })}
            >
              {droppedHere ? 'Keep image' : 'Drop image'}
            </button>
            {dropped.length > 0 && (
              <>
                <span className="muted small" style={{ flex: 'none' }}>
                  {dropped.length} dropped
                </span>
                <button className="small ghost" onClick={() => onChange({ dropped: [] })}>
                  Keep all
                </button>
              </>
            )}
          </div>

          <div className="viewer-actions">
            <span className="muted small">
              {tool === 'crop'
                ? crop
                  ? `Keeping ${percent(crop.width)} × ${percent(crop.height)} of every image — drag inside to move it, a corner to resize`
                  : 'Drag the rectangle to keep; everything outside it comes off every image'
                : masks.length === 0
                  ? 'Drag over any burnt-in text to blank it on every image'
                  : `${masks.length} area${masks.length === 1 ? '' : 's'} blanked on every image — drag a box to move it, a corner to resize`}
            </span>
            <div className="spacer" />
            {/* Beside the button that undoes it, rather than on a row of its own. */}
            {greyscale && level && (
              <span className="muted small" style={{ flex: 'none' }}>
                {show(level.centre)} / {show(level.width)}
              </span>
            )}
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
            {stack.crop && (
              <button className="small ghost" onClick={() => onChange({ crop: null })}>
                Keep whole image
              </button>
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
