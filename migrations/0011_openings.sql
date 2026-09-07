-- Every time a piece was opened.
--
-- The reading state keeps one row per piece and overwrites it as the reader
-- moves, which answers "where am I" and not "what did I read on Tuesday". This
-- is the log the second question needs: one row per opening, never updated,
-- so the journal can say when a piece was opened and how often it was
-- returned to.
--
-- Keyed on the piece and the moment rather than on a counter: a report drained
-- twice from an offline queue lands once, and a restore from an export cannot
-- collide with rows the stand already has.
CREATE TABLE openings (
    piece_id  TEXT NOT NULL,
    -- The device's clock when it can be had, the stand's otherwise: an
    -- opening on a train is written when the phone gets home, and "when the
    -- stand heard" is not when the piece was read.
    opened_at TEXT NOT NULL,
    PRIMARY KEY (piece_id, opened_at)
) STRICT, WITHOUT ROWID;

CREATE INDEX openings_when ON openings (opened_at DESC);

-- What was opened before the log existed: the reading state remembers the
-- first opening of every piece it holds, and that is a true opening even if
-- the returns since are lost. Better a journal that starts with the truth it
-- has than one that pretends the library was untouched until today.
INSERT INTO openings (piece_id, opened_at)
SELECT piece_id, opened_at FROM reading_state;
