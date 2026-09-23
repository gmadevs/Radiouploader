import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * The directories that hold a session's patient data: originals extracted from
 * a zip, anonymised output, reformats.
 *
 * Quitting removes them, but a crash, a force-quit or a machine that loses power
 * does not quit, and what it leaves behind is identifiable data in a directory
 * nobody knows is there — macOS keeps its temporary files for days. So each one
 * is named after the process that made it, and at launch every one whose
 * process is gone is removed.
 */

const PREFIX = 'radiouploader-'

/**
 * Names left by versions before the process was in the name. Nothing says
 * whether the app that made one is still running, so only an old one goes — a
 * day is longer than anybody keeps a case open.
 */
const LEGACY_PREFIXES = ['radiopaedia-uploader-', 'radiopaedia-work-']
const LEGACY_AGE_MS = 24 * 3600_000

/** What this process made, which is the one case where its own id proves nothing. */
const made = new Set<string>()

export async function createSessionDir(kind: 'import' | 'work', root = os.tmpdir()): Promise<string> {
  const dir = await fs.mkdtemp(path.join(root, `${PREFIX}${process.pid}-${kind}-`))
  made.add(dir)
  return dir
}

/** EPERM is a process that exists and belongs to someone else. */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Whether a directory was left by a process that is no longer there.
 *
 * A process id is reused, so a live one proves only that the directory might
 * still be in use, and it is kept — until that process goes too. Our own id on
 * a directory we did not make is the one reuse that can be told apart: it was
 * left by an earlier run that happened to have the same number.
 */
async function orphaned(dir: string, name: string, now: number): Promise<boolean> {
  if (name.startsWith(PREFIX)) {
    const pid = Number.parseInt(name.slice(PREFIX.length), 10)
    if (!Number.isInteger(pid) || pid <= 0) return false
    if (pid === process.pid) return !made.has(dir)
    return !running(pid)
  }
  if (LEGACY_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    const stat = await fs.stat(dir).catch(() => null)
    return stat !== null && now - stat.mtimeMs > LEGACY_AGE_MS
  }
  return false
}

/** Remove what earlier runs left behind, and say what went. Never throws. */
export async function sweepOrphans(root = os.tmpdir(), now = Date.now()): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  const removed: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(root, entry.name)
    if (!(await orphaned(dir, entry.name, now))) continue
    await fs.rm(dir, { recursive: true, force: true }).then(
      () => removed.push(dir),
      () => {}
    )
  }
  return removed
}
