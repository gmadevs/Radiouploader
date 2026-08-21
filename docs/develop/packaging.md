# Packaging and release

```bash
npm run dist:mac     # dmg, arm64 + x64
npm run dist:linux   # AppImage + deb, x64 + arm64
npm run dist:win     # nsis
```

All three also run on CI. `.github/workflows/build.yml` builds every platform on its own
runner and uploads the installers as artifacts; pushing a `v*` tag additionally drafts a
release with them attached.

It is triggered manually or by a tag rather than on every push, because macOS and Windows
runners bill at 10x and 2x — a habit worth keeping even now the repository is public and
the minutes are free.

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

`GH_TOKEN` is deliberately **not** set: electron-builder would then publish a release
itself rather than leaving the files as artifacts for the release job to attach to a draft.

## Documentation

The site you are reading is built by `.github/workflows/docs.yml` on every push to `main`
that touches `docs/`, and published to GitHub Pages.

```bash
npm run docs:dev       # local, with hot reload
npm run docs:build
npm run docs:preview
```
