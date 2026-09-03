import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppInfo, BurnInFinding, CaseSummary, IngestResult, Progress, Series, Stack } from '@shared/types'
import { keptCount } from '@shared/selection'
import { AccountBar } from './components/AccountBar'
import { quotaExhausted, type AccountState } from './quota'
import { describeInterval } from '@shared/interval'
import { modalityFromDicom } from '@shared/radiopaedia'
import { splitByReview, type StackEntry } from './burnIn'
import { BurnInCheck } from './components/BurnInCheck'
import { ReformatDialog } from './components/ReformatDialog'
import { CaseStep, type CaseForm } from './components/CaseStep'
import { InfoDialog } from './components/InfoDialog'
import { ReviewStep } from './components/ReviewStep'
import { moveBy, moveTo } from './reorder'
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
  existingCaseId: null,
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
  /** Stacks opened full size, so the burnt-in check knows what went unlooked at. */
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
  /** The burnt-in check, which stands between the review step and anonymisation. */
  const [confirming, setConfirming] = useState(false)
  /** The stack whose reformat dialog is open, with the heading it shows. */
  const [reformatting, setReformatting] = useState<{ stackId: string; seriesId: string; heading: string } | null>(
    null
  )
  /** What the pixel check noticed, or null while it is still looking. */
  const [findings, setFindings] = useState<BurnInFinding[] | null>(null)
  /** The account's draft cases, or null until they have been read. */
  const [drafts, setDrafts] = useState<CaseSummary[] | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [showInfo, setShowInfo] = useState(false)

  /**
   * Reasons the account cannot take a case right now. Checked before importing
   * so a full quota surfaces before any work is done, not after anonymising.
   */
  const blocked = !account.authenticated ? { reason: 'Sign in to Radiopaedia before importing a study.' } : null

  /**
   * A full quota stops a new case being made, and nothing else. Adding to a
   * draft creates no case — which is exactly what someone with five drafts open
   * and one to finish is trying to do — so the import is not blocked over it.
   */
  const newCaseBlocked = quotaExhausted(account.quota)
    ? `Your draft quota is full (${account.quota!.draftCaseCount} of ${account.quota!.allowedDraftCases}), so a new case cannot be created. You can still add these images to a draft you already have.`
    : null

  /**
   * The bar belongs to whatever is running. A run's last progress event can
   * arrive after the run's own reply — the two cross the bridge by different
   * routes and nothing orders them — and a bar stuck at "parsing 49/49" over a
   * finished screen says the app has hung when it has not.
   */
  const running = useRef(false)
  const setWorking = (value: boolean): void => {
    running.current = value
    setBusy(value)
    if (!value) setProgress(null)
  }

  useEffect(() => window.api.onProgress((update) => running.current && setProgress(update)), [])
  useEffect(() => {
    void window.api.appInfo().then(setInfo).catch(() => setInfo(null))
  }, [])

  /** The selection, flattened, with the labels the check and the viewer need. */
  const selectedEntries = useMemo<StackEntry[]>(
    () =>
      (ingest?.studies ?? []).flatMap((study) =>
        study.series.flatMap((series) =>
          series.stacks
            .filter((stack) => stack.selected)
            .map((stack) => {
              const name = series.description ?? 'Unnamed series'
              const studyName = study.studyDescription ?? 'Study'
              return {
                stack,
                label: series.stacks.length > 1 ? `${name} · ${stack.label}` : name,
                modality: series.modality,
                heading: `${studyName} · ${name}`,
                studyId: study.id,
                seriesId: series.id,
                study: studyName,
                series: name
              }
            })
        )
      ),
    [ingest]
  )
  const selectedStacks = useMemo(() => selectedEntries.map((entry) => entry.stack), [selectedEntries])
  const { seen, unseen } = useMemo(() => splitByReview(selectedEntries, opened), [selectedEntries, opened])
  const selectedImageCount = selectedStacks.reduce((n, stack) => n + keptCount(stack), 0)

  const allStacks = useMemo(
    () => (ingest?.studies ?? []).flatMap((study) => study.series.flatMap((series) => series.stacks)),
    [ingest]
  )

  const reformatStack = useMemo(
    () => allStacks.find((stack) => stack.id === reformatting?.stackId) ?? null,
    [allStacks, reformatting]
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

  /**
   * Move one series past its neighbour within its study.
   *
   * This is not decoration. The series endpoint has no position of its own, so
   * the order they are posted in is the order the case ends up in — and that
   * order is this array.
   */
  const moveSeries = (studyId: string, seriesId: string, delta: number): void => {
    setIngest((current) => {
      if (!current) return current
      return {
        ...current,
        studies: current.studies.map((study) => {
          if (study.id !== studyId) return study
          const index = study.series.findIndex((series) => series.id === seriesId)
          return index === -1 ? study : { ...study, series: moveBy(study.series, index, delta) }
        })
      }
    })
  }

  /**
   * Put one series where another one is, which is what a drag in the order
   * check means. The arrows move by one; a drop knows only what it landed on,
   * and the series between them may be ones that strip does not show.
   */
  const reorderSeries = (studyId: string, seriesId: string, targetSeriesId: string): void => {
    setIngest((current) => {
      if (!current) return current
      return {
        ...current,
        studies: current.studies.map((study) => {
          if (study.id !== studyId) return study
          const from = study.series.findIndex((series) => series.id === seriesId)
          const to = study.series.findIndex((series) => series.id === targetSeriesId)
          return from === -1 || to === -1 ? study : { ...study, series: moveTo(study.series, from, to) }
        })
      }
    })
  }

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
              if (patch === null) return stack
              // Select-all and the per-series buttons go through here too, and
              // neither should be able to tick a stack that cannot be uploaded.
              if (patch.selected === true && stack.unsupported !== null) return stack
              return { ...stack, ...patch }
            })
          }))
        }))
      }
    })
  }

  /** Opening a stack is what the burnt-in check counts as having looked at it. */
  const openViewer = (stackId: string, heading: string): void => {
    setViewing({ stackId, heading })
    setOpened((current) => new Set(current).add(stackId))
  }

  /**
   * Send the tree as the renderer holds it.
   *
   * Every stack, not only the ticked ones, and before anything in the main
   * process reads pixels — the check, the anonymiser and the volume behind a
   * reformat all work from this copy, and one that has not been pushed since
   * the last box was drawn is one that reformats or scans the wrong pixels.
   */
  const pushSelection = async (): Promise<void> => {
    await window.api.setSelection(
      allStacks.map((s) => ({
        id: s.id,
        selected: s.selected,
        trimStart: s.trimStart,
        trimEnd: s.trimEnd,
        dropped: s.dropped ?? [],
        masks: s.masks ?? [],
        crop: s.crop ?? null,
        window: s.window ?? null
      }))
    )
  }

  /** Push the selection, then look through it for text burnt into the pixels. */
  const openCheck = async (): Promise<void> => {
    setConfirming(true)
    setFindings(null)
    try {
      await pushSelection()
      setFindings(await window.api.scanBurnIn())
    } catch {
      // A check that could not run says nothing, which is what an empty list
      // means everywhere else here too.
      setFindings([])
    }
  }

  const readDrafts = async (): Promise<void> => {
    setDrafts(null)
    try {
      const found = await window.api.draftCases()
      setDrafts(found)
      // With no room for a new case, the only way forward is a draft — so the
      // step opens on one rather than on a form that cannot be submitted.
      if (quotaExhausted(account.quota) && found.length > 0) {
        setForm((current) => (current.existingCaseId === null ? { ...current, existingCaseId: found[0].id } : current))
      }
    } catch (e) {
      setDrafts([])
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const runIngest = async (paths: string[]): Promise<void> => {
    setWorking(true)
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
      setWorking(false)
    }
  }

  const anonymiseAndContinue = async (): Promise<void> => {
    setConfirming(false)
    setWorking(true)
    setError(null)
    try {
      await pushSelection()
      const res = await window.api.anonymise()
      setWarnings(res.summary)
      if (res.errors.length > 0) {
        setError(`${res.errors.length} file(s) could not be anonymised and will not be uploaded.`)
      }

      // Seed one form per study, keeping anything already typed. Captions are
      // pre-filled with the interval read from the originals.
      const multiple = studiesToUpload.length > 1
      // Age and sex belong to the case, not to a study, so they come from the
      // earliest one: the age a case is presented at is the age at baseline.
      const baseline = studiesToUpload[0]
      setForm((current) => ({
        ...current,
        // Only where nothing has been chosen. These are read off the originals,
        // which makes them a suggestion and not something to overwrite an
        // answer with.
        age: current.age || baseline?.patientAge || '',
        gender: current.gender || baseline?.patientSex || '',
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
      // The drafts are read on the way in rather than at sign-in: one may have
      // been published on the site in the meantime, and this is the moment the
      // list is about to be looked at.
      void readDrafts()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(false)
    }
  }

  const upload = async (): Promise<void> => {
    setWorking(true)
    setError(null)
    try {
      const res = await window.api.upload({
        caseId: form.existingCaseId,
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
      setWorking(false)
    }
  }

  const startOver = (): void => {
    void window.api.resetIngest()
    setViewing(null)
    setOpened(new Set())
    setConfirming(false)
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
            onMoveSeries={moveSeries}
            onOpen={(stack, series, study) =>
              openViewer(stack.id, `${study.studyDescription ?? 'Study'} · ${series.description ?? 'Unnamed series'}`)
            }
            onReformat={async (stack, series, study) => {
              // The volume is built in the main process from its own copy of
              // the tree, so what was blanked and cropped here has to get there
              // before the dialog opens and asks for it.
              await pushSelection()
              setReformatting({
                stackId: stack.id,
                seriesId: series.id,
                heading: `${study.studyDescription ?? 'Study'} · ${series.description ?? 'Unnamed series'}`
              })
            }}
            onKeepOnePhase={(series) => {
              // Keep the earliest phase and drop the rest; the user can re-tick any.
              const first = series.stacks.find((s) => s.selected)?.id ?? series.stacks[0]?.id
              mutateStacks((stack, s) => (s.id === series.id ? { selected: stack.id === first } : null))
            }}
          />
        )}

        {step === 'case' && (
          <CaseStep
          form={form}
          onChange={setForm}
          studies={studiesToUpload}
          warnings={warnings}
          drafts={drafts}
          newCaseBlocked={newCaseBlocked}
          onRefreshDrafts={() => void readDrafts()}
        />
        )}

        {step === 'done' && result && (
          <div className="card" style={{ textAlign: 'center', maxWidth: 480 }}>
            <h1>{form.existingCaseId === null ? 'Case uploaded' : 'Images added'}</h1>
            <p className="muted">
              {form.existingCaseId === null
                ? 'The case was created as a draft. Open it on Radiopaedia to review the images and publish it.'
                : 'The studies were added to the draft. Open it on Radiopaedia to review the images and publish it.'}
            </p>
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

      {/* Hidden while the viewer is up rather than stacked behind it, so one
          Escape closes one thing and the list is re-read on the way back. */}
      {confirming && !viewing && (
        <BurnInCheck
          entries={selectedEntries}
          seenCount={seen.length}
          unseen={unseen}
          findings={findings}
          busy={busy}
          onOpen={(entry) => openViewer(entry.stack.id, entry.heading)}
          onReorder={reorderSeries}
          onBack={() => setConfirming(false)}
          onConfirm={() => void anonymiseAndContinue()}
        />
      )}

      {reformatting && reformatStack && (
        <ReformatDialog
          stack={reformatStack}
          heading={reformatting.heading}
          onClose={() => setReformatting(null)}
          // The main process has already put it in the tree it reads; this is
          // the same insertion in the copy the picker draws from.
          onAdded={(studyId, series) =>
            setIngest((current) => {
              if (current === null) return current
              return {
                ...current,
                studies: current.studies.map((study) => {
                  if (study.id !== studyId) return study
                  const after = study.series.findIndex((existing) => existing.id === reformatting.seriesId)
                  const next = [...study.series]
                  next.splice(after < 0 ? next.length : after + 1, 0, series)
                  return { ...study, series: next }
                })
              }
            })
          }
        />
      )}

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
            <button
              className="primary"
              disabled={busy || selectedStacks.length === 0}
              onClick={() => void openCheck()}
            >
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
              // A case that already exists needs no title and no system: it has
              // them, and this upload cannot change them either way.
              disabled={
                busy ||
                (form.existingCaseId === null
                  ? form.title.trim() === '' || form.systemId === null
                  : drafts?.some((draft) => draft.id === form.existingCaseId) !== true)
              }
              title={
                form.existingCaseId === null && form.systemId === null ? 'Choose a system first' : undefined
              }
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
