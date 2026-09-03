import { compressionOf } from '@shared/dicomImage'
import { cross, describePlane, dot, normalise, type Vec3 } from '@shared/geometry'
import { nearestAgeOption } from '@shared/radiopaedia'
import { canDecode } from '../codecs/decode'
import type { ImageComponent, Series, SliceRef, Stack, StackKind, Study } from '@shared/types'
import { ageInYears, type InstanceMeta } from './dicom'

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

/**
 * What the grouping actually works on: one image, which is usually one file and
 * sometimes one frame of one.
 *
 * A legacy exporter writes a dynamic series as hundreds of instances and this
 * is one per file. An enhanced MR or CT writes the same acquisition as a single
 * object and says what separates its frames in the per-frame functional groups
 * — so when a file describes its frames one by one, this is one per frame and
 * everything downstream groups, orders and labels them without knowing the
 * difference.
 */
interface Unit {
  instance: InstanceMeta
  /** Frame within the file; null when the whole instance is one unit. */
  frame: number | null
  component: ImageComponent
  bValue: number | null
  echoNumber: number | null
  echoTime: number | null
  temporalIndex: number | null
  sliceLocation: number | null
  triggerTime: number | null
  acquisitionTime: string | null
  stackId: string | null
  inStackPosition: number | null
}

function unitsOf(instances: InstanceMeta[]): Unit[] {
  return instances.flatMap((instance): Unit[] => {
    const whole: Unit = {
      instance,
      frame: null,
      component: instance.component,
      bValue: instance.bValue,
      echoNumber: instance.echoNumber,
      echoTime: instance.echoTime,
      temporalIndex: instance.temporalPositionIdentifier,
      sliceLocation: instance.sliceLocation,
      triggerTime: instance.triggerTime,
      acquisitionTime: instance.acquisitionTime,
      stackId: null,
      inStackPosition: null
    }
    if (instance.frames === null) return [whole]

    // The header of an enhanced object still carries what the frames have in
    // common, so anything a frame does not say for itself falls back to it.
    return instance.frames.map((f) => ({
      ...whole,
      frame: f.frame,
      component: f.component,
      bValue: f.bValue ?? instance.bValue,
      echoNumber: f.echoNumber ?? instance.echoNumber,
      echoTime: f.echoTime ?? instance.echoTime,
      temporalIndex: f.temporalIndex ?? instance.temporalPositionIdentifier,
      sliceLocation: f.sliceLocation ?? instance.sliceLocation,
      triggerTime: f.triggerTime ?? instance.triggerTime,
      acquisitionTime: f.acquisitionTime ?? instance.acquisitionTime,
      stackId: f.stackId,
      inStackPosition: f.inStackPosition
    }))
  })
}

function dimensionsOf(unit: Unit): Dimensions {
  return {
    component: unit.component,
    bValue: unit.bValue,
    echoNumber: unit.echoNumber,
    temporalIndex: unit.temporalIndex
  }
}

function dimensionKey(d: Dimensions): string {
  return [d.component, d.bValue ?? '-', d.echoNumber ?? '-', d.temporalIndex ?? '-'].join('|')
}

/** The direction an image looks, or null when it does not say. */
function normalOf(orientation: number[] | null): Vec3 | null {
  if (orientation === null || orientation.length !== 6) return null
  const normal = cross(orientation.slice(0, 3) as Vec3, orientation.slice(3, 6) as Vec3)
  return normal.every((v) => v === 0) ? null : normalise(normal)
}

/** Two normals this far apart are the same one, about a tenth of a degree. */
const SAME_PLANE_COSINE = 0.9999

/**
 * Were all these images cut the same way?
 *
 * It matters because `sliceLocation` is ImagePositionPatient projected on the
 * image's *own* normal, which is a coordinate on a shared axis only while there
 * is one. A rotating MIP has none: sixty projections around the neck, each
 * looking from its own angle, and each one's distance along its own normal
 * traces a sine wave that climbs, comes back down and climbs again. Ordering by
 * that deals the rotation out like a pack of cards — a run that turns smoothly
 * on a workstation jumps from one side to the other and back here.
 *
 * Only a normal that positively disagrees counts. An image that does not say
 * which way it points is left to the ones that do, because reading silence as
 * disagreement would reorder every series with one such image in it.
 */
function sharePlane(units: Unit[]): boolean {
  let first: Vec3 | null = null
  for (const unit of units) {
    const normal = normalOf(unit.instance.imageOrientation)
    if (normal === null) continue
    if (first === null) first = normal
    else if (dot(first, normal) < SAME_PLANE_COSINE) return false
  }
  return true
}

/**
 * Order images within a stack. ImagePositionPatient projected on the slice
 * normal is preferred; InstanceNumber is the fallback for non-volumetric data,
 * and for images that were not all cut the same way, where the projection is
 * not a position on any one axis.
 *
 * StackID comes first, and only enhanced objects have one. A file that holds
 * three orthogonal localisers holds three volumes, and ordering their frames
 * against each other by position interleaves them into one that is no volume
 * at all — keeping them apart is the least this can do about that.
 */
function sortSlices(units: Unit[], byPosition: boolean): Unit[] {
  return [...units].sort((a, b) => {
    if (a.stackId !== b.stackId) {
      return (a.stackId ?? '').localeCompare(b.stackId ?? '', undefined, { numeric: true })
    }
    if (byPosition && a.sliceLocation !== null && b.sliceLocation !== null && a.sliceLocation !== b.sliceLocation) {
      return a.sliceLocation - b.sliceLocation
    }
    const byInstance = (a.instance.instanceNumber ?? 0) - (b.instance.instanceNumber ?? 0)
    if (byInstance !== 0) return byInstance
    if (a.inStackPosition !== null && b.inStackPosition !== null && a.inStackPosition !== b.inStackPosition) {
      return a.inStackPosition - b.inStackPosition
    }
    return (a.frame ?? 0) - (b.frame ?? 0)
  })
}

/** Time key for ordering repeats of the same slice in a dynamic acquisition. */
function temporalSortKey(unit: Unit): number {
  if (unit.triggerTime !== null) return unit.triggerTime
  if (unit.acquisitionTime !== null) {
    // DICOM TM is HHMMSS.FFFFFF — parse to seconds since midnight.
    const m = /^(\d{2})(\d{2})(\d{2}(?:\.\d+)?)$/.exec(unit.acquisitionTime)
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
  }
  return unit.frame ?? unit.instance.instanceNumber ?? 0
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
function splitByRepetition(units: Unit[]): Unit[][] | null {
  const byLocation = new Map<string, Unit[]>()
  for (const unit of units) {
    if (unit.sliceLocation === null) return null
    // Round to 0.01 mm so float noise does not fragment the groups.
    const key = unit.sliceLocation.toFixed(2)
    const bucket = byLocation.get(key)
    if (bucket) bucket.push(unit)
    else byLocation.set(key, [unit])
  }

  const counts = [...byLocation.values()].map((v) => v.length)
  const repeats = counts[0]
  // Require a consistent, genuine repetition across every slice position.
  if (repeats < 2 || !counts.every((c) => c === repeats)) return null
  if (byLocation.size < 2) return null

  const phases: Unit[][] = Array.from({ length: repeats }, () => [])
  for (const bucket of byLocation.values()) {
    const ordered = [...bucket].sort((a, b) => temporalSortKey(a) - temporalSortKey(b))
    ordered.forEach((unit, i) => phases[i].push(unit))
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
function toSliceRefs(unit: Unit): SliceRef[] {
  const { instance } = unit
  // A frame that described itself is already one unit, and expanding it again
  // would put every frame of the file into every stack it was split into.
  if (unit.frame !== null) {
    return [
      {
        path: instance.path,
        frame: unit.frame,
        instanceNumber: instance.instanceNumber,
        sliceLocation: unit.sliceLocation,
        sopInstanceUid: instance.sopInstanceUid
      }
    ]
  }
  const frames = Math.max(1, Math.floor(instance.numberOfFrames))
  return Array.from({ length: frames }, (_, frame) => ({
    path: instance.path,
    frame,
    instanceNumber: instance.instanceNumber,
    sliceLocation: instance.sliceLocation,
    sopInstanceUid: instance.sopInstanceUid
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
function unsupportedReason(units: Unit[]): string | null {
  const blocked = units.find(
    ({ instance: m }) =>
      m.numberOfFrames > 1 &&
      compressionOf(m.transferSyntaxUid) !== null &&
      !canDecode(m.transferSyntaxUid ?? '')
  )?.instance
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
  // One unit per image, which for an enhanced object is one per frame: the
  // whole of a dynamic acquisition can arrive as a single file, and what
  // separates its phases is written per frame rather than per instance.
  const units = unitsOf(instances)

  const groups = new Map<string, Unit[]>()
  for (const unit of units) {
    const key = dimensionKey(dimensionsOf(unit))
    const bucket = groups.get(key)
    if (bucket) bucket.push(unit)
    else groups.set(key, [unit])
  }

  // Which dimensions actually vary across the series?
  const varying = new Set<StackKind>()
  const distinct = <T>(pick: (u: Unit) => T): number => new Set(units.map(pick)).size
  if (distinct((u) => u.component) > 1) varying.add('component')
  if (distinct((u) => u.bValue) > 1) varying.add('diffusion')
  if (distinct((u) => u.echoNumber) > 1) varying.add('echo')
  if (distinct((u) => u.temporalIndex) > 1) varying.add('phase')

  const stacks: Stack[] = []
  for (const [, group] of groups) {
    const dims = dimensionsOf(group[0])
    const shared = sharePlane(group)
    // Only look for implicit repetition when the series has no explicit time
    // axis — and only where a position means the same thing twice. Among
    // projections taken from different directions, two that share a distance
    // are two views that happen to face alike, not one slice acquired twice.
    const repeated = varying.has('phase') || !shared ? null : splitByRepetition(group)

    if (repeated) {
      varying.add('phase')
      repeated.forEach((phaseUnits, i) => {
        stacks.push(makeStack(seriesId, stacks.length, dims, i + 1, phaseUnits, varying, shared))
      })
    } else {
      const phaseIndex = dims.temporalIndex
      stacks.push(makeStack(seriesId, stacks.length, dims, phaseIndex, group, varying, shared))
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

/**
 * The plane these images were cut on, named in the patient's own axes.
 *
 * The normal of the row and column directions is what the plane *is*; the words
 * are the ones a reader would use, and anything that is not one of the three is
 * Oblique rather than a guess at the nearest.
 */
function planeOf(orientation: number[] | null): string | null {
  const normal = normalOf(orientation)
  return normal === null ? null : describePlane(normal)
}

/**
 * What this stack weighs.
 *
 * A stack that took every frame of its files gets their whole size. One that
 * took some of the frames — a phase out of an enhanced object, a b-value out of
 * a run — gets that share of them, so the stacks of a split file add up to the
 * file rather than to a copy of it each.
 */
function bytesOf(units: Unit[]): number {
  const instances = new Map<string, InstanceMeta>()
  const framesUsed = new Map<string, number>()
  for (const unit of units) {
    instances.set(unit.instance.path, unit.instance)
    const taken = unit.frame === null ? Math.max(1, Math.floor(unit.instance.numberOfFrames)) : 1
    framesUsed.set(unit.instance.path, (framesUsed.get(unit.instance.path) ?? 0) + taken)
  }

  let total = 0
  for (const instance of instances.values()) {
    const frames = Math.max(1, Math.floor(instance.numberOfFrames))
    const share = Math.min(1, (framesUsed.get(instance.path) ?? 0) / frames)
    total += instance.byteLength * share
  }
  return Math.round(total)
}

function makeStack(
  seriesId: string,
  index: number,
  dims: Dimensions,
  phaseIndex: number | null,
  units: Unit[],
  varying: Set<StackKind>,
  sharedPlane: boolean
): Stack {
  const sorted = sortSlices(units, sharedPlane)
  const slices = sorted.flatMap(toSliceRefs)
  const unsupported = unsupportedReason(units)
  return {
    id: `${seriesId}::stack-${index}`,
    kind: primaryKind(varying),
    label: buildLabel(dims, phaseIndex, units[0].echoTime, varying),
    component: dims.component,
    bValue: dims.bValue,
    echoNumber: dims.echoNumber,
    phaseIndex,
    acquisitionTime: units[0].acquisitionTime,
    slices,
    selected: unsupported === null,
    trimStart: 0,
    trimEnd: slices.length - 1,
    dropped: [],
    masks: [],
    crop: null,
    window: null,
    // The first image's plane is the stack's only while they all share one;
    // naming a rotating MIP after the projection that happens to come first
    // says something about it that is not true of the rest.
    plane: sharedPlane ? planeOf(units[0].instance.imageOrientation) : null,
    sharedPlane,
    bytes: bytesOf(units),
    compression: compressionOf(units[0].instance.transferSyntaxUid),
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

/**
 * The patient as the case form will offer them: an age from the list, and a sex
 * only where Radiopaedia has a word for it.
 *
 * Instances of one study can disagree — a series re-sent from a different
 * workstation, an exporter that fills one tag and not another — so the first
 * instance that says anything is taken rather than an average of a handful of
 * values that should have been identical.
 */
function patientOf(instances: InstanceMeta[], studyDate: string | null): {
  age: string | null
  sex: 'Male' | 'Female' | null
} {
  let age: string | null = null
  for (const instance of instances) {
    const years = ageInYears(instance.patientAge, instance.patientBirthDate, studyDate)
    if (years !== null) {
      age = nearestAgeOption(years)
      break
    }
  }

  const sex = instances.find((instance) => instance.patientSex !== null)?.patientSex?.trim().toUpperCase()
  return { age, sex: sex === 'M' ? 'Male' : sex === 'F' ? 'Female' : null }
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

    // Some instances of a study may lack the date; take the first that has one.
    const studyDate = studyInstances.find((i) => i.studyDate !== null)?.studyDate ?? null
    const patient = patientOf(studyInstances, studyDate)

    studies.push({
      id: studyUid,
      studyInstanceUid: studyUid,
      studyDescription: studyInstances[0].studyDescription,
      modality: studyInstances[0].modality,
      studyDate,
      intervalDays: null,
      patientAge: patient.age,
      patientSex: patient.sex,
      series
    })
  }
  return orderByDate(studies)
}
