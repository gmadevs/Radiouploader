import fs from 'node:fs/promises'
import dicomParser from 'dicom-parser'
import type { ImageComponent } from '@shared/types'

/**
 * Metadata read from a single instance.
 *
 * IMPORTANT: everything here must be read BEFORE anonymisation. The Radiopaedia
 * anonymiser applies a whitelist and strips all private tags, which is where
 * most vendors keep diffusion b-values. Series structure is therefore derived
 * from the originals and carried forward as an in-memory grouping.
 */
export interface InstanceMeta {
  path: string
  studyInstanceUid: string
  seriesInstanceUid: string
  sopInstanceUid: string | null
  studyDescription: string | null
  /** StudyDate as ISO yyyy-mm-dd. Blanked by the anonymiser, so read it here. */
  studyDate: string | null
  /** StudyTime as raw DICOM TM, used only to order studies acquired the same day. */
  studyTime: string | null
  seriesDescription: string | null
  modality: string | null
  seriesNumber: number | null
  instanceNumber: number | null
  acquisitionNumber: number | null
  /** Distance along the slice normal, used to order and to detect repeats. */
  sliceLocation: number | null
  imageType: string[]
  component: ImageComponent
  echoNumber: number | null
  echoTime: number | null
  temporalPositionIdentifier: number | null
  triggerTime: number | null
  /** AcquisitionTime, falling back to ContentTime. */
  acquisitionTime: string | null
  bValue: number | null
  /** Frames inside this object; more than 1 for cine and enhanced objects. */
  numberOfFrames: number
  /**
   * Transfer syntax from the file meta. Read here because what can be done with
   * a series — split its frames, blank a region — is decided while the tree is
   * built, long before anything opens the pixel data.
   */
  transferSyntaxUid: string | null
  /** PatientAge (0010,1010) as the exporter wrote it, e.g. "045Y". */
  patientAge: string | null
  /** PatientBirthDate (0010,0030) as ISO, which is what is left when age is absent. */
  patientBirthDate: string | null
  /** PatientSex (0010,0040): M, F, or O for anything else. */
  patientSex: string | null
}

type DataSet = dicomParser.DataSet

function str(ds: DataSet, tag: string): string | null {
  const v = ds.string(tag)
  return v === undefined || v === '' ? null : v.trim()
}

function num(ds: DataSet, tag: string): number | null {
  const v = str(ds, tag)
  if (v === null) return null
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : null
}

/** Read a binary FD/FL element, tolerating a missing or short element. */
function binaryFloat(ds: DataSet, tag: string): number | null {
  const el = ds.elements[tag]
  if (!el) return null
  try {
    if (el.length === 8) return ds.double(tag) ?? null
    if (el.length === 4) return ds.float(tag) ?? null
  } catch {
    return null
  }
  return null
}

function multiValue(ds: DataSet, tag: string): string[] {
  const v = str(ds, tag)
  return v === null ? [] : v.split('\\').map((s) => s.trim()).filter(Boolean)
}

/**
 * Diffusion b-value. The standard attribute (0018,9087) only appears in enhanced
 * objects and a few modern exporters, so the vendor private tags are the usual
 * source in practice.
 */
function readBValue(ds: DataSet): number | null {
  const standard = binaryFloat(ds, 'x00189087')
  if (standard !== null && standard >= 0) return standard

  // Siemens: (0019,100C) IS
  const siemens = num(ds, 'x0019100c')
  if (siemens !== null && siemens >= 0) return siemens

  // GE: (0043,1039) multi-valued, b-value first. Older units are offset by 1e9.
  const geRaw = multiValue(ds, 'x00431039')[0]
  if (geRaw !== undefined) {
    let ge = Number.parseFloat(geRaw)
    if (Number.isFinite(ge) && ge >= 0) {
      if (ge >= 1e9) ge -= 1e9
      return ge
    }
  }

  // Philips: (2001,1003) FL
  const philips = binaryFloat(ds, 'x20011003')
  if (philips !== null && philips >= 0) return philips

  // Toshiba/Canon: (0018,9087) already covered; (0043,1039) covered.
  return null
}

/**
 * Classify magnitude / phase / derived flavour. ImageType value 3 is the vendor
 * flavour and is where M, P, SWI and mIP show up; ComplexImageComponent
 * (0008,9208) is the standard attribute and wins when present.
 */
export function classifyComponent(imageType: string[], complexComponent: string | null): ImageComponent {
  const tokens = imageType.map((t) => t.toUpperCase())
  const complex = complexComponent?.toUpperCase() ?? null

  if (complex === 'PHASE') return 'phase'
  if (complex === 'REAL') return 'real'
  if (complex === 'IMAGINARY') return 'imaginary'

  if (tokens.some((t) => t === 'MIN IP' || t === 'MNIP' || t === 'MIP' || t === 'MAX IP')) return 'mip'
  if (tokens.some((t) => t === 'SWI' || t === 'SW' || t.includes('SWI'))) return 'swi'
  if (tokens.some((t) => t === 'ADC' || t.includes('ADC'))) return 'adc'
  if (tokens.some((t) => t === 'P' || t === 'PHASE' || t === 'PHASE MAP')) return 'phase'
  if (tokens.some((t) => t === 'R' || t === 'REAL')) return 'real'
  if (tokens.some((t) => t === 'I' || t === 'IMAGINARY')) return 'imaginary'
  if (tokens.some((t) => t === 'M' || t === 'MAGNITUDE')) return 'magnitude'
  if (complex === 'MAGNITUDE') return 'magnitude'
  if (tokens[0] === 'DERIVED') return 'derived'
  return 'unknown'
}

/**
 * Project ImagePositionPatient onto the slice normal derived from
 * ImageOrientationPatient. This is more reliable than SliceLocation, which many
 * vendors leave absent or inconsistent.
 */
function computeSliceLocation(ds: DataSet): number | null {
  const pos = multiValue(ds, 'x00200032').map(Number)
  const orient = multiValue(ds, 'x00200037').map(Number)
  if (pos.length === 3 && orient.length === 6 && [...pos, ...orient].every(Number.isFinite)) {
    const normal = [
      orient[1] * orient[5] - orient[2] * orient[4],
      orient[2] * orient[3] - orient[0] * orient[5],
      orient[0] * orient[4] - orient[1] * orient[3]
    ]
    return pos[0] * normal[0] + pos[1] * normal[1] + pos[2] * normal[2]
  }
  return num(ds, 'x00201041')
}

/**
 * DICOM DA is YYYYMMDD. Return ISO yyyy-mm-dd, or null when the element is
 * absent or malformed.
 */
function readDate(ds: DataSet, ...tags: string[]): string | null {
  for (const tag of tags) {
    const raw = str(ds, tag)
    const m = raw === null ? null : /^(\d{4})(\d{2})(\d{2})$/.exec(raw)
    if (m) return `${m[1]}-${m[2]}-${m[3]}`
  }
  return null
}

/**
 * How old the patient was at this study, in years.
 *
 * PatientAge is preferred because it is what the scanner recorded on the day.
 * Its VR is three digits and a unit, so a two-week-old and a two-year-old are
 * told apart properly rather than both reading as "2". Failing that, the birth
 * date against the study date says the same thing.
 *
 * Both are identifying and both are removed by anonymisation, which is why this
 * runs at ingest and not later.
 */
export function ageInYears(
  patientAge: string | null,
  birthDate: string | null,
  studyDate: string | null
): number | null {
  const written = /^0*(\d{1,3})\s*([DWMY])$/i.exec(patientAge?.trim() ?? '')
  if (written) {
    const count = Number(written[1])
    switch (written[2].toUpperCase()) {
      case 'Y':
        return count
      case 'M':
        return count / 12
      case 'W':
        return count / 52.1775
      case 'D':
        return count / 365.25
    }
  }

  if (birthDate !== null && studyDate !== null) {
    const days = (Date.parse(`${studyDate}T00:00:00Z`) - Date.parse(`${birthDate}T00:00:00Z`)) / 86_400_000
    // A birth date after the study is a typo or a placeholder, not a fact.
    if (Number.isFinite(days) && days >= 0) return days / 365.25
  }
  return null
}

/** Parse one file. Throws if it is not a readable DICOM object. */
export async function readInstance(filePath: string): Promise<InstanceMeta> {
  const buf = await fs.readFile(filePath)
  // Pixel data is not needed for grouping; skipping it keeps large studies fast.
  const ds = dicomParser.parseDicom(new Uint8Array(buf), { untilTag: 'x7fe00010' })

  const studyInstanceUid = str(ds, 'x0020000d')
  const seriesInstanceUid = str(ds, 'x0020000e')
  if (!studyInstanceUid || !seriesInstanceUid) {
    throw new Error('Missing StudyInstanceUID or SeriesInstanceUID')
  }

  // Presentation states, structured reports and raw-data objects live alongside
  // the images and parse fine. Some even declare Rows and Columns — Philips Raw
  // Data Storage (1.2.840.10008.5.1.4.1.1.66) does — so the absence of pixel
  // data is what actually distinguishes them. They must not appear as series.
  if (ds.uint16('x00280010') === undefined || ds.uint16('x00280011') === undefined) {
    throw new Error('Not an image object (no Rows/Columns)')
  }
  if (!ds.elements['x7fe00010']) {
    throw new Error('Not an image object (no pixel data)')
  }

  const imageType = multiValue(ds, 'x00080008')

  return {
    path: filePath,
    studyInstanceUid,
    seriesInstanceUid,
    sopInstanceUid: str(ds, 'x00080018'),
    studyDescription: str(ds, 'x00081030'),
    // SeriesDate and AcquisitionDate are the fallbacks when an exporter drops StudyDate.
    studyDate: readDate(ds, 'x00080020', 'x00080021', 'x00080022'),
    studyTime: str(ds, 'x00080030'),
    seriesDescription: str(ds, 'x0008103e'),
    modality: str(ds, 'x00080060'),
    seriesNumber: num(ds, 'x00200011'),
    instanceNumber: num(ds, 'x00200013'),
    acquisitionNumber: num(ds, 'x00200012'),
    sliceLocation: computeSliceLocation(ds),
    imageType,
    component: classifyComponent(imageType, str(ds, 'x00089208')),
    echoNumber: num(ds, 'x00180086'),
    echoTime: num(ds, 'x00180081'),
    temporalPositionIdentifier: num(ds, 'x00200100'),
    triggerTime: num(ds, 'x00181060'),
    acquisitionTime: str(ds, 'x00080032') ?? str(ds, 'x00080033'),
    bValue: readBValue(ds),
    numberOfFrames: num(ds, 'x00280008') ?? 1,
    transferSyntaxUid: str(ds, 'x00020010'),
    // Identifying, and gone after anonymisation. Read here so the case form can
    // offer them back as the two fields Radiopaedia asks for.
    patientAge: str(ds, 'x00101010'),
    patientBirthDate: readDate(ds, 'x00100030'),
    patientSex: str(ds, 'x00100040')
  }
}
