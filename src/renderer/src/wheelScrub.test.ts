import { describe, expect, it } from 'vitest'
import { wheelStep } from './wheelScrub'

describe('wheelStep', () => {
  it('moves one image per mouse notch, not four', () => {
    // Chrome reports a notch as 100 px, which is four steps' worth.
    expect(wheelStep(100, 0, 0)).toEqual({ steps: 1, carry: 0 })
    expect(wheelStep(-100, 0, 0)).toEqual({ steps: -1, carry: 0 })
  })

  it('banks a trackpad nudge until it adds up to an image', () => {
    const first = wheelStep(9, 0, 0)
    expect(first.steps).toBe(0)
    const second = wheelStep(9, 0, first.carry)
    expect(second.steps).toBe(0)
    expect(wheelStep(9, 0, second.carry).steps).toBe(1)
  })

  it('reads a wheel that counts lines instead of pixels', () => {
    expect(wheelStep(3, 1, 0).steps).toBe(1)
    expect(wheelStep(1, 1, 0)).toEqual({ steps: 0, carry: 16 })
  })

  it('starts again when the scroll turns round', () => {
    const down = wheelStep(20, 0, 0)
    expect(down.carry).toBe(20)
    // The 20 px already banked downwards must not carry into the way back.
    expect(wheelStep(-10, 0, down.carry)).toEqual({ steps: 0, carry: -10 })
  })

  it('ignores an event that carries no scroll', () => {
    expect(wheelStep(0, 0, 12)).toEqual({ steps: 0, carry: 12 })
    expect(wheelStep(Number.NaN, 0, 12)).toEqual({ steps: 0, carry: 12 })
  })
})
