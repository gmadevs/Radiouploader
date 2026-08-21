/**
 * A synthetic study, so the documentation can show the app working on images
 * that may live in a public repository.
 *
 * Real DICOM cannot: this app exists because studies carry patient data, and a
 * screenshot of one belongs in a case on Radiopaedia, not in a git history. So
 * the sample is drawn from scratch — a CT phantom, a diffusion pair and an
 * ultrasound with a banner burnt into its pixels, which is the one thing the
 * documentation most needs to show and the one thing that cannot be faked with
 * an empty square.
 *
 * Explicit VR little endian throughout, written by hand: the anonymiser this
 * project depends on parses DICOM but does not emit it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------- DICOM out

const IMPLICIT_PAD = 0x20

/** Value representations that carry a 4-byte length after two reserved bytes. */
const LONG_VRS = new Set(['OB', 'OW', 'OF', 'SQ', 'UT', 'UN'])

function element(group, el, vr, value) {
  const body = encodeValue(vr, value)
  const head = Buffer.alloc(LONG_VRS.has(vr) ? 12 : 8)
  head.writeUInt16LE(group, 0)
  head.writeUInt16LE(el, 2)
  head.write(vr, 4, 'ascii')
  if (LONG_VRS.has(vr)) {
    head.writeUInt16LE(0, 6)
    head.writeUInt32LE(body.length, 8)
  } else {
    head.writeUInt16LE(body.length, 6)
  }
  return Buffer.concat([head, body])
}

function encodeValue(vr, value) {
  if (Buffer.isBuffer(value)) return pad(value, 0)
  if (vr === 'US') {
    const b = Buffer.alloc(2)
    b.writeUInt16LE(value, 0)
    return b
  }
  if (vr === 'FD') {
    const b = Buffer.alloc(8)
    b.writeDoubleLE(value, 0)
    return b
  }
  // Everything else in this file is a string VR. UI pads with NUL, the rest
  // with a space; both must come out even-length.
  return pad(Buffer.from(String(value), 'latin1'), vr === 'UI' ? 0 : IMPLICIT_PAD)
}

function pad(buffer, byte) {
  return buffer.length % 2 === 0 ? buffer : Buffer.concat([buffer, Buffer.from([byte])])
}

/**
 * File meta group, then the dataset.
 *
 * Group 0002 carries its own length in (0002,0000), which is why it is built
 * before it is measured.
 */
function dicomFile({ sopClassUid, sopInstanceUid, dataset }) {
  const meta = Buffer.concat([
    element(0x0002, 0x0001, 'OB', Buffer.from([0x00, 0x01])),
    element(0x0002, 0x0002, 'UI', sopClassUid),
    element(0x0002, 0x0003, 'UI', sopInstanceUid),
    element(0x0002, 0x0010, 'UI', '1.2.840.10008.1.2.1'),
    element(0x0002, 0x0012, 'UI', '1.2.826.0.1.3680043.10.341.999')
  ])

  return Buffer.concat([
    Buffer.alloc(128),
    Buffer.from('DICM', 'ascii'),
    element(0x0002, 0x0000, 'UL', lengthOf(meta)),
    meta,
    dataset
  ])
}

function lengthOf(buffer) {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(buffer.length, 0)
  return b
}

// ------------------------------------------------------------------- pixels

/** Deterministic noise, so regenerating the sample does not churn the files. */
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SIZE = 256

function ellipse(x, y, cx, cy, rx, ry) {
  const dx = (x - cx) / rx
  const dy = (y - cy) / ry
  return dx * dx + dy * dy <= 1
}

/**
 * One CT slice through a chest phantom, in stored values (HU + 1024).
 *
 * `lesion` is the radius of a nodule in the left lung, which is what grows
 * between the two studies so the follow-up has something to follow.
 */
function ctSlice(index, slices, lesion) {
  const values = new Uint16Array(SIZE * SIZE)
  const t = index / (slices - 1)
  // The body narrows towards the apex, so scrubbing looks like a volume.
  const bodyRx = 96 - 18 * Math.abs(t - 0.5) * 2
  const noise = mulberry32(1000 + index)

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let hu = -1000
      if (ellipse(x, y, 128, 132, bodyRx, 74)) {
        hu = 40 + noise() * 20
        if (ellipse(x, y, 96, 128, 34, 52) || ellipse(x, y, 160, 128, 34, 52)) hu = -820 + noise() * 60
        if (ellipse(x, y, 128, 186, 16, 14)) hu = 700
        if (lesion > 0 && ellipse(x, y, 92, 120 + 24 * (t - 0.5), lesion, lesion)) hu = 60
      }
      values[y * SIZE + x] = Math.max(0, Math.round(hu + 1024))
    }
  }
  return values
}

/** A diffusion slice: b=0 is bright everywhere, b=1000 keeps only the focus. */
function dwiSlice(index, bValue) {
  const values = new Uint16Array(SIZE * SIZE)
  const noise = mulberry32(2000 + index * 10 + bValue)
  const attenuated = bValue > 0

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let v = 0
      if (ellipse(x, y, 128, 128, 86, 100)) {
        v = attenuated ? 220 + noise() * 90 : 900 + noise() * 200
        if (ellipse(x, y, 128, 128, 62, 76)) v = attenuated ? 150 + noise() * 60 : 1400 + noise() * 200
        // The restricted focus: bright on both, but only it survives at b=1000.
        if (ellipse(x, y, 104, 108 + index * 2, 12, 12)) v = attenuated ? 1500 : 1700
      }
      values[y * SIZE + x] = Math.round(v)
    }
  }
  return values
}

// A 5x7 font, because the burnt-in banner has to be readable for the page that
// explains how to erase it.
const GLYPHS = {
  A: '.###./#...#/#...#/#####/#...#/#...#/#...#',
  B: '####./#...#/####./#...#/#...#/#...#/####.',
  C: '.###./#...#/#..../#..../#..../#...#/.###.',
  D: '####./#...#/#...#/#...#/#...#/#...#/####.',
  E: '#####/#..../####./#..../#..../#..../#####',
  F: '#####/#..../####./#..../#..../#..../#....',
  G: '.###./#...#/#..../#.###/#...#/#...#/.####',
  H: '#...#/#...#/#####/#...#/#...#/#...#/#...#',
  I: '#####/..#../..#../..#../..#../..#../#####',
  J: '..###/...#./...#./...#./...#./#..#./.##..',
  K: '#...#/#..#./#.#../##.../#.#../#..#./#...#',
  L: '#..../#..../#..../#..../#..../#..../#####',
  M: '#...#/##.##/#.#.#/#...#/#...#/#...#/#...#',
  N: '#...#/##..#/#.#.#/#..##/#...#/#...#/#...#',
  O: '.###./#...#/#...#/#...#/#...#/#...#/.###.',
  P: '####./#...#/#...#/####./#..../#..../#....',
  Q: '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#',
  R: '####./#...#/#...#/####./#.#../#..#./#...#',
  S: '.####/#..../#..../.###./....#/....#/####.',
  T: '#####/..#../..#../..#../..#../..#../..#..',
  U: '#...#/#...#/#...#/#...#/#...#/#...#/.###.',
  V: '#...#/#...#/#...#/#...#/#...#/.#.#./..#..',
  W: '#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#',
  X: '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
  Y: '#...#/#...#/.#.#./..#../..#../..#../..#..',
  Z: '#####/....#/...#./..#../.#.../#..../#####',
  0: '.###./#...#/#..##/#.#.#/##..#/#...#/.###.',
  1: '..#../.##../..#../..#../..#../..#../.###.',
  2: '.###./#...#/....#/...#./..#../.#.../#####',
  3: '#####/...#./..#../...#./....#/#...#/.###.',
  4: '...#./..##./.#.#./#..#./#####/...#./...#.',
  5: '#####/#..../####./....#/....#/#...#/.###.',
  6: '..##./.#.../#..../####./#...#/#...#/.###.',
  7: '#####/....#/...#./..#../.#.../.#.../.#...',
  8: '.###./#...#/#...#/.###./#...#/#...#/.###.',
  9: '.###./#...#/#...#/.####/....#/...#./.##..',
  ' ': '...../...../...../...../...../...../.....',
  '.': '...../...../...../...../...../.##../.##..',
  ':': '...../.##../.##../...../.##../.##../.....',
  '-': '...../...../...../.###./...../...../.....',
  '^': '..#../.#.#./#...#/...../...../...../.....',
  '/': '....#/...#./..#../.#.../#..../...../.....'
}

/** Draw text into an 8-bit buffer, one glyph pixel to `scale` image pixels. */
function drawText(pixels, text, left, top, scale, value) {
  let x = left
  for (const char of text.toUpperCase()) {
    const glyph = GLYPHS[char] ?? GLYPHS[' ']
    const rows = glyph.split('/')
    for (let gy = 0; gy < rows.length; gy++) {
      for (let gx = 0; gx < rows[gy].length; gx++) {
        if (rows[gy][gx] !== '#') continue
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = x + gx * scale + dx
            const py = top + gy * scale + dy
            if (px >= 0 && px < SIZE && py >= 0 && py < SIZE) pixels[py * SIZE + px] = value
          }
        }
      }
    }
    x += (5 + 1) * scale
  }
}

/**
 * An ultrasound sector with a patient banner burnt into the corner.
 *
 * The banner is the point of the image: it is what the eraser removes and what
 * the check before anonymisation asks about. The text is deliberately absurd
 * so nobody can mistake the sample for a real patient.
 */
function ultrasound() {
  const pixels = new Uint8Array(SIZE * SIZE)
  const noise = mulberry32(7)

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - 128
      const dy = y - 26
      const r = Math.hypot(dx, dy)
      const inSector = r > 26 && r < 210 && Math.abs(Math.atan2(dx, dy)) < 0.62
      if (!inSector) continue
      // Speckle, with a couple of darker structures to look at.
      let v = 60 + noise() * 90 - r * 0.12
      if (ellipse(x, y, 108, 150, 26, 20)) v = 18 + noise() * 22
      if (ellipse(x, y, 162, 190, 16, 13)) v = 150 + noise() * 60
      pixels[y * SIZE + x] = Math.max(0, Math.min(255, Math.round(v)))
    }
  }

  drawText(pixels, 'DEMO^PATIENT', 6, 6, 2, 255)
  drawText(pixels, 'ID 000000  01 JAN 2020', 6, 24, 1, 235)
  drawText(pixels, 'GENERAL HOSPITAL', 6, 34, 1, 235)
  return pixels
}

// ------------------------------------------------------------------- series

const CT_SOP = '1.2.840.10008.5.1.4.1.1.2'
const MR_SOP = '1.2.840.10008.5.1.4.1.1.4'
const US_SOP = '1.2.840.10008.5.1.4.1.1.6.1'

const ROOT = '1.2.826.0.1.3680043.10.341.999'

function bytesOf(values) {
  if (values instanceof Uint8Array) return Buffer.from(values)
  const b = Buffer.alloc(values.length * 2)
  for (let i = 0; i < values.length; i++) b.writeUInt16LE(values[i], i * 2)
  return b
}

/**
 * One instance. Elements have to be written in ascending tag order, which is
 * why this is one long list rather than something composed per modality.
 */
function instance(o) {
  const eightBit = o.pixels instanceof Uint8Array
  const parts = [
    element(0x0008, 0x0008, 'CS', o.imageType ?? 'ORIGINAL\\PRIMARY\\AXIAL'),
    element(0x0008, 0x0016, 'UI', o.sopClassUid),
    element(0x0008, 0x0018, 'UI', o.sopInstanceUid),
    element(0x0008, 0x0020, 'DA', o.studyDate),
    element(0x0008, 0x0030, 'TM', '101500'),
    element(0x0008, 0x0060, 'CS', o.modality),
    element(0x0008, 0x0070, 'LO', 'RADIOUPLOADER SAMPLE'),
    element(0x0008, 0x1030, 'LO', o.studyDescription),
    element(0x0008, 0x103e, 'LO', o.seriesDescription),
    element(0x0010, 0x0010, 'PN', 'DEMO^PATIENT'),
    element(0x0010, 0x0020, 'LO', '000000'),
    element(0x0010, 0x0030, 'DA', '19700101'),
    element(0x0010, 0x0040, 'CS', 'O')
  ]

  if (o.bValue !== undefined) parts.push(element(0x0018, 0x9087, 'FD', o.bValue))

  parts.push(
    element(0x0020, 0x000d, 'UI', o.studyUid),
    element(0x0020, 0x000e, 'UI', o.seriesUid),
    element(0x0020, 0x0011, 'IS', String(o.seriesNumber)),
    element(0x0020, 0x0013, 'IS', String(o.instanceNumber)),
    element(0x0020, 0x0032, 'DS', `-128\\-128\\${o.position}`),
    element(0x0020, 0x0037, 'DS', '1\\0\\0\\0\\1\\0'),
    element(0x0028, 0x0002, 'US', 1),
    element(0x0028, 0x0004, 'CS', 'MONOCHROME2'),
    element(0x0028, 0x0010, 'US', SIZE),
    element(0x0028, 0x0011, 'US', SIZE),
    element(0x0028, 0x0030, 'DS', '1.0\\1.0'),
    element(0x0028, 0x0100, 'US', eightBit ? 8 : 16),
    element(0x0028, 0x0101, 'US', eightBit ? 8 : 16),
    element(0x0028, 0x0102, 'US', eightBit ? 7 : 15),
    element(0x0028, 0x0103, 'US', 0)
  )

  // Burnt-in text is declared where it exists. Most exporters do not bother,
  // which is exactly why the app cannot trust the tag's silence.
  if (o.burnedIn) parts.push(element(0x0028, 0x0301, 'CS', 'YES'))

  parts.push(
    element(0x0028, 0x1050, 'DS', o.windowCentre),
    element(0x0028, 0x1051, 'DS', o.windowWidth)
  )
  if (o.intercept !== undefined) {
    parts.push(
      element(0x0028, 0x1052, 'DS', o.intercept),
      element(0x0028, 0x1053, 'DS', '1')
    )
  }
  parts.push(element(0x7fe0, 0x0010, 'OW', bytesOf(o.pixels)))

  return dicomFile({
    sopClassUid: o.sopClassUid,
    sopInstanceUid: o.sopInstanceUid,
    dataset: Buffer.concat(parts)
  })
}

function write(dir, name, buffer) {
  fs.writeFileSync(path.join(dir, name), buffer)
}

/** One study: a CT volume, a diffusion pair, and — on the baseline — the ultrasound. */
function buildStudy(dir, { index, studyDate, description, lesion, withUltrasound }) {
  const studyUid = `${ROOT}.${index}.1`
  let files = 0

  const ctSeries = `${ROOT}.${index}.2`
  for (let i = 0; i < 12; i++) {
    write(dir, `ct_${index}_${String(i).padStart(2, '0')}.dcm`, instance({
      sopClassUid: CT_SOP,
      sopInstanceUid: `${ctSeries}.${i}`,
      studyUid,
      seriesUid: ctSeries,
      studyDate,
      studyDescription: description,
      seriesDescription: 'Chest 1.0 mm',
      modality: 'CT',
      seriesNumber: 2,
      instanceNumber: i + 1,
      position: (i * 5).toFixed(1),
      pixels: ctSlice(i, 12, lesion),
      windowCentre: '40',
      windowWidth: '400',
      intercept: '-1024'
    }))
    files++
  }

  for (const [n, bValue] of [[0, 0], [1, 1000]]) {
    const seriesUid = `${ROOT}.${index}.3`
    for (let i = 0; i < 6; i++) {
      write(dir, `dwi_${index}_${bValue}_${i}.dcm`, instance({
        sopClassUid: MR_SOP,
        sopInstanceUid: `${seriesUid}.${n}.${i}`,
        studyUid,
        seriesUid,
        studyDate,
        studyDescription: description,
        seriesDescription: 'DWI b0 b1000',
        modality: 'MR',
        imageType: 'ORIGINAL\\PRIMARY\\M\\ND',
        seriesNumber: 3,
        instanceNumber: n * 6 + i + 1,
        position: (i * 6).toFixed(1),
        bValue,
        pixels: dwiSlice(i, bValue),
        windowCentre: '900',
        windowWidth: '1800'
      }))
      files++
    }
  }

  if (withUltrasound) {
    const seriesUid = `${ROOT}.${index}.4`
    write(dir, `us_${index}.dcm`, instance({
      sopClassUid: US_SOP,
      sopInstanceUid: `${seriesUid}.1`,
      studyUid,
      seriesUid,
      studyDate,
      studyDescription: description,
      seriesDescription: 'Upper abdomen',
      modality: 'US',
      imageType: 'ORIGINAL\\PRIMARY',
      seriesNumber: 4,
      instanceNumber: 1,
      position: '0.0',
      pixels: ultrasound(),
      windowCentre: '128',
      windowWidth: '256',
      burnedIn: true
    }))
    files++
  }

  return files
}

export function makeSampleStudy(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })

  const files =
    buildStudy(dir, {
      index: 1,
      studyDate: '20200101',
      description: 'CHEST AND ABDOMEN',
      lesion: 6,
      withUltrasound: true
    }) +
    buildStudy(dir, {
      index: 2,
      studyDate: '20200714',
      description: 'CHEST FOLLOW-UP',
      lesion: 11,
      withUltrasound: false
    })

  return files
}

// Compared through fileURLToPath rather than as strings: this project's own
// directory has a space in it, which import.meta.url percent-encodes.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? path.join(process.cwd(), '.sample-study')
  console.log(`${makeSampleStudy(dir)} files written to ${dir}`)
}
