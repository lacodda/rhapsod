-- What the reader leaves behind: a note on a piece, and the lines worth keeping.
--
-- Both belong to the reader, not to the library: the markdown files stay
-- untouched (ADR 0002), and everything here comes back out through the export
-- that returns it to the vault.

-- One note per piece, in the reader's own words. Kept apart from
-- reading_state because a note outlives the reading of a piece: marking
-- something unread must not put its note at risk.
CREATE TABLE notes (
    piece_id   TEXT PRIMARY KEY,
    -- Markdown, as typed. Empty means the note was cleared, and the row is
    -- deleted rather than kept as an empty string.
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

-- A line the reader marked, with an optional comment of their own.
--
-- The quoted text is stored, not a pair of offsets into the file: a piece that
-- is edited in the vault would silently shift every offset, and a highlight
-- that moves to the wrong sentence is worse than one that no longer matches.
-- Matching back onto the text is a search for the quote, so an edit at worst
-- loses the anchor while the quote itself survives.
CREATE TABLE quotes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    piece_id   TEXT NOT NULL,
    -- Index of the paragraph the quote came from, used to find it again fast
    -- and to order the quotes of one piece as they appear in it.
    paragraph  INTEGER NOT NULL DEFAULT 0 CHECK (paragraph >= 0),
    -- The exact text the reader selected.
    text       TEXT NOT NULL CHECK (length(text) > 0),
    -- What they wanted to say about it, if anything.
    comment    TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

-- The quotes of one piece, in the order they appear in it: what the reading
-- view asks for every time a piece is opened.
CREATE INDEX quotes_piece ON quotes (piece_id, paragraph);
