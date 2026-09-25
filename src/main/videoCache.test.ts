import os from 'node:os'
import { describe, expect, it } from 'vitest'
import { checkRoomForVideo } from './videoCache'

// A 300-frame clip at 1024x768 decodes to 1024 * 768 * 3 * 300 bytes, about 0.7 GB.
const clip = { rows: 768, columns: 1024, frames: 300 }
const GB = 1024 ** 3

describe('checkRoomForVideo', () => {
  it('lets a clip decode when the disk has room for it and the margin', async () => {
    await expect(checkRoomForVideo('/study/video.dcm', clip, os.tmpdir(), async () => 2 * GB)).resolves.toBeUndefined()
  })

  it('refuses before decoding when the frames would leave too little space, and says how much', async () => {
    await expect(checkRoomForVideo('/study/video.dcm', clip, os.tmpdir(), async () => 1 * GB)).rejects.toThrow(
      /video\.dcm needs 0\.7 GB and the disk has 1\.0 GB free/
    )
  })
})
