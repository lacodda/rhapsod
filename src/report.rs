//! What the reading looked like, for the author.
//!
//! Nothing here is collected: every number is read out of the reading state,
//! the reactions and the library, all of which were being written anyway. That
//! is the reason this is a module of queries and not a table - a statistic
//! stored is a statistic that can disagree with the thing it counts.
//!
//! The author and the reader are one person here, which is what makes this
//! worth stating: the report is not an audience metric. It answers one
//! question a word count cannot - where a piece loses the person reading it.

use anyhow::{Context, Result};
use serde::Serialize;
use sqlx::SqlitePool;

use crate::library::Library;

/// A piece the reader started and did not finish.
///
/// The interesting column is `through`: a piece abandoned four paragraphs from
/// the end is a different problem from one abandoned on the second, and only
/// the fraction tells them apart.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Abandoned {
    pub piece_id: String,
    /// The title as the library has it, so the author reads a name and not an
    /// id.
    pub title: String,
    /// The paragraph the reader last saw.
    pub paragraph: i64,
    /// How many the piece has.
    pub paragraphs: i64,
    /// How far in, 0.0 to 1.0. Computed here rather than left to the app,
    /// because the file that writes the vault report and the screen that draws
    /// it must not each have their own idea of what "half way" means.
    pub through: f64,
    /// When the reader was last there - how stale the abandonment is.
    pub updated_at: String,
}

/// How the pieces landed, and where they lost the reader.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Report {
    /// Pieces finished.
    pub read: i64,
    /// Pieces opened and not finished.
    pub unfinished: i64,
    /// Pieces never opened: the library minus what has been touched.
    pub untouched: i64,
    /// Reactions by kind, in the order [`crate::feedback::KINDS`] gives.
    pub good: i64,
    pub struck: i64,
    /// Typos still reported and not withdrawn.
    pub typos: i64,
    /// Where the reader stopped, furthest-from-the-end first: the piece that
    /// lost them earliest is the one to look at first.
    pub abandoned: Vec<Abandoned>,
}

/// A piece is only abandoned once the reader has had time to come back to it.
///
/// Without this every report would open with whatever is being read right now,
/// which is not a piece that failed - it is a piece in progress. A day is the
/// smallest gap that tells "put down" apart from "reading".
const SETTLED: &str = "-1 day";

/// Reads the report.
///
/// # Errors
///
/// Fails when the database cannot be read.
pub async fn read(pool: &SqlitePool, library: &Library) -> Result<Report> {
    let read: i64 = sqlx::query_scalar("SELECT count(*) FROM reading_state WHERE status = 'read'")
        .fetch_one(pool)
        .await
        .context("failed to count what was read")?;

    let unfinished: i64 = sqlx::query_scalar("SELECT count(*) FROM reading_state WHERE status = 'reading'")
        .fetch_one(pool)
        .await
        .context("failed to count what was left unfinished")?;

    let good = count_reactions(pool, "good").await?;
    let struck = count_reactions(pool, "struck").await?;

    let typos: i64 = sqlx::query_scalar("SELECT count(*) FROM typos")
        .fetch_one(pool)
        .await
        .context("failed to count the typos")?;

    let stopped: Vec<(String, i64, String)> = sqlx::query_as(
        "SELECT piece_id, paragraph, updated_at
           FROM reading_state
          WHERE status = 'reading'
            AND updated_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)",
    )
    .bind(SETTLED)
    .fetch_all(pool)
    .await
    .context("failed to read where the reader stopped")?;

    let mut abandoned: Vec<Abandoned> = stopped
        .into_iter()
        .filter_map(|(piece_id, paragraph, updated_at)| {
            // A piece that left the library takes its abandonment with it: the
            // author cannot act on a name that no longer exists, and the row
            // is the reading state's business, not the report's.
            let piece = library.piece(&piece_id)?;
            let paragraphs = i64::try_from(piece.paragraphs.len()).unwrap_or(i64::MAX);
            Some(Abandoned {
                piece_id,
                title: piece.title.clone(),
                paragraph,
                paragraphs,
                // A piece with no paragraphs cannot have been read part way
                // through; saying 0.0 beats dividing by nothing.
                #[allow(clippy::cast_precision_loss)]
                through: if paragraphs > 0 { (paragraph as f64) / (paragraphs as f64) } else { 0.0 },
                updated_at,
            })
        })
        .collect();

    // Furthest from the end first: the piece that lost the reader earliest is
    // the one whose opening is worth rereading. Ties go to the more recent, so
    // a fresh failure outranks an old one at the same depth.
    abandoned.sort_by(|left, right| {
        left.through
            .partial_cmp(&right.through)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| right.updated_at.cmp(&left.updated_at))
    });

    let touched = read + unfinished;
    let untouched = i64::try_from(library.len()).unwrap_or(i64::MAX) - touched;

    Ok(Report {
        read,
        unfinished,
        // A library that shrank below what has been read would otherwise
        // report a negative count of pieces waiting.
        untouched: untouched.max(0),
        good,
        struck,
        typos,
        abandoned,
    })
}

async fn count_reactions(pool: &SqlitePool, kind: &str) -> Result<i64> {
    sqlx::query_scalar("SELECT count(*) FROM reactions WHERE kind = ?")
        .bind(kind)
        .fetch_one(pool)
        .await
        .with_context(|| format!("failed to count the {kind} reactions"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::feedback;

    async fn pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        pool
    }

    /// A library of two pieces on disk, each ten paragraphs long.
    ///
    /// Built from real files like every other library in these tests: the
    /// indexer decides what a paragraph is, and a hand-made `Piece` would let
    /// this agree with an indexer that had changed its mind.
    fn library() -> (tempfile::TempDir, Library) {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let section = dir.path().join("01 — Парадоксы");
        std::fs::create_dir_all(&section).expect("the shelf");

        for (file, title) in [("Кот.md", "Кот Шрёдингера"), ("Лжец.md", "Парадокс лжеца")] {
            let prose: Vec<String> = (0..10).map(|n| format!("Абзац {n}.")).collect();
            let body = format!("---\ntype: novella\ntopic: {title}\nwords: 900\n---\n\n# {title}\n\n{}\n", prose.join("\n\n"));
            std::fs::write(section.join(file), body).expect("the piece");
        }

        let lib = Library::load(dir.path()).expect("the library should load");
        (dir, lib)
    }

    /// Puts a piece in the reading state at a paragraph, as of a moment.
    async fn stopped_at(pool: &SqlitePool, piece_id: &str, paragraph: i64, updated_at: &str) {
        sqlx::query(
            "INSERT INTO reading_state (piece_id, status, paragraph, updated_at)
             VALUES (?, 'reading', ?, ?)",
        )
        .bind(piece_id)
        .bind(paragraph)
        .bind(updated_at)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn an_empty_stand_reports_a_library_nobody_has_opened() {
        let pool = pool().await;
        let (_dir, lib) = library();
        let report = read(&pool, &lib).await.unwrap();

        assert_eq!(report.read, 0);
        assert_eq!(report.unfinished, 0);
        assert_eq!(report.untouched, 2, "the untouched count did not see the library");
        assert!(report.abandoned.is_empty());
    }

    #[tokio::test]
    async fn a_piece_put_down_is_reported_with_how_far_in() {
        // The fraction is the whole point: "stopped at paragraph 2" says
        // nothing without knowing there were ten.
        let pool = pool().await;
        stopped_at(&pool, "01-paradoksy/kot", 2, "2020-01-01T00:00:00.000Z").await;

        let (_dir, lib) = library();
        let report = read(&pool, &lib).await.unwrap();
        assert_eq!(report.abandoned.len(), 1);
        assert_eq!(report.abandoned[0].title, "Кот Шрёдингера", "the author reads a name, not an id");
        assert_eq!(report.abandoned[0].paragraphs, 10);
        assert!(
            (report.abandoned[0].through - 0.2).abs() < f64::EPSILON,
            "the fraction was {}",
            report.abandoned[0].through
        );
    }

    #[tokio::test]
    async fn what_is_being_read_right_now_is_not_called_abandoned() {
        // Without the settling gap every report would open with whatever the
        // reader has in hand, which is not a piece that failed.
        let pool = pool().await;
        let now = sqlx::query_scalar::<_, String>("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
            .fetch_one(&pool)
            .await
            .unwrap();
        stopped_at(&pool, "01-paradoksy/kot", 2, &now).await;

        let (_dir, lib) = library();
        let report = read(&pool, &lib).await.unwrap();
        assert_eq!(report.unfinished, 1, "the piece is still unfinished");
        assert!(report.abandoned.is_empty(), "a piece in hand was reported as given up on");
    }

    #[tokio::test]
    async fn the_piece_that_lost_the_reader_earliest_comes_first() {
        let pool = pool().await;
        stopped_at(&pool, "01-paradoksy/kot", 8, "2020-01-01T00:00:00.000Z").await;
        stopped_at(&pool, "01-paradoksy/lzhec", 1, "2020-01-01T00:00:00.000Z").await;

        let (_dir, lib) = library();
        let report = read(&pool, &lib).await.unwrap();
        assert_eq!(
            report.abandoned[0].piece_id, "01-paradoksy/lzhec",
            "the report opened with the piece that nearly held the reader"
        );
    }

    #[tokio::test]
    async fn a_piece_that_left_the_library_leaves_the_report() {
        // The author cannot act on a title that no longer exists, and the row
        // belongs to the reading state rather than to this.
        let pool = pool().await;
        stopped_at(&pool, "01-paradoksy/deleted", 2, "2020-01-01T00:00:00.000Z").await;

        let (_dir, lib) = library();
        let report = read(&pool, &lib).await.unwrap();
        assert!(report.abandoned.is_empty(), "the report named a piece the library does not have");
        assert_eq!(report.unfinished, 1, "the reading state still holds the row");
    }

    #[tokio::test]
    async fn reactions_and_typos_are_counted_by_kind() {
        let pool = pool().await;
        feedback::react(&pool, "01-paradoksy/kot", "struck", None).await.unwrap();
        feedback::react(&pool, "01-paradoksy/lzhec", "good", None).await.unwrap();
        feedback::report_typo(&pool, "t-1", "01-paradoksy/kot", 3, "прадокс").await.unwrap();

        let (_dir, lib) = library();
        let report = read(&pool, &lib).await.unwrap();
        assert_eq!(report.struck, 1);
        assert_eq!(report.good, 1);
        assert_eq!(report.typos, 1);
    }

    #[tokio::test]
    async fn a_library_smaller_than_what_was_read_reports_nothing_waiting() {
        // Pieces leave the vault; the reading state keeps their rows. The
        // count of what is still waiting must not go negative.
        let pool = pool().await;
        for id in ["a", "b", "c"] {
            sqlx::query("INSERT INTO reading_state (piece_id, status) VALUES (?, 'read')")
                .bind(id)
                .execute(&pool)
                .await
                .unwrap();
        }

        let (_dir, lib) = library();
        let report = read(&pool, &lib).await.unwrap();
        assert_eq!(report.read, 3);
        assert_eq!(report.untouched, 0, "the count of what is waiting went negative");
    }
}
