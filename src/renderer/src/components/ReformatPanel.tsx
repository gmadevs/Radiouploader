import { useEffect, useRef, useState } from 'react'
import type { PreviewFrame, WindowLevel } from '@shared/types'
import { paintFitted, type FitRect } from '../dicomPreview'
import { FITTED, panBy, wheelZoomFactor, zoomAt, type PaneView } from '../paneView'
import { useWheelScrub } from '../wheelScrub'

interface Props {
  label: string
  frame: PreviewFrame | null
  window: WindowLevel | null
  /**
   * Where the other two planes cut this one: the crossing point as fractions of
   * the image, and the angle they run at once the axes have been turned.
   */
  lines?: { u: number; v: number; angle: number }
  /** Moving the crosshair: fractions of the image, from a click or a drag. */
  onPick?: (u: number, v: number) => void
  /** Windowing: the travel of a drag in canvas pixels. */
  onWindow?: (dx: number, dy: number, first: boolean) => void
  /** Turning the axes: how far the arm has swept since the last move, in radians. */
  onRotate?: (radians: number) => void
  /** The wheel over a pane moves the plane that pane shows, as at a workstation. */
  onScroll?: (steps: number) => void
  /** What the pointer does here, since it is not the same in every pane. */
  title?: string
  result?: boolean
}

/**
 * One pane of the reformat view.
 *
 * The canvas is the cell and the image is drawn into it, rather than the canvas
 * being sized to the image: four pictures of four shapes share a grid here, and
 * a coronal of a 5 mm study is a very different shape from its axial. Whatever
 * draws on top and whatever reads a position back have to use the same rectangle
 * the image was drawn into, which is why `paintFitted` hands it back.
 *
 * Each pane zooms and pans on its own, for looking only: what is added to the
 * case is the whole plane whatever is on screen, and a zoom that cropped the
 * result would be a second crop tool with no outline to show it.
 */
export function ReformatPanel({
  label,
  frame,
  window,
  lines,
  onPick,
  onWindow,
  onRotate,
  onScroll,
  title,
  result
}: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitRect | null>(null)
  /** The image as drawn, zoom and pan applied: what a pointer is measured against. */
  const shownRef = useRef<FitRect | null>(null)
  const dragging = useRef(false)
  const [view, setView] = useState<PaneView>(FITTED)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const draw = (): void => {
      if (!frame) return
      const painted = paintFitted(canvas, frame, window, view)
      fitRef.current = painted?.fit ?? null
      shownRef.current = painted?.shown ?? null
      if (!painted || !lines) return
      const { fit, shown } = painted

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.save()
      ctx.beginPath()
      ctx.rect(shown.x, shown.y, shown.width, shown.height)
      ctx.clip()
      ctx.strokeStyle = 'rgba(76, 154, 255, 0.7)'
      ctx.lineWidth = Math.max(1, canvas.width / 400)
      const x = shown.x + lines.u * shown.width
      const y = shown.y + lines.v * shown.height
      // Broken across the middle, so the crosshair does not cover what it points
      // at, and drawn at the angle the axes have been turned to. The gap is the
      // pane's, not the zoomed image's, or zooming in would open a hole in the
      // middle of the screen.
      const gap = Math.min(fit.width, fit.height) * 0.04
      const reach = Math.hypot(shown.width, shown.height) + Math.hypot(canvas.width, canvas.height)
      ctx.beginPath()
      for (const angle of [lines.angle, lines.angle + Math.PI / 2]) {
        const dx = Math.cos(angle)
        const dy = Math.sin(angle)
        ctx.moveTo(x + dx * gap, y + dy * gap)
        ctx.lineTo(x + dx * reach, y + dy * reach)
        ctx.moveTo(x - dx * gap, y - dy * gap)
        ctx.lineTo(x - dx * reach, y - dy * reach)
      }
      ctx.stroke()
      ctx.restore()
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [frame, window, lines, view])

  /** The pointer in canvas pixels, which is what everything here is measured in. */
  const pointAt = (event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const box = canvas.getBoundingClientRect()
    const ratio = canvas.width / box.width
    return { x: (event.clientX - box.left) * ratio, y: (event.clientY - box.top) * ratio }
  }

  const pick = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const shown = shownRef.current
    const at = pointAt(event)
    if (!shown || !at || !onPick) return
    onPick(
      Math.min(Math.max((at.x - shown.x) / shown.width, 0), 1),
      Math.min(Math.max((at.y - shown.y) / shown.height, 0), 1)
    )
  }

  /**
   * Is the pointer on an arm of the crosshair rather than near its middle?
   *
   * The middle moves the planes and the arms turn them, which is how a
   * workstation does it: dragging anywhere else would make it impossible to
   * move the crosshair far without also spinning the axes.
   */
  const onArm = (at: { x: number; y: number }): boolean => {
    const fit = fitRef.current
    const shown = shownRef.current
    if (!fit || !shown || !lines || !onRotate) return false
    const dx = at.x - (shown.x + lines.u * shown.width)
    const dy = at.y - (shown.y + lines.v * shown.height)
    const reach = Math.min(fit.width, fit.height)
    if (Math.hypot(dx, dy) < reach * 0.15) return false
    const grab = Math.max(6, reach * 0.02)
    return [lines.angle, lines.angle + Math.PI / 2].some(
      (angle) => Math.abs(dx * Math.sin(angle) - dy * Math.cos(angle)) < grab
    )
  }

  const angleAt = (at: { x: number; y: number }): number => {
    const shown = shownRef.current
    if (!shown || !lines) return 0
    return Math.atan2(at.y - (shown.y + lines.v * shown.height), at.x - (shown.x + lines.u * shown.width))
  }

  // Cmd or Ctrl with the wheel zooms, and so does a pinch, which arrives as a
  // wheel with ctrlKey set. The plain wheel already moves through the images.
  // On the canvas rather than the pane, so it is heard first and the scrub on
  // the pane never sees it; by hand, because React's wheel handlers are passive.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      event.stopPropagation()
      const fit = fitRef.current
      if (!fit) return
      const box = canvas.getBoundingClientRect()
      const ratio = canvas.width / box.width
      const at = { x: (event.clientX - box.left) * ratio, y: (event.clientY - box.top) * ratio }
      setView((current) => zoomAt(fit, current, at, wheelZoomFactor(event.deltaY, event.deltaMode)))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  /** The last pointer position of a pan, in canvas pixels; null when not panning. */
  const panning = useRef<{ x: number; y: number } | null>(null)
  const turning = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const scroll = useRef(onScroll)
  scroll.current = onScroll
  useWheelScrub(paneRef, (steps) => scroll.current?.(steps))

  return (
    <div className={result ? 'reformat-panel result' : 'reformat-panel'} ref={paneRef} title={title}>
      <canvas
        ref={canvasRef}
        onMouseDown={(event) => {
          // A middle press would otherwise start the platform's autoscroll.
          if (event.button === 1) event.preventDefault()
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          dragging.current = true
          start.current = { x: event.clientX, y: event.clientY }
          const at = pointAt(event)
          // Shift or the middle button pans, leaving the plain drag to the
          // crosshair and the window as before.
          if (at && (event.shiftKey || event.button === 1)) {
            panning.current = at
            turning.current = null
            return
          }
          panning.current = null
          if (at && onRotate && onArm(at)) {
            turning.current = angleAt(at)
            return
          }
          turning.current = null
          if (onPick) pick(event)
          if (onWindow) onWindow(0, 0, true)
        }}
        onPointerMove={(event) => {
          const at = pointAt(event)
          if (!dragging.current) {
            // Say which of the two the pointer would do before it does it.
            if (event.shiftKey) event.currentTarget.style.cursor = 'all-scroll'
            else if (at && onRotate) event.currentTarget.style.cursor = onArm(at) ? 'grab' : 'crosshair'
            else event.currentTarget.style.cursor = ''
            return
          }
          if (panning.current && at) {
            const from = panning.current
            const fit = fitRef.current
            panning.current = at
            if (fit) setView((current) => panBy(fit, current, at.x - from.x, at.y - from.y))
            return
          }
          if (turning.current !== null && at && onRotate) {
            const angle = angleAt(at)
            onRotate(angle - turning.current)
            turning.current = angle
            return
          }
          if (onPick) pick(event)
          if (onWindow && start.current) {
            onWindow(event.clientX - start.current.x, event.clientY - start.current.y, false)
          }
        }}
        onPointerUp={() => {
          dragging.current = false
          turning.current = null
          panning.current = null
        }}
        onPointerCancel={() => {
          dragging.current = false
          turning.current = null
          panning.current = null
        }}
      />
      <span className="tag">
        {label}
        {view.zoom > 1.01 ? ` · ${view.zoom.toFixed(1)}×` : ''}
      </span>
      {view.zoom > 1.01 && (
        <button className="small fit" title="Show the whole image again" onClick={() => setView(FITTED)}>
          Fit
        </button>
      )}
      {!frame && <span className="placeholder">…</span>}
    </div>
  )
}
