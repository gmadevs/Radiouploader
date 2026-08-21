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

## Where a mask is refused

Painting a mask means writing into stored samples. On a compressed transfer syntax those
samples are a bitstream, and writing into it would corrupt the image rather than redact it.

So a mask on a compressed object is **refused at anonymisation** rather than attempted. The
viewer never offers the eraser there in the first place, since it cannot decode the image
to show you what you would be erasing.

## Warnings

Some fields survive the whitelist because they carry imaging parameters, but they are free
text: a hospital's export can put anything in `SeriesDescription`. Those are collected and
shown on the case form before upload, with a count of how many images carry each. Nothing
else will read them for you.
