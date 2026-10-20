import { useEffect, useRef, useState } from 'react'
import type { PreviewFrame, Stack } from '@shared/types'
import { isKept, keptCount } from '@shared/selection'
import { loadFrame, paintFrame, previewErrorText } from '../dicomPreview'
import { averageOptions, countLevel, countWarning, stepOptions, suggestedOption } from '../imageCount'
import { extentOf, formatSize, millimetres, perImage } from '../stackDetail'
import { useWheelScrub } from '../wheelScrub'

interface Props {
  stack: Stack
  onToggle: (id: string, selected: boolean) => void
  onTrim: (id: string, trimStart: number, trimEnd: number) => void
  /** Keep one image in this many. */
  onEvery: (id: string, every: number) => void
  /** Add a copy of the stack with each run of `slices` images averaged into one. */
  onAverage: (slices: number) => Promise<void>
  /** Open the full-size viewer, where text can be blanked and contrast set. */
  onOpen: (stack: Stack) => void
  /** Cut this stack another way, if there is enough of it to cut. */
  onReformat: (stack: Stack) => void
  onAnnotate: (stack: Stack) => void
}

/** One stack: a scrubable preview, the trim range, and the include control. */
export function StackCard({
  stack,
  onToggle,
  onTrim,
  onEvery,
  onAverage,
  onOpen,
  onReformat,
  onAnnotate
}: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const [frame, setFrame] = useState<PreviewFrame | null>(null)
  // Open on the middle image — the ends of a volume are rarely informative.
  const [index, setIndex] = useState(() => Math.floor(stack.slices.length / 2))
  const [error, setError] = useState<string | null>(null)
  // Trimming is the exception, so the controls stay out of the way until asked for.
  const [showTrim, setShowTrim] = useState(false)
  const [averageChoice, setAverageChoice] = useState<number | null>(null)
  const [averaging, setAveraging] = useState(false)
  const [averageError, setAverageError] = useState<string | null>(null)

  const last = stack.slices.length - 1
  const kept = keptCount(stack)
  const trimmed = stack.trimStart > 0 || stack.trimEnd < last
  const every = stack.every ?? 1
  const level = countLevel(kept)
  const warning = countWarning(kept)
  const steps = stepOptions(stack)
  // Colour is refused by the main process too; offering it here would be a
  // button that can only fail.
  const averages = frame?.kind === 'colour' || !stack.sharedPlane ? [] : averageOptions(stack)
  const average = averages.find((option) => option.slices === averageChoice) ?? suggestedOption(averages)
  // Only the ones inside the trim: an image dropped and then trimmed away as
  // well is one image missing from the upload, not two.
  const droppedInside = (stack.dropped ?? []).filter((i) => i >= stack.trimStart && i <= stack.trimEnd).length

  // What the stack is, rather than what has been done to it: the plane it was
  // cut on and how far it runs. Absent on anything that does not say where its
  // images sit, which is most cine runs.
  const extent = extentOf(stack.slices)
  const geometry = [stack.plane, extent && `${millimetres(extent.span)} / ${millimetres(extent.spacing)} mm`]
    .filter(Boolean)
    .join(' · ')

  useEffect(() => {
    const slice = stack.slices[index]
    if (!slice) return

    let cancelled = false
    loadFrame(slice.path, slice.frame)
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

  // The card shows the stack as it will be uploaded: masked, cropped, windowed.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !frame) return
    paintFrame(canvas, frame, { window: stack.window, masks: stack.masks, crop: stack.crop })
  }, [frame, stack.window, stack.masks, stack.crop])

  /** Moving a trim handle jumps the preview there, so the cut is visible. */
  const setStart = (value: number): void => {
    const start = Math.min(value, stack.trimEnd)
    onTrim(stack.id, start, stack.trimEnd)
    setIndex(start)
  }
  const setEnd = (value: number): void => {
    const end = Math.max(value, stack.trimStart)
    onTrim(stack.id, stack.trimStart, end)
    setIndex(end)
  }

  const outsideTrim = !isKept(stack, index)
  const maskCount = stack.masks?.length ?? 0

  // Scrolling over a card looks through the stack; the page keeps still while
  // the pointer is on one, which is the only way this is useful in a grid.
  useWheelScrub(previewRef, (steps) => setIndex((i) => Math.min(Math.max(i + steps, 0), last)))

  return (
    <div className={stack.unsupported ? 'stack blocked' : stack.selected ? 'stack on' : 'stack'}>
      <div className="stack-preview" ref={previewRef}>
        {error ? (
          <div className="placeholder">
            Preview unavailable
            <br />
            {error}
          </div>
        ) : (
          <canvas ref={canvasRef} className={outsideTrim ? 'dropped' : undefined} />
        )}
        {outsideTrim && <div className="dropped-tag">not uploaded</div>}
        {stack.slices.length > 1 && (
          <input
            type="range"
            min={0}
            max={last}
            value={index}
            aria-label={`Image of ${stack.label}`}
            onChange={(e) => setIndex(Number(e.target.value))}
          />
        )}
      </div>

      {showTrim && (
        <div className="trim">
          <label>
            <span>First</span>
            <input
              type="range"
              min={0}
              max={last}
              value={stack.trimStart}
              aria-label={`First image of ${stack.label}`}
              onChange={(e) => setStart(Number(e.target.value))}
            />
            <span className="n">{stack.trimStart + 1}</span>
          </label>
          <label>
            <span>Last</span>
            <input
              type="range"
              min={0}
              max={last}
              value={stack.trimEnd}
              aria-label={`Last image of ${stack.label}`}
              onChange={(e) => setEnd(Number(e.target.value))}
            />
            <span className="n">{stack.trimEnd + 1}</span>
          </label>
          <label title="Keep one image in every few, across the whole trim">
            <span>Keep</span>
            <select
              value={every}
              aria-label={`Images of ${stack.label} to keep`}
              onChange={(e) => onEvery(stack.id, Number(e.target.value))}
            >
              {steps.map((option) => (
                <option key={option.every} value={option.every}>
                  {option.every === 1 ? `All ${option.count} images` : `1 in ${option.every}, ${option.count} images`}
                </option>
              ))}
            </select>
          </label>
          {average && (
            <label title="Add a copy of this stack with neighbouring images averaged into thicker slices. The copy replaces this stack in the upload.">
              <span>Average</span>
              <select
                value={average.slices}
                disabled={averaging}
                aria-label={`Thickness to average ${stack.label} to`}
                onChange={(e) => setAverageChoice(Number(e.target.value))}
              >
                {averages.map((option) => (
                  <option key={option.slices} value={option.slices}>
                    {millimetres(option.thickness)} mm, {option.count} images
                  </option>
                ))}
              </select>
              <button
                className="small"
                disabled={averaging}
                onClick={() => {
                  setAveraging(true)
                  setAverageError(null)
                  onAverage(average.slices)
                    .catch((err: unknown) => setAverageError(previewErrorText(err)))
                    .finally(() => setAveraging(false))
                }}
              >
                {averaging ? 'Adding…' : 'Add'}
              </button>
            </label>
          )}
          {averageError && <div className="trim-error">{averageError}</div>}
          <div style={{ display: 'flex', gap: 6 }}>
            {(trimmed || every > 1) && (
              <button
                className="small ghost"
                onClick={() => {
                  onTrim(stack.id, 0, last)
                  onEvery(stack.id, 1)
                }}
              >
                Reset
              </button>
            )}
            <button className="small ghost" onClick={() => setShowTrim(false)}>
              Done
            </button>
          </div>
        </div>
      )}

      <div className="stack-meta">
        <input
          type="checkbox"
          id={stack.id}
          checked={stack.selected}
          disabled={stack.unsupported !== null}
          onChange={(e) => onToggle(stack.id, e.target.checked)}
        />
        <label htmlFor={stack.id}>
          <h3>{stack.label}</h3>
          <div className="stack-facts">
            {kept < stack.slices.length ? (
              <>
                <span className={`count ${level}`}>{kept}</span> of {stack.slices.length} images
                {trimmed && <> · {stack.trimStart + 1}–{stack.trimEnd + 1}</>}
                {droppedInside > 0 && <> · {droppedInside} dropped</>}
                {every > 1 && <> · 1 in {every}</>}
              </>
            ) : (
              <>
                <span className={`count ${level}`}>
                  {stack.slices.length} image{stack.slices.length === 1 ? '' : 's'}
                </span>
              </>
            )}
            {maskCount > 0 && <> · {maskCount} blanked</>}
            {stack.window && <> · contrast set</>}
          </div>
          {geometry !== '' && <div className="stack-detail">{geometry}</div>}
          <div className="stack-detail">
            {formatSize(stack.bytes)} · {perImage(stack.bytes, stack.slices.length)} each
          </div>
          {/* Only when there is something to say. Plain samples are what most
              exports are, and a badge on every card would cost a line to tell
              you nothing; a codec named here is the series that will grow if
              you blank or crop it. */}
          {stack.compression !== null && <div className="stack-detail codec">{stack.compression}</div>}
        </label>
        {stack.slices.length > 2 && !showTrim && !stack.unsupported && (
          <button
            className={kept < stack.slices.length ? 'small trim-toggle on' : 'small trim-toggle'}
            title="Choose the first and last image to upload"
            onClick={() => setShowTrim(true)}
          >
            Trim
          </button>
        )}
      </div>

      {/* Only on a stack that is going up: a long series left unticked is
          already the reduction. */}
      {warning && stack.selected && (
        <div className={`count-warning ${level}`}>
          <span>{warning}</span>
          {!showTrim && stack.slices.length > 2 && !stack.unsupported && (
            <button
              className="small"
              title="Keep one image in every few, average them into thicker slices, or trim the ends"
              onClick={() => setShowTrim(true)}
            >
              Reduce
            </button>
          )}
        </div>
      )}

      {/* The two things this screen asks of everyone, spelled out on the card
          rather than waiting under the pointer: the check before anonymising
          names Open for review by name, and a button nobody can see is one
          nobody is doing. Withheld only when the preview failed, since there
          is nothing to open. */}
      {!error && (
        <div className="stack-actions">
          <button
            className="small"
            title="Open to check the images, blank out burnt-in text, crop and set the contrast"
            onClick={() => onOpen(stack)}
          >
            Open for review
          </button>
          {stack.slices.length > 2 && !stack.unsupported && (
            <button
              className="small"
              title="Make images of this series in another plane, or MIP, MinIP or mean images of thick slabs"
              onClick={() => onReformat(stack)}
            >
              Reformat
            </button>
          )}
          {!stack.unsupported && (
            <button
              className="small"
              title="Draw coloured structures on the images and add a copy with them to the case"
              onClick={() => onAnnotate(stack)}
            >
              Annotate
            </button>
          )}
        </div>
      )}

      {/* Says what the failed preview above does not: this one is not merely
          unviewable here, it cannot go to Radiopaedia at all. */}
      {stack.unsupported && <div className="stack-blocked">{stack.unsupported}</div>}
    </div>
  )
}
