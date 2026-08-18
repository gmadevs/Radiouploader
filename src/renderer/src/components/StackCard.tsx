import { useEffect, useRef, useState } from 'react'
import type { Stack } from '@shared/types'
import { renderSlice } from '../dicomPreview'

interface Props {
  stack: Stack
  onToggle: (id: string, selected: boolean) => void
}

/** One stack: a scrubable preview plus the include/exclude control. */
export function StackCard({ stack, onToggle }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Open on the middle slice — the ends of a volume are rarely informative.
  const [index, setIndex] = useState(() => Math.floor(stack.slices.length / 2))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const slice = stack.slices[index]
    if (!canvas || !slice) return

    let cancelled = false
    renderSlice(slice.path, slice.frame, canvas)
      .then(() => {
        if (!cancelled) setError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [stack.slices, index])

  return (
    <div className={stack.selected ? 'stack on' : 'stack'}>
      <div className="stack-preview">
        {error ? <div className="placeholder">Preview unavailable<br />{error}</div> : <canvas ref={canvasRef} />}
        {stack.slices.length > 1 && (
          <input
            type="range"
            min={0}
            max={stack.slices.length - 1}
            value={index}
            aria-label={`Image of ${stack.label}`}
            onChange={(e) => setIndex(Number(e.target.value))}
          />
        )}
      </div>
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
            {stack.slices.length} image{stack.slices.length === 1 ? '' : 's'}
          </div>
        </label>
      </div>
    </div>
  )
}
