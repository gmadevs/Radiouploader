import { useEffect, useMemo, useState } from 'react'
import type { AppInfo, IngestResult, Progress, Series, Stack } from '@shared/types'
import { AccountBar } from './components/AccountBar'
import { quotaExhausted, type AccountState } from './quota'
import { describeInterval } from '@shared/interval'
import { modalityFromDicom } from '@shared/radiopaedia'
import { CaseStep, type CaseForm } from './components/CaseStep'
import { InfoDialog } from './components/InfoDialog'
import { ReviewStep } from './components/ReviewStep'
import { SeriesViewer } from './components/SeriesViewer'
import { SourceStep } from './components/SourceStep'

type Step = 'source' | 'review' | 'case' | 'done'

const STEPS: { key: Step; label: string }[] = [
  { key: 'source', label: 'Source' },
  { key: 'review', label: 'Series' },
  { key: 'case', label: 'Case details' },
  { key: 'done', label: 'Upload' }
]

const EMPTY_FORM: CaseForm = {
  title: '',
  presentation: '',
  age: '',
  gender: '',
  body: '',
  systemId: null,
  diagnosticCertaintyId: null,
  studies: {}
}

export function App(): React.JSX.Element {
  const [step, setStep] = useState<Step>('source')
  const [ingest, setIngest] = useState<IngestResult | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<CaseForm>(EMPTY_FORM)
  const [warnings, setWarnings] = useState<{ tag: string; text: string; level: number; count: number }[]>([])
  const [result, setResult] = useState<{ caseId: string; url: string } | null>(null)
  const [account, setAccount] = useState<AccountState>({ authenticated: false, username: null, quota: null })
  /** The stack open in the viewer, by id so it follows the edits made to it. */
  const [viewing, setViewing] = useState<{ stackId: string; heading: string } | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [showInfo, setShowInfo] = useState(false)

  /**
   * Reasons the account cannot take a case right now. Checked before importing
   * so a full quota surfaces before any work is done, not after anonymising.
   */
  const blocked = !account.authenticated
    ? { reason: 'Sign in to Radiopaedia before importing a study.' }
    : quotaExhausted(account.quota)
      ? {
          reason: `Your draft quota is full (${account.quota!.draftCaseCount} of ${account.quota!.allowedDraftCases}). Publish or delete a draft case on Radiopaedia before uploading another.`
        }
      : null

  useEffect(() => window.api.onProgress(setProgress), [])
  useEffect(() => {
    void window.api.appInfo().then(setInfo).catch(() => setInfo(null))
  }, [])

  const selectedStacks = useMemo(
    () =>
      (ingest?.studies ?? []).flatMap((study) =>
        study.series.flatMap((series) => series.stacks.filter((stack) => stack.selected))
      ),
    [ingest]
  )
  const selectedImageCount = selectedStacks.reduce(
    (n, stack) => n + (stack.trimEnd - stack.trimStart + 1),
    0
  )

  const viewedStack = useMemo(
    () =>
      (ingest?.studies ?? [])
        .flatMap((study) => study.series.flatMap((series) => series.stacks))
        .find((stack) => stack.id === viewing?.stackId) ?? null,
    [ingest, viewing]
  )

  /** Studies with at least one selected stack, already oldest first from ingest. */
  const studiesToUpload = useMemo(
    () =>
      (ingest?.studies ?? []).filter((study) =>
        study.series.some((series) => series.stacks.some((stack) => stack.selected))
      ),
    [ingest]
  )

  /** Rebuild the tree, applying `change` to each stack; null leaves it alone. */
  const mutateStacks = (change: (stack: Stack, series: Series) => Partial<Stack> | null): void => {
    setIngest((current) => {
      if (!current) return current
      return {
        ...current,
        studies: current.studies.map((study) => ({
          ...study,
          series: study.series.map((series) => ({
            ...series,
            stacks: series.stacks.map((stack) => {
              const patch = change(stack, series)
              return patch === null ? stack : { ...stack, ...patch }
            })
          }))
        }))
      }
    })
  }

  const runIngest = async (paths: string[]): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await window.api.ingest(paths)
      if (res.studies.length === 0) {
        setError(`No readable DICOM files found (scanned ${res.scannedFileCount} files).`)
        return
      }
      setIngest(res)
      setStep('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const anonymiseAndContinue = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await window.api.setSelection(
        selectedStacks.map((s) => ({
          id: s.id,
          trimStart: s.trimStart,
          trimEnd: s.trimEnd,
          masks: s.masks ?? [],
          window: s.window ?? null
        }))
      )
      const res = await window.api.anonymise()
      setWarnings(res.summary)
      if (res.errors.length > 0) {
        setError(`${res.errors.length} file(s) could not be anonymised and will not be uploaded.`)
      }

      // Seed one form per study, keeping anything already typed. Captions are
      // pre-filled with the interval read from the originals.
      const multiple = studiesToUpload.length > 1
      setForm((current) => ({
        ...current,
        studies: Object.fromEntries(
          studiesToUpload.map((study) => [
            study.id,
            current.studies[study.id] ?? {
              modality: modalityFromDicom(study.modality),
              findings: '',
              caption: multiple ? describeInterval(study.intervalDays) : ''
            }
          ])
        )
      }))
      setStep('case')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const upload = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await window.api.upload({
        caseDraft: {
          title: form.title,
          presentation: form.presentation,
          systemId: form.systemId,
          diagnosticCertaintyId: form.diagnosticCertaintyId,
          age: form.age || null,
          gender: form.gender || null,
          body: form.body || null
        },
        studies: studiesToUpload.map((study) => ({
          studyId: study.id,
          modality: form.studies[study.id]?.modality ?? 'MRI',
          findings: form.studies[study.id]?.findings ?? '',
          caption: form.studies[study.id]?.caption ?? '',
          stackIds: study.series.flatMap((series) =>
            series.stacks.filter((stack) => stack.selected).map((stack) => stack.id)
          )
        }))
      })
      setResult(res)
      setStep('done')
      // The upload consumed a draft slot; reflect that in the header.
      void window.api
        .currentUser()
        .then((user) => setAccount({ authenticated: true, username: user.username, quota: user.quota }))
        .catch(() => {})
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const startOver = (): void => {
    void window.api.resetIngest()
    setViewing(null)
    setIngest(null)
    setResult(null)
    setWarnings([])
    setForm(EMPTY_FORM)
    setError(null)
    setStep('source')
  }

  const currentIndex = STEPS.findIndex((s) => s.key === step)

  return (
    <div className="app">
      <div className="titlebar" />

      <nav className="steps">
        {STEPS.map((s, i) => (
          <div key={s.key} className={`step ${s.key === step ? 'active' : ''} ${i < currentIndex ? 'done' : ''}`}>
            <span className="n">{i < currentIndex ? '✓' : i + 1}</span>
            {s.label}
          </div>
        ))}
        <AccountBar account={account} onChange={setAccount} />
        <button className="small ghost" title="About, and how to report a problem" onClick={() => setShowInfo(true)}>
          Info
        </button>
      </nav>

      <main className={step === 'source' || step === 'done' ? 'content centred' : 'content'}>
        {step === 'source' && (
          <SourceStep
            busy={busy}
            blocked={blocked}
            onPick={(kind) => {
              void window.api.pickSource(kind).then((paths) => {
                if (paths && paths.length > 0) void runIngest(paths)
              })
            }}
            onDropPaths={(paths) => void runIngest(paths)}
            info={info}
          />
        )}

        {step === 'review' && ingest && (
          <ReviewStep
            studies={ingest.studies}
            failures={ingest.failures}
            onToggle={(id, selected) => mutateStacks((stack) => (stack.id === id ? { selected } : null))}
            onTrim={(id, trimStart, trimEnd) =>
              mutateStacks((stack) => (stack.id === id ? { trimStart, trimEnd } : null))
            }
            onSelectAll={(series, selected) =>
              mutateStacks((_stack, s) => (s.id === series.id ? { selected } : null))
            }
            onSelectEverything={(selected) => mutateStacks(() => ({ selected }))}
            onOpen={(stack, series, study) =>
              setViewing({
                stackId: stack.id,
                heading: `${study.studyDescription ?? 'Study'} · ${series.description ?? 'Unnamed series'}`
              })
            }
            onKeepOnePhase={(series) => {
              // Keep the earliest phase and drop the rest; the user can re-tick any.
              const first = series.stacks.find((s) => s.selected)?.id ?? series.stacks[0]?.id
              mutateStacks((stack, s) => (s.id === series.id ? { selected: stack.id === first } : null))
            }}
          />
        )}

        {step === 'case' && (
          <CaseStep form={form} onChange={setForm} studies={studiesToUpload} warnings={warnings} />
        )}

        {step === 'done' && result && (
          <div className="card" style={{ textAlign: 'center', maxWidth: 480 }}>
            <h1>Case uploaded</h1>
            <p className="muted">
              The case was created as a draft. Open it on Radiopaedia to review the images and publish it.
            </p>
            {/* system_id is sent exactly as documented and accepted, but never
                applied — diagnostic_certainty_id in the same request is. Tried
                as JSON, as a form body and as a query parameter, all identical. */}
            <div className="notice warn" style={{ textAlign: 'left', marginTop: 14 }}>
              <strong>Set the System on the case.</strong> Radiopaedia's API accepts <code>system_id</code> but does
              not apply it, so every case arrives without one.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
              <a href={`${result.url}/edit`} target="_blank" rel="noreferrer">
                <button className="primary">Open case for editing</button>
              </a>
              <button onClick={startOver}>Upload another</button>
            </div>
          </div>
        )}
      </main>

      {showInfo && <InfoDialog info={info} onClose={() => setShowInfo(false)} />}

      {viewing && viewedStack && (
        <SeriesViewer
          stack={viewedStack}
          heading={viewing.heading}
          onChange={(patch) => mutateStacks((stack) => (stack.id === viewedStack.id ? patch : null))}
          onClose={() => setViewing(null)}
        />
      )}

      <footer className="footer">
        {error && <span className="notice error">{error}</span>}

        {progress && (
          <div style={{ flex: '0 1 300px' }}>
            <div className="small muted" style={{ marginBottom: 4 }}>
              {progress.phase}
              {progress.total > 0 ? ` ${progress.done}/${progress.total}` : ''}
              {progress.detail ? ` — ${progress.detail}` : ''}
            </div>
            <div className="progress">
              <div style={{ width: progress.total > 0 ? `${(progress.done / progress.total) * 100}%` : '100%' }} />
            </div>
          </div>
        )}

        <div className="spacer" />

        {step === 'review' && (
          <>
            <span className="muted small">
              {studiesToUpload.length > 1 ? `${studiesToUpload.length} studies · ` : ''}
              {selectedStacks.length} series · {selectedImageCount} images selected
            </span>
            <button onClick={startOver} disabled={busy}>
              Back
            </button>
            <button className="primary" disabled={busy || selectedStacks.length === 0} onClick={() => void anonymiseAndContinue()}>
              Anonymise and continue
            </button>
          </>
        )}

        {step === 'case' && (
          <>
            <button onClick={() => setStep('review')} disabled={busy}>
              Back
            </button>
            <button
              className="primary"
              disabled={busy || form.title.trim() === '' || form.systemId === null}
              title={form.systemId === null ? 'Choose a system first' : undefined}
              onClick={() => void upload()}
            >
              Upload to Radiopaedia
            </button>
          </>
        )}
      </footer>
    </div>
  )
}
