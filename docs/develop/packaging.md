# Packaging and release

```bash
npm run dist:mac     # dmg, arm64 + x64
npm run dist:linux   # AppImage + deb, x64 + arm64
npm run dist:win     # nsis
```

All three also run on CI. `.github/workflows/build.yml` builds every platform on its own
runner and uploads the installers as artifacts; pushing a `v*` tag additionally drafts a
release with them attached.

The release is drafted rather than published. Nobody can download an installer until the
draft is published by hand, which is the point: the binaries get opened once before they are
offered to anyone. The warning that heads every release — unsigned, and never says your
images are clean — is the `body:` of the release step, so it is the same on every tag and
cannot be forgotten while writing notes. It is prose about what the app does, so it goes
stale the way prose does: check it says something still true before tagging.

Up to `0.1.0-beta.1` the version carried a pre-release suffix and the release was flagged as
a pre-release on GitHub; the suffix reached the filenames, so the dmg, the deb and the
installer all said `beta` before anyone ran them. From `1.0.0` the version is a plain one and
`prerelease:` is off — the draft is still a draft, which is where the checking happens, but
what gets published is a release rather than a warning.

It is triggered manually or by a tag rather than on every push, because macOS and Windows
runners bill at 10x and 2x — a habit worth keeping even now the repository is public and
the minutes are free.

## Cutting a release

```bash
npm version 1.2.0 --no-git-tag-version
git commit -am "One sentence, in the imperative, about what this release is"
git tag -a v1.2.0 -m "Radiouploader 1.2.0"
git push origin main --follow-tags
```

Then four things happen, and only the third is yours:

1. the tag starts `build.yml`: three runners, three sets of installers, each of them
   [installed and opened](#installing-what-was-built) on a machine that did not build it,
   and a **drafted** release with them attached;
2. nobody can download any of it, because the release is a draft;
3. you open the installers — at least the one for the machine you are on — and press
   **Publish release**;
4. publishing fires [`cask.yml`](#the-homebrew-tap), which hashes the two disk images the
   release published and pushes the cask to the tap.

`--no-git-tag-version` because the bump and the commit are separated on purpose. The `version`
script runs either way, which is what rewrites the README's download links from the new
number; what is skipped is npm's own commit, called `1.2.0`, where the commits here are
sentences. The tag is annotated, like the ones before it.

The one window to be careful about is between the bump and step 3: the documentation site
builds from `package.json` on any push touching `docs/`, so it can offer links to files that
do not exist yet. That is the reason to publish on the same pass as the tag, and it is the
same argument as [the download links](#the-download-links) below.

## Installing what was built

```bash
node scripts/installed.mjs <dmg|nsis|deb|appimage> <install|launch|uninstall> <dir>
```

Between the build and the draft, `build.yml` installs every installer the way somebody
downloading it would, opens the app that install left behind, and removes it again.
`npm run smoke` proves `out/` boots under the development Electron; this proves the files
people download do. The release job waits for it, so a release whose installer does not
install is never drafted.

| Job | Runs on | What it is there to catch |
|---|---|---|
| dmg, Apple silicon and Intel | `macos-latest`, `macos-15-intel` | a disk image holding the other architecture's binary, which would open under Rosetta and go unnoticed |
| Windows installer | `windows-latest` | an install that registers nothing to uninstall, or an uninstall that leaves files behind |
| AppImage, x64 and arm64 | `ubuntu-24.04`, `ubuntu-24.04-arm` | an app that does not start from its own mount |
| deb, Ubuntu 24.04 | `ubuntu-24.04`, as a user | the sandbox and the AppArmor profile the package installs |
| deb, clean Debian 12, Ubuntu 22.04, arm64 Ubuntu 24.04 | a bare container | a dependency the package forgot to declare |

**A runner is not a clean machine.** It has hundreds of libraries preinstalled, and any of
them can satisfy a dependency the deb never asked for. So the deb is also installed into bare
images with apt, which fetches what the package declares and nothing else, and `ldd` then
looks for a library the binary links against that nobody brought. The display those jobs
need is installed *after* the package for the same reason: xvfb pulls in half of X.

Everything in a container runs as root, and Chromium will not start as root with its sandbox
on. Those runs pass `--no-sandbox` and say so in the log: they prove the package installs and
the app boots, and the run on the runner itself is the one that says anything about the
sandbox.

The app is started with `--remote-debugging-port` and a profile of its own, and read over
the DevTools protocol: the three things the smoke test reads, and every console error,
exception and failed load since start-up, which the protocol hands over to whoever connects
late. Nothing is added to the app for it, which is the rule the
[screenshots](/develop/screenshots) keep. Each run uploads the screenshot it took.

The installers are looked up by the names `scripts/downloads.mjs` gives the download links,
not globbed for, so a renamed artifact fails the build rather than a download.

What no job can test is **Gatekeeper and SmartScreen**. Both react to a file a browser
downloaded, and both answer with a dialog; that is still what opening the draft by hand is
for. On a Mac the script can be run against a dmg without touching an installed copy — the
app goes to a temporary folder, never `/Applications`.

## The download links

```bash
npm run links
```

The README's download buttons carry the version, because GitHub has no stable URL for "the
newest installer": `/releases/latest` resolves to the newest release's **page**, and a direct
download needs the asset's own filename — which electron-builder writes the version into. A
link that carries a version goes stale the moment the version changes — silently, on the
front page, where stale means a 404 for whoever came to try the app.

So they are generated from `package.json` into a marked block in the README, and the
generator also runs on `npm version`, which is what bumps that field. The links in the
commit that bumps the version are therefore already the right ones, and there is no step to
forget.

The filenames it builds are electron-builder's, which is not one convention but three: the
dmg and the AppImage take the product name and dashes, the deb takes the package name and
underscores and calls x64 amd64, and NSIS writes `Setup` in the middle. They were checked
against the files a real tag produced rather than read off the documentation: all three on
`v0.1.0-beta.1`, and the mac pair again on `v1.0.0`, since dropping the suffix is exactly the
kind of change that moves a name.

Two front pages want those links now — the README and the download cards under the hero on
this site — so the filenames live in `scripts/downloads.mjs` and both take them from there.
The site reads it at build time, in `docs/.vitepress/config.ts`, and hands the result to the
component through `themeConfig.downloads`; no version is typed into a template. A second
copy of those filenames would drift, and the copy that drifted would be the one whose
generator nobody ran.

The consequence is that the site advertises whatever `package.json` says, whether or not a
release under that tag exists yet. The docs workflow runs on every push to `main` touching
`docs/`, and `npm version` bumps the field before the tag is pushed and the draft release
published by hand — so a push in between puts live download links in front of readers a few
minutes before the files are there. Publish the release on the same pass as the tag.

## The Homebrew tap

```bash
node scripts/cask.mjs <version> <arm64 sha256> <x64 sha256>
```

macOS can install this with `brew install --cask gmadevs/radiouploader/radiouploader`,
followed by an `xattr -dr com.apple.quarantine` on the installed app — current Homebrew
quarantines every cask download and has no `--no-quarantine` any more, and this app is not
signed. It comes from
[gmadevs/homebrew-radiouploader](https://github.com/gmadevs/homebrew-radiouploader) rather
than from `homebrew/cask`: the official repository asks a project to be notable before it
will carry it — thirty days old at the least, and stars, forks or watchers in numbers this
does not have — and a tap of one's own needs none of that from anybody.

`.github/workflows/cask.yml` writes it. It runs when a release is **published**, not when
the tag is pushed: the tag drafts a release that is opened and checked by hand, and a cask
pointing at files nobody can download yet fails an install with a 404 that reads like a
tampered download. It fetches the two disk images the release actually published, hashes
them, and pushes the result to the tap.

The checksums come from the released files rather than from a build made in that job, which
would hash differently and make every install fail. The version and those two hashes are the
whole of what changes between releases; everything else in the cask is written by
`scripts/cask.mjs`, which **checks itself against `scripts/downloads.mjs`** — expand the
cask's `#{version}`/`#{arch}` template and it must produce, character for character, the URLs
the README's download buttons point at. Rename an artifact and the generator stops rather
than publishing a cask that 404s.

Pushing to another repository needs a token this workflow's own cannot supply, so the tap
takes a fine-grained PAT with *Contents: write* on `homebrew-radiouploader`, kept as the
`TAP_TOKEN` secret. Without it the job stops with a message that says so, rather than failing
inside git.

The tap is named in lower case because Homebrew lower-cases a tap name: `gmadevs/radiouploader`
resolves to `homebrew-radiouploader`, and a repository named any other way is reached only
through GitHub's own case-insensitivity, which is a redirect to depend on rather than a name
to have.

`brew style` on the cask is clean, and **that is not the check that matters**. A deprecated
stanza is not a style offence: Homebrew prints it when it *reads* the cask, which means on
somebody else's machine, in the middle of whatever they were doing. A `verified:` parameter
in the `url` stanza went exactly that way — style stayed clean release after release while
every `brew` command that so much as touched this tap printed two paragraphs asking the
person who ran it to report the tap to its author. It was found by somebody upgrading.

So the check is to load it, not only to lint it:

```bash
brew tap-new gmadevs/caskcheck --no-git
node scripts/cask.mjs <version> <arm64 sha256> <x64 sha256> \
  > "$(brew --repository gmadevs/caskcheck)/Casks/radiouploader.rb"
brew info --cask gmadevs/caskcheck/radiouploader   # a deprecation prints here
brew style gmadevs/caskcheck
rm -rf "$(brew --repository gmadevs/caskcheck)"
```

A tap of its own, because Homebrew refuses a loose file — *"Homebrew requires casks to be in
a tap"* — and a scratch one rather than the real clone, which the workflow overwrites anyway.
`brew style` on a bare `.rb` outside a tap is no substitute: it answers with three offences
about Sorbet sigils and frozen string literals, none of which apply to a cask.

## The video decoder

```bash
npm run ffmpeg                 # every architecture this platform packages
npm run ffmpeg -- linux x64    # one
```

DICOM video — MPEG-2, H.264, HEVC — is decoded by **ffmpeg**, which no WASM codec here
replaces and which every installer therefore carries: 45 to 110 MB unpacked, about 25 MB
on a compressed macOS or Windows installer and 45 MB on a Linux one. [Why ffmpeg and not Chromium's decoders](/internals/architecture#video).

The macOS and Windows binaries are [eugeneware/ffmpeg-static](https://github.com/eugeneware/ffmpeg-static)'s;
the Linux ones are [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds)' LGPL builds,
pinned to a **month-end** autobuild, which BtbN keeps for about two years where the daily
ones go in a fortnight. Linux used to be ffmpeg-static's too, and its x64 build crashed —
a segfault in the demuxer, exit 139, nothing on stderr — on any MPEG-TS input on AMD EPYC,
while the same file decoded on an Intel Xeon. MPEG-TS is the container H.264 is most often
written in, so that was every such clip on half the Linux machines; the CPU dependence is why
it took a matrix of runners to see, and why a new build is tried on both before it is pinned.

`scripts/ffmpeg.mjs` pins every one by release and by SHA-256 — of a tar.xz before anything
is unpacked from it, then of the binary and of its licence. A download that hashes differently is refused rather than
shipped — this is an executable the app runs on patient data, and one that changed under a
fixed release name is not one anybody looked at. They land in `node_modules/.cache/ffmpeg/`,
which git ignores and nothing syncs, and the dist scripts fetch them before electron-builder
runs.

**Each installer carries its own architecture's**, not the builder's. One macOS runner builds
both dmgs and one Linux runner both debs and AppImages, so the script fetches every
architecture electron-builder packages for the platform, and `electron-builder.yml` takes
`node_modules/.cache/ffmpeg/<platform>-${arch}` into `resources/ffmpeg` of each. The install
job then asks the installed app itself — `appInfo().videoDecoder`, which runs the binary — so
a missing, non-executable or wrong-architecture ffmpeg fails the build rather than the first
clip someone opens.

The licence file travels beside the binary. ffmpeg is a separate program the app runs, not
code linked into it; the source is at [ffmpeg.org](https://ffmpeg.org/download.html).

Moving to a newer build is: new URLs and new hashes for each of the five, a run of the
tests on every runner the install job uses — AMD and Intel x64, and arm64 — which decode real streams in every container
the standard allows through it. The fixtures they decode are drawn by
`scripts/videoFixtures.mjs`, never taken from a real clip.

## The icon

```bash
npm run icon
```

The artwork lives at `resources/icon-src.jpeg` — a rounded square drawn on white paper, in
whatever size the tool that made it chose. What the platforms want is a **1024x1024 PNG with
the paper transparent**: macOS applies no mask of its own, so a white background is not
ignored, it is shown, as a white box with the icon sitting inside it.

The command finds the shape by flooding in from the edges of the picture rather than by
testing pixels for whiteness — the brightest parts of the artwork are close enough to white
to be eaten by a threshold, and they are never connected to the border — then fits it into
the middle 840 pixels of the square without stretching it — a macOS icon is drawn on a grid
where the rounded square is 824 of 1024, and one that reaches the edges sits noticeably
larger than its neighbours in the Dock — and writes both `resources/icon.png` and the
documentation's `favicon.png`. There is no image library in the project and none is added
for this: Chromium is already here and a canvas does the whole job.

It also cuts the sizes Linux looks in, 16 to 512 pixels, into `resources/icons/`, which is
where electron-builder is pointed for Linux. A menu finds an icon by name in the hicolor
theme, and hicolor declares no directory above 512 for applications: the deb used to carry
the 1024 icon alone, and its entry sat in the menu with no icon
([#8](https://github.com/gmadevs/Radiouploader/issues/8)). The install job now checks, on
every build, that the icon the deb's menu entry names exists in a size hicolor declares.

Cutting it out by hand would work once and go stale the day the artwork changes, which is
the same argument the [screenshots](/develop/screenshots) are generated for.

## Signing

Neither platform is signed:

- **macOS** needs an Apple Developer ID ($99/year) for signing and notarisation. Without
  one the dmg installs fine, but Gatekeeper blocks the first launch — `xattr -dr
  com.apple.quarantine /Applications/Radiouploader.app`, or allow it in System Settings →
  Privacy & Security. macOS 15 removed the Control-click → Open override for an app it has
  blocked, so instructions that only say that no longer work.
- **Windows** needs an Authenticode certificate. Without one SmartScreen warns until the
  binary builds reputation — More info → Run anyway.
- **Linux** needs nothing. The AppImage runs on any distribution after `chmod +x`; the deb
  targets Debian and Ubuntu.

`CSC_IDENTITY_AUTO_DISCOVERY=false` is set on CI. Without it electron-builder hunts for a
signing identity that is not there and fails instead of producing an unsigned dmg.

The workflow's own token is read-only. Only the job that drafts the release asks for
`contents: write`, so the three runners that install dependencies and build installers
cannot push a commit or move a tag between them.

`GH_TOKEN` is deliberately **not** set: electron-builder would then publish a release
itself rather than leaving the files as artifacts for the release job to attach to a draft.
Withholding the token is not enough on its own, though — on CI with a tag present
electron-builder tries to publish anyway and fails asking for it, after the installers have
already been built. Each `dist:*` script therefore ends in `--publish never`.

The deb carries a **maintainer** address, set in `electron-builder.yml`, because fpm refuses
to build without one and falls back to the author's email. It is the same address the app
shows in its problem-report dialog.

It also carries its own **dependency list**, because electron-builder's leaves out two
libraries Electron cannot start without: ALSA (`libasound2`) and Mesa's buffer manager
(`libgbm1`). A desktop always has both, which is how the omission goes unnoticed; a minimal
Debian 12, Ubuntu 22.04 or Ubuntu 24.04 does not, and there apt installed the package
cleanly and left a binary that could not load. The
[install job](#installing-what-was-built) found it the first time it ran.

ALSA is written `libasound2t64 | libasound2`, new name first, and the order is the fix for
the second thing the job found. Ubuntu 24.04 renamed the package, and there plain
`libasound2` is only a name that two packages answer to: apt picked
`liboss4-salsa-asound2`, an OSS emulation that lacks half of ALSA, and the binary loaded and
died on `undefined symbol: snd_device_name_get_hint`. Debian 12 and Ubuntu 22.04 have no
`libasound2t64` and take the second name, which is still a real package there.

## The secret scan

`.github/workflows/gitguardian.yml` runs ggshield on every push and every pull request: a
secret that reaches a public repository is public the moment it lands, and deleting it in a
later commit does not take it back. So it scans **every commit a push carries**, not only
the last — a secret added in one commit and removed in the next never shows at the tip, and
is still in the history anyone can read.

That rests on one variable. ggshield builds a push's range from `GITHUB_PUSH_BASE_SHA`, and
the workflow used to set it to `github.event.base`, a field no push event has. ggshield took
the empty string it received for a commit, git answered the range `..HEAD` with nothing, and
the scan fell back to the tip: since the workflow was written, every push of several commits
had all but its last go unscanned, under a green run that said no secrets were found. It was
noticed because a log said `Commits to scan: 1` after a push of three. The variable now gets
`github.event.before`, the commit the push started from.

**`Commits to scan` in the log should match the push.** When it does not, the run is not
covering what its result claims. Pull requests were never affected: ggshield compares them
with their target branch, through a different variable.

## Documentation

The site you are reading is built by `.github/workflows/docs.yml` on every push to `main`
that touches `docs/`, and published to GitHub Pages.

```bash
npm run docs:dev       # local, with hot reload
npm run docs:build
npm run docs:preview
```

### VitePress runs on the project's Vite, not its own

VitePress 1.6.4 depends on Vite 5, and Vite 5 stopped at 5.4.21 — three advisories against
it, and one against the esbuild it carries, have no version to move to. None of it ships:
this is the documentation's build tooling, and the only thing exposed is the local dev
server. But the alerts sit on a public repository's default branch, where an ignored one is
indistinguishable from an unnoticed one.

So `overrides` in `package.json` points VitePress at the Vite the rest of the project
already uses, and at the `@vitejs/plugin-vue` that supports it. The tree then holds one Vite
rather than two, and `npm audit` is clean. The build, the dev server, the Mermaid diagrams
and the home page's download cards were all checked on it — a major version of a bundler
under a tool that pins the previous one is exactly the change that builds and then renders
nothing.

Adding the override is not enough on its own: npm leaves an already-resolved nested tree
alone, reports "up to date", and warns only about the peer. The
`node_modules/vitepress/node_modules/…` entries have to be dropped from `package-lock.json`
before `npm install` will re-resolve them, and the diff should touch nothing outside that
subtree.

VitePress 2 moves off Vite 5 by itself, but it is alpha and asks for Vite 8, and
`vitepress-plugin-mermaid` declares a peer of VitePress ^1. When both have caught up, this
override is the thing to try removing rather than to keep forever.
