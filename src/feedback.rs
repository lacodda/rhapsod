//! What the reader tells the author, smaller than a note.
//!
//! A note is a paragraph the reader sits down to write, and most of what is
//! worth saying never reaches that size: a piece landed, a line is misspelt.
//! Both are one gesture here - a tap, a selection - and both travel back to the
//! vault through the export like everything else the reader leaves behind.
//!
//! The library files are never touched (ADR 0002). A typo is reported, not
//! corrected: the author fixes it in the vault, where the text lives.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

/// The kinds a reaction can be, in the order the app offers them.
///
/// Two, and they are not degrees of one scale. `good` says the piece works;
/// `struck` says it did something to the reader - the thing an author writes
/// for and cannot see from a word count. There is no negative kind: a piece
/// that did not land already says so twice, by being abandoned partway in the
/// reading state and by having no reaction at all.
pub const KINDS: [&str; 2] = ["good", "struck"];

/// How a piece landed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, sqlx::FromRow)]
pub struct Reaction {
    pub piece_id: String,
    /// One of [`KINDS`].
    pub kind: String,
    pub felt_at: String,
}

/// A misspelling the reader spotted.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, sqlx::FromRow)]
pub struct Typo {
    /// Minted on the device that spotted it, like a quote id (ADR 0003).
    pub id: String,
    pub piece_id: String,
    /// The words as the reader selected them - what the author searches for.
    pub quoted: String,
    /// Where it was when the reader saw it: a hint for the eye, not the way
    /// the typo is found.
    pub paragraph: i64,
    pub spotted_at: String,
}

/// Records how a piece landed, replacing whatever reaction it had.
///
/// One reaction per piece: a reader who reacts twice means the newer one, the
/// same rule bookmarks follow.
///
/// # Errors
///
/// Fails when the kind is not one of [`KINDS`], or the database rejects the
/// write.
pub async fn react(pool: &SqlitePool, piece_id: &str, kind: &str, felt_at: Option<&str>) -> Result<()> {
    // Checked here as well as by the table, so the app gets a message naming
    // the problem rather than a constraint violation from the driver.
    anyhow::ensure!(KINDS.contains(&kind), "no such reaction kind: {kind}");

    sqlx::query(
        "INSERT INTO reactions (piece_id, kind, changed_at) VALUES (?, ?, ?)
         ON CONFLICT (piece_id) DO UPDATE
            SET kind       = excluded.kind,
                felt_at    = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                changed_at = excluded.changed_at
          WHERE coalesce(excluded.changed_at, '') >= coalesce(reactions.changed_at, '')",
    )
    .bind(piece_id)
    .bind(kind)
    .bind(felt_at)
    .execute(pool)
    .await
    .context("failed to record the reaction")?;
    Ok(())
}

/// Takes a reaction back, saying whether there was one.
///
/// # Errors
///
/// Fails when the database rejects the delete.
pub async fn unreact(pool: &SqlitePool, piece_id: &str) -> Result<bool> {
    let removed = sqlx::query("DELETE FROM reactions WHERE piece_id = ?")
        .bind(piece_id)
        .execute(pool)
        .await
        .context("failed to take the reaction off the piece")?;
    Ok(removed.rows_affected() > 0)
}

/// Every reaction, newest first.
///
/// # Errors
///
/// Fails when the database cannot be read.
pub async fn reactions(pool: &SqlitePool, since: Option<&str>) -> Result<Vec<Reaction>> {
    sqlx::query_as::<_, Reaction>(
        "SELECT piece_id, kind, felt_at
           FROM reactions
          WHERE coalesce(changed_at, felt_at) > coalesce(?, '')
          ORDER BY felt_at DESC, piece_id",
    )
    .bind(since)
    .fetch_all(pool)
    .await
    .context("failed to read the reactions")
}

/// Reports a misspelling, returning it as stored.
///
/// # Errors
///
/// Fails when the id or the quoted words are empty, or the database rejects
/// the write.
pub async fn report_typo(pool: &SqlitePool, id: &str, piece_id: &str, paragraph: i64, quoted: &str) -> Result<Typo> {
    let id = id.trim();
    let quoted = quoted.trim();
    anyhow::ensure!(!id.is_empty(), "a typo report needs an id");
    // Without the words there is nothing to act on: a paragraph number alone
    // sends the author hunting through a piece that may since have been
    // edited.
    anyhow::ensure!(!quoted.is_empty(), "a typo report needs the words it is about");

    // The id the device minted makes one report survive however many times its
    // delivery is retried: returning the row that is already there makes a
    // redelivery indistinguishable from the first arrival, which is what lets
    // the queue retry without asking whether it has to.
    sqlx::query_as::<_, Typo>(
        "INSERT INTO typos (id, piece_id, paragraph, quoted)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET id = typos.id
         RETURNING id, piece_id, quoted, paragraph, spotted_at",
    )
    .bind(id)
    .bind(piece_id)
    .bind(paragraph)
    .bind(quoted)
    .fetch_one(pool)
    .await
    .context("failed to report the typo")
}

/// Withdraws a typo report, saying whether there was one.
///
/// # Errors
///
/// Fails when the database rejects the delete.
pub async fn drop_typo(pool: &SqlitePool, id: &str) -> Result<bool> {
    let removed = sqlx::query("DELETE FROM typos WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .context("failed to withdraw the typo report")?;
    Ok(removed.rows_affected() > 0)
}

/// Every typo reported, newest first.
///
/// # Errors
///
/// Fails when the database cannot be read.
pub async fn typos(pool: &SqlitePool, since: Option<&str>) -> Result<Vec<Typo>> {
    sqlx::query_as::<_, Typo>(
        "SELECT id, piece_id, quoted, paragraph, spotted_at
           FROM typos
          WHERE coalesce(changed_at, spotted_at) > coalesce(?, '')
          ORDER BY spotted_at DESC, id",
    )
    .bind(since)
    .fetch_all(pool)
    .await
    .context("failed to read the typos")
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
    async fn a_piece_is_reacted_to_and_the_reaction_taken_back() {
        let pool = pool().await;
        react(&pool, "01-paradoksy/kot", "struck", None).await.unwrap();

        let felt = reactions(&pool, None).await.unwrap();
        assert_eq!(felt.len(), 1);
        assert_eq!(felt[0].kind, "struck");

        assert!(unreact(&pool, "01-paradoksy/kot").await.unwrap());
        assert!(reactions(&pool, None).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn reacting_again_changes_the_kind_rather_than_adding_a_row() {
        // A reader who reacts twice means the newer one, the same rule
        // bookmarks follow.
        let pool = pool().await;
        react(&pool, "01-paradoksy/kot", "good", None).await.unwrap();
        react(&pool, "01-paradoksy/kot", "struck", None).await.unwrap();

        let felt = reactions(&pool, None).await.unwrap();
        assert_eq!(felt.len(), 1, "a second reaction made a second row");
        assert_eq!(felt[0].kind, "struck");
    }

    #[tokio::test]
    async fn a_kind_nothing_can_draw_is_refused() {
        // The app would otherwise store a kind no report can count and no
        // colour exists for, and find out only when the report came back
        // short.
        let pool = pool().await;
        assert!(react(&pool, "01-paradoksy/kot", "meh", None).await.is_err());
        assert!(reactions(&pool, None).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn an_older_reaction_from_a_queue_does_not_undo_a_newer_one() {
        let pool = pool().await;
        react(&pool, "01-paradoksy/kot", "struck", Some("2026-09-06T12:00:00.000Z")).await.unwrap();
        react(&pool, "01-paradoksy/kot", "good", Some("2026-09-06T09:00:00.000Z")).await.unwrap();
        assert_eq!(
            reactions(&pool, None).await.unwrap()[0].kind,
            "struck",
            "an older reaction overwrote a newer one"
        );
    }

    #[tokio::test]
    async fn a_typo_carries_the_words_it_is_about() {
        // The whole point of the report: a paragraph number alone points at
        // words that may have moved, and the author cannot search for a
        // number.
        let pool = pool().await;
        report_typo(&pool, "t-1", "01-paradoksy/kot", 4, "прадокс").await.unwrap();

        let found = typos(&pool, None).await.unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].quoted, "прадокс", "the report lost the words it was about");
        assert_eq!(found[0].paragraph, 4);
    }

    #[tokio::test]
    async fn a_typo_without_words_is_refused() {
        let pool = pool().await;
        assert!(report_typo(&pool, "t-1", "01-paradoksy/kot", 4, "   ").await.is_err());
        assert!(typos(&pool, None).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn redelivering_a_typo_report_does_not_make_a_second_one() {
        // The offline queue retries without asking whether it has to; the id
        // the device minted is what makes that safe.
        let pool = pool().await;
        report_typo(&pool, "t-1", "01-paradoksy/kot", 4, "прадокс").await.unwrap();
        let again = report_typo(&pool, "t-1", "01-paradoksy/kot", 4, "прадокс").await.unwrap();

        assert_eq!(typos(&pool, None).await.unwrap().len(), 1, "a retry made a second report");
        assert_eq!(again.quoted, "прадокс", "the retry did not get the stored report back");
    }

    #[tokio::test]
    async fn a_typo_report_is_withdrawn() {
        let pool = pool().await;
        report_typo(&pool, "t-1", "01-paradoksy/kot", 4, "прадокс").await.unwrap();

        assert!(drop_typo(&pool, "t-1").await.unwrap());
        assert!(typos(&pool, None).await.unwrap().is_empty());
        assert!(!drop_typo(&pool, "t-1").await.unwrap(), "withdrawing nothing said it withdrew something");
    }

    #[tokio::test]
    async fn an_incremental_export_leaves_out_what_has_not_changed() {
        let pool = pool().await;
        react(&pool, "01-paradoksy/kot", "good", None).await.unwrap();
        report_typo(&pool, "t-1", "01-paradoksy/kot", 4, "прадокс").await.unwrap();
        sqlx::query("UPDATE reactions SET felt_at = '2020-01-01T00:00:00.000Z', changed_at = '2020-01-01T00:00:00.000Z'")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE typos SET spotted_at = '2020-01-01T00:00:00.000Z', changed_at = '2020-01-01T00:00:00.000Z'")
            .execute(&pool)
            .await
            .unwrap();

        let bound = Some("2020-06-01T00:00:00.000Z");
        assert!(reactions(&pool, bound).await.unwrap().is_empty());
        assert!(typos(&pool, bound).await.unwrap().is_empty());
        assert_eq!(reactions(&pool, None).await.unwrap().len(), 1, "a full export lost the reaction");
        assert_eq!(typos(&pool, None).await.unwrap().len(), 1, "a full export lost the typo");
    }
}
