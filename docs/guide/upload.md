# Case details and upload

![The case form](/shots/07-case.png)

## Anonymisation warnings

The card at the top lists fields the anonymiser **kept**. They survive the whitelist
because they carry imaging parameters — `SeriesDescription`, `ContentQualification` — but
they are free text, and a hospital's export can put anything in them. Read them; nothing
else will.

## Where the images go

The step opens by asking that, because there are two answers.

**A new case** is the usual one: the details below become a new draft, and it counts against
your draft quota.

**An existing draft** adds the studies to a case you already have on Radiopaedia. The list
comes from `GET /api/v1/cases`, which returns your own cases; only the **drafts** are
offered, because a case that has gone for review or been published is closed to the API and
refuses new imaging. The list is read when the step opens, and **Refresh** reads it again —
a case can be published on the site while you are working.

Adding to a draft leaves everything else about it alone. Its title, age, gender, system and
discussion stay as they are: the API has no way to change them, so edit those on
Radiopaedia. The studies arrive as new studies on the case.

There is no way to see what the case already holds — the API has no endpoint that lists a
case's existing studies — so a study you have already uploaded will arrive twice if you
upload it twice.

## The case

`Title` and `System` are required, the rest is optional. Three notes on the taxonomy:

- **Age is a list, not a number.** Every year up to 18, then every fifth year to 100, and
  nothing below a year — the values the site itself offers. A patient younger than that
  goes up with the age not stated.
- **Modality is a closed enum.** `DSA (angiography)`, not "Angiography", and there is no
  PET-CT value.
- **System ids have gaps.** 5, 10, 13 and 14 are unused, because retired systems keep their
  numbers.

Neither list is served by the API — `/api/v1/systems` and `/api/v1/diagnostic_certainties`
both 404 — so both are transcribed from the API reference in
[`src/shared/radiopaedia.ts`](https://github.com/gmadevs/Radiouploader/blob/main/src/shared/radiopaedia.ts).

**Age and sex arrive filled in** when the originals said so. `PatientAge` (0010,1010) is
preferred, and `PatientBirthDate` (0010,0030) against the study date is the fallback; the
result is rounded to the nearest value on the list, ties going to the younger one. Sex is
offered only where Radiopaedia has the word: `M` and `F` become Male and Female, and `O`
becomes nothing.

Both are read at ingest, because anonymisation removes them — and both are only a
suggestion. Change either and it stays changed; a case with several studies is filled from
the earliest, since the age a case presents at is the age at baseline. Under a year the
field is left empty rather than rounded up: the list has no way to say four months, and
"1 year" would be a fact invented by arithmetic.

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
Radiopaedia. The confirmation links straight to the case editor, which is where the plane and
sequence tags go — the API cannot set those.

Under the hood the upload does not use the zip endpoint — it would merge the stacks back
together and undo the point of the app. See
[why upload goes through S3](/internals/upload).
