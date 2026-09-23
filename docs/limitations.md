# Known limitations

These are the things the app does not do, written down so nobody has to discover them
mid-upload. Some are decisions, and the reason is given with each; the rest is work that has
not been done.

## Burnt-in text is only partly detected

The [check before anonymising](/guide/check) looks for it now, and it finds obvious banners:
bright, hard-edged marks that sit in the same place while the anatomy under them changes.
That is what a patient banner or a hospital name looks like to a computer, and it is ringed
on the thumbnail so you know where to look.

What it does **not** find: small print, text written over anatomy rather than over black,
low-contrast overlays, and anything on the images it did not read — it compares two images
per series, not all of them. It is not OCR and it does not read what it finds.

So it can only ever add a warning. **A series it says nothing about is a series nothing was
noticed in, which is not the same as a series that is clean**, and nowhere in the app will
say otherwise. Finding the text is still your job; this only makes the obvious cases harder
to walk past.

Reading the images with OCR is **not planned**. It would turn a check that appears instantly
into one that takes seconds to tens of seconds per study, and it would still not let the app
call anything clean: the text this misses — small, low contrast, over anatomy — is the text
OCR is worst at.

## Blanking a compressed image makes it bigger

Nothing can be painted into a bitstream, so an image that has to change — a mask to apply, or
frames to lift out of a cine — is decoded and written back out as **explicit VR little
endian**, with the tags that describe the pixels rewritten to match what came out of the
decoder rather than what went in.

That file is larger, and not by a little: the JPEG test pattern in this repository is 49 kB,
and 768 kB once decoded. It is the price of two things there is no other way to have — a
redaction that is really in the pixels, and a cine run that arrives as a run instead of as
its first frame.

A compressed image that needs no change is **passed through untouched**, which keeps it small
and keeps it lossless. Windowing counts as no change: it is written to `WindowCenter` /
`WindowWidth` and never touches the pixels.

## Some images cannot be blanked, cropped or split

A mask, a crop and the splitting of a multiframe run all assume a sample is one byte or two
and that a pixel's colours sit side by side. Images that break that — 32-bit samples, 1-bit
segmentations, subsampled colour such as `YBR_FULL_422` — are refused when one of the three
is asked of them, and they are left out of the upload, counted among the files that could not
be anonymised, rather than sent with a mask in the wrong place. Without a mask, a crop or
frames to lift out they go up as they are. They are rare in the studies people make cases
from.

## A DICOM video goes up as its frames, not as a video

A run some machines write as **video** — MPEG-2, MPEG-4 (H.264) or HEVC, as ultrasound and
angiography often do — is decoded into its frames and uploaded as a stack of them, like any
other cine. Radiopaedia does not expand a multiframe object, and a video in the pixel data is
not an image it shows at all; and the frames are what a mask can be painted on, which a clip
with the patient's name across the top needs.

What that costs:

- **Size.** The frames go up uncompressed, where the video held differences between them: a
  few megabytes of clip can be hundreds of megabytes of frames, on the upload and on the disk
  while the session is open — a 300-frame clip at 1024×768 is about 700 MB decoded.
- **Time to open.** A video cannot be read a frame at a time, so the first look at one
  decodes all of it; a few seconds for a long clip, and every frame after that is immediate.
- **Only the pictures.** An audio track, a second view of a stereo clip and the frame rate
  are not carried — a stack has none of them.
- **A frame count is a claim.** When the stream holds fewer frames than its header states,
  the ones it holds go up and the rest are named as not uploaded.

The decoder is [ffmpeg](/develop/packaging#the-video-decoder), which the app carries; the
About panel names it, and says "no video decoder" on a build that has none that runs.

Only compressions nobody writes images in any more are still refused — JPIP, whose pixels
live on a server — and such a run is **named in the picker**: the card carries the codec,
cannot be ticked, and the count of stacks in that state sits beside the selection count.

## A reformat is flat

[Reformat](/guide/reformat) opens on the patient's own planes, worked out from
`ImageOrientationPatient`, and the crosshair turns them from there. What there is no way to
do is **curve** one: a reformat along the length of a vessel or a nerve root needs a path
drawn in the image and a different piece of machinery behind it. That is not planned — a
plain MPR is what a case needs to show a finding in another plane.

Files that do not carry `ImageOrientationPatient` fall back to the acquisition's own axes,
which on anything but an axial study is a guess. The dialog says when it has had to.

## An enhanced object cannot be reformatted

A dynamic enhanced MR or CT is [split by its own frames](/internals/splitting) now, so its
phases arrive as separate stacks. What [Reformat](/guide/reformat) still cannot do is build a
volume out of one: an enhanced object states how big its pixels are inside a functional
group rather than at the top level, and the preview reads only the top level. The dialog
says so — *"These images do not say how big a pixel is"* — rather than reformatting on a
guess.
