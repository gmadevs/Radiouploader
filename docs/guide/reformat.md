# Reformat, MIP, MinIP and mean

**Reformat** on a stack of three images or more cuts it another way, and flattens slabs of
it into projections.

![A coronal MIP of the chest CT](/shots/09-reformat.png)

Three panes are navigators — axial, coronal and sagittal — and the fourth is the image that
will actually be added. **Drag the middle of the crosshair** in any navigator and the other
two follow it: the question this view exists to answer is not what the reformat looks like
but where it is being taken from. The wheel steps through whichever pane it is over.

**Drag an arm of the crosshair** and the axes turn. All three planes turn together, because
they are one set of axes and not three separate views — that is what a crosshair at a
workstation does, and it is how you line a plane up with something that is not lying square
in the scanner. The pointer says which of the two it is about to do: a cross moves, a hand
turns. **Straighten** puts the axes back on the acquisition's own.

Once they are turned, the series is called **Oblique** — in the dialog and in its own
description — because it is no longer the coronal or the sagittal that a reader means.

The result pane is the one you window: **drag on it**, right to widen and down to raise the
centre. All four panes share that window, since they are four views of one volume.

The result is added to the case as its own series, beside the one it came from. It goes
through anonymisation and upload like anything else, because that is what it is: real DICOM
instances, written to the session's temp directory and removed with it.

## The controls

| | |
|---|---|
| **Axial / Coronal / Sagittal** | which way to cut |
| **Slice / MIP / MinIP / Mean** | what a slab collapses to |
| **Through** | where the slab sits — the crosshair moves this too |
| **Slab** | how thick it is, in millimetres |
| **Every** | how far apart the images that come out are |
| **Level / Window** | the contrast, which is also a drag on the image |

**MIP** takes the brightest sample through the slab — vessels, contrast, bone. **MinIP**
takes the darkest — airways, emphysema, fat. **Mean** averages it, which quietens noise at
the cost of detail. **Slice** is one plane and ignores the slab.

The count beside the button says how many images the plan makes before you commit to it.
Twenty-five coronals is a series a reader will scroll through; two hundred is a series they
will scroll past.

## The contrast

Drag on the result pane, or use the **Level** and **Window** sliders — right widens, down raises
the centre, the same as everywhere else. Whatever is on screen when you press **Add to the
case** is written to the derived images.

The window it opens with is the file's own `WindowCenter` / `WindowWidth`, but **only if
that window shows the data**. Some series carry one that describes something else: a 3D
FLAIR came through with a window sitting far below its own values, so every voxel of brain
was above the top of it and the reformat was a white cut-out of a head on black. When the
stated window covers less than a fifth of what the volume actually spans, the volume's own
first-to-ninety-ninth percentile is used instead.

A window you chose in [Open for review](/guide/review) is a decision rather than a
suggestion, and is used as it stands.

The window is worked out once, when the volume is built, and then stays put: recomputing it
per image would make every step through the stack a different picture.

## What the planes mean

Before you turn anything, they are the **acquisition's own axes**, not the patient's. On an
axial study coronal and sagittal mean what they say. On an oblique acquisition — a tilted
gantry, an angled shoulder — they mean "across the acquisition", which may be nothing a
reader would call coronal. The dialog shows the result before it can be added for exactly
this reason, and turning the axes is how you fix it.

Images are built from the last slice down, so the end of the stack ends up at the top of a
coronal or sagittal image. On a study acquired feet-first that is upside down; look before
you add.

## The resolution is not a choice

The result is square-pixelled at the finest spacing the volume has in plane — 0.7 mm pixels
for a 0.7 mm CT, whatever the gap between its slices was. Anything coarser would throw away
data that is already in memory and anything finer would invent it, so it is not offered.

Between the slices it interpolates. A coronal of a 5 mm study is a real reformat of 5 mm
data and looks like one; it does not become a 0.7 mm acquisition by being resampled.

A projection is taken at the **image planes inside the slab**, not at even steps along it. A
maximum of interpolated samples is not a maximum of the data — a step straddling the
brightest voxel returns the average of it and its neighbour, and a vessel comes out half as
bright as it is.

A turned plane has no image planes to read, so it is stepped at half the finest spacing
instead: as close to the same thing as sampling can get. A turned image is also **wider than
a straight one**, because a tilted direction crosses the volume diagonally and the picture
has to be big enough to hold what it crosses.

## When it refuses

A volume needs geometry that holds, and the dialog says which part did not:

- **fewer than three images** — there is nothing to cut through
- **gaps that vary** by more than a tenth — a reformat of them would be stretched where the
  images are missing
- **images of different sizes**, or in different units
- **colour**, which has no single value to project
- **no pixel spacing**, which leaves the result with no scale
- **too large** — a volume over 512 MB is refused rather than allocated

## What it carries over

Areas you blanked on the parent are blanked in the volume **before** it is built, so a
banner erased on the axial images cannot come back through a coronal of them. The window
you chose comes with it. Rescale is preserved exactly: projections are taken on the stored
values, and maximum, minimum and mean all commute with the linear rescale, so a MIP of a CT
is still in Hounsfield units.

The derived series carries `ImageType` `DERIVED\SECONDARY\MIP` (or `MINIP`, `MEAN`, `MPR`),
its own series UID, and the geometry of the plane it was cut on — so a reader, or this app
on a second import, can tell what it is and which way up it goes.
