# Case details and upload

![The case form](/shots/07-case.png)

## Anonymisation warnings

The card at the top lists fields the anonymiser **kept**. They survive the whitelist
because they carry imaging parameters — `SeriesDescription`, `ContentQualification` — but
they are free text, and a hospital's export can put anything in them. Read them; nothing
else will.

## The case

`Title` and `System` are required, the rest is optional. Two notes on the taxonomy:

- **Modality is a closed enum.** `DSA (angiography)`, not "Angiography", and there is no
  PET-CT value.
- **System ids have gaps.** 5, 10, 13 and 14 are unused, because retired systems keep their
  numbers.

Neither list is served by the API — `/api/v1/systems` and `/api/v1/diagnostic_certainties`
both 404 — so both are transcribed from the API reference in
[`src/shared/radiopaedia.ts`](https://github.com/gmadevs/Radiouploader/blob/main/src/shared/radiopaedia.ts).

::: danger system_id is accepted but never applied
Every case uploaded through this app arrives on Radiopaedia **without a system**, and it
has to be set by hand on the case page. This is server-side, not a bug in this client: a
case uploaded through Radiopaedia's own OsiriX/Horos plugin arrives without one too. The
full investigation is in [system_id is never applied](/notes/system-id-not-applied).
:::

**Plane and sequence type are not settable through the API** either. The series payload
accepts only `image_format`, `series.root_index` and `stack_upload.uploaded_data`. Tag
those on the website afterwards.

## Studies

One Radiopaedia study per DICOM study, oldest first. The study endpoint has no date
parameter, and the real dates are blanked by the anonymiser anyway, so the **interval**
goes in the caption instead — pre-filled as "Baseline", "3 months later", "1.5 years
later". A study whose date could not be read is captioned "Date unknown" rather than given
an invented interval.

## Upload

![The confirmation](/shots/08-done.png)

The case is created as a **draft**, so nothing is published until you say so on
Radiopaedia. The confirmation links straight to the case editor, which is also where you
have to set the system.

Under the hood the upload does not use the zip endpoint — it would merge the stacks back
together and undo the point of the app. See
[why upload goes through S3](/internals/upload).
