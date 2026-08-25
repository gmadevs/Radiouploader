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
  App->>S3: PUT each file, four at a time
  App->>Radiopaedia: POST /image_preparation/:caseId/studies/:studyId/series<br/>(ordered upload ids)
```

Steps 1 and 3 live at the **site root**, not under `/api/v1/`.

Because the presigned URLs expire after 15 minutes, a very large case is uploaded in
batches rather than requesting every URL up front.

## The step this app does not take

There is a fourth call in the API — `PUT /api/v1/cases/:id/mark_upload_finished` — and this
app has never made it. The reference explains it as *"To prevent conflicts between edits via
API and via the main site, cases cannot be edited on the site until they are marked 'upload
finished'."*

It is left alone on purpose, for two reasons.

Every case this app uploads **has** to be edited on Radiopaedia afterwards, because
[`system_id` is accepted and never applied](/notes/system-id-not-applied) and the system has
to be set by hand. That editing has worked on every case, so whatever the flag guards, it is
not stopping the one thing this app depends on.

And a case that is never marked stays a **draft**, which is what
[adding images to it later](/guide/upload) requires. Marking it might do more than unlock
editing — that is not documented clearly enough to risk on a real case — and publishing one
by accident cannot be undone.
