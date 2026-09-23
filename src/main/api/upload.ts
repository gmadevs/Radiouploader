import fs from 'node:fs/promises'
import { RadiopaediaApiError, type RadiopaediaClient } from './client'
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

const MAX_CONCURRENT_PUTS = 4

/**
 * Presigned URLs last 900 s, and S3 checks that when a PUT starts, not when it
 * ends. Four in flight does not keep a series inside that window — on a slow
 * line the bandwidth is the limit, not the concurrency, and a cine decoded out
 * of its JPEG can be a gigabyte — so the files not yet started are signed
 * afresh once their URLs are this old, with room left for a PUT to begin.
 */
const PRESIGN_REFRESH_MS = 10 * 60_000

/** One try and three more; a transfer that fails four times is not a blip. */
const ATTEMPTS = 4
const FIRST_BACKOFF_MS = 1000

interface PresignedUpload {
  id: number
  url?: string
  status?: string
}

export interface UploadFile {
  outputPath: string
  sha256: string
  /** What the anonymised file weighs, which is what the upload actually costs. */
  byteLength: number
}

/**
 * One file done, reported as it happens.
 *
 * The bytes are here because files are the wrong unit for how long an upload
 * has left: forty localisers go in the time one reconstruction takes. And a
 * file Radiopaedia already held is marked rather than counted as sent — it
 * crossed no network, so folding it into a speed would report one that was
 * never reached.
 */
export interface StackProgress {
  done: number
  total: number
  bytes: number
  alreadyThere: boolean
}

/** Time, for the retries and the URL ages — passed in so a test need not wait. */
export interface Clock {
  now(): number
  wait(ms: number): Promise<void>
}

const realClock: Clock = {
  now: () => Date.now(),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}

/** An S3 PUT that came back with a status rather than failing to connect. */
class S3Error extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'S3Error'
  }
}

/**
 * Whether trying again could answer differently.
 *
 * A dropped connection, a server error and a rate limit can; anything else is
 * the request being wrong, and sending it again would only be wrong later.
 * fetch rejects with a TypeError when it never got an answer at all.
 */
function transient(error: unknown): boolean {
  if (error instanceof RadiopaediaApiError || error instanceof S3Error) {
    return error.status >= 500 || error.status === 429
  }
  return error instanceof TypeError
}

/**
 * Run a request that is safe to repeat, backing off between tries.
 *
 * Only for what is safe to repeat: asking for URLs and putting bytes at one.
 * Creating a case or a study, or attaching a series, is not — a request that
 * reached the server and lost its answer would be made twice.
 */
async function withRetry<T>(clock: Clock, attempt: () => Promise<T>): Promise<T> {
  for (let tries = 1; ; tries++) {
    try {
      return await attempt()
    } catch (error) {
      if (tries >= ATTEMPTS || !transient(error)) throw error
      // Jittered, so four workers that failed together do not retry together.
      await clock.wait(FIRST_BACKOFF_MS * 2 ** (tries - 1) * (0.5 + Math.random() / 2))
    }
  }
}

/** Ask for a slot per file. Radiopaedia answers "already_uploaded" for a hash it holds. */
async function presign(client: RadiopaediaClient, clock: Clock, files: UploadFile[]): Promise<PresignedUpload[]> {
  const uploads = await withRetry(clock, async () => {
    const res = await client.request(DIRECT_S3_UPLOADS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha256: files.map((f) => f.sha256) })
    })
    return ((await res.json()) as { uploads: PresignedUpload[] }).uploads
  })
  if (!Array.isArray(uploads) || uploads.length !== files.length) {
    throw new Error(`direct_s3_uploads returned ${uploads?.length ?? 0} slots for ${files.length} files`)
  }
  return uploads
}

/**
 * Upload one stack and attach it to a study as a single series.
 *
 * Files are presented to Radiopaedia in the order given, and that order is what
 * determines slice order in the viewer, so callers must pass an ordered stack.
 *
 * Stopping partway leaves nothing attached: the series is only posted once
 * every file is in S3. Running the same stack again is therefore how it is
 * resumed, and costs little — whatever reached S3 the first time comes back
 * "already_uploaded" and is not sent again.
 */
export async function uploadStack(
  client: RadiopaediaClient,
  caseId: string,
  studyId: string,
  files: UploadFile[],
  onProgress?: (p: StackProgress) => void,
  clock: Clock = realClock
): Promise<void> {
  if (files.length === 0) return

  // Step 1 — a presigned slot per file, re-signed for whatever is left once
  // they have aged. The ids are kept per file, whichever signing issued them.
  const uploads = await presign(client, clock, files)
  let signedAt = clock.now()
  let refreshing: Promise<void> | null = null

  const refreshFrom = (first: number): Promise<void> => {
    refreshing ??= (async () => {
      const fresh = await presign(client, clock, files.slice(first))
      fresh.forEach((upload, offset) => (uploads[first + offset] = upload))
      signedAt = clock.now()
    })().finally(() => (refreshing = null))
    return refreshing
  }

  // Step 2 — PUT the bytes straight to S3, bounded concurrency, order preserved
  // through the uploads array rather than completion order.
  let done = 0
  let cursor = 0
  const report = (index: number, alreadyThere: boolean): void => {
    done++
    onProgress?.({ done, total: files.length, bytes: files[index].byteLength, alreadyThere })
  }

  const put = async (index: number): Promise<void> => {
    const body = await fs.readFile(files[index].outputPath)
    const res = await fetch(uploads[index].url!, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/dicom' },
      body: new Uint8Array(body)
    })
    if (!res.ok) {
      throw new S3Error(res.status, `S3 upload failed for ${files[index].outputPath}: ${res.status} ${res.statusText}`)
    }
  }

  async function putWorker(): Promise<void> {
    while (cursor < files.length) {
      const index = cursor++
      // Every file from here on is unstarted, and a file behind it that is
      // still in flight has the URL it began with — which is all S3 checks.
      if (refreshing) await refreshing
      else if (clock.now() - signedAt > PRESIGN_REFRESH_MS) await refreshFrom(index)

      if (uploads[index].status === 'already_uploaded') {
        report(index, true)
        continue
      }
      if (!uploads[index].url) throw new Error(`No presigned URL for ${files[index].outputPath}`)

      try {
        await withRetry(clock, () => put(index))
      } catch (error) {
        // A 403 from S3 is an expired or refused signature. One fresh URL is
        // worth asking for; a second refusal is not about age.
        if (!(error instanceof S3Error) || error.status !== 403) throw error
        const [fresh] = await presign(client, clock, [files[index]])
        uploads[index] = fresh
        if (fresh.status !== 'already_uploaded') {
          if (!fresh.url) throw new Error(`No presigned URL for ${files[index].outputPath}`)
          await withRetry(clock, () => put(index))
        }
      }
      report(index, false)
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
