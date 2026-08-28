import { describe, expect, it } from 'vitest'
import { moveBy } from './reorder'

describe('moveBy', () => {
  const list = ['a', 'b', 'c', 'd']

  it('moves an item later', () => {
    expect(moveBy(list, 1, 1)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('moves an item earlier', () => {
    expect(moveBy(list, 2, -1)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('moves further than one place', () => {
    expect(moveBy(list, 0, 3)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('refuses to move past either end rather than wrapping round', () => {
    // Wrapping is what a list of tabs does. A series pushed off the front of a
    // case and reappearing at the back is a surprise, and an easy one to cause
    // by holding a button down.
    expect(moveBy(list, 0, -1)).toEqual(list)
    expect(moveBy(list, 3, 1)).toEqual(list)
    expect(moveBy(list, 1, -5)).toEqual(list)
  })

  it('does nothing for a move of nowhere, or an item that is not there', () => {
    expect(moveBy(list, 2, 0)).toEqual(list)
    expect(moveBy(list, -1, 1)).toEqual(list)
    expect(moveBy(list, 9, -1)).toEqual(list)
  })

  it('leaves the list it was given alone', () => {
    const original = [...list]
    moveBy(original, 0, 2)
    expect(original).toEqual(list)
  })
})
