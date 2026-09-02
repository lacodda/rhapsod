//! Bringing a piece back after it has been read.
//!
//! A finished piece enters a schedule: one day later, then a week, then a
//! month. Each return the reader answers retires one step; after the third the
//! piece is done and never comes back on its own.
//!
//! The intervals are fixed rather than adapted per piece (see the migration
//! that creates the table). What the reader answers decides whether the piece
//! is retired or shown again, not how long the next gap is.

use anyhow::{Context, Result};
use serde::Serialize;
use sqlx::SqlitePool;

use crate::library::Library;

/// Days from one answer to the next return.
///
/// Three steps: tomorrow, next week, next month. The index into this is the
/// number of returns already answered, so a piece answered twice waits thirty
/// days for its third.
const INTERVALS: [i64; 3] = [1, 7, 30];

/// Where a piece stands in its schedule.
#[derive(Debug, Clone, Serialize, PartialEq, Eq, sqlx::FromRow)]
pub struct Review {
    pub piece_id: String,
    /// Returns answered so far, 0 to 3.
    pub done: i64,
    /// The day this is next worth showing, or `None` when the schedule is
    /// finished.
    pub due_on: Option<String>,
    pub last_seen: Option<String>,
}

/// A piece waiting to be recalled today.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Due {
    pub piece_id: String,
    pub title: String,
    /// The line the piece wants remembered: the whole of the card's front.
    pub one_liner: Option<String>,
    /// Which return this is, 1 to 3, so a reader can see how far through a
    /// piece's schedule they are.
    pub step: i64,
}

/// Puts a finished piece into the schedule, or takes an unfinished one out.
///
/// Called wherever a piece is marked read: the schedule follows from having
/// finished something, and asking the reader to enrol a piece separately would
/// be a second decision about one act.
///
/// Re-finishing a piece already in the schedule does not restart it. A reader
/// who re-reads a favourite has not forgotten it, and starting the schedule
/// over would bring it back tomorrow for having been enjoyed twice.
///
/// # Errors
///
/// Fails when the database rejects the write.
pub async fn follow(pool: &SqlitePool, piece_id: &str, read: bool) -> Result<()> {
    if !read {
        // Marking a piece unread takes it out of the schedule: it is being
        // read again, and something in the middle of being read has no
        // business appearing as a thing to recall.
        sqlx::query("DELETE FROM reviews WHERE piece_id = ?")
            .bind(piece_id)
            .execute(pool)
            .await
            .context("failed to take the piece out of the schedule")?;
        return Ok(());
    }

    sqlx::query(
        "INSERT INTO reviews (piece_id, done, due_on)
         VALUES (?, 0, date('now', '+1 day'))
         ON CONFLICT (piece_id) DO NOTHING",
    )
    .bind(piece_id)
    .execute(pool)
    .await
    .context("failed to put the piece into the schedule")?;
    Ok(())
}

/// Records that the reader answered for a piece, saying whether there was a
/// schedule to answer for.
///
/// `again` is the reader asking for the piece back rather than saying they
/// remember it: the piece keeps its place in the schedule and returns
/// tomorrow instead of advancing. That is the honest reading of opening a
/// card - they went to read the piece again, so it is not retired.
///
/// # Errors
///
/// Fails when the database rejects the write.
pub async fn answered(pool: &SqlitePool, piece_id: &str, again: bool) -> Result<bool> {
    // The gap is chosen by the step the piece is about to enter, which is why
    // this reads the count before writing it. Doing the arithmetic in SQL
    // would put the schedule in two places.
    let current: Option<i64> = sqlx::query_scalar("SELECT done FROM reviews WHERE piece_id = ?")
        .bind(piece_id)
        .fetch_optional(pool)
        .await
        .context("failed to read the schedule")?;

    // A piece with no schedule was never finished, or lost its row to an
    // unread. Saying so lets the app find out rather than silently doing
    // nothing.
    let Some(done) = current else { return Ok(false) };

    if again {
        sqlx::query(
            "UPDATE reviews
                SET due_on    = date('now', '+1 day'),
                    last_seen = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
              WHERE piece_id = ?",
        )
        .bind(piece_id)
        .execute(pool)
        .await
        .context("failed to bring the piece back tomorrow")?;
        return Ok(true);
    }

    let next = done + 1;
    // `None` past the last interval: the schedule is finished, and the row
    // stays with no due date as the record that this piece was carried
    // through. The export reports it.
    let interval = usize::try_from(next).ok().and_then(|step| INTERVALS.get(step)).copied();

    match interval {
        Some(days) => {
            sqlx::query(
                "UPDATE reviews
                    SET done      = ?,
                        due_on    = date('now', '+' || ? || ' days'),
                        last_seen = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                  WHERE piece_id = ?",
            )
            .bind(next)
            .bind(days)
            .bind(piece_id)
            .execute(pool)
            .await
            .context("failed to move the piece along its schedule")?;
        }
        None => {
            sqlx::query(
                "UPDATE reviews
                    SET done      = ?,
                        due_on    = NULL,
                        last_seen = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                  WHERE piece_id = ?",
            )
            .bind(next)
            .bind(piece_id)
            .execute(pool)
            .await
            .context("failed to finish the schedule")?;
        }
    }

    Ok(true)
}

/// What is worth recalling today.
///
/// Everything due on or before today, not only today: a reader who was away
/// for a week comes back to what accumulated rather than to an empty screen
/// that quietly dropped six days of returns.
///
/// # Errors
///
/// Fails when the database cannot be read.
pub async fn due(pool: &SqlitePool, library: &Library) -> Result<Vec<Due>> {
    let rows: Vec<Review> = sqlx::query_as(
        "SELECT piece_id, done, due_on, last_seen
           FROM reviews
          WHERE due_on IS NOT NULL AND due_on <= date('now')
          ORDER BY due_on, piece_id",
    )
    .fetch_all(pool)
    .await
    .context("failed to read what is due")?;

    // A piece renamed in the vault leaves a row pointing at nothing. It is
    // skipped rather than drawn as a card with no text; the export still
    // carries the row, so nothing is lost by not showing it.
    Ok(rows
        .into_iter()
        .filter_map(|row| {
            library.piece(&row.piece_id).map(|piece| Due {
                piece_id: row.piece_id,
                title: piece.title.clone(),
                one_liner: piece.one_liner.clone(),
                step: row.done + 1,
            })
        })
        .collect())
}

/// Every schedule, for the export that returns the reader's side to the vault.
///
/// # Errors
///
/// Fails when the database cannot be read.
pub async fn all(pool: &SqlitePool) -> Result<Vec<Review>> {
    sqlx::query_as::<_, Review>("SELECT piece_id, done, due_on, last_seen FROM reviews ORDER BY piece_id")
        .fetch_all(pool)
        .await
        .context("failed to read the schedules")
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        pool
    }

    /// The schedule of one piece, straight from the table.
    async fn row(pool: &SqlitePool, piece_id: &str) -> Option<Review> {
        sqlx::query_as::<_, Review>("SELECT piece_id, done, due_on, last_seen FROM reviews WHERE piece_id = ?")
            .bind(piece_id)
            .fetch_optional(pool)
            .await
            .unwrap()
    }

    /// The day a piece is due, as an offset in days from today.
    async fn due_in_days(pool: &SqlitePool, piece_id: &str) -> Option<i64> {
        sqlx::query_scalar::<_, i64>(
            "SELECT cast(julianday(due_on) - julianday(date('now')) AS INTEGER)
               FROM reviews WHERE piece_id = ?",
        )
        .bind(piece_id)
        .fetch_optional(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn finishing_a_piece_schedules_it_for_tomorrow() {
        let pool = pool().await;
        follow(&pool, "a/b", true).await.unwrap();
        assert_eq!(due_in_days(&pool, "a/b").await, Some(1));
        assert_eq!(row(&pool, "a/b").await.unwrap().done, 0);
    }

    #[tokio::test]
    async fn re_finishing_does_not_restart_the_schedule() {
        // A reader who re-reads a favourite has not forgotten it; starting
        // over would bring it back tomorrow for having been enjoyed twice.
        let pool = pool().await;
        follow(&pool, "a/b", true).await.unwrap();
        answered(&pool, "a/b", false).await.unwrap();
        assert_eq!(due_in_days(&pool, "a/b").await, Some(7));

        follow(&pool, "a/b", true).await.unwrap();
        assert_eq!(due_in_days(&pool, "a/b").await, Some(7), "re-finishing reset the schedule");
        assert_eq!(row(&pool, "a/b").await.unwrap().done, 1);
    }

    #[tokio::test]
    async fn the_gaps_are_a_day_a_week_and_a_month() {
        let pool = pool().await;
        follow(&pool, "a/b", true).await.unwrap();
        assert_eq!(due_in_days(&pool, "a/b").await, Some(1));

        answered(&pool, "a/b", false).await.unwrap();
        assert_eq!(due_in_days(&pool, "a/b").await, Some(7));

        answered(&pool, "a/b", false).await.unwrap();
        assert_eq!(due_in_days(&pool, "a/b").await, Some(30));
    }

    #[tokio::test]
    async fn the_third_answer_finishes_the_schedule() {
        // After the month, the piece is carried; it never comes back on its
        // own, and the row stays as the record that it was.
        let pool = pool().await;
        follow(&pool, "a/b", true).await.unwrap();
        for _ in 0..3 {
            answered(&pool, "a/b", false).await.unwrap();
        }

        let review = row(&pool, "a/b").await.expect("the row is kept as a record");
        assert_eq!(review.done, 3);
        assert!(review.due_on.is_none(), "a finished schedule still had a due date");
        assert!(review.last_seen.is_some());
    }

    #[tokio::test]
    async fn asking_for_it_again_keeps_the_place_and_returns_tomorrow() {
        // Opening a card is the reader going to read the piece again, not
        // saying they remember it: the step is not retired.
        let pool = pool().await;
        follow(&pool, "a/b", true).await.unwrap();
        answered(&pool, "a/b", false).await.unwrap();
        assert_eq!(due_in_days(&pool, "a/b").await, Some(7));

        answered(&pool, "a/b", true).await.unwrap();
        assert_eq!(due_in_days(&pool, "a/b").await, Some(1), "asking again did not bring it back tomorrow");
        assert_eq!(row(&pool, "a/b").await.unwrap().done, 1, "asking again advanced the schedule");
    }

    #[tokio::test]
    async fn marking_a_piece_unread_takes_it_out_of_the_schedule() {
        // Something in the middle of being read is not a thing to recall.
        let pool = pool().await;
        follow(&pool, "a/b", true).await.unwrap();
        follow(&pool, "a/b", false).await.unwrap();
        assert!(row(&pool, "a/b").await.is_none());
    }

    #[tokio::test]
    async fn answering_for_a_piece_with_no_schedule_says_so() {
        // The app can be holding a stale card - the piece was marked unread
        // on another device - and this is how it finds out.
        let pool = pool().await;
        assert!(!answered(&pool, "a/b", false).await.unwrap());
    }
}
