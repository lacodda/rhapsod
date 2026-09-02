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
    pub id: i64,
    pub piece_id: String,
    pub paragraph: i64,
    /// The exact text that was selected.
    pub text: String,
    pub comment: Option<String>,
    pub created_at: String,
}

/// Writes a note, or removes it when the body is empty.
///
/// An empty note is the absence of one: keeping an empty row would put a note
/// marker on a piece that has nothing written about it.
///
/// # Errors
///
/// Fails when the database rejects the write.
pub async fn set_note(pool: &SqlitePool, piece_id: &str, body: &str) -> Result<()> {
    let body = body.trim();
    if body.is_empty() {
        sqlx::query("DELETE FROM notes WHERE piece_id = ?")
            .bind(piece_id)
            .execute(pool)
            .await
            .context("failed to clear the note")?;
        return Ok(());
    }

    sqlx::query(
        "INSERT INTO notes (piece_id, body) VALUES (?, ?)
         ON CONFLICT (piece_id) DO UPDATE
            SET body = excluded.body,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
    )
    .bind(piece_id)
    .bind(body)
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
pub async fn notes(pool: &SqlitePool) -> Result<Vec<Note>> {
    sqlx::query_as::<_, Note>("SELECT piece_id, body, updated_at FROM notes ORDER BY updated_at DESC")
        .fetch_all(pool)
        .await
        .context("failed to read the notes")
}

/// Keeps a line, returning the quote as stored.
///
/// # Errors
///
/// Fails when the text is empty or the database rejects the write.
pub async fn add_quote(pool: &SqlitePool, piece_id: &str, paragraph: i64, text: &str, comment: Option<&str>) -> Result<Quote> {
    let text = text.trim();
    anyhow::ensure!(!text.is_empty(), "a quote needs some text");
    let comment = comment.map(str::trim).filter(|comment| !comment.is_empty());

    sqlx::query_as::<_, Quote>(
        "INSERT INTO quotes (piece_id, paragraph, text, comment) VALUES (?, ?, ?, ?)
         RETURNING id, piece_id, paragraph, text, comment, created_at",
    )
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
pub async fn comment_on(pool: &SqlitePool, id: i64, comment: Option<&str>) -> Result<bool> {
    let comment = comment.map(str::trim).filter(|comment| !comment.is_empty());
    let changed = sqlx::query("UPDATE quotes SET comment = ? WHERE id = ?")
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
pub async fn remove_quote(pool: &SqlitePool, id: i64) -> Result<bool> {
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
pub async fn quotes(pool: &SqlitePool) -> Result<Vec<Quote>> {
    sqlx::query_as::<_, Quote>("SELECT id, piece_id, paragraph, text, comment, created_at FROM quotes ORDER BY created_at DESC, id DESC")
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
        set_note(&pool, "a/b", "first thought").await.unwrap();
        assert_eq!(notes(&pool).await.unwrap()[0].body, "first thought");

        set_note(&pool, "a/b", "second thought").await.unwrap();
        let notes = notes(&pool).await.unwrap();
        assert_eq!(notes.len(), 1, "rewriting a note made a second one");
        assert_eq!(notes[0].body, "second thought");
    }

    #[tokio::test]
    async fn an_emptied_note_is_no_note() {
        // Keeping an empty row would put a note marker on a piece that has
        // nothing written about it.
        let pool = pool().await;
        set_note(&pool, "a/b", "something").await.unwrap();
        set_note(&pool, "a/b", "   ").await.unwrap();
        assert!(notes(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_quote_keeps_its_text_and_its_place() {
        let pool = pool().await;
        let quote = add_quote(&pool, "a/b", 3, "  the line itself  ", Some("why it matters")).await.unwrap();
        assert_eq!(quote.text, "the line itself", "the quote was stored with its whitespace");
        assert_eq!(quote.paragraph, 3);
        assert_eq!(quote.comment.as_deref(), Some("why it matters"));
    }

    #[tokio::test]
    async fn a_quote_needs_text() {
        // A selection of nothing is a mis-tap, not something to keep.
        let pool = pool().await;
        assert!(add_quote(&pool, "a/b", 0, "   ", None).await.is_err());
    }

    #[tokio::test]
    async fn a_blank_comment_is_no_comment() {
        let pool = pool().await;
        let quote = add_quote(&pool, "a/b", 0, "text", Some("  ")).await.unwrap();
        assert!(quote.comment.is_none());
    }

    #[tokio::test]
    async fn the_same_line_can_be_kept_twice() {
        // Two readings of the same piece can mark the same sentence, and the
        // second is not a mistake to reject.
        let pool = pool().await;
        let first = add_quote(&pool, "a/b", 0, "one line", None).await.unwrap();
        let second = add_quote(&pool, "a/b", 0, "one line", Some("again")).await.unwrap();
        assert_ne!(first.id, second.id);
        assert_eq!(quotes(&pool).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn a_comment_can_be_added_and_taken_back() {
        let pool = pool().await;
        let quote = add_quote(&pool, "a/b", 0, "text", None).await.unwrap();

        assert!(comment_on(&pool, quote.id, Some("a thought")).await.unwrap());
        assert_eq!(quotes(&pool).await.unwrap()[0].comment.as_deref(), Some("a thought"));

        assert!(comment_on(&pool, quote.id, None).await.unwrap());
        assert!(quotes(&pool).await.unwrap()[0].comment.is_none());
    }

    #[tokio::test]
    async fn changing_a_quote_that_is_not_there_says_so() {
        // The app has a stale list; saying nothing changed lets it find out.
        let pool = pool().await;
        assert!(!comment_on(&pool, 999, Some("x")).await.unwrap());
        assert!(!remove_quote(&pool, 999).await.unwrap());
    }

    #[tokio::test]
    async fn a_quote_can_be_removed() {
        let pool = pool().await;
        let quote = add_quote(&pool, "a/b", 0, "text", None).await.unwrap();
        assert!(remove_quote(&pool, quote.id).await.unwrap());
        assert!(quotes(&pool).await.unwrap().is_empty());
    }
}
