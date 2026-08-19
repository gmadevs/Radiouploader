import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  UnsupportedTransferSyntaxError,
  decodeFrame,
  downscale,
  frameByteLength,
  frameOffset,
  parseHeader,
  type ImageHeader
} from './dicomImage'

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '../main/anon/__fixtures__')

function read(name: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(fixtures, name)))
}

/**
 * Build a header over synthetic pixels.
 *
 * The checked-in fixtures are tiny and uniformly bright, which cannot exercise
 * windowing, inversion or frame offsets — driving the decoder directly does.
 */
function synthetic(options: {
  columns: number
  rows: number
  frames?: number
  bitsAllocated?: number
  signed?: boolean
  photometric?: string
  windowCentre?: number | null
  windowWidth?: number | null
  slope?: number
  intercept?: number
  samplesPerPixel?: number
  planarConfiguration?: number
  bigEndian?: boolean
}): ImageHeader {
  return {
    rows: options.rows,
    columns: options.columns,
    samplesPerPixel: options.samplesPerPixel ?? 1,
    bitsAllocated: options.bitsAllocated ?? 16,
    signed: options.signed ?? false,
    planarConfiguration: options.planarConfiguration ?? 0,
    photometric: options.photometric ?? 'MONOCHROME2',
    slope: options.slope ?? 1,
    intercept: options.intercept ?? 0,
    windowCentre: options.windowCentre ?? null,
    windowWidth: options.windowWidth ?? null,
    frames: options.frames ?? 1,
    bigEndian: options.bigEndian ?? false,
    pixelDataOffset: 0
  }
}

/** Encode sample values the way the file would store them. */
function bytesFor(header: ImageHeader, values: number[]): Uint8Array {
  const wide = header.bitsAllocated > 8
  const bytes = new Uint8Array(values.length * (wide ? 2 : 1))
  const view = new DataView(bytes.buffer)
  values.forEach((v, i) => {
    if (!wide) bytes[i] = v
    else if (header.signed) view.setInt16(i * 2, v, !header.bigEndian)
    else view.setUint16(i * 2, v, !header.bigEndian)
  })
  return bytes
}

/** Grey level of pixel `i`. */
const grey = (frame: { rgba: Uint8ClampedArray }, i: number): number => frame.rgba[i * 4]

/**
 * Mid-window values land on 127.5 and the exact rounding is not a property
 * worth pinning, so mid-grey is asserted with a tolerance.
 */
function expectMidGrey(value: number): void {
  expect(value).toBeGreaterThan(125)
  expect(value).toBeLessThan(130)
}

describe('parseHeader', () => {
  it('reads geometry and photometric interpretation', () => {
    const header = parseHeader(read('01_ras_physician.dcm'))
    expect(header.rows).toBeGreaterThan(0)
    expect(header.columns).toBeGreaterThan(0)
    expect(header.frames).toBeGreaterThanOrEqual(1)
    expect(header.photometric).toMatch(/MONOCHROME|RGB|PALETTE/)
    expect(header.pixelDataOffset).toBeGreaterThan(0)
  })

  it('parses from a truncated read, so a 250 MB cine need not be loaded whole', () => {
    const whole = read('01_ras_physician.dcm')
    const full = parseHeader(whole)
    // Everything up to and including the pixel data element header is enough.
    const truncated = parseHeader(whole.subarray(0, full.pixelDataOffset + 2))
    expect(truncated).toEqual(full)
  })

  it('refuses compressed pixel data by name instead of rendering nonsense', () => {
    const jpeg = read('TestPattern_JPEG-Baseline_YBRFull.dcm')
    expect(() => parseHeader(jpeg)).toThrow(UnsupportedTransferSyntaxError)
    expect(() => parseHeader(jpeg)).toThrow(/JPEG baseline/)
  })
})

describe('frame addressing', () => {
  const header = synthetic({ columns: 4, rows: 2, frames: 3 })

  it('sizes a frame from geometry and bit depth', () => {
    expect(frameByteLength(header)).toBe(4 * 2 * 2)
    expect(frameByteLength(synthetic({ columns: 4, rows: 2, bitsAllocated: 8 }))).toBe(8)
    expect(frameByteLength(synthetic({ columns: 4, rows: 2, samplesPerPixel: 3, bitsAllocated: 8 }))).toBe(24)
  })

  it('steps one frame at a time from the pixel data offset', () => {
    expect(frameOffset(header, 0)).toBe(0)
    expect(frameOffset(header, 1)).toBe(16)
    expect(frameOffset(header, 2)).toBe(32)
  })

  it('clamps a frame index outside the object rather than reading past the end', () => {
    expect(frameOffset(header, 99)).toBe(32)
    expect(frameOffset(header, -5)).toBe(0)
  })
})

describe('decodeFrame', () => {
  it('produces a fully opaque RGBA buffer of the right size', () => {
    const header = parseHeader(read('01_ras_physician.dcm'))
    const whole = read('01_ras_physician.dcm')
    const frame = decodeFrame(header, whole.subarray(header.pixelDataOffset))

    expect(frame.width).toBe(header.columns)
    expect(frame.height).toBe(header.rows)
    expect(frame.rgba.length).toBe(header.rows * header.columns * 4)
    for (let i = 3; i < frame.rgba.length; i += 4) expect(frame.rgba[i]).toBe(255)
  })

  it('maps the window onto the full display range', () => {
    // Window 100 wide centred on 150 spans 100..200.
    const header = synthetic({ columns: 2, rows: 2, windowCentre: 150, windowWidth: 100 })
    const frame = decodeFrame(header, bytesFor(header, [100, 150, 200, 0]))
    expect(grey(frame, 0)).toBe(0)
    expectMidGrey(grey(frame, 1))
    expect(grey(frame, 2)).toBe(255)
    // Below the window clamps to black rather than wrapping.
    expect(grey(frame, 3)).toBe(0)
  })

  it('inverts MONOCHROME1, where high values are dark', () => {
    const values = [100, 150, 200]
    const base = { columns: 3, rows: 1, windowCentre: 150, windowWidth: 100 }
    const normal = decodeFrame(synthetic(base), bytesFor(synthetic(base), values))
    const flipped = synthetic({ ...base, photometric: 'MONOCHROME1' })
    const inverted = decodeFrame(flipped, bytesFor(flipped, values))

    for (let i = 0; i < values.length; i++) {
      expect(grey(inverted, i)).toBe(255 - grey(normal, i))
    }
  })

  it('applies the modality rescale before windowing', () => {
    // Stored 0..100 with slope 2 intercept -50 becomes -50..150.
    const header = synthetic({
      columns: 3,
      rows: 1,
      slope: 2,
      intercept: -50,
      windowCentre: 50,
      windowWidth: 200
    })
    const frame = decodeFrame(header, bytesFor(header, [0, 50, 100]))
    expect(grey(frame, 0)).toBe(0)
    expectMidGrey(grey(frame, 1))
    expect(grey(frame, 2)).toBe(255)
  })

  it('reads signed pixel data as negative, not as a huge positive', () => {
    const header = synthetic({ columns: 3, rows: 1, signed: true, windowCentre: 0, windowWidth: 2000 })
    const frame = decodeFrame(header, bytesFor(header, [-1000, 0, 1000]))
    expect(grey(frame, 0)).toBe(0)
    expectMidGrey(grey(frame, 1))
    expect(grey(frame, 2)).toBe(255)
  })

  it('reads big-endian pixel data', () => {
    const base = { columns: 3, rows: 1, windowCentre: 150, windowWidth: 100 }
    const values = [100, 150, 200]
    const little = decodeFrame(synthetic(base), bytesFor(synthetic(base), values))
    const bigHeader = synthetic({ ...base, bigEndian: true })
    const big = decodeFrame(bigHeader, bytesFor(bigHeader, values))
    for (let i = 0; i < 3; i++) expect(grey(big, i)).toBe(grey(little, i))
  })

  it('stretches the pixel range when the header carries no window', () => {
    const header = synthetic({ columns: 3, rows: 1 })
    const frame = decodeFrame(header, bytesFor(header, [20, 60, 100]))
    expect(grey(frame, 0)).toBe(0)
    expect(grey(frame, 2)).toBe(255)
  })

  it('reads interleaved and planar RGB the same way', () => {
    const shared = { columns: 2, rows: 1, bitsAllocated: 8, samplesPerPixel: 3, photometric: 'RGB' }
    const interleaved = synthetic(shared)
    const planar = synthetic({ ...shared, planarConfiguration: 1 })

    const a = decodeFrame(interleaved, bytesFor(interleaved, [255, 0, 0, 0, 255, 0]))
    const b = decodeFrame(planar, bytesFor(planar, [255, 0, 0, 255, 0, 0]))

    for (const frame of [a, b]) {
      expect([...frame.rgba.slice(0, 4)]).toEqual([255, 0, 0, 255])
      expect([...frame.rgba.slice(4, 8)]).toEqual([0, 255, 0, 255])
    }
  })

  it('refuses a frame whose bytes are short rather than reading rubbish', () => {
    const header = synthetic({ columns: 4, rows: 4 })
    expect(() => decodeFrame(header, bytesFor(header, [1, 2, 3, 4]))).toThrow(/past the end/)
  })
})

describe('downscale', () => {
  const header = synthetic({ columns: 100, rows: 40, windowCentre: 128, windowWidth: 255 })
  const frame = decodeFrame(header, bytesFor(header, Array.from({ length: 4000 }, (_, i) => i % 256)))

  it('fits the longest edge to the limit and keeps the aspect ratio', () => {
    const small = downscale(frame, 50)
    expect(small.width).toBe(50)
    expect(small.height).toBe(20)
    expect(small.rgba.length).toBe(50 * 20 * 4)
  })

  it('leaves a frame already within the limit untouched', () => {
    expect(downscale(frame, 200)).toBe(frame)
  })

  it('keeps every pixel opaque', () => {
    const small = downscale(frame, 30)
    for (let i = 3; i < small.rgba.length; i += 4) expect(small.rgba[i]).toBe(255)
  })
})
