import { createHash } from 'node:crypto'
import { loadConfig, updateConfig } from './api/store'

/**
 * An upload that stopped partway, kept on disk so it can be carried on after the
 * app has been closed.
 *
 * Quitting deletes the anonymised files, so carrying on after a restart means
 * importing and anonymising again. The anonymiser is deterministic, so the
 * same selection with the same edits produces the same bytes, and a stack is
 * recognised by a hash of its anonymised files. That is also what makes the
 * record safe to act on: a stack edited since, say with a mask added, hashes
 * differently, and is not taken for the one already on Radiopaedia.
 *
 * Nothing in it identifies a patient. Studies are keyed by a one-way hash of
 * their StudyInstanceUID, which would otherwise be a PACS identifier on disk
 * after the session that read it had gone.
 */
export interface InterruptedUpload {
  savedAt: string
  caseId: string
  /** Study key to the Radiopaedia study made for it. */
  studies: Record<string, string>
  /** Stacks attached as a series. One stopped partway is not here, and is sent again. */
  stacksDone: string[]
  /** Every stack the upload set out to send, which is how the next one is recognised as the same. */
  planned: string[]
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

export function studyKey(studyInstanceUid: string): string {
  return sha256(`study\0${studyInstanceUid}`)
}

/** A stack by its content: the hashes of its anonymised files, in upload order. */
export function stackKey(fileHashes: string[]): string {
  return sha256(`stack\0${fileHashes.join('\n')}`)
}

/**
 * Whether a stopped upload is this one, carried on.
 *
 * It has to share at least one stack with this upload, or an unrelated study
 * would be put into the old case; and every stack it finished has to be here
 * unchanged, or a series edited since would be skipped as already uploaded
 * when what is on Radiopaedia is the version before the edit.
 */
export function continues(record: InterruptedUpload, stackKeys: Set<string>): boolean {
  return record.planned.some((key) => stackKeys.has(key)) && record.stacksDone.every((key) => stackKeys.has(key))
}

export async function loadInterruptedUpload(): Promise<InterruptedUpload | null> {
  return (await loadConfig()).interruptedUpload ?? null
}

export async function saveInterruptedUpload(record: InterruptedUpload): Promise<void> {
  await updateConfig((config) => ({ ...config, interruptedUpload: record }))
}

export async function clearInterruptedUpload(): Promise<void> {
  await updateConfig((config) => ({ ...config, interruptedUpload: undefined }))
}
