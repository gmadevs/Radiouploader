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

Objects with no pixel data are rejected at ingest so they never appear as series to upload.

## Why UIDs matter later

Anonymisation regenerates UIDs deterministically, so every stack cut out of one original
series still shares its `SeriesInstanceUID`. Anything downstream that rebuilds series from
DICOM identifiers would therefore glue the stacks back together — which is precisely why
the upload cannot use the zip endpoint. See
[why upload goes through S3](/internals/upload).
