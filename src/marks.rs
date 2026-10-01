//! What the reader leaves behind: a note on a piece, and the lines kept from it.
//!
//! Both are the reader's, not the library's. The markdown files are never
//! touched (ADR 0002); these come back out through the export that returns
//! them to the vault.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

/// A note on one piece.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, sqlx::FromRow)]
pub struct Note {
    pub piece_id: String,
    /// Markdown, as typed.
    pub body: String,
    pub updated_at: String,
}

/// A line the reader kept, with an optional comment of their own.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, sqlx::FromRow)]
pub struct Quote {
    /// Minted on the device that kept the line, so a highlight made away from
    /// home can be commented on and removed before the stand hears about it
    /// (ADR 0003).
    pub id: String,
    pub piece_id: String,
    pub paragraph: i64,
    /// The exact text that was selected.
    pub text: String,
    pub comment: Option<String>,
    pub created_at: String,
}

/// What separates text the writer had not seen from what they wrote.
const GAP: &str = "\n\n";

/// The note to keep, given what is stored and what the edit started from;
/// `None` when nothing changes.
///
/// A note is sent whole. That is right when the writer was looking at what is
/// stored, and destroys text when they were not: a note started on a train
/// with nothing held, delivered at home, replaced the note written there. So
/// stored text the edit did not start from stays, first, and the new text
/// goes after it. `None` for the base is "no note was known", which keeps any
/// note there is.
#[must_use]
pub fn settle(current: &str, base: Option<&str>, next: &str) -> Option<String> {
    let seen = base.unwrap_or("");
    if current == seen {
        return (current != next).then(|| next.to_owned());
    }
    // A retry of a write that already landed: the connection dropped after
    // the stand took it and before the answer came back. Taking it again
    // would put the text after itself.
    if current == next || (!next.is_empty() && current.ends_with(&format!("{GAP}{next}"))) {
        return None;
    }
    // What is stored that the writer has not seen. An earlier save of the
    // same edit may already have gone after it; then the stored note is the
    // unseen text followed by that save, and only the unseen part is kept
    // again - a note typed over several pauses must not repeat itself.
    let unseen = match current.strip_suffix(seen) {
        Some(rest) if !seen.is_empty() => rest.strip_suffix(GAP).unwrap_or(current),
        _ => current,
    };
    // Emptying a note takes away only what the writer saw.
    let settled = if next.is_empty() {
        unseen.to_owned()
    } else if unseen.is_empty() {
        next.to_owned()
    } else {
        format!("{unseen}{GAP}{next}")
    };
    (settled != current).then_some(settled)
}

/// Writes a note that says what it was an edit of.
///
/// `base` is the text the edit started from, or `None` when the note was not
/// known - the app opened away from home with none of the reader's notes on
/// the device. The write is decided by content, not by the clock (see
/// [`settle`]): the result is stored whatever the order of the two
/// `marked_at`s, and carries the newer of them. The clock is the wrong judge
/// here - a note typed on a train and delivered after one written at home
/// lost to the newer stamp, or wrote over a note it had never seen, and either
/// way the reader's words were gone.
///
/// # Errors
///
/// Fails when the database rejects the write.
pub async fn settle_note(pool: &SqlitePool, piece_id: &str, body: &str, marked_at: Option<&str>, base: Option<&str>) -> Result<()> {
    let body = body.trim();
    let seen = base.map(str::trim);

    // The write lock is taken before the note is read, not when it is
    // written: with a plain BEGIN two deliveries could both read the same
    // note and the second would settle against text that was no longer
    // there. IMMEDIATE makes the second wait for the first.
    let mut transaction = pool.begin_with("BEGIN IMMEDIATE").await.context("failed to start writing the note")?;
    let stored: Option<(String, Option<String>)> = sqlx::query_as("SELECT body, marked_at FROM notes WHERE piece_id = ?")
        .bind(piece_id)
        .fetch_optional(&mut *transaction)
        .await
        .context("failed to read the note")?;
    let (current, stored_at) = stored.unwrap_or_default();

    let Some(settled) = settle(&current, seen, body) else {
        // Nothing to change; the lock goes with the transaction.
        return Ok(());
    };
    if settled.is_empty() {
        sqlx::query("DELETE FROM notes WHERE piece_id = ?")
            .bind(piece_id)
            .execute(&mut *transaction)
            .await
            .context("failed to clear the note")?;
    } else {
        sqlx::query(
            "INSERT INTO notes (piece_id, body, marked_at) VALUES (?, ?, ?)
             ON CONFLICT (piece_id) DO UPDATE
                SET body = excluded.body,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                    marked_at = excluded.marked_at",
        )
        .bind(piece_id)
        .bind(&settled)
        // The newer of the two, so a later write that goes by the clock -
        // an older app's - replaces this one only if it is newer than both.
        .bind(marked_at.max(stored_at.as_deref()))
        .execute(&mut *transaction)
        .await
        .context("failed to save the note")?;
    }
    transaction.commit().await.context("failed to save the note")?;
    Ok(())
}

/// Writes a note, or removes it when the body is empty.
///
/// An empty note is the absence of one: keeping an empty row would put a note
/// marker on a piece that has nothing written about it.
///
/// The newest `marked_at` wins. This is the write of an app from before
/// [`settle_note`], still cached on a phone somewhere, and of the restore.
///
/// # Errors
///
/// Fails when the database rejects the write.
pub async fn set_note(pool: &SqlitePool, piece_id: &str, body: &str, marked_at: Option<&str>) -> Result<()> {
    let body = body.trim();
    if body.is_empty() {
        // Clearing is a write like any other, so it can lose to a newer one:
        // a note emptied on a train and delivered after it was rewritten at
        // home must not take the rewrite with it.
        sqlx::query("DELETE FROM notes WHERE piece_id = ? AND coalesce(?, '') >= coalesce(marked_at, '')")
            .bind(piece_id)
            .bind(marked_at)
            .execute(pool)
            .await
            .context("failed to clear the note")?;
        return Ok(());
    }

    sqlx::query(
        "INSERT INTO notes (piece_id, body, marked_at) VALUES (?, ?, ?)
         ON CONFLICT (piece_id) DO UPDATE
            SET body = excluded.body,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                marked_at = excluded.marked_at
          WHERE coalesce(excluded.marked_at, '') >= coalesce(notes.marked_at, '')",
    )
    .bind(piece_id)
    .bind(body)
    .bind(marked_at)
    .execute(pool)
    .await
    .context("failed to save the note")?;
    Ok(())
}

/// Every note the reader has written.
///
/// # Errors
///
/// Fails when the database cannot be read.
pub async fn notes(pool: &SqlitePool, since: Option<&str>) -> Result<Vec<Note>> {
    // The tiebreak matters: two notes written inside the same millisecond
    // would otherwise come back in whatever order the page produced them.
    sqlx::query_as::<_, Note>(
        "SELECT piece_id, body, updated_at
           FROM notes
          WHERE updated_at > coalesce(?, '')
          ORDER BY updated_at DESC, piece_id",
    )
    .bind(since)
    .fetch_all(pool)
    .await
    .context("failed to read the notes")
}

/// Keeps a line, returning the quote as stored.
///
/// # Errors
///
/// Fails when the text is empty or the database rejects the write.
pub async fn add_quote(pool: &SqlitePool, id: &str, piece_id: &str, paragraph: i64, text: &str, comment: Option<&str>) -> Result<Quote> {
    let text = text.trim();
    let id = id.trim();
    anyhow::ensure!(!text.is_empty(), "a quote needs some text");
    anyhow::ensure!(!id.is_empty(), "a quote needs an id");
    let comment = comment.map(str::trim).filter(|comment| !comment.is_empty());

    // The same line kept twice is two quotes on purpose - two readings can
    // mark the same sentence - so the text cannot tell a retry from a second
    // keeping. The id the device minted can: one act of keeping, however many
    // times its delivery is retried. Returning the row that is already there
    // makes a redelivery indistinguishable from the first arrival, which is
    // what lets the queue retry without asking whether it has to.
    sqlx::query_as::<_, Quote>(
        "INSERT INTO quotes (id, piece_id, paragraph, text, comment, changed_at)
         VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT (id) DO UPDATE SET id = excluded.id
         RETURNING id, piece_id, paragraph, text, comment, created_at",
    )
    .bind(id)
    .bind(piece_id)
    .bind(paragraph.max(0))
    .bind(text)
    .bind(comment)
    .fetch_one(pool)
    .await
    .context("failed to keep the quote")
}

/// Changes what the reader said about a quote.
///
/// # Errors
///
/// Fails when the database rejects the write.
pub async fn comment_on(pool: &SqlitePool, id: &str, comment: Option<&str>) -> Result<bool> {
    let comment = comment.map(str::trim).filter(|comment| !comment.is_empty());
    //  moves with the comment: an incremental export finds a
    // quote by it, and a comment edited without moving it would never reach
    // the vault - while every export kept reporting success.
    let changed = sqlx::query("UPDATE quotes SET comment = ?, changed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
        .bind(comment)
        .bind(id)
        .execute(pool)
        .await
        .context("failed to save the comment")?;
    Ok(changed.rows_affected() > 0)
}

/// Removes a quote.
///
/// # Errors
///
/// Fails when the database rejects the delete.
pub async fn remove_quote(pool: &SqlitePool, id: &str) -> Result<bool> {
    let removed = sqlx::query("DELETE FROM quotes WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .context("failed to remove the quote")?;
    Ok(removed.rows_affected() > 0)
}

/// Every quote the reader has kept, newest first.
///
/// # Errors
///
/// Fails when the database cannot be read.
pub async fn quotes(pool: &SqlitePool, since: Option<&str>) -> Result<Vec<Quote>> {
    // Filtered on `changed_at`, not `created_at`: a comment edited long after
    // the line was kept has to reach the vault, and keying on when the quote
    // was made would leave that edit behind while every export reported
    // success.
    //
    // The tiebreak is the id, which says nothing about order but is stable:
    // two quotes kept inside the same millisecond have to come back in some
    // fixed order, and "whatever the page produced" is not one.
    sqlx::query_as::<_, Quote>(
        "SELECT id, piece_id, paragraph, text, comment, created_at
           FROM quotes
          WHERE coalesce(changed_at, created_at) > coalesce(?, '')
          ORDER BY created_at DESC, id DESC",
    )
    .bind(since)
    .fetch_all(pool)
    .await
    .context("failed to read the quotes")
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
    async fn a_note_is_written_and_rewritten() {
        let pool = pool().await;
        set_note(&pool, "a/b", "first thought", None).await.unwrap();
        assert_eq!(notes(&pool, None).await.unwrap()[0].body, "first thought");

        set_note(&pool, "a/b", "second thought", None).await.unwrap();
        let notes = notes(&pool, None).await.unwrap();
        assert_eq!(notes.len(), 1, "rewriting a note made a second one");
        assert_eq!(notes[0].body, "second thought");
    }

    #[tokio::test]
    async fn an_emptied_note_is_no_note() {
        // Keeping an empty row would put a note marker on a piece that has
        // nothing written about it.
        let pool = pool().await;
        set_note(&pool, "a/b", "something", None).await.unwrap();
        set_note(&pool, "a/b", "   ", None).await.unwrap();
        assert!(notes(&pool, None).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_quote_keeps_its_text_and_its_place() {
        let pool = pool().await;
        let quote = add_quote(&pool, "q-1", "a/b", 3, "  the line itself  ", Some("why it matters")).await.unwrap();
        assert_eq!(quote.text, "the line itself", "the quote was stored with its whitespace");
        assert_eq!(quote.paragraph, 3);
        assert_eq!(quote.comment.as_deref(), Some("why it matters"));
    }

    #[tokio::test]
    async fn a_quote_needs_text() {
        // A selection of nothing is a mis-tap, not something to keep.
        let pool = pool().await;
        assert!(add_quote(&pool, "q-2", "a/b", 0, "   ", None).await.is_err());
    }

    #[tokio::test]
    async fn a_blank_comment_is_no_comment() {
        let pool = pool().await;
        let quote = add_quote(&pool, "q-3", "a/b", 0, "text", Some("  ")).await.unwrap();
        assert!(quote.comment.is_none());
    }

    #[tokio::test]
    async fn the_same_line_can_be_kept_twice() {
        // Two readings of the same piece can mark the same sentence, and the
        // second is not a mistake to reject.
        let pool = pool().await;
        let first = add_quote(&pool, "q-4", "a/b", 0, "one line", None).await.unwrap();
        let second = add_quote(&pool, "q-5", "a/b", 0, "one line", Some("again")).await.unwrap();
        assert_ne!(first.id, second.id);
        assert_eq!(quotes(&pool, None).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn a_comment_can_be_added_and_taken_back() {
        let pool = pool().await;
        let quote = add_quote(&pool, "q-6", "a/b", 0, "text", None).await.unwrap();

        assert!(comment_on(&pool, &quote.id, Some("a thought")).await.unwrap());
        assert_eq!(quotes(&pool, None).await.unwrap()[0].comment.as_deref(), Some("a thought"));

        assert!(comment_on(&pool, &quote.id, None).await.unwrap());
        assert!(quotes(&pool, None).await.unwrap()[0].comment.is_none());
    }

    #[tokio::test]
    async fn changing_a_quote_that_is_not_there_says_so() {
        // The app has a stale list; saying nothing changed lets it find out.
        let pool = pool().await;
        assert!(!comment_on(&pool, "no-such-quote", Some("x")).await.unwrap());
        assert!(!remove_quote(&pool, "no-such-quote").await.unwrap());
    }

    #[tokio::test]
    async fn a_note_from_an_offline_queue_does_not_undo_a_newer_one() {
        // A note written on a train and delivered after one written at home
        // is the older of the two, whatever order they arrived in.
        let pool = pool().await;
        set_note(&pool, "a/b", "written at home", Some("2026-09-02T12:00:00.000Z")).await.unwrap();
        set_note(&pool, "a/b", "written on the train", Some("2026-09-02T09:00:00.000Z")).await.unwrap();
        assert_eq!(notes(&pool, None).await.unwrap()[0].body, "written at home");

        // And the other direction: a genuinely newer note still lands.
        set_note(&pool, "a/b", "written later", Some("2026-09-02T18:00:00.000Z")).await.unwrap();
        assert_eq!(notes(&pool, None).await.unwrap()[0].body, "written later");
    }

    #[tokio::test]
    async fn clearing_a_note_can_lose_to_a_newer_write() {
        // Clearing is a write like any other. An emptied note delivered after
        // the note was rewritten must not take the rewrite with it.
        let pool = pool().await;
        set_note(&pool, "a/b", "rewritten at home", Some("2026-09-02T12:00:00.000Z")).await.unwrap();
        set_note(&pool, "a/b", "", Some("2026-09-02T09:00:00.000Z")).await.unwrap();
        assert_eq!(notes(&pool, None).await.unwrap().len(), 1, "a stale clearing removed a newer note");

        set_note(&pool, "a/b", "", Some("2026-09-02T18:00:00.000Z")).await.unwrap();
        assert!(notes(&pool, None).await.unwrap().is_empty(), "a newer clearing did not remove the note");
    }

    #[tokio::test]
    async fn a_quote_delivered_twice_is_kept_once() {
        // A connection dropped mid-drain leaves the app unsure whether the
        // quote landed, so it retries with the id it minted; the second
        // arrival returns the quote that is already there.
        let pool = pool().await;
        let first = add_quote(&pool, "device-1", "a/b", 0, "one line", None).await.unwrap();
        let again = add_quote(&pool, "device-1", "a/b", 0, "one line", None).await.unwrap();

        assert_eq!(first.id, again.id, "a redelivered quote was kept as a second one");
        assert_eq!(quotes(&pool, None).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn two_keepings_of_the_same_line_are_still_two_quotes() {
        // The identity is the act of keeping, not the text: two readings can
        // mark the same sentence, and neither is a retry of the other.
        let pool = pool().await;
        add_quote(&pool, "device-1", "a/b", 0, "one line", None).await.unwrap();
        add_quote(&pool, "device-2", "a/b", 0, "one line", None).await.unwrap();
        assert_eq!(quotes(&pool, None).await.unwrap().len(), 2);

        // And a quote kept with no id at all is nobody's retry: the unique
        // index ignores nulls, which is what lets the two coexist.
        add_quote(&pool, "q-7", "a/b", 0, "one line", None).await.unwrap();
        add_quote(&pool, "q-8", "a/b", 0, "one line", None).await.unwrap();
        assert_eq!(quotes(&pool, None).await.unwrap().len(), 4);
    }

    #[tokio::test]
    async fn an_edited_comment_makes_the_quote_change_again() {
        // The defect this column exists for: a comment edited long after the
        // line was kept would be invisible to an incremental export, and the
        // vault would keep a stale comment while every export reported
        // success. Keyed on when the quote was made, this test fails.
        let pool = pool().await;
        let quote = add_quote(&pool, "q-edit", "a/b", 0, "a line", None).await.unwrap();

        // Age the row: nothing has changed since the bound below.
        sqlx::query("UPDATE quotes SET created_at = '2020-01-01T00:00:00.000Z', changed_at = '2020-01-01T00:00:00.000Z'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(quotes(&pool, Some("2020-06-01T00:00:00.000Z")).await.unwrap().is_empty());

        // Editing the comment brings it back into range.
        comment_on(&pool, &quote.id, Some("a thought")).await.unwrap();
        let changed = quotes(&pool, Some("2020-06-01T00:00:00.000Z")).await.unwrap();
        assert_eq!(changed.len(), 1, "an edited comment did not reach an incremental export");
        assert_eq!(changed[0].comment.as_deref(), Some("a thought"));
    }

    #[tokio::test]
    async fn an_incremental_export_leaves_out_what_has_not_changed() {
        // The same note across the boundary: aged, then rewritten through the
        // module's own function, which stamps "now". An incremental export
        // has to see the new body, not skip the row because it already knew
        // about it.
        let pool = pool().await;
        set_note(&pool, "a/b", "written before", None).await.unwrap();
        sqlx::query("UPDATE notes SET updated_at = '2020-01-01T00:00:00.000Z' WHERE piece_id = 'a/b'")
            .execute(&pool)
            .await
            .unwrap();

        let bound = Some("2025-01-01T00:00:00.000Z");
        assert!(notes(&pool, bound).await.unwrap().is_empty(), "an aged note was reported as changed");

        set_note(&pool, "a/b", "rewritten now", None).await.unwrap();

        let changed = notes(&pool, bound).await.unwrap();
        assert_eq!(changed.len(), 1, "a note rewritten after the bound did not reach an incremental export");
        assert_eq!(changed[0].piece_id, "a/b");
        assert_eq!(changed[0].body, "rewritten now", "the incremental export did not carry the new body");

        assert!(
            notes(&pool, Some("2999-01-01T00:00:00.000Z")).await.unwrap().is_empty(),
            "a bound after the change still returned the row"
        );

        // A full export still carries it: the bound is what filters, not the
        // query.
        assert_eq!(notes(&pool, None).await.unwrap().len(), 1);
    }

    #[test]
    fn settle_writes_the_note_when_nothing_was_there() {
        assert_eq!(settle("", None, "new").as_deref(), Some("new"));
        assert_eq!(settle("", Some(""), "new").as_deref(), Some("new"));
    }

    #[test]
    fn settle_takes_the_edit_when_the_writer_saw_what_is_stored() {
        assert_eq!(settle("old", Some("old"), "old, and more").as_deref(), Some("old, and more"));
    }

    #[test]
    fn settle_keeps_text_the_writer_never_saw_ahead_of_theirs() {
        // The defect this exists for: a note started away from home with
        // nothing held, delivered over the note written at home.
        assert_eq!(settle("from home", None, "from the train").as_deref(), Some("from home\n\nfrom the train"));
        assert_eq!(settle("from home", Some(""), "from the train").as_deref(), Some("from home\n\nfrom the train"));
        assert_eq!(
            settle("edited at home", Some("as it was"), "as it was, on the train").as_deref(),
            Some("edited at home\n\nas it was, on the train")
        );
    }

    #[test]
    fn settle_does_not_repeat_an_edit_saved_over_several_pauses() {
        // The first save of the edit went after the unseen text; the second
        // is an edit of the first and replaces it rather than following it.
        assert_eq!(
            settle("from home\n\nfrom the", Some("from the"), "from the train").as_deref(),
            Some("from home\n\nfrom the train")
        );
    }

    #[test]
    fn settle_takes_nothing_again_from_a_write_that_already_landed() {
        assert_eq!(settle("from the train", Some("old"), "from the train"), None);
        assert_eq!(settle("from home\n\nfrom the train", None, "from the train"), None);
        assert_eq!(settle("same", Some("same"), "same"), None);
    }

    #[test]
    fn settle_empties_only_what_the_writer_saw() {
        assert_eq!(settle("the note", Some("the note"), "").as_deref(), Some(""));
        assert_eq!(settle("from home", Some("something else"), ""), None);
        assert_eq!(settle("from home\n\nfrom the train", Some("from the train"), "").as_deref(), Some("from home"));
    }

    #[tokio::test]
    async fn a_note_with_a_base_is_decided_by_content_not_by_the_clock() {
        // Written on the train in the morning, delivered after the note
        // written at home that evening. By the clock it is older and would
        // be dropped; it says it did not know the note, so it goes after it.
        let pool = pool().await;
        set_note(&pool, "a/b", "written at home", Some("2026-09-02T18:00:00.000Z")).await.unwrap();
        settle_note(&pool, "a/b", "written on the train", Some("2026-09-02T09:00:00.000Z"), None)
            .await
            .unwrap();

        assert_eq!(notes(&pool, None).await.unwrap()[0].body, "written at home\n\nwritten on the train");
        let (stamp,): (Option<String>,) = sqlx::query_as("SELECT marked_at FROM notes WHERE piece_id = 'a/b'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            stamp.as_deref(),
            Some("2026-09-02T18:00:00.000Z"),
            "the settled note did not keep the newer stamp"
        );
    }

    #[tokio::test]
    async fn a_note_with_a_base_replaces_what_the_writer_saw() {
        let pool = pool().await;
        set_note(&pool, "a/b", "the note", Some("2026-09-02T18:00:00.000Z")).await.unwrap();
        settle_note(&pool, "a/b", "the note, edited", Some("2026-09-02T09:00:00.000Z"), Some("the note"))
            .await
            .unwrap();
        assert_eq!(notes(&pool, None).await.unwrap()[0].body, "the note, edited");

        // And emptied by someone who saw it, it is gone.
        settle_note(&pool, "a/b", "", None, Some("the note, edited")).await.unwrap();
        assert!(notes(&pool, None).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_note_is_settled_against_the_note_as_it_is_when_written() {
        // The read and the write are one step. Another connection holds the
        // write lock and is about to store the note from home; a delivery
        // that started meanwhile must wait for it and settle against it.
        // Reading first and locking later, it read "no note", and its write
        // was then refused as stale - the train's note lost to a busy lock.
        let dir = tempfile::tempdir().unwrap();
        let url = format!("sqlite://{}?mode=rwc", dir.path().join("reader.db").display());
        let pool = crate::db::connect(&url).await.unwrap();

        let mut home = pool.acquire().await.unwrap();
        sqlx::query("BEGIN IMMEDIATE").execute(&mut *home).await.unwrap();

        let delivery = tokio::spawn({
            let pool = pool.clone();
            async move { settle_note(&pool, "a/b", "written on the train", Some("2026-09-02T09:00:00.000Z"), None).await }
        });
        // Long enough for the delivery to have started and reached the lock;
        // there is no signal to wait on from outside the function.
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;

        sqlx::query("INSERT INTO notes (piece_id, body, marked_at) VALUES ('a/b', 'written at home', '2026-09-02T18:00:00.000Z')")
            .execute(&mut *home)
            .await
            .unwrap();
        sqlx::query("COMMIT").execute(&mut *home).await.unwrap();
        drop(home);

        delivery.await.unwrap().expect("the delivery should wait for the lock, not fail on it");
        assert_eq!(
            notes(&pool, None).await.unwrap()[0].body,
            "written at home

written on the train"
        );
    }

    #[tokio::test]
    async fn a_quote_can_be_removed() {
        let pool = pool().await;
        let quote = add_quote(&pool, "q-9", "a/b", 0, "text", None).await.unwrap();
        assert!(remove_quote(&pool, &quote.id).await.unwrap());
        assert!(quotes(&pool, None).await.unwrap().is_empty());
    }
}
