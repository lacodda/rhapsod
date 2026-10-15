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
//!
//! A request lives in three states: asked, heard - the author has it in hand -
//! and gone, once it is written or taken back. Hearing is what keeps a request
//! from reaching the author twice: whatever carries requests to the vault
//! marks the ones it delivered and passes over them the next time.

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
    /// When the author first had it, or nothing while it is only asked for.
    /// Absent from exports taken before requests could be heard.
    #[serde(default)]
    pub heard_at: Option<String>,
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
    // Asked when the device says: a request made away from home is dated by
    // the reader's day, not by the stand's.
    sqlx::query(
        "INSERT INTO requests (topic_id, title, section, asked_at, changed_at)
         VALUES (?1, ?2, ?3, coalesce(?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), ?4)
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

/// Records that the author has a request in hand, saying whether there was one.
///
/// The first hearing stays: delivering a request is done again whenever the
/// delivery is rerun, and the day it first reached the author is the one that
/// means something. A repeat is not a change either, so it leaves `changed_at`
/// alone and an incremental export does not report it again.
///
/// # Errors
///
/// Fails when the database rejects the write.
pub async fn hear(pool: &SqlitePool, topic_id: &str) -> Result<bool> {
    // SET reads the row as it was, so both lines test the old heard_at.
    let heard = sqlx::query(
        "UPDATE requests
            SET heard_at   = coalesce(heard_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                changed_at = CASE WHEN heard_at IS NULL
                                  THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                                  ELSE changed_at END
          WHERE topic_id = ?",
    )
    .bind(topic_id)
    .execute(pool)
    .await
    .context("failed to record that the request was heard")?;
    Ok(heard.rows_affected() > 0)
}

/// Everything the reader has asked for, newest first.
///
/// # Errors
///
/// Fails when the database cannot be read.
pub async fn all(pool: &SqlitePool, since: Option<&str>) -> Result<Vec<Request>> {
    sqlx::query_as::<_, Request>(
        "SELECT topic_id, title, section, asked_at, heard_at
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
        let left = all(&pool, None).await.unwrap();
        assert!(left.is_empty(), "expected nothing, got {left:?}");
    }

    #[tokio::test]
    async fn a_request_delivered_late_is_dated_by_the_device() {
        let pool = pool().await;
        ask(&pool, &topic(), Some("2026-09-07T07:15:00.000Z")).await.unwrap();
        assert_eq!(
            all(&pool, None).await.unwrap()[0].asked_at,
            "2026-09-07T07:15:00.000Z",
            "the request was dated by its delivery"
        );
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
    async fn a_request_is_heard_once_and_keeps_the_first_hearing() {
        let pool = pool().await;
        ask(&pool, &topic(), None).await.unwrap();
        assert_eq!(all(&pool, None).await.unwrap()[0].heard_at, None, "a fresh request came out heard");

        assert!(hear(&pool, &topic().id).await.unwrap());
        let first = all(&pool, None).await.unwrap()[0].heard_at.clone();
        assert!(first.is_some(), "hearing a request left it unheard");

        // A rerun delivery hears it again; the day it first reached the
        // author is the one that stays.
        sqlx::query("UPDATE requests SET heard_at = '2026-09-16T14:30:00.000Z' WHERE topic_id = ?")
            .bind(&topic().id)
            .execute(&pool)
            .await
            .unwrap();
        assert!(hear(&pool, &topic().id).await.unwrap());
        assert_eq!(
            all(&pool, None).await.unwrap()[0].heard_at.as_deref(),
            Some("2026-09-16T14:30:00.000Z"),
            "a second hearing moved the first"
        );
    }

    #[tokio::test]
    async fn asking_again_does_not_unhear_a_request() {
        // Asking twice is asking once - the reader tapping a heard request's
        // topic in the plan must not send it to the author a second time.
        let pool = pool().await;
        ask(&pool, &topic(), None).await.unwrap();
        hear(&pool, &topic().id).await.unwrap();
        ask(&pool, &topic(), Some("2999-01-01T00:00:00.000Z")).await.unwrap();
        assert!(all(&pool, None).await.unwrap()[0].heard_at.is_some(), "asking again forgot the hearing");
    }

    #[tokio::test]
    async fn a_request_taken_back_and_asked_anew_starts_unheard() {
        let pool = pool().await;
        ask(&pool, &topic(), None).await.unwrap();
        hear(&pool, &topic().id).await.unwrap();
        withdraw(&pool, &topic().id).await.unwrap();
        ask(&pool, &topic(), None).await.unwrap();
        assert_eq!(all(&pool, None).await.unwrap()[0].heard_at, None, "a new request inherited an old hearing");
    }

    #[tokio::test]
    async fn hearing_something_never_asked_for_says_so() {
        let pool = pool().await;
        assert!(!hear(&pool, "nothing/here").await.unwrap());
    }

    #[tokio::test]
    async fn an_incremental_export_reports_a_hearing_once() {
        let pool = pool().await;
        ask(&pool, &topic(), None).await.unwrap();
        sqlx::query("UPDATE requests SET asked_at = '2020-01-01T00:00:00.000Z', changed_at = '2020-01-01T00:00:00.000Z' WHERE topic_id = ?")
            .bind(&topic().id)
            .execute(&pool)
            .await
            .unwrap();
        let bound = Some("2025-01-01T00:00:00.000Z");

        hear(&pool, &topic().id).await.unwrap();
        assert_eq!(all(&pool, bound).await.unwrap().len(), 1, "a hearing did not reach an incremental export");

        // A repeat hearing is not news.
        sqlx::query("UPDATE requests SET changed_at = '2020-01-01T00:00:00.000Z' WHERE topic_id = ?")
            .bind(&topic().id)
            .execute(&pool)
            .await
            .unwrap();
        hear(&pool, &topic().id).await.unwrap();
        let left = all(&pool, bound).await.unwrap();
        assert!(left.is_empty(), "a repeat hearing was reported as a change, got {left:?}");
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
        sqlx::query("UPDATE requests SET asked_at = '2020-01-01T00:00:00.000Z', changed_at = '2020-01-01T00:00:00.000Z' WHERE topic_id = ?")
            .bind(&topic().id)
            .execute(&pool)
            .await
            .unwrap();

        let bound = Some("2025-01-01T00:00:00.000Z");
        assert!(all(&pool, bound).await.unwrap().is_empty(), "an aged request was reported as changed");
        assert_eq!(all(&pool, None).await.unwrap().len(), 1, "a full export lost the request");

        // A request asked after the bound is returned.
        let mut other = topic();
        other.id = "01-paradoksy/paradoks-korablya-teseya".into();
        other.title = "Парадокс корабля Тесея".into();
        ask(&pool, &other, None).await.unwrap();

        let fresh = all(&pool, bound).await.unwrap();
        assert_eq!(fresh.len(), 1, "a request asked after the bound did not reach an incremental export");
        assert_eq!(fresh[0].topic_id, other.id);

        // Asking twice is asking once (per the doc comment on `ask`): a
        // re-ask of the aged topic with the same words is not a change, so it
        // must not bring the aged row back into an incremental export.
        ask(&pool, &topic(), None).await.unwrap();
        let after_reask = all(&pool, bound).await.unwrap();
        assert_eq!(
            after_reask.len(),
            1,
            "a re-ask with no new information was treated as a change to the aged request"
        );
        assert_eq!(after_reask[0].topic_id, other.id, "the re-asked topic reappeared in the incremental export");

        assert!(
            all(&pool, Some("2999-01-01T00:00:00.000Z")).await.unwrap().is_empty(),
            "a bound after every change still returned rows"
        );
    }
}
