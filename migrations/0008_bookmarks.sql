-- A piece the reader wants to find again.
--
-- Not the same thing as a kept line: a quote is a sentence worth keeping, a
-- bookmark is a whole piece worth returning to. And not the same as reading
-- state either, which records what happened rather than what the reader
-- intends.
--
-- The kinds are a fixed set rather than a table of their own. Four of them
-- cover what one reader means by marking a piece, and letting them be defined
-- would buy a settings screen nobody asked for; adding a fifth is one line in
-- the code and a migration like this one, not a redesign.
CREATE TABLE bookmarks (
    piece_id TEXT PRIMARY KEY,
    -- Which kind of mark. Checked here rather than trusted from the app: a
    -- typo in a client would otherwise become a colour nothing can draw and a
    -- filter nothing matches.
    kind     TEXT NOT NULL CHECK (kind IN ('loved', 'return', 'song', 'reread')),
    -- When the reader marked it. The bookmarks list is newest first, because
    -- the reason for marking something is freshest right after reading it.
    marked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    -- The device clock, for the same reason every other table the reader
    -- writes to carries one: a change queued on a train must not lose to an
    -- older one delivered first (ADR 0003).
    changed_at TEXT
) STRICT;

-- One piece has one bookmark: marking a piece "loved" that was already
-- "reread" changes the kind rather than adding a second row. A reader who
-- wants both means the more recent one.
--
-- The list is ordered by when it was marked, and filtered by kind; both are
-- what this index is for.
CREATE INDEX bookmarks_kind ON bookmarks (kind, marked_at DESC);
