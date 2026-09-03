import type { CaseSummary, Study } from '@shared/types'
import { AGE_OPTIONS, DIAGNOSTIC_CERTAINTIES, MODALITIES, SYSTEMS } from '@shared/radiopaedia'
import { describeInterval } from '@shared/interval'

export interface StudyForm {
  modality: string
  findings: string
  /** Shown under the study on the case; carries the follow-up interval. */
  caption: string
}

export interface CaseForm {
  /**
   * The draft this upload joins, or null for a new case. A case that already
   * exists keeps its own title, age and system: the API has no way to change
   * them, so the fields below are not read when this is set.
   */
  existingCaseId: string | null
  title: string
  presentation: string
  age: string
  gender: '' | 'Male' | 'Female'
  body: string
  /** Radiopaedia system id, e.g. 3 for Central Nervous System. */
  systemId: number | null
  diagnosticCertaintyId: number | null
  /** Keyed by Study.id. */
  studies: Record<string, StudyForm>
}

interface AuthState {
  configured: boolean
  authenticated: boolean
  clientId: string | null
  redirectUri: string | null
}

interface Props {
  form: CaseForm
  onChange: (form: CaseForm) => void
  /** Studies that have at least one stack selected, oldest first. */
  studies: Study[]
  warnings: { tag: string; text: string; level: number; count: number }[]
  /** The account's drafts; null while they are still being read. */
  drafts: CaseSummary[] | null
  /** Why a new case cannot be made, when it cannot. */
  newCaseBlocked: string | null
  /** Ask for the drafts again — one may have been published on the site since. */
  onRefreshDrafts: () => void
}

/** The day a draft was last touched, which is how you tell two alike apart. */
function when(iso: string | null): string {
  if (iso === null) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

export function CaseStep({
  form,
  onChange,
  studies,
  warnings,
  drafts,
  newCaseBlocked,
  onRefreshDrafts
}: Props): React.JSX.Element {
  const set = <K extends keyof CaseForm>(key: K, value: CaseForm[K]): void => onChange({ ...form, [key]: value })
  const joining = form.existingCaseId !== null
  const joined = drafts?.find((draft) => draft.id === form.existingCaseId) ?? null

  return (
    <div style={{ display: 'grid', gap: 20, maxWidth: 780, margin: '0 auto' }}>
      {warnings.length > 0 && (
        <div className="card">
          <h2>Anonymisation warnings</h2>
          <p className="muted small" style={{ marginTop: 4 }}>
            These fields were kept because they carry imaging parameters, but they are free text and could contain
            personal data.
          </p>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            {warnings.slice(0, 8).map((w) => (
              <li key={w.tag}>
                <code>{w.tag}</code> — {w.text} <span style={{ opacity: 0.6 }}>({w.count} images)</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card rows">
        <h2>Where these images go</h2>
        <div className="tools">
          <button
            className={joining ? 'small' : 'small on'}
            disabled={newCaseBlocked !== null}
            title={newCaseBlocked ?? 'Create a new draft case from the form below'}
            onClick={() => set('existingCaseId', null)}
          >
            A new case
          </button>
          <button
            className={joining ? 'small on' : 'small'}
            disabled={drafts !== null && drafts.length === 0}
            title="Add these images to a draft case you already have on Radiopaedia"
            onClick={() => set('existingCaseId', drafts?.[0]?.id ?? null)}
          >
            An existing draft
          </button>
          <div className="spacer" />
          <button className="small ghost" onClick={onRefreshDrafts}>
            Refresh
          </button>
        </div>

        {newCaseBlocked !== null && (
          <p className="small" style={{ margin: 0, color: 'var(--warn)' }}>
            {newCaseBlocked}
          </p>
        )}

        {joining ? (
          <>
            <label className="field">
              Draft case
              <select
                value={form.existingCaseId ?? ''}
                onChange={(e) => set('existingCaseId', e.target.value === '' ? null : e.target.value)}
              >
                {(drafts ?? []).map((draft) => (
                  <option key={draft.id} value={draft.id}>
                    {draft.title ?? `Case ${draft.id}`}
                    {when(draft.updatedAt) === '' ? '' : ` · ${when(draft.updatedAt)}`}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted small" style={{ margin: 0 }}>
              {drafts === null
                ? 'Reading your draft cases…'
                : drafts.length === 0
                  ? 'This account has no draft cases to add to.'
                  : `The studies below are added to ${joined?.title ?? 'this case'} as new studies. Its title, age and the rest stay as they are — the API cannot change them, so edit those on Radiopaedia.`}
            </p>
          </>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            A new draft case is created from the details below, and counts against your draft quota.
          </p>
        )}
      </div>

      {!joining && (
      <div className="card rows">
        <h2>Case</h2>
        <label className="field">
          Title
          <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Acute middle cerebral artery infarct" />
        </label>
        <label className="field">
          Presentation
          <textarea value={form.presentation} onChange={(e) => set('presentation', e.target.value)} />
        </label>
        <div className="row2">
          <label className="field">
            System
            <select
              value={form.systemId ?? ''}
              onChange={(e) => set('systemId', e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">Select a system…</option>
              {SYSTEMS.map((system) => (
                <option key={system.id} value={system.id}>
                  {system.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Diagnostic certainty
            <select
              value={form.diagnosticCertaintyId ?? ''}
              onChange={(e) => set('diagnosticCertaintyId', e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">Not stated</option>
              {DIAGNOSTIC_CERTAINTIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row2">
          <label className="field">
            Age
            <select value={form.age} onChange={(e) => set('age', e.target.value)}>
              <option value="">Not stated</option>
              {AGE_OPTIONS.map((age) => (
                <option key={age} value={age}>
                  {age}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Gender
            <select value={form.gender} onChange={(e) => set('gender', e.target.value as CaseForm['gender'])}>
              <option value="">Not stated</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </label>
        </div>
        {(studies[0]?.patientAge !== null || studies[0]?.patientSex !== null) && (
          <p className="muted small" style={{ margin: '-6px 0 0' }}>
            Age and sex were read from the original files, before anonymisation removed them. The age is the nearest
            value on Radiopaedia's list to the one the files gave.
          </p>
        )}

        <label className="field tall">
          Case discussion
          <textarea value={form.body} onChange={(e) => set('body', e.target.value)} />
        </label>
      </div>
      )}

      <div className="card rows">
        <h2>{studies.length > 1 ? `Studies (${studies.length})` : 'Study'}</h2>

        {studies.length > 1 && (
          <p className="muted small" style={{ margin: 0 }}>
            The study endpoint takes no date, and the real dates are removed during anonymisation anyway. The interval
            between studies goes in each caption instead, pre-filled from the originals — edit it if you prefer
            different wording.
          </p>
        )}

        {studies.map((study, i) => {
          const entry = form.studies[study.id] ?? { modality: 'MRI', findings: '', caption: '' }
          const update = (patch: Partial<StudyForm>): void =>
            onChange({ ...form, studies: { ...form.studies, [study.id]: { ...entry, ...patch } } })

          return (
            <div
              key={study.id}
              style={{
                borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                paddingTop: i === 0 ? 0 : 14,
                display: 'grid',
                gap: 12
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <h3>{study.studyDescription ?? `Study ${i + 1}`}</h3>
                <span className="badge">{describeInterval(study.intervalDays, i === 0)}</span>
                <span className="muted small">position {i + 2}</span>
              </div>

              <div className="row2">
                <label className="field">
                  Modality
                  <select value={entry.modality} onChange={(e) => update({ modality: e.target.value })}>
                    {MODALITIES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Caption (plain text)
                  <input
                    value={entry.caption}
                    placeholder={describeInterval(study.intervalDays, i === 0)}
                    onChange={(e) => update({ caption: e.target.value })}
                  />
                </label>
              </div>

              <label className="field tall">
                Findings
                <textarea value={entry.findings} onChange={(e) => update({ findings: e.target.value })} />
              </label>
            </div>
          )
        })}
      </div>
    </div>
  )
}
