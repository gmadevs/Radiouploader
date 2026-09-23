import type { Progress, Transfer } from '@shared/types'
import type { CaseDraft, RadiopaediaClient } from './api/client'
import { uploadStack } from './api/upload'
import { session, type UploadSoFar } from './session'
import { planStudies, type StudyDraftInput } from './uploadPlan'

export interface UploadRequest {
  /**
   * An existing draft to add to. When set the case is not created and the
   * draft below is not read: the case already has its title, its age and its
   * system, and the API has no way to change them.
   */
  caseId?: string | null
  caseDraft: CaseDraft
  /** One entry per DICOM study; each becomes a study on the Radiopaedia case. */
  studies: StudyDraftInput[]
}

/** The words describeError recognises, in the renderer, to say what to do next. */
export const STOPPED_PARTWAY = 'Upload stopped partway'

/**
 * The case a request goes into: carried on, created, or an existing draft.
 *
 * An upload that stopped is carried on unless the request names a different
 * draft — the case was created by the attempt that stopped, and creating a
 * second would leave the first behind as half a case in the draft list.
 */
async function caseFor(c: RadiopaediaClient, request: UploadRequest): Promise<UploadSoFar> {
  const soFar = session.uploadSoFar
  const requested = request.caseId ?? null
  const carryOn = soFar !== null && (requested === null || requested === soFar.caseId)

  if (carryOn || requested !== null) {
    const caseId = carryOn ? soFar.caseId : requested!
    // The case may have been published, sent for review or deleted since the
    // list was fetched — or since the attempt that stopped — and only a draft
    // takes new images. Checked here because this is the last moment before
    // anything is sent.
    const still = (await c.draftCases()).some((existing) => existing.id === caseId)
    if (!still) {
      session.uploadSoFar = null
      throw new Error(
        'That case is no longer a draft on Radiopaedia, so it cannot take new images. ' +
          'It may have been published, sent for review, or deleted since the list was read.'
      )
    }
    return carryOn ? soFar : { caseId, studies: new Map(), stacksDone: new Set() }
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
  return { caseId: await c.createCase(request.caseDraft), studies: new Map(), stacksDone: new Set() }
}

/**
 * Put the anonymised selection into a case on Radiopaedia.
 *
 * What gets done is recorded as it is done — the case, each study, each series
 * — so that a failure halfway can be carried on from rather than started over.
 * Only whole steps are recorded, because the three calls that make them are not
 * safe to repeat; a series stopped in the middle of its files is sent again,
 * and costs little, since what reached S3 comes back as already uploaded.
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
  // A multiframe instance yields one anonymised file per frame, so the match
  // back to a slice is on the file *and* the frame, never the path alone.
  const key = (sourcePath: string, frame: number): string => `${sourcePath}#${frame}`
  const bySource = new Map(anon.files.map((f) => [key(f.sourcePath, f.frame), f]))

  // What each stack sends, worked out before anything goes. The total has to
  // be known from the first byte or the bar and the time remaining spend the
  // upload learning how big the job is, which is when they were needed.
  const filesByStack = new Map(
    stacks.map((stack) => [
      stack.id,
      stack.slices
        .map((slice) => bySource.get(key(slice.path, slice.frame)))
        .filter((f): f is NonNullable<typeof f> => f !== undefined)
    ])
  )

  const soFar = await caseFor(c, request)
  session.uploadSoFar = soFar

  const sending = planned.flatMap((p) => p.stackIds).filter((id) => (filesByStack.get(id)?.length ?? 0) > 0)
  const remaining = sending.filter((id) => !soFar.stacksDone.has(id))
  let seriesDone = sending.length - remaining.length
  const transfer: Transfer = {
    sent: 0,
    skipped: 0,
    total: remaining.reduce((n, id) => n + (filesByStack.get(id) ?? []).reduce((m, f) => m + f.byteLength, 0), 0),
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

      let studyId = soFar.studies.get(plan.studyId)
      if (studyId === undefined) {
        studyId = await c.createStudy(soFar.caseId, {
          modality: plan.modality,
          findings: plan.findings,
          position: plan.position,
          caption: plan.caption
        })
        soFar.studies.set(plan.studyId, studyId)
      }

      for (const stackId of stackIds) {
        const stack = stacks.find((s) => s.id === stackId)
        const files = filesByStack.get(stackId) ?? []
        if (!stack) continue

        seriesDone++
        await uploadStack(c, soFar.caseId, studyId, files, (p) => {
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
        soFar.stacksDone.add(stackId)
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`${STOPPED_PARTWAY}: ${reason}`)
  }

  session.uploadSoFar = null
  // mark_upload_finished is deliberately not called: an unmarked case stays a
  // draft, which is what adding images to it later needs, and marking one may
  // do more than unlock editing — see docs/internals/upload.md.
  return { caseId: soFar.caseId, url: `https://radiopaedia.org/cases/${soFar.caseId}` }
}
