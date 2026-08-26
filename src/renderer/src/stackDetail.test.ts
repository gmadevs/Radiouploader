import { describe, expect, it } from 'vitest'
import type { SliceRef } from '@shared/types'
import { extentOf, formatSize, millimetres, perImage } from './stackDetail'

const at = (...locations: (number | null)[]): SliceRef[] =>
  locations.map((sliceLocation, i) => ({
    path: '/tmp/a.dcm',
    frame: i,
    instanceNumber: i + 1,
    sliceLocation,
    sopInstanceUid: null
  }))

describe('extentOf', () => {
  it('measures from the first image to the last', () => {
    expect(extentOf(at(0, 3, 6, 9))).toEqual({ span: 9, spacing: 3 })
  })

  it('reports the middle gap, not the average one', () => {
    // One slice missing leaves a gap of twice the rest. An average would say
    // the images are 4 mm apart when no pair of them is.
    expect(extentOf(at(0, 3, 9, 12))?.spacing).toBe(3)
  })

  it('does not care what order the images arrived in', () => {
    expect(extentOf(at(9, 0, 6, 3))).toEqual({ span: 9, spacing: 3 })
  })

  it('says nothing about a cine, whose frames are all in one place', () => {
    expect(extentOf(at(0, 0, 0, 0))).toBeNull()
  })

  it('says nothing when the images do not carry a position', () => {
    expect(extentOf(at(null, null, null))).toBeNull()
    expect(extentOf(at(4))).toBeNull()
  })

  it('measures what it can when only some images say where they are', () => {
    expect(extentOf(at(0, null, 6))).toEqual({ span: 6, spacing: 6 })
  })
})

describe('millimetres', () => {
  it('keeps a decimal where one changes the reading', () => {
    expect(millimetres(4.06)).toBe('4.1')
    expect(millimetres(0.62)).toBe('0.6')
  })

  it('drops it once the number is long enough not to need it', () => {
    expect(millimetres(322.44)).toBe('322')
  })
})

describe('formatSize', () => {
  it('uses the unit that makes the number readable', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(299 * 1024)).toBe('299 KB')
    expect(formatSize(18 * 1024 * 1024)).toBe('18 MB')
  })

  it('gives a gigabyte a decimal, which is the digit that changes a decision', () => {
    expect(formatSize(1.24 * 1024 * 1024 * 1024)).toBe('1.2 GB')
  })

  it('says nothing rather than NaN when there is nothing to say', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(Number.NaN)).toBe('0 B')
  })
})

describe('perImage', () => {
  it('divides the stack by what is in it', () => {
    expect(perImage(60 * 299 * 1024, 60)).toBe('299 KB')
  })

  it('does not divide by nothing', () => {
    expect(perImage(1024, 0)).toBe('0 B')
  })
})
