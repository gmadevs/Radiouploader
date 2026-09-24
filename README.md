<div align="center">

<img src="resources/icon.png" alt="" width="128" height="128">

# Radiouploader

[![Licence: AGPL-3.0-only](https://img.shields.io/badge/licence-AGPL--3.0--only-blue?style=flat-square)](LICENSE)
[![Platform: macOS, Linux, Windows](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square)](https://gmadevs.github.io/Radiouploader/develop/packaging)
[![Status: stable](https://img.shields.io/badge/status-stable-brightgreen?style=flat-square)](https://gmadevs.github.io/Radiouploader/limitations)
[![Docs](https://img.shields.io/badge/docs-gmadevs.github.io-4c9aff?style=flat-square)](https://gmadevs.github.io/Radiouploader/)
[![Build and install](https://github.com/gmadevs/Radiouploader/actions/workflows/build.yml/badge.svg)](https://github.com/gmadevs/Radiouploader/actions/workflows/build.yml)
[![Installers tested on macOS, Windows, Ubuntu and Debian](https://img.shields.io/badge/installers%20tested-macOS%20%7C%20Windows%20%7C%20Ubuntu%20%7C%20Debian-2ea44f?style=flat-square)](https://gmadevs.github.io/Radiouploader/develop/packaging#installing-what-was-built)
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

A desktop app for preparing DICOM studies and uploading them to
[Radiopaedia.org](https://radiopaedia.org) as draft cases.

The app accepts a folder, a zip file or a set of DICOM files. It:

- reads the study and splits series that contain more than one acquisition, such as
  multiphase, diffusion or SWI;
- lets you choose which series to upload, blank out burnt-in text, crop the images and set
  the window;
- marks areas that look like burnt-in text before anonymising (it finds large banners and
  can miss small or faint text, so check every image yourself);
- anonymises the files with Radiopaedia's reference anonymiser and uploads them as a draft
  case.

It also reads DICOM video (MPEG-2, H.264 and HEVC) and can add coronal, sagittal and MIP
reformats to a case. It runs on macOS, Linux and Windows.

> Unofficial. Not affiliated with or endorsed by Radiopaedia.org.

## Download

<!-- downloads: npm run links -->

Version **1.5.1**. The installers are not signed, so the first launch needs one extra step
on each platform: [how to open it](https://gmadevs.github.io/Radiouploader/guide/install).

| | Also built |
|---|---|
| [![macOS](https://img.shields.io/badge/macOS-Apple%20silicon-111111?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/gmadevs/Radiouploader/releases/download/v1.5.1/Radiouploader-1.5.1-arm64.dmg) | Intel: [.dmg](https://github.com/gmadevs/Radiouploader/releases/download/v1.5.1/Radiouploader-1.5.1.dmg) |
| [![Linux](https://img.shields.io/badge/Linux-AppImage%20x64-FCC624?style=for-the-badge&logo=linux&logoColor=white)](https://github.com/gmadevs/Radiouploader/releases/download/v1.5.1/Radiouploader-1.5.1.AppImage) | AppImage arm64: [.AppImage](https://github.com/gmadevs/Radiouploader/releases/download/v1.5.1/Radiouploader-1.5.1-arm64.AppImage) · Debian amd64: [.deb](https://github.com/gmadevs/Radiouploader/releases/download/v1.5.1/radiouploader_1.5.1_amd64.deb) · Debian arm64: [.deb](https://github.com/gmadevs/Radiouploader/releases/download/v1.5.1/radiouploader_1.5.1_arm64.deb) |
| [![Windows](https://img.shields.io/badge/Windows-x64%20installer-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/gmadevs/Radiouploader/releases/download/v1.5.1/Radiouploader.Setup.1.5.1.exe) |  |

On macOS you can also install it with Homebrew. The second command removes the quarantine
flag Homebrew adds to downloads, which macOS would otherwise use to block the unsigned app:

```bash
brew install --cask gmadevs/radiouploader/radiouploader
xattr -dr com.apple.quarantine /Applications/Radiouploader.app
```

To update a Homebrew install (the app tells you at launch when a new version is out), run
the second command again, because Homebrew adds the flag to every download:

```bash
brew upgrade --cask radiouploader
xattr -dr com.apple.quarantine /Applications/Radiouploader.app
```

Older versions and their release notes are on the [releases page](https://github.com/gmadevs/Radiouploader/releases).

<!-- /downloads -->

![The review step](docs/public/shots/02-review.png)

## Documentation

**[gmadevs.github.io/Radiouploader](https://gmadevs.github.io/Radiouploader/)**

| | |
|---|---|
| [Install and sign in](https://gmadevs.github.io/Radiouploader/guide/install) | registering an OAuth application, first launch on each platform |
| [Using it](https://gmadevs.github.io/Radiouploader/guide/import) | the whole wizard, screen by screen |
| [How it works](https://gmadevs.github.io/Radiouploader/internals/architecture) | how the app is structured, and the order it processes images in |
| [Known limitations](https://gmadevs.github.io/Radiouploader/limitations) | what the app does not do |

## Development

```bash
npm install
npm run dev        # hot-reloading Electron
npm test           # unit tests plus anonymiser and decoder integration tests
npm run smoke      # boots the built app, fails on console errors
npm run shots      # regenerates the documentation screenshots
npm run docs:dev   # the documentation site, locally
npm run lab        # a throwaway Windows or Ubuntu desktop on EC2, to try an installer on
```

Before a release is drafted, CI installs each installer on macOS, Windows, Ubuntu and clean
Debian and Ubuntu images, opens the installed app and removes it again. See
[installing what was built](https://gmadevs.github.io/Radiouploader/develop/packaging#installing-what-was-built).

More in [build and run](https://gmadevs.github.io/Radiouploader/develop/build).

## Security

If you find a way the app could leak patient data or expose credentials, report it
privately as described in [SECURITY.md](SECURITY.md), which also lists what not to attach
to a report.

## Licence

AGPL-3.0-only.

The app includes [radiopaedia/dicom-anonymiser](https://github.com/radiopaedia/dicom-anonymiser),
which is licensed AGPL-3.0-only, so the app is too. If you distribute a build, you must also
publish its source.

The app uses Radiopaedia's reference anonymiser because Radiopaedia runs the same anonymiser
on every uploaded DICOM file and rejects files it would change. API clients that upload
patient data are suspended. The anonymiser sets `PatientIdentityRemoved` to `YES`, removes
`SOPInstanceUID` and replaces the other UIDs with hashed values in the
`1.2.826.0.1.3680043.10.341.512.…` scheme.

Every build includes ffmpeg, which the app runs as a separate program to decode DICOM video.
The binaries are pinned by hash. They come from
[eugeneware/ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) on macOS and Windows
and from [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) (LGPL) on Linux. The
licence file is installed next to the binary, in `ffmpeg/LICENSE` among the app's resources:
LGPL-2.1+ for the macOS and Linux builds and GPL-3.0 for Windows. The ffmpeg source is at
[ffmpeg.org](https://ffmpeg.org/download.html).

The DICOM fixtures in `src/main/anon/__fixtures__/` come from the
radiopaedia/dicom-anonymiser repository. The video fixtures in `src/main/codecs/__fixtures__/`
are generated by `scripts/videoFixtures.mjs`, and the sample study used for the screenshots
is generated too; see [screenshots](https://gmadevs.github.io/Radiouploader/develop/screenshots).
