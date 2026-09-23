---
title: Taking your marks back to the vault
description: Fetch everything the reader left on a stand as one JSON document, and where each kind of mark belongs once it is back among the markdown.
---

The library goes out to the stand as files. What you made of it - where you got to, what you wrote, the lines you kept, the typos you spotted - stays on the stand, in a SQLite file the markdown never touches ([ADR 0002](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0002-content-as-files.md)).

**Exporting** is the way back. `tools/export-marks.sh` and `tools/export-marks.ps1` fetch `GET /api/export` and write it to a file, so a ritual of your own can fold your marks into the vault the library was published from. One document carries the whole of it.

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

## Every kind, and where it lands

The document is one JSON object; its full shape, with an example of every row, is in [the API reference](/rhapsod/reference/api/#get-apiexport). The rules behind the fields are in [What the reader remembers](/rhapsod/concepts/what-the-reader-remembers/).

Every kind the export carries is listed here with the place it belongs once it is back in the vault. A kind with nowhere to go is a mark that rides along in every export and lands nowhere - which is worse than not keeping it, because every run reports success. The test suite asks a real server for its list of kinds and fails if this table is missing one.

| Key | What it holds | Where it lands |
| --- | --- | --- |
| `exported_at` | The moment the snapshot was taken. | The *as of* line of every file the merge writes. |
| `version` | The server that produced it. | The merge's own report, nowhere else. |
| `reading` | One row per piece you have opened. A piece with no row here has not been opened. | The piece's companion file: read on which day, or where you stopped. |
| `notes` | One row per note. **A piece missing from this list has no note**: an emptied note is deleted rather than kept empty. | The piece's companion file, under its own heading. |
| `quotes` | Every line you kept, newest first. | The piece's companion file, and every one of them again in the quote book. |
| `reviews` | One row per piece in the review schedule. `done` is how many of the three returns you have answered; `due_on` is the day of the next one, and **null when the schedule is finished**. | The piece's companion file: how far through, and when next. |
| `bookmarks` | One row per marked piece, newest first. `kind` is one of `loved`, `return`, `song`, `reread`; a piece carries at most one. | The piece's companion file. |
| `reactions` | One row per piece reacted to, newest first. `kind` is `good` or `struck`; a piece carries at most one. | The piece's companion file, one line. |
| `requests` | One row per topic the reader asked to be written, newest first. Carries the topic's title and shelf as they read when the request was made. | Appended to wherever the author keeps what to write next - see [Requests](#requests). |
| `typos` | One row per misspelling reported and not withdrawn. `quoted` is the words as selected; `paragraph` is where they were when spotted, and may have moved since. | A patch file of was / now pairs, applied to the piece on one confirmation - see [Typos](#typos). |
| `openings` | One row per opening of a piece, oldest first - the log the journal is built from. | Only the off-site copy. Nothing in the vault wants them beside a piece; they are there so that a stand rebuilt from the copy keeps its journal. |

## Where the files go

The arrangement that works, and the one the author uses. Nothing in the software depends on it; what it does depend on is described under [The boundary](#the-boundary).

```
library/
├── 02 — History/
│   ├── The Salt Road.md               the piece - never written by the merge
│   └── The Salt Road — notes.md       its companion
└── _Reader/
    ├── Reader.md                      the digest
    ├── Quote book.md                  every kept line, by shelf
    ├── Typos.md                       was / now pairs waiting for a fix
    └── export.json                    the last full export, as it came
```

**A companion file** beside each piece holds everything about the reading of that one piece: whether and when it was read, where it stands in its review schedule, its bookmark and reaction, the lines kept from it with their comments, and the note.

**The reader's directory** holds what is about the reading as a whole rather than one piece:

- **The digest** - what the reading adds up to by month (pieces finished, words, pieces recalled) and **where the reader gives up**, the unfinished pieces ordered by how early they lost the reader. It is not in the export: it comes from [`GET /api/journal`](/rhapsod/reference/api/#get-apijournal) and [`GET /api/report`](/rhapsod/reference/api/#get-apireport), which derive it on the way out. Pass the machine's `offset`, or a piece finished late in the evening is filed under the next day.
- **The quote book** - every kept line in one place, grouped by shelf and piece in reading order, each with its comment. A piece that has left the library keeps its lines, under its id.
- **The typo patches** - see [Typos](#typos).
- **The off-site copy** - the export itself, byte for byte. If the stand dies together with its backups, [`rhapsod restore`](/rhapsod/reference/cli/#rhapsod-restore) rebuilds the reading from it.

The digest, the quote book and the patches are **summaries, rewritten whole on every merge**. The history lives on the stand and in the copy beside them; a summary that was edited by hand would be overwritten by the next run, so they say so at the top.

## The boundary

Three rules hold whatever shape you choose, and each is there because breaking it has cost something.

- **The merge never edits a piece, not even its frontmatter.** The library is the author's; the reading is the reader's. Keeping them in separate files means a ritual that goes wrong can only damage its own output, and republishing a piece never collides with a merge. Fixing a typo is the one change to a piece, and it is a separate step with its own confirmation.
- **The reader's files live in the library directory, not with notes about the project.** They are about the library, travel with it, and are read beside it. A directory whose name starts with `_` is not a shelf: the server skips it when it indexes, so it can be published along with everything else without a digest showing up as a novella. Each generated file still carries a `type` other than `novella` in its frontmatter, the same way a companion does.
- **A piece that cannot be matched is reported, not skipped quietly.** Renaming a file in the vault changes the id the reader's rows are keyed to. A merge that silently drops those marks loses them; one that names them lets you fix the rename.

Match rows to files by asking the stand, not by rebuilding the id. Every row is keyed by `piece_id` - shelf and file, as slugs - and the slug rule lives in the server. [`GET /api/library`](/rhapsod/reference/api/#get-apilibrary) gives each id with its title, which is the `topic` of the file it came from.

## Take the whole export

A merge that **rewrites** a file from what the export says must ask for the whole export, every time.

[`?since=`](/rhapsod/reference/api/#only-what-changed) returns only what changed after a previous `exported_at`, and it is right for a consumer that only appends. It is wrong for a companion file: a piece that gained one quote arrives with one quote, and a companion rebuilt from that has lost every line kept before. An incremental export also cannot report a deletion. The whole export of a personal library is a few hundred rows; taking it every time costs nothing and leaves no way to be stale.

## Requests

A **request** does not belong beside a piece - it names something that has not been written, so there is no file to sit next to. It belongs wherever the author keeps what to write next.

- **A request already written down is not written again.** The merge is run often and a request lives on the stand until it is withdrawn, so every run would otherwise add the same line.
- **What is already in the file survives.** The author's own notes share that file; a merge that rewrites it wholesale trades a small convenience for the thing it was meant to protect.

The request is withdrawn from the stand - `DELETE /api/requests/{shelf}/{topic}` - by whoever writes the piece, not by the merge. Only the author knows it has been done.

## Typos

A typo is the one thing in the export that asks for a change to a piece. It names words, not a position: paragraphs shift whenever a file is edited, so `quoted` is what to search the file for, and `paragraph` is only a hint for the eye.

The author's ritual turns each one into a patch:

1. **The merge finds the words** in the piece's file. Found on exactly one line, that line becomes a pair - *was* and *now*, both the same to begin with - in the patch file. Not found, or found on more than one line, the typo goes into a list at the end of the same file instead, with the reason.
2. **Someone writes the fix** into *now*: the author, or whoever runs the ritual for them. A pair left unchanged is skipped.
3. **One confirmation applies all of them.** A second script shows each change in its context, and with the confirmation replaces *was* with *now* - only if *was* is still on exactly one line of the file, and without touching any other byte, so the encoding and line endings of the piece survive. Then it withdraws the report from the stand, `DELETE /api/typos/{id}`, because withdrawing is how the reader learns it was dealt with.

The fixed piece reaches the stand with the next publish. A report the merge could not place stays on the stand until someone looks, and stays in the list until then.

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

## Two things to know before writing a merge

- **A quote is anchored by its text, not by an offset.** `text` is the exact words that were selected. Matching them back onto a piece is a search; `paragraph` says where to look first. An edited piece can leave a quote that no longer matches anything - which is the intended failure, because a highlight that moved onto the wrong sentence would be worse.
- **The same line can appear twice.** Two readings can mark the same sentence, each with its own comment, and each is a row with its own `id`. Do not deduplicate by `text`.

Publishing the library again afterwards changes nothing about your marks. They live in the database, keyed to the piece; [publishing](/rhapsod/guides/publishing-content/) only ever writes files.
