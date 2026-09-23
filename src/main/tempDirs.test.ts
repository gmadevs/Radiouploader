import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSessionDir, sweepOrphans } from './tempDirs'

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sweep-test-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

/** The id of a process that has run and gone. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''])
  await new Promise((resolve) => child.on('exit', resolve))
  return child.pid!
}

async function dir(name: string, ageMs = 0): Promise<string> {
  const full = path.join(root, name)
  await fs.mkdir(full)
  await fs.writeFile(path.join(full, 'slice.dcm'), 'patient data')
  if (ageMs > 0) {
    const then = new Date(Date.now() - ageMs)
    await fs.utimes(full, then, then)
  }
  return full
}

const exists = (full: string): Promise<boolean> =>
  fs.access(full).then(
    () => true,
    () => false
  )

describe('sweepOrphans', () => {
  it('removes what a process that is gone left behind', async () => {
    const left = await dir(`radiouploader-${await deadPid()}-work-abc`)
    expect(await sweepOrphans(root)).toEqual([left])
    expect(await exists(left)).toBe(false)
  })

  it('keeps what a running process is using', async () => {
    // The test runner's parent is alive for as long as this test is.
    const inUse = await dir(`radiouploader-${process.ppid}-import-abc`)
    expect(await sweepOrphans(root)).toEqual([])
    expect(await exists(inUse)).toBe(true)
  })

  it('keeps its own, and removes an earlier run’s that happened to have the same id', async () => {
    const mine = await createSessionDir('work', root)
    const earlier = await dir(`radiouploader-${process.pid}-work-old`)
    expect(await sweepOrphans(root)).toEqual([earlier])
    expect(await exists(mine)).toBe(true)
  })

  it('removes a directory from an older version only once it is a day old', async () => {
    const old = await dir('radiopaedia-work-abc', 25 * 3600_000)
    const fresh = await dir('radiopaedia-uploader-abc')
    expect(await sweepOrphans(root)).toEqual([old])
    expect(await exists(fresh)).toBe(true)
  })

  it('leaves everything else in the temporary directory alone', async () => {
    const other = await dir('someone-elses-1234', 30 * 24 * 3600_000)
    const odd = await dir('radiouploader-notapid')
    expect(await sweepOrphans(root)).toEqual([])
    expect(await exists(other)).toBe(true)
    expect(await exists(odd)).toBe(true)
  })

  it('says nothing, rather than throwing, when the directory cannot be read', async () => {
    expect(await sweepOrphans(path.join(root, 'missing'))).toEqual([])
  })
})
