import type { Series, Study } from '@shared/types'
import { StackCard } from './StackCard'

interface Props {
  studies: Study[]
  failures: { path: string; reason: string }[]
  onToggle: (id: string, selected: boolean) => void
  onKeepOnePhase: (series: Series) => void
  onSelectAll: (series: Series, selected: boolean) => void
}

/**
 * Position of a study on the case timeline. The absolute date is deliberately not
 * shown — it is removed by anonymisation and never uploaded; only the interval is.
 */
function describeInterval(days: number | null): string {
  if (days === null) return 'date unknown'
  if (days === 0) return 'baseline'
  if (days < 31) return `${days} day${days === 1 ? '' : 's'} later`
  if (days < 365) return `${Math.round(days / 30.44)} months later`
  const years = days / 365.25
  return `${years.toFixed(years < 10 ? 1 : 0)} years later`
}

const SPLIT_LABELS: Record<string, string> = {
  component: 'Split by image type',
  diffusion: 'Split by b-value',
  echo: 'Split by echo',
  phase: 'Split by phase'
}

export function ReviewStep({ studies, failures, onToggle, onKeepOnePhase, onSelectAll }: Props): React.JSX.Element {
  return (
    <>
      <h1>Choose what to upload</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Series that contain more than one acquisition have been split apart. Check the images before you continue —
        anonymisation cannot remove identifying text burnt into the pixels.
      </p>

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
                  <StackCard key={stack.id} stack={stack} onToggle={onToggle} />
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
    </>
  )
}
