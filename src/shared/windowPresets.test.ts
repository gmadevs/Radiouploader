import { describe, expect, it } from 'vitest'
import { CT_WINDOW_PRESETS, matchingPreset, usesHounsfield } from './windowPresets'

describe('usesHounsfield', () => {
  it('is a CT and nothing else', () => {
    expect(usesHounsfield('CT')).toBe(true)
    expect(usesHounsfield('MR')).toBe(false)
    expect(usesHounsfield('US')).toBe(false)
    expect(usesHounsfield(null)).toBe(false)
  })
})

describe('matchingPreset', () => {
  it('names the preset a window came from', () => {
    expect(matchingPreset({ centre: -600, width: 1500 })?.name).toBe('Lung')
  })

  it('forgets it once the window has been dragged off it', () => {
    expect(matchingPreset({ centre: -560, width: 1500 })).toBeNull()
  })

  it('has nothing to name when the stack carries no window', () => {
    expect(matchingPreset(null)).toBeNull()
  })

  // Two presets that match the same window would light two buttons at once.
  it('has no two presets alike', () => {
    const seen = CT_WINDOW_PRESETS.map((preset) => matchingPreset(preset.window)?.name)
    expect(seen).toEqual(CT_WINDOW_PRESETS.map((preset) => preset.name))
  })
})
