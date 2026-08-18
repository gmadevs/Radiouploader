import fs from 'node:fs/promises'
import type { Progress } from '@shared/types'
import type { RadiopaediaClient } from './client'
import { RADIOPAEDIA_ORIGIN } from './oauth'

/**
 * These two routes live at the site root, not under /api/v1/.
 * Together they are the only way to state explicitly which files form a series:
 * the /api/v1 zip endpoint lets Radiopaedia re-derive series from the DICOM
 * UIDs instead, which would undo the stack splitting — after anonymisation
 * every stack cut out of one original series still shares its SeriesInstanceUID.
 */
const DIRECT_S3_UPLOADS = `${RADIOPAEDIA_ORIGIN}/direct_s3_uploads`
const imagePreparationUrl = (caseId: string, studyId: string): string =>
  `${RADIOPAEDIA_ORIGIN}/image_preparation/${caseId}/studies/${studyId}/series`

/** Presigned URLs last 900s; four in flight keeps a large series inside that window. */
const MAX_CONCURRENT_PUTS = 4

interface PresignedUpload {
  id: number
  url?: string
  status?: string
}

export interface UploadFile {
  outputPath: string
  sha256: string
}

/**
 * Upload one stack and attach it to a study as a single series.
 *
 * Files are presented to Radiopaedia in the order given, and that order is what
 * determines slice order in the viewer, so callers must pass an ordered stack.
 */
export async function uploadStack(
  client: RadiopaediaClient,
  caseId: string,
  studyId: string,
  files: UploadFile[],
  onProgress?: (p: Progress) => void
): Promise<void> {
  if (files.length === 0) return

  // Step 1 — ask for a presigned slot per file. Radiopaedia deduplicates by
  // hash and answers "already_uploaded" for content it has seen before.
  const initRes = await client.request(DIRECT_S3_UPLOADS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha256: files.map((f) => f.sha256) })
  })
  const { uploads } = (await initRes.json()) as { uploads: PresignedUpload[] }

  if (!Array.isArray(uploads) || uploads.length !== files.length) {
    throw new Error(`direct_s3_uploads returned ${uploads?.length ?? 0} slots for ${files.length} files`)
  }

  // Step 2 — PUT the bytes straight to S3, bounded concurrency, order preserved
  // through the uploads array rather than completion order.
  let done = 0
  let cursor = 0
  const report = (): void => {
    done++
    onProgress?.({ phase: 'uploading', done, total: files.length })
  }

  async function putWorker(): Promise<void> {
    while (cursor < files.length) {
      const index = cursor++
      const upload = uploads[index]
      if (upload.status === 'already_uploaded') {
        report()
        continue
      }
      if (!upload.url) throw new Error(`No presigned URL for ${files[index].outputPath}`)

      const body = await fs.readFile(files[index].outputPath)
      const res = await fetch(upload.url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/dicom' },
        body: new Uint8Array(body)
      })
      if (!res.ok) {
        throw new Error(`S3 upload failed for ${files[index].outputPath}: ${res.status} ${res.statusText}`)
      }
      report()
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_PUTS, files.length) }, putWorker))

  // Step 3 — attach the uploaded objects to the study as one series.
  // root_index is 0-based and selects the frame shown as the series thumbnail;
  // the middle slice is the useful default, and for a single image it must be 0.
  const rootIndex = files.length > 1 ? Math.floor(files.length / 2) : 0

  await client.request(imagePreparationUrl(caseId, studyId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_format: 'application/dicom',
      series: { root_index: rootIndex },
      stack_upload: { uploaded_data: uploads.map((u) => u.id) }
    })
  })
}
