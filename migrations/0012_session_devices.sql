-- What each session is, so the reader can see the list and act on it.
--
-- Sessions were a token and two timestamps, which answers "is this request
-- allowed" and nothing else. The screen needs the other question: how many
-- devices are signed in, and which of these rows is the phone in my hand.
--
-- The label is worked out once, when the session starts, and stored. Reading
-- it out of the user agent on every request would be the same work over and
-- over, and a browser that updates itself would quietly rewrite the list
-- under the reader while they are looking at it.
ALTER TABLE sessions ADD COLUMN device TEXT;

-- Sessions that predate this column keep a null and are shown as "a device":
-- honest about what is known, rather than guessing at a phone. They cannot be
-- backfilled - nothing recorded what they were - and a default of "unknown"
-- in the schema would say the same thing in a worse place.
