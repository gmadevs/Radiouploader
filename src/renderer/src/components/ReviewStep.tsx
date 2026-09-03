import type { Series, Stack, Study } from '@shared/types'
import { clockTime, describeInterval } from '@shared/interval'
import { StackCard } from './StackCard'

interface Props {
  studies: Study[]
  failures: { path: string; reason: string }[]
  onToggle: (id: string, selected: boolean) => void
  onTrim: (id: string, trimStart: number, trimEnd: number) => void
  onKeepOnePhase: (series: Series) => void
  /** Open one stack full size, to blank burnt-in text or set the contrast. */
  onOpen: (stack: Stack, series: Series, study: Study) => void
  /** Open the reformat dialog on one stack. */
  onReformat: (stack: Stack, series: Series, study: Study) => void
  onSelectAll: (series: Series, selected: boolean) => void
  /** Select or clear every stack in the import at once. */
  onSelectEverything: (selected: boolean) => void
  /** Move one series past its neighbour, which is what reorders the case. */
  onMoveSeries: (studyId: string, seriesId: string, delta: number) => void
  /** Move one study past a neighbour it shares a date with. */
  onMoveStudy: (studyId: string, delta: number) => void
}

/**
 * A card and the gap after it, and the padding the row of them sits in.
 *
 * A series group is made as wide as its cards rather than left to the layout:
 * its heading can be a paragraph of description, and left to itself it would
 * stretch the group past the cards and leave a single one adrift in it. The
 * heading is truncated to this instead.
 */
const CARD_WIDTH = 240
const CARD_GAP = 12
const ROW_PADDING = 32

/**
 * Is another study in this import on the same date?
 *
 * Two of one day are nought days apart whichever way round they go, so the date
 * says nothing about which came first and the clock is what does.
 */
function sharesItsDate(studies: Study[], study: Study): boolean {
  return study.studyDate !== null && studies.filter((other) => other.studyDate === study.studyDate).length > 1
}

/** Were these two taken the same day? Undefined at the ends of the list, and undated is not a match. */
function sameDate(a: Study | undefined, b: Study): boolean {
  return a !== undefined && a.studyDate !== null && a.studyDate === b.studyDate
}

const SPLIT_LABELS: Record<string, string> = {
  component: 'Split by image type',
  diffusion: 'Split by b-value',
  echo: 'Split by echo',
  phase: 'Split by phase'
}

export function ReviewStep({
  studies,
  failures,
  onToggle,
  onTrim,
  onKeepOnePhase,
  onOpen,
  onReformat,
  onSelectAll,
  onSelectEverything,
  onMoveSeries,
  onMoveStudy
}: Props): React.JSX.Element {
  const stacks = studies.flatMap((study) => study.series.flatMap((series) => series.stacks))
  const selectedCount = stacks.filter((stack) => stack.selected).length
  const blockedCount = stacks.filter((stack) => stack.unsupported !== null).length
  // One button that does the useful thing: with a big export the first move is
  // to clear everything and tick back the few series that matter.
  const clearing = selectedCount > 0

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h1>Choose what to upload</h1>
          <p className="muted" style={{ marginTop: 0 }}>
            Series that contain more than one acquisition have been split apart. Check the images before you continue —
            anonymisation cannot remove identifying text burnt into the pixels — open a series to blank it out.
          </p>
        </div>
        <div style={{ flex: 'none', textAlign: 'right', display: 'grid', gap: 6, justifyItems: 'end' }}>
          <button onClick={() => onSelectEverything(!clearing)}>
            {clearing ? 'Deselect all' : 'Select all'}
          </button>
          <span className="muted small">
            {selectedCount} of {stacks.length} selected
          </span>
          {blockedCount > 0 && (
            <span className="small" style={{ color: 'var(--warn)' }}>
              {blockedCount} cannot be uploaded
            </span>
          )}
        </div>
      </div>

      {failures.length > 0 && (
        <div className="notice warn" style={{ marginBottom: 16 }}>
          {failures.length} file{failures.length === 1 ? '' : 's'} could not be read and {failures.length === 1 ? 'was' : 'were'} skipped.
        </div>
      )}

      {studies.map((study, studyIndex) => (
        <section key={study.id} style={{ marginBottom: 28 }}>
          <h2 style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            {study.studyDescription ?? 'Study'}
            <span className="muted small">· {study.modality ?? '—'}</span>
            {/* The real date helps tell two close studies apart while choosing.
                It is removed by anonymisation and never uploaded — only the
                interval is, which is what the badge shows. */}
            {study.studyDate && (
              <span className="muted small">
                · {study.studyDate}
                {sharesItsDate(studies, study) && clockTime(study.studyTime) !== null
                  ? ` ${clockTime(study.studyTime)}`
                  : ''}
              </span>
            )}
            {studies.length > 1 && (
              <span className="badge">{describeInterval(study.intervalDays, studyIndex === 0)}</span>
            )}
            {/* Only between studies of one day. Across days the order is the
                timeline the case is read as, not a matter of taste. */}
            {(sameDate(studies[studyIndex - 1], study) || sameDate(studies[studyIndex + 1], study)) && (
              <span className="reorder">
                <button
                  className="small ghost"
                  disabled={!sameDate(studies[studyIndex - 1], study)}
                  title="Move this study earlier in the case"
                  aria-label={`Move ${study.studyDescription ?? 'this study'} earlier`}
                  onClick={() => onMoveStudy(study.id, -1)}
                >
                  ←
                </button>
                <button
                  className="small ghost"
                  disabled={!sameDate(studies[studyIndex + 1], study)}
                  title="Move this study later in the case"
                  aria-label={`Move ${study.studyDescription ?? 'this study'} later`}
                  onClick={() => onMoveStudy(study.id, 1)}
                >
                  →
                </button>
              </span>
            )}
          </h2>

          {/* One strip per study, scrolling sideways: a study of thirty series
              is a row to run along rather than a page to scroll down, and the
              series stay side by side where they can be compared. */}
          <div className="study-strip">
            {study.series.map((series, index) => (
              <div className="series" key={series.id}>
                <div
                  className="series-head"
                  style={{ maxWidth: series.stacks.length * (CARD_WIDTH + CARD_GAP) - CARD_GAP + ROW_PADDING }}
                >
                  <div style={{ flex: 1 }}>
                    <h3>
                      {series.seriesNumber !== null && <span className="muted">{series.seriesNumber}. </span>}
                      {series.description ?? 'Unnamed series'}
                    </h3>
                    <div className="muted small">
                      {series.modality ?? '—'} · {series.instanceCount} image
                      {series.instanceCount === 1 ? '' : 's'}
                    </div>
                  </div>
                  {series.splitReason && (
                    <span className="badge split">{SPLIT_LABELS[series.splitReason] ?? 'Split'}</span>
                  )}
                  {series.splitReason === 'phase' && (
                    <button className="small ghost" onClick={() => onKeepOnePhase(series)}>
                      Keep one phase
                    </button>
                  )}
                  {series.stacks.length > 1 && (
                    <>
                      <button className="small ghost" onClick={() => onSelectAll(series, true)}>
                        All
                      </button>
                      <button className="small ghost" onClick={() => onSelectAll(series, false)}>
                        None
                      </button>
                    </>
                  )}
                  {/* The order of these strips is the order the case gets: the
                      series endpoint has no position of its own, so what the
                      app posts first is what appears first. */}
                  {study.series.length > 1 && (
                    <span className="reorder">
                      <button
                        className="small ghost"
                        disabled={index === 0}
                        title="Move this series earlier in the case"
                        aria-label={`Move ${series.description ?? 'this series'} earlier`}
                        onClick={() => onMoveSeries(study.id, series.id, -1)}
                      >
                        ←
                      </button>
                      <button
                        className="small ghost"
                        disabled={index === study.series.length - 1}
                        title="Move this series later in the case"
                        aria-label={`Move ${series.description ?? 'this series'} later`}
                        onClick={() => onMoveSeries(study.id, series.id, 1)}
                      >
                        →
                      </button>
                    </span>
                  )}
                </div>
                <div className="stacks">
                  {series.stacks.map((stack) => (
                    <StackCard
                      key={stack.id}
                      stack={stack}
                      onToggle={onToggle}
                      onTrim={onTrim}
                      onOpen={() => onOpen(stack, series, study)}
                      onReformat={() => onReformat(stack, series, study)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}
