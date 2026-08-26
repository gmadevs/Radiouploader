# Anonymisation and masks

The app does not implement its own anonymiser. It links
[radiopaedia/dicom-anonymiser](https://github.com/radiopaedia/dicom-anonymiser), the
reference implementation, and runs it in a worker thread.

That is not merely convenient. **Radiopaedia re-runs the same anonymiser on every uploaded
DICOM and rejects the file if any tag would change**, and API clients found to have
uploaded patient data are suspended. Using anything else means guessing at a validator you
cannot see.

Its output satisfies that validator: `PatientIdentityRemoved` is set to `YES`,
`SOPInstanceUID` is removed entirely, and the UIDs are rewritten into the required
`1.2.826.0.1.3680043.10.341.512.…` hashed scheme.

## What the app adds

Two things are written into the file **before** `Anonymize` runs, so the bytes that come out
are final and Radiopaedia's re-run stays a no-op:

**Masks are painted into the pixel data.** A rectangle drawn in the viewer is stored as
fractions of the image, so it survives the preview downscale and applies at full
resolution. The fill is worked out per image: black is the dark end of the window in force,
taken back through the rescale, so a redaction stays black on a CT (where 0 is soft tissue)
and on MONOCHROME1 (where 0 is white); on YBR colour it is luminance 0 with the chroma
channels centred.

**The chosen window is written to the tags.** `WindowCenter` / `WindowWidth` (0028,1050 /
0028,1051), with any `WindowCenterWidthExplanation` or `VOILUTSequence` that would
contradict it dropped. The pixels are not touched, so the original values reach Radiopaedia
and stay re-windowable.

## A mask on a compressed image

Painting a mask means writing into stored samples. On a compressed transfer syntax those
samples are a bitstream, and writing into it would corrupt the image rather than redact it.

So the file is decoded first. The pixel data is replaced by the samples it decodes to, the
transfer syntax becomes explicit VR little endian, and the tags that describe the pixels are
rewritten from what the codec returned — bit depth, planar configuration, and photometric
interpretation, which is the one that bites: a file declaring `YBR_FULL` hands back RGB, and
leaving the tag alone publishes an image with red and blue swapped.

All of that happens **before** `Anonymize` runs, like the mask itself, so the bytes written
are final and Radiopaedia's re-run of the same anonymiser stays a no-op.

A [crop](/guide/review#crop) is written there too, and after the mask rather than before it:
both are fractions of the image as it arrived, so a mask outside the crop goes the way of
everything else out there. It rewrites `Rows`, `Columns` and `ImagePositionPatient` — the
last walked across and down in patient millimetres, or deleted when the file says too little
to walk it — because a header describing the grid the pixels used to sit on is one that
lies.

The uploaded file is much larger — the JPEG test pattern in the repository is 49 kB and
768 kB decoded. A compressed image with nothing to blank and nothing to cut away is passed
through untouched instead, so it stays small and lossless. The same machinery splits a compressed cine, which
cannot have its frames cut out of a bitstream by offset either.

Only a format with no decoder is refused, and video — MPEG-2, MPEG-4, HEVC — is what is
left.

## Warnings

Some fields survive the whitelist because they carry imaging parameters, but they are free
text: a hospital's export can put anything in `SeriesDescription`. Those are collected and
shown on the case form before upload, with a count of how many images carry each. Nothing
else will read them for you.
