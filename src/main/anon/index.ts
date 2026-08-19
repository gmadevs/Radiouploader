import fs from 'node:fs/promises'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { AnonResult, AnonWarning, Progress, Stack } from '@shared/types'
import type { AnonJob, AnonMessage } from './anon.worker'
import type { FrameTask } from './anonymise'

/**
 * Anonymise every slice of the selected stacks into a fresh directory.
 *
 * Output names encode stack and slice order so the upload step can present the
 * images to Radiopaedia in the right sequence — after anonymisation the
 * original identifiers are gone, and the on-disk order is all that is left.
 */
export async function anonymiseStacks(
  stacks: Stack[],
  workDir: string,
  onProgress?: (p: Progress) => void
): Promise<AnonResult> {
  const outputDir = path.join(workDir, 'anonymised')
  await fs.mkdir(outputDir, { recursive: true })

  // Every slice becomes its own file, including each frame of a multiframe run.
  // Tasks are grouped by source so a large cine is read once, not once per frame.
  const bySource = new Map<string, FrameTask[]>()
  let total = 0
  stacks.forEach((stack, stackIndex) => {
    stack.slices.forEach((slice, sliceIndex) => {
      const outputName = `${String(stackIndex).padStart(3, '0')}-${String(sliceIndex).padStart(4, '0')}.dcm`
      const tasks = bySource.get(slice.path)
      // InstanceNumber follows the position in the stack, so split frames keep
      // the order the user saw even when they came from several files.
      const task: FrameTask = { frame: slice.frame, outputName, instanceNumber: sliceIndex + 1 }
      if (tasks) tasks.push(task)
      else bySource.set(slice.path, [task])
      total++
    })
  })
  const sources: AnonJob['sources'] = [...bySource].map(([sourcePath, tasks]) => ({ sourcePath, tasks }))

  const result: AnonResult = { outputDir, files: [], warnings: [], errors: [] }
  if (total === 0) return result

  const workerPath = path.join(import.meta.dirname, 'anon.worker.js')
  const worker = new Worker(workerPath, { workerData: { outputDir, sources } satisfies AnonJob })

  await new Promise<void>((resolve, reject) => {
    worker.on('message', (msg: AnonMessage) => {
      switch (msg.type) {
        case 'progress':
          onProgress?.({ phase: 'anonymising', done: msg.done, total: msg.total })
          break
        case 'file': {
          const { warnings, ...rest } = msg.file
          result.files.push(rest)
          result.warnings.push(...(warnings as AnonWarning[]))
          break
        }
        case 'error':
          result.errors.push({ path: msg.path, reason: msg.reason })
          break
        case 'done':
          resolve()
          break
      }
    })
    worker.on('error', reject)
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Anonymiser worker exited with code ${code}`))
    })
  })

  await worker.terminate()
  // Preserve stack/slice order regardless of completion order.
  result.files.sort((a, b) => a.outputPath.localeCompare(b.outputPath))
  return result
}

/**
 * Collapse per-file warnings into one row per distinct message, since the same
 * warning fires on every slice of a series.
 */
export function summariseWarnings(warnings: AnonWarning[]): { tag: string; text: string; level: number; count: number }[] {
  const byKey = new Map<string, { tag: string; text: string; level: number; count: number }>()
  for (const w of warnings) {
    const key = `${w.tag}|${w.text}`
    const existing = byKey.get(key)
    if (existing) existing.count++
    else byKey.set(key, { tag: w.tag, text: w.text, level: w.level, count: 1 })
  }
  return [...byKey.values()].sort((a, b) => b.level - a.level || b.count - a.count)
}
