-- When each thing the reader made last changed.
--
-- The export is about to learn `?since=`, so that the ritual which folds marks
-- back into the vault does not rewrite three hundred files to carry two edits.
-- That only works if every kind of row can answer "have you changed since?" -
-- and two of them could not.
--
-- A quote carried only `created_at`, and editing its comment moved nothing.
-- An incremental export would have skipped it, and the vault would have kept a
-- stale comment for as long as nobody rewrote the file by hand: the worst shape
-- a defect can take, because the export would keep reporting success.
--
-- A schedule carried `last_seen`, which is null until the first answer. A piece
-- enrolled but not yet recalled would have been invisible to every incremental
-- run, and would have reached the vault only by accident.
--
-- So both get the same column the other tables already have, under the name
-- the query can use without knowing which table it is reading.

-- Existing rows take the best timestamp they have rather than "now": claiming
-- that every quote changed at the moment of this migration would make the first
-- incremental export after the upgrade a full one, and would be a lie about
-- when the reader wrote them.
ALTER TABLE quotes ADD COLUMN changed_at TEXT;
UPDATE quotes SET changed_at = created_at;

ALTER TABLE reviews ADD COLUMN changed_at TEXT;
-- A schedule that was answered changed then; one that never was changed when
-- the piece was finished, which is the closest honest moment available - the
-- row does not record its own creation.
UPDATE reviews SET changed_at = coalesce(last_seen, (
    SELECT read_at FROM reading_state WHERE reading_state.piece_id = reviews.piece_id
));

-- The whole point of the column is answering "what changed after this time",
-- and both tables are scanned by that alone.
CREATE INDEX quotes_changed ON quotes (changed_at);
CREATE INDEX reviews_changed ON reviews (changed_at);
