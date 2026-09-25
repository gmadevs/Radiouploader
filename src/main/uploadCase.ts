import type { AnonResult, Progress, Stack, Transfer } from '@shared/types'
import type { CaseDraft, RadiopaediaClient } from './api/client'
import { uploadStack, type UploadFile } from './api/upload'
import {
  clearInterruptedUpload,
  continues,
  loadInterruptedUpload,
  saveInterruptedUpload,
  stackKey,
  studyKey,
  type InterruptedUpload
} from './interruptedUpload'
import { session } from './session'
import { planStudies, type StudyDraftInput } from './uploadPlan'

export interface UploadRequest {
  /**
   * An existing draft to add to. When set the case is not created and the
   * draft below is not read: the case already has its title, its age and its
   * system, and the API has no way to change them. It is also how an upload
   * that stopped is carried on: the case step selects that draft for it.
   */
  caseId?: string | null
  caseDraft: CaseDraft
  /** One entry per DICOM study; each becomes a study on the Radiopaedia case. */
  studies: StudyDraftInput[]
}

/** The words describeError recognises, in the renderer, to say what to do next. */
export const STOPPED_PARTWAY = 'Upload stopped partway'

/**
 * The anonymised files each stack sends, in upload order.
 *
 * A multiframe instance yields one anonymised file per frame, so the match back
 * to a slice is on the file and the frame, never the path alone.
 */
export function filesByStack(stacks: Stack[], anon: AnonResult): Map<string, UploadFile[]> {
  const key = (sourcePath: string, frame: number): string => `${sourcePath}#${frame}`
  const bySource = new Map(anon.files.map((f) => [key(f.sourcePath, f.frame), f]))
  return new Map(
    stacks.map((stack) => [
      stack.id,
      stack.slices
        .map((slice) => bySource.get(key(slice.path, slice.frame)))
        .filter((f): f is NonNullable<typeof f> => f !== undefined)
    ])
  )
}

/** Each stack that has files to send, by id, with the key it is recognised by after a restart. */
function stackKeys(files: Map<string, UploadFile[]>): Map<string, string> {
  return new Map(
    [...files].filter(([, list]) => list.length > 0).map(([id, list]) => [id, stackKey(list.map((f) => f.sha256))])
  )
}

/**
 * The stopped upload the current selection would carry on, if there is one:
 * what the case step shows, and selects the draft for.
 */
export async function interruptedForSelection(): Promise<{ caseId: string; savedAt: string } | null> {
  const record = await loadInterruptedUpload()
  if (!record || !session.anon) return null
  const keys = new Set(stackKeys(filesByStack(session.selectedStacks(), session.anon)).values())
  return continues(record, keys) ? { caseId: record.caseId, savedAt: record.savedAt } : null
}

/**
 * The case a request goes into, and how much of it is already done.
 *
 * An upload that stopped is carried on when the request names its draft and
 * this is the same upload (see `continues`). Anything else starts afresh: a new
 * case, or an existing draft with nothing of this upload in it yet.
 */
async function caseFor(
  c: RadiopaediaClient,
  request: UploadRequest,
  keys: Set<string>
): Promise<InterruptedUpload> {
  const record = await loadInterruptedUpload()
  const requested = request.caseId ?? null
  const carryOn = record !== null && requested === record.caseId && continues(record, keys)
  const fresh = (caseId: string): InterruptedUpload => ({
    savedAt: new Date().toISOString(),
    caseId,
    studies: {},
    stacksDone: [],
    planned: [...keys]
  })

  if (requested !== null) {
    // The case may have been published, sent for review or deleted since the
    // list was fetched, or since the attempt that stopped, and only a draft
    // takes new images. Checked here because this is the last moment before
    // anything is sent.
    const still = (await c.draftCases()).some((existing) => existing.id === requested)
    if (!still) {
      if (record?.caseId === requested) await clearInterruptedUpload()
      throw new Error(
        'That case is no longer a draft on Radiopaedia, so it cannot take new images. ' +
          'It may have been published, sent for review, or deleted since the list was read.'
      )
    }
    return carryOn ? { ...record, planned: [...new Set([...record.planned, ...keys])] } : fresh(requested)
  }

  // Re-check the quota against the server. The renderer's copy can be stale —
  // the user may have created drafts elsewhere since this session started —
  // and a rejected case would otherwise surface as an opaque API error. Adding
  // to a draft creates no case, so the quota does not apply there.
  const { quota } = await c.currentUser()
  if (quota !== null && quota.allowedDraftCases !== null && quota.draftCaseCount >= quota.allowedDraftCases) {
    throw new Error(
      `Draft quota full: ${quota.draftCaseCount} of ${quota.allowedDraftCases} used. ` +
        'Publish or delete a draft case on Radiopaedia first. ' +
        'You can raise your quota at https://radiopaedia.org/supporters'
    )
  }
  return fresh(await c.createCase(request.caseDraft))
}

/**
 * Put the anonymised selection into a case on Radiopaedia.
 *
 * What gets done is recorded on disk as it is done — the case, each study, each
 * series — so that a failure halfway can be carried on from, in this session or
 * after a restart, rather than started over. Only whole steps are recorded,
 * because the three calls that make them are not safe to repeat; a series
 * stopped in the middle of its files is sent again, and costs little, since what
 * reached S3 comes back as already uploaded.
 */
export async function uploadCase(
  c: RadiopaediaClient,
  request: UploadRequest,
  broadcast: (progress: Progress) => void
): Promise<{ caseId: string; url: string }> {
  const anon = session.anon
  if (!anon) throw new Error('Anonymise the selected series before uploading')

  const planned = planStudies(session.ingest?.studies ?? [], request.studies)
  if (planned.length === 0) throw new Error('No studies to upload')

  const stacks = session.selectedStacks()
  // What each stack sends, worked out before anything goes. The total has to
  // be known from the first byte or the bar and the time remaining spend the
  // upload learning how big the job is, which is when they were needed.
  const files = filesByStack(stacks, anon)
  const keyOf = stackKeys(files)
  const sending = planned.flatMap((p) => p.stackIds).filter((id) => keyOf.has(id))

  const state = await caseFor(c, request, new Set(sending.map((id) => keyOf.get(id)!)))
  const record = async (): Promise<void> => {
    state.savedAt = new Date().toISOString()
    await saveInterruptedUpload(state)
  }
  await record()

  const done = new Set(state.stacksDone)
  const remaining = sending.filter((id) => !done.has(keyOf.get(id)!))
  let seriesDone = sending.length - remaining.length
  const transfer: Transfer = {
    sent: 0,
    skipped: 0,
    total: remaining.reduce((n, id) => n + (files.get(id) ?? []).reduce((m, f) => m + f.byteLength, 0), 0),
    elapsedMs: 0
  }
  // From here rather than from the first line: the quota check and the draft
  // listing are the network answering, not the upload running, and folding
  // them in would report a speed the transfer never had.
  const startedAt = Date.now()

  try {
    // Studies are created oldest first so the case timeline reads in order.
    for (const plan of planned) {
      const stackIds = plan.stackIds.filter((id) => remaining.includes(id))
      if (stackIds.length === 0) continue

      const study = studyKey(plan.studyId)
      let studyId = state.studies[study]
      if (studyId === undefined) {
        studyId = await c.createStudy(state.caseId, {
          modality: plan.modality,
          findings: plan.findings,
          position: plan.position,
          caption: plan.caption
        })
        state.studies[study] = studyId
        await record()
      }

      for (const stackId of stackIds) {
        const stack = stacks.find((s) => s.id === stackId)
        if (!stack) continue

        seriesDone++
        await uploadStack(c, state.caseId, studyId, files.get(stackId) ?? [], (p) => {
          if (p.alreadyThere) transfer.skipped += p.bytes
          else transfer.sent += p.bytes
          broadcast({
            phase: 'uploading',
            done: p.done,
            total: p.total,
            detail: `${stack.label} — series ${seriesDone}/${sending.length}`,
            transfer: { ...transfer, elapsedMs: Date.now() - startedAt }
          })
        })
        state.stacksDone.push(keyOf.get(stackId)!)
        await record()
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`${STOPPED_PARTWAY}: ${reason}`)
  }

  await clearInterruptedUpload()
  // mark_upload_finished is deliberately not called: an unmarked case stays a
  // draft, which is what adding images to it later needs, and marking one may
  // do more than unlock editing — see docs/internals/upload.md.
  return { caseId: state.caseId, url: `https://radiopaedia.org/cases/${state.caseId}` }
}
