# Screenshots

All screenshots on this site are generated from the running app with one command:

```bash
npm run shots
```

It builds the app, starts it, goes through every step of the wizard and writes ten PNG files
to `docs/public/shots/`.

## Why they are generated

Screenshots taken by hand go out of date without anyone noticing when the interface changes.
Because these can be regenerated, they can be kept current: any change to the renderer is
followed by `npm run shots` before it is committed.

## The sample study

A real study cannot be used, because the repository is public and real studies contain
patient data. `scripts/sampleStudy.mjs` therefore generates one, writing explicit VR little
endian files directly:

- a **CT chest phantom** of 12 slices, in two studies six months apart, with a nodule that
  grows between them;
- a **diffusion pair**, b=0 and b=1000, with the b-value in `(0018,9087)`, so the app splits
  it as it would a real one;
- an **ultrasound** with `DEMO^PATIENT / ID 000000 / GENERAL HOSPITAL` burnt into the
  pixels and `BurnedInAnnotation` (0028,0301) set to `YES`.

The ultrasound banner is needed to show how burnt-in text is erased. The text is clearly
fictional, so the sample cannot be mistaken for patient data. The pixel noise comes from a
seeded generator, so regenerating the study produces identical files.

## How the app is driven

`scripts/shots.mjs` replaces five things at the IPC layer: sign-in (`auth:status` and
`api:currentUser`), the list of draft cases (`api:draftCases`), the folder picker, the upload
and the update check. The app itself has no
test code. The update check is replaced because its result depends on GitHub, not on the
build: without the stub, a new release would change the screenshots the next day. Everything
else is the real app: import, preview decoding and anonymisation.

Buttons are clicked through the DOM. The drag that draws an erase box is sent with
`webContents.sendInputEvent`, because the viewer captures the pointer, and a synthetic
`PointerEvent` has no pointer to capture.

The script fails if a button it needs is missing or disabled, so it also works as a test of
the whole wizard.

## Screenshots that do not depend on the machine

Two runs of `npm run shots` must produce identical files. Two things used to make them differ,
both caused by a connected mouse:

- macOS then shows scrollbars permanently, which takes 15 pixels of width and moves anything
  right-aligned or centred. The script hides scrollbars with injected CSS after the page
  loads. It also hides the text cursor, because a blinking cursor changes between captures.
- the pointer can rest over a stack card, which shows the card's hover controls. The script
  sends a `mouseLeave` event before each capture.

If a run changes PNG files although the app has not changed, run it twice more and check
that those two runs are identical before looking for the cause in your change.

## Waiting for each screen

Each capture waits until the window shows the step it is named after, not for a fixed time.
A fixed wait once came up short on a busy Mac, and a run wrote six PNGs that each showed the
previous step, while reporting success. Before a capture is written, the script waits for:

- the page to be in the expected state, for example the series listed on the review step, the
  MIP button selected, the case form filled in, or the confirmation link shown;
- the image to differ from the last PNG written;
- three consecutive captures to be identical, which is not the case while a pane is still
  drawing or a thumbnail is still decoding.

If a capture does not reach that state within 30 seconds, it is not written and the run fails
with its name. Before a drag, the script also waits until the tool it needs is selected.

This was tested with two normal runs and one with every CPU core busy; all three produced
files identical to the committed PNGs.
