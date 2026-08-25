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

## Compressed images can be reviewed, but not erased

JPEG, lossless JPEG, JPEG-LS, JPEG 2000 and HTJ2K all decode, through the standalone
`@cornerstonejs/codec-*` WASM builds — not `@cornerstonejs/dicom-image-loader`, which drags
in `@cornerstonejs/core`. A compressed series previews, scrubs and windows like any other.

**RLE is not decoded yet** and still shows the reason in place of the image.

What is missing is writing back. A mask is painted into the stored samples, and on a
compressed image those samples are a bitstream — painting into it corrupts the image rather
than redacting it. So the **eraser is withheld** on a compressed image and the anonymiser
refuses a mask on one, instead of producing a file that looks redacted and is not. This
bites hardest on ultrasound, where JPEG is common and burnt-in banners are the norm: until
the app can write those files back out uncompressed, blank them in another tool before
importing.

Windowing is unaffected — it is written to `WindowCenter` / `WindowWidth` and never touches
the pixels.

## A compressed multiframe run does not upload at all

Frames are split by indexing the pixel data at a length computed from the geometry, which
only describes uncompressed samples, so a JPEG or RLE cine — an XA run, an ultrasound loop —
cannot be cut into frames at all.

It is said in the picker rather than discovered later: the card names the codec, cannot be
ticked, and the count of stacks in that state sits next to the selection count. Until the
codecs land, exporting the run uncompressed from the PACS is the way to publish it.

Decoding is no longer the obstacle — the frames of a compressed cine can be read. Writing
them back out as separate uncompressed instances is, and that is the same missing half as
the eraser above.

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
