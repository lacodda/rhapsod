# 0005 · A shipped migration is frozen

Date: 2026-10-01. Status: accepted.

## Context

The schema lives in `migrations/`, applied in order by sqlx when the server opens its database. sqlx records each applied migration with a checksum, and refuses to start against a database whose recorded checksum no longer matches the file: a migration edited after it ran somewhere is a server that will not come up there.

That refusal is the right behaviour, and it decides how the schema may change. A stand updated to a release has run that release's migrations against the only copy of the reader's state. Editing one of them afterwards cannot reach the stands where it already ran - it only makes them refuse the next version, or, worse, lets two stands disagree about what the same migration did.

## Decision

- **Once a migration has shipped in a tag, it is never edited.** The schema moves forward only by a new migration with the next number.
- **Before the tag, a migration may still be corrected** - but on a development database rolled back to a copy taken before it ran, never by editing a file a running database has already applied.
- **A release that migrates the database is updated with a copy taken first.** `tools/stand/update.*` stops the stand, copies the database aside on the stand and only then starts the new image, because by the time anything looks wrong the migration has already run and cannot be walked back.

## Consequences

- **The way back from a bad release is a copy, not a down-migration.** There are no down-migrations; rolling back is restoring the copy taken aside with the old version ("Rolling back" in the Moving a stand guide).
- **A mistake in a shipped migration is fixed by the next one,** in the open, with its own number and its own release note - which is also how every stand ends up with the same schema.
- **An older image cannot open a newer database.** `restore` stands a stand up on the newest tag by default for this reason.
