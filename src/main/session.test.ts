import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IngestResult, Stack } from '@shared/types'

// Session reaches for app.getPath only when it creates a working directory.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

const { session } = await import('./session')

function stack(id: string, sliceCount: number): Stack {
  return {
    id,
    kind: 'single',
    label: id,
    component: 'magnitude',
    bValue: null,
    echoNumber: null,
    phaseIndex: null,
    acquisitionTime: null,
    slices: Array.from({ length: sliceCount }, (_, i) => ({
      path: `/tmp/${id}-${i}.dcm`,
      frame: 0,
      instanceNumber: i,
      sliceLocation: i,
      sopInstanceUid: null
    })),
    selected: true,
    trimStart: 0,
    trimEnd: sliceCount - 1,
    masks: [],
    window: null
  }
}

function ingestWith(stacks: Stack[]): IngestResult {
  return {
    sourceKind: 'folder',
    sourcePath: '/tmp',
    tempDir: null,
    scannedFileCount: 0,
    failures: [],
    studies: [
      {
        id: 'study',
        studyInstanceUid: 'study',
        studyDescription: null,
        modality: 'MR',
        studyDate: null,
        intervalDays: 0,
        series: [
          {
            id: 'series',
            seriesInstanceUid: 'series',
            seriesNumber: 1,
            description: null,
            modality: 'MR',
            splitReason: null,
            stacks,
            instanceCount: stacks.reduce((n, s) => n + s.slices.length, 0)
          }
        ]
      }
    ]
  }
}

beforeEach(() => {
  session.ingest = ingestWith([stack('a', 10), stack('b', 5)])
})

describe('applySelection', () => {
  it('keeps only the stacks named in the selection', () => {
    session.applySelection([{ id: 'a', trimStart: 0, trimEnd: 9 }])
    expect(session.selectedStacks().map((s) => s.id)).toEqual(['a'])
  })

  it('applies the trim so anonymisation never sees the dropped images', () => {
    session.applySelection([{ id: 'a', trimStart: 2, trimEnd: 5 }])
    const [selected] = session.selectedStacks()
    expect(selected.slices).toHaveLength(4)
    expect(selected.slices.map((s) => s.instanceNumber)).toEqual([2, 3, 4, 5])
  })

  it('clamps a range that runs past the end of the stack', () => {
    session.applySelection([{ id: 'b', trimStart: -3, trimEnd: 99 }])
    const [selected] = session.selectedStacks()
    expect(selected.slices).toHaveLength(5)
  })

  it('refuses an inverted range rather than producing an empty upload', () => {
    session.applySelection([{ id: 'a', trimStart: 7, trimEnd: 2 }])
    const [selected] = session.selectedStacks()
    // trimEnd is pulled up to trimStart, leaving a single image.
    expect(selected.slices.map((s) => s.instanceNumber)).toEqual([7])
  })

  it('leaves the untrimmed stack whole', () => {
    session.applySelection([
      { id: 'a', trimStart: 0, trimEnd: 9 },
      { id: 'b', trimStart: 1, trimEnd: 3 }
    ])
    const byId = Object.fromEntries(session.selectedStacks().map((s) => [s.id, s.slices.length]))
    expect(byId).toEqual({ a: 10, b: 3 })
  })

  it('does not mutate the stored slices, so the trim stays adjustable', () => {
    session.applySelection([{ id: 'a', trimStart: 4, trimEnd: 6 }])
    expect(session.selectedStacks()[0].slices).toHaveLength(3)
    session.applySelection([{ id: 'a', trimStart: 0, trimEnd: 9 }])
    expect(session.selectedStacks()[0].slices).toHaveLength(10)
  })
})

describe('applySelection — masks and window', () => {
  const full = { id: 'a', trimStart: 0, trimEnd: 9 }

  it('carries the viewer’s edits through to the stacks that get anonymised', () => {
    session.applySelection([
      { ...full, masks: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }], window: { centre: 40, width: 400 } }
    ])
    const [selected] = session.selectedStacks()
    expect(selected.masks).toEqual([{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }])
    expect(selected.window).toEqual({ centre: 40, width: 400 })
  })

  it('clips a mask to the image, so a drag past the edge still blanks a real region', () => {
    session.applySelection([{ ...full, masks: [{ x: -0.5, y: 0.5, width: 2, height: 2 }], window: null }])
    expect(session.selectedStacks()[0].masks).toEqual([{ x: 0, y: 0.5, width: 1, height: 0.5 }])
  })

  it('drops masks that cover nothing and windows that mean nothing', () => {
    session.applySelection([
      {
        ...full,
        masks: [
          { x: 0.5, y: 0.5, width: 0, height: 0.2 },
          { x: Number.NaN, y: 0, width: 0.2, height: 0.2 }
        ],
        window: { centre: 40, width: 0 }
      }
    ])
    const [selected] = session.selectedStacks()
    expect(selected.masks).toEqual([{ x: 0, y: 0, width: 0.2, height: 0.2 }])
    expect(selected.window).toBeNull()
  })

  it('forgets edits made to a stack that was then deselected and re-selected', () => {
    session.applySelection([{ ...full, masks: [{ x: 0, y: 0, width: 0.5, height: 0.5 }] }])
    session.applySelection([full])
    expect(session.selectedStacks()[0].masks).toEqual([])
    expect(session.selectedStacks()[0].window).toBeNull()
  })
})
