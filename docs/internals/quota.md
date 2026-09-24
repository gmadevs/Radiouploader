# Quota and taxonomy

## Draft quota

Radiopaedia limits the number of draft cases an account can have. The app reads the quota at
sign-in and shows it in the header.

If you are not signed in, the app does not import a study. A full quota does not stop the
import: it stops only the creation of a new case, and you can still
[add the images to an existing draft](/guide/upload#where-the-images-go). When the quota is
full and you have drafts, the case step opens with the first draft already selected.

The app checks the quota with Radiopaedia again just before it creates a case, because the
quota can change while you work, for example if you create a draft on the website. Adding to
an existing draft creates no case, so it is not checked.

An `allowed_draft_cases` value of `null` means the quota is unlimited, not zero.

## Taxonomy

System, diagnostic certainty and modality are chosen on the case form. The API does not
provide these lists (`/api/v1/systems` and `/api/v1/diagnostic_certainties` return 404), so
they are copied from the API reference into
[`src/shared/radiopaedia.ts`](https://github.com/gmadevs/Radiouploader/blob/main/src/shared/radiopaedia.ts).

- The system IDs have gaps: 5, 10, 13 and 14 are not used, because retired systems keep their
  numbers.
- Modality accepts only the listed values, for example `DSA (angiography)` and not
  "Angiography". There is no PET-CT value.

## What cannot be set through the API

The API has no parameter for plane or sequence type: the series request accepts only
`image_format`, `series.root_index` and `stack_upload.uploaded_data`. Add plane and sequence
type on Radiopaedia after the upload.
