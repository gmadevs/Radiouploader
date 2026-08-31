# Security policy

## Reporting a vulnerability

Report it privately, either way:

- **GitHub**, through [private vulnerability reporting](https://github.com/gmadevs/Radiouploader/security/advisories/new) — the report stays between us until there is a fix to publish.
- **Email**, to <gmadeveloping+radiouploader@gmail.com>, if you would rather not use GitHub or the form above is not available.

Please do not open a public issue for a vulnerability. Everything else — a crash, a
series that will not import, a mask in the wrong place — belongs in
[Issues](https://github.com/gmadevs/Radiouploader/issues) where anyone can help.

### Never attach a real study

**Do not send DICOM files from a real patient**, or screenshots of them, to a report or
an advisory. A report reaches an inbox and, once an advisory is published, a page anyone
can read; neither is a place identifiable data can be taken back out of.

If a demonstration needs images, `npm run sample` writes a synthetic study to
`.sample-study/` — generated pixels, invented tags, no patient — and it reproduces most
of what the app does. A tag name, an offset and a hex dump of the bytes that matter say
more than a file anyway.

### What to expect

One person maintains this, so these are honest intentions rather than a contract: an
acknowledgement within **7 days**, and an assessment — what it affects, whether it is
being fixed, and roughly when — within **14 days**. A fix ships as a release, with the
advisory published alongside it and credit to you unless you ask otherwise. If a report
turns out not to be a vulnerability, you will be told why rather than left waiting.

## Supported versions

The latest release, and nothing else. There is one maintainer and no long-term branches;
a fix goes into the next release rather than back into an older one.

| Version | Supported |
| ------- | --------- |
| 1.1.x   | ✅ |
| < 1.1   | ❌ — update instead |

## In scope

The things this app could get wrong that would matter:

- **Identifiable data leaving the machine.** Anything that would send a study, a path, a
  tag or a filename anywhere other than the Radiopaedia upload the user asked for.
- **Identifiable data surviving into an upload.** A tag the anonymiser is not asked to
  remove, a mask or crop that is written to the wrong pixels, a compressed image whose
  redaction does not reach the samples, a temp file left behind after a session.
- **Credentials.** The OAuth application secret and the tokens, which are entered at
  runtime and kept in the OS keychain — reading them back out, or getting them written
  in the clear.
- **The bridge.** Anything that lets the renderer read a file outside the current import,
  or reach the network directly, through the preload API.
- **The build.** A dependency or a workflow that could put something in a release that
  is not in this repository.

## Out of scope

- **Radiopaedia.org itself.** Report anything about the site or the API to Radiopaedia,
  not here.
- **[radiopaedia/dicom-anonymiser](https://github.com/radiopaedia/dicom-anonymiser).**
  This app links their reference anonymiser; a defect in the anonymiser belongs in its
  own repository. What belongs here is this app calling it wrongly, or working around it.
- **Unsigned binaries.** Gatekeeper and SmartScreen warn because there is no Developer ID
  and no Authenticode certificate. That is known, documented in
  [install](https://gmadevs.github.io/Radiouploader/guide/install), and not a report.
- **The burn-in check missing text.** It finds obvious banners and misses small print,
  text over anatomy and anything on the images it did not read. That is a
  [known limitation](https://gmadevs.github.io/Radiouploader/limitations) stated
  everywhere the app mentions the check — the app never reports a selection as clean.
  A case where it reports something *as* clean is a bug, and worth sending.
