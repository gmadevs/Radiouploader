# Choose what to upload

![The review step](/shots/02-review.png)

Every study is listed oldest first as a **strip that scrolls sideways**, each series a group
within it, each **stack** a card with a scrubbable preview. A stack is a group of images
that belong together as one thing to upload — usually the whole series, but a series that
holds more than one acquisition is split into several.

The strip is sideways because a study of thirty series is a row to run along rather than a
page to scroll down, and because it keeps the series next to each other, which is where they
can be compared. Groups keep their own heading, so **All**, **None** and **Keep one phase**
stay with the series they act on.

The example above shows both cases: the CT is one stack of 12 images, while the diffusion
series arrived as one series and was split by b-value into `b=0` and `b=1000`, badged
**Split by b-value**.

Scrolling with the wheel or the trackpad over a card looks through its images. The page
stays where it is while the pointer is over one, so a card can be scrubbed without the strip
sliding out from under it.

## Putting the series in order

The arrows in a series heading move it past its neighbour, left or right along the strip.
Series arrive in the order the scanner numbered them, which is the order they were acquired
in and not always the order they are worth reading in — the localiser first and the sequence
that shows the finding last.

**This is not decoration.** Radiopaedia's series endpoint has no position of its own, so the
order the app posts them in is the order the case ends up with. What you leave the strip in
is what a reader scrolls through.

Studies have no arrows: they are ordered by date, oldest first, because the case is a
timeline and the [interval between them](/guide/upload) is what carries the meaning.

## What a card says

Under the preview, in the order that decides whether a series is worth uploading:

- **How many images**, and how many are left after a trim.
- **The plane and the reach** — `Axial · 55 / 5 mm`: the plane it was cut on named in the
  patient's own axes, then how far the stack runs and how far apart its images are. The
  spacing is the middle gap rather than the average one, so a stack with a slice missing
  reports a spacing that a pair of its images actually has. A cine has none of this: its
  frames are all in one place.
- **What it weighs**, and what one image of it weighs. A stack that took only some of the
  frames of a file — a phase out of an enhanced object, a b-value out of a run — is charged
  that share of it, so the parts of a split file add up to the file rather than to a copy of
  it each.
- **The compression**, and only when there is one. Most exports are plain samples, and a
  badge saying so on every card would cost a line to tell you nothing. A codec named here is
  the series that will grow if you [blank or crop](/guide/review) it.

None of it is written over the image. The top corners of a thumbnail are where patient
banners sit, and this is the app that must not cover one up.

## Defaults you can leave alone

The common case is meant to need no clicking:

- phase, real and imaginary maps are **off**
- the highest b-value and the ADC map are **on**
- **every** time point of a dynamic series stays on

Dropping phases is a deliberate act rather than a silent default, which is why a multiphase
series gets a **Keep one phase** button instead of arriving pre-trimmed.

With a large export the fastest route is the opposite: **Deselect all**, then tick back the
few series that matter.

## Trimming

![The trim controls](/shots/03-trim.png)

**Trim** chooses the first and last image to keep, so the localiser slices before the
anatomy and the tail after it can go without deselecting the stack. Moving either handle
jumps the preview to that image, and anything outside the range is dimmed and tagged *not
uploaded*.

Trimmed images are never decoded, written out or uploaded — trimming is not a display
setting.

## What the preview will and will not show

The preview decodes every still-image compression DICOM has — JPEG, lossless JPEG, JPEG-LS,
JPEG 2000, HTJ2K and RLE — as well as uncompressed DICOM. Anything it cannot read shows the
reason in place of the image rather than being mis-rendered.

A compressed image can be reviewed, windowed, erased and cropped like any other. It is sent
untouched unless something has to change its pixels — a blanked area, a crop, or a cine run
being split — in which case it is decoded and uploaded uncompressed, which makes a larger
file. See [known limitations](/limitations).

A cine written as **video** — MPEG-2, MPEG-4 or HEVC — is the one case that cannot be uploaded at all,
because its frames cannot be read to be split. That card says so in place of the tick, and
the count beside *selected* tells you how many stacks are in that state, so a run cannot go
missing from the case without having been mentioned.
