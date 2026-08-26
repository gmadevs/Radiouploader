<p align="center">
  <img src="resources/icon.png" alt="" width="128" height="128">
</p>

# Radiouploader

[![Licence: AGPL-3.0-only](https://img.shields.io/badge/licence-AGPL--3.0--only-blue?style=flat-square)](LICENSE)
[![Platform: macOS, Linux, Windows](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square)](https://gmadevs.github.io/Radiouploader/develop/packaging)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange?style=flat-square)](https://gmadevs.github.io/Radiouploader/limitations)
[![Docs](https://img.shields.io/badge/docs-gmadevs.github.io-4c9aff?style=flat-square)](https://gmadevs.github.io/Radiouploader/)
[![Build](https://github.com/gmadevs/Radiouploader/actions/workflows/build.yml/badge.svg)](https://github.com/gmadevs/Radiouploader/actions/workflows/build.yml)
[![Electron](https://img.shields.io/badge/Electron-43-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)

A desktop app for preparing and uploading cases to [Radiopaedia.org](https://radiopaedia.org).

Point it at a folder, a zip or a handful of DICOM files. It reads the study, splits the
series that contain more than one acquisition — multiphase, diffusion, SWI — lets you pick
what to keep, blank out any text burnt into the pixels, crop away the margins and set the
contrast, anonymises
everything with Radiopaedia's reference anonymiser, and uploads the result as a draft case.

Before it anonymises it looks through the images for burnt-in banners and rings what it
finds. It finds the obvious ones, and it never reports a selection as clean.

Runs on macOS, Linux and Windows.

> Unofficial. Not affiliated with or endorsed by Radiopaedia.org.

![The review step](docs/public/shots/02-review.png)

## Documentation

**[gmadevs.github.io/Radiouploader](https://gmadevs.github.io/Radiouploader/)**

| | |
|---|---|
| [Install and sign in](https://gmadevs.github.io/Radiouploader/guide/install) | registering an OAuth application, first launch on each platform |
| [Using it](https://gmadevs.github.io/Radiouploader/guide/import) | the whole wizard, screen by screen |
| [How it works](https://gmadevs.github.io/Radiouploader/internals/architecture) | the pipeline, the process split, why the order is what it is |
| [Known limitations](https://gmadevs.github.io/Radiouploader/limitations) | what it does not do yet, and why |

## Development

```bash
npm install
npm run dev        # hot-reloading Electron
npm test           # unit tests plus anonymiser and decoder integration tests
npm run smoke      # boots the built app, fails on console errors
npm run shots      # regenerates the documentation screenshots
npm run docs:dev   # the documentation site, locally
```

More in [build and run](https://gmadevs.github.io/Radiouploader/develop/build).

## Licence

AGPL-3.0-only.

This app links [radiopaedia/dicom-anonymiser](https://github.com/radiopaedia/dicom-anonymiser),
which is AGPL-3.0-only, so the combined work is too. If you distribute a build, publish the
source.

Using their reference anonymiser is not just convenient: Radiopaedia re-runs it on every
uploaded DICOM and rejects the file if any tag would change, and API clients found to have
uploaded patient data are suspended. The output satisfies that validator —
`PatientIdentityRemoved` is set to `YES`, `SOPInstanceUID` is removed entirely, and the
UIDs are rewritten into the required `1.2.826.0.1.3680043.10.341.512.…` hashed scheme.

The DICOM fixtures under `src/main/anon/__fixtures__/` come from that same repository. The
sample study the screenshots are taken on is generated, not real — see
[screenshots](https://gmadevs.github.io/Radiouploader/develop/screenshots).
