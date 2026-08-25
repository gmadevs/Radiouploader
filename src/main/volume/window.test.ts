import { describe, expect, it } from 'vitest'
import { defaultWindow } from './window'
import type { Volume } from './reformat'

/** A volume whose values run 0 to 1000, the shape an MR series has. */
function brain(): Volume {
  const samples = new Float32Array(4096)
  for (let i = 0; i < samples.length; i++) samples[i] = i < 1000 ? 0 : Math.round(((i - 1000) / 3096) * 1000)
  return { samples, columns: 16, rows: 16, depth: 16, spacing: { x: 1, y: 1, z: 1 }, low: 0 }
}

const plain = { slope: 1, intercept: 0 }

describe('defaultWindow', () => {
  it('keeps a window the user chose in the viewer', () => {
    const chosen = { centre: 42, width: 7 }
    expect(defaultWindow(brain(), { ...plain, windowCentre: 300, windowWidth: 600 }, chosen)).toBe(chosen)
  })

  it('uses the file’s own window when it shows the data', () => {
    const window = defaultWindow(brain(), { ...plain, windowCentre: 400, windowWidth: 900 }, null)
    expect(window).toEqual({ centre: 400, width: 900 })
  })

  it('ignores a window the data sits outside of', () => {
    // The failure this exists for: every voxel above the top of the window, so
    // the reformat came out as a white cut-out on black.
    const window = defaultWindow(brain(), { ...plain, windowCentre: 20, windowWidth: 40 }, null)
    expect(window.width).toBeGreaterThan(100)
    expect(window.centre).toBeGreaterThan(40)
  })

  it('falls back to the spread of the volume when the file says nothing', () => {
    const window = defaultWindow(brain(), { ...plain, windowCentre: null, windowWidth: null }, null)
    expect(window.centre).toBeGreaterThan(0)
    expect(window.width).toBeGreaterThan(0)
  })

  it('reads the window in the same units as the pixels', () => {
    // A CT stores Hounsfield units through a rescale; a window is in those units
    // and has to be compared against rescaled values, not stored ones.
    const air = new Float32Array(4096).fill(0)
    const volume: Volume = { samples: air, columns: 16, rows: 16, depth: 16, spacing: { x: 1, y: 1, z: 1 }, low: 0 }
    const window = defaultWindow(volume, { slope: 1, intercept: -1024, windowCentre: -600, windowWidth: 1500 }, null)
    expect(window).toEqual({ centre: -600, width: 1500 })
  })

  it('does not divide by nothing on a volume of one value', () => {
    const flat = new Float32Array(64).fill(7)
    const volume: Volume = { samples: flat, columns: 4, rows: 4, depth: 4, spacing: { x: 1, y: 1, z: 1 }, low: 7 }
    expect(defaultWindow(volume, { ...plain, windowCentre: null, windowWidth: null }, null).width).toBeGreaterThan(0)
  })
})
