import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import * as dcmio from 'dicomanon'
import type { Plane, Projection, ReformatPlan, Series, SliceRef, WindowLevel } from '@shared/types'
import { pixelSpacingOf, type BuiltVolume } from './build'
import { extent, reformatSlice, slabOffsets } from './reformat'

/**
 * Writing a reformat back out as DICOM.
 *
 * The derived images are ordinary instances written from the parent's own
 * header, so everything downstream treats them as what they are: they are
 * anonymised with the rest, uploaded with the rest, and they live in the
 * session's working directory, which is removed when the run is reset or the
 * app quits. They are *not* anonymised here — nothing in this app writes an
 * anonymised file except the anonymiser.
 */

/** UUID-derived OIDs, which need no registered root and collide with nothing. */
function uid(): string {
  return `2.25.${BigInt(`0x${randomUUID().replace(/-/g, '')}`).toString()}`
}

const PROJECTION_WORDS: Record<Projection, string> = {
  slice: 'MPR',
  mip: 'MIP',
  minip: 'MinIP',
  mean: 'Mean'
}

const PLANE_WORDS: Record<Plane, string> = {
  axial: 'Axial',
  coronal: 'Coronal',
  sagittal: 'Sagittal'
}

/** What the derived series is called, in the words a reader would use. */
export function describePlan(plan: ReformatPlan): string {
  const projection = PROJECTION_WORDS[plan.projection]
  const thickness = plan.projection === 'slice' ? '' : ` ${round(plan.thickness)} mm`
  return `${PLANE_WORDS[plan.plane]} ${projection}${thickness}`
}

function round(value: number): string {
  return String(Math.round(value * 10) / 10)
}

type Dict = Record<string, { vr: string; Value: unknown[] }>

/** Cross product, which is the direction a stack of images runs in. */
function cross(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function add(point: number[], direction: number[], distance: number): number[] {
  return [point[0] + direction[0] * distance, point[1] + direction[1] * distance, point[2] + direction[2] * distance]
}

const decimals = (values: number[]): string => values.map((value) => String(Math.round(value * 1e6) / 1e6)).join('\\')

/**
 * Where a reformatted image sits in the patient, and which way it runs.
 *
 * Without this the derived series would be a set of pictures with no geometry,
 * and anything that reads them back — this app included, on a second import —
 * would have no way to order them or to know which way up they go.
 */
function geometryFor(
  built: BuiltVolume,
  plane: Plane,
  offset: number
): { orientation: number[]; position: number[] } | null {
  const origin = built.header.imagePosition
  const cosines = built.header.imageOrientation
  if (origin === null || cosines === null) return null

  const row = cosines.slice(0, 3)
  const column = cosines.slice(3, 6)
  const normal = cross(row, column)
  const depth = extent(built.volume).z

  switch (plane) {
    case 'axial':
      return { orientation: [...row, ...column], position: add(origin, normal, offset) }
    // The reformat is built from the last slice down, so the image runs against
    // the stack: its column direction is the normal reversed.
    case 'coronal':
      return {
        orientation: [...row, -normal[0], -normal[1], -normal[2]],
        position: add(add(origin, column, offset), normal, depth)
      }
    case 'sagittal':
      return {
        orientation: [...column, -normal[0], -normal[1], -normal[2]],
        position: add(add(origin, row, offset), normal, depth)
      }
  }
}

/**
 * Reformat a volume and write the result as a series of files.
 *
 * Returns the series as the picker will show it, so the renderer can put it in
 * the tree beside the one it came from.
 */
export async function writeReformatted(
  built: BuiltVolume,
  plan: ReformatPlan,
  outputDir: string,
  parent: { seriesId: string; seriesNumber: number | null; description: string | null; modality: string | null; window: WindowLevel | null }
): Promise<Series> {
  await fs.mkdir(outputDir, { recursive: true })

  const source = await fs.readFile(built.sourcePath)
  const seriesUid = uid()
  const offsets = slabOffsets(built.volume, plan.plane, plan.spacing)
  const label = describePlan(plan)

  const wide = built.header.bitsAllocated > 8
  const low = wide ? (built.header.signed ? -32768 : 0) : 0
  const high = wide ? (built.header.signed ? 32767 : 65535) : 255

  const slices: SliceRef[] = []

  for (const [index, offset] of offsets.entries()) {
    const image = reformatSlice(built.volume, {
      ...plan,
      offset,
      pixelSpacing: pixelSpacingOf(built)
    })

    // Re-read the parent for every image: the writer mutates the dict it is
    // given, and one image's pixel data must not reach the next one's file.
    const message = dcmio.Message.readFile(
      source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer
    )
    const dict = message.dict as unknown as Dict

    const count = image.width * image.height
    const stored = wide ? new Uint8Array(count * 2) : new Uint8Array(count)
    const view = new DataView(stored.buffer)
    for (let i = 0; i < count; i++) {
      const value = Math.min(Math.max(Math.round(image.samples[i]), low), high)
      if (!wide) stored[i] = value
      else if (built.header.signed) view.setInt16(i * 2, value, true)
      else view.setUint16(i * 2, value, true)
    }

    dict['7FE00010'] = { vr: wide ? 'OW' : 'OB', Value: [stored.buffer as ArrayBuffer] }
    dict['00280010'] = { vr: 'US', Value: [image.height] }
    dict['00280011'] = { vr: 'US', Value: [image.width] }
    dict['00280030'] = { vr: 'DS', Value: [decimals([image.spacing, image.spacing])] }
    delete dict['00280008']

    dict['00180050'] = { vr: 'DS', Value: [round(plan.projection === 'slice' ? plan.spacing : plan.thickness)] }
    dict['00180088'] = { vr: 'DS', Value: [round(plan.spacing)] }

    const geometry = geometryFor(built, plan.plane, offset)
    if (geometry) {
      dict['00200037'] = { vr: 'DS', Value: [decimals(geometry.orientation)] }
      dict['00200032'] = { vr: 'DS', Value: [decimals(geometry.position)] }
    } else {
      delete dict['00200037']
      delete dict['00200032']
    }
    dict['00201041'] = { vr: 'DS', Value: [round(offset)] }

    dict['0020000E'] = { vr: 'UI', Value: [seriesUid] }
    dict['00080018'] = { vr: 'UI', Value: [uid()] }
    dict['00200013'] = { vr: 'IS', Value: [String(index + 1)] }
    dict['00200011'] = { vr: 'IS', Value: [String((parent.seriesNumber ?? 0) + 100)] }
    dict['0008103E'] = { vr: 'LO', Value: [label] }
    // DERIVED and SECONDARY are what they are; the third value is what the
    // ingest reads to tell a projection from an ordinary reformat.
    dict['00080008'] = { vr: 'CS', Value: ['DERIVED', 'SECONDARY', PROJECTION_WORDS[plan.projection].toUpperCase()] }

    if (parent.window) {
      dict['00281050'] = { vr: 'DS', Value: [round(parent.window.centre)] }
      dict['00281051'] = { vr: 'DS', Value: [round(parent.window.width)] }
      delete dict['00281055']
      delete dict['00283010']
    }

    const outputPath = path.join(outputDir, `${String(index).padStart(4, '0')}.dcm`)
    await fs.writeFile(outputPath, Buffer.from(message.write()))
    slices.push({ path: outputPath, frame: 0, instanceNumber: index + 1, sliceLocation: offset, sopInstanceUid: null })
  }

  return {
    id: `${parent.seriesId}::reformat-${seriesUid}`,
    seriesInstanceUid: seriesUid,
    seriesNumber: (parent.seriesNumber ?? 0) + 100,
    description: parent.description === null ? label : `${parent.description} — ${label}`,
    modality: parent.modality,
    splitReason: null,
    instanceCount: slices.length,
    stacks: [
      {
        id: `${parent.seriesId}::reformat-${seriesUid}::stack`,
        kind: 'single',
        label,
        component: plan.projection === 'mip' ? 'mip' : 'derived',
        bValue: null,
        echoNumber: null,
        phaseIndex: null,
        acquisitionTime: null,
        slices,
        selected: true,
        trimStart: 0,
        trimEnd: slices.length - 1,
        masks: [],
        window: parent.window,
        unsupported: null
      }
    ]
  }
}
