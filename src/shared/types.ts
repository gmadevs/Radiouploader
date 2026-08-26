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

/**
 * The part of every image in a stack to keep, in fractions of the image — the
 * same units and origin as a mask, so both are drawn on the picture as it
 * arrived and neither has to be re-expressed when the other changes.
 *
 * One rectangle for the whole stack, and not because that is simpler: the
 * volume behind a reformat is a box, and images cut to different sizes do not
 * make one.
 */
export interface CropRect {
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
   * The part of the image kept, applied to every slice of the stack. Null keeps
   * all of it, which is what nearly every stack wants.
   *
   * Unlike a mask this changes what the images *are*: Rows, Columns and
   * ImagePositionPatient are rewritten to match, because a header that still
   * describes the uncropped grid is a header that lies about its own pixels.
   */
  crop: CropRect | null
  /**
   * Window chosen in the viewer, written to WindowCenter/WindowWidth on upload.
   * Null leaves the exporter's own window in place.
   */
  window: WindowLevel | null
  /**
   * The plane these images were cut on, as a word — Axial, Coronal, Sagittal or
   * Oblique. Null when the files do not say which way they point.
   */
  plane: string | null
  /**
   * What this stack weighs on disk. A stack that is part of a multiframe file
   * gets its share of it rather than the whole, so the shares of a run split
   * into phases add up to the file instead of to four times it.
   */
  bytes: number
  /**
   * How the pixels are stored, in the words the picker shows — "JPEG 2000",
   * "RLE". Null means plain samples, which is what most exports are and what
   * nothing has to be decoded to change.
   */
  compression: string | null
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

/** The plane a stack is cut along. Named in the acquisition's own axes. */
export type Plane = 'axial' | 'coronal' | 'sagittal'

/** What a slab of the volume collapses to. `slice` takes one plane and no more. */
export type Projection = 'slice' | 'mip' | 'minip' | 'mean'

/**
 * The plane a reformat is taken on: across, down, and the way it looks, as unit
 * vectors in the volume's own millimetre space. Any orientation, not only the
 * three anatomical ones — rotating them is what makes this an MPR rather than
 * three fixed views.
 */
export interface ReformatFrame {
  u: [number, number, number]
  v: [number, number, number]
  n: [number, number, number]
}

/** A reformat to build, as the dialog describes it. */
export interface ReformatPlan {
  frame: ReformatFrame
  projection: Projection
  /** Slab thickness in millimetres; ignored for a plain slice. */
  thickness: number
  /** Millimetres between the images that come out. */
  spacing: number
  /**
   * The window to write on the derived images. Absent means the one the dialog
   * opened with, which is what the user saw if they never touched it.
   */
  window?: WindowLevel | null
}

/** One image of a reformat, which is a plan plus where along the normal it sits. */
export interface ReformatRequestMessage extends ReformatPlan {
  offset: number
}

/** What a stack can be reformatted into, measured once the volume is built. */
export interface VolumeInfo {
  columns: number
  rows: number
  depth: number
  spacing: { x: number; y: number; z: number }
  /** How far the volume runs along each of its own axes, in millimetres. */
  size: { x: number; y: number; z: number }
  /** The in-plane pixel size, which is the finest a reformat is worth asking for. */
  finestSpacing: number
  /**
   * The three planes to start from, in the volume's own axes. Worked out from
   * ImageOrientationPatient, so they are the patient's planes and not the
   * acquisition's — on a sagittally acquired brain study those are not the same
   * thing, and the difference is the whole point of computing them.
   */
  frames: Record<Plane, ReformatFrame>
  /** False when the file did not say where it was pointing and these are a guess. */
  anatomical: boolean
}

/**
 * One of the user's cases on Radiopaedia, as the listing gives it.
 *
 * Only a draft can take new images — a case that has gone for review or been
 * published is closed to the API, and one deleted on the site stops appearing
 * in the listing at all.
 */
export interface CaseSummary {
  id: string
  title: string | null
  status: string | null
  visibility: string | null
  updatedAt: string | null
}

/** Which build this is, for the home screen and for bug reports. */
export interface AppInfo {
  version: string
  /** Ready to display: "macOS 15.6", "Windows 10.0.22631", "Linux 6.8.0". */
  os: string
  arch: string
  electron: string
}

/**
 * What the renderer says about one stack.
 *
 * Every stack is sent, ticked or not, because the main process needs the edits
 * on an unticked one too: a reformat can be taken from a stack that is not
 * itself going to be uploaded, and the volume behind it has to be built from
 * the same pixels the user was looking at.
 */
export interface StackSelection {
  id: string
  selected: boolean
  trimStart: number
  trimEnd: number
  /** Absent from a stack nobody opened. */
  masks?: MaskRect[]
  crop?: CropRect | null
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
  /**
   * The patient's age at this study, already rounded to one of the values the
   * case form offers, or null when the originals do not say or the list cannot
   * express it. Read before anonymisation, which removes what it came from.
   */
  patientAge: string | null
  /** Male or Female as Radiopaedia words it; null for anything else, O included. */
  patientSex: 'Male' | 'Female' | null
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
