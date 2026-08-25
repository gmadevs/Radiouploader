import type { Study } from '@shared/types'
import { AGE_OPTIONS, DIAGNOSTIC_CERTAINTIES, MODALITIES, SYSTEMS } from '@shared/radiopaedia'
import { describeInterval } from '@shared/interval'

export interface StudyForm {
  modality: string
  findings: string
  /** Shown under the study on the case; carries the follow-up interval. */
  caption: string
}

export interface CaseForm {
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
}

export function CaseStep({ form, onChange, studies, warnings }: Props): React.JSX.Element {
  const set = <K extends keyof CaseForm>(key: K, value: CaseForm[K]): void => onChange({ ...form, [key]: value })

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
        <label className="field">
          Case discussion
          <textarea value={form.body} onChange={(e) => set('body', e.target.value)} />
        </label>
      </div>

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
                <span className="badge">{describeInterval(study.intervalDays)}</span>
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
                    placeholder={describeInterval(study.intervalDays)}
                    onChange={(e) => update({ caption: e.target.value })}
                  />
                </label>
              </div>

              <label className="field">
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
