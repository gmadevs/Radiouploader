# Known limitations

The app is beta. These are the things it does not do, written down so nobody has to
discover them mid-upload.

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

## A DICOM video cannot be uploaded

A multiframe object keeps its frames as fragments when it is compressed, so they are decoded
before they are sent one at a time. Sending the file whole is not an answer: Radiopaedia does
not expand multiframe objects, and a run of dozens would be published as its first frame.

Every still-image compression in DICOM decodes here — JPEG, lossless JPEG, JPEG-LS,
JPEG 2000, HTJ2K and RLE. What is left is **video**: MPEG-2, MPEG-4 (H.264) and HEVC
(H.265), which some machines write an ultrasound or angiography run as. Those are a video
stream rather than a stack of pictures, and nothing here reads one.

Such a run is **named in the picker** — the card carries the codec, cannot be ticked, and
the count of stacks in that state sits beside the selection count — rather than being
discovered during anonymisation, where the failure is per file and used to take the whole
series out of the case behind "N file(s) could not be anonymised". Exporting the run as
still frames from the PACS is the way to publish it.

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
