# Screenshots

Every screenshot on this site is regenerated from the running app with one command:

```bash
npm run shots
```

It builds, boots the real app, drives it through the whole wizard and writes ten PNGs into
`docs/public/shots/`.

## Why not take them by hand

Hand-cropped screenshots go stale silently. The UI moves, the picture does not, and nobody
notices until a reader follows a page describing a button that no longer exists. A
screenshot you can regenerate is a screenshot that can be *required* to be current.

## Why a synthetic study

The obvious source of realistic images is a real study, and it is exactly the thing that
must never enter a public repository — this app exists because studies carry patient data.

So `scripts/sampleStudy.mjs` draws one from scratch, writing explicit VR little endian by
hand:

- a **CT chest phantom**, 12 slices, with a nodule that grows between two studies six months
  apart, so the follow-up has something to follow
- a **diffusion pair**, b=0 and b=1000, tagged with `(0018,9087)` so the app splits it the
  way it would split a real one
- an **ultrasound** with `DEMO^PATIENT / ID 000000 / GENERAL HOSPITAL` burnt into the
  pixels, and `BurnedInAnnotation` (0028,0301) set to `YES`

The banner is the whole reason the sample exists. Blanking burnt-in text is the feature
hardest to explain and impossible to show on an empty square, and no real image could stand
in for it here.

The text is deliberately absurd so nobody can mistake the sample for a patient. Pixel noise
comes from a seeded generator, so regenerating produces identical files rather than churn.

## How the driving works

`scripts/shots.mjs` stubs exactly four things at the IPC layer — sign-in, the folder
picker, the upload, and the update check — so **the app itself carries no test hook**. The
update check is stubbed for the same reason as the rest: whether a newer release exists on
GitHub is not a property of this build, and a banner appearing the day after a release would
rewrite these PNGs with nothing in the app changed. Everything between them
is the real wiring: real ingest, real preview decoding, real anonymisation with real
warnings.

Buttons are clicked through the DOM. The eraser drag is sent with
`webContents.sendInputEvent` instead, because the viewer takes a pointer capture and a
synthetic `PointerEvent` has no pointer to capture — the drag would fall apart on the first
move.

The script fails loudly if a button it expects is missing or disabled, which makes it a
second smoke test: if the wizard breaks, `npm run shots` stops producing pictures of it.

## Waiting for the screen, not the clock

**A capture waits until the window shows the step it is named after.** The script used to
wait a fixed time after each click, and on a busy Mac that came up short: one run wrote six
PNGs that each showed the screen of the step before, and still reported success. Now every
capture waits for three things before it is written:

- the page to be in the state the shot is of — the review step's series listed, the MIP
  button switched on, the case form filled in, the confirmation link on screen;
- the picture to differ from the last PNG written;
- the picture to hold still across three captures in a row, which a pane still drawing or a
  thumbnail still decoding does not.

A shot that never gets there within 30 seconds is not written, and the run fails naming it.
Before a drag, the script also waits for the tool it needs to be the one switched on, since
a drag that lands before the tool has changed does the old tool's work. A text caret is
hidden along with the scrollbars, because a blinking one would never hold still.

It was checked the way it went wrong: two runs, and a third with every CPU core kept busy,
each byte-identical to the committed PNGs.
