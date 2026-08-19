# Radiouploader

A desktop app for preparing and uploading cases to [Radiopaedia.org](https://radiopaedia.org).

Point it at a folder, a zip or a handful of DICOM files. It reads the study, splits the
series that contain more than one acquisition — multiphase, diffusion, SWI — lets you pick
what to keep, anonymises everything with Radiopaedia's reference anonymiser, and uploads
the result as a draft case.

Runs on macOS, Linux and Windows.

> Unofficial. Not affiliated with or endorsed by Radiopaedia.org.

---

## Why the series splitting happens before anonymisation

This is the constraint the whole pipeline is built around.

Radiopaedia's anonymiser applies a **whitelist**: every element is stripped unless
explicitly permitted, and all private tags go. Most vendors keep diffusion b-values in
private tags — Siemens `(0019,100C)`, GE `(0043,1039)`, Philips `(2001,1003)` — and
`StudyDate` is blanked too. That information exists only in the originals.

So the pipeline reads and groups first, and anonymises last:

```
scan → read metadata → group into studies/series/stacks → you choose → anonymise → upload
```

Get that order wrong and the app can no longer tell a b=0 image from a b=1000 one.

### How series are split

A series is split along every dimension that actually varies inside it, because they
co-occur in practice: an SWI series carries magnitude, phase, SWI and mIP; a diffusion
series carries several b-values plus the ADC map.

| Dimension | Read from |
|---|---|
| Magnitude / phase / SWI / mIP / ADC | `ImageType` (0008,0008), `ComplexImageComponent` (0008,9208) |
| b-value | `(0018,9087)`, then the Siemens / GE / Philips private tags |
| Echo | `EchoNumbers` (0018,0086) |
| Time point | `TemporalPositionIdentifier` (0020,0100), or repeated slice positions ordered by `TriggerTime` / `AcquisitionTime` |

Defaults are chosen so the common case needs no clicking: phase, real and imaginary maps
are off; the highest b-value and the ADC map are on; and **every** time point of a dynamic
series stays on — dropping phases is a deliberate act, so there is a "Keep one phase"
button rather than a silent default.

Multiframe objects — cine runs, enhanced MR — are expanded to one scrubbable frame each.
Objects with no pixel data (presentation states, structured reports, Philips Raw Data
Storage) are rejected at ingest so they never appear as series to upload.

### Trimming

Each stack has a **Trim** control for choosing the first and last image to keep, so the
dead ends of a series can be dropped without deselecting it. Moving either handle jumps
the preview to that image, and anything outside the range is dimmed and tagged. Trimmed
images are never decoded, written out or uploaded.

---

## Multi-study cases

A case can carry several studies, and for a follow-up the spacing between them is the
point. `StudyDate` is blanked by the anonymiser, so it is read during ingest and only the
**interval** survives.

The study endpoint has no date parameter — the documented fields are `modality`,
`findings`, `position` and `caption` — so ordering is carried by `position` (1 is reserved
for the case discussion, studies start at 2) and the interval goes in the caption,
pre-filled as "Baseline", "3 months later", "1.5 years later". A study whose date could not
be read is captioned "Date unknown" rather than given an invented interval.

One Radiopaedia study is created per DICOM study, oldest first, and each selected stack
becomes a series on the right one.

---

## Why upload goes through S3 rather than the zip endpoint

`POST /api/v1/cases/:id/studies/:id/images` accepts a zip, but Radiopaedia then rebuilds
the series from the DICOM identifiers. Anonymisation regenerates UIDs deterministically, so
every stack cut out of one original series still shares its `SeriesInstanceUID` — the zip
route would merge the stacks back together and undo the point of the app.

So it uses the route that states series membership explicitly:

1. `POST /direct_s3_uploads` with the SHA-256 of each file → presigned URLs, valid 15 min
2. `PUT` each file to S3, four at a time
3. `POST /image_preparation/:caseId/studies/:studyId/series` with the ordered upload ids
4. `PUT /api/v1/cases/:id/mark_upload_finished`

Steps 1 and 3 live at the site root, not under `/api/v1/`.

---

## Setup

Register an application at [radiopaedia.org/oauth/applications/new](https://radiopaedia.org/oauth/applications/new):

- **Redirect URI**: `urn:ietf:wg:oauth:2.0:oob`
- **Scope**: leave it alone — see below

Radiopaedia's form requires an https redirect URI and rejects a plain `http://127.0.0.1:…`
loopback, so the usual RFC 8252 native-app pattern cannot be registered. The out-of-band
URN is what their form points at: the app opens the authorization page in your browser,
Radiopaedia shows you a code, and you paste it back. PKCE is sent either way.

**Do not request a scope.** The API reference never passes a `scope` parameter and neither
does Radiopaedia's own uploader; permitted scopes are declared on the application itself.
Requesting one explicitly answers *"The requested scope is invalid, unknown, or malformed"*.

Then paste the Application ID and secret into the sign-in panel in the app header. Tokens
are stored encrypted through the OS keychain — Keychain on macOS, libsecret on Linux,
DPAPI on Windows — and never written in the clear.

If you do register an https redirect URI, the app detects it and uses a loopback listener
instead, with no code to copy.

### Distributing builds

**No credentials are compiled into the app.** The Application ID and secret are entered at
runtime and stored per-user, so a build can be handed to anyone without sharing yours —
each person registers their own application and signs in to their own account.

Do not embed your own credentials to save users that step. A client secret shipped inside a
desktop binary is trivially extractable and stops being a secret ([RFC 8252 §8.5](https://datatracker.ietf.org/doc/html/rfc8252#section-8.5)),
any per-application rate limit would then be shared by every user, and one revocation would
break every install. If the application form offers a *Confidential* checkbox, unticking it
creates a public client with no secret — client ids are not secret, so that variant could
ship embedded and rely on PKCE alone, which this app already sends.

---

## Quota and taxonomy

The draft-case quota is read at sign-in and shown in the header. Importing is blocked
before it starts when the account is signed out or the quota is full, so a full allowance
turns up before you import, preview and anonymise a whole study rather than at the final
API call. It is re-checked server-side immediately before the case is created, because the
renderer's copy can go stale. An `allowed_draft_cases` of `null` means unlimited, not zero.

System, diagnostic certainty and modality are chosen on the case form. None of these lists
is served by the API — `/api/v1/systems` and `/api/v1/diagnostic_certainties` both 404 — so
they are transcribed in [`src/shared/radiopaedia.ts`](src/shared/radiopaedia.ts) from the
API reference. The system ids have gaps (5, 10, 13 and 14 are unused) because retired
systems keep their numbers, and modality is a closed enum: `DSA (angiography)`, not
"Angiography", and there is no PET-CT value.

**`system_id` is accepted but never applied.** It is sent exactly as the API reference
specifies and the request returns 200, but the case is created with no system, while
`diagnostic_certainty_id` in the very same request is applied. All three deliveries behave identically: a JSON body, a form-encoded body, and
query-string parameters as Radiopaedia's own OsiriX plugin sends them. The encoding is not
the variable, so the client stays on the documented JSON contract. Neither the create
response nor the listing endpoint returns a system field, and there is no `PUT`/`PATCH` on
`/api/v1/cases/:id`, so a client can neither verify nor correct it. The upload confirmation says so and
links straight to the case editor.

**Plane and sequence type are not settable through the API.** The series payload accepts
only `image_format`, `series.root_index` and `stack_upload.uploaded_data`. Tag those on the
website after uploading.

---

## Development

```bash
npm install
npm run dev        # hot-reloading Electron
npm test           # unit tests plus anonymiser and decoder integration tests
npm run typecheck
npm run smoke      # boots the built app, fails on console errors, writes smoke.png
```

`npm run smoke` refuses to run when `out/` is older than `src/` — a failed build leaves the
previous bundle in place, and testing that instead reports success for code that does not
compile.

### Layout

```
src/main/ingest/    scan folders and zips, read metadata, group into stacks
src/main/anon/      the anonymiser, in a worker thread
src/main/api/       OAuth, case and study creation, S3 upload
src/shared/         types, the DICOM decoder, Radiopaedia's taxonomy
src/renderer/       the wizard UI
```

Patient data lives only in the main process. The renderer has no Node access and reaches
the filesystem solely through the IPC bridge, which serves only files belonging to the
current import — and serves decoded, preview-sized frames rather than files, because a cine
run is routinely 250 MB and moving one across the bridge costs three copies of it. Originals and anonymised output are written to a session temp directory
that is removed on reset and on quit.

### Packaging

```bash
npm run dist:mac     # dmg, arm64 + x64
npm run dist:linux   # AppImage + deb, x64 + arm64
npm run dist:win     # nsis
```

All three also run on CI. `.github/workflows/build.yml` builds every platform on its own
runner and uploads the installers as artifacts; pushing a `v*` tag additionally drafts a
release with them attached. It is triggered manually or by a tag rather than on every push,
because macOS and Windows runners bill at 10x and 2x on a private repository.

Neither platform is signed on CI:

- **macOS** needs an Apple Developer ID ($99/year) for signing and notarisation. Without
  one the dmg installs fine, but Gatekeeper refuses the first launch — right-click → Open,
  or `xattr -dr com.apple.quarantine /Applications/Radiouploader.app`.
- **Windows** needs an Authenticode certificate. Without one SmartScreen warns until the
  binary builds reputation — More info → Run anyway.
- **Linux** needs nothing. The AppImage runs on any distribution after `chmod +x`; the deb
  targets Debian and Ubuntu.

---

## Known limitations

- **Burnt-in text is not detected.** The anonymiser cannot touch pixel data, so review the
  images in the picker before uploading. That is why the app shows previews at all.
- **Previews decode uncompressed DICOM only.** Explicit and implicit VR little endian and
  explicit VR big endian all render; JPEG, JPEG-LS, JPEG 2000, HTJ2K and RLE are named in
  the placeholder instead of being mis-rendered. Upload is unaffected — compressed files
  are still anonymised and sent, only the preview is blank. Adding them means pulling in
  the standalone `@cornerstonejs/codec-*` WASM packages, which unlike
  `@cornerstonejs/dicom-image-loader` do not depend on `@cornerstonejs/core`.
- **Multiframe dynamic series are not split into phases.** The per-frame functional groups
  that carry the time axis are not unpacked yet.

---

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

The DICOM fixtures under `src/main/anon/__fixtures__/` come from that same repository.
