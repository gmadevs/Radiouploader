import { describe, expect, it } from 'vitest'
import { FITTED, MAX_ZOOM, panBy, viewRect, wheelZoomFactor, zoomAt } from './paneView'

const fit = { x: 100, y: 0, width: 400, height: 400 }

describe('viewRect', () => {
  it('is the fitted rectangle at zoom 1', () => {
    expect(viewRect(fit, FITTED)).toEqual(fit)
  })

  it('grows about the middle', () => {
    expect(viewRect(fit, { zoom: 2, x: 0, y: 0 })).toEqual({ x: -100, y: -200, width: 800, height: 800 })
  })
})

describe('zoomAt', () => {
  it('keeps the point under the pointer where it is', () => {
    const at = { x: 180, y: 90 }
    const before = viewRect(fit, FITTED)
    const u = (at.x - before.x) / before.width
    const v = (at.y - before.y) / before.height
    const after = viewRect(fit, zoomAt(fit, FITTED, at, 3))
    expect(after.x + u * after.width).toBeCloseTo(at.x)
    expect(after.y + v * after.height).toBeCloseTo(at.y)
  })

  it('stays between the whole image and the most it zooms', () => {
    expect(zoomAt(fit, FITTED, { x: 300, y: 200 }, 0.2).zoom).toBe(1)
    expect(zoomAt(fit, FITTED, { x: 300, y: 200 }, 100).zoom).toBe(MAX_ZOOM)
  })

  it('puts the image back in the middle when zoomed all the way out', () => {
    const zoomed = zoomAt(fit, FITTED, { x: 110, y: 10 }, 4)
    expect(zoomAt(fit, zoomed, { x: 450, y: 380 }, 0.1)).toEqual(FITTED)
  })

  it('zooms in and out again to the same view', () => {
    const at = { x: 250, y: 150 }
    const back = zoomAt(fit, zoomAt(fit, { zoom: 2, x: 0, y: 0 }, at, 1.5), at, 1 / 1.5)
    expect(back.zoom).toBeCloseTo(2)
    expect(back.x).toBeCloseTo(0)
    expect(back.y).toBeCloseTo(0)
  })
})

describe('panBy', () => {
  it('does nothing to an image that is not zoomed', () => {
    expect(panBy(fit, FITTED, 50, -30)).toEqual(FITTED)
  })

  it('moves a zoomed image with the drag', () => {
    const view = panBy(fit, { zoom: 2, x: 0, y: 0 }, 40, -20)
    const shown = viewRect(fit, view)
    expect(shown.x).toBeCloseTo(-100 + 40)
    expect(shown.y).toBeCloseTo(-200 - 20)
  })

  it('never uncovers the space the image fitted', () => {
    const shown = viewRect(fit, panBy(fit, { zoom: 2, x: 0, y: 0 }, 5000, 5000))
    expect(shown.x).toBeCloseTo(fit.x)
    expect(shown.y).toBeCloseTo(fit.y)
  })
})

describe('wheelZoomFactor', () => {
  it('zooms in on a scroll up and out on a scroll down', () => {
    expect(wheelZoomFactor(-10, 0)).toBeGreaterThan(1)
    expect(wheelZoomFactor(10, 0)).toBeLessThan(1)
  })

  it('undoes a pinch out with the same pinch back in', () => {
    expect(wheelZoomFactor(-7, 0) * wheelZoomFactor(7, 0)).toBeCloseTo(1)
  })

  it('follows a pinch exactly', () => {
    expect(wheelZoomFactor(-10, 0)).toBeCloseTo(Math.exp(0.1))
  })

  it('zooms a mouse notch by a step, not by the whole way', () => {
    expect(wheelZoomFactor(-120, 0)).toBeLessThan(1.3)
    expect(wheelZoomFactor(-5000, 0)).toBeCloseTo(wheelZoomFactor(-120, 0))
  })
})
