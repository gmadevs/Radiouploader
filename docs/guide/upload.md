# Case details and upload

![The case form](/shots/07-case.png)

This is step four of five. **Series** in the header takes you back to the picker with
everything you chose still there, as does **Back** in the footer.

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

Two studies of the **same day** — a CT and the MR that followed it — are nought days apart
whichever way round they go, so the date cannot order them and `StudyTime` (0008,0030) does.
Where an exporter left that out, the earliest acquisition time in the study is used instead;
where neither says, they keep the order they were read in and can be arranged by hand in
[Choose what to upload](/guide/choose). Only the first of them is captioned "Baseline"; the
rest read **"Same day"**, since the same word under both halves of a same-day comparison
would say nothing about either.

## Upload

While it runs, the bar in the footer measures the upload in **bytes rather than in images**:
forty localisers weigh what one reconstruction does, so a bar counting files says nothing
about how long is left. Under it: how much has gone of how much there is, the speed, and the
time remaining.

The speed is the average over the whole upload rather than the last second — a rate taken
from the file in flight swings by an order of magnitude between a 40 kB localiser and a
12 MB reconstruction, and a time remaining computed from that is one nobody can plan around.
Neither figure appears for the first second or two, while the connection is still being set
up and any number would be wrong. The estimate is rounded and hedged on purpose: it is an
average over a network that is not steady, and "3:47 left" would claim a precision it does
not have.

Radiopaedia deduplicates by hash, so a file it already holds is never sent. Those bytes
count as done and are named separately — *"40 MB already there"* — because a bar that fills
in no time otherwise reads as one that has broken.

![The confirmation](/shots/08-done.png)

The case is created as a **draft**, so nothing is published until you say so on
Radiopaedia. The confirmation links straight to the case editor, which is where the plane and
sequence tags go — the API cannot set those.

Under the hood the upload does not use the zip endpoint — it would merge the stacks back
together and undo the point of the app. See
[why upload goes through S3](/internals/upload).
