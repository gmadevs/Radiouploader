# Quota and taxonomy

## Draft quota

Radiopaedia limits how many draft cases an account may hold. The quota is read at sign-in
and shown in the header.

Being signed out blocks the import before it starts. A **full quota does not**: it blocks
only the creation of a new case, and the case step then offers
[adding to a draft](/guide/upload) instead — which is exactly what someone with five drafts
open and one to finish is trying to do. The step opens on that choice when there is no room
for a new case.

The quota is re-checked server-side immediately before a case is created, because the
renderer's copy can go stale while you work. Adding to an existing draft skips that check,
because it creates no case.

An `allowed_draft_cases` of `null` means **unlimited**, not zero.

## Taxonomy

System, diagnostic certainty and modality are chosen on the case form. None of these lists
is served by the API — `/api/v1/systems` and `/api/v1/diagnostic_certainties` both 404 — so
they are transcribed in
[`src/shared/radiopaedia.ts`](https://github.com/gmadevs/Radiouploader/blob/main/src/shared/radiopaedia.ts)
from the API reference.

Two things to know about that transcription:

- The system ids have **gaps** — 5, 10, 13 and 14 are unused, because retired systems keep
  their numbers.
- Modality is a **closed enum**: `DSA (angiography)`, not "Angiography", and there is no
  PET-CT value.

## What cannot be set through the API

`system_id` is accepted and never applied — see
[the investigation](/notes/system-id-not-applied).

Plane and sequence type have no parameter at all. The series payload accepts only
`image_format`, `series.root_index` and `stack_upload.uploaded_data`. Tag those on the
website after uploading.
