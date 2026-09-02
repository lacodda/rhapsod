-- What a queued change carries: an identity and a time from the device.
--
-- The reading app writes locally first and drains its queue when the stand is
-- reachable (ADR 0003). Two things follow from that, and both are here.
--
-- First, a change can arrive twice: a connection dropped mid-drain leaves the
-- app unsure whether the write landed, and retrying is the only safe answer it
-- has. Every write therefore carries an identity minted on the device, and the
-- server upserts on it.
--
-- Second, a change can arrive late: a note written on a train is delivered
-- after one written at home. The server keeps the newer of the two by the time
-- the device recorded, not by the time the row reached the database.

-- The device's own clock, for the rows the reader writes.
--
-- Nullable because every row written before this migration has no such time,
-- and inventing one would be a lie about when the reader was there. A null
-- reads as "older than anything the queue can deliver", which is exactly what
-- those rows are.
ALTER TABLE reading_state ADD COLUMN marked_at TEXT;
ALTER TABLE notes ADD COLUMN marked_at TEXT;

-- A quote's identity as minted by the device that kept the line.
--
-- The same line may be kept twice on purpose - two readings can mark the same
-- sentence - so the text cannot be the identity. The device's id can: it is
-- one act of keeping, however many times its delivery is retried.
--
-- Nullable for the rows kept before the queue existed, and unique among the
-- rows that have one: SQLite's unique index ignores nulls, which is the
-- behaviour wanted here rather than one to work around.
ALTER TABLE quotes ADD COLUMN client_id TEXT;
CREATE UNIQUE INDEX quotes_client_id ON quotes (client_id);
