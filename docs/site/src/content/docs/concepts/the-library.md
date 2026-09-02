---
title: The library
description: What rhapsod serves - section directories of markdown with frontmatter, published from where it is written, and never edited by the reader.
---

The library is a directory of directories. Each one is a **section** - a shelf - and the markdown files in it are the **pieces** on that shelf.

```
library/
├── 02 — История/
│   └── Год без лета.md
└── 19 — Любовь и пары/
    ├── Абеляр и Элоиза.md
    └── Орфей и Эвридика.md
```

## Section directories

A section directory is named `NN — Title`, with an em dash: the number orders the shelves, the title is what a reader sees.

```
19 — Любовь и пары
```

A directory that does not follow that shape is still a section - it is named after itself and sorts after every numbered one. A section directory holding no readable pieces is not a shelf at all and never appears: empty directories exist in a vault the moment a section is created, and a shelf with nothing on it is noise in the app.

## A piece

A piece is a markdown file with a flat YAML frontmatter block, then prose, then up to three named trailing blocks.

```markdown
---
type: novella
section: 19 — Любовь и пары
topic: Абеляр и Элоиза
written: 2026-09-01
words: 1012
source: ""
songs: []
---

# Абеляр и Элоиза

Париж, около 1132 года.

---

Она пишет ему из монастыря.

## Соседи

- Орфей и Эвридика — другая пара.
- Данте и Беатриче — любовь в тексте.

## Одной строкой

**«Ради него, а не ради Бога».**

## Для песни

- **Ситуация:** она осталась.
- **Образ:** покрывало у алтаря.
```

### Frontmatter

| Field | Meaning |
| --- | --- |
| `type` | What kind of piece this is - a novella, a note, whatever the author's vault distinguishes. |
| `section` | The section directory this piece belongs to, as written. The shelf itself comes from the directory, so this is the vault's own record rather than something the server routes on. |
| `topic` | What the piece is about. This becomes its **title**; without it the first `# ` heading is used, and failing that the filename. |
| `written` | When it was written, carried through as written. |
| `words` | Its length, so the reader can say how long a piece is before opening it. Counted from the body when absent. |
| `source` | Where the material came from, if anywhere. |
| `songs` | Songs the piece has already produced. |

The frontmatter is YAML in name only: flat `key: value` pairs, which is all the format uses. Empty values and `[]` are treated as absent - `source: ""` says the same thing as no `source` line at all.

### The body

Everything before the first named heading is prose, split into paragraphs. Two things are dropped on the way:

- **The title heading.** A leading `# ` is already the piece's title; showing it again would be an empty line of display in every piece.
- **Horizontal rules.** The format separates the moves of a piece with `---`. Those are punctuation for the eye in a markdown file, not paragraphs, and a reader should never see one as a line of text.

Paragraphs stay a list rather than becoming one blob of markdown, because reading position is an index into that list.

### The three trailing blocks

Three headings are known by name and lifted out of the prose, so the reading app can set them apart from the text:

| Heading | Becomes | What it is |
| --- | --- | --- |
| `## Соседи` | `neighbours` | Related pieces, as free text. It may name a piece that does not exist yet. |
| `## Одной строкой` | `one_liner` | The line meant to be remembered - what a repetition card shows. The bold markers, the quotation marks and the trailing full stop are normalised away. |
| `## Для песни` | `song` | The song seed: the author's own workbench, kept whole and shown apart from the read. |

Any other heading stays in the prose. A piece that invents its own section should keep it rather than lose it.

## How ids are formed

An id is the section slug and the file slug, joined by a slash:

```
19 — Любовь и пары/Абеляр и Элоиза.md
        ↓
19-lyubov-i-pary/abelyar-i-eloiza
```

Cyrillic is transliterated rather than percent-encoded. These ids end up in the address bar of a phone, and `19-lyubov-i-pary` is a link a person can read, while `19-%D0%9B%D1%8E%D0%B1...` is not. Letters and digits pass through lowercased, Cyrillic maps to its latin sound, and everything else becomes a separator - so `Кейдж и 4′33″` becomes `keydzh-i-4-33`.

The mapping only has to be stable and collision-free within one library, not reversible. Note that `й` and `ы` map to `y`, not to `i`: collapsing them would turn `пары` into `pari`, which reads as a different word.

Renaming a file or its section changes the piece's id, and the reading the database holds against the old id no longer finds it. Renames are cheap in a vault and not free here.

## Where it comes from

The files are published to the directory the server reads - see [Publishing content](/rhapsod/guides/publishing-content/). Publishing is copying; rhapsod has no opinion about the tool that does it, and the scripts in `tools/` are one convenience among many.

## What the server does with it

It reads, and only reads. On startup - and on every `POST /api/reindex` - it walks the directory, parses every file, and holds the result in memory. A personal library is thousands of files at most, and reading them all costs less than keeping a second copy of them consistent in a database.

A file that cannot be read or parsed is skipped with a warning naming it, rather than failing the whole index: one malformed file is a content problem and should not take the library down.

**The server never writes to the content directory** ([ADR 0002](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0002-content-as-files.md)). Everything it remembers about your reading - where you stopped, what you marked, what you wrote in the margin - lives in the database, keyed to the piece id. Re-publishing the library changes what is on the shelf and nothing about your reading of it. The compose file on the stand mounts the directory read-only, so this is enforced and not merely intended.

## What it is not

It is not a wiki and not an editor. The place to change a text is where it was written; the reader shows it, keeps your place, and brings the lines you marked back to you on a schedule.
