import { describe, expect, it } from 'vitest'
import { buildLine, supportMailto } from './about'

const info = { version: '1.5.0', os: 'macOS 15.7', arch: 'arm64', electron: '43.4.0', videoDecoder: 'ffmpeg 6.1.1' }

describe('buildLine', () => {
  it('names the video decoder along with the build', () => {
    expect(buildLine(info)).toBe('1.5.0 · macOS 15.7 · arm64 · Electron 43.4.0 · ffmpeg 6.1.1')
  })

  it('says outright when there is none, which is the whole story of a clip that will not open', () => {
    expect(buildLine({ ...info, videoDecoder: null })).toContain('no video decoder')
  })

  it('quotes the same line in a problem report', () => {
    expect(decodeURIComponent(supportMailto(info))).toContain('Radiouploader 1.5.0 · macOS 15.7 · arm64 · Electron 43.4.0 · ffmpeg 6.1.1')
  })
})
