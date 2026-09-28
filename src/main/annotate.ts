import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import * as dcmio from 'dicomanon'
import { paintStructures } from '@shared/annotate/paint'
import { fromMessage, type Structure } from '@shared/annotate/structures'
import { applyWindow, fillMasks } from '@shared/dicomImage'
import type { AnnotationRequest, Series, SliceRef, Stack, Study } from '@shared/types'
import { itemsOf, promoteFrameTags } from './anon/anonymise'
import { textAsUnicode } from './anon/text'
import { readPreviewFrame } from './preview'
import { session } from './session'

/**
 * Writing a stack again with structures painted into it.
 *
 * The copy is a series of its own beside the one it was drawn on, the way a
 * reformat is: written from each image's own header into the session's working
 * directory, and anonymised and uploaded with everything else. It is *not*
 * anonymised here, for the same reason — nothing in this app writes an
 * anonymised file except the anonymiser.
 *
 * Each image goes out as 8-bit RGB, uncompressed, with the window it was drawn
 * under already in its pixels. That makes it a Secondary Capture: a CT or MR
 * object cannot hold RGB, and a file that claims to be one while it does is a
 * file a validator warns about in words the user can do nothing with.
 */

const SECONDARY_CAPTURE = '1.2.840.10008.5.1.4.1.1.7'
const EXPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2.1'

/** Where a copy lands in the series numbers: after the scanner's and the reformats'. */
const SERIES_NUMBER_OFFSET = 200

type Dict = Record<string, { vr: string; Value: unknown[] }>

export class AnnotationError extends Error {
  override name = 'AnnotationError'
}

function uid(): string {
  return `2.25.${BigInt(`0x${randomUUID().replace(/-/g, '')}`).toString()}`
}

function find(stackId: string): { study: Study; series: Series; stack: Stack } {
  for (const study of session.ingest?.studies ?? []) {
    for (const series of study.series) {
      for (const stack of series.stacks) {
        if (stack.id === stackId) return { study, series, stack }
      }
    }
  }
  throw new AnnotationError('That series is no longer part of this import')
}

/**
 * Tags that describe the stored pixels of the parent and are wrong about RGB:
 * the rescale turns a stored value into a unit these samples do not have, the
 * window and its LUTs act on values that are already a picture, and a palette
 * describes indices that are no longer there.
 */
const GREY_ONLY_TAGS = [
  '00281050', // WindowCenter
  '00281051', // WindowWidth
  '00281055', // WindowCenterWidthExplanation
  '00283010', // VOILUTSequence
  '00283000', // ModalityLUTSequence
  '00281052', // RescaleIntercept
  '00281053', // RescaleSlope
  '00281054', // RescaleType
  '00280106', // SmallestImagePixelValue
  '00280107', // LargestImagePixelValue
  '00281101', // palette descriptors and data
  '00281102',
  '00281103',
  '00281201',
  '00281202',
  '00281203',
  '00282110', // LossyImageCompression: these samples were never compressed
  '00282112',
  '00282114'
]

/** Tags of a file that held more than one frame, where each copy holds one. */
const MULTIFRAME_TAGS = [
  '00280008', // NumberOfFrames
  '00280009', // FrameIncrementPointer
  '00181063', // FrameTime
  '00181065', // FrameTimeVector
  '52009229', // SharedFunctionalGroupsSequence
  '52009230' // PerFrameFunctionalGroupsSequence
]

/**
 * The series description written into the files: the parent's own, as the
 * file holds it, with a word after it. Taken from the file rather than from
 * the picker so `textAsUnicode` reads all of it by the file's character set.
 * LO holds 64 characters.
 */
function fileDescription(source: Dict): string {
  const suffix = ' (annotated)'
  const parent = String(source['0008103E']?.Value?.[0] ?? '').trim()
  return parent === '' ? 'Annotated' : `${parent.slice(0, 64 - suffix.length)}${suffix}`
}

/**
 * One annotated image, as RGB samples at the image's full size.
 *
 * The stack's own redactions are painted in last, over the structures: a
 * structure drawn across a blanked banner must not bring back its outline, and
 * the anonymiser, which blanks them again from the stack, would find them
 * already black.
 */
async function annotatedPixels(
  slice: SliceRef,
  index: number,
  structures: Structure[],
  request: AnnotationRequest,
  stack: Stack
): Promise<{ width: number; height: number; rgb: Uint8Array }> {
  const frame = await readPreviewFrame(slice.path, slice.frame, Number.POSITIVE_INFINITY)
  const rgba = frame.kind === 'grey' ? applyWindow(frame, request.window ?? frame.window).rgba : frame.rgba

  // A drawing is a fraction of the image it was drawn on; laid over an image of
  // another shape it would land on other anatomy.
  const drawn = request.grid.width / request.grid.height
  if (Math.abs(frame.width / frame.height - drawn) > 0.02) {
    throw new AnnotationError('The images in this stack are not all the same shape, so the drawing cannot be laid over them')
  }

  const rgb = new Uint8Array(frame.width * frame.height * 3)
  for (let i = 0, j = 0; j < rgb.length; i += 4, j += 3) {
    rgb[j] = rgba[i]
    rgb[j + 1] = rgba[i + 1]
    rgb[j + 2] = rgba[i + 2]
  }
  paintStructures(rgb, frame.width, frame.height, 3, structures, index, request.grid)
  fillMasks(
    rgb,
    {
      rows: frame.height,
      columns: frame.width,
      samplesPerPixel: 3,
      bitsAllocated: 8,
      signed: false,
      planarConfiguration: 0,
      bigEndian: false
    },
    stack.masks ?? [],
    [0, 0, 0]
  )
  return { width: frame.width, height: frame.height, rgb }
}

/**
 * The parsed parent of each image, one at a time.
 *
 * Images of a stack arrive in file order, and a multiframe run is one file for
 * every image in it — so keeping the last one read turns a 250 MB cine into one
 * read instead of one per frame.
 */
function parentReader(): (filePath: string) => Promise<ReturnType<typeof dcmio.Message.readFile>> {
  let last: { path: string; message: ReturnType<typeof dcmio.Message.readFile> } | null = null
  return async (filePath) => {
    if (last?.path !== filePath) {
      const source = await fs.readFile(filePath)
      last = {
        path: filePath,
        message: dcmio.Message.readFile(
          source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer
        )
      }
    }
    return last.message
  }
}

/**
 * Paint the structures into every image asked for and write them as a series.
 *
 * It goes into the session's own tree as well as being returned, because that
 * tree is the one anonymisation and upload read. A copy written the last time
 * the dialog was closed is taken out of the tree: the drawing is the same one,
 * edited, and two versions of it in one case would be one too many.
 */
export async function commitAnnotation(
  stackId: string,
  request: AnnotationRequest
): Promise<{ studyId: string; series: Series }> {
  const parent = find(stackId)
  const { stack } = parent
  const { width, height } = request.grid
  if (!(width > 0 && height > 0)) throw new AnnotationError('Nothing has been drawn on these images yet')

  const indices = request.indices.filter((i) => Number.isInteger(i) && i >= 0 && i < stack.slices.length)
  if (indices.length === 0) throw new AnnotationError('There are no images to write')
  const structures = request.structures.map((message) => fromMessage(message, width, height))

  const workDir = await session.workDir()
  const outputDir = path.join(workDir, 'annotated', `${Date.now()}`)
  await fs.mkdir(outputDir, { recursive: true })

  const seriesUid = uid()
  const seriesNumber = (parent.series.seriesNumber ?? 0) + SERIES_NUMBER_OFFSET
  const label = 'Annotated'
  const description = parent.series.description === null ? label : `${parent.series.description} — ${label}`
  const readParent = parentReader()
  const slices: SliceRef[] = []
  let bytes = 0

  for (const [n, index] of indices.entries()) {
    const slice = stack.slices[index]
    const image = await annotatedPixels(slice, index, structures, request, stack)
    const message = await readParent(slice.path)
    const source = message.dict as unknown as Dict

    // A copy of the parent's dict, so each image starts from the file as it was
    // written; elements are replaced here, never changed in place.
    const dict: Dict = { ...source }
    promoteFrameTags(dict, itemsOf(source, '52009230')[slice.frame] ?? null, itemsOf(source, '52009229')[0] ?? null)
    for (const tag of [...GREY_ONLY_TAGS, ...MULTIFRAME_TAGS]) delete dict[tag]

    const sopUid = uid()
    dict['7FE00010'] = { vr: 'OB', Value: [image.rgb.buffer as ArrayBuffer] }
    dict['00280002'] = { vr: 'US', Value: [3] }
    dict['00280004'] = { vr: 'CS', Value: ['RGB'] }
    dict['00280006'] = { vr: 'US', Value: [0] }
    dict['00280010'] = { vr: 'US', Value: [image.height] }
    dict['00280011'] = { vr: 'US', Value: [image.width] }
    dict['00280100'] = { vr: 'US', Value: [8] }
    dict['00280101'] = { vr: 'US', Value: [8] }
    dict['00280102'] = { vr: 'US', Value: [7] }
    dict['00280103'] = { vr: 'US', Value: [0] }

    dict['00080016'] = { vr: 'UI', Value: [SECONDARY_CAPTURE] }
    dict['00080018'] = { vr: 'UI', Value: [sopUid] }
    dict['00080008'] = { vr: 'CS', Value: ['DERIVED', 'SECONDARY'] }
    dict['00080064'] = { vr: 'CS', Value: ['WSD'] }
    dict['0020000E'] = { vr: 'UI', Value: [seriesUid] }
    dict['00200011'] = { vr: 'IS', Value: [String(seriesNumber)] }
    dict['00200013'] = { vr: 'IS', Value: [String(n + 1)] }
    dict['0008103E'] = { vr: 'LO', Value: [fileDescription(source)] }

    // dcmio writes UTF-8 whatever the file was in; see anon/text.ts.
    textAsUnicode(dict)

    message.meta['00020002'] = { vr: 'UI', Value: [SECONDARY_CAPTURE] }
    message.meta['00020003'] = { vr: 'UI', Value: [sopUid] }
    message.meta['00020010'] = { vr: 'UI', Value: [EXPLICIT_VR_LITTLE_ENDIAN] }

    const outputPath = path.join(outputDir, `${String(n).padStart(4, '0')}.dcm`)
    const written = Buffer.from(message.write(dict as never))
    bytes += written.byteLength
    await fs.writeFile(outputPath, written)
    slices.push({
      path: outputPath,
      frame: 0,
      instanceNumber: n + 1,
      sliceLocation: slice.sliceLocation,
      sopInstanceUid: null
    })
  }

  const series: Series = {
    id: `${parent.series.id}::annotated-${seriesUid}`,
    seriesInstanceUid: seriesUid,
    seriesNumber,
    description,
    modality: parent.series.modality,
    splitReason: null,
    instanceCount: slices.length,
    stacks: [
      {
        id: `${parent.series.id}::annotated-${seriesUid}::stack`,
        kind: 'single',
        label: stack.label === '' ? label : `${stack.label} · ${label}`,
        component: 'derived',
        bValue: null,
        echoNumber: null,
        phaseIndex: null,
        acquisitionTime: null,
        slices,
        selected: true,
        trimStart: 0,
        trimEnd: slices.length - 1,
        dropped: [],
        // Already in the pixels, and carried so the anonymiser blanks them
        // again and the viewer shows where they are.
        masks: stack.masks ?? [],
        // The copy is the same grid as its parent, so the parent's crop is a
        // crop of it too, and the anonymiser moves the geometry to match.
        crop: stack.crop ?? null,
        window: null,
        plane: stack.plane,
        sharedPlane: stack.sharedPlane,
        bytes,
        compression: null,
        unsupported: null
      }
    ]
  }

  const study = parent.study
  if (request.replaces !== null) {
    const old = study.series.findIndex((existing) => existing.id === request.replaces)
    if (old >= 0) study.series.splice(old, 1)
  }
  study.series.splice(study.series.indexOf(parent.series) + 1, 0, series)
  return { studyId: study.id, series }
}
