# Build and run

```bash
npm install
npm run dev        # hot-reloading Electron
npm test           # unit tests plus anonymiser and decoder integration tests
npm run typecheck
npm run smoke      # boots the built app, fails on console errors, writes smoke.png
```

`npm run smoke` refuses to run when `out/` is older than `src/`. A failed build leaves the
previous bundle in place, and testing that instead reports success for code that does not
compile.

## The tests on CI

`.github/workflows/test.yml` type-checks both projects and runs the suite on every push and
every pull request, on Linux alone — it is the badge on the README, and it exists because the
installer workflow runs the same tests only on a tag or by hand, which is late to hear that a
decoder regressed. The run's summary says how many tests passed, so a green tick can be
read without opening the log.

`vitest.config.ts` collects `src/**/*.test.ts` only. There is no React testing library here,
so anything worth testing in the UI is written as a plain module beside the component and
tested there — `burnIn.ts` beside `BurnInCheck.tsx`, `selection.ts` in `src/shared/` for the
rule that decides which images of a stack are really uploaded.

## Layout

```
src/main/ingest/    scan folders and zips, read metadata, group into stacks
src/main/anon/      the anonymiser, in a worker thread
src/main/api/       OAuth, case and study creation, S3 upload
src/shared/         types, the DICOM decoder, Radiopaedia's taxonomy
src/renderer/       the wizard UI
```

See [architecture](/internals/architecture) for why the boundary between main and renderer
is where it is.

## Testing against real files

The fixtures under `src/main/anon/__fixtures__/` come from the anonymiser's own repository
and are tiny — a few uniformly bright pixels each, enough to prove the anonymiser round
trips but useless for looking at.

For anything visual, generate the sample study instead:

```bash
npm run sample
```

That writes 49 files to `.sample-study/` (gitignored): a CT phantom across two studies six
months apart, a diffusion pair, and an ultrasound with a banner burnt into its pixels. It is
what the [screenshots](/develop/screenshots) are taken on.
