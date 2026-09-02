//! What the reader would like written.
//!
//! The author keeps a plan of a couple of thousand topics; the reader points at
//! one and says "this one". That is the whole of it - not a vote, not a
//! priority, not a deadline, but a list the author reads before choosing what
//! to write next.
//!
//! A request carries the topic's words as well as its id. A topic that gets
//! written leaves the plan (it is a novella now), and a request that outlived
//! its topic would otherwise be an id nobody can read.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::topics::Topic;

/// A topic the reader asked for.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, sqlx::FromRow)]
pub struct Request {
    pub topic_id: String,
    /// The title as it read when the request was made.
    pub title: String,
    /// The shelf of the plan it came from.
    pub section: String,
    pub asked_at: String,
}

/// Records that the reader wants a topic written.
///
/// Asking twice is asking once: there is nothing a second request could mean
/// that the first does not already say, and a count would turn one reader's
/// list into a poll with one voter.
///
/// # Errors
///
/// Fails when the database rejects the write.
pub async fn ask(pool: &SqlitePool, topic: &Topic, asked_at: Option<&str>) -> Result<()> {
    sqlx::query(
        "INSERT INTO requests (topic_id, title, section, changed_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (topic_id) DO UPDATE
            SET title      = excluded.title,
                section    = excluded.section,
                changed_at = excluded.changed_at
          WHERE coalesce(excluded.changed_at, '') >= coalesce(requests.changed_at, '')",
    )
    .bind(&topic.id)
    .bind(&topic.title)
    .bind(&topic.section)
    .bind(asked_at)
    .execute(pool)
    .await
    .context("failed to record the request")?;
    Ok(())
}

/// Takes a request back, saying whether there was one.
///
/// # Errors
///
/// Fails when the database rejects the delete.
pub async fn withdraw(pool: &SqlitePool, topic_id: &str) -> Result<bool> {
    let removed = sqlx::query("DELETE FROM requests WHERE topic_id = ?")
        .bind(topic_id)
        .execute(pool)
        .await
        .context("failed to withdraw the request")?;
    Ok(removed.rows_affected() > 0)
}

/// Everything the reader has asked for, newest first.
///
/// # Errors
///
/// Fails when the database cannot be read.
pub async fn all(pool: &SqlitePool, since: Option<&str>) -> Result<Vec<Request>> {
    sqlx::query_as::<_, Request>(
        "SELECT topic_id, title, section, asked_at
           FROM requests
          WHERE coalesce(changed_at, asked_at) > coalesce(?, '')
          ORDER BY asked_at DESC, topic_id",
    )
    .bind(since)
    .fetch_all(pool)
    .await
    .context("failed to read the requests")
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        pool
    }

    fn topic() -> Topic {
        Topic {
            id: "01-paradoksy/paradoks-lzhetsa".into(),
            title: "Парадокс лжеца".into(),
            section: "01 — Парадоксы и эффекты".into(),
        }
    }

    #[tokio::test]
    async fn a_topic_is_asked_for_and_taken_back() {
        let pool = pool().await;
        ask(&pool, &topic(), None).await.unwrap();

        let asked = all(&pool, None).await.unwrap();
        assert_eq!(asked.len(), 1);
        assert_eq!(asked[0].title, "Парадокс лжеца");
        assert_eq!(asked[0].section, "01 — Парадоксы и эффекты");

        assert!(withdraw(&pool, &topic().id).await.unwrap());
        assert!(all(&pool, None).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn asking_twice_is_asking_once() {
        // A second request says nothing the first does not, and a count would
        // turn one reader's list into a poll with one voter.
        let pool = pool().await;
        ask(&pool, &topic(), None).await.unwrap();
        ask(&pool, &topic(), None).await.unwrap();
        assert_eq!(all(&pool, None).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn withdrawing_something_never_asked_for_says_so() {
        // The app can hold a stale list; saying nothing changed lets it find
        // out rather than believing it withdrew something.
        let pool = pool().await;
        assert!(!withdraw(&pool, "nothing/here").await.unwrap());
    }

    #[tokio::test]
    async fn a_request_keeps_the_words_it_was_made_with() {
        // A topic that gets written leaves the plan, taking its title with it.
        // Without the words, a request that outlived its topic would be an id
        // nobody can read - and the export would carry that to the vault.
        let pool = pool().await;
        ask(&pool, &topic(), None).await.unwrap();

        let asked = &all(&pool, None).await.unwrap()[0];
        assert_eq!(asked.title, "Парадокс лжеца", "the request lost the words it was made with");
        assert_eq!(asked.topic_id, topic().id);
    }

    #[tokio::test]
    async fn a_request_from_an_offline_queue_does_not_undo_a_newer_one() {
        let pool = pool().await;
        let mut renamed = topic();
        renamed.title = "Парадокс лжеца (переименован)".into();

        ask(&pool, &renamed, Some("2026-09-02T12:00:00.000Z")).await.unwrap();
        ask(&pool, &topic(), Some("2026-09-02T09:00:00.000Z")).await.unwrap();
        assert_eq!(
            all(&pool, None).await.unwrap()[0].title,
            "Парадокс лжеца (переименован)",
            "an older request overwrote a newer one"
        );
    }

    #[tokio::test]
    async fn an_incremental_export_leaves_out_what_has_not_changed() {
        let pool = pool().await;
        ask(&pool, &topic(), None).await.unwrap();
        sqlx::query("UPDATE requests SET asked_at = '2020-01-01T00:00:00.000Z', changed_at = '2020-01-01T00:00:00.000Z'")
            .execute(&pool)
            .await
            .unwrap();

        let bound = Some("2020-06-01T00:00:00.000Z");
        assert!(all(&pool, bound).await.unwrap().is_empty());
        assert_eq!(all(&pool, None).await.unwrap().len(), 1, "a full export lost the request");
    }
}
