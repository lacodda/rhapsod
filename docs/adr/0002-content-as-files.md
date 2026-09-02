# 0002 · The library is a directory of files, and the server never edits it

Date: 2026-09-02. Status: accepted.

## Context

The novellas rhapsod serves are written elsewhere: in the author's vault, in markdown, with YAML frontmatter that already names each piece's `type`, `section`, `topic`, when it was `written`, and how many `words` it runs to. The vault is the place of writing and the source of truth for the text. Publishing means copying a directory of those files to the Pi.

A reader could import that directory into its database and serve from there. That would make the database the second copy of the text, with all the questions a second copy brings: which one is current, what happens to an edit made on the wrong side, and how a rebuilt database gets the text back.

## Decision

- **The library is `RHAPSOD_CONTENT_DIR`**: a directory of markdown files with frontmatter, mounted read-only on the stand. The server indexes it and serves it; it does not own it.
- **The server never writes to the library.** Not a frontmatter field, not a sidecar file. The mount is read-only in the compose file, and that is a statement of intent rather than a precaution.
- **Everything the reader remembers lives in SQLite** - progress, notes, highlights, review state - keyed by a stable identity derived from the file, so that re-publishing the library does not lose what was remembered about a piece.
- **Publishing is copying.** Whatever puts files into that directory - a sync tool, a script, a copy by hand - is outside rhapsod. The server notices changes by re-indexing, not by being told.

## Consequences

- **The vault stays the source of truth.** An edit is made where the text is written and reaches the reader by being published again. There is no path by which the reader's copy can drift from it.
- **The database is state, not content.** It can be rebuilt from nothing without losing a word of the library, and backed up without carrying the library along.
- **The index is a cache.** The server has to be able to build it from the directory at any time, and has to cope with files that appear, change or vanish between two starts. Identity has to survive a file being moved or renamed, which constrains what "identity" can be derived from.
- **Returning state to the vault is a separate concern.** A note or a highlight that should flow back to where the text is written is an export, not a write to the library - a later version's decision, made on purpose rather than as a side effect of this one.
