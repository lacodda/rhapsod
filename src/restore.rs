//! Putting a reader's side back into an empty stand.
//!
//! The mirror of the export. A stand is three things - an image, a library and
//! a database - and only the third is irreplaceable: the image is pulled again
//! and the library is republished from the vault, but what the reader did
//! exists nowhere else unless it was carried out.
//!
//! So this reads an export document and writes it into a database. It is a
//! command rather than an endpoint because it runs against a stand that is not
//! serving yet - a Pi rebuilt this morning, with the export from the old one
//! on a stick.

use anyhow::{Context, Result};
use serde::Deserialize;
use sqlx::SqlitePool;

use crate::bookmarks;
use crate::marks;
use crate::progress;
use crate::requests;
use crate::reviews;

/// An export document, as `GET /api/export` produces it.
///
/// Deserialised rather than taken apart by hand so that a file which is not an
/// export fails here, with a message naming the field, instead of halfway
/// through writing rows.
#[derive(Debug, Deserialize)]
pub struct Export {
    /// When the export was taken. Not used for anything but the report: what
    /// is restored is the rows, and their own timestamps travel with them.
    pub exported_at: String,
    #[serde(default)]
    pub reading: Vec<progress::State>,
    #[serde(default)]
    pub notes: Vec<marks::Note>,
    #[serde(default)]
    pub quotes: Vec<marks::Quote>,
    #[serde(default)]
    pub reviews: Vec<reviews::Review>,
    #[serde(default)]
    pub bookmarks: Vec<bookmarks::Bookmark>,
    #[serde(default)]
    pub requests: Vec<requests::Request>,
}

/// What a restore did, for the caller to print.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Restored {
    pub reading: usize,
    pub notes: usize,
    pub quotes: usize,
    pub reviews: usize,
    pub bookmarks: usize,
    pub requests: usize,
}

/// Writes an export into a database.
///
/// Rows keep the timestamps they were exported with. Restoring is not the
/// reader doing anything, and a restore that stamped everything "now" would
/// tell the streak that thirty pieces were finished today and hand every
/// review schedule back with its intervals restarted.
///
/// Existing rows are left alone. A restore is for an empty stand; running it
/// against a live one must not quietly overwrite what the reader has done
/// since, so a row that is already there wins and is counted as skipped.
///
/// # Errors
///
/// Fails when the database rejects a write. The whole restore is one
/// transaction: a half-restored stand is worse than one that refused, because
/// it looks finished.
pub async fn restore(pool: &SqlitePool, export: &Export) -> Result<Restored> {
    let mut tx = pool.begin().await.context("failed to start the restore")?;

    // One function per kind rather than six loops in a row: each new kind the
    // reader can produce would otherwise be another wedge in the middle of
    // this one, and the whole point is that they are independent.
    let restored = Restored {
        reading: reading(&mut tx, export).await?,
        notes: notes(&mut tx, export).await?,
        quotes: quotes(&mut tx, export).await?,
        reviews: reviews(&mut tx, export).await?,
        bookmarks: bookmarks(&mut tx, export).await?,
        requests: requests(&mut tx, export).await?,
    };

    tx.commit().await.context("failed to finish the restore")?;
    Ok(restored)
}

/// How many rows a statement put in: zero when the row was already there.
fn landed(done: &sqlx::sqlite::SqliteQueryResult) -> usize {
    usize::try_from(done.rows_affected()).unwrap_or(0)
}

/// One transaction of the restore, borrowed by each kind in turn.
type Tx<'a> = sqlx::Transaction<'a, sqlx::Sqlite>;

async fn reading(tx: &mut Tx<'_>, export: &Export) -> Result<usize> {
    let mut count = 0;
    for state in &export.reading {
        let done = sqlx::query(
            "INSERT INTO reading_state (piece_id, status, paragraph, updated_at, read_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (piece_id) DO NOTHING",
        )
        .bind(&state.piece_id)
        .bind(&state.status)
        .bind(state.paragraph)
        .bind(&state.updated_at)
        .bind(state.read_at.as_deref())
        .execute(&mut **tx)
        .await
        .with_context(|| format!("failed to restore the reading state of {}", state.piece_id))?;
        count += landed(&done);
    }
    Ok(count)
}

async fn notes(tx: &mut Tx<'_>, export: &Export) -> Result<usize> {
    let mut count = 0;
    for note in &export.notes {
        let done = sqlx::query(
            "INSERT INTO notes (piece_id, body, updated_at) VALUES (?, ?, ?)
             ON CONFLICT (piece_id) DO NOTHING",
        )
        .bind(&note.piece_id)
        .bind(&note.body)
        .bind(&note.updated_at)
        .execute(&mut **tx)
        .await
        .with_context(|| format!("failed to restore the note on {}", note.piece_id))?;
        count += landed(&done);
    }
    Ok(count)
}

async fn quotes(tx: &mut Tx<'_>, export: &Export) -> Result<usize> {
    let mut count = 0;
    for quote in &export.quotes {
        let done = sqlx::query(
            "INSERT INTO quotes (id, piece_id, paragraph, text, comment, created_at, changed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO NOTHING",
        )
        .bind(&quote.id)
        .bind(&quote.piece_id)
        .bind(quote.paragraph)
        .bind(&quote.text)
        .bind(quote.comment.as_deref())
        .bind(&quote.created_at)
        .bind(&quote.created_at)
        .execute(&mut **tx)
        .await
        .with_context(|| format!("failed to restore a quote from {}", quote.piece_id))?;
        count += landed(&done);
    }
    Ok(count)
}

async fn reviews(tx: &mut Tx<'_>, export: &Export) -> Result<usize> {
    let mut count = 0;
    for review in &export.reviews {
        let done = sqlx::query(
            "INSERT INTO reviews (piece_id, done, due_on, last_seen, changed_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (piece_id) DO NOTHING",
        )
        .bind(&review.piece_id)
        .bind(review.done)
        .bind(review.due_on.as_deref())
        .bind(review.last_seen.as_deref())
        .bind(review.last_seen.as_deref())
        .execute(&mut **tx)
        .await
        .with_context(|| format!("failed to restore the schedule of {}", review.piece_id))?;
        count += landed(&done);
    }
    Ok(count)
}

async fn bookmarks(tx: &mut Tx<'_>, export: &Export) -> Result<usize> {
    let mut count = 0;
    for bookmark in &export.bookmarks {
        let done = sqlx::query(
            "INSERT INTO bookmarks (piece_id, kind, marked_at, changed_at) VALUES (?, ?, ?, ?)
             ON CONFLICT (piece_id) DO NOTHING",
        )
        .bind(&bookmark.piece_id)
        .bind(&bookmark.kind)
        .bind(&bookmark.marked_at)
        .bind(&bookmark.marked_at)
        .execute(&mut **tx)
        .await
        .with_context(|| format!("failed to restore the bookmark on {}", bookmark.piece_id))?;
        count += landed(&done);
    }
    Ok(count)
}

async fn requests(tx: &mut Tx<'_>, export: &Export) -> Result<usize> {
    let mut count = 0;
    for request in &export.requests {
        let done = sqlx::query(
            "INSERT INTO requests (topic_id, title, section, asked_at, changed_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (topic_id) DO NOTHING",
        )
        .bind(&request.topic_id)
        .bind(&request.title)
        .bind(&request.section)
        .bind(&request.asked_at)
        .bind(&request.asked_at)
        .execute(&mut **tx)
        .await
        .with_context(|| format!("failed to restore the request for {}", request.topic_id))?;
        count += landed(&done);
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        pool
    }

    fn export() -> Export {
        Export {
            exported_at: "2026-09-02T12:00:00.000Z".into(),
            reading: vec![progress::State {
                piece_id: "a/b".into(),
                status: "read".into(),
                paragraph: 7,
                updated_at: "2026-08-01T10:00:00.000Z".into(),
                read_at: Some("2026-08-01T10:00:00.000Z".into()),
            }],
            notes: vec![marks::Note {
                piece_id: "a/b".into(),
                body: "what it left me with".into(),
                updated_at: "2026-08-01T11:00:00.000Z".into(),
            }],
            quotes: vec![marks::Quote {
                id: "kept-1".into(),
                piece_id: "a/b".into(),
                paragraph: 3,
                text: "the line".into(),
                comment: Some("why".into()),
                created_at: "2026-08-01T12:00:00.000Z".into(),
            }],
            reviews: vec![reviews::Review {
                piece_id: "a/b".into(),
                done: 2,
                due_on: Some("2026-09-30".into()),
                last_seen: Some("2026-08-31T09:00:00.000Z".into()),
            }],
            bookmarks: vec![bookmarks::Bookmark {
                piece_id: "a/b".into(),
                kind: "loved".into(),
                marked_at: "2026-08-01T13:00:00.000Z".into(),
            }],
            requests: vec![requests::Request {
                topic_id: "01-shelf/a-topic".into(),
                title: "A topic".into(),
                section: "01 — Shelf".into(),
                asked_at: "2026-08-01T14:00:00.000Z".into(),
            }],
        }
    }

    #[tokio::test]
    async fn an_export_comes_back_whole() {
        let pool = pool().await;
        let counted = restore(&pool, &export()).await.unwrap();
        assert_eq!(
            counted,
            Restored {
                reading: 1,
                notes: 1,
                quotes: 1,
                reviews: 1,
                bookmarks: 1,
                requests: 1
            }
        );

        let states = progress::all(&pool, None).await.unwrap();
        assert_eq!(states[0].status, "read");
        assert_eq!(states[0].paragraph, 7);
        assert_eq!(marks::notes(&pool, None).await.unwrap()[0].body, "what it left me with");
        assert_eq!(marks::quotes(&pool, None).await.unwrap()[0].text, "the line");
        assert_eq!(reviews::all(&pool, None).await.unwrap()[0].done, 2);
        // Bookmarks travel too: a stand rebuilt without them would lose the
        // pieces the reader meant to come back to.
        let marked = bookmarks::all(&pool, None).await.unwrap();
        assert_eq!(marked.len(), 1, "the restore lost the bookmark");
        assert_eq!(marked[0].kind, "loved");
        assert_eq!(marked[0].marked_at, "2026-08-01T13:00:00.000Z", "a restored bookmark was re-dated");
        // Requests travel too: the list of what the reader wants written
        // exists nowhere else until the export reaches the vault.
        let asked = requests::all(&pool, None).await.unwrap();
        assert_eq!(asked.len(), 1, "the restore lost the request");
        assert_eq!(asked[0].title, "A topic", "a restored request lost its words");
    }

    #[tokio::test]
    async fn restored_rows_keep_the_dates_they_were_made_on() {
        // Stamping everything "now" would tell the streak that thirty pieces
        // were finished today, and hand back every review schedule with its
        // intervals restarted.
        let pool = pool().await;
        restore(&pool, &export()).await.unwrap();

        let state = &progress::all(&pool, None).await.unwrap()[0];
        assert_eq!(state.read_at.as_deref(), Some("2026-08-01T10:00:00.000Z"));
        assert_eq!(state.updated_at, "2026-08-01T10:00:00.000Z");

        let review = &reviews::all(&pool, None).await.unwrap()[0];
        assert_eq!(review.due_on.as_deref(), Some("2026-09-30"), "a restored schedule was rescheduled");
        assert_eq!(review.last_seen.as_deref(), Some("2026-08-31T09:00:00.000Z"));
    }

    #[tokio::test]
    async fn a_restore_does_not_overwrite_what_is_already_there() {
        // Run against a live stand by mistake, a restore must not put back a
        // month-old position over what was read this morning.
        let pool = pool().await;
        progress::at_paragraph(&pool, "a/b", 40, None).await.unwrap();
        marks::set_note(&pool, "a/b", "written since", None).await.unwrap();

        let counted = restore(&pool, &export()).await.unwrap();
        assert_eq!(counted.reading, 0, "a restore overwrote a live reading state");
        assert_eq!(counted.notes, 0, "a restore overwrote a live note");

        assert_eq!(progress::all(&pool, None).await.unwrap()[0].paragraph, 40);
        assert_eq!(marks::notes(&pool, None).await.unwrap()[0].body, "written since");
    }

    #[tokio::test]
    async fn restoring_twice_changes_nothing_the_second_time() {
        // A restore interrupted and re-run must not double anything.
        let pool = pool().await;
        restore(&pool, &export()).await.unwrap();
        let again = restore(&pool, &export()).await.unwrap();

        assert_eq!(
            again,
            Restored {
                reading: 0,
                notes: 0,
                quotes: 0,
                reviews: 0,
                bookmarks: 0,
                requests: 0
            }
        );
        assert_eq!(marks::quotes(&pool, None).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn an_empty_export_restores_nothing_and_says_so() {
        let pool = pool().await;
        let empty = Export {
            exported_at: "2026-09-02T12:00:00.000Z".into(),
            reading: vec![],
            notes: vec![],
            quotes: vec![],
            reviews: vec![],
            bookmarks: vec![],
            requests: vec![],
        };
        let counted = restore(&pool, &empty).await.unwrap();
        assert_eq!(
            counted.reading + counted.notes + counted.quotes + counted.reviews + counted.bookmarks + counted.requests,
            0
        );
    }
}
