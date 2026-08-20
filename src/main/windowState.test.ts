import { describe, expect, it, vi } from 'vitest'

// windowState reaches for app and screen only when it touches the disk; the
// geometry it is tested for is pure.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, screen: {} }))

const { MINIMUM, fitBounds } = await import('./windowState')

/** A 1680x1050 laptop with the menu bar and the Dock taken off. */
const laptop = { x: 0, y: 25, width: 1680, height: 966 }

describe('fitBounds', () => {
  it('centres the default when nothing was saved', () => {
    const bounds = fitBounds(undefined, laptop)
    expect(bounds).toEqual({ x: 200, y: 78, width: 1280, height: 860 })
  })

  it('keeps the size and position the user left', () => {
    const saved = { x: 120, y: 90, width: 1100, height: 700 }
    expect(fitBounds(saved, laptop)).toEqual(saved)
  })

  it('shrinks a window that came from a bigger screen', () => {
    // 1366x768 is the laptop the saved 1280x860 does not fit on.
    const small = { x: 0, y: 0, width: 1366, height: 768 }
    const bounds = fitBounds({ x: 0, y: 0, width: 1280, height: 860 }, small)
    expect(bounds.width).toBe(1280)
    expect(bounds.height).toBe(768 - 60)
  })

  it('holds the width the wizard needs, but never overflows a tiny screen', () => {
    const tiny = { x: 0, y: 0, width: 1024, height: 600 }
    const bounds = fitBounds(undefined, tiny)
    // The margin would leave 944, which is narrower than the wizard works at.
    expect(bounds.width).toBe(MINIMUM.width)
    // Height gives way instead: a window taller than the screen is worse than
    // one shorter than the nominal minimum.
    expect(bounds.height).toBe(tiny.height)
  })

  it('does not enlarge a small window just because the screen is large', () => {
    const wide = { x: 0, y: 0, width: 3840, height: 2160 }
    expect(fitBounds({ x: 100, y: 100, width: 1000, height: 700 }, wide)).toMatchObject({
      width: 1000,
      height: 700
    })
  })

  it('recentres a window saved on a monitor that is no longer there', () => {
    // The second display was to the right; without it the window would open
    // entirely off-screen, where it cannot be dragged back.
    const bounds = fitBounds({ x: 2400, y: 200, width: 1280, height: 860 }, laptop)
    expect(bounds.x).toBe(200)
    expect(bounds.y).toBe(78)
  })

  it('pulls a window back when its title bar is above the work area', () => {
    // A saved y under the menu bar would put the title bar out of reach.
    expect(fitBounds({ x: 100, y: -300, width: 1200, height: 800 }, laptop).y).toBe(108)
  })

  it('keeps a window that hangs off the right edge reachable', () => {
    const bounds = fitBounds({ x: 1600, y: 100, width: 1200, height: 800 }, laptop)
    expect(bounds.x).toBe(laptop.width - 1200)
    expect(bounds.y).toBe(100)
  })
})
