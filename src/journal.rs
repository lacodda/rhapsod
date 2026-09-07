//! What the reading adds up to over time, for the reader.
//!
//! The library screen counts what has been read; this says *when*. Two views
//! of the same rows: the months, each with what was finished in it and what
//! was carried through the review schedule, and the openings - which piece
//! was in the reader's hands on which day.
//!
//! Like the author's report, this is a module of queries and not a table.
//! Every number is read out of the reading state, the review schedules, the
//! openings log and the library; nothing here is kept that could come to
//! disagree with what it counts.

use std::collections::BTreeMap;

use anyhow::{Context, Result};
use serde::Serialize;
use sqlx::SqlitePool;

use crate::library::Library;

/// One month of reading.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Month {
    /// `YYYY-MM`, in UTC like every stamp the stand writes.
    pub month: String,
    /// Pieces finished in the month, by the day they were first finished.
    pub read: i64,
    /// Words in those pieces, as the library has them now.
    pub words: i64,
    /// Pieces whose review schedule ended in the month: read, then recalled a
    /// day, a week and a month later, and retired. The number that says the
    /// reading stayed.
    pub recalled: i64,
}

/// One day a piece was in the reader's hands.
///
/// Openings of the same piece on the same day are one line: a reader who put
/// the phone down three times over breakfast opened the piece once as far as
/// a journal is concerned, and `times` keeps the count for anyone who wants
/// it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Opened {
    /// `YYYY-MM-DD`.
    pub day: String,
    pub piece_id: String,
    /// The title as the library has it, so the journal reads as titles and
    /// not ids.
    pub title: String,
    /// The first opening that day.
    pub opened_at: String,
    /// How many times that day.
    pub times: i64,
}

/// The journal: months, the schedule, and the openings.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Journal {
    /// Newest first. A month with nothing in it is not listed.
    pub months: Vec<Month>,
    /// Pieces still in the review schedule, waiting for a return.
    pub scheduled: i64,
    /// Pieces carried through the whole schedule, ever.
    pub recalled: i64,
    /// Newest first, at most [`HISTORY`] lines.
    pub history: Vec<Opened>,
}

/// How far from UTC a device's clock may claim to be, in minutes either way:
/// the calendar runs from UTC-12 to UTC+14, and a number past that is a
/// mistake rather than a place.
pub const FARTHEST_OFFSET: i64 = 14 * 60;

/// How many lines of history are sent.
///
/// A line per piece per day, so this is months of reading for one reader; the
/// export carries the whole log, and a screen that scrolls past two hundred
/// days is not a screen anyone reads to the end.
pub const HISTORY: i64 = 200;

/// Reads the journal, with days and months by a clock `offset` minutes east
/// of UTC.
///
/// The stand stamps everything in UTC, and the reader is not in UTC: a piece
/// finished at eleven in the evening would otherwise be journalled under
/// tomorrow, and the last day of a month under the next one. The device that
/// asks says how far its clock is from the stand's, and the grouping follows
/// the device. `0` is UTC, which is what a script asking from nowhere gets.
///
/// # Errors
///
/// Fails when the offset is not a place on the calendar, or when the database
/// cannot be read.
pub async fn read(pool: &SqlitePool, library: &Library, offset: i64) -> Result<Journal> {
    anyhow::ensure!(
        (-FARTHEST_OFFSET..=FARTHEST_OFFSET).contains(&offset),
        "an offset of {offset} minutes is not a place on the calendar"
    );
    // SQLite's own date arithmetic, so the shift and the truncation happen in
    // one place and the same way for every stamp.
    let shift = format!("{offset} minutes");

    let mut months: BTreeMap<String, Month> = BTreeMap::new();

    // Finished pieces, by the day they were first finished. Words come from
    // the library, not from a column: the file is the truth about its own
    // length, and a piece rewritten since counts as what it is now. A piece
    // that left the library still counts as read - it was - but weighs no
    // words, because there is nothing left to weigh.
    let finished: Vec<(String, String)> = sqlx::query_as(
        "SELECT piece_id, strftime('%Y-%m', read_at, ?)
           FROM reading_state
          WHERE status = 'read' AND read_at IS NOT NULL",
    )
    .bind(&shift)
    .fetch_all(pool)
    .await
    .context("failed to read what was finished")?;
    for (piece_id, month) in finished {
        let month = months.entry(month.clone()).or_insert_with(|| empty(month));
        month.read += 1;
        month.words += library.piece(&piece_id).map_or(0, |piece| i64::try_from(piece.words).unwrap_or(i64::MAX));
    }

    // A schedule with no due date has been carried through; the last answer
    // is the moment it ended. Nothing stamps the row afterwards, so the month
    // is exact.
    let retired: Vec<String> = sqlx::query_scalar(
        "SELECT strftime('%Y-%m', last_seen, ?)
           FROM reviews
          WHERE due_on IS NULL AND last_seen IS NOT NULL",
    )
    .bind(&shift)
    .fetch_all(pool)
    .await
    .context("failed to read what was carried through")?;
    let recalled = i64::try_from(retired.len()).unwrap_or(i64::MAX);
    for month in retired {
        months.entry(month.clone()).or_insert_with(|| empty(month)).recalled += 1;
    }

    let scheduled: i64 = sqlx::query_scalar("SELECT count(*) FROM reviews WHERE due_on IS NOT NULL")
        .fetch_one(pool)
        .await
        .context("failed to count the schedule")?;

    // One line per piece per day, newest first. The collapse is done here
    // rather than on the screen so the journal and anything else reading this
    // agree on what one opening is.
    let opened: Vec<(String, String, String, i64)> = sqlx::query_as(
        "SELECT date(opened_at, ?) AS day, piece_id, min(opened_at) AS first, count(*) AS times
           FROM openings
          GROUP BY day, piece_id
          ORDER BY day DESC, first DESC
          LIMIT ?",
    )
    .bind(&shift)
    .bind(HISTORY)
    .fetch_all(pool)
    .await
    .context("failed to read the openings")?;

    // A piece that left the library leaves the history: a title is what the
    // reader reads, and an id in its place is a line that says nothing.
    let history = opened
        .into_iter()
        .filter_map(|(day, piece_id, opened_at, times)| {
            let piece = library.piece(&piece_id)?;
            Some(Opened {
                day,
                piece_id,
                title: piece.title.clone(),
                opened_at,
                times,
            })
        })
        .collect();

    Ok(Journal {
        months: months.into_values().rev().collect(),
        scheduled,
        recalled,
        history,
    })
}

fn empty(month: String) -> Month {
    Month {
        month,
        read: 0,
        words: 0,
        recalled: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{progress, reviews};

    async fn pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        pool
    }

    /// A library of two pieces on disk, built from real files so the indexer
    /// decides the ids and the word counts.
    fn library() -> (tempfile::TempDir, Library) {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let section = dir.path().join("01 — Парадоксы");
        std::fs::create_dir_all(&section).expect("the shelf");

        for (file, title, words) in [("Кот.md", "Кот Шрёдингера", 900), ("Лжец.md", "Парадокс лжеца", 1200)] {
            let body = format!("---\ntype: novella\ntopic: {title}\nwords: {words}\n---\n\n# {title}\n\nАбзац.\n");
            std::fs::write(section.join(file), body).expect("the piece");
        }

        let lib = Library::load(dir.path()).expect("the library should load");
        (dir, lib)
    }

    /// Finishes a piece as of a moment.
    async fn finished(pool: &SqlitePool, piece_id: &str, read_at: &str) {
        sqlx::query("INSERT INTO reading_state (piece_id, status, read_at) VALUES (?, 'read', ?)")
            .bind(piece_id)
            .bind(read_at)
            .execute(pool)
            .await
            .unwrap();
    }

    /// A schedule carried through, ended as of a moment.
    async fn retired(pool: &SqlitePool, piece_id: &str, last_seen: &str) {
        sqlx::query("INSERT INTO reviews (piece_id, done, due_on, last_seen) VALUES (?, 3, NULL, ?)")
            .bind(piece_id)
            .bind(last_seen)
            .execute(pool)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn an_empty_stand_has_an_empty_journal() {
        let pool = pool().await;
        let (_dir, lib) = library();
        let journal = read(&pool, &lib, 0).await.unwrap();
        assert!(journal.months.is_empty());
        assert!(journal.history.is_empty());
        assert_eq!(journal.scheduled, 0);
        assert_eq!(journal.recalled, 0);
    }

    #[tokio::test]
    async fn a_month_counts_what_was_finished_in_it_and_weighs_it() {
        let pool = pool().await;
        finished(&pool, "01-paradoksy/kot", "2026-05-03T10:00:00.000Z").await;
        finished(&pool, "01-paradoksy/lzhec", "2026-05-20T10:00:00.000Z").await;

        let (_dir, lib) = library();
        let journal = read(&pool, &lib, 0).await.unwrap();
        assert_eq!(journal.months.len(), 1);
        assert_eq!(journal.months[0].month, "2026-05");
        assert_eq!(journal.months[0].read, 2);
        assert_eq!(journal.months[0].words, 2100, "the words did not come from the library");
    }

    #[tokio::test]
    async fn months_come_newest_first_and_empty_ones_are_not_listed() {
        let pool = pool().await;
        finished(&pool, "01-paradoksy/kot", "2026-03-03T10:00:00.000Z").await;
        finished(&pool, "01-paradoksy/lzhec", "2026-05-20T10:00:00.000Z").await;

        let (_dir, lib) = library();
        let journal = read(&pool, &lib, 0).await.unwrap();
        let listed: Vec<&str> = journal.months.iter().map(|month| month.month.as_str()).collect();
        assert_eq!(listed, ["2026-05", "2026-03"], "April was listed, or the order is wrong");
    }

    #[tokio::test]
    async fn a_piece_that_left_the_library_still_counts_as_read_but_weighs_nothing() {
        // It was read; that is a fact about the reader. Its length is a fact
        // about a file that is no longer there.
        let pool = pool().await;
        finished(&pool, "01-paradoksy/gone", "2026-05-03T10:00:00.000Z").await;

        let (_dir, lib) = library();
        let journal = read(&pool, &lib, 0).await.unwrap();
        assert_eq!(journal.months[0].read, 1);
        assert_eq!(journal.months[0].words, 0);
    }

    #[tokio::test]
    async fn a_schedule_carried_through_is_counted_in_the_month_it_ended() {
        let pool = pool().await;
        finished(&pool, "01-paradoksy/kot", "2026-04-01T10:00:00.000Z").await;
        retired(&pool, "01-paradoksy/kot", "2026-05-09T10:00:00.000Z").await;
        // Still waiting for its first return: in the schedule, not recalled.
        finished(&pool, "01-paradoksy/lzhec", "2026-05-01T10:00:00.000Z").await;
        reviews::follow(&pool, "01-paradoksy/lzhec", true).await.unwrap();

        let (_dir, lib) = library();
        let journal = read(&pool, &lib, 0).await.unwrap();
        let may = journal.months.iter().find(|month| month.month == "2026-05").expect("May");
        let april = journal.months.iter().find(|month| month.month == "2026-04").expect("April");
        assert_eq!(may.recalled, 1, "the retirement was not counted in the month it happened");
        assert_eq!(april.recalled, 0, "the retirement was counted in the month the piece was read");
        assert_eq!(journal.recalled, 1);
        assert_eq!(journal.scheduled, 1);
    }

    #[tokio::test]
    async fn openings_of_one_piece_on_one_day_are_one_line() {
        let pool = pool().await;
        for stamp in ["2026-05-03T08:00:00.000Z", "2026-05-03T08:20:00.000Z", "2026-05-03T21:00:00.000Z"] {
            progress::opened(&pool, "01-paradoksy/kot", Some(stamp)).await.unwrap();
        }
        progress::opened(&pool, "01-paradoksy/kot", Some("2026-05-04T08:00:00.000Z")).await.unwrap();

        let (_dir, lib) = library();
        let journal = read(&pool, &lib, 0).await.unwrap();
        assert_eq!(journal.history.len(), 2, "one piece on two days is two lines");
        assert_eq!(journal.history[0].day, "2026-05-04", "the newest day did not come first");
        assert_eq!(journal.history[1].day, "2026-05-03");
        assert_eq!(journal.history[1].times, 3, "the three openings over the day were not counted");
        assert_eq!(
            journal.history[1].opened_at, "2026-05-03T08:00:00.000Z",
            "the line does not carry the first opening"
        );
        assert_eq!(journal.history[1].title, "Кот Шрёдингера", "the reader reads a title, not an id");
    }

    #[tokio::test]
    async fn a_piece_that_left_the_library_leaves_the_history() {
        let pool = pool().await;
        progress::opened(&pool, "01-paradoksy/gone", Some("2026-05-03T08:00:00.000Z")).await.unwrap();
        progress::opened(&pool, "01-paradoksy/kot", Some("2026-05-03T09:00:00.000Z")).await.unwrap();

        let (_dir, lib) = library();
        let journal = read(&pool, &lib, 0).await.unwrap();
        assert_eq!(journal.history.len(), 1);
        assert_eq!(journal.history[0].piece_id, "01-paradoksy/kot");
    }

    #[tokio::test]
    async fn the_history_stops_at_its_limit() {
        // The export carries the whole log; the screen gets the recent part.
        let pool = pool().await;
        for day in 0..HISTORY + 5 {
            // One opening per calendar day, spread over the years so that
            // every row is its own day.
            let stamp = format!("20{:02}-{:02}-{:02}T08:00:00.000Z", 10 + day / 336, 1 + (day / 28) % 12, 1 + day % 28);
            sqlx::query("INSERT OR IGNORE INTO openings (piece_id, opened_at) VALUES ('01-paradoksy/kot', ?)")
                .bind(&stamp)
                .execute(&pool)
                .await
                .unwrap();
        }
        let distinct: i64 = sqlx::query_scalar("SELECT count(DISTINCT substr(opened_at, 1, 10)) FROM openings")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(distinct > HISTORY, "the fixture did not make enough days: {distinct}");

        let (_dir, lib) = library();
        let journal = read(&pool, &lib, 0).await.unwrap();
        assert_eq!(i64::try_from(journal.history.len()).unwrap(), HISTORY);
    }

    #[tokio::test]
    async fn the_devices_clock_decides_which_day_and_month_it_was() {
        // Eleven at night on the last of May, three hours west of UTC, is two
        // in the morning on the first of June by the stand's clock. The
        // reader was in May.
        let pool = pool().await;
        finished(&pool, "01-paradoksy/kot", "2026-06-01T02:00:00.000Z").await;
        progress::opened(&pool, "01-paradoksy/kot", Some("2026-06-01T01:30:00.000Z")).await.unwrap();

        let (_dir, lib) = library();
        let by_the_stand = read(&pool, &lib, 0).await.unwrap();
        assert_eq!(by_the_stand.months[0].month, "2026-06");
        assert_eq!(by_the_stand.history[0].day, "2026-06-01");

        let by_the_reader = read(&pool, &lib, -180).await.unwrap();
        assert_eq!(by_the_reader.months[0].month, "2026-05", "the month did not follow the device's clock");
        assert_eq!(by_the_reader.history[0].day, "2026-05-31", "the day did not follow the device's clock");
        // The stamp itself is not shifted: the screen renders it in local
        // time from the UTC value, and a shifted stamp marked `Z` would lie.
        assert_eq!(by_the_reader.history[0].opened_at, "2026-06-01T01:30:00.000Z");
    }

    #[tokio::test]
    async fn an_offset_off_the_calendar_is_refused() {
        let pool = pool().await;
        let (_dir, lib) = library();
        assert!(read(&pool, &lib, FARTHEST_OFFSET + 1).await.is_err());
        assert!(read(&pool, &lib, -FARTHEST_OFFSET - 1).await.is_err());
        assert!(read(&pool, &lib, FARTHEST_OFFSET).await.is_ok());
    }

    #[tokio::test]
    async fn the_log_starts_with_the_first_opening_of_what_was_already_read() {
        // A stand upgraded with a year of reading behind it starts the log
        // with the openings the reading state remembered, not with nothing.
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let log_version = sqlx::migrate!()
            .iter()
            .find(|migration| migration.description.contains("openings"))
            .expect("the migration that creates the log")
            .version;

        // Everything before the log, then a row the way an old stand has it,
        // then the rest.
        let mut before = sqlx::migrate!();
        before.migrations = before.iter().filter(|migration| migration.version < log_version).cloned().collect();
        before.run(&pool).await.unwrap();
        sqlx::query("INSERT INTO reading_state (piece_id, status, opened_at) VALUES ('01-paradoksy/kot', 'read', '2026-01-05T08:00:00.000Z')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();

        let (_dir, lib) = library();
        let journal = read(&pool, &lib, 0).await.unwrap();
        assert_eq!(journal.history.len(), 1, "the seed did not carry the old opening over");
        assert_eq!(journal.history[0].day, "2026-01-05");
    }
}
