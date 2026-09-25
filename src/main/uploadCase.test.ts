import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IngestResult, Stack, Study } from '@shared/types'
import type { StoredConfig } from './api/store'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, safeStorage: {}, shell: {}, dialog: {} }))
const uploadStack = vi.fn()
vi.mock('./api/upload', () => ({ uploadStack }))
// The config file, in memory: what survives a restart is what is in here.
let stored: StoredConfig = {}
vi.mock('./api/store', () => ({
  loadConfig: async () => stored,
  updateConfig: async (change: (config: StoredConfig) => StoredConfig) => {
    stored = change(stored)
  }
}))

const { session } = await import('./session')
const { uploadCase, interruptedForSelection, STOPPED_PARTWAY } = await import('./uploadCase')

function stack(id: string): Stack {
  return {
    id,
    kind: 'single',
    label: id,
    component: 'magnitude',
    bValue: null,
    echoNumber: null,
    phaseIndex: null,
    acquisitionTime: null,
    slices: [{ path: `/tmp/${id}.dcm`, frame: 0, instanceNumber: 1, sliceLocation: 0, sopInstanceUid: null }],
    selected: true,
    trimStart: 0,
    trimEnd: 0,
    dropped: [],
    masks: [],
    crop: null,
    plane: 'Axial',
    sharedPlane: true,
    bytes: 10,
    compression: null,
    window: null,
    unsupported: null
  }
}

function study(id: string, stackIds: string[]): Study {
  const stacks = stackIds.map(stack)
  return {
    id,
    studyInstanceUid: id,
    studyDescription: null,
    modality: 'MR',
    studyDate: null,
    studyTime: null,
    patientAge: null,
    patientSex: null,
    intervalDays: 0,
    series: [
      {
        id: `${id}-series`,
        seriesInstanceUid: `${id}-series`,
        seriesNumber: 1,
        description: null,
        modality: 'MR',
        splitReason: null,
        stacks,
        instanceCount: stacks.length
      }
    ]
  } as Study
}

/**
 * Two studies, the first with two stacks, all anonymised. `hashes` stands for
 * the anonymised content: the same hash is the same bytes, as the anonymiser is
 * deterministic, and a changed one is a stack edited since.
 */
function prepare(hashes: Record<string, string> = {}): void {
  const studies = [study('s1', ['a', 'b']), study('s2', ['c'])]
  session.ingest = { sourceKind: 'folder', sourcePath: '/tmp', tempDir: null, scannedFileCount: 3, failures: [], studies } as IngestResult
  session.anon = {
    outputDir: '/tmp/anonymised',
    files: ['a', 'b', 'c'].map((id) => ({
      sourcePath: `/tmp/${id}.dcm`,
      frame: 0,
      outputPath: `/tmp/anonymised/${id}.dcm`,
      sha256: hashes[id] ?? id,
      byteLength: 10
    })),
    warnings: [],
    errors: []
  }
}

const request = (caseId: string | null = null) => ({
  caseId,
  caseDraft: {
    title: 'Case',
    presentation: '',
    systemId: 1,
    diagnosticCertaintyId: null,
    age: null,
    gender: null,
    body: null
  },
  studies: [
    { studyId: 's1', modality: 'MRI', findings: '', caption: '', stackIds: ['a', 'b'] },
    { studyId: 's2', modality: 'MRI', findings: '', caption: '', stackIds: ['c'] }
  ]
})

function fakeClient(drafts: string[] = ['case-1']) {
  let studies = 0
  return {
    currentUser: vi.fn(async () => ({ username: 'me', quota: null })),
    createCase: vi.fn(async () => 'case-1'),
    createStudy: vi.fn(async () => `rp-study-${++studies}`),
    draftCases: vi.fn(async () => drafts.map((id) => ({ id, title: null, status: 'draft', visibility: null, updatedAt: null })))
  }
}

/** The stacks uploadStack was asked for, by the file each one sent. */
const sentStacks = (): string[] => uploadStack.mock.calls.map((call) => call[3][0].sha256)

/** A first attempt that sends stack a and stops on b. */
async function stopAfterFirstStack(c: ReturnType<typeof fakeClient>): Promise<void> {
  uploadStack.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new TypeError('fetch failed'))
  await uploadCase(c as never, request(), () => {}).catch(() => {})
  uploadStack.mockReset()
}

beforeEach(() => {
  uploadStack.mockReset()
  stored = {}
  prepare()
})

describe('uploadCase', () => {
  it('says it stopped partway, and records what was done without any patient identifier', async () => {
    const c = fakeClient()
    uploadStack.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new TypeError('fetch failed'))

    await expect(uploadCase(c as never, request(), () => {})).rejects.toThrow(`${STOPPED_PARTWAY}: fetch failed`)
    const record = stored.interruptedUpload!
    expect(record.caseId).toBe('case-1')
    expect(record.stacksDone).toHaveLength(1)
    expect(record.planned).toHaveLength(3)
    expect(Object.values(record.studies)).toEqual(['rp-study-1'])
    // Study keys are one-way hashes, never the StudyInstanceUID itself.
    expect(JSON.stringify(record)).not.toContain('"s1"')
  })

  it('carries on in the same case after a restart, from the series that stopped', async () => {
    const c = fakeClient()
    await stopAfterFirstStack(c)

    // A restart: the session is gone, the same study is imported and anonymised
    // again, and the config file is what remains.
    prepare()
    expect(await interruptedForSelection()).toEqual({ caseId: 'case-1', savedAt: expect.any(String) })

    const result = await uploadCase(c as never, request('case-1'), () => {})
    expect(result.caseId).toBe('case-1')
    expect(c.createCase).toHaveBeenCalledTimes(1)
    // The first study was made before the stop; only the second is new.
    expect(c.createStudy).toHaveBeenCalledTimes(2)
    expect(sentStacks()).toEqual(['b', 'c'])
    expect(uploadStack.mock.calls[0][2]).toBe('rp-study-1')
    expect(stored.interruptedUpload).toBeUndefined()
  })

  it('does not carry on when a series already uploaded has changed since', async () => {
    // Stack a went up, then a mask was drawn on it: what is on Radiopaedia is
    // the unmasked version, so a has to go up again, into a new series.
    const c = fakeClient()
    await stopAfterFirstStack(c)
    prepare({ a: 'a-with-mask' })

    expect(await interruptedForSelection()).toBeNull()
    await uploadCase(c as never, request('case-1'), () => {})
    expect(sentStacks()).toEqual(['a-with-mask', 'b', 'c'])
  })

  it('does not put an unrelated study into the old case', async () => {
    const c = fakeClient()
    await stopAfterFirstStack(c)
    prepare({ a: 'x', b: 'y', c: 'z' })

    expect(await interruptedForSelection()).toBeNull()
  })

  it('makes a new case when a new case is asked for, whatever stopped before', async () => {
    const c = fakeClient()
    await stopAfterFirstStack(c)

    await uploadCase(c as never, request(null), () => {})
    expect(c.createCase).toHaveBeenCalledTimes(2)
    expect(sentStacks()).toEqual(['a', 'b', 'c'])
  })

  it('does not carry on into a different draft', async () => {
    const c = fakeClient(['case-1', 'case-9'])
    await stopAfterFirstStack(c)

    const result = await uploadCase(c as never, request('case-9'), () => {})
    expect(result.caseId).toBe('case-9')
    expect(sentStacks()).toEqual(['a', 'b', 'c'])
  })

  it('forgets the stopped upload when its case is no longer a draft', async () => {
    const c = fakeClient()
    await stopAfterFirstStack(c)
    c.draftCases.mockResolvedValue([])

    await expect(uploadCase(c as never, request('case-1'), () => {})).rejects.toThrow(/no longer a draft/)
    expect(stored.interruptedUpload).toBeUndefined()
  })

  it('does not call a failure to create the case a stop partway, since nothing was made', async () => {
    const c = fakeClient()
    c.createCase.mockRejectedValueOnce(new Error('422 Unprocessable Entity'))

    await expect(uploadCase(c as never, request(), () => {})).rejects.toThrow(/^422/)
    expect(stored.interruptedUpload).toBeUndefined()
  })
})
