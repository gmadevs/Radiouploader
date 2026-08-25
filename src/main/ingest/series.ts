import { compressionOf } from '@shared/dicomImage'
import { canDecode } from '../codecs/decode'
import type { ImageComponent, Series, SliceRef, Stack, StackKind, Study } from '@shared/types'
import type { InstanceMeta } from './dicom'

const COMPONENT_LABELS: Record<ImageComponent, string> = {
  magnitude: 'Magnitude',
  phase: 'Phase',
  real: 'Real',
  imaginary: 'Imaginary',
  swi: 'SWI',
  mip: 'mIP',
  adc: 'ADC',
  derived: 'Derived',
  unknown: 'Unknown'
}

/**
 * Components that are normally what you want on a published case. Phase, real
 * and imaginary maps are kept available but off by default: on an SWI series
 * the magnitude and the mIP carry the findings, and the phase map is mostly
 * useful for confirming blood products.
 */
const DEFAULT_ON: ReadonlySet<ImageComponent> = new Set<ImageComponent>([
  'magnitude',
  'swi',
  'mip',
  'adc',
  'derived',
  'unknown'
])

interface Dimensions {
  component: ImageComponent
  bValue: number | null
  echoNumber: number | null
  temporalIndex: number | null
}

function dimensionsOf(meta: InstanceMeta): Dimensions {
  return {
    component: meta.component,
    bValue: meta.bValue,
    echoNumber: meta.echoNumber,
    temporalIndex: meta.temporalPositionIdentifier
  }
}

function dimensionKey(d: Dimensions): string {
  return [d.component, d.bValue ?? '-', d.echoNumber ?? '-', d.temporalIndex ?? '-'].join('|')
}

/**
 * Order instances within a stack. ImagePositionPatient projected on the slice
 * normal is preferred; InstanceNumber is the fallback for non-volumetric data.
 */
function sortSlices(instances: InstanceMeta[]): InstanceMeta[] {
  return [...instances].sort((a, b) => {
    if (a.sliceLocation !== null && b.sliceLocation !== null && a.sliceLocation !== b.sliceLocation) {
      return a.sliceLocation - b.sliceLocation
    }
    return (a.instanceNumber ?? 0) - (b.instanceNumber ?? 0)
  })
}

/** Time key for ordering repeats of the same slice in a dynamic acquisition. */
function temporalSortKey(meta: InstanceMeta): number {
  if (meta.triggerTime !== null) return meta.triggerTime
  if (meta.acquisitionTime !== null) {
    // DICOM TM is HHMMSS.FFFFFF — parse to seconds since midnight.
    const m = /^(\d{2})(\d{2})(\d{2}(?:\.\d+)?)$/.exec(meta.acquisitionTime)
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
  }
  return meta.instanceNumber ?? 0
}

/**
 * Split a dynamic acquisition that carries no TemporalPositionIdentifier.
 *
 * Many scanners export a multiphase study as one series where each slice
 * position simply recurs once per phase. Detect that by looking for repeated
 * slice locations, then assign a phase index by ordering the repeats of each
 * location in time.
 *
 * Returns null when the series does not look like a repeated acquisition.
 */
function splitByRepetition(instances: InstanceMeta[]): InstanceMeta[][] | null {
  const byLocation = new Map<string, InstanceMeta[]>()
  for (const inst of instances) {
    if (inst.sliceLocation === null) return null
    // Round to 0.01 mm so float noise does not fragment the groups.
    const key = inst.sliceLocation.toFixed(2)
    const bucket = byLocation.get(key)
    if (bucket) bucket.push(inst)
    else byLocation.set(key, [inst])
  }

  const counts = [...byLocation.values()].map((v) => v.length)
  const repeats = counts[0]
  // Require a consistent, genuine repetition across every slice position.
  if (repeats < 2 || !counts.every((c) => c === repeats)) return null
  if (byLocation.size < 2) return null

  const phases: InstanceMeta[][] = Array.from({ length: repeats }, () => [])
  for (const bucket of byLocation.values()) {
    const ordered = [...bucket].sort((a, b) => temporalSortKey(a) - temporalSortKey(b))
    ordered.forEach((inst, i) => phases[i].push(inst))
  }
  return phases
}

/**
 * Expand one instance into its slices.
 *
 * A cine or enhanced object holds many frames in a single file, so it becomes
 * one SliceRef per frame — otherwise a 200-frame angiography run would show as
 * a single unscrubbable image. Anonymisation and upload deduplicate by path, so
 * the file is still processed and sent once.
 */
function toSliceRefs(meta: InstanceMeta): SliceRef[] {
  const frames = Math.max(1, Math.floor(meta.numberOfFrames))
  return Array.from({ length: frames }, (_, frame) => ({
    path: meta.path,
    frame,
    instanceNumber: meta.instanceNumber,
    sliceLocation: meta.sliceLocation,
    sopInstanceUid: meta.sopInstanceUid
  }))
}

/**
 * Why this stack cannot be uploaded, if it cannot.
 *
 * A multiframe object holds its frames as fragments when it is compressed, so
 * they have to be decoded before they can be sent one by one — and sending the
 * file whole is not an answer, because Radiopaedia does not expand multiframe
 * objects and would publish a run of dozens as its first frame. A run in a
 * format this app decodes is fine; one in a format it does not is not, and it
 * says so here rather than during anonymisation, where the failure is per file
 * and takes the whole series out of the case behind a count of errors.
 */
function unsupportedReason(instances: InstanceMeta[]): string | null {
  const blocked = instances.find(
    (m) =>
      m.numberOfFrames > 1 &&
      compressionOf(m.transferSyntaxUid) !== null &&
      !canDecode(m.transferSyntaxUid ?? '')
  )
  if (blocked === undefined) return null
  const codec = compressionOf(blocked.transferSyntaxUid)
  return `${codec} multiframe — this app has no decoder for it, so the run cannot be split or uploaded`
}

function buildLabel(d: Dimensions, phaseIndex: number | null, echoTime: number | null, multi: Set<StackKind>): string {
  const parts: string[] = []
  if (multi.has('component')) parts.push(COMPONENT_LABELS[d.component])
  if (multi.has('diffusion') && d.bValue !== null) parts.push(`b=${d.bValue}`)
  if (multi.has('echo') && d.echoNumber !== null) {
    parts.push(echoTime !== null ? `Echo ${d.echoNumber} (TE ${echoTime} ms)` : `Echo ${d.echoNumber}`)
  }
  if (multi.has('phase') && phaseIndex !== null) parts.push(`Phase ${phaseIndex}`)
  return parts.length > 0 ? parts.join(' · ') : 'All images'
}

/**
 * Group the instances of one series into stacks.
 *
 * A series is split along every dimension that actually varies within it —
 * component, b-value, echo, time point — because these routinely co-occur (an
 * SWI series carries magnitude and phase; a diffusion series carries several
 * b-values and often the ADC map). `splitReason` reports the most salient one
 * for display.
 */
export function buildStacks(seriesId: string, instances: InstanceMeta[]): { stacks: Stack[]; splitReason: StackKind | null } {
  const groups = new Map<string, InstanceMeta[]>()
  for (const inst of instances) {
    const key = dimensionKey(dimensionsOf(inst))
    const bucket = groups.get(key)
    if (bucket) bucket.push(inst)
    else groups.set(key, [inst])
  }

  // Which dimensions actually vary across the series?
  const varying = new Set<StackKind>()
  const distinct = <T>(pick: (m: InstanceMeta) => T): number => new Set(instances.map(pick)).size
  if (distinct((m) => m.component) > 1) varying.add('component')
  if (distinct((m) => m.bValue) > 1) varying.add('diffusion')
  if (distinct((m) => m.echoNumber) > 1) varying.add('echo')
  if (distinct((m) => m.temporalPositionIdentifier) > 1) varying.add('phase')

  const stacks: Stack[] = []
  for (const [, group] of groups) {
    const dims = dimensionsOf(group[0])
    // Only look for implicit repetition when the series has no explicit time axis.
    const repeated = varying.has('phase') ? null : splitByRepetition(group)

    if (repeated) {
      varying.add('phase')
      repeated.forEach((phaseInstances, i) => {
        stacks.push(makeStack(seriesId, stacks.length, dims, i + 1, phaseInstances, varying))
      })
    } else {
      const phaseIndex = dims.temporalIndex
      stacks.push(makeStack(seriesId, stacks.length, dims, phaseIndex, group, varying))
    }
  }

  // Re-label once the full set of varying dimensions is known (repetition
  // splitting can add 'phase' after the first groups were built).
  for (const stack of stacks) {
    const dims: Dimensions = {
      component: stack.component,
      bValue: stack.bValue,
      echoNumber: stack.echoNumber,
      temporalIndex: stack.phaseIndex
    }
    stack.label = buildLabel(dims, stack.phaseIndex, null, varying)
    stack.kind = primaryKind(varying)
  }

  stacks.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
  applyDefaultSelection(stacks, varying)
  // Whatever the defaults chose, nothing that cannot be uploaded is ticked.
  for (const stack of stacks) if (stack.unsupported !== null) stack.selected = false

  return { stacks, splitReason: stacks.length > 1 ? primaryKind(varying) : null }
}

function primaryKind(varying: Set<StackKind>): StackKind {
  if (varying.has('component')) return 'component'
  if (varying.has('diffusion')) return 'diffusion'
  if (varying.has('echo')) return 'echo'
  if (varying.has('phase')) return 'phase'
  return 'single'
}

function makeStack(
  seriesId: string,
  index: number,
  dims: Dimensions,
  phaseIndex: number | null,
  instances: InstanceMeta[],
  varying: Set<StackKind>
): Stack {
  const sorted = sortSlices(instances)
  const slices = sorted.flatMap(toSliceRefs)
  const unsupported = unsupportedReason(instances)
  return {
    id: `${seriesId}::stack-${index}`,
    kind: primaryKind(varying),
    label: buildLabel(dims, phaseIndex, instances[0].echoTime, varying),
    component: dims.component,
    bValue: dims.bValue,
    echoNumber: dims.echoNumber,
    phaseIndex,
    acquisitionTime: instances[0].acquisitionTime,
    slices,
    selected: unsupported === null,
    trimStart: 0,
    trimEnd: slices.length - 1,
    masks: [],
    window: null,
    unsupported
  }
}

/**
 * Pick sensible defaults so the common case needs no clicking:
 *  - drop phase/real/imaginary maps when a magnitude-like stack exists;
 *  - on a diffusion series keep the highest b-value (plus any ADC map);
 *  - keep every time point of a dynamic series — dropping phases is a
 *    deliberate choice, so the UI offers it rather than doing it silently.
 */
function applyDefaultSelection(stacks: Stack[], varying: Set<StackKind>): void {
  if (stacks.length <= 1) return

  if (varying.has('component')) {
    const hasPreferred = stacks.some((s) => DEFAULT_ON.has(s.component))
    if (hasPreferred) {
      for (const stack of stacks) stack.selected = DEFAULT_ON.has(stack.component)
    }
  }

  if (varying.has('diffusion')) {
    const bValues = stacks.map((s) => s.bValue).filter((b): b is number => b !== null)
    if (bValues.length > 1) {
      const maxB = Math.max(...bValues)
      for (const stack of stacks) {
        if (stack.bValue === null) continue
        if (stack.component === 'adc') continue
        stack.selected = stack.selected && stack.bValue === maxB
      }
    }
  }
}

/** Whole days from `from` to `to`, both ISO yyyy-mm-dd. */
function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

/**
 * Order studies as they were acquired and express each one as an offset from the
 * earliest. Radiopaedia presents a multi-study case as a timeline, and the
 * interval is the part that carries clinical meaning — the absolute dates are
 * both identifying and blanked by the anonymiser, so only the offsets survive.
 *
 * Studies with no readable date keep their original order and get a null
 * interval rather than being guessed at.
 */
function orderByDate(studies: Study[]): Study[] {
  const dated = studies.filter((s) => s.studyDate !== null)
  const undated = studies.filter((s) => s.studyDate === null)

  dated.sort((a, b) => (a.studyDate! < b.studyDate! ? -1 : a.studyDate! > b.studyDate! ? 1 : 0))
  const earliest = dated[0]?.studyDate ?? null

  for (const study of dated) {
    study.intervalDays = earliest === null ? null : daysBetween(earliest, study.studyDate!)
  }
  return [...dated, ...undated]
}

/** Assemble parsed instances into the study / series / stack tree. */
export function buildStudies(instances: InstanceMeta[]): Study[] {
  const byStudy = new Map<string, InstanceMeta[]>()
  for (const inst of instances) {
    const bucket = byStudy.get(inst.studyInstanceUid)
    if (bucket) bucket.push(inst)
    else byStudy.set(inst.studyInstanceUid, [inst])
  }

  const studies: Study[] = []
  for (const [studyUid, studyInstances] of byStudy) {
    const bySeries = new Map<string, InstanceMeta[]>()
    for (const inst of studyInstances) {
      const bucket = bySeries.get(inst.seriesInstanceUid)
      if (bucket) bucket.push(inst)
      else bySeries.set(inst.seriesInstanceUid, [inst])
    }

    const series: Series[] = []
    for (const [seriesUid, seriesInstances] of bySeries) {
      const id = `${studyUid}::${seriesUid}`
      const { stacks, splitReason } = buildStacks(id, seriesInstances)
      series.push({
        id,
        seriesInstanceUid: seriesUid,
        seriesNumber: seriesInstances[0].seriesNumber,
        description: seriesInstances[0].seriesDescription,
        modality: seriesInstances[0].modality,
        splitReason,
        stacks,
        instanceCount: seriesInstances.length
      })
    }
    series.sort((a, b) => (a.seriesNumber ?? 0) - (b.seriesNumber ?? 0))

    studies.push({
      id: studyUid,
      studyInstanceUid: studyUid,
      studyDescription: studyInstances[0].studyDescription,
      modality: studyInstances[0].modality,
      // Some instances of a study may lack the date; take the first that has one.
      studyDate: studyInstances.find((i) => i.studyDate !== null)?.studyDate ?? null,
      intervalDays: null,
      series
    })
  }
  return orderByDate(studies)
}
