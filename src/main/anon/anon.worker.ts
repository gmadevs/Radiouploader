import { parentPort, workerData } from 'node:worker_threads'
import { anonymiseFile, type FrameTask } from './anonymise'

export interface AnonJob {
  outputDir: string
  /**
   * Grouped by source file so a 250 MB cine run is read and parsed once,
   * however many of its frames are wanted.
   */
  sources: { sourcePath: string; tasks: FrameTask[] }[]
}

export type AnonMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'file'; file: Awaited<ReturnType<typeof anonymiseFile>>[number] }
  | { type: 'error'; path: string; reason: string }
  | { type: 'done' }

async function run(): Promise<void> {
  const job = workerData as AnonJob
  const port = parentPort
  if (!port) throw new Error('anon.worker must be started as a worker thread')

  const total = job.sources.reduce((n, source) => n + source.tasks.length, 0)
  let done = 0

  for (const { sourcePath, tasks } of job.sources) {
    try {
      for (const file of await anonymiseFile(sourcePath, job.outputDir, tasks)) {
        port.postMessage({ type: 'file', file } satisfies AnonMessage)
      }
    } catch (err) {
      port.postMessage({
        type: 'error',
        path: sourcePath,
        reason: err instanceof Error ? err.message : String(err)
      } satisfies AnonMessage)
    }
    done += tasks.length
    port.postMessage({ type: 'progress', done, total } satisfies AnonMessage)
  }
  port.postMessage({ type: 'done' } satisfies AnonMessage)
}

void run()
