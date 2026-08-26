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

`scripts/shots.mjs` stubs exactly three things at the IPC layer — sign-in, the folder
picker, and the upload — so **the app itself carries no test hook**. Everything between them
is the real wiring: real ingest, real preview decoding, real anonymisation with real
warnings.

Buttons are clicked through the DOM. The eraser drag is sent with
`webContents.sendInputEvent` instead, because the viewer takes a pointer capture and a
synthetic `PointerEvent` has no pointer to capture — the drag would fall apart on the first
move.

The script fails loudly if a button it expects is missing or disabled, which makes it a
second smoke test: if the wizard breaks, `npm run shots` stops producing pictures of it.
