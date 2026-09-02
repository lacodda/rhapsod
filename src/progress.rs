//! Where the reader is.
//!
//! Three states, one of which needs no storage: a piece with no row has not
//! been opened. What is kept is the paragraph the reader last saw and when
//! they were last there, which is enough to answer both questions the app
//! asks - "where was I" and "what now".

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::library::Library;

/// How far the reader got with one piece.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, sqlx::FromRow)]
pub struct State {
    pub piece_id: String,
    /// `reading` or `read`.
    pub status: String,
    /// Index of the paragraph last seen.
    pub paragraph: i64,
    pub updated_at: String,
    pub read_at: Option<String>,
}

/// What the reader has to show for themselves.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Stats {
    /// Pieces finished.
    pub read: i64,
    /// Words in the pieces finished: the number that grows visibly.
    pub words: i64,
    /// Days in a row with at least one piece finished, counting back from
    /// today; a day missed ends it.
    pub streak: i64,
}

/// Marks a piece as being read, without moving a finished one back.
///
/// Opening a piece that is already read must not undo that: a reader who
/// returns to a favourite has not unfinished it.
///
/// # Errors
///
/// Fails when the database rejects the write.
pub async fn opened(pool: &SqlitePool, piece_id: &str) -> Result<()> {
    sqlx::query(
        "INSERT INTO reading_state (piece_id, status) VALUES (?, 'reading')
         ON CONFLICT (piece_id) DO UPDATE
            SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
    )
    .bind(piece_id)
    .execute(pool)
    .await
    .context("failed to record that the piece was opened")?;
    Ok(())
}

/// Records the paragraph the reader is looking at.
///
/// The position only ever moves forward for a piece being read: a phone that
/// syncs a stale position after the desktop has moved on would otherwise send
/// the reader backwards. Re-reading from the top is done by finishing and
/// reopening, not by scrolling up.
///
/// # Errors
///
/// Fails when the database rejects the write.
pub async fn at_paragraph(pool: &SqlitePool, piece_id: &str, paragraph: i64) -> Result<()> {
    let paragraph = paragraph.max(0);
    sqlx::query(
        "INSERT INTO reading_state (piece_id, status, paragraph) VALUES (?, 'reading', ?)
         ON CONFLICT (piece_id) DO UPDATE
            SET paragraph  = max(paragraph, excluded.paragraph),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
    )
    .bind(piece_id)
    .bind(paragraph)
    .execute(pool)
    .await
    .context("failed to record the reading position")?;
    Ok(())
}

/// Marks a piece finished, or puts a finished one back to being read.
///
/// # Errors
///
/// Fails when the database rejects the write.
pub async fn set_read(pool: &SqlitePool, piece_id: &str, read: bool) -> Result<()> {
    if read {
        sqlx::query(
            "INSERT INTO reading_state (piece_id, status, read_at)
             VALUES (?, 'read', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             ON CONFLICT (piece_id) DO UPDATE
                SET status     = 'read',
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                    -- The day a piece was finished is set once. Re-reading it
                    -- does not move the day it was first read, which is what
                    -- a streak counts.
                    read_at    = coalesce(read_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        )
        .bind(piece_id)
        .execute(pool)
        .await
        .context("failed to mark the piece read")?;
    } else {
        sqlx::query(
            "INSERT INTO reading_state (piece_id, status) VALUES (?, 'reading')
             ON CONFLICT (piece_id) DO UPDATE
                SET status     = 'reading',
                    read_at    = NULL,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        )
        .bind(piece_id)
        .execute(pool)
        .await
        .context("failed to mark the piece unread")?;
    }
    Ok(())
}

/// Every piece the reader has touched.
///
/// The whole set in one query: it is at most a few thousand small rows, and
/// the app needs all of them at once to render counters and to decide what to
/// offer next while offline.
///
/// # Errors
///
/// Fails when the database cannot be read.
pub async fn all(pool: &SqlitePool) -> Result<Vec<State>> {
    sqlx::query_as::<_, State>("SELECT piece_id, status, paragraph, updated_at, read_at FROM reading_state")
        .fetch_all(pool)
        .await
        .context("failed to read the reading state")
}

/// The piece to continue: the most recently touched one still unfinished.
///
/// # Errors
///
/// Fails when the database cannot be read.
pub async fn continue_with(pool: &SqlitePool) -> Result<Option<State>> {
    sqlx::query_as::<_, State>(
        "SELECT piece_id, status, paragraph, updated_at, read_at
           FROM reading_state
          WHERE status = 'reading'
          ORDER BY updated_at DESC
          LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .context("failed to find where to continue")
}

/// What the reader has read.
///
/// # Errors
///
/// Fails when the database cannot be read.
pub async fn stats(pool: &SqlitePool, library: &Library) -> Result<Stats> {
    let finished: Vec<(String, Option<String>)> = sqlx::query_as("SELECT piece_id, read_at FROM reading_state WHERE status = 'read'")
        .fetch_all(pool)
        .await
        .context("failed to read the statistics")?;

    // Words come from the library rather than from a column: the file is the
    // truth about its own length, and a piece that was rewritten should count
    // as what it is now.
    let words = finished
        .iter()
        .filter_map(|(id, _)| library.piece(id))
        .map(|piece| i64::try_from(piece.words).unwrap_or(i64::MAX))
        .sum();

    let mut days: Vec<&str> = finished
        .iter()
        .filter_map(|(_, read_at)| read_at.as_deref())
        .map(|stamp| &stamp[..10.min(stamp.len())])
        .collect();
    days.sort_unstable();
    days.dedup();

    let today = sqlx::query_scalar::<_, String>("SELECT strftime('%Y-%m-%d', 'now')")
        .fetch_one(pool)
        .await
        .context("failed to read the current date")?;
    let yesterday = sqlx::query_scalar::<_, String>("SELECT strftime('%Y-%m-%d', 'now', '-1 day')")
        .fetch_one(pool)
        .await
        .context("failed to read yesterday's date")?;

    Ok(Stats {
        read: i64::try_from(finished.len()).unwrap_or(i64::MAX),
        words,
        streak: streak(&days, &today, &yesterday),
    })
}

/// Consecutive days ending today or yesterday.
///
/// Yesterday counts as the end of a live streak: a reader who has not read
/// yet today has not broken anything, and telling them they have at breakfast
/// is both wrong and discouraging.
fn streak(days_sorted: &[&str], today: &str, yesterday: &str) -> i64 {
    let Some(&last) = days_sorted.last() else {
        return 0;
    };
    if last != today && last != yesterday {
        return 0;
    }

    let mut streak = 1;
    for pair in days_sorted.windows(2).rev() {
        if next_day(pair[0]).as_deref() == Some(pair[1]) {
            streak += 1;
        } else {
            break;
        }
    }
    streak
}

/// The day after a `YYYY-MM-DD` date, by the calendar.
///
/// Written out rather than pulled from a date crate: this is the only date
/// arithmetic in the product, and a dependency for it would be heavier than
/// the twelve lines it replaces.
fn next_day(date: &str) -> Option<String> {
    let mut parts = date.split('-');
    let year: i32 = parts.next()?.parse().ok()?;
    let month: u32 = parts.next()?.parse().ok()?;
    let day: u32 = parts.next()?.parse().ok()?;

    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let length = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return None,
    };

    Some(if day < length {
        format!("{year:04}-{month:02}-{:02}", day + 1)
    } else if month < 12 {
        format!("{year:04}-{:02}-01", month + 1)
    } else {
        format!("{:04}-01-01", year + 1)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn an_untouched_piece_has_no_state() {
        // The third status is the absence of a row; nothing has to keep it in
        // sync with the other two.
        let pool = pool().await;
        assert!(all(&pool).await.unwrap().is_empty());
        assert!(continue_with(&pool).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn opening_a_piece_starts_it() {
        let pool = pool().await;
        opened(&pool, "02-istoriya/god-bez-leta").await.unwrap();

        let states = all(&pool).await.unwrap();
        assert_eq!(states.len(), 1);
        assert_eq!(states[0].status, "reading");
        assert_eq!(states[0].paragraph, 0);
    }

    #[tokio::test]
    async fn reopening_a_finished_piece_does_not_unfinish_it() {
        // A reader who returns to a favourite has not undone having read it.
        let pool = pool().await;
        set_read(&pool, "a/b", true).await.unwrap();
        opened(&pool, "a/b").await.unwrap();
        assert_eq!(all(&pool).await.unwrap()[0].status, "read");
    }

    #[tokio::test]
    async fn the_position_does_not_go_backwards() {
        // A phone that syncs a stale position after the desktop moved on
        // would otherwise send the reader back up the page.
        let pool = pool().await;
        at_paragraph(&pool, "a/b", 12).await.unwrap();
        at_paragraph(&pool, "a/b", 3).await.unwrap();
        assert_eq!(all(&pool).await.unwrap()[0].paragraph, 12);

        at_paragraph(&pool, "a/b", 20).await.unwrap();
        assert_eq!(all(&pool).await.unwrap()[0].paragraph, 20);
    }

    #[tokio::test]
    async fn a_negative_position_is_the_top() {
        let pool = pool().await;
        at_paragraph(&pool, "a/b", -5).await.unwrap();
        assert_eq!(all(&pool).await.unwrap()[0].paragraph, 0);
    }

    #[tokio::test]
    async fn finishing_and_unfinishing_are_both_possible() {
        let pool = pool().await;
        set_read(&pool, "a/b", true).await.unwrap();
        let state = &all(&pool).await.unwrap()[0];
        assert_eq!(state.status, "read");
        assert!(state.read_at.is_some());

        set_read(&pool, "a/b", false).await.unwrap();
        let state = &all(&pool).await.unwrap()[0];
        assert_eq!(state.status, "reading");
        assert!(state.read_at.is_none(), "an unfinished piece still carried a finishing date");
    }

    #[tokio::test]
    async fn re_reading_does_not_move_the_day_it_was_finished() {
        // The streak counts the day a piece was first read; re-reading an old
        // piece must not silently repair a broken streak.
        let pool = pool().await;
        set_read(&pool, "a/b", true).await.unwrap();
        sqlx::query("UPDATE reading_state SET read_at = '2026-01-01T10:00:00.000Z' WHERE piece_id = 'a/b'")
            .execute(&pool)
            .await
            .unwrap();
        set_read(&pool, "a/b", true).await.unwrap();
        assert_eq!(all(&pool).await.unwrap()[0].read_at.as_deref(), Some("2026-01-01T10:00:00.000Z"));
    }

    #[tokio::test]
    async fn continue_offers_the_last_unfinished_piece() {
        let pool = pool().await;
        opened(&pool, "a/first").await.unwrap();
        // A finished piece is not something to continue.
        set_read(&pool, "a/second", true).await.unwrap();
        sqlx::query("UPDATE reading_state SET updated_at = '2030-01-01T00:00:00.000Z' WHERE piece_id = 'a/second'")
            .execute(&pool)
            .await
            .unwrap();

        let next = continue_with(&pool).await.unwrap().expect("there is an unfinished piece");
        assert_eq!(next.piece_id, "a/first");
    }

    #[test]
    fn a_streak_is_consecutive_days_ending_now() {
        // Yesterday still counts: a reader who has not read yet today has not
        // broken anything, and saying so at breakfast is both wrong and
        // discouraging.
        assert_eq!(streak(&["2026-09-01", "2026-09-02"], "2026-09-02", "2026-09-01"), 2);
        assert_eq!(streak(&["2026-08-31", "2026-09-01"], "2026-09-02", "2026-09-01"), 2);
        // A gap ends it, and only the run at the end counts.
        assert_eq!(streak(&["2026-08-20", "2026-09-01", "2026-09-02"], "2026-09-02", "2026-09-01"), 2);
        // Nothing recent is no streak at all.
        assert_eq!(streak(&["2026-08-01"], "2026-09-02", "2026-09-01"), 0);
        assert_eq!(streak(&[], "2026-09-02", "2026-09-01"), 0);
    }

    #[test]
    fn a_streak_crosses_months_and_years() {
        assert_eq!(streak(&["2026-01-31", "2026-02-01"], "2026-02-01", "2026-01-31"), 2);
        assert_eq!(streak(&["2026-12-31", "2027-01-01"], "2027-01-01", "2026-12-31"), 2);
        // 2028 is a leap year: the 29th exists and follows the 28th.
        assert_eq!(streak(&["2028-02-28", "2028-02-29"], "2028-02-29", "2028-02-28"), 2);
        // 2026 is not: March follows the 28th directly.
        assert_eq!(streak(&["2026-02-28", "2026-03-01"], "2026-03-01", "2026-02-28"), 2);
    }
}
