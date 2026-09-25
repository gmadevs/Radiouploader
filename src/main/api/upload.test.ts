import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// The client reaches the keychain through Electron; none of that runs here.
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() }, safeStorage: {}, shell: {}, dialog: {} }))

const { RadiopaediaApiError } = await import('./client')
const { uploadStack } = await import('./upload')

let dir: string
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-test-'))
})
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

async function filesOf(count: number): Promise<{ outputPath: string; sha256: string; byteLength: number }[]> {
  return Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const outputPath = path.join(dir, `${i}.dcm`)
      await fs.writeFile(outputPath, Buffer.from([i]))
      return { outputPath, sha256: `hash-${i}`, byteLength: 1 }
    })
  )
}

/**
 * A client whose presign answers with one slot per hash, numbered by how many
 * signings came before, so a test can tell which one issued a URL.
 */
function fakeClient(slot?: (hash: string, signing: number) => { id: number; url?: string; status?: string }) {
  let signings = 0
  const presigned: string[][] = []
  const attached: number[][] = []
  const request = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    if (url.endsWith('/direct_s3_uploads')) {
      signings++
      presigned.push(body.sha256)
      const uploads = (body.sha256 as string[]).map(
        (hash) => slot?.(hash, signings) ?? { id: signings * 100 + Number(hash.slice(5)), url: `https://s3/${signings}/${hash}` }
      )
      return new Response(JSON.stringify({ uploads }))
    }
    attached.push(body.stack_upload.uploaded_data)
    return new Response('{}')
  })
  return { client: { request } as never, presigned, attached }
}

/** A clock that never waits, and says whatever time the test sets. */
function testClock() {
  const clock = { t: 0, waits: [] as number[], now: () => clock.t, wait: async (ms: number) => void clock.waits.push(ms) }
  return clock
}

/** Stub S3: each PUT answered by `answer`, which sees the URL it was sent to. */
function stubS3(answer: (url: string) => Response | Promise<Response>): string[] {
  const puts: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      puts.push(url)
      return answer(url)
    })
  )
  return puts
}

describe('uploadStack', () => {
  it('tries a PUT again when S3 answers with a server error, and then attaches the series', async () => {
    const files = await filesOf(1)
    const { client, attached } = fakeClient()
    let failures = 1
    const puts = stubS3(() => (failures-- > 0 ? new Response('', { status: 503 }) : new Response('')))
    const clock = testClock()

    await uploadStack(client, 'case', 'study', files, undefined, clock)

    expect(puts).toHaveLength(2)
    expect(clock.waits).toHaveLength(1)
    expect(attached).toEqual([[100]])
  })

  it('gives up after four tries, and attaches nothing', async () => {
    const files = await filesOf(1)
    const { client, attached } = fakeClient()
    const puts = stubS3(() => new Response('', { status: 500 }))

    await expect(uploadStack(client, 'case', 'study', files, undefined, testClock())).rejects.toThrow(/500/)
    expect(puts).toHaveLength(4)
    expect(attached).toEqual([])
  })

  it('does not repeat a request S3 refused for what it was', async () => {
    const files = await filesOf(1)
    const { client } = fakeClient()
    const puts = stubS3(() => new Response('', { status: 400 }))

    await expect(uploadStack(client, 'case', 'study', files, undefined, testClock())).rejects.toThrow(/400/)
    expect(puts).toHaveLength(1)
  })

  it('tries again when the connection dropped before any answer came', async () => {
    const files = await filesOf(1)
    const { client } = fakeClient()
    let drops = 2
    const puts = stubS3(() => {
      if (drops-- > 0) throw new TypeError('fetch failed')
      return new Response('')
    })

    await uploadStack(client, 'case', 'study', files, undefined, testClock())
    expect(puts).toHaveLength(3)
  })

  it('signs the files not yet started afresh once their URLs have aged', async () => {
    const files = await filesOf(6)
    const { client, presigned, attached } = fakeClient()
    const clock = testClock()
    // The first four PUTs, which start at once, take eleven minutes between
    // them. The fifth then starts past the point of re-signing, and the sixth
    // goes up under that fresh signing.
    const puts = stubS3(() => {
      clock.t = 11 * 60_000
      return new Response('')
    })

    await uploadStack(client, 'case', 'study', files, undefined, clock)

    expect(presigned).toEqual([files.map((f) => f.sha256), ['hash-4', 'hash-5']])
    // Sorted: four workers race for the last two files, and which starts first
    // is up to the event loop. What matters is the signing they went under.
    expect(puts.filter((url) => url.startsWith('https://s3/2/')).sort()).toEqual([
      'https://s3/2/hash-4',
      'https://s3/2/hash-5'
    ])
    // The series is attached in its own order, with the id of whichever
    // signing each file went up under.
    expect(attached).toEqual([[100, 101, 102, 103, 204, 205]])
  })

  it('asks once for a fresh URL when S3 refuses a signature', async () => {
    const files = await filesOf(1)
    const { client, presigned, attached } = fakeClient()
    const puts = stubS3((url) => new Response('', { status: url.startsWith('https://s3/1/') ? 403 : 200 }))

    await uploadStack(client, 'case', 'study', files, undefined, testClock())

    expect(presigned).toHaveLength(2)
    expect(puts).toEqual(['https://s3/1/hash-0', 'https://s3/2/hash-0'])
    expect(attached).toEqual([[200]])
  })

  it('sends nothing for a file Radiopaedia already holds, and counts it as not sent', async () => {
    const files = await filesOf(2)
    const { client } = fakeClient((hash, signing) =>
      hash === 'hash-0' ? { id: 1, status: 'already_uploaded' } : { id: 2, url: `https://s3/${signing}/${hash}` }
    )
    const puts = stubS3(() => new Response(''))
    const progress: boolean[] = []

    await uploadStack(client, 'case', 'study', files, (p) => progress.push(p.alreadyThere), testClock())

    expect(puts).toEqual(['https://s3/1/hash-1'])
    expect(progress.sort()).toEqual([false, true])
  })

  it('retries the signing itself when the site is briefly unavailable', async () => {
    const files = await filesOf(1)
    const { client, attached } = fakeClient()
    const request = (client as unknown as { request: ReturnType<typeof vi.fn> }).request
    const real = request.getMockImplementation()!
    request.mockImplementationOnce(async () => {
      throw new RadiopaediaApiError(502, '502 Bad Gateway', '')
    })
    request.mockImplementation(real)
    stubS3(() => new Response(''))

    await uploadStack(client, 'case', 'study', files, undefined, testClock())
    expect(attached).toHaveLength(1)
  })
})
