# Why upload goes through S3

`POST /api/v1/cases/:id/studies/:id/images` accepts a zip, and it looks like the obvious
route. It is the wrong one for this app.

Radiopaedia rebuilds the series from the DICOM identifiers in that zip. Anonymisation
regenerates UIDs deterministically, so every stack cut out of one original series still
shares its `SeriesInstanceUID` — the zip route would merge the stacks back together and
undo the entire point of [splitting them](/internals/splitting).

So the app uses the route that states series membership explicitly:

```mermaid
sequenceDiagram
  participant App
  participant Radiopaedia
  participant S3
  App->>Radiopaedia: POST /direct_s3_uploads (SHA-256 of each file)
  Radiopaedia-->>App: presigned URLs, valid 15 min
  App->>S3: PUT each file, four at a time, re-signing after ten minutes
  App->>Radiopaedia: POST /image_preparation/:caseId/studies/:studyId/series<br/>(ordered upload ids)
```

Steps 1 and 3 live at the **site root**, not under `/api/v1/`.

A presigned URL lasts 15 minutes, and S3 checks that when a PUT starts, not when it ends.
Four at a time does not keep a big series inside that window — on a slow line the bandwidth
is the limit, not the concurrency, and a cine decoded out of its JPEG can be a gigabyte — so
once the URLs are ten minutes old, the files not yet started are signed again. A `403` from
S3 gets one fresh URL for that file; a second refusal is not about age.

## When something fails

Asking for URLs and putting bytes at one are safe to repeat, and both are tried up to four
times, backing off, on a dropped connection, a server error or a rate limit. Anything else —
a `400`, a refusal — is the request being wrong, and is not sent again.

Creating the case, creating a study and attaching a series are **not** safe to repeat: a
request that reached the server and lost its answer would be made twice. So they are never
retried. Instead the app records each one as it is done, and when an upload stops partway,
pressing **Upload to Radiopaedia** again carries on in the case it created — the studies it
made are reused, the series already attached are skipped, and the one that stopped is sent
again. That costs little: whatever reached S3 the first time comes back as already uploaded.

Without that, a failure left a draft holding half the case, taking a slot of the quota, and
the second attempt made another. The record is forgotten when the selection changes, when
the case is no longer a draft, and when the upload finishes.

## Series order is post order

The series endpoint takes `image_format`, `series.root_index` and the list of upload ids.
There is no position in it, and no endpoint to reorder a case afterwards — so the order the
series appear in is the order they were posted in, one at a time, and that is the only lever
there is. It is why the picker lets a series be
[moved past its neighbour](/guide/choose): the order left there is the order that ships.

`root_index` is not that lever. It is 0-based and picks which frame of the series is shown
as its thumbnail; the middle one is the useful default, and for a single image it has to
be 0.

## The step this app does not take

There is a fourth call in the API — `PUT /api/v1/cases/:id/mark_upload_finished` — and this
app has never made it. The reference explains it as *"To prevent conflicts between edits via
API and via the main site, cases cannot be edited on the site until they are marked 'upload
finished'."*

It is left alone on purpose, for two reasons.

Every case this app uploads **has** to be edited on Radiopaedia afterwards, because plane
and sequence type have no API parameter at all and are tagged on the site. That editing has
worked on every case, unmarked, so whatever the flag guards, it is not stopping the one
thing this app depends on.

And a case that is never marked stays a **draft**, which is what
[adding images to it later](/guide/upload) requires. Marking it might do more than unlock
editing — that is not documented clearly enough to risk on a real case — and publishing one
by accident cannot be undone.
