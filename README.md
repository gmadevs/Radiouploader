# Radiopaedia Uploader

Desktop app for preparing and uploading cases to [Radiopaedia.org](https://radiopaedia.org).
Reads a folder or zip of DICOM files, splits multiphase / diffusion / SWI series into
selectable stacks, anonymises with Radiopaedia's reference anonymiser, and uploads the
result as a draft case.

Runs on macOS, Linux and Windows (Electron).

## Why the series splitting happens before anonymisation

The Radiopaedia anonymiser applies a **whitelist**: every element is stripped unless
explicitly permitted, and all private tags go. Most vendors store diffusion b-values in
private tags (Siemens `0019,100C`, GE `0043,1039`, Philips `2001,1003`), so that
information exists only in the originals.

The pipeline therefore reads and groups first, anonymises last:

```
scan → parse metadata → group into studies/series/stacks → user selects → anonymise → upload
```

Splitting is applied along every dimension that actually varies inside a series, because
they co-occur in practice — an SWI series carries magnitude, phase, SWI and mIP; a
diffusion series carries several b-values plus the ADC map:

| Dimension | Source |
|---|---|
| Magnitude / phase / SWI / mIP / ADC | `ImageType` (0008,0008), `ComplexImageComponent` (0008,9208) |
| b-value | `(0018,9087)`, then the Siemens / GE / Philips private tags |
| Echo | `EchoNumbers` (0018,0086) |
| Time point | `TemporalPositionIdentifier` (0020,0100), or repeated slice positions ordered by `TriggerTime` / `AcquisitionTime` |

Defaults are chosen so the common case needs no clicking: phase/real/imaginary maps are
off, the highest b-value and the ADC map are on, and **every** time point of a dynamic
series stays on — dropping phases is a deliberate act, so the UI offers a "Keep one phase"
button rather than doing it silently.

## Multi-study cases and the interval between studies

A case can carry several studies, and for a follow-up the spacing between them is the
point. `StudyDate` (0008,0020) is blanked by the anonymiser exactly like the private
tags, so it is read during ingest and only the **interval** survives.

The study endpoint has **no date parameter** — the documented fields are `modality`,
`findings`, `position` and `caption` — so ordering is carried by `position` (1 is reserved
for the case discussion, studies start at 2) and the interval goes in the caption,
pre-filled as "Baseline", "3 months later", "1.5 years later". A study whose date could not
be read is captioned "Date unknown" rather than given an invented interval.

One Radiopaedia study is created per DICOM study, oldest first, and each selected stack
becomes a series on the right one.

## Why upload goes through S3 rather than the zip endpoint

`POST /api/v1/cases/:id/studies/:id/images` accepts a zip, but Radiopaedia then rebuilds
the series from the DICOM identifiers. Anonymisation regenerates UIDs deterministically,
so every stack cut out of one original series still shares its `SeriesInstanceUID` — the
zip route would merge the stacks back together and undo the whole point of the app.

The app instead uses the route that states series membership explicitly:

1. `POST /direct_s3_uploads` with the SHA-256 of each file → presigned URLs (valid 900 s)
2. `PUT` each file to S3, 4 concurrent
3. `POST /image_preparation/:caseId/studies/:studyId/series` with the ordered upload ids
4. `PUT /api/v1/cases/:id/mark_upload_finished`

## Quota and taxonomy

The draft-case quota (`/api/v1/users/current`) is read at sign-in and shown in the header.
Importing is blocked before it starts when the account is signed out or the quota is full,
so a full allowance is discovered up front rather than after importing, previewing and
anonymising a whole study. The quota is re-checked against the server immediately before
the case is created, because the renderer's copy can be stale.

System, diagnostic certainty and modality are chosen on the case form. None of these lists
is served by the API, so they are transcribed in `src/shared/radiopaedia.ts` from the API
reference. The system ids have gaps (5, 10, 13, 14 are unused) because retired systems keep
their numbers, and modality is a closed enum — `DSA (angiography)` rather than
"Angiography", and there is no PET-CT value.

An `allowed_draft_cases` of `null` means an unlimited allowance, not zero.

## Setup

Create an application at <https://radiopaedia.org/api-documentation> → *Manage your
applications* → *New Application*:

- **Redirect URI**: `urn:ietf:wg:oauth:2.0:oob`

**Do not send a scope.** The API reference never passes a `scope` parameter and neither
does Radiopaedia's own uploader — permitted scopes are declared on the application itself.
Requesting one explicitly answers "The requested scope is invalid, unknown, or malformed".

Radiopaedia's form requires an https redirect URI and rejects a plain
`http://127.0.0.1:…` loopback, so the usual RFC 8252 native-app pattern is not available.
Their form points at the out-of-band URN instead: the app opens the authorization page in
your browser, Radiopaedia displays a code, and you paste it back into the app. PKCE is
sent either way.

If you do register an https redirect URI, the app detects it and uses the loopback
listener automatically — no code to copy.

Paste the Application ID and secret into the sign-in panel in the app header. Tokens are
stored encrypted through the OS keychain (Keychain / libsecret / DPAPI).

### Distributing builds

**No credentials are compiled into the app.** The Application ID and secret are entered at
runtime and stored per-user in the OS keychain, so a build can be handed to anyone without
sharing yours — each person registers their own application, and each signs in to their
own Radiopaedia account.

Do not embed your own credentials to save users that step. A client secret shipped inside
a desktop binary is trivially extractable and stops being a secret (RFC 8252 §8.5), any
per-application rate limit would then be shared by every user, and a single revocation
would break all installs.

If Radiopaedia's application form offers a *Confidential* checkbox, unticking it creates a
public client with no secret. Client ids are not secret, so that variant could be shipped
embedded and would rely on PKCE alone — which this app already sends. The secret field is
optional for exactly this reason.

## Development

```bash
npm install
npm run dev        # hot-reloading Electron
npm test           # unit + anonymiser integration tests
npm run typecheck
npm run smoke      # boots the built renderer, fails on console errors, writes smoke.png
```

## Packaging

```bash
npm run dist:mac     # dmg, arm64 + x64
npm run dist:linux   # AppImage + deb, x64 + arm64
npm run dist:win     # nsis — build this one on a Windows runner
```

macOS distribution needs an Apple Developer ID for signing and notarisation; without it
the dmg still installs but Gatekeeper warns. Windows builds are easiest on a CI runner
(GitHub Actions `windows-latest`) if you have no Windows machine.

## Known limitations

- **Burnt-in text is not detected.** The anonymiser cannot touch pixel data, so review
  the images in the picker before uploading. This is why the app shows previews.
- **Only uncompressed DICOM previews.** Explicit and implicit VR little endian and
  explicit VR big endian all render; JPEG, JPEG-LS, JPEG 2000, HTJ2K and RLE are named in
  the placeholder instead of being mis-rendered. Adding them means pulling in the
  standalone `@cornerstonejs/codec-*` WASM packages, which — unlike
  `@cornerstonejs/dicom-image-loader` — do not depend on `@cornerstonejs/core`. Upload is
  unaffected: compressed files are still anonymised and sent, only the preview is blank.
- **Multiframe objects** (cine runs, enhanced MR) are expanded to one previewable frame
  each, but a multiframe dynamic series is not split into phases: the per-frame functional
  groups that carry the time axis are not unpacked yet.
- The app requests only the `cases` scope and never writes patient data outside the
  session temp directory, which is removed on reset and on quit.

## Licence

AGPL-3.0-only. The app links [radiopaedia/dicom-anonymiser](https://github.com/radiopaedia/dicom-anonymiser),
which is AGPL-3.0-only, so the combined work is too — if you distribute a build, publish
the source.
