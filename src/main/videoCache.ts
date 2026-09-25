import fs from 'node:fs/promises'
import path from 'node:path'
import type { ImageHeader } from '@shared/dicomImage'
import { decodeVideoFile, type DecodedVideo } from './codecs/video'
import { diskFree, gigabytes, HEADROOM_BYTES } from './ingest/scan'
import { session } from './session'

/**
 * Each video of the import decoded once, on first need, into the session's
 * working directory.
 *
 * A video cannot be decoded a frame at a time, and the viewer scrubs it, the
 * check reads two frames of it and the anonymiser wants every one — so the
 * decode is shared, and the first to ask pays for it. Kept in the working
 * directory because a decoded clip is patient pixels by the hundred megabytes:
 * it goes when the session is reset or the app quits, and a crash leaves it to
 * the launch sweep like everything else there.
 *
 * Keyed by working directory as well as by file, so a reset — which makes a
 * new directory — cannot hand back a decode whose file has been deleted.
 */
const decoded = new Map<string, Promise<DecodedVideo>>()

/**
 * Refuse a video whose decoded frames would fill the disk.
 *
 * A decoded clip is plain RGB, so its size is known before decoding starts:
 * rows × columns × 3 bytes per frame. Checked up front, with the same margin as
 * a zip, so a long clip on a nearly full disk is refused with the numbers
 * instead of failing when the disk fills partway through the decode.
 */
export async function checkRoomForVideo(
  sourcePath: string,
  header: Pick<ImageHeader, 'rows' | 'columns' | 'frames'>,
  dir: string,
  freeSpace: (dir: string) => Promise<number> = diskFree
): Promise<void> {
  const needed = header.rows * header.columns * 3 * header.frames
  const free = await freeSpace(dir)
  if (needed + HEADROOM_BYTES > free) {
    throw new Error(
      `Decoding the video in ${path.basename(sourcePath)} needs ${gigabytes(needed)} and the disk has ` +
        `${gigabytes(free)} free. Free some space and open it again.`
    )
  }
}

export async function decodedVideo(sourcePath: string, header: ImageHeader): Promise<DecodedVideo> {
  const workDir = await session.workDir()
  const key = `${workDir}\0${sourcePath}`
  let pending = decoded.get(key)
  if (!pending) {
    pending = (async () => {
      const dir = path.join(workDir, 'video')
      await fs.mkdir(dir, { recursive: true })
      await checkRoomForVideo(sourcePath, header, dir)
      return decodeVideoFile(sourcePath, path.join(dir, `${decoded.size}.rgb`), {
        rows: header.rows,
        columns: header.columns
      })
    })()
    // A decode that failed is not remembered: the next ask gets the error
    // afresh, and a file fixed on disk in the meantime gets decoded.
    pending.catch(() => decoded.delete(key))
    decoded.set(key, pending)
  }
  return pending
}

/** Forget every decode, as a new import starts. The files go with the working directory. */
export function forgetDecodedVideos(): void {
  decoded.clear()
}
