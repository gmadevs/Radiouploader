/**
 * Text in the files this app writes, and why it leaves as ASCII.
 *
 * dcmio reads a string a byte at a time, each byte one character, and writes
 * a string back as UTF-8. Any byte above 0x7F therefore comes out as two: an
 * "é" stored as Latin-1 was uploaded as "Ã©", and one stored as UTF-8 as
 * "Ã\u0083Â©". Radiopaedia runs the same anonymiser over what it receives, so
 * whatever is uploaded is mangled once more there, and a file that is not
 * pure ASCII is never the fixed point the rest of this app is built to write.
 *
 * So text is taken out of the file's own character set into Unicode as soon as
 * the file is read, and the anonymiser's output is written in ASCII, spelled as
 * near the original as ASCII goes: "Encéfalo" becomes "Encefalo", which a reader
 * can read, where the alternative was "EncÃ©falo" on this side and worse on
 * Radiopaedia's. Scripts that ASCII cannot spell at all — Japanese, Greek —
 * become question marks, which is no worse than what arrived before.
 */

type Dict = Record<string, { vr: string; Value: unknown[] }>

/** The value representations whose text follows (0008,0005); every other is ASCII by definition. */
const TEXT_VRS = new Set(['SH', 'LO', 'ST', 'LT', 'UT', 'PN', 'UC'])

/**
 * DICOM's names for character sets, as the names TextDecoder knows them by.
 * Node carries the full ICU tables, which have all of these.
 */
const DECODERS: Record<string, string> = {
  'ISO_IR 100': 'latin1',
  'ISO_IR 101': 'iso-8859-2',
  'ISO_IR 109': 'iso-8859-3',
  'ISO_IR 110': 'iso-8859-4',
  'ISO_IR 144': 'iso-8859-5',
  'ISO_IR 127': 'iso-8859-6',
  'ISO_IR 126': 'iso-8859-7',
  'ISO_IR 138': 'iso-8859-8',
  'ISO_IR 148': 'iso-8859-9',
  'ISO_IR 203': 'iso-8859-15',
  'ISO_IR 166': 'windows-874',
  'ISO_IR 13': 'shift_jis',
  'ISO_IR 192': 'utf-8',
  GB18030: 'gb18030',
  GBK: 'gbk',
  'ISO 2022 IR 100': 'latin1',
  'ISO 2022 IR 101': 'iso-8859-2',
  'ISO 2022 IR 144': 'iso-8859-5',
  'ISO 2022 IR 126': 'iso-8859-7',
  'ISO 2022 IR 148': 'iso-8859-9',
  'ISO 2022 IR 87': 'iso-2022-jp',
  'ISO 2022 IR 159': 'iso-2022-jp',
  'ISO 2022 IR 149': 'euc-kr',
  'ISO 2022 IR 58': 'gb18030'
}

/**
 * The decoder for a file's (0008,0005), which may hold several values when the
 * file switches between sets with escape sequences.
 *
 * With none stated the text is meant to be ASCII. Exporters that write Latin-1
 * there anyway are common enough that Latin-1 is the better guess for the bytes
 * that are not.
 */
function decoderFor(dict: Dict): TextDecoder {
  return decoderForCharset((dict['00080005']?.Value ?? []).map((value) => String(value ?? '')))
}

/** The same, from the values of (0008,0005) however they were read. */
export function decoderForCharset(charset: string[]): TextDecoder {
  const values = charset.map((value) => value.trim())
  const named = values.map((value) => DECODERS[value]).filter((name): name is string => name !== undefined)
  // A second value is the set the text switches into, and the one that says
  // how its bytes above 0x7F are to be read.
  const label = named.find((name) => name !== 'latin1') ?? named[0] ?? 'latin1'
  try {
    return new TextDecoder(label)
  } catch {
    return new TextDecoder('latin1')
  }
}

/** What dcmio holds for a string it read: one character per byte. */
function isByteString(value: string): boolean {
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) > 0xff) return false
  return true
}

/**
 * Change every text value, replacing elements rather than editing them: the
 * anonymiser's output shares elements with the dict it was given, and that dict
 * is the one the next frame of the same file starts from.
 */
function mapText(dict: Dict, change: (value: string) => string): void {
  for (const [tag, element] of Object.entries(dict)) {
    if (!element?.Value) continue
    if (element.vr === 'SQ') {
      const items = element.Value.map((item) => {
        if (!item || typeof item !== 'object') return item
        const copy = { ...(item as Dict) }
        mapText(copy, change)
        return copy
      })
      dict[tag] = { ...element, Value: items }
      continue
    }
    if (!TEXT_VRS.has(element.vr)) continue
    dict[tag] = { ...element, Value: element.Value.map((value) => (typeof value === 'string' ? change(value) : value)) }
  }
}

/**
 * Turn every text value dcmio read out of this file into the text it stands
 * for, by the file's own character set, and say so in (0008,0005).
 *
 * For a dict that is going to be written by dcmio and read again by this app:
 * UTF-8 is what dcmio writes, so ISO_IR 192 is then what the file holds. Items
 * of a sequence are read with the character set of the file, which is what an
 * item says when it does not name its own.
 */
export function textAsUnicode(dict: Dict): void {
  const decoder = decoderFor(dict)
  mapText(dict, (value) =>
    isByteString(value) && /[\x80-\xff]/.test(value) ? decoder.decode(Uint8Array.from(value, (c) => c.charCodeAt(0))) : value
  )
  dict['00080005'] = { vr: 'CS', Value: ['ISO_IR 192'] }
}

/** Letters ASCII has no accent-free form of, spelled the way they are usually written without. */
const SPELLED: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  Æ: 'AE',
  œ: 'oe',
  Œ: 'OE',
  ø: 'o',
  Ø: 'O',
  ł: 'l',
  Ł: 'L',
  đ: 'd',
  Đ: 'D',
  ð: 'd',
  Ð: 'D',
  þ: 'th',
  Þ: 'Th',
  ı: 'i',
  '–': '-',
  '—': '-',
  '‐': '-',
  '−': '-',
  '‘': "'",
  '’': "'",
  '‚': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '«': '"',
  '»': '"',
  '…': '...',
  '×': 'x',
  '°': ' deg',
  '±': '+/-',
  µ: 'u',
  μ: 'u',
  ' ': ' '
}

/** The nearest ASCII spelling of some text. */
export function toAscii(value: string): string {
  let out = ''
  // Decomposed, an accented letter is the letter and then its accent, and the
  // accent is what goes.
  for (const char of value.normalize('NFKD')) {
    const code = char.codePointAt(0)!
    if (code < 0x80) out += char
    else if (code >= 0x300 && code <= 0x36f) continue
    else out += SPELLED[char] ?? '?'
  }
  return out
}

/**
 * Write every text value of an anonymised dict in ASCII, and drop (0008,0005),
 * since ASCII is the repertoire a file that states none is in.
 *
 * `source` is the dict as read, which is where the character set is stated:
 * the anonymiser keeps (0008,0005), but taking it from the original means this
 * does not depend on that.
 */
export function textAsAscii(dict: Dict, source: Dict = dict): void {
  const decoder = decoderFor(source)
  mapText(dict, (value) => {
    const text =
      isByteString(value) && /[\x80-\xff]/.test(value) ? decoder.decode(Uint8Array.from(value, (c) => c.charCodeAt(0))) : value
    return /[^\x00-\x7f]/.test(text) ? toAscii(text) : text
  })
  delete dict['00080005']
}
