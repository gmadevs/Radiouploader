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
