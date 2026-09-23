import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IngestResult, Stack, Study } from '@shared/types'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, safeStorage: {}, shell: {}, dialog: {} }))
const uploadStack = vi.fn()
vi.mock('./api/upload', () => ({ uploadStack }))

const { session } = await import('./session')
const { uploadCase, STOPPED_PARTWAY } = await import('./uploadCase')

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

/** Two studies, the first with two stacks, all anonymised. */
function prepare(): void {
  const studies = [study('s1', ['a', 'b']), study('s2', ['c'])]
  session.ingest = { sourceKind: 'folder', sourcePath: '/tmp', tempDir: null, scannedFileCount: 3, failures: [], studies } as IngestResult
  session.anon = {
    outputDir: '/tmp/anonymised',
    files: ['a', 'b', 'c'].map((id) => ({
      sourcePath: `/tmp/${id}.dcm`,
      frame: 0,
      outputPath: `/tmp/anonymised/${id}.dcm`,
      sha256: id,
      byteLength: 10
    })),
    warnings: [],
    errors: []
  }
  session.uploadSoFar = null
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

beforeEach(() => {
  uploadStack.mockReset()
  prepare()
})

describe('uploadCase', () => {
  it('says it stopped partway, and remembers what was done before it stopped', async () => {
    const c = fakeClient()
    uploadStack.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new TypeError('fetch failed'))

    await expect(uploadCase(c as never, request(), () => {})).rejects.toThrow(`${STOPPED_PARTWAY}: fetch failed`)
    expect(session.uploadSoFar?.caseId).toBe('case-1')
    expect([...session.uploadSoFar!.stacksDone]).toEqual(['a'])
    expect([...session.uploadSoFar!.studies]).toEqual([['s1', 'rp-study-1']])
  })

  it('carries on in the same case, from the series that stopped', async () => {
    const c = fakeClient()
    uploadStack.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new TypeError('fetch failed'))
    await uploadCase(c as never, request(), () => {}).catch(() => {})
    uploadStack.mockReset()

    const result = await uploadCase(c as never, request(), () => {})

    expect(result.caseId).toBe('case-1')
    expect(c.createCase).toHaveBeenCalledTimes(1)
    // The first study was made before the stop; only the second is new.
    expect(c.createStudy).toHaveBeenCalledTimes(2)
    expect(sentStacks()).toEqual(['b', 'c'])
    expect(uploadStack.mock.calls[0][2]).toBe('rp-study-1')
    expect(session.uploadSoFar).toBeNull()
  })

  it('does not carry on when the request names a different draft', async () => {
    const c = fakeClient(['case-1', 'case-9'])
    uploadStack.mockRejectedValueOnce(new Error('S3 upload failed'))
    await uploadCase(c as never, request(), () => {}).catch(() => {})
    uploadStack.mockReset()

    const result = await uploadCase(c as never, request('case-9'), () => {})

    expect(result.caseId).toBe('case-9')
    expect(sentStacks()).toEqual(['a', 'b', 'c'])
  })

  it('starts over when the case it would carry on is no longer a draft', async () => {
    const c = fakeClient()
    uploadStack.mockRejectedValueOnce(new Error('S3 upload failed'))
    await uploadCase(c as never, request(), () => {}).catch(() => {})
    c.draftCases.mockResolvedValue([])

    await expect(uploadCase(c as never, request(), () => {})).rejects.toThrow(/no longer a draft/)
    expect(session.uploadSoFar).toBeNull()
  })

  it('does not call a failure to create the case a stop partway, since nothing was made', async () => {
    const c = fakeClient()
    c.createCase.mockRejectedValueOnce(new Error('422 Unprocessable Entity'))

    await expect(uploadCase(c as never, request(), () => {})).rejects.toThrow(/^422/)
    expect(session.uploadSoFar).toBeNull()
  })

  it('forgets how far it got once the selection changes', async () => {
    const c = fakeClient()
    uploadStack.mockRejectedValueOnce(new Error('S3 upload failed'))
    await uploadCase(c as never, request(), () => {}).catch(() => {})

    session.applySelection([])
    expect(session.uploadSoFar).toBeNull()
  })
})
