---
title: The library
description: What rhapsod serves - a directory of markdown with frontmatter, published from where it is written, and never edited by the reader.
---

The library is a directory. Every file in it is a piece of content: markdown, with a YAML frontmatter block that says what the piece is.

```markdown
---
type: novella
section: the-first-shelf
topic: beginnings
written: 2026-09-02
words: 1840
---

The text begins here.
```

| Field | Meaning |
| --- | --- |
| `type` | What kind of piece this is - a novella, a note, whatever the author's vault distinguishes. |
| `section` | Where it sits on the shelf: the grouping the reader browses by. |
| `topic` | What it is about; a second axis for finding things. |
| `written` | When it was written. Ordering within a section follows it. |
| `words` | Its length, so the reader can say how long a piece is before opening it. |

## Where it comes from

The files are written elsewhere - in a vault, in an editor, wherever writing happens - and **published** to the directory the server reads. Publishing is copying; rhapsod has no opinion about the tool that does it.

## What the server does with it

It reads. It builds an index of what is there, serves the pieces to the app, and remembers what you did with them - where you stopped, what you marked, what you wrote in the margin. All of that lives in the database, keyed to the piece, and none of it is written back into the directory ([ADR 0002](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0002-content-as-files.md)).

Re-publishing the library - a corrected piece, a new one, one removed - changes what is on the shelf and nothing about your reading of it.

## What it is not

It is not a wiki and not an editor. The place to change a text is where it was written; the reader shows it, keeps your place, and brings the lines you marked back to you on a schedule.
