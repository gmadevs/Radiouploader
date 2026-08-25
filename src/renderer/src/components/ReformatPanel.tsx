import { useEffect, useRef } from 'react'
import type { PreviewFrame, WindowLevel } from '@shared/types'
import { paintFitted, type FitRect } from '../dicomPreview'
import { useWheelScrub } from '../wheelScrub'

interface Props {
  label: string
  frame: PreviewFrame | null
  window: WindowLevel | null
  /** Where the other two planes cut this one, as fractions of the image. */
  lines?: { u: number; v: number }
  /** Moving the crosshair: fractions of the image, from a click or a drag. */
  onPick?: (u: number, v: number) => void
  /** Windowing: the travel of a drag in canvas pixels. */
  onWindow?: (dx: number, dy: number, first: boolean) => void
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
      ctx.strokeStyle = 'rgba(76, 154, 255, 0.7)'
      ctx.lineWidth = Math.max(1, canvas.width / 400)
      const x = fit.x + lines.u * fit.width
      const y = fit.y + lines.v * fit.height
      // Broken across the middle, so the crosshair does not cover what it points at.
      const gap = Math.min(fit.width, fit.height) * 0.04
      ctx.beginPath()
      ctx.moveTo(x, fit.y)
      ctx.lineTo(x, y - gap)
      ctx.moveTo(x, y + gap)
      ctx.lineTo(x, fit.y + fit.height)
      ctx.moveTo(fit.x, y)
      ctx.lineTo(x - gap, y)
      ctx.moveTo(x + gap, y)
      ctx.lineTo(fit.x + fit.width, y)
      ctx.stroke()
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [frame, window, lines])

  const pick = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const fit = fitRef.current
    const canvas = canvasRef.current
    if (!fit || !canvas || !onPick) return
    const box = canvas.getBoundingClientRect()
    const ratio = canvas.width / box.width
    const x = (event.clientX - box.left) * ratio
    const y = (event.clientY - box.top) * ratio
    onPick(
      Math.min(Math.max((x - fit.x) / fit.width, 0), 1),
      Math.min(Math.max((y - fit.y) / fit.height, 0), 1)
    )
  }

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
          if (onPick) pick(event)
          if (onWindow) onWindow(0, 0, true)
        }}
        onPointerMove={(event) => {
          if (!dragging.current) return
          if (onPick) pick(event)
          if (onWindow && start.current) {
            onWindow(event.clientX - start.current.x, event.clientY - start.current.y, false)
          }
        }}
        onPointerUp={() => {
          dragging.current = false
        }}
        onPointerCancel={() => {
          dragging.current = false
        }}
      />
      <span className="tag">{label}</span>
      {!frame && <span className="placeholder">…</span>}
    </div>
  )
}
