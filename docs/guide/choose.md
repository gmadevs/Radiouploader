# Choose what to upload

![The review step](/shots/02-review.png)

Every study is listed oldest first, each series as a row, each **stack** as a card with a
scrubbable preview. A stack is a group of images that belong together as one thing to
upload — usually the whole series, but a series that holds more than one acquisition is
split into several.

The example above shows both cases: the CT is one stack of 12 images, while the diffusion
series arrived as one series and was split by b-value into `b=0` and `b=1000`, badged
**Split by b-value**.

Scrolling with the wheel or the trackpad over a card looks through its images. The page
stays where it is while the pointer is over one, so a card can be scrubbed without the grid
sliding out from under it.

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
