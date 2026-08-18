import { describe, expect, it } from 'vitest'
import { classifyComponent } from './dicom'
import type { InstanceMeta } from './dicom'
import { buildStacks, buildStudies } from './series'

let counter = 0

function inst(overrides: Partial<InstanceMeta> = {}): InstanceMeta {
  counter++
  return {
    path: `/tmp/img-${counter}.dcm`,
    studyInstanceUid: '1.2.3',
    seriesInstanceUid: '1.2.3.4',
    sopInstanceUid: `1.2.3.4.${counter}`,
    studyDescription: 'Brain',
    studyDate: '2024-01-15',
    studyTime: '143000',
    seriesDescription: 'Series',
    modality: 'MR',
    seriesNumber: 1,
    instanceNumber: counter,
    acquisitionNumber: 1,
    sliceLocation: 0,
    imageType: ['ORIGINAL', 'PRIMARY', 'M'],
    component: 'magnitude',
    echoNumber: 1,
    echoTime: 10,
    temporalPositionIdentifier: null,
    triggerTime: null,
    acquisitionTime: null,
    bValue: null,
    numberOfFrames: 1,
    ...overrides
  }
}

/** Build a volume of `slices` images sharing the given properties. */
function volume(slices: number, overrides: Partial<InstanceMeta> = {}): InstanceMeta[] {
  return Array.from({ length: slices }, (_, i) => inst({ sliceLocation: i * 5, ...overrides }))
}

describe('classifyComponent', () => {
  it('reads the vendor flavour out of ImageType', () => {
    expect(classifyComponent(['ORIGINAL', 'PRIMARY', 'M', 'ND'], null)).toBe('magnitude')
    expect(classifyComponent(['ORIGINAL', 'PRIMARY', 'P', 'ND'], null)).toBe('phase')
    expect(classifyComponent(['DERIVED', 'PRIMARY', 'SWI'], null)).toBe('swi')
    expect(classifyComponent(['DERIVED', 'SECONDARY', 'MIN IP'], null)).toBe('mip')
    expect(classifyComponent(['DERIVED', 'PRIMARY', 'ADC'], null)).toBe('adc')
  })

  it('prefers the standard ComplexImageComponent over ImageType', () => {
    expect(classifyComponent(['ORIGINAL', 'PRIMARY', 'M'], 'PHASE')).toBe('phase')
  })
})

describe('buildStacks — SWI', () => {
  const { stacks, splitReason } = buildStacks('s', [
    ...volume(20, { component: 'magnitude', imageType: ['ORIGINAL', 'PRIMARY', 'M'] }),
    ...volume(20, { component: 'phase', imageType: ['ORIGINAL', 'PRIMARY', 'P'] }),
    ...volume(20, { component: 'swi', imageType: ['DERIVED', 'PRIMARY', 'SWI'] }),
    ...volume(20, { component: 'mip', imageType: ['DERIVED', 'SECONDARY', 'MIN IP'] })
  ])

  it('splits magnitude / phase / SWI / mIP apart', () => {
    expect(splitReason).toBe('component')
    expect(stacks).toHaveLength(4)
    expect(stacks.every((s) => s.slices.length === 20)).toBe(true)
    expect(stacks.map((s) => s.label).sort()).toEqual(['Magnitude', 'Phase', 'SWI', 'mIP'])
  })

  it('leaves the phase map off by default but keeps it available', () => {
    const byLabel = Object.fromEntries(stacks.map((s) => [s.label, s.selected]))
    expect(byLabel).toEqual({ Magnitude: true, SWI: true, mIP: true, Phase: false })
  })
})

describe('buildStacks — diffusion', () => {
  const { stacks, splitReason } = buildStacks('s', [
    ...volume(25, { bValue: 0 }),
    ...volume(25, { bValue: 500 }),
    ...volume(25, { bValue: 1000 }),
    ...volume(25, { bValue: null, component: 'adc', imageType: ['DERIVED', 'PRIMARY', 'ADC'] })
  ])

  it('splits one stack per b-value and keeps the ADC map separate', () => {
    expect(splitReason).toBe('component')
    expect(stacks.map((s) => s.label)).toEqual(['ADC', 'Magnitude · b=0', 'Magnitude · b=500', 'Magnitude · b=1000'])
  })

  it('defaults to the highest b-value plus the ADC map', () => {
    const selected = stacks.filter((s) => s.selected).map((s) => s.label)
    expect(selected).toEqual(['ADC', 'Magnitude · b=1000'])
  })
})

describe('buildStacks — dynamic series', () => {
  it('splits on TemporalPositionIdentifier when the scanner provides it', () => {
    const { stacks, splitReason } = buildStacks('s', [
      ...volume(30, { temporalPositionIdentifier: 1 }),
      ...volume(30, { temporalPositionIdentifier: 2 }),
      ...volume(30, { temporalPositionIdentifier: 3 })
    ])
    expect(splitReason).toBe('phase')
    expect(stacks.map((s) => s.label)).toEqual(['Phase 1', 'Phase 2', 'Phase 3'])
    expect(stacks.every((s) => s.slices.length === 30)).toBe(true)
  })

  it('recovers phases from repeated slice positions when the tag is absent', () => {
    // Three phases interleaved as location-major order, distinguished only by time.
    const instances: InstanceMeta[] = []
    for (let slice = 0; slice < 10; slice++) {
      for (const t of [100, 200, 300]) {
        instances.push(inst({ sliceLocation: slice * 4, triggerTime: t }))
      }
    }
    const { stacks, splitReason } = buildStacks('s', instances)
    expect(splitReason).toBe('phase')
    expect(stacks).toHaveLength(3)
    expect(stacks.every((s) => s.slices.length === 10)).toBe(true)
  })

  it('keeps every time point selected — dropping phases must be deliberate', () => {
    const { stacks } = buildStacks('s', [
      ...volume(30, { temporalPositionIdentifier: 1 }),
      ...volume(30, { temporalPositionIdentifier: 2 })
    ])
    expect(stacks.every((s) => s.selected)).toBe(true)
  })
})

describe('buildStacks — plain series', () => {
  it('leaves an ordinary volume as a single stack', () => {
    const { stacks, splitReason } = buildStacks('s', volume(40))
    expect(splitReason).toBeNull()
    expect(stacks).toHaveLength(1)
    expect(stacks[0].slices).toHaveLength(40)
    expect(stacks[0].selected).toBe(true)
  })

  it('orders slices by position, not by file order', () => {
    const shuffled = [inst({ sliceLocation: 20 }), inst({ sliceLocation: 0 }), inst({ sliceLocation: 10 })]
    const { stacks } = buildStacks('s', shuffled)
    expect(stacks[0].slices.map((s) => s.sliceLocation)).toEqual([0, 10, 20])
  })

  it('does not mistake a two-slice localiser for a dynamic series', () => {
    const { stacks } = buildStacks('s', [inst({ sliceLocation: 0 }), inst({ sliceLocation: 0 })])
    expect(stacks).toHaveLength(1)
  })
})

describe('buildStudies — multi-study cases', () => {
  /** One study of `slices` images on a given date. */
  function study(uid: string, date: string | null, time = '090000'): InstanceMeta[] {
    return volume(5, { studyInstanceUid: uid, seriesInstanceUid: `${uid}.1`, studyDate: date, studyTime: time })
  }

  it('orders studies by date and measures each interval from the earliest', () => {
    const studies = buildStudies([
      ...study('1.2.3.B', '2024-03-01'),
      ...study('1.2.3.A', '2024-01-15'),
      ...study('1.2.3.C', '2025-01-15')
    ])

    expect(studies.map((s) => s.studyInstanceUid)).toEqual(['1.2.3.A', '1.2.3.B', '1.2.3.C'])
    expect(studies.map((s) => s.studyDate)).toEqual(['2024-01-15', '2024-03-01', '2025-01-15'])
    // 46 days to the follow-up, then a full leap year to the third study.
    expect(studies.map((s) => s.intervalDays)).toEqual([0, 46, 366])
  })

  it('keeps series separate per study rather than merging them', () => {
    const studies = buildStudies([...study('1.2.3.A', '2024-01-15'), ...study('1.2.3.B', '2024-03-01')])
    expect(studies).toHaveLength(2)
    expect(studies.every((s) => s.series.length === 1)).toBe(true)
    expect(studies.every((s) => s.series[0].stacks[0].slices.length === 5)).toBe(true)
  })

  it('does not invent an interval for a study with no readable date', () => {
    const studies = buildStudies([...study('1.2.3.A', '2024-01-15'), ...study('1.2.3.Z', null)])
    const undated = studies.find((s) => s.studyInstanceUid === '1.2.3.Z')!
    expect(undated.studyDate).toBeNull()
    expect(undated.intervalDays).toBeNull()
    // Dated studies still sort first so the timeline stays readable.
    expect(studies[0].studyInstanceUid).toBe('1.2.3.A')
  })

  it('gives a single-study import a zero interval', () => {
    const studies = buildStudies(study('1.2.3.A', '2024-01-15'))
    expect(studies[0].intervalDays).toBe(0)
  })
})
