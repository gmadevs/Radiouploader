# Erase, crop and set contrast

**Open for review** on any stack shows it full size with a scrubber through every image.
The wheel and the trackpad move through the stack as well, and so do the left and right
arrow keys — the slider is for jumping across a series, not for reading through one.

![The ultrasound, banner and all](/shots/04-viewer.png)

Three of the four things that can be changed here belong to the **stack** rather than to the
image on screen — burnt-in text sits in the same corner of every frame of an ultrasound or a
reconstruction, the margins are the same margins on all of them, and a window that suits one
slice suits the rest. The fourth is about the one image you are looking at.

## Drop this image

**Drop image**, beside the image number, leaves that one image out of the upload and changes
nothing else about the series. It is for the image a series can be missing: the one that
moved, the duplicate a reconstruction wrote twice, the slice that caught the table edge.

A dropped image is tagged *dropped* while you are on it, the button becomes **Keep image**,
and the count beside it says how many have gone. **Keep all** puts every one back. Nothing is
decided until you anonymise, and the card in the picker says `N of M images` so the loss is
visible from outside the viewer as well.

This is not [trimming](/guide/choose#trimming). A trim is a range and takes the dead ends of
a series; a drop takes one image out of the middle and leaves its neighbours where they are.
Use whichever describes what is actually wrong.

::: warning A hole is a hole
The last image of a series cannot be dropped — a series that uploads nothing would simply be
missing from the case, and the tick box in the picker is the control that says that out loud.

And a stack with an image dropped out of the middle usually **cannot be reformatted**: the
volume behind [Reformat](/guide/reformat) measures the gap between images and refuses a stack
whose gaps are uneven, rather than stretching the pictures across the hole. Reformat first,
then drop, if you want both.
:::

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

A box drawn in the wrong place can be put right rather than redrawn. The one you have just
drawn is already selected — its corners are there to be dragged and <kbd>Delete</kbd> takes
it away without hunting for it again — and any other can be selected by clicking it: drag it
to move it, drag a corner to resize it, <kbd>Delete</kbd> to remove that one. It stays inside the image and never shrinks to nothing — a redaction that quietly got
smaller would uncover what it was put there to hide. <kbd>Esc</kbd> lets go of the box
first, and only closes the window once nothing is selected.

::: tip Undo is not destructive
**Undo box** and **Clear boxes** are always available up to the moment you anonymise. The
original files are never modified — anonymisation writes new ones.
:::

## Crop

Pick **Crop** and drag out the rectangle to **keep**. Everything outside it comes off every
image of the stack.

![The sector kept and the margins cut away](/shots/10-crop.png)

The image stays on screen whole, with what is about to go shaded rather than hidden — a cut
you cannot see past is one you cannot aim. Drag inside the rectangle to move it, a corner to
resize it, and **Keep whole image** puts it back.

One rectangle serves the whole stack, and not to keep things simple: [Reformat](/guide/reformat)
builds a box out of the images, and images cut to different sizes do not make one.

::: tip Cropping is not a second way to redact
A blanked box is already blank pixels rather than an overlay, so nothing survives an erase
that a crop would have removed. Crop for the reason you would crop a photograph: the black
margins around an ultrasound sector, the empty air around a reconstruction, the strip a
banner was sitting in.
:::

What makes it more than a mask with the pixels thrown away is the geometry, and the app
moves it for you. `Rows` and `Columns` are rewritten, and so is `ImagePositionPatient` —
the corner the image starts at, walked across and down in **patient millimetres**. Without
that a volume built from the cropped images would sit where the discarded corner used to be.
A file that does not say which way it is pointing has the position **removed** rather than
left describing a grid its pixels are no longer on; the order the images upload in does not
depend on it.

The pixels are the same size after a crop as before, so `PixelSpacing` is untouched and a
measurement made on Radiopaedia still means what it says.

## Contrast

Pick **Contrast** and drag on the image: right widens the window, down raises its centre,
the same directions every DICOM viewer uses. The readout at the bottom right says where it
has got to, as **W** width **/ L** level.

### The CT presets

A CT viewer carries a row of named windows under the scrubber — Brain, Subdural, Stroke,
Temporal bone, Lung, Soft tissue, Liver, Bone — and one click sets the window to it. The
button stays lit while the picture is the one it names, and goes out as soon as the window
is dragged off it, so what the row says is always what is on screen.

They are the conventional widths and centres, the ones on a reporting workstation's own
toolbar, and each is a starting point rather than an answer: a nodule against pleura and an
early infarct both want something narrower than the preset that gets you to them.

The row appears on **CT and nothing else**, and that is not an oversight. These numbers are
Hounsfield units, an absolute scale that only CT states its pixels on; on MR the stored
values are the scanner's own, so "80 / 40" would name a different picture on every study and
a fixed list would be a list of wrong answers. Drag there, as before.

The same row sits in the [reformat dialog](/guide/reformat), where it matters for a second
reason: a MIP through a slab is read at a wider window than the slices it was built from.

The chosen window is written to `WindowCenter` / `WindowWidth` (0028,1050 / 0028,1051), and
any `WindowCenterWidthExplanation` or `VOILUTSequence` that would contradict it is dropped.
**The pixels themselves are untouched**, so the upload keeps its original values and a
reader on Radiopaedia can still re-window it.

## Erasing or cropping a compressed image

Both work, and both change the file that gets uploaded. Nothing can be painted into or cut
out of a bitstream, so a JPEG, JPEG-LS, JPEG 2000, HTJ2K or lossless-JPEG image with a box
on it, or a rectangle kept out of it, is decoded and written out as plain uncompressed
samples. Expect it to be several times the size of the original — the test pattern in the
repository goes from 49 kB to 768 kB. Cropping claws some of that back, but not the
compression.

An image with no box on it and no crop is uploaded exactly as it arrived. A crop dragged out
to the edges counts as no crop: it is dropped rather than spent decoding a file to produce
the bytes it already had.

Every still-image compression DICOM has is read here, RLE included. Only **video** —
MPEG-2, MPEG-4, HEVC — is left out: it does not decode, so it cannot be previewed, erased or
cropped. Export those as still frames before importing.
