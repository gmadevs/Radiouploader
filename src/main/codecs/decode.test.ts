import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import dicomParser from 'dicom-parser'
import { describe, expect, it } from 'vitest'
import { UnsupportedTransferSyntaxError, parseHeader, type ImageHeader } from '@shared/dicomImage'
import { decodeEncapsulatedFrame } from './decode'

const require = createRequire(import.meta.url)
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'anon', '__fixtures__')

/**
 * A header for samples that were never in a file.
 *
 * The repository has one compressed fixture and it is JPEG baseline, so the
 * other codecs are exercised by encoding a known image with the codec's own
 * encoder and decoding it back through the app's path. That proves the wiring —
 * buffer handling, geometry, the copy out of the WASM heap — which is where
 * these go wrong; it does not prove the codec against a third-party file.
 *
 * The encoders live in the codecs' full builds, which are a development
 * dependency only: electron-builder leaves them out of the packaged app, where
 * nothing but the decode-only builds is ever loaded.
 */
function header(overrides: Partial<ImageHeader>): ImageHeader {
  return {
    rows: 16,
    columns: 32,
    samplesPerPixel: 1,
    bitsAllocated: 16,
    signed: false,
    planarConfiguration: 0,
    photometric: 'MONOCHROME2',
    slope: 1,
    intercept: 0,
    windowCentre: null,
    windowWidth: null,
    frames: 1,
    bigEndian: false,
    pixelDataOffset: 0,
    transferSyntax: '1.2.840.10008.1.2.1',
    encapsulated: true,
    ...overrides
  }
}

/** A pattern with enough variety that a mangled decode cannot match it. */
function ramp(count: number): Uint16Array {
  const samples = new Uint16Array(count)
  for (let i = 0; i < count; i++) samples[i] = (i * 37) % 4096
  return samples
}

interface Encoder {
  getDecodedBuffer(info: object): Uint8Array
  getEncodedBuffer(): Uint8Array
  encode(): void
  setDecompositions?(n: number): void
}

async function encode(entry: string, name: string, width: number, height: number, samples: Uint16Array): Promise<Uint8Array> {
  const module = (await (require(entry) as () => Promise<Record<string, unknown>>)()) as Record<string, { new (): Encoder }>
  const encoder = new module[name]()
  encoder.getDecodedBuffer({ width, height, bitsPerSample: 12, componentCount: 1, isSigned: false }).set(
    new Uint8Array(samples.buffer)
  )
  encoder.setDecompositions?.(1)
  encoder.encode()
  return encoder.getEncodedBuffer().slice()
}

describe('decodeEncapsulatedFrame', () => {
  it('decodes the JPEG baseline fixture to the size its header promises', async () => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(fixtures, 'TestPattern_JPEG-Baseline_YBRFull.dcm')))
    const dataSet = dicomParser.parseDicom(bytes)
    const element = dataSet.elements.x7fe00010
    const encoded = dicomParser.readEncapsulatedPixelDataFromFragments(dataSet, element, 0, element.fragments!.length)

    const decoded = await decodeEncapsulatedFrame(encoded, parseHeader(bytes))

    expect(decoded.bytes.length).toBe(640 * 400 * 3)
    expect(decoded.samplesPerPixel).toBe(3)
    expect(decoded.bitsAllocated).toBe(8)
    // The file says YBR_FULL, but libjpeg-turbo undoes the colour transform on
    // the way out. Trusting the file here swaps red and blue and looks fine.
    expect(decoded.photometric).toBe('RGB')
  })

  it('refuses a syntax it has no codec for, by name', async () => {
    await expect(decodeEncapsulatedFrame(new Uint8Array(4), header({ transferSyntax: '1.2.840.10008.1.2.5' }))).rejects.toThrow(
      UnsupportedTransferSyntaxError
    )
    await expect(decodeEncapsulatedFrame(new Uint8Array(4), header({ transferSyntax: '1.2.840.10008.1.2.5' }))).rejects.toThrow(
      /RLE/
    )
  })

  it('reads JPEG-LS back exactly, since it is lossless', async () => {
    const samples = ramp(32 * 16)
    const encoded = await encode('@cornerstonejs/codec-charls/wasmjs', 'JpegLSEncoder', 32, 16, samples)
    const decoded = await decodeEncapsulatedFrame(encoded, header({ transferSyntax: '1.2.840.10008.1.2.4.80' }))

    expect(decoded.bitsAllocated).toBe(16)
    expect(new Uint16Array(decoded.bytes.buffer, decoded.bytes.byteOffset, samples.length)).toEqual(samples)
  })

  it('reads JPEG 2000 back exactly in its lossless mode', async () => {
    const samples = ramp(128 * 128)
    const encoded = await encode('@cornerstonejs/codec-openjpeg/wasmjs', 'J2KEncoder', 128, 128, samples)
    const decoded = await decodeEncapsulatedFrame(
      encoded,
      header({ transferSyntax: '1.2.840.10008.1.2.4.90', rows: 128, columns: 128 })
    )

    expect(new Uint16Array(decoded.bytes.buffer, decoded.bytes.byteOffset, samples.length)).toEqual(samples)
  })

  it('refuses a frame whose size contradicts the header', async () => {
    // A codec that decodes something of a different shape means the file is not
    // what its header says, and the samples would be read at the wrong stride.
    const samples = ramp(32 * 16)
    const encoded = await encode('@cornerstonejs/codec-charls/wasmjs', 'JpegLSEncoder', 32, 16, samples)
    await expect(
      decodeEncapsulatedFrame(encoded, header({ transferSyntax: '1.2.840.10008.1.2.4.80', rows: 64, columns: 64 }))
    ).rejects.toThrow(/where the header says/)
  })
})
