import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import dicomParser from 'dicom-parser'
import * as dcmio from 'dicomanon'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStructure, toMessage } from '@shared/annotate/structures'
import type { AnnotationRequest, IngestResult, Series, Stack } from '@shared/types'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))

const { session } = await import('./session')
const { commitAnnotation } = await import('./annotate')
const { anonymiseFile } = await import('./anon/anonymise')

const FIXTURES = path.join(import.meta.dirname, 'anon', '__fixtures__')

function stackOf(id: string, file: string, frames: number): Stack {
  return {
    id,
    kind: 'single',
    label: '',
    component: 'magnitude',
    bValue: null,
    echoNumber: null,
    phaseIndex: null,
    acquisitionTime: null,
    slices: Array.from({ length: frames }, (_, frame) => ({
      path: path.join(FIXTURES, file),
      frame,
      instanceNumber: frame + 1,
      sliceLocation: frame,
      sopInstanceUid: null
    })),
    selected: true,
    trimStart: 0,
    trimEnd: frames - 1,
    dropped: [],
    masks: [],
    crop: null,
    plane: 'Axial',
    sharedPlane: true,
    bytes: 0,
    compression: null,
    window: null,
    unsupported: null
  }
}

function load(stack: Stack): Series {
  const series: Series = {
    id: 'parent',
    seriesInstanceUid: '1.2.3',
    seriesNumber: 4,
    description: 'T2 sag',
    modality: 'CT',
    splitReason: null,
    instanceCount: stack.slices.length,
    stacks: [stack]
  }
  session.ingest = {
    sourceKind: 'folder',
    sourcePath: FIXTURES,
    tempDir: null,
    scannedFileCount: 0,
    failures: [],
    studies: [
      {
        id: 'study',
        studyInstanceUid: 'study',
        studyDescription: null,
        modality: 'CT',
        studyDate: null,
        studyTime: null,
        patientAge: null,
        patientSex: null,
        intervalDays: 0,
        series: [series]
      }
    ]
  } as unknown as IngestResult
  return series
}

/** A structure with the top-left quarter of an 8 × 8 grid drawn on image `index`. */
function quarter(index: number, color = '#ff0000'): AnnotationRequest['structures'][number] {
  const structure = createStructure('Mass', color)
  structure.opacity = 1
  structure.outline = false
  const mask = new Uint8Array(64)
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) mask[y * 8 + x] = 1
  structure.keys.set(index, mask)
  return toMessage(structure)
}

function parse(filePath: string): Promise<dicomParser.DataSet> {
  return fs.readFile(filePath).then((bytes) => dicomParser.parseDicom(new Uint8Array(bytes)))
}

function pixel(ds: dicomParser.DataSet, x: number, y: number): number[] {
  const element = ds.elements.x7fe00010
  const columns = ds.uint16('x00280011') ?? 0
  const o = element.dataOffset + (y * columns + x) * 3
  return [...ds.byteArray.subarray(o, o + 3)]
}

afterEach(async () => {
  await session.reset()
})

describe('an annotated copy of a stack', () => {
  it('is written as RGB Secondary Capture, one file per image of a multiframe run', async () => {
    const stack = stackOf('run', 'multiframe_4.dcm', 4)
    load(stack)
    const { series } = await commitAnnotation('run', {
      grid: { width: 8, height: 8 },
      indices: [1, 2],
      structures: [quarter(1)],
      window: { centre: 100, width: 200 },
      legend: null,
      replaces: null
    })

    expect(series.description).toBe('T2 sag — Annotated')
    expect(series.seriesNumber).toBe(204)
    // The fixture has no description of its own to go before it.
    expect((await parse(series.stacks[0].slices[0].path)).string('x0008103e')).toBe('Annotated')
    const written = series.stacks[0].slices
    expect(written).toHaveLength(2)

    const first = await parse(written[0].path)
    expect(first.string('x00020010')).toBe('1.2.840.10008.1.2.1')
    expect(first.string('x00080016')).toBe('1.2.840.10008.5.1.4.1.1.7')
    expect(first.string('x00020002')).toBe('1.2.840.10008.5.1.4.1.1.7')
    expect(first.string('x00020003')).toBe(first.string('x00080018'))
    expect(first.string('x00280004')).toBe('RGB')
    expect(first.uint16('x00280002')).toBe(3)
    expect(first.string('x00280008')).toBeUndefined()
    expect(first.string('x00281050')).toBeUndefined()
    expect(first.string('x00281053')).toBeUndefined()
    expect(first.elements.x7fe00010.length).toBe(8 * 8 * 3)
    expect(pixel(first, 0, 0)).toEqual([255, 0, 0])
    expect(pixel(first, 3, 3)).toEqual([255, 0, 0])
    const outside = pixel(first, 6, 6)
    expect(outside[0]).toBe(outside[1])
    expect(outside[1]).toBe(outside[2])

    // Nothing is drawn on the second image and nothing interpolates onto it.
    const second = await parse(written[1].path)
    expect(pixel(second, 0, 0)[0]).toBe(pixel(second, 0, 0)[1])
    expect(second.string('x00200013')).toBe('2')
    expect(second.string('x0020000e')).toBe(first.string('x0020000e'))
  })

  it('paints the stack’s redactions over the drawing', async () => {
    const stack = { ...stackOf('one', '01_ras_physician.dcm', 1), masks: [{ x: 0, y: 0, width: 0.25, height: 0.25 }] }
    load(stack)
    const { series } = await commitAnnotation('one', {
      grid: { width: 8, height: 8 },
      indices: [0],
      structures: [quarter(0, '#ffffff')],
      window: null,
      legend: null,
      replaces: null
    })
    const ds = await parse(series.stacks[0].slices[0].path)
    expect(pixel(ds, 0, 0)).toEqual([0, 0, 0])
    expect(pixel(ds, 1, 1)).toEqual([0, 0, 0])
    expect(pixel(ds, 2, 2)).toEqual([255, 255, 255])
    expect(series.stacks[0].masks).toEqual(stack.masks)
  })

  it('decodes a compressed parent and lays a drawing made on a smaller frame over it', async () => {
    load(stackOf('jpeg', 'TestPattern_JPEG-Baseline_YBRFull.dcm', 1))
    const structure = createStructure('Mass', '#00ff00')
    structure.opacity = 1
    structure.outline = false
    // Drawn on a 320 × 200 reduction of the 640 × 400 image.
    const mask = new Uint8Array(320 * 200)
    mask[0] = 1
    structure.keys.set(0, mask)
    const { series } = await commitAnnotation('jpeg', {
      grid: { width: 320, height: 200 },
      indices: [0],
      structures: [toMessage(structure)],
      window: null,
      legend: null,
      replaces: null
    })
    const ds = await parse(series.stacks[0].slices[0].path)
    expect(ds.uint16('x00280011')).toBe(640)
    expect(ds.uint16('x00280010')).toBe(400)
    expect(ds.string('x00020010')).toBe('1.2.840.10008.1.2.1')
    expect(pixel(ds, 1, 1)).toEqual([0, 255, 0])
    expect(pixel(ds, 2, 2)).not.toEqual([0, 255, 0])
  })

  it('writes the parent’s description by its character set, and says it is UTF-8', async () => {
    type Dict = Record<string, { vr: string; Value: unknown[] }>
    const bytes = new Uint8Array(await fs.readFile(path.join(FIXTURES, '01_ras_physician.dcm')))
    const message = dcmio.Message.readFile(bytes.buffer.slice(0) as ArrayBuffer)
    const dict = message.dict as unknown as Dict
    dict['0008103E'] = { vr: 'LO', Value: ['EncQfalo'] }
    dict['00080005'] = { vr: 'CS', Value: ['ISO_IR 100'] }
    const out = new Uint8Array(message.write())
    out[Buffer.from(out).indexOf('EncQfalo') + 3] = 0xe9
    const source = path.join(os.tmpdir(), `annotate-latin1-${process.pid}.dcm`)
    await fs.writeFile(source, out)
    try {
      const stack = stackOf('latin1', '01_ras_physician.dcm', 1)
      stack.slices[0].path = source
      load(stack)
      const { series } = await commitAnnotation('latin1', {
        grid: { width: 8, height: 8 },
        indices: [0],
        structures: [quarter(0)],
        window: null,
        legend: null,
        replaces: null
      })
      const written = await fs.readFile(series.stacks[0].slices[0].path)
      const ds = dicomParser.parseDicom(new Uint8Array(written))
      expect(ds.string('x00080005')).toBe('ISO_IR 192')
      const element = ds.elements.x0008103e
      const text = new TextDecoder().decode(written.subarray(element.dataOffset, element.dataOffset + element.length))
      expect(text.trim()).toBe('Encéfalo (annotated)')
    } finally {
      await fs.rm(source, { force: true })
    }
  })

  it('puts the legend on every image, under the stack’s redactions', async () => {
    const stack = { ...stackOf('run', 'multiframe_4.dcm', 4), masks: [{ x: 0, y: 0.75, width: 0.125, height: 0.25 }] }
    load(stack)
    // A 3 × 2 box of solid white in the lower left of the 8 × 8 grid.
    const legend = { x: 0, y: 6, width: 3, height: 2, rgba: new Uint8ClampedArray(3 * 2 * 4).fill(255) }
    const { series } = await commitAnnotation('run', {
      grid: { width: 8, height: 8 },
      indices: [0, 3],
      structures: [quarter(0)],
      window: null,
      legend,
      replaces: null
    })
    for (const slice of series.stacks[0].slices) {
      const ds = await parse(slice.path)
      expect(pixel(ds, 1, 7)).toEqual([255, 255, 255])
      expect(pixel(ds, 2, 6)).toEqual([255, 255, 255])
      // The redaction covers column 0 of rows 6–7, legend or not.
      expect(pixel(ds, 0, 7)).toEqual([0, 0, 0])
    }
  })

  it('refuses a drawing made on images of another shape', async () => {
    load(stackOf('jpeg', 'TestPattern_JPEG-Baseline_YBRFull.dcm', 1))
    await expect(
      commitAnnotation('jpeg', {
        grid: { width: 8, height: 8 },
        indices: [0],
        structures: [quarter(0)],
        window: null,
        legend: null,
        replaces: null
      })
    ).rejects.toThrow(/same shape/)
  })

  it('takes the place of the copy written before it, beside its parent', async () => {
    const parent = load(stackOf('run', 'multiframe_4.dcm', 4))
    const request: AnnotationRequest = {
      grid: { width: 8, height: 8 },
      indices: [0, 1, 2, 3],
      structures: [quarter(0)],
      window: null,
      legend: null,
      replaces: null
    }
    const first = await commitAnnotation('run', request)
    const second = await commitAnnotation('run', { ...request, replaces: first.series.id })
    const ids = session.ingest!.studies[0].series.map((series) => series.id)
    expect(ids).toEqual([parent.id, second.series.id])
  })

  it('goes through the anonymiser as it is, drawing and all', async () => {
    load(stackOf('run', 'multiframe_4.dcm', 4))
    const { series } = await commitAnnotation('run', {
      grid: { width: 8, height: 8 },
      indices: [0],
      structures: [quarter(0)],
      window: null,
      legend: null,
      replaces: null
    })
    const out = await fs.mkdtemp(path.join(os.tmpdir(), 'annotate-test-'))
    try {
      const [file] = await anonymiseFile(series.stacks[0].slices[0].path, out, [
        { frame: 0, outputName: 'a.dcm', instanceNumber: 1 }
      ])
      const ds = await parse(file.outputPath)
      expect(ds.string('x00280004')).toBe('RGB')
      expect(pixel(ds, 0, 0)).toEqual([255, 0, 0])
    } finally {
      await fs.rm(out, { recursive: true, force: true })
    }
  })
})
