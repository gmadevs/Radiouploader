import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import * as dcmio from 'dicomanon'
import type { AnonWarning } from '@shared/types'

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
}

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

  const totalFrames = numberOf(dict, '00280008', 1)
  const pixelElement = dict['7FE00010']
  const allPixels = pixelElement?.Value?.[0] as ArrayBuffer | undefined

  // Frame size from the geometry, so a frame can be sliced without decoding.
  const rows = numberOf(dict, '00280010', 0)
  const columns = numberOf(dict, '00280011', 0)
  const samples = numberOf(dict, '00280002', 1)
  const bitsAllocated = numberOf(dict, '00280100', 16)
  const frameLength = rows * columns * samples * (bitsAllocated <= 8 ? 1 : 2)

  const results: AnonymisedFile[] = []

  for (const task of tasks) {
    if (totalFrames > 1) {
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
