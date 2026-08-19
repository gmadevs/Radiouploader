/** Types shared between the main process, the preload bridge and the renderer. */

export type SourceKind = 'folder' | 'zip' | 'files'

/** How a stack was split out of its parent DICOM series. */
export type StackKind =
  | 'single' // series had no internal structure worth splitting
  | 'phase' // dynamic/multiphase acquisition, one stack per time point
  | 'echo' // multi-echo acquisition
  | 'diffusion' // DWI, one stack per b-value
  | 'component' // SWI/phase-contrast: magnitude, phase, SWI, mIP...

/** The magnitude/phase/derived flavour of an image, read from ImageType. */
export type ImageComponent = 'magnitude' | 'phase' | 'real' | 'imaginary' | 'swi' | 'mip' | 'adc' | 'derived' | 'unknown'

export interface SliceRef {
  /** Absolute path on disk (inside the temp dir for zip sources). */
  path: string
  /**
   * Frame within the file, 0-based. Single-frame instances are always 0; a
   * multiframe object such as an XA cine run contributes one SliceRef per frame,
   * so the picker can scrub through it. Upload still sends the file once.
   */
  frame: number
  instanceNumber: number | null
  /** ImagePositionPatient projected on the slice normal; used for ordering. */
  sliceLocation: number | null
  sopInstanceUid: string | null
}

export interface Stack {
  id: string
  kind: StackKind
  /** Human-readable label shown in the picker, e.g. "b=1000" or "Phase". */
  label: string
  component: ImageComponent
  bValue: number | null
  echoNumber: number | null
  /** Index of the time point within a dynamic series, 1-based. */
  phaseIndex: number | null
  acquisitionTime: string | null
  slices: SliceRef[]
  selected: boolean
  /**
   * Inclusive index range of `slices` to keep, so the dead ends of a series —
   * the localiser slices before the anatomy, the tail after it — can be dropped
   * without deselecting the whole stack. Defaults to the full range.
   */
  trimStart: number
  trimEnd: number
}

export interface Series {
  id: string
  seriesInstanceUid: string
  seriesNumber: number | null
  description: string | null
  modality: string | null
  /** Set when the series was split into more than one stack. */
  splitReason: StackKind | null
  stacks: Stack[]
  instanceCount: number
}

export interface Study {
  id: string
  studyInstanceUid: string
  studyDescription: string | null
  modality: string | null
  /** ISO yyyy-mm-dd read from the originals; null when the exporter dropped it. */
  studyDate: string | null
  /**
   * Whole days between this study and the earliest one in the import. 0 for the
   * first study, null when either date is unknown. This is the interval a
   * follow-up case needs to preserve.
   */
  intervalDays: number | null
  series: Series[]
}

export interface IngestResult {
  sourceKind: SourceKind
  sourcePath: string
  /** Temp dir to clean up when the session ends; null for folder sources. */
  tempDir: string | null
  studies: Study[]
  /** Files that looked like DICOM but could not be parsed. */
  failures: { path: string; reason: string }[]
  scannedFileCount: number
}

export interface AnonWarning {
  path: string
  frame: number
  tag: string
  level: number
  text: string
}

export interface AnonResult {
  outputDir: string
  files: { sourcePath: string; frame: number; outputPath: string; sha256: string; byteLength: number }[]
  warnings: AnonWarning[]
  errors: { path: string; reason: string }[]
}

export interface Progress {
  phase: 'scanning' | 'parsing' | 'anonymising' | 'uploading'
  done: number
  total: number
  detail?: string
}
