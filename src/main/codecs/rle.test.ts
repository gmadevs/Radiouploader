import { describe, expect, it } from 'vitest'
import type { ImageHeader } from '@shared/dicomImage'
import { decodeRleFrame } from './rle'

function header(options: Partial<ImageHeader> & { rows: number; columns: number }): ImageHeader {
  return {
    samplesPerPixel: 1,
    bitsAllocated: 8,
    signed: false,
    planarConfiguration: 0,
    photometric: 'MONOCHROME2',
    slope: 1,
    intercept: 0,
    windowCentre: null,
    windowWidth: null,
    frames: 1,
    transferSyntax: '1.2.840.10008.1.2.5',
    encapsulated: true,
    burnedInAnnotation: null,
    pixelSpacing: null,
    imagePosition: null,
    imageOrientation: null,
    bigEndian: false,
    pixelDataOffset: 0,
    ...options
  }
}

/** Wrap segments in the 64-byte table every RLE frame starts with. */
function frame(segments: Uint8Array[]): Uint8Array {
  const table = new Uint8Array(64)
  const view = new DataView(table.buffer)
  view.setUint32(0, segments.length, true)
  let at = 64
  segments.forEach((segment, i) => {
    view.setUint32(4 + i * 4, at, true)
    at += segment.length
  })

  const out = new Uint8Array(at)
  out.set(table, 0)
  let write = 64
  for (const segment of segments) {
    out.set(segment, write)
    write += segment.length
  }
  return out
}

/** PackBits using literal runs only, which is a legal encoding of anything. */
function literal(bytes: number[]): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < bytes.length; i += 128) {
    const chunk = bytes.slice(i, i + 128)
    out.push(chunk.length - 1, ...chunk)
  }
  return new Uint8Array(out)
}

describe('decodeRleFrame', () => {
  it('reads literal runs', () => {
    const values = [1, 2, 3, 4, 250, 6, 7, 8, 9]
    const decoded = decodeRleFrame(frame([literal(values)]), header({ rows: 3, columns: 3 }))
    expect([...decoded.bytes]).toEqual(values)
    expect(decoded.bitsAllocated).toBe(8)
    expect(decoded.samplesPerPixel).toBe(1)
  })

  it('expands a replicate run', () => {
    // -3 as a signed control byte, so the byte after it stands for four.
    const segment = new Uint8Array([0xfd, 0x2a, 1, 7, 8])
    const decoded = decodeRleFrame(frame([segment]), header({ rows: 2, columns: 3 }))
    expect([...decoded.bytes]).toEqual([0x2a, 0x2a, 0x2a, 0x2a, 7, 8])
  })

  it('reads the longest run there is, which is 128 of one byte', () => {
    const segment = new Uint8Array([0x81, 0x5c])
    const decoded = decodeRleFrame(frame([segment]), header({ rows: 8, columns: 16 }))
    expect(decoded.bytes).toHaveLength(128)
    expect([...decoded.bytes].every((v) => v === 0x5c)).toBe(true)
  })

  it('skips the control byte that means nothing', () => {
    // -128 is reserved and stands for no output at all; a decoder that read it
    // as a length would swallow the byte after it.
    const decoded = decodeRleFrame(frame([new Uint8Array([0x80, 0x01, 4, 5])]), header({ rows: 1, columns: 2 }))
    expect([...decoded.bytes]).toEqual([4, 5])
  })

  it('weaves the two byte planes of a wide image back together', () => {
    // The segments are byte planes, most significant first, and what comes out
    // has to be little-endian: the wrong way round is an image rather than an
    // error, and it is noise that looks like one.
    const high = literal([0x01, 0x02, 0x00])
    const low = literal([0x00, 0x34, 0xff])
    const decoded = decodeRleFrame(frame([high, low]), header({ rows: 1, columns: 3, bitsAllocated: 16 }))
    expect(decoded.bitsAllocated).toBe(16)
    const values = new Uint16Array(decoded.bytes.buffer, decoded.bytes.byteOffset, 3)
    expect([...values]).toEqual([0x0100, 0x0234, 0x00ff])
  })

  it('interleaves the three planes of a colour image', () => {
    const decoded = decodeRleFrame(
      frame([literal([1, 2]), literal([10, 20]), literal([100, 200])]),
      header({ rows: 1, columns: 2, samplesPerPixel: 3, photometric: 'RGB' })
    )
    expect([...decoded.bytes]).toEqual([1, 10, 100, 2, 20, 200])
    expect(decoded.planarConfiguration).toBe(0)
  })

  it('leaves the photometric interpretation alone, since RLE transforms nothing', () => {
    // Every codec next door undoes a colour transform on the way out and has to
    // say so. This one does not, so the file's own word stays true.
    const decoded = decodeRleFrame(
      frame([literal([1, 2]), literal([3, 4]), literal([5, 6])]),
      header({ rows: 1, columns: 2, samplesPerPixel: 3, photometric: 'YBR_FULL' })
    )
    expect(decoded.photometric).toBe('YBR_FULL')
  })

  it('ignores the padding an encoder leaves on the end of a segment', () => {
    const decoded = decodeRleFrame(frame([literal([1, 2, 3, 4, 0])]), header({ rows: 2, columns: 2 }))
    expect([...decoded.bytes]).toEqual([1, 2, 3, 4])
  })

  it('refuses a frame that runs out before the image does', () => {
    expect(() => decodeRleFrame(frame([literal([1, 2])]), header({ rows: 4, columns: 4 }))).toThrow(
      /truncated/
    )
  })

  it('refuses a segment count that does not match the image', () => {
    // The count is what says which byte of which channel each plane is; a file
    // that disagrees with its own header is not one to guess at.
    expect(() =>
      decodeRleFrame(frame([literal([1, 2, 3, 4])]), header({ rows: 2, columns: 2, bitsAllocated: 16 }))
    ).toThrow(/segments/)
  })

  it('refuses a frame too short to hold its own table', () => {
    expect(() => decodeRleFrame(new Uint8Array(12), header({ rows: 2, columns: 2 }))).toThrow(/too short/)
  })

  it('refuses a segment pointing outside the frame', () => {
    const broken = frame([literal([1, 2, 3, 4])])
    new DataView(broken.buffer).setUint32(4, 4, true)
    expect(() => decodeRleFrame(broken, header({ rows: 2, columns: 2 }))).toThrow(/outside the frame/)
  })
})
