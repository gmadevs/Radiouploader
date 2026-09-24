# Known limitations

This page lists what the app does not do. Where a limitation is a decision, the reason is
given.

## Burnt-in text detection is partial

The [check before anonymising](/guide/check) marks areas that look like burnt-in text: very
bright or very dark marks with sharp edges that stay in the same place while the anatomy
changes. This finds patient banners and hospital names on a dark background.

It does not find small print, text over anatomy, low-contrast text, or text on images it did
not examine. It examines two images per series. It does not read the text it finds.

The check can only add warnings. If it reports nothing for a series, nothing was noticed in
the two images it examined; the series can still contain text. The app never reports a
series as free of burnt-in text. You need to check every image yourself.

Text recognition (OCR) is not planned. It would make the check take seconds to tens of
seconds per study, and it is least reliable on the text this check misses: small text,
low-contrast text and text over anatomy.

## Erasing or cropping a compressed image makes the file larger

Pixels cannot be changed inside compressed image data. When a compressed image has to change,
because of an erased area, a crop, or a multiframe run being split into single images, the
app decodes it and writes it uncompressed (explicit VR little endian). The tags that describe
the pixels are updated to match the decoded data.

The uncompressed file is larger: the JPEG test image in the repository grows from 49 kB to
768 kB. A compressed image that does not need to change is uploaded unchanged. Setting the
window does not change the pixels, so it does not count as a change.

DICOM video is an exception: its frames are uploaded as JPEG (see below).

## Some images cannot be erased, cropped or split

Erasing, cropping and splitting multiframe runs work on images with 8-bit or 16-bit samples
and with the colour values of each pixel stored together. The app refuses to erase, crop or
split images stored in other ways, such as 32-bit samples, 1-bit segmentations or subsampled
colour (`YBR_FULL_422`). Such files are counted among the files that could not be anonymised
and are not uploaded. If they need none of these changes, they are uploaded as they are.
These formats are rare in clinical studies.

## DICOM video is uploaded as frames

A run stored as video (MPEG-2, H.264 or HEVC), as ultrasound and angiography systems often
store them, is decoded into frames and uploaded as a series of single images. This is needed
because Radiopaedia does not display video in DICOM files, and because erasing burnt-in text
requires individual frames.

- **Size.** Each frame is uploaded as a JPEG at quality 95, after erasing and cropping. A
  300-frame clip at 1024×768 is about 28 MB, compared with about 700 MB uncompressed. This is
  a second lossy compression of frames that were already lossy; the difference is not
  visible. Images that were lossless are never compressed this way. While the session is
  open, the decoded clip is stored uncompressed on disk: about 700 MB for the same clip.
- **Time.** Compressing the frames takes most of the anonymisation time: about 18 seconds for
  300 frames. The first time you open a video, the whole video is decoded, which takes a few
  seconds for a long clip; after that, frames appear immediately.
- **Only the images.** Audio, the second view of a stereo clip and the frame rate are not
  uploaded.
- **Frame count.** If the video contains fewer frames than its header states, the frames it
  contains are uploaded and the missing ones are reported.

Video is decoded with [ffmpeg](/develop/packaging#the-video-decoder), which is included with
the app. The **Info** panel shows the ffmpeg version, or "no video decoder" if the build has
none that works.

## Formats the app cannot read

The app cannot decode a few rare transfer syntaxes, such as JPIP (where the pixel data is on
a server) and deflated DICOM. A multiframe run in such a format cannot be selected: its card
names the format, and the number of such stacks is shown next to the number of selected
stacks. A single image in such a format is uploaded unchanged, but it cannot be erased or
cropped.

## No curved reformats

[Reformat](/guide/reformat) creates images in the patient's axial, coronal and sagittal
planes, and in oblique planes by rotating the crosshair. It cannot create a curved reformat
along a vessel or a nerve. Curved reformats are not planned, because a case usually needs
only a standard reformat to show a finding in another plane.

If the files do not contain `ImageOrientationPatient`, the app uses the planes of the
acquisition, which are correct only for an axial acquisition. The dialog shows a note when
this happens.

## Enhanced MR and CT cannot be reformatted

A dynamic enhanced MR or CT file is [split into its phases](/internals/splitting), and each
phase can be uploaded. [Reformat](/guide/reformat) cannot build a volume from it, because an
enhanced file stores the pixel size per frame, which the app does not read for reformatting.
The dialog shows *"These images do not say how big a pixel is, so a reformat would have no
scale"*.
