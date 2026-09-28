import { blend, keyField, type KeyField } from './interpolate'

/**
 * A structure is one coloured overlay: the spinal canal, a sulcus, a mass.
 *
 * The images it was drawn on are its keys. The images between two keys are
 * filled by interpolation and are rebuilt whenever a key changes, so they are
 * never stored or sent anywhere: the renderer and the main process each work
 * them out from the same keys with the same code, which is what makes the
 * written series the one that was on screen.
 *
 * Keys are indexed by the image's place in the stack as it arrived — the same
 * index a trim and a drop use — so trimming the stack after drawing on it moves
 * nothing.
 */
export interface Structure {
  id: string
  name: string
  color: string
  opacity: number
  outline: boolean
  visible: boolean
  interpolate: boolean
  keys: Map<number, Uint8Array>
  filled: Map<number, Uint8Array>
  fields: Map<number, KeyField>
}

/** What crosses the bridge and what is kept between two openings of the dialog. */
export interface StructureMessage {
  name: string
  color: string
  opacity: number
  outline: boolean
  visible: boolean
  interpolate: boolean
  keys: { index: number; mask: Uint8Array }[]
}

/** The ten colours offered for a structure, in hue order. */
export const PALETTE: { name: string; hex: string }[] = [
  { name: 'Red', hex: '#ff3b30' },
  { name: 'Orange', hex: '#ff9500' },
  { name: 'Yellow', hex: '#ffcc00' },
  { name: 'Green', hex: '#34c759' },
  { name: 'Teal', hex: '#00c7be' },
  { name: 'Cyan', hex: '#32ade6' },
  { name: 'Blue', hex: '#007aff' },
  { name: 'Purple', hex: '#af52de' },
  { name: 'Magenta', hex: '#ff2d92' },
  { name: 'Brown', hex: '#a2845e' }
]

/** New structures take the palette in this order, so two in a row differ clearly. */
const NEW_ORDER = [0, 2, 3, 5, 7, 1, 6, 8, 4, 9]

export function paletteColor(n: number): string {
  return PALETTE[NEW_ORDER[n % NEW_ORDER.length]].hex
}

let nextId = 1

export function createStructure(name: string, color: string): Structure {
  return {
    id: `structure-${nextId++}`,
    name,
    color,
    opacity: 0.4,
    outline: true,
    visible: true,
    interpolate: true,
    keys: new Map(),
    filled: new Map(),
    fields: new Map()
  }
}

/** The mask shown on an image: its key if it has one, else the interpolated one. */
export function maskAt(structure: Structure, index: number): Uint8Array | undefined {
  return structure.keys.get(index) ?? (structure.interpolate ? structure.filled.get(index) : undefined)
}

export function reinterpolate(structure: Structure, width: number, height: number): void {
  structure.filled.clear()
  const keys = [...structure.keys.keys()].sort((a, b) => a - b)
  for (let k = 0; k + 1 < keys.length; k++) {
    const a = keys[k]
    const b = keys[k + 1]
    if (b - a < 2) continue
    const fa = fieldFor(structure, a, width, height)
    const fb = fieldFor(structure, b, width, height)
    for (let i = a + 1; i < b; i++) structure.filled.set(i, blend(fa, fb, (i - a) / (b - a), width, height))
  }
}

/** Distance fields are the slow part, so each key's is kept until the key changes. */
function fieldFor(structure: Structure, index: number, width: number, height: number): KeyField {
  let field = structure.fields.get(index)
  if (!field) {
    field = keyField(structure.keys.get(index)!, width, height)
    structure.fields.set(index, field)
  }
  return field
}

export function setKey(structure: Structure, index: number, mask: Uint8Array | undefined): void {
  if (mask) structure.keys.set(index, mask.slice())
  else structure.keys.delete(index)
  structure.fields.delete(index)
}

/** One change to one key. Interpolated images follow from keys and are never recorded. */
export interface Edit {
  structure: Structure
  index: number
  before: Uint8Array | undefined
  after: Uint8Array | undefined
}

export const HISTORY_LENGTH = 200

export class History {
  private undoStack: Edit[] = []
  private redoStack: Edit[] = []

  push(edit: Edit): void {
    this.undoStack.push(edit)
    if (this.undoStack.length > HISTORY_LENGTH) this.undoStack.shift()
    this.redoStack = []
  }

  undo(): Edit | undefined {
    const edit = this.undoStack.pop()
    if (edit) {
      setKey(edit.structure, edit.index, edit.before)
      this.redoStack.push(edit)
    }
    return edit
  }

  redo(): Edit | undefined {
    const edit = this.redoStack.pop()
    if (edit) {
      setKey(edit.structure, edit.index, edit.after)
      this.undoStack.push(edit)
    }
    return edit
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** Forget the edits to a structure that has been deleted. */
  forget(structure: Structure): void {
    this.undoStack = this.undoStack.filter((edit) => edit.structure !== structure)
    this.redoStack = this.redoStack.filter((edit) => edit.structure !== structure)
  }
}

export function toMessage(structure: Structure): StructureMessage {
  return {
    name: structure.name,
    color: structure.color,
    opacity: structure.opacity,
    outline: structure.outline,
    visible: structure.visible,
    interpolate: structure.interpolate,
    keys: [...structure.keys].sort((a, b) => a[0] - b[0]).map(([index, mask]) => ({ index, mask }))
  }
}

/**
 * Rebuild a structure, interpolation and all.
 *
 * A mask of the wrong length is refused: it was drawn on images of another
 * size, and laid over these it would put the colour somewhere else.
 */
export function fromMessage(message: StructureMessage, width: number, height: number): Structure {
  const structure = createStructure(message.name, message.color)
  structure.opacity = message.opacity
  structure.outline = message.outline
  structure.visible = message.visible
  structure.interpolate = message.interpolate
  for (const { index, mask } of message.keys) {
    if (mask.length !== width * height) {
      throw new Error(`The drawing of ${message.name} does not match the size of these images`)
    }
    structure.keys.set(index, Uint8Array.from(mask))
  }
  reinterpolate(structure, width, height)
  return structure
}

/** Whether anything at all has been drawn. */
export function hasDrawing(structures: Structure[]): boolean {
  return structures.some((structure) => structure.visible && [...structure.keys.values()].some((mask) => mask.some((v) => v)))
}
