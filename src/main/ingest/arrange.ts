import type { CropRect, MaskRect, Stack, WindowLevel } from '@shared/types'

/**
 * A dynamic series the other way round: one stack per slice position, each
 * holding that slice at every time point in order.
 *
 * Split by phase, a pituitary dynamic is eighteen stacks of five slices, and
 * the enhancement is seen by stepping from card to card. By slice it is five
 * stacks of eighteen, and scrolling one of them plays the gland filling in —
 * which is how such a case is usually read. A 4D angiogram exported as one MIP
 * per phase is the extreme of it: one image per phase, so by phase it is a
 * stack per image and by slice it is the single run in time a case wants.
 *
 * Only a series whose phases hold the same slices at the same positions can be
 * turned: slice k of every phase has to be the same place, or the stack made of
 * them would be a run through space and time at once. Returns null when it is
 * not so.
 */
export function bySlice(seriesId: string, phaseStacks: Stack[]): Stack[] | null {
  if (phaseStacks.length < 2) return null
  const phases = [...phaseStacks].sort((a, b) => (a.phaseIndex ?? 0) - (b.phaseIndex ?? 0))
  const count = phases[0].slices.length
  if (count === 0 || phases.some((phase) => phase.slices.length !== count)) return null

  if (count > 1) {
    for (let k = 0; k < count; k++) {
      const where = phases.map((phase) => phase.slices[k].sliceLocation)
      // Without a position there is no telling that slice k is one place, and
      // 0.01 mm is the rounding the phase split itself groups on.
      if (where.some((location) => location === null)) return null
      if (new Set(where.map((location) => (location as number).toFixed(2))).size !== 1) return null
    }
  }

  const first = phases[0]
  const bytes = Math.round(phases.reduce((sum, phase) => sum + phase.bytes, 0) / count)
  return Array.from({ length: count }, (_, k) => {
    const slices = phases.map((phase) => phase.slices[k])
    return {
      ...first,
      id: `${seriesId}::slice-${k}`,
      label: count === 1 ? 'All phases' : `Slice ${k + 1}`,
      phaseIndex: null,
      slices,
      selected: phases.every((phase) => phase.unsupported === null),
      trimStart: 0,
      trimEnd: slices.length - 1,
      dropped: [],
      masks: [],
      crop: null,
      window: null,
      bytes,
      unsupported: phases.find((phase) => phase.unsupported !== null)?.unsupported ?? null
    }
  })
}

/**
 * What survives a change of arrangement: every blanked area, and a crop or a
 * window only where the whole series had the same one.
 *
 * A mask drawn on any stack of a series goes onto every stack of the new one.
 * The stacks of a dynamic series are the same field of view, a banner sits in
 * the same place on all of them, and a redaction dropped by rearranging is
 * burnt-in text uploaded without anyone having decided so. A crop or a window
 * set on one phase is a choice about that phase, so it is carried only when it
 * was everyone's.
 */
export function carriedEdits(stacks: Stack[]): { masks: MaskRect[]; crop: CropRect | null; window: WindowLevel | null } {
  const masks = new Map<string, MaskRect>()
  for (const stack of stacks) for (const mask of stack.masks) masks.set(JSON.stringify(mask), mask)
  const shared = <T>(pick: (stack: Stack) => T | null): T | null => {
    const values = new Set(stacks.map((stack) => JSON.stringify(pick(stack))))
    return values.size === 1 ? pick(stacks[0]) : null
  }
  return { masks: [...masks.values()], crop: shared((s) => s.crop), window: shared((s) => s.window) }
}
