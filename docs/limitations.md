# Known limitations

The app is alpha. These are the things it does not do, written down so nobody has to
discover them mid-upload.

## Burnt-in text is not detected

Nothing looks for it. The anonymiser works on tags, so finding text in the pixels is your
job: review the images before uploading and blank anything identifying with
[Open for review](/guide/review) — that is why the app shows previews at all.

The [dialog before anonymisation](/guide/check) tracks only what you *opened*, which is a
proxy for having looked and no more than that. It cannot tell a blank corner from an unread
one, and it will never report a selection as clean.

Detecting text would mean either an OCR pass or a cheaper heuristic — a saturated,
high-gradient region identical on every frame is almost always an overlay — and both need
decoded pixels, which is the same blocker as below.

## RLE is the one format that is not decoded

JPEG, lossless JPEG, JPEG-LS, JPEG 2000 and HTJ2K all decode, through the standalone
`@cornerstonejs/codec-*` WASM builds — not `@cornerstonejs/dicom-image-loader`, which drags
in `@cornerstonejs/core`. Those series preview, scrub, window, erase and split like any
other. **RLE does not**: it shows the reason in place of the image, and an RLE cine cannot be
uploaded at all.

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

## A cine in a format with no decoder cannot be uploaded

A multiframe object keeps its frames as fragments when it is compressed, so they are decoded
before they are sent one at a time. Sending the file whole is not an answer: Radiopaedia does
not expand multiframe objects, and a run of dozens would be published as its first frame.

Which leaves RLE. Such a run is **named in the picker** — the card carries the codec, cannot
be ticked, and the count of stacks in that state sits beside the selection count — rather
than being discovered during anonymisation, where the failure is per file and used to take
the whole series out of the case behind "N file(s) could not be anonymised". Exporting the
run uncompressed from the PACS is the way to publish it.

## Multiframe dynamic series are not split into phases

The per-frame functional groups that carry the time axis are not unpacked yet.

## system_id is accepted but never applied

Server-side, and not only here. [The investigation](/notes/system-id-not-applied).
