-- Bringing a piece back after it has been read.
--
-- A library that is only read is a library that is forgotten. What is kept
-- here is a schedule: when a finished piece should be shown again, and how
-- many times it has come back so far.
--
-- The schedule is fixed - 1, 7 and 30 days - rather than an algorithm that
-- adapts an interval per piece. This is a library of a few hundred novellas
-- read by one person for pleasure, not a deck of ten thousand cards being
-- crammed for an exam: three returns spread over a month is the shape of
-- "do not let this fade", and the machinery of a spaced-repetition engine
-- would be answering a question nobody here asked.
CREATE TABLE reviews (
    piece_id  TEXT PRIMARY KEY,
    -- How many times the piece has come back and been answered. 0 means it
    -- has been finished but not yet returned; 3 means the schedule is done.
    done      INTEGER NOT NULL DEFAULT 0 CHECK (done >= 0),
    -- The day the piece is next worth showing, as YYYY-MM-DD. A date rather
    -- than a timestamp: a review is a thing you do today, and a piece that
    -- came due at 23:58 should not be gone by the time you sit down with it.
    -- Null means the schedule is finished and there is nothing more to show.
    due_on    TEXT,
    -- When the reader last answered for this piece, so the export can say
    -- what happened without inferring it from `done`.
    last_seen TEXT
) STRICT;

-- "What is due today" is the only question this table is asked, on every
-- visit to the library screen.
CREATE INDEX reviews_due ON reviews (due_on);
