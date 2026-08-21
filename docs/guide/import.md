# Import a study

![The first screen](/shots/01-source.png)

Drop a folder, a zip, or a handful of files onto the window — or use **Choose folder** /
**Choose zip**. Zips are expanded into a session temp directory; subfolders are walked, so
pointing at the root of a burned CD is fine.

Nothing is sent anywhere at this stage. Reading, previewing and anonymising all happen on
your machine, and the only network call in the whole app is the upload itself.

## What gets rejected

Files that are not DICOM are skipped silently — a study folder is full of `DICOMDIR`,
viewer executables and readme files, and none of them are worth a warning.

Objects that *are* DICOM but carry no pixel data are rejected at ingest, so they never
appear as a series you could pick: presentation states, structured reports, Philips Raw
Data Storage. Anything else that fails to parse is counted and reported at the top of the
next screen.

## What it reads, and why now

Ingest reads metadata from the **originals**, before anonymisation, because anonymisation
destroys most of it — b-values live in private tags, and `StudyDate` is blanked. This is
the constraint the whole pipeline is arranged around, explained in
[splitting before anonymisation](/internals/splitting).

One Radiopaedia study is created per DICOM study, ordered oldest first. Only the *interval*
between them survives to the upload, pre-filled as "Baseline", "3 months later" and so on.
