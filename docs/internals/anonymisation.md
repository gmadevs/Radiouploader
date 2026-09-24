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

It works on the dataset only. The **file meta header** in front of it — group `0002` — is
written back as it was read, which left every file carrying its original SOP Instance UID in
`MediaStorageSOPInstanceUID` (0002,0003): an identifier the hospital's PACS can look up. The
app replaces that one itself, with the dataset's hashed UID where the anonymiser kept one and
otherwise a `2.25.…` UID hashed one way from the original, so it is stable between runs. The
AE titles in the meta header (0002,0016–0018), which name the hospital's machines, are
dropped.

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

Video — MPEG-2, H.264, HEVC — is always rewritten, even a clip of one frame: a video stream
is not an image Radiopaedia shows. Its frames are decoded whole by ffmpeg in the main process
before the anonymiser's worker starts, masked and cropped like a frame of any other run, and
then — last of all the pixel work — compressed again as **JPEG baseline** at quality 95,
YBR_FULL, with `LossyImageCompression` set, by libjpeg-turbo's WASM encoder
(`src/main/codecs/encode.ts`). Plain samples made a few megabytes of clip into hundreds;
the frames were lossy already, so a second, invisible loss is the better trade. Only video
goes through it: a lossless original is never recompressed. A test re-runs the anonymiser
on such a file and checks it changes nothing, since that is what Radiopaedia does with every
upload. Only a format with no decoder at all is refused.

## Layouts that are refused

Masking, cropping and splitting all take a sample to be one byte or two, and a pixel to be
all of its samples side by side. An image stored any other way — 32-bit samples, a 1-bit
segmentation, `YBR_FULL_422` or another subsampled colour — would not fail those loops; it
would have its mask painted somewhere other than where it was drawn. So an image like that
which needs any of the three is refused and counted among the files that could not be
anonymised, which keeps it out of the upload. With nothing to paint, cut or split it goes
through as it is.

## Warnings

Some fields survive the whitelist because they carry imaging parameters, but they are free
text: a hospital's export can put anything in `SeriesDescription`. Those are collected and
shown on the case form before upload, with a count of how many images carry each. Nothing
else will read them for you.
