---
title: Taking your marks back to the vault
description: Fetch the reading state, the notes and the quotes off a stand as one JSON document - one script per platform, configured from the environment.
---

The library goes out to the stand as files. What you made of it - where you got to, what you wrote, the lines you kept - stays on the stand, in a SQLite file the markdown never touches ([ADR 0002](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0002-content-as-files.md)).

**Exporting** is the way back. `tools/export-marks.sh` and `tools/export-marks.ps1` fetch `GET /api/export` and write it to a file, so a script of your own can fold your notes into the vault the library was published from. One document carries the whole of it: what you read, what you wrote, what you kept, what you marked, what you asked to be written, and where each piece stands in its review schedule.

It is the mirror of [publishing](/rhapsod/guides/publishing-content/), and it is strictly a read: nothing on the stand changes, and running it twice differs only in the file it writes.

## Configuration

Both scripts read the same variables from the environment, and read a `.env` in the repository root if there is one. Values already set in the environment win, so a one-off export from a different stand is a prefix on the command line rather than an edit.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `RHAPSOD_PUBLISH_URL` | no | `http://localhost:8084` | Base URL of the stand to export from. The same variable the publishing scripts use. |
| `RHAPSOD_EXPORT_TO` | no | `./rhapsod-export.json` | Where to write the export document. |
| `RHAPSOD_PASSWORD` | no | - | The reading password, in plain text. Only needed on a [locked stand](/rhapsod/guides/locking-a-stand/). |

`RHAPSOD_PUBLISH_URL` is deliberately reused rather than given an export-specific twin. There is one stand, and a machine that publishes to it is the machine that exports from it; two variables naming the same address would only be an opportunity for them to disagree.

`RHAPSOD_PASSWORD` is the **password**, not the hash. `RHAPSOD_PASSWORD_HASH` is what the server reads; this is what a reader types. They are different values with different homes: the hash belongs on the stand, this belongs on the machine you export from, and neither is ever committed.

These are not server configuration. The server never reads any of them; see [Configuration](/rhapsod/reference/configuration/).

## Exporting

On Linux, macOS, or Git Bash:

```sh
export RHAPSOD_PUBLISH_URL=http://pi:8084
export RHAPSOD_EXPORT_TO=./rhapsod-export.json

./tools/export-marks.sh
```

```
export-marks: fetching http://pi:8084/api/export
export-marks: wrote ./rhapsod-export.json
export-marks: 2 pieces read, 2 notes, 2 quotes, taken at 2026-09-02T11:25:07.935Z
```

On Windows, in PowerShell:

```powershell
$env:RHAPSOD_PUBLISH_URL = 'http://pi:8084'
$env:RHAPSOD_EXPORT_TO = './rhapsod-export.json'

.\tools\export-marks.ps1
```

The PowerShell script is written for Windows PowerShell 5.1, which is what a Windows machine has without installing anything. Both write the same bytes.

The last line is the receipt. It is counted from the file that was actually written, not from what the request was expected to return, so a stand that answered with something other than an export shows up here rather than in whatever reads the file next week.

From a locked stand, add the password and the script signs in first:

```sh
export RHAPSOD_PASSWORD='a good passphrase'
./tools/export-marks.sh
```

```
export-marks: signing in to http://pi:8084
export-marks: fetching http://pi:8084/api/export
export-marks: wrote ./rhapsod-export.json
export-marks: 2 pieces read, 2 notes, 2 quotes, taken at 2026-09-02T11:25:07.935Z
```

Everything about the reading is behind the session on a locked stand, the export included - a stand that handed out your notes to anyone who could reach it would be protecting nothing that matters.

## The document

One JSON object with four keys.

```json
{
  "exported_at": "2026-09-02T22:20:55.648Z",
  "since": null,
  "version": "0.9.2",
  "reading": [
    {
      "piece_id": "19-lyubov-i-pary/abelyar-i-eloiza",
      "status": "read",
      "paragraph": 0,
      "updated_at": "2026-09-02T22:20:55.321Z",
      "read_at": "2026-09-02T22:20:55.321Z"
    },
    {
      "piece_id": "02-istoriya/god-bez-leta",
      "status": "reading",
      "paragraph": 7,
      "updated_at": "2026-09-02T22:20:55.384Z",
      "read_at": null
    }
  ],
  "notes": [
    {
      "piece_id": "02-istoriya/god-bez-leta",
      "body": "Год без лета — и целая эпоха следом.",
      "updated_at": "2026-09-02T22:20:55.444Z"
    },
    {
      "piece_id": "19-lyubov-i-pary/abelyar-i-eloiza",
      "body": "Письма шли дольше, чем длится иная жизнь.",
      "updated_at": "2026-09-02T22:20:55.413Z"
    }
  ],
  "quotes": [
    {
      "id": "1f7c2a3e-5b64-4e21-9a0d-6c8f2b91d4a7",
      "piece_id": "19-lyubov-i-pary/abelyar-i-eloiza",
      "paragraph": 1,
      "text": "Она пишет ему из монастыря.",
      "comment": "Двадцать лет спустя.",
      "created_at": "2026-09-02T22:20:55.490Z"
    },
    {
      "id": "9d3b81c0-2f45-4c88-b7e6-31a0d5e79b62",
      "piece_id": "02-istoriya/god-bez-leta",
      "paragraph": 1,
      "text": "Следующее лето не пришло.",
      "comment": "Тамбора, 1815.",
      "created_at": "2026-09-02T22:20:55.460Z"
    }
  ],
  "reviews": [
    {
      "piece_id": "19-lyubov-i-pary/abelyar-i-eloiza",
      "done": 0,
      "due_on": "2026-09-03",
      "last_seen": null
    }
  ],
  "bookmarks": [
    {
      "piece_id": "02-istoriya/god-bez-leta",
      "kind": "song",
      "marked_at": "2026-09-02T22:20:55.553Z"
    },
    {
      "piece_id": "19-lyubov-i-pary/abelyar-i-eloiza",
      "kind": "loved",
      "marked_at": "2026-09-02T22:20:55.522Z"
    }
  ],
  "requests": [
    {
      "topic_id": "01-paradoksy-i-effekty/paradoks-lzheca",
      "title": "Парадокс лжеца",
      "section": "01 — Парадоксы и эффекты",
      "asked_at": "2026-09-02T22:20:55.585Z"
    }
  ]
}
```

| Key | What it holds |
| --- | --- |
| `exported_at` | The moment the snapshot was taken. What a merge into the vault records as "as of". |
| `version` | The server that produced it. |
| `reading` | One row per piece you have opened. A piece with no row here has not been opened - that status has no storage. |
| `notes` | One row per note. **A piece missing from this list has no note**: an emptied note is deleted rather than kept empty. |
| `quotes` | Every line you kept, newest first. |
| `reviews` | One row per piece in the review schedule. `done` is how many of the three returns you have answered; `due_on` is the day of the next one, and **null when the schedule is finished**. |
| `bookmarks` | One row per marked piece, newest first. `kind` is one of `loved`, `return`, `song`, `reread`; a piece carries at most one. |
| `requests` | One row per topic the reader asked to be written, newest first. Carries the topic's title and shelf as they read when the request was made, so a request outliving its topic is still legible. |

The field meanings are in [the API reference](/rhapsod/reference/api/#get-apiexport); the rules behind them are in [What the reader remembers](/rhapsod/concepts/what-the-reader-remembers/).

## Where the requests go

The marks belong beside their pieces; a **request** does not - it names something that has not been written, so there is no file to sit next to. It belongs wherever the author keeps what to write next.

The ritual the author uses appends them to that file rather than replacing it, and two properties are worth copying into any script that does the same:

- **A request already written down is not written again.** The merge is run often and a request lives on the stand until it is withdrawn, so every run would otherwise add the same line.
- **What is already in the file survives.** The author's own notes share that file; a script that rewrites it wholesale trades a small convenience for the thing it was meant to protect.

## Only what changed

A second run does not need the whole document. `?since=` takes the `exported_at` of the previous one and returns only what has changed:

```sh
curl "http://127.0.0.1:8084/api/export?since=$(cat .last-export)"
```

The bound comes back as `since` in the answer, so a script can tell an incremental document from a full one. The rules for what counts as changed - and the one thing an incremental export cannot report, which is a deletion - are in [the API reference](/rhapsod/reference/api/#get-apiexport).

Keep the stamp only after the merge has succeeded. A stamp saved before the files are written turns a crash halfway into silently skipped marks on the next run.

## Where the marks land

The export is JSON because it has to be exact. What a vault wants is markdown, and the shape that reaches it is a decision about someone's own notes rather than about this software, so it belongs to whoever runs the ritual.

One arrangement that works, and the one the author uses: a **companion file** next to each piece - `Ship of Theseus - notes.md` beside `Ship of Theseus.md` - holding the kept lines, the note, whether the piece was read, and where it stands in its review schedule.

Two properties are worth copying whatever shape you choose:

- **The piece itself is never edited, not even its frontmatter.** The library is the author's; the reading is the reader's. Keeping them in separate files means a ritual that goes wrong can only damage its own output, and republishing a piece never collides with a merge.
- **A piece that cannot be matched is reported, not skipped quietly.** Renaming a file in the vault changes the id the reader's rows are keyed to. A script that silently drops those marks loses them; one that names them lets you fix the rename.

Two things to know before writing a script against it:

- **A quote is anchored by its text, not by an offset.** `text` is the exact words that were selected. Matching them back onto a piece is a search; `paragraph` says where to look first. An edited piece can leave a quote that no longer matches anything - which is the intended failure, because a highlight that moved onto the wrong sentence would be worse.
- **The same line can appear twice.** Two readings can mark the same sentence, each with its own comment, and each is a row with its own `id`. Do not deduplicate by `text`.

Everything is keyed by `piece_id`, which is the piece's path in the library: shelf and file, as slugs. That is what joins a row back to the markdown file it came from.

## What it checks

The export is read back before it replaces anything.

A URL that answers is not the same as a stand that answered. A captive portal, a proxy with an opinion, or simply the wrong port will all return `200` and a body, and a script that wrote that body to the file would replace a good export with a login page - silently, and you would find out the next time you tried to use it.

So the download goes to a temporary file beside the destination, is parsed, and is moved into place only once it has the shape of an export:

```
export-marks: fetching http://127.0.0.1:8096/api/export
export-marks: what came back from http://127.0.0.1:8096 is not an export: check that the URL names a rhapsod server, and that a locked stand got RHAPSOD_PASSWORD
```

The previous export is still there, untouched.

Reading JSON needs a JSON parser, so the shell script requires `jq` or `python` and refuses up front when it has neither - before the request, rather than after downloading a file it cannot vouch for. PowerShell has `ConvertFrom-Json` built in and needs nothing.

## When it refuses

Every requirement is checked before the first request, so a missing tool or a bad path costs nothing.

A destination whose directory does not exist:

```
export-marks: the directory for RHAPSOD_EXPORT_TO does not exist: ./no-such-directory
```

A stand that is not answering:

```
export-marks: the export could not be fetched from http://pi:8084 (a locked stand needs RHAPSOD_PASSWORD)
```

That parenthesis is the common case rather than a guess: a locked stand answers `401`, which looks exactly like any other failed request from the outside, and the missing variable is far more likely than a Pi that has gone away.

The wrong password:

```
export-marks: signing in to http://pi:8084 failed: RHAPSOD_PASSWORD is wrong, or the stand is not answering
```

In every case the file that was there before is left as it was. An export that failed leaves you with the last one that worked, which is the right half-state: a stale snapshot is worth something, and half of one is worth nothing.

## Folding it into the vault

The script stops at the JSON. What to do with it is yours, because the shape of a vault is yours: a note under a heading in the piece it belongs to, a file of quotes per shelf, a daily log of what was finished.

Two things make that script easy to write and are the reason the export looks the way it does:

- **It is one snapshot.** All three kinds are from the same instant, so nothing you write into the vault describes a state the stand was never in.
- **It is a read.** Running it before every merge costs nothing and interrupts nobody, so there is no reason to cache it or to reason about when it was last taken.

Publishing the library again afterwards changes nothing about your marks. They live in the database, keyed to the piece; [publishing](/rhapsod/guides/publishing-content/) only ever writes files.
