import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { UnsupportedTransferSyntaxError, decodeFrame, parseImage, type ParsedImage } from './dicomImage'

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '../main/anon/__fixtures__')

function read(name: string): ArrayBuffer {
  const buf = fs.readFileSync(path.join(fixtures, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

/**
 * Build a ParsedImage over synthetic pixels.
 *
 * The checked-in fixtures are tiny and uniformly bright, which cannot exercise
 * windowing, inversion or frame offsets — driving the decoder directly does.
 */
function synthetic(options: {
  values: number[]
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
}): ParsedImage {
  const bitsAllocated = options.bitsAllocated ?? 16
  const bytes = bitsAllocated <= 8 ? 1 : 2
  const byteArray = new Uint8Array(options.values.length * bytes)
  const view = new DataView(byteArray.buffer)
  options.values.forEach((v, i) => {
    if (bytes === 1) byteArray[i] = v
    else if (options.signed) view.setInt16(i * 2, v, !options.bigEndian)
    else view.setUint16(i * 2, v, !options.bigEndian)
  })

  return {
    rows: options.rows,
    columns: options.columns,
    samplesPerPixel: options.samplesPerPixel ?? 1,
    bitsAllocated,
    signed: options.signed ?? false,
    planarConfiguration: options.planarConfiguration ?? 0,
    photometric: options.photometric ?? 'MONOCHROME2',
    slope: options.slope ?? 1,
    intercept: options.intercept ?? 0,
    windowCentre: options.windowCentre ?? null,
    windowWidth: options.windowWidth ?? null,
    frames: options.frames ?? 1,
    bigEndian: options.bigEndian ?? false,
    pixelDataOffset: 0,
    byteArray
  }
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

describe('parseImage', () => {
  it('reads the geometry and photometric interpretation', () => {
    const image = parseImage(read('01_ras_physician.dcm'))
    expect(image.rows).toBeGreaterThan(0)
    expect(image.columns).toBeGreaterThan(0)
    expect(image.frames).toBeGreaterThanOrEqual(1)
    expect(image.photometric).toMatch(/MONOCHROME|RGB|PALETTE/)
  })

  it('refuses compressed pixel data by name instead of rendering nonsense', () => {
    expect(() => parseImage(read('TestPattern_JPEG-Baseline_YBRFull.dcm'))).toThrow(UnsupportedTransferSyntaxError)
    expect(() => parseImage(read('TestPattern_JPEG-Baseline_YBRFull.dcm'))).toThrow(/JPEG baseline/)
  })
})

describe('decodeFrame', () => {
  it('produces a fully opaque RGBA buffer of the right size', () => {
    const image = parseImage(read('01_ras_physician.dcm'))
    const frame = decodeFrame(image, 0)

    expect(frame.width).toBe(image.columns)
    expect(frame.height).toBe(image.rows)
    expect(frame.rgba.length).toBe(image.rows * image.columns * 4)
    for (let i = 3; i < frame.rgba.length; i += 4) {
      expect(frame.rgba[i]).toBe(255)
    }
  })

  it('renders greyscale, so the three colour channels agree', () => {
    const frame = decodeFrame(parseImage(read('01_ras_physician.dcm')), 0)
    for (let i = 0; i < frame.rgba.length; i += 4) {
      expect(frame.rgba[i + 1]).toBe(frame.rgba[i])
      expect(frame.rgba[i + 2]).toBe(frame.rgba[i])
    }
  })

  it('maps the window onto the full display range', () => {
    // Window 100 wide centred on 150 spans 100..200.
    const image = synthetic({ values: [100, 150, 200, 0], columns: 2, rows: 2, windowCentre: 150, windowWidth: 100 })
    const frame = decodeFrame(image, 0)
    expect(grey(frame, 0)).toBe(0)
    expectMidGrey(grey(frame, 1))
    expect(grey(frame, 2)).toBe(255)
    // Below the window clamps to black rather than wrapping.
    expect(grey(frame, 3)).toBe(0)
  })

  it('inverts MONOCHROME1, where high values are dark', () => {
    const values = [100, 150, 200]
    const opts = { values, columns: 3, rows: 1, windowCentre: 150, windowWidth: 100 }
    const normal = decodeFrame(synthetic(opts), 0)
    const inverted = decodeFrame(synthetic({ ...opts, photometric: 'MONOCHROME1' }), 0)

    for (let i = 0; i < values.length; i++) {
      expect(grey(inverted, i)).toBe(255 - grey(normal, i))
    }
  })

  it('applies the modality rescale before windowing', () => {
    // Stored 0..100 with slope 2 intercept -50 becomes -50..150.
    const image = synthetic({
      values: [0, 50, 100],
      columns: 3,
      rows: 1,
      slope: 2,
      intercept: -50,
      windowCentre: 50,
      windowWidth: 200
    })
    const frame = decodeFrame(image, 0)
    expect(grey(frame, 0)).toBe(0)
    expectMidGrey(grey(frame, 1))
    expect(grey(frame, 2)).toBe(255)
  })

  it('reads signed pixel data as negative, not as a huge positive', () => {
    const image = synthetic({
      values: [-1000, 0, 1000],
      columns: 3,
      rows: 1,
      signed: true,
      windowCentre: 0,
      windowWidth: 2000
    })
    const frame = decodeFrame(image, 0)
    expect(grey(frame, 0)).toBe(0)
    expectMidGrey(grey(frame, 1))
    expect(grey(frame, 2)).toBe(255)
  })

  it('reads big-endian pixel data', () => {
    const opts = { values: [100, 150, 200], columns: 3, rows: 1, windowCentre: 150, windowWidth: 100 }
    const little = decodeFrame(synthetic(opts), 0)
    const big = decodeFrame(synthetic({ ...opts, bigEndian: true }), 0)
    for (let i = 0; i < 3; i++) expect(grey(big, i)).toBe(grey(little, i))
  })

  it('picks the right frame out of a multiframe object', () => {
    // Three 2x1 frames, each a flat value.
    const image = synthetic({
      values: [10, 10, 500, 500, 1000, 1000],
      columns: 2,
      rows: 1,
      frames: 3,
      windowCentre: 505,
      windowWidth: 990
    })
    expect(grey(decodeFrame(image, 0), 0)).toBe(0)
    expectMidGrey(grey(decodeFrame(image, 1), 0))
    expect(grey(decodeFrame(image, 2), 0)).toBe(255)
  })

  it('stretches the pixel range when the header carries no window', () => {
    const frame = decodeFrame(synthetic({ values: [20, 60, 100], columns: 3, rows: 1 }), 0)
    expect(grey(frame, 0)).toBe(0)
    expect(grey(frame, 2)).toBe(255)
  })

  it('reads interleaved and planar RGB the same way', () => {
    const interleaved = synthetic({
      values: [255, 0, 0, 0, 255, 0],
      columns: 2,
      rows: 1,
      bitsAllocated: 8,
      samplesPerPixel: 3,
      photometric: 'RGB'
    })
    const planar = synthetic({
      values: [255, 0, 0, 255, 0, 0],
      columns: 2,
      rows: 1,
      bitsAllocated: 8,
      samplesPerPixel: 3,
      planarConfiguration: 1,
      photometric: 'RGB'
    })
    for (const frame of [decodeFrame(interleaved, 0), decodeFrame(planar, 0)]) {
      expect([...frame.rgba.slice(0, 4)]).toEqual([255, 0, 0, 255])
      expect([...frame.rgba.slice(4, 8)]).toEqual([0, 255, 0, 255])
    }
  })

  it('reads 8-bit pixel data without byte pairing', () => {
    const frame = decodeFrame(
      synthetic({ values: [0, 128, 255], columns: 3, rows: 1, bitsAllocated: 8, windowCentre: 128, windowWidth: 255 }),
      0
    )
    expect(grey(frame, 0)).toBeLessThan(10)
    expect(grey(frame, 2)).toBeGreaterThan(245)
  })

  it('refuses a frame whose pixels run past the end of the buffer', () => {
    // Claims four frames but only carries two.
    const truncated = synthetic({ values: [1, 2, 3, 4], columns: 2, rows: 1, frames: 4 })
    expect(() => decodeFrame(truncated, 3)).toThrow(/past the end/)
  })
})
