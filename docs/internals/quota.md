# Quota and taxonomy

## Draft quota

Radiopaedia limits how many draft cases an account may hold. The quota is read at sign-in
and shown in the header, and importing is **blocked before it starts** when the account is
signed out or full — so a full allowance turns up before you import, preview and anonymise
a whole study, rather than at the final API call.

It is re-checked server-side immediately before the case is created, because the renderer's
copy can go stale while you work.

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
