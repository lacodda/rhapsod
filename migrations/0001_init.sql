-- The first table of the reader's memory.
--
-- Everything the server keeps lives in this database, and nothing about the
-- library does: the markdown files are read from a directory and never
-- written (ADR 0002). Progress, notes and review schedules arrive as their
-- own tables in the versions that introduce them, not as columns guessed at
-- here.
--
-- A key-value table for the few things the reader has to remember about
-- itself: the last indexed state of the library, a chosen theme. Small by
-- design; anything with a shape of its own gets a table of its own.
CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    -- ISO 8601 in UTC, as text: SQLite has no datetime type, and a string
    -- that sorts is what every other table will use too.
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
