import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as dcmio from 'dicomanon'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readInstance } from './dicom'

/**
 * Reading the functional groups of an enhanced object out of a real file.
 *
 * The grouping is tested from synthetic metadata elsewhere; this is the other
 * half, and the half where a mistake hides — a sequence read from the wrong
 * nesting level comes back empty rather than wrong, and an object that should
 * have split arrives whole with nothing to say why.
 */

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '../anon/__fixtures__')
let outDir: string

beforeAll(async () => {
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'frames-test-'))
})
afterAll(async () => {
  await fs.rm(outDir, { recursive: true, force: true })
})

type Dict = Record<string, { vr: string; Value: unknown[] }>

const ds = (...values: number[]): { vr: string; Value: string[] } => ({
  vr: 'DS',
  Value: values.map(String)
})

/** An FD element, which is how the functional groups write a real number. */
function fd(value: number): { vr: string; Value: unknown[] } {
  return { vr: 'FD', Value: [value] }
}

interface FrameSpec {
  z: number
  temporalIndex?: number
  bValue?: number
  echoTime?: number
  stackId?: string
  inStackPosition?: number
}

/** Build an enhanced multiframe object from the 8x8 fixture. */
async function enhancedFile(name: string, frames: FrameSpec[]): Promise<string> {
  const buf = await fs.readFile(path.join(fixtures, '01_ras_physician.dcm'))
  const message = dcmio.Message.readFile(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  )
  const dict = message.dict as unknown as Dict

  const one = dict['7FE00010'].Value[0] as ArrayBuffer
  const all = new Uint8Array(one.byteLength * frames.length)
  for (let i = 0; i < frames.length; i++) all.set(new Uint8Array(one), i * one.byteLength)
  dict['7FE00010'] = { vr: 'OW', Value: [all.buffer as ArrayBuffer] }
  dict['00280008'] = { vr: 'IS', Value: [String(frames.length)] }

  // Shared: what every frame of this object has in common.
  dict['52009229'] = {
    vr: 'SQ',
    Value: [
      {
        '00209116': { vr: 'SQ', Value: [{ '00200037': ds(1, 0, 0, 0, 1, 0) }] },
        '00289110': { vr: 'SQ', Value: [{ '00280030': ds(0.5, 0.5), '00180050': ds(3) }] },
        '00289145': { vr: 'SQ', Value: [{ '00281052': ds(-1024), '00281053': ds(2) }] }
      }
    ]
  }

  dict['52009230'] = {
    vr: 'SQ',
    Value: frames.map((frame) => {
      const content: Dict = {}
      if (frame.temporalIndex !== undefined) {
        content['00209128'] = { vr: 'UL', Value: [frame.temporalIndex] }
      }
      if (frame.stackId !== undefined) content['00209056'] = { vr: 'SH', Value: [frame.stackId] }
      if (frame.inStackPosition !== undefined) {
        content['00209057'] = { vr: 'UL', Value: [frame.inStackPosition] }
      }

      const item: Dict = {
        '00209111': { vr: 'SQ', Value: [content] },
        '00209113': { vr: 'SQ', Value: [{ '00200032': ds(0, 0, frame.z) }] }
      }
      if (frame.bValue !== undefined) {
        item['00189117'] = { vr: 'SQ', Value: [{ '00189087': fd(frame.bValue) }] }
      }
      if (frame.echoTime !== undefined) {
        item['00189114'] = { vr: 'SQ', Value: [{ '00189082': fd(frame.echoTime) }] }
      }
      return item
    })
  }

  const outputPath = path.join(outDir, name)
  await fs.writeFile(outputPath, Buffer.from(message.write()))
  return outputPath
}

describe('readInstance — enhanced multiframe', () => {
  it('reads the time axis out of the per-frame groups', async () => {
    const file = await enhancedFile('phases.dcm', [
      { z: 0, temporalIndex: 1 },
      { z: 5, temporalIndex: 1 },
      { z: 0, temporalIndex: 2 },
      { z: 5, temporalIndex: 2 }
    ])
    const meta = await readInstance(file)

    expect(meta.numberOfFrames).toBe(4)
    expect(meta.frames).toHaveLength(4)
    expect(meta.frames?.map((f) => f.temporalIndex)).toEqual([1, 1, 2, 2])
    expect(meta.frames?.map((f) => f.frame)).toEqual([0, 1, 2, 3])
  })

  it('projects each frame position on the orientation the file shares', async () => {
    // The orientation is stated once for the object and the position once per
    // frame; reading the position without the shared orientation leaves every
    // frame at the same place, which is a stack of one image repeated.
    const meta = await readInstance(
      await enhancedFile('positions.dcm', [{ z: 0 }, { z: 3 }, { z: 6 }])
    )
    expect(meta.frames?.map((f) => f.sliceLocation)).toEqual([0, 3, 6])
  })

  it('reads a b-value from the diffusion group', async () => {
    const meta = await readInstance(
      await enhancedFile('diffusion.dcm', [
        { z: 0, bValue: 0 },
        { z: 0, bValue: 1000 }
      ])
    )
    expect(meta.frames?.map((f) => f.bValue)).toEqual([0, 1000])
  })

  it('numbers the echoes from the times, since the file only gives times', async () => {
    const meta = await readInstance(
      await enhancedFile('echoes.dcm', [
        { z: 0, echoTime: 80 },
        { z: 0, echoTime: 10 },
        { z: 5, echoTime: 80 }
      ])
    )
    expect(meta.frames?.map((f) => f.echoTime)).toEqual([80, 10, 80])
    // Numbered by time ascending, so the short echo is the first.
    expect(meta.frames?.map((f) => f.echoNumber)).toEqual([2, 1, 2])
  })

  it('reads StackID and the position within it', async () => {
    const meta = await readInstance(
      await enhancedFile('stacks.dcm', [
        { z: 0, stackId: '1', inStackPosition: 1 },
        { z: 2, stackId: '2', inStackPosition: 1 }
      ])
    )
    expect(meta.frames?.map((f) => f.stackId)).toEqual(['1', '2'])
    expect(meta.frames?.map((f) => f.inStackPosition)).toEqual([1, 1])
  })

  it('says nothing about frames when the file does not describe them one by one', async () => {
    // A legacy image, and the fallback everything relied on before: one stack
    // of whatever the file holds, rather than frames dropped on the strength of
    // a sequence that was not there.
    const meta = await readInstance(path.join(fixtures, '01_ras_physician.dcm'))
    expect(meta.frames).toBeNull()
  })
})
