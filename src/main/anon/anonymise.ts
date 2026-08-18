import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import * as dcmio from 'dicomanon'
import type { AnonWarning } from '@shared/types'

export interface AnonymisedFile {
  sourcePath: string
  outputPath: string
  sha256: string
  byteLength: number
  warnings: AnonWarning[]
}

/** Warning levels below this are noise for a case uploader. */
const WARNING_LEVEL_FLOOR = 3

/**
 * Anonymise one instance with the Radiopaedia reference anonymiser.
 *
 * The library applies a whitelist — every element is dropped unless explicitly
 * permitted — and regenerates the structural UIDs by SHA-512 hashing. That
 * hashing is deterministic, so study/series/instance relationships survive
 * intact across files and across runs.
 *
 * It cannot detect identifying text burnt into the pixel data; that stays the
 * uploader's responsibility, which is why the UI shows the images before upload.
 */
export async function anonymiseFile(sourcePath: string, outputDir: string, outputName: string): Promise<AnonymisedFile> {
  const buf = await fs.readFile(sourcePath)
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer

  const message = dcmio.Message.readFile(arrayBuffer)
  message.dict = dcmio.Anonymize(message.dict)

  const warnings: AnonWarning[] = []
  const report = dcmio.Validator(message.dict) as Record<string, { level: number; text: string }[]>
  for (const [tag, entries] of Object.entries(report ?? {})) {
    for (const entry of entries ?? []) {
      if (entry.level >= WARNING_LEVEL_FLOOR) {
        warnings.push({ path: sourcePath, tag, level: entry.level, text: entry.text })
      }
    }
  }

  const out = Buffer.from(message.write())
  const outputPath = path.join(outputDir, outputName)
  await fs.writeFile(outputPath, out)

  return {
    sourcePath,
    outputPath,
    sha256: createHash('sha256').update(out).digest('hex'),
    byteLength: out.byteLength,
    warnings
  }
}
