import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import * as dcmio from 'dicomanon'
import { blackSamples, compressionOf, fillMasks, frameSamples, type PixelGeometry } from '@shared/dicomImage'
import type { AnonWarning, MaskRect, WindowLevel } from '@shared/types'

export interface AnonymisedFile {
  sourcePath: string
  /** Frame within the source file; 0 for ordinary single-frame instances. */
  frame: number
  outputPath: string
  sha256: string
  byteLength: number
  warnings: AnonWarning[]
}

/** One output file to produce from a source instance. */
export interface FrameTask {
  frame: number
  outputName: string
  /** InstanceNumber to write, so a split run keeps the order it was shown in. */
  instanceNumber: number
  /** Regions to blank out of the pixel data, in fractions of the image. */
  masks?: MaskRect[]
  /** Window to write to WindowCenter/WindowWidth; null leaves the file's own. */
  window?: WindowLevel | null
}

/** Tags rewritten when the user picks a window in the viewer. */
const WINDOW_TAGS = ['00281050', '00281051', '00281055', '00283010']

const EXPLICIT_VR_BIG_ENDIAN = '1.2.840.10008.1.2.2'

/** Warning levels below this are noise for a case uploader. */
const WARNING_LEVEL_FLOOR = 3

type Dict = Record<string, { vr: string; Value: unknown[] }>

function firstValue(dict: Dict, tag: string): string | undefined {
  const value = dict[tag]?.Value?.[0]
  return value === undefined || value === null ? undefined : String(value)
}

function numberOf(dict: Dict, tag: string, fallback: number): number {
  const raw = firstValue(dict, tag)
  if (raw === undefined) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : fallback
}

/** First value of a DS tag, which may carry several backslash-separated ones. */
function decimalOf(dict: Dict, tag: string, fallback: number): number {
  const raw = firstValue(dict, tag)
  if (raw === undefined) return fallback
  const n = Number.parseFloat(raw.split('\\')[0])
  return Number.isFinite(n) ? n : fallback
}

/** A DS value has to fit in 16 characters, so long floats are trimmed. */
function decimalString(value: number): string {
  const text = String(Math.round(value * 100) / 100)
  return text.length <= 16 ? text : value.toPrecision(9)
}

function collectWarnings(dict: Dict, sourcePath: string, frame: number): AnonWarning[] {
  const warnings: AnonWarning[] = []
  const report = dcmio.Validator(dict as never) as Record<string, { level: number; text: string }[]>
  for (const [tag, entries] of Object.entries(report ?? {})) {
    for (const entry of entries ?? []) {
      if (entry.level >= WARNING_LEVEL_FLOOR) {
        warnings.push({ path: sourcePath, frame, tag, level: entry.level, text: entry.text })
      }
    }
  }
  return warnings
}

/** The window the file itself asks for, if it asks for one at all. */
function windowOf(dict: Dict): WindowLevel | null {
  const centre = dict['00281050'] === undefined ? null : decimalOf(dict, '00281050', Number.NaN)
  const width = dict['00281051'] === undefined ? null : decimalOf(dict, '00281051', Number.NaN)
  if (centre === null || width === null || !Number.isFinite(centre) || !Number.isFinite(width) || width <= 0) {
    return null
  }
  return { centre, width }
}

/** Pixel data is stored as written, so masks need the file's byte order. */
function transferSyntaxOf(message: { meta?: Dict }): string | undefined {
  return message.meta === undefined ? undefined : firstValue(message.meta, '00020010')
}

/**
 * Anonymise one instance, producing one output file per requested frame.
 *
 * Multiframe instances are split here rather than uploaded whole. Radiopaedia
 * does not expand them server-side, so a cine run sent as a single instance
 * shows only its first frame — a biplane DSA study, which is two multiframe
 * files, arrives as two pictures instead of a run of dozens.
 *
 * Frames are lifted out without decoding: the stored bytes are copied straight
 * across. The pixel data, frame count and instance number are set *before*
 * anonymisation, so the bytes written are exactly what the anonymiser produces
 * and Radiopaedia's re-run of it is a no-op — it rejects a file if any tag would
 * change.
 *
 * Masks and the chosen window are applied here too, and for the same reason:
 * both have to be in place before `Anonymize` runs, so the bytes written are
 * final. A mask is painted into the stored samples — after this the burnt-in
 * text is gone from the file, not merely hidden by a viewer.
 *
 * The source is read and parsed once however many frames are wanted from it.
 */
export async function anonymiseFile(
  sourcePath: string,
  outputDir: string,
  tasks: FrameTask[]
): Promise<AnonymisedFile[]> {
  const buf = await fs.readFile(sourcePath)
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer

  const message = dcmio.Message.readFile(arrayBuffer)
  const dict = message.dict as unknown as Dict

  const transferSyntax = transferSyntaxOf(message)
  // Painting a mask writes over the stored samples, and splitting a multiframe
  // run cuts them by byte offset. Neither is meaningful on a bitstream, so both
  // are refused rather than attempted on a compressed file.
  const compression = compressionOf(transferSyntax)
  const totalFrames = numberOf(dict, '00280008', 1)
  const pixelElement = dict['7FE00010']
  const allPixels = pixelElement?.Value?.[0] as ArrayBuffer | undefined

  // Frame size from the geometry, so a frame can be sliced without decoding.
  const rows = numberOf(dict, '00280010', 0)
  const columns = numberOf(dict, '00280011', 0)
  const samples = numberOf(dict, '00280002', 1)
  const bitsAllocated = numberOf(dict, '00280100', 16)
  const frameLength = rows * columns * samples * (bitsAllocated <= 8 ? 1 : 2)

  const geometry: PixelGeometry = {
    rows,
    columns,
    samplesPerPixel: samples,
    bitsAllocated,
    signed: numberOf(dict, '00280103', 0) === 1,
    planarConfiguration: numberOf(dict, '00280006', 0),
    bigEndian: transferSyntax === EXPLICIT_VR_BIG_ENDIAN
  }
  const photometric = firstValue(dict, '00280004') ?? 'MONOCHROME2'
  const rescale = { slope: decimalOf(dict, '00281053', 1), intercept: decimalOf(dict, '00281052', 0) }
  const fileWindow = windowOf(dict)

  // The window tags are rewritten per task, so their originals are kept to put
  // back for a task that asked for no window of its own.
  const originalWindow = WINDOW_TAGS.map((tag) => [tag, dict[tag]] as const)

  const results: AnonymisedFile[] = []

  for (const task of tasks) {
    const masks = task.masks ?? []
    if (masks.length > 0 && compression !== null) {
      throw new Error(`Cannot redact ${path.basename(sourcePath)}: its pixel data is ${compression} compressed`)
    }

    if (totalFrames > 1) {
      // The bound check below would catch most of these anyway, since a
      // compressed run is smaller than the raw frames it stands for — but only
      // by accident. A codec that expanded a noisy image past the raw size would
      // pass it and hand back arbitrary pieces of the bitstream as frames.
      if (compression !== null) {
        throw new Error(
          `Cannot split the ${totalFrames} frames of ${path.basename(sourcePath)}: its pixel data is ${compression} compressed`
        )
      }
      if (!allPixels || frameLength === 0) {
        throw new Error(`Cannot split frames of ${path.basename(sourcePath)}: pixel data is not addressable`)
      }
      const start = task.frame * frameLength
      if (start + frameLength > allPixels.byteLength) {
        throw new Error(`Frame ${task.frame + 1} runs past the pixel data of ${path.basename(sourcePath)}`)
      }
      pixelElement.Value = [allPixels.slice(start, start + frameLength)]
      dict['00280008'] = { vr: 'IS', Value: ['1'] }
      dict['00200013'] = { vr: 'IS', Value: [String(task.instanceNumber)] }
    } else if (allPixels) {
      if (masks.length > 0 && frameLength === 0) {
        throw new Error(`Cannot redact ${path.basename(sourcePath)}: pixel data is not addressable`)
      }
      // Masking works on a copy, and every task re-points at one — otherwise a
      // second task from the same file would inherit the first one's redaction.
      pixelElement.Value = [masks.length > 0 ? allPixels.slice(0) : allPixels]
    }

    if (masks.length > 0) {
      const bytes = new Uint8Array(pixelElement.Value[0] as ArrayBuffer)
      const window = task.window ?? fileWindow
      const fill = blackSamples(
        { photometric, samplesPerPixel: samples, bitsAllocated, signed: geometry.signed, ...rescale },
        window,
        // Only worth a scan when nothing says which end of the range is dark.
        window === null && samples === 1 ? frameSamples(geometry, bytes) : undefined
      )
      fillMasks(bytes, geometry, masks, fill)
    }

    for (const [tag, original] of originalWindow) {
      if (original === undefined) delete dict[tag]
      else dict[tag] = original
    }
    if (task.window) {
      dict['00281050'] = { vr: 'DS', Value: [decimalString(task.window.centre)] }
      dict['00281051'] = { vr: 'DS', Value: [decimalString(task.window.width)] }
      // An explanation or a VOI LUT left behind would contradict, or override,
      // the window just chosen.
      delete dict['00281055']
      delete dict['00283010']
    }

    const anonymised = dcmio.Anonymize(dict as never) as unknown as Dict
    const warnings = collectWarnings(anonymised, sourcePath, task.frame)

    message.dict = anonymised as never
    const out = Buffer.from(message.write())
    const outputPath = path.join(outputDir, task.outputName)
    await fs.writeFile(outputPath, out)

    results.push({
      sourcePath,
      frame: task.frame,
      outputPath,
      sha256: createHash('sha256').update(out).digest('hex'),
      byteLength: out.byteLength,
      warnings
    })

    // Anonymize returns a fresh dict, so the working copy is still the original
    // and the next frame starts from the same header.
    message.dict = dict as never
  }

  return results
}
