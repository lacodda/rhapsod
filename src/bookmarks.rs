//! Pieces the reader wants to find again.
//!
//! A quote is a sentence worth keeping; a bookmark is a whole piece worth
//! returning to. Reading state records what happened, a bookmark records what
//! the reader intends to do about it.
//!
//! There are four kinds and they are fixed. A reader marking a piece means one
//! of a small number of things - it was good, come back to this, there is a
//! song in it, read it again - and a set that can be defined would buy a
//! settings screen in exchange for flexibility one reader rarely wants.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

/// The kinds a bookmark can be, in the order the app offers them.
///
/// The strings are what the database stores and what the API speaks; the
/// colours belong to the app, which knows about the theme. Kept here as the
/// one list, so a kind added later cannot be added to only half the product.
pub const KINDS: [&str; 4] = ["loved", "return", "song", "reread"];

/// A piece the reader marked.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, sqlx::FromRow)]
pub struct Bookmark {
    pub piece_id: String,
    /// One of [`KINDS`].
    pub kind: String,
    pub marked_at: String,
}

/// Marks a piece, replacing whatever kind it had.
///
/// One bookmark per piece: marking a piece "loved" that was already "reread"
/// changes the kind rather than making a second row. A reader who does that
/// means the newer one.
///
/// # Errors
///
/// Fails when the kind is not one of [`KINDS`], or the database rejects the
/// write.
pub async fn mark(pool: &SqlitePool, piece_id: &str, kind: &str, marked_at: Option<&str>) -> Result<()> {
    // Checked here as well as by the table, so the app gets a message naming
    // the problem rather than a constraint violation from the driver.
    anyhow::ensure!(KINDS.contains(&kind), "no such bookmark kind: {kind}");

    sqlx::query(
        "INSERT INTO bookmarks (piece_id, kind, changed_at) VALUES (?, ?, ?)
         ON CONFLICT (piece_id) DO UPDATE
            SET kind       = excluded.kind,
                marked_at  = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                changed_at = excluded.changed_at
          WHERE coalesce(excluded.changed_at, '') >= coalesce(bookmarks.changed_at, '')",
    )
    .bind(piece_id)
    .bind(kind)
    .bind(marked_at)
    .execute(pool)
    .await
    .context("failed to mark the piece")?;
    Ok(())
}

/// Takes the mark off a piece, saying whether there was one.
///
/// # Errors
///
/// Fails when the database rejects the delete.
pub async fn unmark(pool: &SqlitePool, piece_id: &str) -> Result<bool> {
    let removed = sqlx::query("DELETE FROM bookmarks WHERE piece_id = ?")
        .bind(piece_id)
        .execute(pool)
        .await
        .context("failed to take the mark off the piece")?;
    Ok(removed.rows_affected() > 0)
}

/// Every bookmark, newest first.
///
/// The whole set in one query, like progress and marks: the app shows a
/// colour on every row of every shelf, and asking per piece would put the
/// same handful of rows on the wire once a line.
///
/// # Errors
///
/// Fails when the database cannot be read.
pub async fn all(pool: &SqlitePool, since: Option<&str>) -> Result<Vec<Bookmark>> {
    sqlx::query_as::<_, Bookmark>(
        "SELECT piece_id, kind, marked_at
           FROM bookmarks
          WHERE coalesce(changed_at, marked_at) > coalesce(?, '')
          ORDER BY marked_at DESC, piece_id",
    )
    .bind(since)
    .fetch_all(pool)
    .await
    .context("failed to read the bookmarks")
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
    async fn a_piece_is_marked_and_unmarked() {
        let pool = pool().await;
        mark(&pool, "a/b", "loved", None).await.unwrap();

        let marked = all(&pool, None).await.unwrap();
        assert_eq!(marked.len(), 1);
        assert_eq!(marked[0].kind, "loved");

        assert!(unmark(&pool, "a/b").await.unwrap());
        assert!(all(&pool, None).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn unmarking_a_piece_that_was_not_marked_says_so() {
        // The app can hold a stale list - the mark was taken off on another
        // device - and this is how it finds out.
        let pool = pool().await;
        assert!(!unmark(&pool, "a/b").await.unwrap());
    }

    #[tokio::test]
    async fn one_piece_has_one_mark() {
        // Marking a piece a second way means the newer way, not both.
        let pool = pool().await;
        mark(&pool, "a/b", "reread", None).await.unwrap();
        mark(&pool, "a/b", "loved", None).await.unwrap();

        let marked = all(&pool, None).await.unwrap();
        assert_eq!(marked.len(), 1, "a second kind made a second bookmark");
        assert_eq!(marked[0].kind, "loved");
    }

    #[tokio::test]
    async fn a_kind_nothing_can_draw_is_refused() {
        // A typo in a client would otherwise become a colour no screen knows
        // and a filter nothing matches.
        let pool = pool().await;
        let error = mark(&pool, "a/b", "favourite", None).await.unwrap_err();
        assert!(error.to_string().contains("favourite"), "{error}");
        assert!(all(&pool, None).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn every_offered_kind_is_accepted() {
        // The list the app offers and the list the database allows have to be
        // the same list; this fails if either grows without the other.
        let pool = pool().await;
        for kind in KINDS {
            mark(&pool, "a/b", kind, None)
                .await
                .unwrap_or_else(|error| panic!("{kind} was refused: {error}"));
        }
    }

    #[tokio::test]
    async fn a_mark_from_an_offline_queue_does_not_undo_a_newer_one() {
        // The same rule as every other thing the reader writes: the device
        // clock decides, not the order the two reached the database.
        let pool = pool().await;
        mark(&pool, "a/b", "loved", Some("2026-09-02T12:00:00.000Z")).await.unwrap();
        mark(&pool, "a/b", "reread", Some("2026-09-02T09:00:00.000Z")).await.unwrap();
        assert_eq!(all(&pool, None).await.unwrap()[0].kind, "loved", "an older mark overwrote a newer one");

        mark(&pool, "a/b", "song", Some("2026-09-02T18:00:00.000Z")).await.unwrap();
        assert_eq!(all(&pool, None).await.unwrap()[0].kind, "song", "a newer mark was dropped");
    }

    #[tokio::test]
    async fn an_incremental_export_leaves_out_what_has_not_changed() {
        let pool = pool().await;
        mark(&pool, "a/b", "loved", None).await.unwrap();
        sqlx::query("UPDATE bookmarks SET marked_at = '2020-01-01T00:00:00.000Z', changed_at = '2020-01-01T00:00:00.000Z'")
            .execute(&pool)
            .await
            .unwrap();

        let bound = Some("2020-06-01T00:00:00.000Z");
        assert!(all(&pool, bound).await.unwrap().is_empty());
        assert_eq!(all(&pool, None).await.unwrap().len(), 1, "a full export lost the bookmark");

        mark(&pool, "a/c", "song", None).await.unwrap();
        let fresh = all(&pool, bound).await.unwrap();
        assert_eq!(fresh.len(), 1);
        assert_eq!(fresh[0].piece_id, "a/c");
    }
}
