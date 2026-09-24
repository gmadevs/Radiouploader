# Anonymisation and masks

The app uses Radiopaedia's reference anonymiser,
[radiopaedia/dicom-anonymiser](https://github.com/radiopaedia/dicom-anonymiser), and runs it in
a worker thread.

Radiopaedia runs the same anonymiser on every uploaded DICOM file and rejects the file if the
anonymiser would change any tag. API clients that upload patient data are suspended. Using the
same anonymiser is the only way to be sure the files pass that check.

The anonymiser sets `PatientIdentityRemoved` to `YES`, removes `SOPInstanceUID` and replaces
the other UIDs with hashed values in the `1.2.826.0.1.3680043.10.341.512.…` scheme.

The anonymiser changes only the dataset, not the file meta header (group `0002`), so on its own
it would leave the original SOP Instance UID in `MediaStorageSOPInstanceUID` (0002,0003). That
UID can be looked up in the hospital's PACS. The app replaces it with the dataset's hashed UID
if the anonymiser kept one, and otherwise with a `2.25.…` UID calculated by a one-way hash of
the original, so it is the same on every run. The app also removes the AE titles in the meta
header (0002,0016 to 0002,0018), which name the hospital's systems.

## Changes made before anonymisation

The app writes these changes to the file before `Anonymize` runs, so the files it produces
are final and running the anonymiser again changes nothing.

**Erased areas are written into the pixel data.** A rectangle drawn in the viewer is stored
as fractions of the image, so it applies at full resolution, not only to the preview. The
fill value is calculated for each image so that the area is black: on a CT, the darkest value
of the current window, converted back through the rescale (0 would be soft tissue); on
MONOCHROME1, the brightest stored value (0 is white); on YBR colour, luminance 0 with the
chroma channels at the midpoint.

**The chosen window is written to the tags** `WindowCenter` and `WindowWidth` (0028,1050 and
0028,1051). `WindowCenterWidthExplanation` and `VOILUTSequence` are removed, because they
would conflict with it. The pixel values do not change, so the window can still be adjusted
on Radiopaedia.

**An enhanced object's frame gets its own geometry.** Its position, orientation, pixel
spacing, slice thickness, rescale and window are stored per frame in sequences that the
anonymiser removes, so the app copies the frame's values to the top level first. See
[splitting before anonymisation](/internals/splitting).

## Erasing or cropping a compressed image

Writing into compressed image data would damage the image instead of erasing part of it. The
app therefore decodes the file first, replaces the pixel data with the decoded samples,
changes the transfer syntax to explicit VR little endian, and updates the tags that describe
the pixels from the decoder output: bit depth, planar configuration and photometric
interpretation. The photometric interpretation matters most: a file marked `YBR_FULL` decodes
to RGB, and keeping the old tag would swap red and blue in the uploaded image.

A [crop](/guide/review#crop) is applied after the erased areas, because both are defined as
fractions of the original image. An erased area outside the crop is removed with the rest of
the cropped-off image. The crop updates `Rows`, `Columns` and `ImagePositionPatient`; the new
position is calculated in patient millimetres, or the tag is removed if the file does not
contain enough information to calculate it.

The decoded file is larger: the JPEG test image in the repository grows from 49 kB to 768 kB.
A compressed image with no erased area and no crop is uploaded unchanged, so it stays small
and lossless. Multiframe runs are split into single images with the same decoding.

## Video

Video (MPEG-2, H.264, HEVC) is always rewritten, even a clip with a single frame, because
Radiopaedia does not display a video stream in a DICOM file. ffmpeg decodes the whole video
in the main process before the anonymiser's worker starts. Each frame is then erased and
cropped like any other image and, as the last step, compressed as JPEG baseline at quality 95
(`YBR_FULL`, with `LossyImageCompression` set) by libjpeg-turbo's WASM encoder in
`src/main/codecs/encode.ts`.

Uncompressed frames made a clip of a few megabytes several hundred megabytes. The frames were
already lossy, and a second compression at quality 95 does not visibly change them. Only
video frames are compressed this way; a lossless original is never recompressed. A test runs
the anonymiser again on such a file and checks that it changes nothing.

Formats the app cannot decode are refused.

## Images that cannot be changed

Erasing, cropping and splitting assume 8-bit or 16-bit samples, with the colour values of each
pixel stored together. For other layouts (32-bit samples, 1-bit segmentations, `YBR_FULL_422`
and other subsampled colour), the code would not fail but would write the erased area in the
wrong place. The app therefore refuses such an image if it needs any of these changes: the
file is counted among the files that could not be anonymised and is not uploaded. If it needs
no change, it is uploaded as it is.

## Warnings

Some fields pass the whitelist because they describe the images, but they are free text, and
an export can put anything in them, for example in `SeriesDescription`. The app collects
these fields and shows them on the case form before upload, with the number of images that
contain each one.
