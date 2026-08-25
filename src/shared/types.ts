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

/**
 * A rectangle to blank out of every image in a stack, in fractions of the
 * image (0–1, origin top-left) so it survives the preview downscale and applies
 * at full resolution.
 */
export interface MaskRect {
  x: number
  y: number
  width: number
  height: number
}

/** Window centre and width, in the rescaled units the pixels are read in. */
export interface WindowLevel {
  centre: number
  width: number
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
  /**
   * Regions painted out in the viewer, applied to every slice of the stack —
   * burnt-in text sits in the same place on all of them. Written into the pixel
   * data at anonymisation, so what is uploaded really is redacted.
   */
  masks: MaskRect[]
  /**
   * Window chosen in the viewer, written to WindowCenter/WindowWidth on upload.
   * Null leaves the exporter's own window in place.
   */
  window: WindowLevel | null
  /**
   * Why this stack cannot be uploaded, in words for the picker; null when it
   * can. Said here, while the tree is built, because the alternative is finding
   * out during anonymisation — where the failure is per file, so the stack
   * uploads nothing and disappears from the case behind a count of errors.
   */
  unsupported: string | null
}

/**
 * One decoded frame, as it crosses the bridge.
 *
 * Greyscale frames travel unwindowed so the viewer can rewindow them on a mouse
 * drag without asking for the frame again; a colour frame has no window to
 * choose, so it travels as finished pixels.
 */
export type PreviewFrame =
  | {
      kind: 'grey'
      width: number
      height: number
      /** One rescaled value per pixel. */
      values: Float32Array
      /** The window the file asks for, or the frame's own range. */
      window: WindowLevel
      invert: boolean
      /**
       * The file's pixels are compressed. The frame here was decoded to show,
       * and blanking one is decoded too — so the viewer can warn that the
       * upload will be plain samples, and larger than the file it came from.
       */
      compressed: boolean
    }
  | { kind: 'colour'; width: number; height: number; rgba: Uint8ClampedArray; compressed: boolean }

/**
 * What the check for burnt-in text found in one stack.
 *
 * There is no entry for "nothing found", and no field that means clean: this
 * looks for obvious overlays and misses faint ones, so a stack with no finding
 * is a stack nothing was noticed in, which is not the same thing.
 */
export interface BurnInFinding {
  stackId: string
  /** Areas that look like overlaid text, in fractions of the image. */
  regions: MaskRect[]
  /** The file's own BurnedInAnnotation says YES. */
  declared: boolean
  /** Images compared; 1 means the "same on every image" test could not run. */
  compared: number
}

/** Which build this is, for the home screen and for bug reports. */
export interface AppInfo {
  version: string
  /** Ready to display: "macOS 15.6", "Windows 10.0.22631", "Linux 6.8.0". */
  os: string
  arch: string
  electron: string
}

/** What the renderer sends back about one stack it wants uploaded. */
export interface StackSelection {
  id: string
  trimStart: number
  trimEnd: number
  /** Absent from an older renderer, or from a stack nobody opened. */
  masks?: MaskRect[]
  window?: WindowLevel | null
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
