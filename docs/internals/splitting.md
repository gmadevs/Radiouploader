# Splitting before anonymisation

The order of the pipeline is set by one fact about the anonymiser.

Radiopaedia's anonymiser uses a whitelist: it removes every element that is not explicitly
allowed, and all private tags. Most vendors store diffusion b-values in private tags (Siemens
`(0019,100C)`, GE `(0043,1039)`, Philips `(2001,1003)`), and the anonymiser also clears
`StudyDate`. This information exists only in the original files.

The app therefore reads and groups the files first and anonymises them last:

```
scan → read metadata → group into studies/series/stacks → you choose → anonymise → upload
```

If anonymisation ran first, the app could not tell a b=0 image from a b=1000 image.

For the same reason, the app reads `PatientAge`, `PatientBirthDate` and `PatientSex` at
import. The anonymiser removes them, and the case form uses them to suggest the patient's age
and gender.

## How series are split

A series is split along every dimension that varies within it, because several often vary
together: an SWI series can contain magnitude, phase, SWI and mIP images, and a diffusion
series several b-values and an ADC map.

| Dimension | Read from |
|---|---|
| Magnitude / phase / SWI / mIP / ADC | `ImageType` (0008,0008), `ComplexImageComponent` (0008,9208) |
| b-value | `(0018,9087)`, then the Siemens, GE and Philips private tags |
| Echo | `EchoNumbers` (0018,0086) |
| Time point | `TemporalPositionIdentifier` (0020,0100), or repeated slice positions ordered by `TriggerTime` / `AcquisitionTime` |

Multiframe objects, such as cine runs and enhanced MR, are shown one frame per image, and at
anonymisation each frame is written as a separate instance. Radiopaedia does not split
multiframe objects, so a run uploaded as one file would show only its first frame. A
compressed run must be decoded before its frames can be separated, so a run in a format the
app cannot decode is marked as unsupported in the picker.

### Enhanced objects are split by frame

A classic export stores a dynamic acquisition as hundreds of instances. An enhanced MR or CT
stores it as one file, and the information that separates the phases is in
`PerFrameFunctionalGroupsSequence` (5200,9230), with one item per frame, and in
`SharedFunctionalGroupsSequence` (5200,9229) for values common to all frames.

The app reads both at import and applies the table above to each frame:

| Read per frame | From |
|---|---|
| Time point | `TemporalPositionIndex` (0020,9128), in `FrameContentSequence` |
| b-value | `DiffusionBValue` (0018,9087), in `MRDiffusionSequence` |
| Echo | `EffectiveEchoTime` (0018,9082), in `MREchoSequence`; the app numbers the echoes, because the file gives only times |
| Magnitude / phase / … | `FrameType` (0008,9007), in the MR or CT frame type sequence |
| Position | `ImagePositionPatient` in `PlanePositionSequence`, projected on the shared orientation |

A dynamic enhanced series therefore appears as one stack per phase, as it would from a
classic export, and each phase can be selected separately.

The app also reads `StackID` (0020,9056). One enhanced object can contain several volumes,
typically three orthogonal localisers, and frames of different stacks are kept separate when
a stack is ordered.

To upload one frame of an enhanced object as its own image, the app also copies the frame's
description to the top level. `ImagePositionPatient`, `ImageOrientationPatient`,
`PixelSpacing`, `SliceThickness`, the rescale and the window are stored per frame in those
sequences, and the anonymiser removes the sequences. The app copies the frame's values to the
top level before anonymisation, so the uploaded image keeps its geometry and a CT keeps its
Hounsfield units.

Objects without pixel data are skipped at import and do not appear as series.

### Order within a stack

Images are ordered by `ImagePositionPatient` (0020,0032) projected on the slice normal. This
is more reliable than `SliceLocation` (0020,1041), which many exporters leave out or fill in
inconsistently. `InstanceNumber` is used when there is no position.

The projection is a position along a shared axis only if all images in the stack have the same
orientation. A rotating MIP does not: an MR or CT angiogram exported as projections at
different angles around the patient has a different `ImageOrientationPatient` (0020,0037) on
each image. Each image's distance along its own normal follows a sine wave, so ordering by it
mixes up the projections. A sixty-projection carotid series came out in the order 15, 16, 14,
17, 13, 18 and so on, and the rotation jumped back and forth.

The app therefore compares the normals first. If they differ, the stack is ordered by
`InstanceNumber`; it is not named after the plane of its first image; repeated positions are
not treated as time points; and reformatting it is refused, because a set of projections is
not a volume. Only normals that are present and different count: an image without
`ImageOrientationPatient` does not make the stack count as rotating.

## UIDs after anonymisation

The anonymiser replaces UIDs with hashed values, so the same original UID always becomes the
same new UID. All stacks split from one series therefore keep the same `SeriesInstanceUID`.
Any step that rebuilt series from DICOM UIDs would merge them again, which is why the upload
does not use Radiopaedia's zip endpoint. See [why upload goes through S3](/internals/upload).
