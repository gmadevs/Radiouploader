import { describe, expect, it } from 'vitest'
import { ageInYears, classifyComponent } from './dicom'
import type { FrameMeta, InstanceMeta } from './dicom'
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
    transferSyntaxUid: '1.2.840.10008.1.2.1',
    patientAge: null,
    patientBirthDate: null,
    patientSex: null,
    frames: null,
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

describe('buildStacks — multiframe objects', () => {
  it('expands a cine run into one slice per frame so it can be scrubbed', () => {
    const { stacks } = buildStacks('s', [inst({ numberOfFrames: 17, sliceLocation: 0 })])
    expect(stacks).toHaveLength(1)
    expect(stacks[0].slices).toHaveLength(17)
    expect(stacks[0].slices.map((s) => s.frame)).toEqual([...Array(17).keys()])
    // Every frame points at the same file, which is uploaded once.
    expect(new Set(stacks[0].slices.map((s) => s.path)).size).toBe(1)
  })

  it('keeps several multiframe files in one stack, frames in order', () => {
    const { stacks } = buildStacks('s', [
      inst({ numberOfFrames: 3, instanceNumber: 1, sliceLocation: 0 }),
      inst({ numberOfFrames: 2, instanceNumber: 2, sliceLocation: 1 })
    ])
    expect(stacks[0].slices.map((s) => s.frame)).toEqual([0, 1, 2, 0, 1])
    expect(new Set(stacks[0].slices.map((s) => s.path)).size).toBe(2)
  })

  it('gives a single-frame instance exactly one slice at frame 0', () => {
    const { stacks } = buildStacks('s', [inst()])
    expect(stacks[0].slices).toEqual([expect.objectContaining({ frame: 0 })])
  })
})

describe('buildStacks — compressed multiframe', () => {
  /** MPEG-4: encapsulated like the rest, and a video rather than a stack. */
  const undecodableCine = (): InstanceMeta[] => [
    inst({ numberOfFrames: 40, transferSyntaxUid: '1.2.840.10008.1.2.4.102' })
  ]

  it('names the codec and refuses a run it cannot decode', () => {
    const { stacks } = buildStacks('s', undecodableCine())
    expect(stacks[0].unsupported).toContain('MPEG-4 (H.264)')
    expect(stacks[0].selected).toBe(false)
  })

  it('accepts an RLE run, which it decodes in plain JavaScript', () => {
    const { stacks } = buildStacks('s', [inst({ numberOfFrames: 40, transferSyntaxUid: '1.2.840.10008.1.2.5' })])
    expect(stacks[0].unsupported).toBeNull()
    expect(stacks[0].selected).toBe(true)
  })

  it('accepts a compressed run it can decode — the frames are split after decoding', () => {
    const { stacks } = buildStacks('s', [inst({ numberOfFrames: 40, transferSyntaxUid: '1.2.840.10008.1.2.4.50' })])
    expect(stacks[0].unsupported).toBeNull()
    expect(stacks[0].selected).toBe(true)
    expect(stacks[0].slices).toHaveLength(40)
  })

  it('treats an unrecognised transfer syntax as compressed too', () => {
    const { stacks } = buildStacks('s', [inst({ numberOfFrames: 4, transferSyntaxUid: '1.2.840.10008.1.2.4.95' })])
    expect(stacks[0].unsupported).not.toBeNull()
  })

  it('leaves a compressed single-frame image alone — it uploads untouched', () => {
    const { stacks } = buildStacks('s', [inst({ transferSyntaxUid: '1.2.840.10008.1.2.4.50' })])
    expect(stacks[0].unsupported).toBeNull()
    expect(stacks[0].selected).toBe(true)
  })

  it('leaves an uncompressed cine run alone — those are split fine', () => {
    const { stacks } = buildStacks('s', [inst({ numberOfFrames: 40 })])
    expect(stacks[0].unsupported).toBeNull()
    expect(stacks[0].selected).toBe(true)
  })

  it('stays unticked even when the defaults would have chosen it', () => {
    // A component split runs applyDefaultSelection, which ticks every
    // magnitude-like stack; the compressed cine must not come back with it.
    const { stacks } = buildStacks('s', [
      ...undecodableCine(),
      inst({ component: 'phase', imageType: ['ORIGINAL', 'PRIMARY', 'P'] })
    ])
    const blocked = stacks.find((stack) => stack.unsupported !== null)
    expect(blocked?.selected).toBe(false)
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

describe('ageInYears', () => {
  it('reads the unit rather than assuming years', () => {
    expect(ageInYears('045Y', null, null)).toBe(45)
    expect(ageInYears('018M', null, null)).toBeCloseTo(1.5)
    expect(ageInYears('006W', null, null)).toBeCloseTo(0.115, 3)
    expect(ageInYears('010D', null, null)).toBeCloseTo(0.027, 3)
  })

  it('tolerates the ways exporters write it', () => {
    expect(ageInYears('45Y', null, null)).toBe(45)
    expect(ageInYears('0045y', null, null)).toBe(45)
    expect(ageInYears(' 045Y ', null, null)).toBe(45)
  })

  it('falls back to the birth date against the study date', () => {
    expect(ageInYears(null, '1970-01-01', '2020-01-01')).toBeCloseTo(50, 1)
    expect(ageInYears(null, '2019-07-01', '2020-01-01')).toBeCloseTo(0.5, 1)
  })

  it('prefers the recorded age, which is what the scanner knew on the day', () => {
    expect(ageInYears('030Y', '1970-01-01', '2020-01-01')).toBe(30)
  })

  it('says nothing when the dates cannot mean what they say', () => {
    expect(ageInYears(null, '2021-01-01', '2020-01-01')).toBeNull()
    expect(ageInYears(null, null, '2020-01-01')).toBeNull()
    expect(ageInYears('', null, null)).toBeNull()
    expect(ageInYears('045X', null, null)).toBeNull()
  })
})

describe('buildStudies — the patient', () => {
  it('offers an age from the list and a sex the case form has a word for', () => {
    const [study] = buildStudies([
      inst({ patientAge: '047Y', patientSex: 'F', studyDate: '2020-01-01' })
    ])
    expect(study.patientAge).toBe('45 years')
    expect(study.patientSex).toBe('Female')
  })

  it('works out the age from the birth date when the tag is absent', () => {
    const [study] = buildStudies([
      inst({ patientBirthDate: '1970-01-01', patientSex: 'M', studyDate: '2020-01-01' })
    ])
    expect(study.patientAge).toBe('50 years')
    expect(study.patientSex).toBe('Male')
  })

  it('leaves both alone when the originals do not say', () => {
    const [study] = buildStudies([inst()])
    expect(study.patientAge).toBeNull()
    expect(study.patientSex).toBeNull()
  })

  it('has no word for a sex that is neither, so it offers none', () => {
    // O is what the sample study carries, and the case form has two choices.
    const [study] = buildStudies([inst({ patientSex: 'O' })])
    expect(study.patientSex).toBeNull()
  })

  it('does not turn a baby into a one-year-old', () => {
    const [study] = buildStudies([inst({ patientAge: '004M', studyDate: '2020-01-01' })])
    expect(study.patientAge).toBeNull()
  })

  it('takes the age at each study, so a follow-up is not aged at baseline', () => {
    const studies = buildStudies([
      inst({ studyInstanceUid: 'a', patientBirthDate: '1970-01-01', studyDate: '2010-01-01' }),
      inst({ studyInstanceUid: 'b', patientBirthDate: '1970-01-01', studyDate: '2020-01-01' })
    ])
    expect(studies.map((s) => s.patientAge)).toEqual(['40 years', '50 years'])
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

describe('buildStacks — enhanced multiframe', () => {
  /** One frame of an enhanced object, as its functional groups describe it. */
  const frame = (o: Partial<FrameMeta> & { frame: number }): FrameMeta => ({
    sliceLocation: null,
    component: 'magnitude',
    bValue: null,
    echoTime: null,
    echoNumber: null,
    temporalIndex: null,
    triggerTime: null,
    acquisitionTime: null,
    stackId: null,
    inStackPosition: null,
    ...o
  })

  const enhanced = (frames: FrameMeta[]): InstanceMeta[] => [
    inst({ numberOfFrames: frames.length, frames, sliceLocation: null })
  ]

  it('splits one file into a stack per phase', () => {
    // The whole of a dynamic acquisition in a single object, which is what an
    // enhanced MR writes and what used to arrive as one undivided stack.
    const { stacks, splitReason } = buildStacks(
      's',
      enhanced([
        frame({ frame: 0, temporalIndex: 1, sliceLocation: 0 }),
        frame({ frame: 1, temporalIndex: 1, sliceLocation: 5 }),
        frame({ frame: 2, temporalIndex: 2, sliceLocation: 0 }),
        frame({ frame: 3, temporalIndex: 2, sliceLocation: 5 })
      ])
    )
    expect(splitReason).toBe('phase')
    expect(stacks).toHaveLength(2)
    expect(stacks.map((s) => s.slices.map((slice) => slice.frame))).toEqual([
      [0, 1],
      [2, 3]
    ])
    expect(stacks.map((s) => s.phaseIndex)).toEqual([1, 2])
    // Every slice still points at the one file it all came from.
    expect(new Set(stacks.flatMap((s) => s.slices.map((slice) => slice.path))).size).toBe(1)
  })

  it('gives each frame one slice when nothing about them varies', () => {
    // The trap: a frame that described itself is already one unit, and
    // expanding it again would put all four frames into all four stacks.
    const { stacks } = buildStacks(
      's',
      enhanced([0, 1, 2, 3].map((i) => frame({ frame: i, sliceLocation: i })))
    )
    expect(stacks).toHaveLength(1)
    expect(stacks[0].slices.map((slice) => slice.frame)).toEqual([0, 1, 2, 3])
  })

  it('splits an enhanced diffusion object by b-value', () => {
    const { stacks, splitReason } = buildStacks(
      's',
      enhanced([
        frame({ frame: 0, bValue: 0, sliceLocation: 0 }),
        frame({ frame: 1, bValue: 0, sliceLocation: 5 }),
        frame({ frame: 2, bValue: 1000, sliceLocation: 0 }),
        frame({ frame: 3, bValue: 1000, sliceLocation: 5 })
      ])
    )
    expect(splitReason).toBe('diffusion')
    expect(stacks.map((s) => s.bValue)).toEqual([0, 1000])
    expect(stacks.map((s) => s.slices.length)).toEqual([2, 2])
  })

  it('splits by the echo number made from the effective echo times', () => {
    const { stacks, splitReason } = buildStacks(
      's',
      enhanced([
        frame({ frame: 0, echoNumber: 1, echoTime: 10, sliceLocation: 0 }),
        frame({ frame: 1, echoNumber: 2, echoTime: 80, sliceLocation: 0 }),
        frame({ frame: 2, echoNumber: 1, echoTime: 10, sliceLocation: 5 }),
        frame({ frame: 3, echoNumber: 2, echoTime: 80, sliceLocation: 5 })
      ])
    )
    expect(splitReason).toBe('echo')
    expect(stacks.map((s) => s.slices.map((slice) => slice.frame))).toEqual([
      [0, 2],
      [1, 3]
    ])
  })

  it('finds the phases of an enhanced object that does not number them', () => {
    // No temporal index, but each position recurs — the same repetition the
    // legacy path looks for, now visible inside a single file.
    const { stacks, splitReason } = buildStacks(
      's',
      enhanced([
        frame({ frame: 0, sliceLocation: 0, acquisitionTime: '100000' }),
        frame({ frame: 1, sliceLocation: 5, acquisitionTime: '100000' }),
        frame({ frame: 2, sliceLocation: 0, acquisitionTime: '100030' }),
        frame({ frame: 3, sliceLocation: 5, acquisitionTime: '100030' })
      ])
    )
    expect(splitReason).toBe('phase')
    expect(stacks.map((s) => s.slices.map((slice) => slice.frame))).toEqual([
      [0, 1],
      [2, 3]
    ])
  })

  it('keeps the frames of different StackIDs from interleaving', () => {
    // Three orthogonal localisers in one object are three volumes. Ordering
    // their frames against each other by position makes one that is no volume.
    const { stacks } = buildStacks(
      's',
      enhanced([
        frame({ frame: 0, stackId: '1', sliceLocation: 0 }),
        frame({ frame: 1, stackId: '2', sliceLocation: 2 }),
        frame({ frame: 2, stackId: '1', sliceLocation: 10 }),
        frame({ frame: 3, stackId: '2', sliceLocation: 12 })
      ])
    )
    expect(stacks).toHaveLength(1)
    expect(stacks[0].slices.map((slice) => slice.frame)).toEqual([0, 2, 1, 3])
  })

  it('still refuses an enhanced run in a format it cannot decode', () => {
    const { stacks } = buildStacks('s', [
      inst({
        numberOfFrames: 2,
        transferSyntaxUid: '1.2.840.10008.1.2.4.102',
        frames: [frame({ frame: 0, temporalIndex: 1 }), frame({ frame: 1, temporalIndex: 2 })]
      })
    ])
    expect(stacks.every((s) => s.unsupported !== null)).toBe(true)
    expect(stacks.every((s) => !s.selected)).toBe(true)
  })
})
