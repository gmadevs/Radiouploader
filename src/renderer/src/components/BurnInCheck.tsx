import { useEffect, useMemo, useRef, useState } from 'react'
import type { BurnInFinding, CropRect, MaskRect } from '@shared/types'
import type { StackEntry } from '../burnIn'
import { loadFrame, paintFrame, previewErrorText } from '../dicomPreview'
import { type OrderGroup, type OrderStudy, uploadOrder } from '../uploadOrder'

interface Props {
  /** Everything going to upload, so a flagged stack can be shown whether or not it was opened. */
  entries: StackEntry[]
  /** Stacks already opened full size; counted, not listed. */
  seenCount: number
  /** Stacks going to upload that have never been on screen full size. */
  unseen: StackEntry[]
  /** What the pixel check noticed; null while it is still looking. */
  findings: BurnInFinding[] | null
  busy: boolean
  /** Open one from the list; the dialog stays behind the viewer. */
  onOpen: (entry: StackEntry) => void
  /** Put one series where another one is. Both are in the same study. */
  onReorder: (studyId: string, seriesId: string, targetSeriesId: string) => void
  onBack: () => void
  onConfirm: () => void
}

/**
 * Where a region the check noticed lands once the crop has been taken.
 *
 * The check reports in fractions of the uncropped image, because that is the
 * picture it read; the thumbnail below shows the cropped one. Nothing outside
 * the crop is ever reported — the scan is told to skip it — so a ring always
 * has somewhere to go.
 */
function withinCrop(regions: MaskRect[] | undefined, crop: CropRect | null): MaskRect[] | undefined {
  if (!regions || !crop) return regions
  return regions.map((region) => ({
    x: (region.x - crop.x) / crop.width,
    y: (region.y - crop.y) / crop.height,
    width: region.width / crop.width,
    height: region.height / crop.height
  }))
}

/** A middle image of one stack, as it will be uploaded — masked, cropped, windowed. */
function Thumb({
  entry,
  outline,
  maxEdge = 256
}: {
  entry: StackEntry
  outline?: MaskRect[]
  maxEdge?: number
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)
  const { stack } = entry

  useEffect(() => {
    // The middle image, for the same reason the stack card opens there: the
    // ends of a volume are rarely where the banner is legible.
    const slice = stack.slices[Math.floor(stack.slices.length / 2)]
    if (!slice) return

    let cancelled = false
    loadFrame(slice.path, slice.frame, maxEdge)
      .then((frame) => {
        if (cancelled || !canvasRef.current) return
        paintFrame(canvasRef.current, frame, { window: stack.window, masks: stack.masks, crop: stack.crop })
        drawOutline(canvasRef.current, withinCrop(outline, stack.crop))
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(previewErrorText(err))
      })
    return () => {
      cancelled = true
    }
  }, [stack.slices, stack.window, stack.masks, stack.crop, outline, maxEdge])

  return (
    <div className="shot">
      {error ? (
        // Nothing can be checked or erased here inside the app, so say so
        // rather than showing an empty square.
        <div className="placeholder">
          Cannot be shown
          <br />
          {error}
        </div>
      ) : (
        <canvas ref={canvasRef} />
      )}
    </div>
  )
}

/** Ring what the check noticed, on the picture rather than in words about it. */
function drawOutline(canvas: HTMLCanvasElement, outline: MaskRect[] | undefined): void {
  if (!outline?.length) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.strokeStyle = '#e0a44a'
  ctx.lineWidth = Math.max(1, Math.round(canvas.width / 128))
  for (const region of outline) {
    ctx.strokeRect(
      region.x * canvas.width,
      region.y * canvas.height,
      region.width * canvas.width,
      region.height * canvas.height
    )
  }
}

/** What was noticed about one stack, in as few words as it can be put. */
function findingText(finding: BurnInFinding): string {
  if (finding.declared && finding.regions.length === 0) return 'The file says it carries burnt-in annotation'
  const places = finding.regions.length === 1 ? 'one place' : `${finding.regions.length} places`
  const weaker = finding.compared < 2 ? ', from a single image' : ''
  return finding.declared
    ? `The file says it carries annotation, and something looks like text in ${places}`
    : `Looks like text in ${places}${weaker}`
}

/**
 * The order the case will read in, and the last cheap chance to change it.
 *
 * The series are posted one after another and that is the order they appear in
 * on Radiopaedia, so it is a decision whether or not anyone makes it. It is
 * asked here because by here there is already a grid of small pictures to
 * recognise them by, and moving the fourth series to the front is one drag.
 *
 * A tile is a series rather than a stack. A series split into b-values is
 * several uploads that came out of one acquisition, and the tree the rest of
 * the app reads has no way to say that one of them sits somewhere else — so
 * they are boxed together and move together, which the tile says out loud.
 */
function OrderCheck({
  studies,
  onReorder
}: {
  studies: OrderStudy[]
  onReorder: Props['onReorder']
}): React.JSX.Element {
  /**
   * What is being dragged, in a ref rather than in state.
   *
   * A drag is three events that can arrive without a render between them, and a
   * drop that reads the dragged series out of state reads whatever the render
   * it was closed over had — which for a quick drag is nothing at all. The
   * state below is only what the strip has to look like while it happens.
   */
  const dragging = useRef<OrderGroup | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const endDrag = (): void => {
    dragging.current = null
    setDraggingId(null)
    setOver(null)
  }

  return (
    <div className="order-check">
      <p className="small" style={{ margin: 0 }}>
        <strong>Check the order as well.</strong> The series are posted in this order, and it is the order they appear
        in on the case. Drag one to move it, or use the arrows.
      </p>
      {studies.map((study) => (
        <div className="order-study" key={study.studyId}>
          {studies.length > 1 && <div className="muted small">{study.heading}</div>}
          <div className="order-strip">
            {study.groups.map((group, index) => (
              <div
                key={group.seriesId}
                className={`order-group${draggingId === group.seriesId ? ' dragging' : ''}${
                  over === group.seriesId ? ' over' : ''
                }`}
                draggable
                onDragStart={(e) => {
                  dragging.current = group
                  setDraggingId(group.seriesId)
                  e.dataTransfer.effectAllowed = 'move'
                  // A drag carrying nothing does not start in every browser.
                  e.dataTransfer.setData('text/plain', group.seriesId)
                }}
                onDragEnd={endDrag}
                onDragOver={(e) => {
                  const held = dragging.current
                  // A drop stays inside one study: the studies are ordered by
                  // when they were acquired, which is not a matter of taste.
                  if (held === null || held.studyId !== group.studyId) return
                  if (held.seriesId === group.seriesId) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setOver(group.seriesId)
                }}
                onDragLeave={() => setOver((current) => (current === group.seriesId ? null : current))}
                onDrop={(e) => {
                  e.preventDefault()
                  const held = dragging.current
                  if (held !== null && held.studyId === group.studyId) {
                    onReorder(group.studyId, held.seriesId, group.seriesId)
                  }
                  endDrag()
                }}
              >
                <div className="order-shots">
                  {group.entries.map((entry) => (
                    <Thumb key={entry.stack.id} entry={entry} maxEdge={128} />
                  ))}
                </div>
                <div className="order-cap">
                  <span className="n">{index + 1}</span>
                  <span className="name" title={group.name}>
                    {group.name}
                  </span>
                </div>
                <div className="order-foot">
                  {group.entries.length > 1 && (
                    <span className="muted order-note">
                      {group.entries.length} image sets out of this series, moving together
                    </span>
                  )}
                  <span className="reorder">
                    <button
                      className="small ghost"
                      disabled={index === 0}
                      title="Move this series earlier in the case"
                      aria-label={`Move ${group.name} earlier`}
                      onClick={() => onReorder(group.studyId, group.seriesId, study.groups[index - 1].seriesId)}
                    >
                      ←
                    </button>
                    <button
                      className="small ghost"
                      disabled={index === study.groups.length - 1}
                      title="Move this series later in the case"
                      aria-label={`Move ${group.name} later`}
                      onClick={() => onReorder(group.studyId, group.seriesId, study.groups[index + 1].seriesId)}
                    >
                      →
                    </button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * The last stop before anonymisation, which is where a mask stops being an
 * overlay and becomes pixels.
 *
 * Deliberately not a plain "have you checked?" tick box: one of those becomes a
 * reflex by the third import. It lists the selected stacks that have never been
 * opened full size, with a thumbnail each, so the answer costs a look rather
 * than a click — and it never reports the rest as clean, because opening a
 * stack is not the same as having read every frame of it.
 */
export function BurnInCheck({
  entries,
  seenCount,
  unseen,
  findings,
  busy,
  onOpen,
  onReorder,
  onBack,
  onConfirm
}: Props): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  // Read here rather than inside the strip: whether there is an order to check
  // decides whether the dialog has a second column to put it in.
  const order = useMemo(() => uploadOrder(entries), [entries])
  const reorderable = order.some((study) => study.groups.length > 1)

  const total = seenCount + unseen.length
  const noticed = new Map((findings ?? []).map((finding) => [finding.stackId, finding]))
  const flagged = entries.filter((entry) => noticed.has(entry.stack.id))
  // A flagged stack is listed under its finding, opened or not, so it is not
  // shown twice and not hidden by having been opened once.
  const stillUnseen = unseen.filter((entry) => !noticed.has(entry.stack.id))

  return (
    <div className="viewer-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onBack()}>
      <div className="info check" role="dialog" aria-label="Check for burnt-in text">
        <header className="viewer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>Before anonymising</h2>
            <div className="muted small">
              {total} series · {selectionSummary(seenCount, unseen.length)}
            </div>
          </div>
        </header>

        <div className={`info-body check-body${reorderable ? ' split' : ''}`}>
          <div className="check-main">
            <div className="notice warn">
              <strong>Anonymisation does not touch the pixels.</strong> Names, dates and hospital banners burnt into the
              images upload exactly as they are. Only what you blank with <strong>Open for review</strong> is removed.
            </div>

            {findings === null && (
              <p className="muted small" style={{ margin: 0 }}>
                Looking through the images for text…
              </p>
            )}

            {flagged.length > 0 && (
              <>
                <p className="small" style={{ margin: 0, color: 'var(--warn)' }}>
                  {flagged.length === 1 ? 'Something was noticed in one series' : `Something was noticed in ${flagged.length} series`}
                  . Open it and blank anything identifying — the ring is where to look, not the whole of what is there.
                </p>
                <div className="check-grid">
                  {flagged.map((entry) => (
                    <button
                      key={entry.stack.id}
                      className="check-item flagged"
                      title="Open for review — blank out burnt-in text and set the contrast"
                      onClick={() => onOpen(entry)}
                    >
                      <Thumb entry={entry} outline={noticed.get(entry.stack.id)?.regions} />
                      <span className="cap">
                        <span className="name">{entry.label}</span>
                        <span style={{ color: 'var(--warn)' }}>{findingText(noticed.get(entry.stack.id)!)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {stillUnseen.length > 0 ? (
              <>
                <p className="muted small" style={{ margin: 0 }}>
                  {stillUnseen.length === 1
                    ? 'One selected series has not been opened full size yet:'
                    : `${stillUnseen.length} selected series have not been opened full size yet:`}{' '}
                  open anything that could carry text — ultrasound, screen captures, reconstructions.
                </p>
                <div className="check-grid">
                  {stillUnseen.map((entry) => (
                    <button
                      key={entry.stack.id}
                      className="check-item"
                      title="Open for review — blank out burnt-in text and set the contrast"
                      onClick={() => onOpen(entry)}
                    >
                      <Thumb entry={entry} />
                      <span className="cap">
                        <span className="name">{entry.label}</span>
                        {entry.modality ?? '—'} · {entry.stack.slices.length} image
                        {entry.stack.slices.length === 1 ? '' : 's'}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              unseen.length === 0 && (
                <p className="muted small" style={{ margin: 0 }}>
                  Every selected series has been opened full size. That is not the same as having read every image in
                  them — go back if any of these carry text you have not looked for.
                </p>
              )
            )}

            {findings !== null && (
              <p className="muted small" style={{ margin: 0 }}>
                Nothing was noticed in the rest. That check reads two images per series and finds obvious banners; it
                does not find small print, text over anatomy, or anything on the images it did not look at.
              </p>
            )}
          </div>

          {reorderable && (
            <div className="check-side">
              <OrderCheck studies={order} onReorder={onReorder} />
            </div>
          )}
        </div>

        <footer className="info-foot">
          <button onClick={onBack} disabled={busy}>
            Back to the series
          </button>
          <span className="spacer" />
          <button className="primary" onClick={onConfirm} disabled={busy}>
            I have checked — anonymise
          </button>
        </footer>
      </div>
    </div>
  )
}

function selectionSummary(seen: number, unseen: number): string {
  if (unseen === 0) return 'all opened for review'
  if (seen === 0) return 'none opened for review yet'
  return `${unseen} not opened for review`
}
