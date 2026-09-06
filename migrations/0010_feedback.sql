-- What the reader tells the author, smaller than a note.
--
-- A note is a paragraph the reader sits down to write, and most of what is
-- worth saying never reaches that size: a piece landed, a line is misspelt.
-- Both are one gesture here, and both travel back to the vault through the
-- export like everything else the reader leaves behind.

-- How a piece landed.
--
-- Two kinds, and they are not degrees of one scale. "Good" says the piece
-- works; "struck" says it did something to the reader, which is the thing an
-- author writes for and the thing they cannot see from a word count. Reducing
-- them to one flag would lose exactly the half that carries information.
--
-- There is no negative kind. The reader and the author are the same person
-- here, and a piece that did not land already says so twice over - it is
-- abandoned partway in the reading state, and it has no reaction at all.
CREATE TABLE reactions (
    -- One reaction per piece: a reader who reacts twice means the newer one,
    -- the same rule bookmarks follow.
    piece_id  TEXT PRIMARY KEY,
    -- Checked here rather than trusted from the app: a typo in a client would
    -- otherwise become a kind nothing can draw and no report can count.
    kind      TEXT NOT NULL CHECK (kind IN ('good', 'struck')),
    felt_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    -- The device clock, like every other thing the reader writes (ADR 0003):
    -- a reaction queued on a train must not lose to an older one delivered
    -- first.
    changed_at TEXT
) STRICT;

-- The report counts reactions by kind, and the export reads them newest
-- first.
CREATE INDEX reactions_kind ON reactions (kind, felt_at DESC);

-- A misspelling the reader spotted.
--
-- Unlike every other table here, this one is about the text rather than about
-- the reading of it: it is the one case where the reader has something to say
-- that the author must act on in the vault, by editing the piece.
CREATE TABLE typos (
    -- Minted by the device, like a quote id (ADR 0003): a typo written down
    -- without a network still needs to be the same typo when it arrives, and
    -- an id the server hands out cannot be given to a row that does not exist
    -- yet.
    id         TEXT PRIMARY KEY,
    piece_id   TEXT NOT NULL,
    -- The words as the reader selected them.
    --
    -- Stored rather than pointed at, and this is the whole feature. A report
    -- that carried only a position would send the author hunting: paragraphs
    -- shift whenever a piece is edited, and by the time the report is read the
    -- number may point at different words. The words themselves are findable
    -- by search in the file no matter how the piece moved since.
    quoted     TEXT NOT NULL,
    -- Where it was when the reader saw it. A hint for the eye, not the way the
    -- typo is found - which is why the words above are not optional and this
    -- is allowed to go stale.
    paragraph  INTEGER NOT NULL DEFAULT 0 CHECK (paragraph >= 0),
    spotted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    -- The device clock, for the reason above.
    changed_at TEXT
) STRICT;

-- The report and the export both read a piece's typos together.
CREATE INDEX typos_piece ON typos (piece_id, spotted_at DESC);
