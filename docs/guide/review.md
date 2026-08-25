# Erase and set contrast

**Open for review** on any stack shows it full size with a scrubber through every image.
The wheel and the trackpad move through the stack as well, and so do the left and right
arrow keys — the slider is for jumping across a series, not for reading through one.

![The ultrasound, banner and all](/shots/04-viewer.png)

Two things can be changed here, and both belong to the **stack** rather than to the image
on screen — burnt-in text sits in the same corner of every frame of an ultrasound or a
reconstruction, and a window that suits one slice suits the rest.

## Erase

Drag a rectangle over anything that should not be uploaded: patient banners on ultrasound,
annotations on reconstructions, scale text.

![The banner blanked](/shots/05-erase.png)

The rectangle is drawn on **every image of the stack**, and it is painted into the pixel
data during anonymisation — what is uploaded really is blank, not covered by an overlay.

What "blank" means is worked out per image: black is the dark end of the window in force,
taken back through the rescale, so a redaction stays black on a CT (where 0 is soft tissue)
and on MONOCHROME1 (where 0 is white); on YBR colour it is luminance 0 with the chroma
channels centred.

A box drawn in the wrong place can be put right rather than redrawn: click it to select it,
drag it to move it, drag a corner to resize it, and press <kbd>Delete</kbd> to remove that
one. It stays inside the image and never shrinks to nothing — a redaction that quietly got
smaller would uncover what it was put there to hide. <kbd>Esc</kbd> lets go of the box
first, and only closes the window once nothing is selected.

::: tip Undo is not destructive
**Undo box** and **Clear boxes** are always available up to the moment you anonymise. The
original files are never modified — anonymisation writes new ones.
:::

## Contrast

Drag on the image, or use the **Level** and **Window** sliders. Dragging right widens the
window and dragging down raises its centre, the same directions every DICOM viewer uses.

The chosen window is written to `WindowCenter` / `WindowWidth` (0028,1050 / 0028,1051), and
any `WindowCenterWidthExplanation` or `VOILUTSequence` that would contradict it is dropped.
**The pixels themselves are untouched**, so the upload keeps its original values and a
reader on Radiopaedia can still re-window it.

## Erasing a compressed image

It works, and it changes the file that gets uploaded. Nothing can be painted into a
bitstream, so a JPEG, JPEG-LS, JPEG 2000, HTJ2K or lossless-JPEG image with a box on it is
decoded, blanked, and written out as plain uncompressed samples. Expect it to be several
times the size of the original — the test pattern in the repository goes from 49 kB to
768 kB.

An image with no box on it is uploaded exactly as it arrived.

Only **RLE** is left out: it does not decode, so it cannot be previewed and cannot be
erased. Blank one in another tool before importing.
