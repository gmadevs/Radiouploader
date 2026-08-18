import { parentPort, workerData } from 'node:worker_threads'
import { anonymiseFile } from './anonymise'

export interface AnonJob {
  outputDir: string
  /** Source path plus the name to write it under, pre-assigned by the manager. */
  files: { sourcePath: string; outputName: string }[]
}

export type AnonMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'file'; file: Awaited<ReturnType<typeof anonymiseFile>> }
  | { type: 'error'; path: string; reason: string }
  | { type: 'done' }

async function run(): Promise<void> {
  const job = workerData as AnonJob
  const port = parentPort
  if (!port) throw new Error('anon.worker must be started as a worker thread')

  let done = 0
  for (const { sourcePath, outputName } of job.files) {
    try {
      const file = await anonymiseFile(sourcePath, job.outputDir, outputName)
      port.postMessage({ type: 'file', file } satisfies AnonMessage)
    } catch (err) {
      port.postMessage({
        type: 'error',
        path: sourcePath,
        reason: err instanceof Error ? err.message : String(err)
      } satisfies AnonMessage)
    }
    done++
    port.postMessage({ type: 'progress', done, total: job.files.length } satisfies AnonMessage)
  }
  port.postMessage({ type: 'done' } satisfies AnonMessage)
}

void run()
