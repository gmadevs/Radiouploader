<div align="center">

<img src="resources/icon.png" alt="" width="128" height="128">

# Radiouploader

[![Licence: AGPL-3.0-only](https://img.shields.io/badge/licence-AGPL--3.0--only-blue?style=flat-square)](LICENSE)
[![Platform: macOS, Linux, Windows](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square)](https://gmadevs.github.io/Radiouploader/develop/packaging)
[![Status: stable](https://img.shields.io/badge/status-stable-brightgreen?style=flat-square)](https://gmadevs.github.io/Radiouploader/limitations)
[![Docs](https://img.shields.io/badge/docs-gmadevs.github.io-4c9aff?style=flat-square)](https://gmadevs.github.io/Radiouploader/)
[![Build](https://github.com/gmadevs/Radiouploader/actions/workflows/build.yml/badge.svg)](https://github.com/gmadevs/Radiouploader/actions/workflows/build.yml)
[![Tests](https://github.com/gmadevs/Radiouploader/actions/workflows/test.yml/badge.svg)](https://github.com/gmadevs/Radiouploader/actions/workflows/test.yml)
[![CodeQL](https://github.com/gmadevs/Radiouploader/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/gmadevs/Radiouploader/security/code-scanning)
[![GitGuardian](https://github.com/gmadevs/Radiouploader/actions/workflows/gitguardian.yml/badge.svg)](https://github.com/gmadevs/Radiouploader/actions/workflows/gitguardian.yml)
[![CodeFactor](https://www.codefactor.io/repository/github/gmadevs/radiouploader/badge)](https://www.codefactor.io/repository/github/gmadevs/radiouploader)
[![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/gmadevs/Radiouploader?utm_source=oss&utm_medium=github&utm_campaign=gmadevs%2FRadiouploader&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)](https://coderabbit.ai)
[![Known Vulnerabilities](https://snyk.io/test/github/gmadevs/Radiouploader/badge.svg)](https://snyk.io/test/github/gmadevs/Radiouploader)
[![Electron](https://img.shields.io/badge/Electron-43-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)

</div>

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

## Download

<!-- downloads: npm run links -->

Version **1.0.0**. Nothing is signed, so the first launch needs one extra step per
platform: [how to open it](https://gmadevs.github.io/Radiouploader/guide/install).

| | Also built |
|---|---|
| [![macOS](https://img.shields.io/badge/macOS-Apple%20silicon-111111?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/gmadevs/Radiouploader/releases/download/v1.0.0/Radiouploader-1.0.0-arm64.dmg) | Intel: [.dmg](https://github.com/gmadevs/Radiouploader/releases/download/v1.0.0/Radiouploader-1.0.0.dmg) |
| [![Linux](https://img.shields.io/badge/Linux-AppImage%20x64-FCC624?style=for-the-badge&logo=linux&logoColor=white)](https://github.com/gmadevs/Radiouploader/releases/download/v1.0.0/Radiouploader-1.0.0.AppImage) | AppImage arm64: [.AppImage](https://github.com/gmadevs/Radiouploader/releases/download/v1.0.0/Radiouploader-1.0.0-arm64.AppImage) · Debian amd64: [.deb](https://github.com/gmadevs/Radiouploader/releases/download/v1.0.0/radiouploader_1.0.0_amd64.deb) · Debian arm64: [.deb](https://github.com/gmadevs/Radiouploader/releases/download/v1.0.0/radiouploader_1.0.0_arm64.deb) |
| [![Windows](https://img.shields.io/badge/Windows-x64%20installer-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/gmadevs/Radiouploader/releases/download/v1.0.0/Radiouploader.Setup.1.0.0.exe) |  |

On macOS, with Homebrew — the second line because the app is not signed and
Homebrew quarantines what it downloads:

```bash
brew install --cask gmadevs/radiouploader/radiouploader
xattr -dr com.apple.quarantine /Applications/Radiouploader.app
```

Older versions, and the notes that come with each, are on the [releases page](https://github.com/gmadevs/Radiouploader/releases).

<!-- /downloads -->

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

## Security

Found a way this app could leak patient data, or a hole in how it keeps credentials? Report
it privately — [SECURITY.md](SECURITY.md) says how, and what not to attach to a report.

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
