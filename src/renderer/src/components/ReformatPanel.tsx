import { useEffect, useRef } from 'react'
import type { PreviewFrame, WindowLevel } from '@shared/types'
import { paintFitted, type FitRect } from '../dicomPreview'
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
  const dragging = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const draw = (): void => {
      if (!frame) return
      const fit = paintFitted(canvas, frame, window)
      fitRef.current = fit
      if (!fit || !lines) return

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.save()
      ctx.beginPath()
      ctx.rect(fit.x, fit.y, fit.width, fit.height)
      ctx.clip()
      ctx.strokeStyle = 'rgba(76, 154, 255, 0.7)'
      ctx.lineWidth = Math.max(1, canvas.width / 400)
      const x = fit.x + lines.u * fit.width
      const y = fit.y + lines.v * fit.height
      // Broken across the middle, so the crosshair does not cover what it points
      // at, and drawn at the angle the axes have been turned to.
      const gap = Math.min(fit.width, fit.height) * 0.04
      const reach = Math.hypot(fit.width, fit.height)
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
  }, [frame, window, lines])

  /** The pointer in canvas pixels, which is what everything here is measured in. */
  const pointAt = (event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const box = canvas.getBoundingClientRect()
    const ratio = canvas.width / box.width
    return { x: (event.clientX - box.left) * ratio, y: (event.clientY - box.top) * ratio }
  }

  const pick = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const fit = fitRef.current
    const at = pointAt(event)
    if (!fit || !at || !onPick) return
    onPick(
      Math.min(Math.max((at.x - fit.x) / fit.width, 0), 1),
      Math.min(Math.max((at.y - fit.y) / fit.height, 0), 1)
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
    if (!fit || !lines || !onRotate) return false
    const dx = at.x - (fit.x + lines.u * fit.width)
    const dy = at.y - (fit.y + lines.v * fit.height)
    const reach = Math.min(fit.width, fit.height)
    if (Math.hypot(dx, dy) < reach * 0.15) return false
    const grab = Math.max(6, reach * 0.02)
    return [lines.angle, lines.angle + Math.PI / 2].some(
      (angle) => Math.abs(dx * Math.sin(angle) - dy * Math.cos(angle)) < grab
    )
  }

  const angleAt = (at: { x: number; y: number }): number => {
    const fit = fitRef.current
    if (!fit || !lines) return 0
    return Math.atan2(at.y - (fit.y + lines.v * fit.height), at.x - (fit.x + lines.u * fit.width))
  }

  const turning = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const scroll = useRef(onScroll)
  scroll.current = onScroll
  useWheelScrub(paneRef, (steps) => scroll.current?.(steps))

  return (
    <div className={result ? 'reformat-panel result' : 'reformat-panel'} ref={paneRef} title={title}>
      <canvas
        ref={canvasRef}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          dragging.current = true
          start.current = { x: event.clientX, y: event.clientY }
          const at = pointAt(event)
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
            if (at && onRotate) event.currentTarget.style.cursor = onArm(at) ? 'grab' : 'crosshair'
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
        }}
        onPointerCancel={() => {
          dragging.current = false
          turning.current = null
        }}
      />
      <span className="tag">{label}</span>
      {!frame && <span className="placeholder">…</span>}
    </div>
  )
}
