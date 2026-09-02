-- The quote's identity moves to the device that kept the line.
--
-- A highlight made away from home has to be commented on and removed there
-- too, hours before the stand hears about it (ADR 0003). An id handed out by
-- the server cannot do that: until the queue drains there is no id to address
-- the quote by, and the reader is left looking at a highlight they cannot
-- touch.
--
-- So `client_id` - added in 0004 as a way to recognise a redelivery - becomes
-- the identity itself, and the autoincrement key goes away. The rows kept
-- before this are given the id they would have had, so nothing is lost: the
-- text of a quote is what the reader cares about, and it does not move.

CREATE TABLE quotes_new (
    -- Minted on the device, unique across the library. One act of keeping,
    -- however many times its delivery is retried.
    id         TEXT PRIMARY KEY,
    piece_id   TEXT NOT NULL,
    paragraph  INTEGER NOT NULL DEFAULT 0 CHECK (paragraph >= 0),
    text       TEXT NOT NULL CHECK (length(text) > 0),
    comment    TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

-- Rows kept before the app minted ids take the one it sent if there is one,
-- and otherwise a stable id built from the row they already are. Built from
-- the old key rather than random so that running this twice - a restored
-- backup, a re-applied migration - cannot produce a second copy of a quote.
INSERT INTO quotes_new (id, piece_id, paragraph, text, comment, created_at)
SELECT coalesce(client_id, 'legacy-' || id), piece_id, paragraph, text, comment, created_at
  FROM quotes;

DROP TABLE quotes;
ALTER TABLE quotes_new RENAME TO quotes;

-- The quotes of one piece, in the order they appear in it: what the reading
-- view asks for every time a piece is opened.
CREATE INDEX quotes_piece ON quotes (piece_id, paragraph);
