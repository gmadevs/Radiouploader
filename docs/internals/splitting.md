# Splitting before anonymisation

This is the constraint the whole pipeline is built around.

Radiopaedia's anonymiser applies a **whitelist**: every element is stripped unless
explicitly permitted, and all private tags go. Most vendors keep diffusion b-values in
private tags — Siemens `(0019,100C)`, GE `(0043,1039)`, Philips `(2001,1003)` — and
`StudyDate` is blanked too. That information exists only in the originals.

So the pipeline reads and groups first, and anonymises last:

```
scan → read metadata → group into studies/series/stacks → you choose → anonymise → upload
```

Get that order wrong and the app can no longer tell a b=0 image from a b=1000 one.

The same order is why the case form can offer an age and a sex at all: `PatientAge`,
`PatientBirthDate` and `PatientSex` are identifying, the anonymiser removes them, and they
are read on the way in like everything else that has to survive it.

## How series are split

A series is split along every dimension that actually varies inside it, because they
co-occur in practice: an SWI series carries magnitude, phase, SWI and mIP; a diffusion
series carries several b-values plus the ADC map.

| Dimension | Read from |
|---|---|
| Magnitude / phase / SWI / mIP / ADC | `ImageType` (0008,0008), `ComplexImageComponent` (0008,9208) |
| b-value | `(0018,9087)`, then the Siemens / GE / Philips private tags |
| Echo | `EchoNumbers` (0018,0086) |
| Time point | `TemporalPositionIdentifier` (0020,0100), or repeated slice positions ordered by `TriggerTime` / `AcquisitionTime` |

Multiframe objects — cine runs, enhanced MR — are expanded to one scrubbable frame each,
and each frame is written out as its own instance at anonymisation, because Radiopaedia does
not expand them server-side: a run sent whole would be published as its first frame. A
compressed run has to be decoded before its frames can be separated at all, so one in a
format with no decoder is refused by name in the picker.

### An enhanced object is split by its own frames

A legacy exporter writes a dynamic acquisition as hundreds of instances; an enhanced MR or
CT writes the same thing as **one file**, and what separates the phases is not in the header
at all. It is in `PerFrameFunctionalGroupsSequence` (5200,9230), one item per frame, with
whatever the frames have in common in `SharedFunctionalGroupsSequence` (5200,9229).

Both are read at ingest, and the table above is then applied per frame rather than per file:

| Read per frame | From |
|---|---|
| Time point | `TemporalPositionIndex` (0020,9128), in `FrameContentSequence` |
| b-value | `DiffusionBValue` (0018,9087), in `MRDiffusionSequence` |
| Echo | `EffectiveEchoTime` (0018,9082), in `MREchoSequence` — numbered here, since the file states only times |
| Magnitude / phase / … | `FrameType` (0008,9007), in the MR or CT frame-type sequence |
| Position | `ImagePositionPatient` in `PlanePositionSequence`, projected on the shared orientation |

So a dynamic enhanced series arrives as one stack per phase, the same as it would from a
legacy exporter, and the phases can be ticked and dropped individually.

`StackID` (0020,9056) is read too. An object can hold several volumes — three orthogonal
localisers is the usual case — and frames of different ones are kept apart when the stack is
ordered, so they cannot interleave into a volume that is no volume.

Lifting one frame out of an enhanced object takes more than copying its pixels. Everything
that describes an image in DICOM — where it sits, how big its pixels are, what their values
mean — is stated **per frame** in those sequences rather than at the top level, and the
anonymiser drops both sequences. So the frame's own `ImagePositionPatient`,
`ImageOrientationPatient`, `PixelSpacing`, `SliceThickness`, rescale and window are promoted
to the top level before anonymisation runs. Without that the upload would be an image with
no geometry and Hounsfield units that had quietly become stored values.

Objects with no pixel data are rejected at ingest so they never appear as series to upload.

### Ordering inside a stack

Images are ordered by `ImagePositionPatient` (0020,0032) projected on the slice normal,
which is steadier than `SliceLocation` (0020,1041) — many exporters leave that absent or
inconsistent. `InstanceNumber` is the fallback.

That projection is a coordinate on a shared axis only while every image in the stack was cut
the same way, and one kind of series is not: a **rotating MIP**, where an MR or CT angiogram
is exported as a run of projections around the patient, each with its own
`ImageOrientationPatient` (0020,0037). Each one's distance along its *own* normal traces a
sine wave — up, back down, up again — so ordering by it deals the rotation out like a pack of
cards. A sixty-projection carotid run came through as 15, 16, 14, 17, 13, 18 …, which on
screen is an image that jumps from one side to the other and back instead of turning.

So the normals are compared first. Where they disagree the stack is ordered by
`InstanceNumber` instead, it is not named after the plane of whichever projection came first,
repeated distances in it are not read as a dynamic acquisition acquired twice, and a reformat
of it is refused by name — there is no volume to cut through a set of projections. Only a
normal that positively disagrees counts: an image that does not say which way it points is
left to the ones that do.

## Why UIDs matter later

Anonymisation regenerates UIDs deterministically, so every stack cut out of one original
series still shares its `SeriesInstanceUID`. Anything downstream that rebuilds series from
DICOM identifiers would therefore glue the stacks back together — which is precisely why
the upload cannot use the zip endpoint. See
[why upload goes through S3](/internals/upload).
