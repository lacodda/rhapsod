-- What the reader remembers: where they are in each piece, and who is asking.
--
-- The library itself is still files (ADR 0002); nothing here duplicates a
-- piece's text or title. A row keys on the piece id the indexer derives from
-- the path, so a piece that is renamed in the vault starts fresh rather than
-- inheriting someone else's place - which is the honest outcome: a renamed
-- file is a different link, and the old progress pointed at a piece that no
-- longer exists under that name.

-- One row per piece the reader has opened. A piece with no row has not been
-- opened; that is the third status and it needs no storage.
CREATE TABLE reading_state (
    piece_id   TEXT PRIMARY KEY,
    -- 'reading' or 'read'. The unopened state is the absence of a row, so
    -- there is no third value to keep the two in sync with.
    status     TEXT NOT NULL CHECK (status IN ('reading', 'read')),
    -- Index of the paragraph the reader last saw, not a pixel offset: the
    -- same number means the same sentence on a phone and on a desktop.
    paragraph  INTEGER NOT NULL DEFAULT 0 CHECK (paragraph >= 0),
    -- When the piece was first opened and when it was last touched. The
    -- second orders "continue reading"; the first is what a statistic about
    -- a reading streak counts.
    opened_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    -- Set when the status becomes 'read'; null while it is 'reading'. Kept
    -- apart from updated_at because moving the position of a finished piece
    -- must not move the day it was finished.
    read_at    TEXT
) STRICT;

-- "Continue reading" asks for the most recently touched unfinished piece, and
-- the shelf counters ask how many pieces of a section are read. Both are a
-- scan of a table with a few thousand rows at most, but the index costs
-- nothing and states what the queries are.
CREATE INDEX reading_state_status_updated ON reading_state (status, updated_at DESC);

-- Sessions are rows, not signed tokens: a logout has to be able to end one,
-- and a token that cannot be revoked is not a session but a promise.
CREATE TABLE sessions (
    token      TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    -- Refreshed on use, so a reader who opens the app every few days is not
    -- logged out for having been away.
    seen_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
