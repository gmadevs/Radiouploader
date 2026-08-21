# `system_id` is accepted but never applied

Every case uploaded through this app arrives on Radiopaedia without a system, and it has
to be set by hand on the case page. This records what was tried, so nobody repeats the
investigation.

**Status:** open upstream. Reported to `developers@radiopaedia.org` in August 2026.

## What happens

`POST /api/v1/cases` is sent exactly as the API reference specifies:

```json
{
  "title": "test api",
  "presentation": "",
  "system_id": 3,
  "diagnostic_certainty_id": 2,
  "age": null,
  "gender": null,
  "body": null
}
```

It returns 200 and creates the case:

```json
{
  "id": 242492,
  "title": "test api",
  "author_id": 54625,
  "status": "draft",
  "visibility": "public",
  "created_at": "2026-08-19T11:57:47.916Z",
  "updated_at": "2026-08-19T11:57:47.916Z"
}
```

On the case page **Diagnostic certainty** reads "Probable", as sent. **System** is empty.

## What was ruled out

| | |
|---|---|
| The value | 3 is Central Nervous System in the reference's Systems table, and the id Radiopaedia's own OsiriX plugin uses for it |
| The encoding | JSON body, `application/x-www-form-urlencoded` body, and `system_id` as a query-string parameter — the last being what the OsiriX plugin does — all behave identically |
| Authentication and routing | The case is created, and `diagnostic_certainty_id` from the same request is applied |
| This client | A case uploaded through [jarrelscy/RadiopaediaOsirix](https://github.com/jarrelscy/RadiopaediaOsirix), with a system chosen in its dialog, arrives without one too |

That last row is the decisive one: a second, independent client fails the same way, so no
client-side explanation survives.

## Why it cannot be worked around

- Neither the create response nor `GET /api/v1/cases` returns a system field, so the app
  cannot detect the failure, let alone warn about a specific case.
- There is no `PUT` or `PATCH` on `/api/v1/cases/:id` — probed and confirmed 404, against
  a calibration where existing routes answer 401 unauthenticated — so a case created
  without a system cannot be corrected through the API either.

## What the app does instead

`createCase` still refuses to run without a system, because the reference calls it
required and the value may start working without notice. The upload confirmation states
that the system has to be set by hand and links straight to the case editor.

## If it starts working

Delete this file and the warning in `App.tsx`. Nothing else needs changing: the parameter
is already being sent correctly.
