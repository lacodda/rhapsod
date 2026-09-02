//! A copy of the one file that cannot be republished.
//!
//! A stand is three things and only the database is irreplaceable: the image is
//! pulled again, the library is republished from the vault, and what the reader
//! did exists nowhere else. Until now the only copy was made by hand, which
//! means it was made when somebody remembered.
//!
//! So the server makes one a day. Not a replacement for carrying marks back to
//! the vault - that is the export, and it produces something readable without
//! this software - but the thing that survives a database file going bad
//! between two of those.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use sqlx::SqlitePool;

/// How many daily copies to keep.
///
/// A fortnight: long enough that a fault noticed after a holiday still has a
/// good copy behind it, short enough that a stand does not fill a Pi's card
/// with a year of a database that is mostly the same rows.
const KEEP: usize = 14;

/// One backup a day. The server checks on a slower tick than that so a stand
/// restarted at noon does not wait until tomorrow for its first copy.
const CHECK_EVERY: std::time::Duration = std::time::Duration::from_hours(1);

/// Where the copies live, given the database file.
///
/// Beside the database rather than in a directory of their own: the volume is
/// already the thing a person mounts to get at the data, and a backup that
/// needs its own mount is a backup nobody has.
fn directory(database: &Path) -> PathBuf {
    database.parent().unwrap_or_else(|| Path::new(".")).join("backups")
}

/// The name a copy taken today would have.
fn name_for(day: &str) -> String {
    format!("rhapsod-{day}.db")
}

/// Makes a copy of the database for the given day, unless today's is there.
///
/// `VACUUM INTO` rather than copying the file: it is SQLite's own way of
/// writing a consistent snapshot while the database is in use, so the server
/// keeps answering while it runs. Copying the file underneath a live server
/// can catch it mid-write, which is why the manual procedure has to stop the
/// container first.
///
/// # Errors
///
/// Fails when the directory cannot be made or the database refuses the write.
pub async fn take(pool: &SqlitePool, database: &Path, day: &str) -> Result<Option<PathBuf>> {
    let dir = directory(database);
    tokio::fs::create_dir_all(&dir)
        .await
        .with_context(|| format!("failed to make the backup directory {}", dir.display()))?;

    let target = dir.join(name_for(day));
    if tokio::fs::try_exists(&target).await.unwrap_or(false) {
        // Today's copy is already there. Taking it again would be work for
        // nothing, and would replace a copy made this morning - before
        // whatever went wrong since - with one made after it.
        return Ok(None);
    }

    // The destination is a bound parameter, not a piece of the statement:
    // SQLite takes one here, so there is no string to escape and no way for a
    // path with a quote in it to become SQL.
    //
    // `VACUUM INTO` will not overwrite, which is the behaviour wanted: a
    // half-written file from an interrupted run must not be silently replaced
    // by a partial one on the next tick either.
    sqlx::query("VACUUM INTO ?")
        .bind(target.to_string_lossy().as_ref())
        .execute(pool)
        .await
        .with_context(|| format!("failed to write the backup {}", target.display()))?;

    Ok(Some(target))
}

/// Removes all but the newest `KEEP` copies.
///
/// Names sort by date because they carry one in `YYYY-MM-DD`, so the oldest
/// are the first by name. A file that is not a backup is left alone: this
/// deletes, and a delete that guesses is a delete that eventually guesses
/// wrong.
///
/// # Errors
///
/// Fails when the directory cannot be read. A file that cannot be removed is
/// logged and skipped: a stand that stops backing up because one old copy is
/// locked has traded a small problem for the one this module exists to avoid.
pub async fn prune(database: &Path) -> Result<usize> {
    let dir = directory(database);
    let mut entries = match tokio::fs::read_dir(&dir).await {
        Ok(entries) => entries,
        // No directory yet means nothing to prune, not a failure.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error).with_context(|| format!("failed to read {}", dir.display())),
    };

    let mut copies = Vec::new();
    while let Some(entry) = entries.next_entry().await.context("failed to walk the backup directory")? {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        // Exactly the shape this module writes: anything else in the
        // directory belongs to somebody else. The extension is compared
        // through `Path`, which is case-insensitive where the filesystem is -
        // a `.DB` left behind on Windows would otherwise never be pruned.
        let is_database = path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("db"));
        if is_database && name.starts_with("rhapsod-") && name.len() == name_for("2026-09-02").len() {
            copies.push(name);
        }
    }
    copies.sort_unstable();

    let mut removed = 0;
    let excess = copies.len().saturating_sub(KEEP);
    for name in copies.into_iter().take(excess) {
        let path = dir.join(&name);
        match tokio::fs::remove_file(&path).await {
            Ok(()) => removed += 1,
            Err(error) => tracing::warn!(%error, path = %path.display(), "an old backup could not be removed"),
        }
    }
    Ok(removed)
}

/// Runs backups for as long as the server does.
///
/// Spawned rather than awaited: a backup that fails must not take the reader's
/// stand down with it, so every failure here is logged and the loop carries on.
/// The alternative - a stand that refuses to serve because it could not write a
/// copy - would make the safety net the thing that breaks.
pub fn spawn(pool: SqlitePool, database: PathBuf) {
    tokio::spawn(async move {
        loop {
            let day = match today(&pool).await {
                Ok(day) => day,
                Err(error) => {
                    tracing::warn!(%error, "the date could not be read; skipping this backup");
                    tokio::time::sleep(CHECK_EVERY).await;
                    continue;
                }
            };

            match take(&pool, &database, &day).await {
                Ok(Some(path)) => {
                    tracing::info!(path = %path.display(), "backup written");
                    match prune(&database).await {
                        Ok(0) => {}
                        Ok(removed) => tracing::info!(removed, "old backups removed"),
                        Err(error) => tracing::warn!(%error, "old backups could not be pruned"),
                    }
                }
                Ok(None) => {}
                Err(error) => tracing::warn!(%error, "the backup could not be written"),
            }

            tokio::time::sleep(CHECK_EVERY).await;
        }
    });
}

/// Today's date from the database, so the backup and every other stamp in the
/// product agree about what day it is.
async fn today(pool: &SqlitePool) -> Result<String> {
    sqlx::query_scalar::<_, String>("SELECT strftime('%Y-%m-%d', 'now')")
        .fetch_one(pool)
        .await
        .context("failed to read the current date")
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool_at(path: &Path) -> SqlitePool {
        let url = format!("sqlite://{}?mode=rwc", path.display());
        let pool = crate::db::connect(&url).await.expect("a database");
        // Something worth backing up, so an empty file cannot pass for a copy.
        crate::progress::set_read(&pool, "a/b", true, None).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn a_backup_is_a_readable_database_with_the_rows_in_it() {
        // The check that matters: not that a file appeared, but that what is
        // in it can be opened and still holds what the reader did.
        let dir = tempfile::tempdir().unwrap();
        let database = dir.path().join("rhapsod.db");
        let pool = pool_at(&database).await;

        let copy = take(&pool, &database, "2026-09-02").await.unwrap().expect("a backup");
        assert!(copy.is_file(), "no file at {}", copy.display());

        let restored = SqlitePool::connect(&format!("sqlite://{}", copy.display())).await.expect("the backup opens");
        let states = crate::progress::all(&restored, None).await.expect("the backup has the tables");
        assert_eq!(states.len(), 1, "the backup did not carry the reading state");
        assert_eq!(states[0].piece_id, "a/b");
    }

    #[tokio::test]
    async fn todays_backup_is_taken_once() {
        // A second copy on the same day would replace one made this morning -
        // before whatever went wrong since - with one made after it.
        let dir = tempfile::tempdir().unwrap();
        let database = dir.path().join("rhapsod.db");
        let pool = pool_at(&database).await;

        assert!(take(&pool, &database, "2026-09-02").await.unwrap().is_some());
        assert!(
            take(&pool, &database, "2026-09-02").await.unwrap().is_none(),
            "a second backup was taken on the same day"
        );
        // A different day is a different copy.
        assert!(take(&pool, &database, "2026-09-03").await.unwrap().is_some());
    }

    #[tokio::test]
    async fn only_the_newest_fortnight_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        let database = dir.path().join("rhapsod.db");
        let pool = pool_at(&database).await;

        // Twenty days of copies, oldest first.
        for day in 1..=20 {
            take(&pool, &database, &format!("2026-09-{day:02}")).await.unwrap();
        }
        let removed = prune(&database).await.unwrap();
        assert_eq!(removed, 6, "pruning kept the wrong number of copies");

        let kept: Vec<String> = std::fs::read_dir(directory(&database))
            .unwrap()
            .filter_map(|entry| entry.ok().map(|entry| entry.file_name().to_string_lossy().into_owned()))
            .collect();
        assert_eq!(kept.len(), KEEP);
        assert!(kept.contains(&name_for("2026-09-20")), "the newest copy was removed");
        assert!(!kept.contains(&name_for("2026-09-01")), "the oldest copy was kept");
    }

    #[tokio::test]
    async fn pruning_leaves_other_files_alone() {
        // This deletes, and a delete that guesses eventually guesses wrong.
        let dir = tempfile::tempdir().unwrap();
        let database = dir.path().join("rhapsod.db");
        let pool = pool_at(&database).await;

        for day in 1..=20 {
            take(&pool, &database, &format!("2026-09-{day:02}")).await.unwrap();
        }
        let stranger = directory(&database).join("please-keep-me.db");
        std::fs::write(&stranger, b"not a backup").unwrap();
        let manual = directory(&database).join("rhapsod-before-upgrade.db");
        std::fs::write(&manual, b"someone's own copy").unwrap();

        prune(&database).await.unwrap();
        assert!(stranger.is_file(), "pruning removed a file it did not write");
        assert!(manual.is_file(), "pruning removed a hand-made backup");
    }

    #[tokio::test]
    async fn pruning_an_empty_stand_is_not_a_failure() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(prune(&dir.path().join("rhapsod.db")).await.unwrap(), 0);
    }
}
