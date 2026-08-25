import type { Series, Stack, Study } from '@shared/types'
import { describeInterval } from '@shared/interval'
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
  onSelectEverything
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

      {studies.map((study) => (
        <section key={study.id} style={{ marginBottom: 28 }}>
          <h2 style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            {study.studyDescription ?? 'Study'}
            <span className="muted small">· {study.modality ?? '—'}</span>
            {/* The real date helps tell two close studies apart while choosing.
                It is removed by anonymisation and never uploaded — only the
                interval is, which is what the badge shows. */}
            {study.studyDate && <span className="muted small">· {study.studyDate}</span>}
            {studies.length > 1 && <span className="badge">{describeInterval(study.intervalDays)}</span>}
          </h2>

          {study.series.map((series) => (
            <div className="series" key={series.id}>
              <div className="series-head">
                <div style={{ flex: 1 }}>
                  <h3>
                    {series.seriesNumber !== null && <span className="muted">{series.seriesNumber}. </span>}
                    {series.description ?? 'Unnamed series'}
                  </h3>
                  <div className="muted small">
                    {series.modality ?? '—'} · {series.instanceCount} images
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
        </section>
      ))}
    </>
  )
}
