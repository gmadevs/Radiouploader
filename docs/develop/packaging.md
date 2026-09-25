# Packaging and release

```bash
npm run dist:mac     # dmg, arm64 + x64
npm run dist:linux   # AppImage + deb, x64 + arm64
npm run dist:win     # nsis
```

The same builds run on CI. `.github/workflows/build.yml` builds each platform on its own
runner and uploads the installers as artifacts. When a `v*` tag is pushed, it also creates a
draft release with the installers attached.

The release is a draft so that the installers can be tried before anyone can download them;
it is published by hand. The text at the top of every release (the installers are unsigned,
and the app never reports images as free of burnt-in text) is the `body:` of the release step
in `build.yml`, so it is the same on every release. Check that it is still correct before
tagging.

The workflow runs only for a tag or when started by hand, not on every push, because macOS
and Windows runners cost 10 and 2 times as much as Linux runners on private repositories.

## Cutting a release

```bash
npm version 1.2.0 --no-git-tag-version
npm run shots
git commit -am "One sentence, in the imperative, about what this release is"
git tag -a v1.2.0 -m "Radiouploader 1.2.0"
git push origin main --follow-tags
```

`npm version` runs the `version` script, which updates the README's download links for the
new version. `--no-git-tag-version` stops npm from making its own commit and tag, because
commits in this project are sentences and tags are annotated. `npm run shots` updates the
screenshot of the first screen, which shows the version number.

After the push:

1. The tag starts `build.yml`. It builds the installers on three runners,
   [installs and opens each one](#installing-what-was-built) on a machine that did not build
   it, and creates a draft release with the installers attached.
2. Download the installer for your own machine from the draft and try it. For a dmg, you can
   run `node scripts/installed.mjs dmg install <dir>` and then `launch`, which installs the
   app in a temporary folder, not in `/Applications`.
3. Publish the release.
4. Publishing starts `cask.yml`, which updates the [Homebrew tap](#the-homebrew-tap).

Publish the release soon after pushing the tag. The documentation site is built from
`package.json` on every push that changes `docs/`, so between the version change and the
publication it can link to installers that are not downloadable yet. See
[the download links](#the-download-links).

## Installing what was built

```bash
node scripts/installed.mjs <dmg|nsis|deb|appimage> <install|launch|uninstall> <dir>
```

Between the build and the draft release, `build.yml` installs each installer as a user would,
opens the installed app and removes it again. `npm run smoke` shows that `out/` starts in the
development Electron; these jobs show that the files people download install and start. The
draft is created only if all of them pass.

| Job | Runs on | What it checks for |
|---|---|---|
| dmg, Apple silicon and Intel | `macos-latest`, `macos-15-intel` | a disk image containing the other architecture's binary, which would run under Rosetta without anyone noticing |
| Windows installer | `windows-latest` | an install that cannot be uninstalled, or an uninstall that leaves files behind |
| AppImage, x64 and arm64 | `ubuntu-24.04`, `ubuntu-24.04-arm` | an app that does not start from its own mount |
| deb, Ubuntu 24.04 | `ubuntu-24.04`, as a normal user | the sandbox and the AppArmor profile the package installs |
| deb, clean Debian 12, Ubuntu 22.04, arm64 Ubuntu 24.04 | a container with a bare image | a dependency the package does not declare |

A runner has hundreds of libraries preinstalled, and any of them can satisfy a dependency the
deb does not declare. The deb is therefore also installed with apt in bare containers, where
apt installs only what the package declares, and `ldd` then checks for libraries the binary
needs that are missing. The virtual display those jobs need is installed after the package,
because it brings in many X libraries.

Processes in a container run as root, and Chromium does not start as root with its sandbox
enabled. Those jobs start the app with `--no-sandbox` and say so in the log. The job on the
runner itself is the one that tests the sandbox.

The app is started with `--remote-debugging-port` and its own profile, and checked over the
DevTools protocol: the page must load, the wizard steps and the preload bridge must be there,
there must be no console errors, exceptions or failed loads, and `appInfo().videoDecoder`
must report a working [video decoder](#the-video-decoder). Nothing is added to the app for
these checks, as with the [screenshots](/develop/screenshots). Each job uploads a screenshot.

The installers are found by the file names that `scripts/downloads.mjs` also uses for the
download links, so a renamed installer fails the build instead of breaking a download link.

No job can test Gatekeeper or SmartScreen, which react only to files downloaded by a browser
and respond with a dialog. That is why the draft is tried by hand before it is published.

## The download links

```bash
npm run links
```

The README's download buttons include the version number, because GitHub has no stable URL
for the latest installer: `/releases/latest` opens the latest release page, and a direct
download needs the file name, which includes the version. The links are therefore generated
from `package.json` into a marked block in the README by `scripts/links.mjs`, which also runs
on `npm version`. The text around the links is in that script too, so change it there.

The file names follow electron-builder's conventions, which differ by format: the dmg and
AppImage use the product name and dashes, the deb uses the package name and underscores and
calls x64 `amd64`, and the NSIS installer has `Setup` in its name. The names were checked
against the files real releases produced.

The README and the download cards on this site both take the file names from
`scripts/downloads.mjs`. The site reads it at build time in `docs/.vitepress/config.ts` and
passes the result to the component as `themeConfig.downloads`, so there is only one list of
file names.

The site shows the version in `package.json`, whether or not that release has been published.
Publish the release soon after pushing the tag.

## The Homebrew tap

```bash
node scripts/cask.mjs <version> <arm64 sha256> <x64 sha256>
```

On macOS the app can be installed with `brew install --cask
gmadevs/radiouploader/radiouploader`, followed by `xattr -dr com.apple.quarantine` on the
installed app, because Homebrew quarantines every download and the app is not signed. The
cask is in the project's own tap,
[gmadevs/homebrew-radiouploader](https://github.com/gmadevs/homebrew-radiouploader), because
`homebrew/cask` accepts only projects that are at least 30 days old and have a minimum number
of stars, forks or watchers.

`.github/workflows/cask.yml` writes the cask when a release is published, not when the tag is
pushed, because a cask that points at a draft's files would fail with a 404. It downloads the
two disk images from the published release, calculates their SHA-256 checksums and pushes the
cask to the tap. The checksums must come from the published files: a rebuild would produce
different bytes.

`scripts/cask.mjs` writes the rest of the cask. It checks itself against
`scripts/downloads.mjs`: the URLs produced by the cask's `#{version}` and `#{arch}` template
must match the README's download links exactly, so a renamed installer stops the script
instead of producing a cask that fails with a 404.

Pushing to the tap needs a token that the workflow's own token cannot provide: a fine-grained
personal access token with *Contents: write* on `homebrew-radiouploader`, stored as the
`TAP_TOKEN` secret. If the secret is missing, the job stops with a message that says so.

The tap repository name is lower case because Homebrew converts tap names to lower case:
`gmadevs/radiouploader` resolves to `homebrew-radiouploader`.

`brew style` does not report deprecated stanzas: Homebrew prints those when it reads the cask,
on the user's machine. A deprecated `verified:` parameter once went unnoticed this way until a
user reported the warning. Check a new cask by loading it, not only by linting it:

```bash
brew tap-new gmadevs/caskcheck --no-git
node scripts/cask.mjs <version> <arm64 sha256> <x64 sha256> \
  > "$(brew --repository gmadevs/caskcheck)/Casks/radiouploader.rb"
brew info --cask gmadevs/caskcheck/radiouploader   # deprecations are printed here
brew style gmadevs/caskcheck
rm -rf "$(brew --repository gmadevs/caskcheck)"
```

The check uses a temporary tap because Homebrew refuses a cask file outside a tap. Running
`brew style` on a loose `.rb` file reports offences about Sorbet and frozen string literals
that do not apply to casks.

## The video decoder

```bash
npm run ffmpeg                 # every architecture this platform packages
npm run ffmpeg -- linux x64    # one
```

DICOM video (MPEG-2, H.264, HEVC) is decoded by ffmpeg, which every installer includes: 45 to
110 MB uncompressed, which adds about 25 MB to a compressed macOS or Windows installer and
about 45 MB to a Linux one. See [why ffmpeg and not Chromium's decoders](/internals/architecture#video).

The macOS and Windows binaries come from
[eugeneware/ffmpeg-static](https://github.com/eugeneware/ffmpeg-static). The Linux binaries
are [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) LGPL builds, pinned to a
month-end build, which BtbN keeps for about two years (daily builds are deleted after about
two weeks). ffmpeg-static's Linux x64 build is not used because it crashes (exit 139) on
MPEG-TS input on AMD EPYC processors, although it works on Intel. Test a new build on AMD
x64, Intel x64 and arm64 runners before pinning it.

`scripts/ffmpeg.mjs` checks every download against a SHA-256 checksum: for a tar.xz archive,
the archive before it is unpacked, then the binary and its licence file. A download with a
different checksum is refused, because the app runs this program on patient data. The files
are saved in `node_modules/.cache/ffmpeg/`, which git ignores, and the dist scripts fetch them
before electron-builder runs.

Each installer contains the binary for its own architecture. One macOS runner builds both
dmgs and one Linux runner builds both architectures, so the script fetches every architecture
the platform packages, and `electron-builder.yml` copies
`node_modules/.cache/ffmpeg/<platform>-${arch}` into `resources/ffmpeg` of each installer. The
install jobs check that the installed app reports a working decoder, so a missing,
non-executable or wrong-architecture binary fails the build.

The licence file is installed next to the binary. ffmpeg runs as a separate program, not as
code linked into the app. The source is at [ffmpeg.org](https://ffmpeg.org/download.html).

To update ffmpeg: change the URLs and checksums of all five binaries in `scripts/ffmpeg.mjs`,
and run the tests on AMD x64, Intel x64 and arm64 runners. The tests decode the fixtures in
`src/main/codecs/__fixtures__/`, which `scripts/videoFixtures.mjs` generates, in every
container the DICOM standard allows.

## The icon

```bash
npm run icon
```

The artwork is `resources/icon-src.jpeg`, a rounded square on a white background. The
platforms need a 1024×1024 PNG with a transparent background: macOS shows a white background
as a white box around the icon.

The script finds the shape by filling in from the edges of the image, not by making white
pixels transparent, because some light parts of the artwork are close to white. It fits the
shape into the middle 840 pixels of the square without stretching it, because macOS icons use
a grid in which the rounded square is 824 of 1024 pixels, and a larger icon looks too big in
the Dock. It writes `resources/icon.png` and the documentation's `favicon.png`. It uses a
canvas in Electron, so the project needs no image library.

It also writes the Linux icon sizes from 16 to 512 pixels into `resources/icons/`, which
electron-builder uses for Linux. Linux menus look up icons in the hicolor theme, which has no
application icon folder above 512 pixels; a deb with only the 1024-pixel icon showed no icon
in the menu ([#8](https://github.com/gmadevs/Radiouploader/issues/8)). The install job checks
that the icon named by the deb's menu entry exists in a size hicolor supports.

Generate the icons with the script instead of editing them by hand, so they stay consistent
with the artwork.

## Signing

The installers are not signed:

- **macOS** signing and notarisation need an Apple Developer ID ($99 a year). Without one the
  dmg installs, but Gatekeeper blocks the first launch. Users run `xattr -dr
  com.apple.quarantine /Applications/Radiouploader.app`, or allow the app in System Settings →
  Privacy & Security. macOS 15 removed the Control-click → Open option for blocked apps.
- **Windows** signing needs an Authenticode certificate. Without one, SmartScreen shows a
  warning until the installer has built up a reputation; users choose More info → Run anyway.
- **Linux** installers need no signature. The AppImage runs on any distribution after
  `chmod +x`, and the deb is for Debian and Ubuntu.

CI sets `CSC_IDENTITY_AUTO_DISCOVERY=false`; without it, electron-builder looks for a signing
identity and fails instead of building an unsigned dmg.

The workflow's token is read-only. Only the job that creates the draft release has
`contents: write`, so the jobs that install dependencies and build installers cannot push
commits or move tags.

`GH_TOKEN` is not set, so that electron-builder does not publish a release itself. On CI with
a tag, electron-builder tries to publish even without the token and fails after building,
so each `dist:*` script ends with `--publish never`.

## The deb package

The deb has a maintainer address, set in `electron-builder.yml`, because fpm does not build a
deb without one. It is the same address the app shows for problem reports.

The deb declares its own list of dependencies, because electron-builder's default list
leaves out two libraries Electron needs: ALSA (`libasound2`) and Mesa's buffer manager
(`libgbm1`). Desktop systems always have them, but a minimal Debian 12, Ubuntu 22.04 or
Ubuntu 24.04 does not, and there the app did not start. The install job found this.

ALSA is declared as `libasound2t64 | libasound2`, with the new name first. On Ubuntu 24.04,
`libasound2` is a virtual name provided by two packages, and apt chose
`liboss4-salsa-asound2`, which lacks part of ALSA, so the app failed with
`undefined symbol: snd_device_name_get_hint`. Debian 12 and Ubuntu 22.04 do not have
`libasound2t64` and use `libasound2`.

## The secret scan

`.github/workflows/gitguardian.yml` runs ggshield on every push and pull request. A secret
pushed to a public repository stays in its history even if a later commit removes it, so the
scan checks every commit in a push, not only the last one.

ggshield finds the commits of a push from `GITHUB_PUSH_BASE_SHA`, which the workflow sets to
`github.event.before`. It was once set to a field that push events do not have, and the scan
then checked only the last commit of each push while reporting success. Check that
`Commits to scan` in the log matches the number of commits pushed. Pull requests use a
different variable and were not affected.

## Documentation

This site is built by `.github/workflows/docs.yml` on every push to `main` that changes
`docs/`, and published on GitHub Pages.

```bash
npm run docs:dev       # local, with hot reload
npm run docs:build
npm run docs:preview
```

### VitePress runs on the project's Vite

VitePress 1.6.4 depends on Vite 5, whose last release, 5.4.21, has security advisories with
no fixed version (three against Vite and one against its esbuild). They affect only the local
documentation dev server, but open alerts on a public repository are better resolved.

`overrides` in `package.json` therefore makes VitePress use the same Vite as the rest of the
project, and a matching `@vitejs/plugin-vue`. The dependency tree then has one Vite, and
`npm audit` reports nothing. The build, the dev server, the Mermaid diagrams and the download
cards were checked with it.

When adding such an override, npm does not re-resolve an existing nested dependency tree: it
reports "up to date" and only warns about the peer dependency. Remove the
`node_modules/vitepress/node_modules/…` entries from `package-lock.json` before running
`npm install`, and check that the diff changes nothing outside that part of the lock file.

VitePress 2 no longer uses Vite 5, but it is in alpha, needs Vite 8, and
`vitepress-plugin-mermaid` requires VitePress 1. When both are updated, try removing the
override.
