-- What the reader would like written.
--
-- The author keeps a plan of a couple of thousand topics; the reader points at
-- one and says "this one". That is the whole feature: not a vote, not a
-- priority, not a deadline - a list the author reads before choosing what to
-- write next.
--
-- The plan is published beside the library and is read, never written (ADR
-- 0002). So a request cannot live in it: it lives here, keyed to the topic id
-- the plan produces, and travels back to the vault through the export.
CREATE TABLE requests (
    -- The topic id as the plan derives it: shelf and title, both slugged.
    topic_id   TEXT PRIMARY KEY,
    -- The title as it read when the request was made.
    --
    -- Stored rather than looked up, and this is deliberate. A topic that gets
    -- written leaves the plan, taking its title with it; a request that
    -- outlived its topic would otherwise become an id nobody can read. Keeping
    -- the words means the export can always say what was asked for, even for a
    -- topic that no longer exists under that name.
    title      TEXT NOT NULL,
    -- Which shelf of the plan it came from, for the same reason.
    section    TEXT NOT NULL,
    asked_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    -- The device clock, like every other thing the reader writes (ADR 0003).
    changed_at TEXT
) STRICT;

-- The list is read newest first: what the reader wanted most recently is what
-- they are most likely to still want.
CREATE INDEX requests_asked ON requests (asked_at DESC);
