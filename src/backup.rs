//! A copy of the one file that cannot be republished.
//!
//! A stand is three things and only the database is irreplaceable: the image is
//! pulled again, the library is republished from the vault, and what the reader
//! did exists nowhere else. Until now the only copy was made by hand, which
//! means it was made when somebody remembered.
//!
//! So the server makes one a day, and opens it. A copy nobody has read is not
//! a backup: the check runs in the same step that writes the file, so a stand
//! never holds a copy of unknown worth while believing itself safe.
//!
//! Not a replacement for carrying marks back to the vault - that is the
//! export, and it produces something readable without this software - but the
//! thing that survives a database file going bad between two of those.

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
pub(crate) fn directory(database: &Path) -> PathBuf {
    database.parent().unwrap_or_else(|| Path::new(".")).join("backups")
}

/// The name a copy taken today would have.
fn name_for(day: &str) -> String {
    format!("rhapsod-{day}.db")
}

/// The day a file name says its copy is of, if this module wrote it.
///
/// The inverse of `name_for`, and the one place that knows how to read these
/// names back. A second reader elsewhere would eventually disagree about
/// which files count, and the one that disagreed would be the one deciding
/// whether a stand has a backup.
pub(crate) fn day_of(name: &str) -> Option<String> {
    let day = name.strip_prefix("rhapsod-")?.strip_suffix(".db")?;
    // `YYYY-MM-DD` and nothing else: a hand-made `rhapsod-before-upgrade.db`
    // beside them is somebody's own copy, not a daily one, and counting it
    // would report a backup that no schedule will ever replace.
    let shaped = day.len() == 10
        && day.as_bytes().iter().enumerate().all(|(at, byte)| match at {
            4 | 7 => *byte == b'-',
            _ => byte.is_ascii_digit(),
        });
    shaped.then(|| day.to_string())
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
    written_by(database, day, async |target| {
        // The destination is a bound parameter, not a piece of the statement:
        // SQLite takes one here, so there is no string to escape and no way
        // for a path with a quote in it to become SQL.
        //
        // `VACUUM INTO` will not overwrite, which is the behaviour wanted: a
        // half-written file from an interrupted run must not be silently
        // replaced by a partial one on the next tick either.
        sqlx::query("VACUUM INTO ?")
            .bind(target.to_string_lossy().as_ref())
            .execute(pool)
            .await
            .with_context(|| format!("failed to write the backup {}", target.display()))?;
        Ok(())
    })
    .await
}

/// The shape of taking a copy: make the room, write it, open it, keep it only
/// if it reads back.
///
/// The write is a parameter so that the steps around it can be exercised
/// against a copy that is bad on purpose. `VACUUM INTO` does not produce a
/// damaged file to order, and a check whose failure path is never run is a
/// check that has only been proved to say yes.
async fn written_by<W>(database: &Path, day: &str, write: W) -> Result<Option<PathBuf>>
where
    W: AsyncFnOnce(&Path) -> Result<()>,
{
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

    write(&target).await?;

    // A copy nobody has opened is not a backup. The check runs here, in the
    // same step that wrote the file, rather than in the script that carries
    // copies off the stand: a script runs when somebody runs it, and between
    // two of those the stand would be holding a copy of unknown worth while
    // believing itself safe.
    if let Err(error) = verify(&target).await {
        // The bad copy does not stay under today's name. Leaving it would
        // cost the last good one: `prune` keeps a fortnight by date, so
        // fourteen unreadable files would push out the copy that works.
        if let Err(removal) = tokio::fs::remove_file(&target).await {
            tracing::warn!(%removal, path = %target.display(), "a backup that failed its check could not be removed");
        }
        return Err(error);
    }

    Ok(Some(target))
}

/// Opens a copy and asks `SQLite` whether it is whole.
///
/// `integrity_check` reads every page and every index, so it answers the
/// question that matters - can this file be read back - rather than the one a
/// file size answers. It is opened read-only and through its own connection:
/// a check that went through the live pool would be checking the live
/// database, which is not what was just written.
///
/// The row count is asked for too. A structurally perfect copy of an empty
/// database passes `integrity_check` and would restore a stand to nothing, so
/// the tables are read as well - if the original had reading state, the copy
/// has to have it.
///
/// # Errors
///
/// Fails when the copy cannot be opened, when `SQLite` reports anything but
/// `ok`, or when the schema is not there to be queried.
pub async fn verify(copy: &Path) -> Result<()> {
    // `mode=ro`: this must not create a file, and must not migrate one. A URL
    // that created what it was asked to check would turn a missing backup
    // into a passing one.
    let url = format!("sqlite://{}?mode=ro", copy.display());
    let pool = sqlx::SqlitePool::connect(&url)
        .await
        .with_context(|| format!("the backup {} could not be opened", copy.display()))?;

    let result = async {
        let verdict: String = sqlx::query_scalar("PRAGMA integrity_check")
            .fetch_one(&pool)
            .await
            .with_context(|| format!("the backup {} could not be checked", copy.display()))?;
        anyhow::ensure!(verdict == "ok", "the backup {} is damaged: {verdict}", copy.display());

        // The schema is queried, not just present: a file can be a valid
        // SQLite database and hold none of this product's tables.
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM reading_state")
            .fetch_one(&pool)
            .await
            .with_context(|| format!("the backup {} does not hold a rhapsod database", copy.display()))?;
        Ok(())
    }
    .await;

    // Closed either way: on Windows an open connection keeps the file locked,
    // and the caller's next move after a failure is to delete it.
    pool.close().await;
    result
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
        let name = entry.file_name().to_string_lossy().into_owned();
        // Exactly the shape this module writes: anything else in the
        // directory belongs to somebody else, and this deletes.
        if day_of(&name).is_some() {
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
                    tracing::info!(path = %path.display(), "backup written and checked");
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
///
/// # Errors
///
/// Fails when the database cannot be read.
pub async fn today(pool: &SqlitePool) -> Result<String> {
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

    #[tokio::test]
    async fn a_damaged_copy_does_not_pass_the_check() {
        // The check has to be able to say no, or taking it is theatre. A
        // header that is not SQLite's is the cheapest way to be sure the file
        // is not a database - and it is what a truncated or half-copied file
        // looks like from the outside.
        let dir = tempfile::tempdir().unwrap();
        let broken = dir.path().join("rhapsod-2026-09-02.db");
        std::fs::write(&broken, b"this is not a database").unwrap();

        let error = verify(&broken).await.unwrap_err();
        assert!(
            format!("{error:#}").contains(&broken.display().to_string()),
            "the failure did not name the file: {error:#}"
        );
    }

    #[tokio::test]
    async fn a_file_that_is_not_a_rhapsod_database_does_not_pass() {
        // A perfectly whole SQLite database of somebody else's tables passes
        // integrity_check and would restore a stand to nothing.
        let dir = tempfile::tempdir().unwrap();
        let stranger = dir.path().join("stranger.db");
        let pool = SqlitePool::connect(&format!("sqlite://{}?mode=rwc", stranger.display())).await.unwrap();
        sqlx::query("CREATE TABLE something_else (id INTEGER PRIMARY KEY)")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;

        assert!(verify(&stranger).await.is_err(), "a database with none of our tables passed the check");
    }

    #[tokio::test]
    async fn checking_does_not_create_the_file_it_checks() {
        // A check that opened read-write would turn a missing backup into a
        // passing one: the file would spring into existence, empty and whole.
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("never-written.db");

        assert!(verify(&missing).await.is_err(), "a backup that is not there passed the check");
        assert!(!missing.exists(), "checking a missing backup created it");
    }

    #[tokio::test]
    async fn the_copy_a_backup_writes_passes_its_own_check() {
        let dir = tempfile::tempdir().unwrap();
        let database = dir.path().join("rhapsod.db");
        let pool = pool_at(&database).await;

        let copy = take(&pool, &database, "2026-09-02").await.unwrap().expect("a backup");
        verify(&copy).await.expect("the copy the server writes should pass");
    }

    #[tokio::test]
    async fn a_copy_that_fails_the_check_is_not_left_under_todays_name() {
        // Leaving it would cost the last good copy: prune keeps a fortnight
        // by date, so a fortnight of unreadable files pushes out the one that
        // works. The day is left without a copy instead, and the log says so.
        let dir = tempfile::tempdir().unwrap();
        let database = dir.path().join("rhapsod.db");
        let pool = pool_at(&database).await;
        // A good copy from yesterday, which has to survive today's failure.
        take(&pool, &database, "2026-09-02").await.unwrap().expect("a backup");

        // Today the write lands a file that is not a database - a truncated
        // copy, a card that went bad mid-flush.
        let error = written_by(&database, "2026-09-03", async |target| {
            tokio::fs::write(target, b"half a file").await?;
            Ok(())
        })
        .await
        .unwrap_err();
        assert!(format!("{error:#}").contains("2026-09-03"), "the failure did not name the copy: {error:#}");

        let today = directory(&database).join(name_for("2026-09-03"));
        assert!(!today.exists(), "a copy that failed its check was left on disk");
        assert!(
            directory(&database).join(name_for("2026-09-02")).is_file(),
            "the failure took yesterday's good copy with it"
        );
    }

    #[tokio::test]
    async fn a_failed_check_leaves_tomorrow_free_to_try_again() {
        // The name has to be clear, not reserved by the file that failed:
        // otherwise the `try_exists` guard above would read the wreck as
        // "today is done" and the stand would never take another copy.
        let dir = tempfile::tempdir().unwrap();
        let database = dir.path().join("rhapsod.db");
        let pool = pool_at(&database).await;

        assert!(
            written_by(&database, "2026-09-03", async |target| {
                tokio::fs::write(target, b"half a file").await?;
                Ok(())
            })
            .await
            .is_err()
        );
        // The same day, taken properly, now works.
        let copy = take(&pool, &database, "2026-09-03").await.unwrap().expect("a backup");
        verify(&copy).await.expect("the retry should hold a real database");
    }
}
