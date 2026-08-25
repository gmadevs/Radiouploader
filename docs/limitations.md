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

## Previews decode uncompressed DICOM only

Explicit and implicit VR little endian and explicit VR big endian all render; JPEG,
JPEG-LS, JPEG 2000, HTJ2K and RLE are named in the placeholder instead of being
mis-rendered.

A single-frame compressed object still **uploads** — it is anonymised and sent untouched,
only the preview is blank. Adding them means pulling in the standalone
`@cornerstonejs/codec-*` WASM packages, which unlike `@cornerstonejs/dicom-image-loader` do
not depend on `@cornerstonejs/core`.

Erasing burnt-in text needs the same decoder, so it is unavailable on those images too —
which matters most for ultrasound, where JPEG is common and burnt-in banners are the norm.

## A compressed multiframe run does not upload at all

Frames are split by indexing the pixel data at a length computed from the geometry, which
only describes uncompressed samples, so a JPEG or RLE cine — an XA run, an ultrasound loop —
cannot be cut into frames at all.

It is said in the picker rather than discovered later: the card names the codec, cannot be
ticked, and the count of stacks in that state sits next to the selection count. Until the
codecs land, exporting the run uncompressed from the PACS is the way to publish it.

The anonymiser refuses it too, and now says which codec. It used to be caught only by a
bound check on the frame offset, which worked by arithmetic rather than by design — a
lossless codec that expanded a noisy image past its raw size would have passed the check and
handed back arbitrary pieces of the bitstream as frames. And because that failure is per
file, every frame of the run was lost at once and the series disappeared from the case
behind "N file(s) could not be anonymised".

## Multiframe dynamic series are not split into phases

The per-frame functional groups that carry the time axis are not unpacked yet.

## system_id is accepted but never applied

Server-side, and not only here. [The investigation](/notes/system-id-not-applied).
