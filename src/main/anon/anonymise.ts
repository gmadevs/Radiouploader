import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import * as dcmio from 'dicomanon'
import dicomParser from 'dicom-parser'
import {
  blackSamples,
  compressionOf,
  cropBoundsOf,
  cropFrameBytes,
  croppedPosition,
  fillMasks,
  frameSamples,
  keepsWholeImage,
  parseHeader,
  type PixelGeometry
} from '@shared/dicomImage'
import type { AnonWarning, CropRect, MaskRect, WindowLevel } from '@shared/types'
import { canDecode, decodeEncapsulatedFrame, type DecodedSamples } from '../codecs/decode'
import { encodedFrame } from '../codecs/frames'

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
  /** The part of the image to keep; null or absent keeps all of it. */
  crop?: CropRect | null
  /** Window to write to WindowCenter/WindowWidth; null leaves the file's own. */
  window?: WindowLevel | null
}

/** Tags rewritten when the user picks a window in the viewer. */
const WINDOW_TAGS = ['00281050', '00281051', '00281055', '00283010']

/** Tags rewritten by a crop: the size of the grid, and where its corner is. */
const CROP_TAGS = ['00280010', '00280011', '00200032']

const EXPLICIT_VR_BIG_ENDIAN = '1.2.840.10008.1.2.2'
const EXPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2.1'

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

/**
 * A list of decimals, one DS value each rather than one backslashed string —
 * a position written as a single value is three long and refused.
 *
 * Kept finer than `decimalString`: this is a position in the patient, and
 * rounding it to hundredths of a millimetre would show up as a wobble in the
 * gaps between slices on a study cut thinner than that.
 */
function decimals(values: number[]): string[] {
  return values.map((value) => {
    const text = String(Math.round(value * 1e6) / 1e6)
    return text.length <= 16 ? text : value.toPrecision(9)
  })
}

/**
 * A tag that may have arrived as separate values or as one backslashed string,
 * as `count` numbers. Null unless there are exactly that many and all are real.
 */
function decimalListOf(dict: Dict, tag: string, count: number): number[] | null {
  const raw = dict[tag]?.Value
  if (raw === undefined) return null
  const parts =
    raw.length === 1 && typeof raw[0] === 'string' && raw[0].includes('\\') ? raw[0].split('\\') : raw
  if (parts.length !== count) return null
  const numbers = parts.map((part) => Number.parseFloat(String(part)))
  return numbers.every(Number.isFinite) ? numbers : null
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
 * Replace compressed pixel data with the samples it decodes to, and make every
 * tag that describes those pixels tell the truth about them.
 *
 * The transfer syntax goes with them: what leaves here is an ordinary explicit
 * VR little endian instance. The file is larger — a JPEG frame is perhaps a
 * sixteenth of its own samples — and that is the price of two things that
 * cannot be had otherwise: a redaction that is really in the pixels, and a cine
 * run that arrives as a run instead of as its first frame.
 *
 * The geometry comes from the codec rather than from the file. A decoder is
 * free to undo a colour transform or unpack to a wider container, so the header
 * describes the bitstream, not what came out of it.
 */
function writeDecodedFrame(
  message: { meta?: Dict },
  dict: Dict,
  decoded: DecodedSamples,
  instanceNumber: number
): void {
  if (message.meta) message.meta['00020010'] = { vr: 'UI', Value: [EXPLICIT_VR_LITTLE_ENDIAN] }

  const bytes = decoded.bytes
  const pixels = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  dict['7FE00010'] = { vr: decoded.bitsAllocated <= 8 ? 'OB' : 'OW', Value: [pixels] }

  dict['00280002'] = { vr: 'US', Value: [decoded.samplesPerPixel] }
  dict['00280004'] = { vr: 'CS', Value: [decoded.photometric] }
  dict['00280100'] = { vr: 'US', Value: [decoded.bitsAllocated] }
  // A 12-bit image unpacks into 16-bit words but still stores 12 of them.
  const stored = Math.min(numberOf(dict, '00280101', decoded.bitsAllocated), decoded.bitsAllocated)
  dict['00280101'] = { vr: 'US', Value: [stored] }
  dict['00280102'] = { vr: 'US', Value: [stored - 1] }
  dict['00280103'] = { vr: 'US', Value: [decoded.signed ? 1 : 0] }

  // Planar configuration means nothing on a single-sample image, and a stray
  // one contradicts the pixels it claims to describe.
  if (decoded.samplesPerPixel > 1) dict['00280006'] = { vr: 'US', Value: [decoded.planarConfiguration] }
  else delete dict['00280006']

  dict['00280008'] = { vr: 'IS', Value: ['1'] }
  dict['00200013'] = { vr: 'IS', Value: [String(instanceNumber)] }
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
 * Masks, the crop and the chosen window are applied here too, and for the same
 * reason: all three have to be in place before `Anonymize` runs, so the bytes
 * written are final. A mask is painted into the stored samples and a crop
 * throws the rest away — after this the burnt-in text is gone from the file,
 * not merely hidden by a viewer.
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

  /** The crop as whole pixels of this file, or null when it keeps everything. */
  const cropOf = (task: FrameTask): ReturnType<typeof cropBoundsOf> | null => {
    if (!task.crop || rows === 0 || columns === 0) return null
    const bounds = cropBoundsOf(task.crop, columns, rows)
    return keepsWholeImage(bounds, columns, rows) ? null : bounds
  }

  /**
   * Painting a mask writes over the stored samples, cutting a frame out of a
   * crop copies rows out of them, and splitting a run cuts them by byte offset.
   * None of the three means anything on a bitstream, so a compressed file that
   * needs any of them is decoded and written back out as plain samples.
   *
   * A compressed file that needs none — a single frame with nothing to blank
   * and nothing to cut away — is passed through untouched, which keeps it small
   * and keeps it lossless.
   */
  const changingPixels =
    totalFrames > 1 || tasks.some((task) => (task.masks?.length ?? 0) > 0 || cropOf(task) !== null)
  const rewriting = compression !== null && changingPixels
  if (rewriting && !canDecode(transferSyntax ?? '')) {
    throw new Error(
      `Cannot read the pixel data of ${path.basename(sourcePath)}: ${compression} is not a format this app decodes`
    )
  }
  // Frames of an encapsulated object are fragments rather than offsets, and
  // dicom-parser is what knows how to find them.
  const encapsulated = rewriting ? dicomParser.parseDicom(new Uint8Array(buf)) : null
  const header = rewriting ? parseHeader(new Uint8Array(buf)) : null

  const storedGeometry: PixelGeometry = {
    rows,
    columns,
    samplesPerPixel: samples,
    bitsAllocated,
    signed: numberOf(dict, '00280103', 0) === 1,
    planarConfiguration: numberOf(dict, '00280006', 0),
    bigEndian: transferSyntax === EXPLICIT_VR_BIG_ENDIAN
  }
  const storedPhotometric = firstValue(dict, '00280004') ?? 'MONOCHROME2'
  const rescale = { slope: decimalOf(dict, '00281053', 1), intercept: decimalOf(dict, '00281052', 0) }
  const fileWindow = windowOf(dict)

  /** Where the file says its pixels are, read before a crop moves them. */
  const placement = {
    imagePosition: decimalListOf(dict, '00200032', 3) as [number, number, number] | null,
    imageOrientation: decimalListOf(dict, '00200037', 6),
    pixelSpacing: (() => {
      const pair = decimalListOf(dict, '00280030', 2)
      return pair === null || pair[0] <= 0 || pair[1] <= 0 ? null : { row: pair[0], column: pair[1] }
    })()
  }

  // The window and crop tags are rewritten per task, so their originals are kept
  // to put back — for a task that asked for no window of its own, and because
  // one dict serves every frame of the file and must start each one unmodified.
  const originalWindow = WINDOW_TAGS.map((tag) => [tag, dict[tag]] as const)
  const originalCrop = CROP_TAGS.map((tag) => [tag, dict[tag]] as const)

  const results: AnonymisedFile[] = []

  for (const task of tasks) {
    const masks = task.masks ?? []
    // One dict serves every frame of the file, so the grid a previous task
    // cropped must be back to the file's own before this one reads it.
    for (const [tag, original] of originalCrop) {
      if (original === undefined) delete dict[tag]
      else dict[tag] = original
    }
    // What the pixels are once this task has had its way with them. For a file
    // left as it was stored that is what the header said; for a decoded one it
    // is what the codec handed back, which is not the same thing.
    let geometry = storedGeometry
    let photometric = storedPhotometric

    if (rewriting && encapsulated && header) {
      const decoded = await decodeEncapsulatedFrame(encodedFrame(encapsulated, task.frame, totalFrames), header)
      writeDecodedFrame(message, dict, decoded, task.instanceNumber)
      geometry = {
        rows,
        columns,
        samplesPerPixel: decoded.samplesPerPixel,
        bitsAllocated: decoded.bitsAllocated,
        signed: decoded.signed,
        planarConfiguration: decoded.planarConfiguration,
        bigEndian: false
      }
      photometric = decoded.photometric
    } else if (totalFrames > 1) {
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
      const element = dict['7FE00010']
      const bytes = new Uint8Array(element.Value[0] as ArrayBuffer)
      const window = task.window ?? fileWindow
      const fill = blackSamples(
        {
          photometric,
          samplesPerPixel: geometry.samplesPerPixel,
          bitsAllocated: geometry.bitsAllocated,
          signed: geometry.signed,
          ...rescale
        },
        window,
        // Only worth a scan when nothing says which end of the range is dark.
        window === null && geometry.samplesPerPixel === 1 ? frameSamples(geometry, bytes) : undefined
      )
      fillMasks(bytes, geometry, masks, fill)
    }

    /**
     * Cut the image down, after the masks and never before them: both
     * rectangles are fractions of the image as it arrived, which is the picture
     * they were drawn on. A mask that falls outside the crop then goes the way
     * of everything else out there, which is the answer that needs no rule.
     *
     * Three tags describe the grid and all three have to move with it. Rows and
     * Columns are the obvious pair; ImagePositionPatient is the one that is
     * quietly wrong if it is left, because it names the corner of an image that
     * no longer starts there — and this app reads it back to stack a volume.
     *
     * Nothing else needs adjusting, which is worth saying because it is not
     * obvious: PixelSpacing is unchanged (the pixels are the same size), and
     * SequenceOfUltrasoundRegions — the one place a calibration is written in
     * pixel coordinates — is dropped by the anonymiser a few lines below.
     */
    const bounds = cropOf(task)
    if (bounds) {
      const element = dict['7FE00010']
      const stored = element?.Value?.[0] as ArrayBuffer | undefined
      if (!stored) throw new Error(`Cannot crop ${path.basename(sourcePath)}: pixel data is not addressable`)
      const cut = cropFrameBytes(new Uint8Array(stored), geometry, bounds)
      element.Value = [cut.buffer.slice(cut.byteOffset, cut.byteOffset + cut.byteLength) as ArrayBuffer]

      dict['00280010'] = { vr: 'US', Value: [bounds.rows] }
      dict['00280011'] = { vr: 'US', Value: [bounds.columns] }
      geometry = { ...geometry, rows: bounds.rows, columns: bounds.columns }

      // Only a crop that moved the corner moves the position. Trimming the
      // right and bottom edges leaves it exactly where it was, and rewriting an
      // unchanged value would round it for nothing.
      if (bounds.x > 0 || bounds.y > 0) {
        const moved = croppedPosition(placement, bounds)
        // A file that does not say which way it is pointing, or how big a pixel
        // is, cannot have its corner moved — and a position that describes a
        // grid the pixels are no longer on is worse than none. Order survives
        // it: the upload sends the slices in the order they were shown, and
        // this app read where they sat from the originals before any of this.
        if (moved) dict['00200032'] = { vr: 'DS', Value: decimals(moved) }
        else delete dict['00200032']
      }
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
