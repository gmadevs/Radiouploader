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

macOS can install this with `brew install --cask --no-quarantine
gmadevs/radiouploader/radiouploader`, from
[gmadevs/homebrew-Radiouploader](https://github.com/gmadevs/homebrew-Radiouploader) rather
than from `homebrew/cask`. The official repository asks a project to be notable before it
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
takes a fine-grained PAT with *Contents: write* on `homebrew-Radiouploader`, kept as the
`TAP_TOKEN` secret. Without it the job stops with a message that says so, rather than failing
inside git.

Two things about that repository are worth knowing. Homebrew lower-cases a tap name, so
`gmadevs/radiouploader` resolves to `homebrew-radiouploader` and reaches the repository only
because GitHub is case-insensitive about names; renaming it to `homebrew-radiouploader` would
remove the doubt. And the cask is checked before it ships — `brew style` on it is clean,
which is what catches a deprecated `depends_on` form or a stanza in the wrong order.

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

Cutting it out by hand would work once and go stale the day the artwork changes, which is
the same argument the [screenshots](/develop/screenshots) are generated for.

## Signing

Neither platform is signed:

- **macOS** needs an Apple Developer ID ($99/year) for signing and notarisation. Without
  one the dmg installs fine, but Gatekeeper refuses the first launch — right-click → Open,
  or `xattr -dr com.apple.quarantine /Applications/Radiouploader.app`.
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
