//! Whether this stand is well, in one command.
//!
//! A stand is run by somebody who is not the author of this code, from a
//! phone in a hallway or an ssh session on a Pi. When something is wrong the
//! questions are always the same - is the library there, is the database
//! whole, has a backup been taken lately, is the app built, is the door up -
//! and until now each one had its own way of being asked: a curl, a docker
//! run with a volume mounted, a look in a directory.
//!
//! So they are asked together, by the server itself, against the same
//! configuration the server runs on. That last part is the point: a check
//! that reads its own idea of where things are can pass while the server
//! fails, because the two were never looking at the same stand.
//!
//! What this does *not* do is reach over the network. The secure context, the
//! certificate and the name belong to the host in front of the server (the
//! "Behind a door" guide), and a product that graded its own proxy would be
//! guessing. What it can say is whether the stand is bound somewhere a door
//! can be put in front of it.

use std::fmt;
use std::path::Path;

use anyhow::Result;

use crate::config::Config;
use crate::library::Library;

/// How old a backup may be before it is worth saying so.
///
/// The server takes one a day, so two days means one was missed: a day and a
/// bit is normal drift between a copy taken at noon and a look taken in the
/// morning, and a check that cried at that would be a check nobody reads.
const BACKUP_STALE_DAYS: u64 = 2;

/// How a single check came out.
///
/// Three states rather than two. "Not well, but not broken" is the common
/// answer on a healthy stand - no backup yet on a machine started an hour
/// ago, an open stand with no password - and grading those as failures would
/// teach the owner that the red is normal, which is how a check stops being
/// read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// Nothing to do.
    Well,
    /// Worth knowing, not worth waking up for.
    Watch,
    /// The stand cannot do its job.
    Ill,
}

impl Verdict {
    /// The mark a line carries. ASCII, because this is read over ssh in
    /// whatever terminal the Pi was reached from.
    const fn mark(self) -> &'static str {
        match self {
            Self::Well => "ok",
            Self::Watch => "--",
            Self::Ill => "XX",
        }
    }
}

/// One thing that was looked at.
#[derive(Debug, Clone)]
pub struct Check {
    /// What was looked at, as a person would name it.
    pub name: &'static str,
    /// How it came out.
    pub verdict: Verdict,
    /// What was found, as a sentence. Always said, including when all is
    /// well: "ok" on its own tells the reader nothing about what was
    /// actually measured, and a check they cannot picture is one they
    /// cannot trust.
    pub detail: String,
}

impl Check {
    fn new(name: &'static str, verdict: Verdict, detail: impl Into<String>) -> Self {
        Self {
            name,
            verdict,
            detail: detail.into(),
        }
    }
}

/// Everything that was looked at, and what it adds up to.
#[derive(Debug, Clone)]
pub struct Report {
    pub checks: Vec<Check>,
}

impl Report {
    /// The worst verdict in the report: what the stand is, in one word.
    #[must_use]
    pub fn verdict(&self) -> Verdict {
        if self.checks.iter().any(|check| check.verdict == Verdict::Ill) {
            Verdict::Ill
        } else if self.checks.iter().any(|check| check.verdict == Verdict::Watch) {
            Verdict::Watch
        } else {
            Verdict::Well
        }
    }

    /// Whether anything here stops the stand doing its job.
    ///
    /// The exit code follows this and not `verdict`: a script that stopped a
    /// deployment because no backup had been taken yet on a stand booted five
    /// minutes ago would be wrong, and would be worked around rather than
    /// fixed.
    #[must_use]
    pub fn is_ill(&self) -> bool {
        self.verdict() == Verdict::Ill
    }
}

impl fmt::Display for Report {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // The widest name, so the details line up and the column of marks can
        // be read down without reading the words.
        let width = self.checks.iter().map(|check| check.name.len()).max().unwrap_or(0);
        for check in &self.checks {
            writeln!(f, "{} {:width$}  {}", check.verdict.mark(), check.name, check.detail)?;
        }
        Ok(())
    }
}

/// Looks at a stand and says how it is.
///
/// Every check is run, whatever the ones before it said. A doctor that
/// stopped at the first problem would hand back one line at a time, and the
/// owner would run it again after each fix to find the next - which is the
/// thing this command exists to replace.
///
/// # Errors
///
/// Does not fail on a finding: a stand that is ill is a report, not an error.
/// Fails only when the report itself cannot be produced.
pub async fn examine(config: &Config) -> Result<Report> {
    let mut checks = Vec::new();

    checks.push(Check::new("version", Verdict::Well, format!("rhapsod {}", env!("CARGO_PKG_VERSION"))));
    checks.push(library(&config.content_dir));
    checks.push(app(&config.web_dir));

    // The database is opened once and every check that needs it shares the
    // connection: opening it three times on a Pi's card is slow enough to
    // notice, and a second opener would be a second idea of which file it is.
    match crate::db::connect(&config.database_url).await {
        Ok(pool) => {
            checks.push(database(&pool).await);
            checks.push(reader(&pool).await);

            // Today according to the database, which is where every other
            // stamp in the product comes from - including the names the
            // backups are written under.
            let check = match (crate::backup::today(&pool).await, crate::db::file_of(&config.database_url)) {
                (Ok(today), Ok(file)) => backups(&file, &today).await,
                (Err(error), _) => Check::new("backups", Verdict::Ill, format!("today's date could not be read: {error}")),
                (_, Err(error)) => Check::new("backups", Verdict::Ill, format!("the database path is unusable: {error}")),
            };
            checks.push(check);
            pool.close().await;
        }
        Err(error) => {
            checks.push(Check::new("database", Verdict::Ill, format!("cannot be opened: {error}")));
            checks.push(Check::new("reader", Verdict::Ill, "unknown: the database did not open"));
            checks.push(Check::new("backups", Verdict::Ill, "unknown: the database did not open"));
        }
    }

    checks.push(door(config));

    Ok(Report { checks })
}

/// Is there a library, and does it read?
fn library(dir: &Path) -> Check {
    if !dir.is_dir() {
        return Check::new(
            "library",
            Verdict::Ill,
            format!("{} is not a directory - RHAPSOD_CONTENT_DIR points at nothing", dir.display()),
        );
    }
    match Library::load(dir) {
        // An empty directory is a real state with a real cause - a publish
        // that has not run, or a volume mounted over the content - and it is
        // not a broken stand. The server starts, answers and serves nothing.
        Ok(library) if library.is_empty() => Check::new("library", Verdict::Watch, format!("{} is empty - nothing has been published", dir.display())),
        Ok(library) => {
            let (pieces, shelves) = (library.len(), library.sections().len());
            Check::new(
                "library",
                Verdict::Well,
                format!(
                    "{pieces} {} on {shelves} {} in {}",
                    if pieces == 1 { "piece" } else { "pieces" },
                    if shelves == 1 { "shelf" } else { "shelves" },
                    dir.display()
                ),
            )
        }
        Err(error) => Check::new("library", Verdict::Ill, format!("{} could not be read: {error}", dir.display())),
    }
}

/// Is the reading app built and where the server will look for it?
///
/// Its own check rather than a note under the library: a server whose API is
/// perfect and whose `index.html` is missing answers every call correctly and
/// shows a blank page, and that has happened often enough to be worth naming.
fn app(dir: &Path) -> Check {
    let entry = dir.join("index.html");
    if entry.is_file() {
        Check::new("app", Verdict::Well, format!("built at {}", dir.display()))
    } else {
        Check::new(
            "app",
            Verdict::Ill,
            format!(
                "no index.html in {} - the app was not built, or RHAPSOD_WEB_DIR points elsewhere",
                dir.display()
            ),
        )
    }
}

/// Is the database whole?
///
/// The same `integrity_check` the backups get, because the question is the
/// same one and the original deserves it at least as much as the copy.
async fn database(pool: &sqlx::SqlitePool) -> Check {
    match sqlx::query_scalar::<_, String>("PRAGMA integrity_check").fetch_one(pool).await {
        Ok(verdict) if verdict == "ok" => Check::new("database", Verdict::Well, "whole"),
        Ok(verdict) => Check::new("database", Verdict::Ill, format!("damaged: {verdict}")),
        Err(error) => Check::new("database", Verdict::Ill, format!("cannot be checked: {error}")),
    }
}

/// Is there anything in it?
///
/// The reader's side is the one thing on a stand that exists nowhere else, so
/// the doctor says how much of it there is. A stand restored from the wrong
/// file, or started against a fresh volume, looks perfectly healthy from
/// every other angle and is empty here.
async fn reader(pool: &sqlx::SqlitePool) -> Check {
    let counted = sqlx::query_as::<_, (i64, i64, i64)>(
        "SELECT (SELECT count(*) FROM reading_state),
                (SELECT count(*) FROM notes),
                (SELECT count(*) FROM quotes)",
    )
    .fetch_one(pool)
    .await;

    match counted {
        // Not a fault: a stand set up this morning has nothing in it yet, and
        // saying "ill" would be crying at a new machine.
        Ok((0, 0, 0)) => Check::new("reader", Verdict::Watch, "nothing recorded yet - a new stand, or a fresh volume"),
        Ok((reading, notes, quotes)) => Check::new(
            "reader",
            Verdict::Well,
            format!("{reading} pieces of reading state, {notes} notes, {quotes} quotes"),
        ),
        Err(error) => Check::new("reader", Verdict::Ill, format!("cannot be read: {error}")),
    }
}

/// Is there a recent copy of the one file that matters?
///
/// The newest copy is the one that would be reached for, so its age is the
/// answer. Counting them all would say "fourteen backups" about a stand whose
/// newest is from March.
///
/// The age comes from the name, not from the file's timestamp. The name
/// carries the day the copy is *of*, which is the thing being asked about; a
/// modification time is the day the file was last touched, and a whole
/// directory copied onto a new machine arrives stamped today. It is also the
/// same string `prune` sorts by, so the doctor and the pruner cannot disagree
/// about which copy is the newest.
async fn backups(database: &Path, today: &str) -> Check {
    let dir = crate::backup::directory(database);
    let mut newest: Option<String> = None;
    let mut count = 0usize;

    let mut entries = match tokio::fs::read_dir(&dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return none_yet(&dir),
        Err(error) => return Check::new("backups", Verdict::Ill, format!("{} cannot be read: {error}", dir.display())),
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().into_owned();
        // Exactly what this product writes: a hand-made copy beside them is
        // somebody else's and says nothing about whether the daily one ran.
        let Some(day) = crate::backup::day_of(&name) else { continue };
        count += 1;
        if newest.as_ref().is_none_or(|newest| day > *newest) {
            newest = Some(day);
        }
    }

    let Some(day) = newest else { return none_yet(&dir) };

    let days = days_between(&day, today);
    let verdict = if days.is_none_or(|days| days >= BACKUP_STALE_DAYS) {
        // An unreadable date is treated as old on purpose: the alternative is
        // a stand that says its backups are fine because it could not work
        // out when they were taken.
        Verdict::Ill
    } else {
        Verdict::Well
    };
    let age = match days {
        Some(0) => "today".to_string(),
        Some(1) => "yesterday".to_string(),
        Some(days) => format!("{days} days ago"),
        None => "an unreadable date".to_string(),
    };
    Check::new("backups", verdict, format!("{count} kept, newest from {day} ({age})"))
}

fn none_yet(dir: &Path) -> Check {
    Check::new(
        "backups",
        Verdict::Watch,
        format!("none yet in {} - the first is written within the hour", dir.display()),
    )
}

/// Whole days from one `YYYY-MM-DD` to another, or `None` if either is not
/// one.
///
/// Its own arithmetic rather than a date crate: two dates and a subtraction
/// do not need one, and the only hard part - how many days are in a month -
/// is avoided by counting days since a fixed point instead of differencing
/// the fields.
fn days_between(from: &str, to: &str) -> Option<u64> {
    let ordinal = |date: &str| -> Option<i64> {
        let mut parts = date.split('-');
        let year: i64 = parts.next()?.parse().ok()?;
        let month: i64 = parts.next()?.parse().ok()?;
        let day: i64 = parts.next()?.parse().ok()?;
        if parts.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
            return None;
        }
        // Days since the Gregorian epoch, by the civil-from-days algorithm:
        // March is treated as the first month so the leap day lands at the
        // end of the year and never has to be special-cased.
        let year = if month <= 2 { year - 1 } else { year };
        let era = year.div_euclid(400);
        let year_of_era = year - era * 400;
        let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
        let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
        Some(era * 146_097 + day_of_era)
    };
    let (from, to) = (ordinal(from)?, ordinal(to)?);
    // A copy stamped in the future is not "negative days old": a clock that
    // went backwards is a reason to look, not to report a fresh backup.
    u64::try_from(to - from).ok()
}

/// Can a door be put in front of this, and is there a lock on it?
///
/// Two facts in one line because they are one question in practice: who can
/// reach the stand. A stand bound to every interface with no password is
/// wide open to the house network, which on a home network with one reader
/// is a choice and not a fault - so it is a thing to watch, not an illness.
fn door(config: &Config) -> Check {
    let loopback = config.addr.ip().is_loopback();
    let locked = config.password_hash.is_some();

    let where_it_listens = if loopback {
        format!("listening on {} - only a proxy on this machine can reach it", config.addr)
    } else {
        format!("listening on {} - anything on the network can reach it", config.addr)
    };
    let lock = if locked { "a password is set" } else { "no password: the stand is open" };

    // Loopback means something is expected in front, and whatever that is
    // holds the certificate and can hold a password of its own. Open to the
    // network with no password is the combination worth a mark.
    let verdict = if loopback || locked { Verdict::Well } else { Verdict::Watch };
    Check::new("door", verdict, format!("{where_it_listens}; {lock}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A stand that is entirely well, as a fresh test setup can make one.
    struct Stand {
        _dir: tempfile::TempDir,
        config: Config,
    }

    fn stand() -> Stand {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let content = dir.path().join("content/01 — A Shelf");
        std::fs::create_dir_all(&content).unwrap();
        std::fs::write(
            content.join("a-piece.md"),
            "---\ntype: novella\nsection: A Shelf\ntopic: A Piece\n---\n\nA paragraph.\n",
        )
        .unwrap();

        let web = dir.path().join("web");
        std::fs::create_dir_all(&web).unwrap();
        std::fs::write(web.join("index.html"), "<!doctype html>").unwrap();

        let config = Config {
            addr: "127.0.0.1:8084".parse().unwrap(),
            content_dir: dir.path().join("content"),
            database_url: format!("sqlite://{}?mode=rwc", dir.path().join("data/rhapsod.db").display()),
            web_dir: web,
            password_hash: None,
        };
        Stand { _dir: dir, config }
    }

    fn check<'a>(report: &'a Report, name: &str) -> &'a Check {
        report
            .checks
            .iter()
            .find(|check| check.name == name)
            .unwrap_or_else(|| panic!("no {name} check"))
    }

    #[tokio::test]
    async fn a_healthy_stand_has_nothing_ill_in_it() {
        let stand = stand();
        let report = examine(&stand.config).await.unwrap();

        assert!(!report.is_ill(), "a healthy stand was called ill:\n{report}");
        assert_eq!(check(&report, "library").verdict, Verdict::Well);
        assert_eq!(check(&report, "app").verdict, Verdict::Well);
        assert_eq!(check(&report, "database").verdict, Verdict::Well);
        // On loopback, so the open stand is behind whatever holds the door.
        assert_eq!(check(&report, "door").verdict, Verdict::Well);
    }

    #[tokio::test]
    async fn every_check_is_run_even_when_one_fails() {
        // Stopping at the first problem would hand back one line at a time,
        // and the owner would run this again after every fix.
        let mut stand = stand();
        stand.config.content_dir = stand.config.content_dir.join("not-here");
        stand.config.web_dir = stand.config.web_dir.join("not-here");

        let report = examine(&stand.config).await.unwrap();
        assert!(report.is_ill());
        assert_eq!(check(&report, "library").verdict, Verdict::Ill);
        assert_eq!(check(&report, "app").verdict, Verdict::Ill);
        // And the ones that are fine still ran and still said so.
        assert_eq!(check(&report, "database").verdict, Verdict::Well);
        assert_eq!(check(&report, "version").verdict, Verdict::Well);
    }

    #[tokio::test]
    async fn an_empty_library_is_watched_not_condemned() {
        // A publish that has not run yet is a real state with a real cause.
        // Grading it as a broken stand teaches the owner that red is normal.
        let stand = stand();
        let empty = stand.config.content_dir.join("nothing");
        std::fs::create_dir_all(&empty).unwrap();
        let config = Config {
            content_dir: empty,
            ..stand.config.clone()
        };

        let report = examine(&config).await.unwrap();
        assert_eq!(check(&report, "library").verdict, Verdict::Watch);
        assert!(!report.is_ill(), "an empty library was called an illness");
    }

    #[tokio::test]
    async fn a_missing_app_is_an_illness() {
        // The API answers perfectly and the reader sees a blank page.
        let stand = stand();
        std::fs::remove_file(stand.config.web_dir.join("index.html")).unwrap();

        let report = examine(&stand.config).await.unwrap();
        assert_eq!(check(&report, "app").verdict, Verdict::Ill);
        assert!(report.is_ill());
    }

    #[tokio::test]
    async fn a_new_stand_has_no_backups_and_that_is_not_an_illness() {
        let stand = stand();
        let report = examine(&stand.config).await.unwrap();

        assert_eq!(check(&report, "backups").verdict, Verdict::Watch);
        assert!(check(&report, "backups").detail.contains("none yet"));
        assert!(!report.is_ill());
    }

    #[tokio::test]
    async fn a_fresh_backup_is_well_and_an_old_one_is_not() {
        let stand = stand();
        let database = crate::db::file_of(&stand.config.database_url).unwrap();
        let pool = crate::db::connect(&stand.config.database_url).await.unwrap();
        crate::progress::set_read(&pool, "a/b", true, None).await.unwrap();
        let today = crate::backup::today(&pool).await.unwrap();
        crate::backup::take(&pool, &database, &today).await.unwrap().expect("a backup");
        pool.close().await;

        let report = examine(&stand.config).await.unwrap();
        assert_eq!(check(&report, "backups").verdict, Verdict::Well, "{}", check(&report, "backups").detail);
        assert!(check(&report, "backups").detail.contains("today"), "{}", check(&report, "backups").detail);

        // The age of the newest is what is judged, not the count: a stand
        // with a fortnight of copies whose newest is from March has no
        // backup. The days are old ones, so the fresh copy has to go.
        std::fs::remove_file(crate::backup::directory(&database).join(format!("rhapsod-{today}.db"))).unwrap();
        let pool = crate::db::connect(&stand.config.database_url).await.unwrap();
        for day in ["2020-03-01", "2020-03-02", "2020-03-03"] {
            crate::backup::take(&pool, &database, day).await.unwrap().expect("a backup");
        }
        pool.close().await;

        let report = examine(&stand.config).await.unwrap();
        assert_eq!(check(&report, "backups").verdict, Verdict::Ill, "{}", check(&report, "backups").detail);
        assert!(check(&report, "backups").detail.contains("2020-03-03"), "{}", check(&report, "backups").detail);
        assert!(report.is_ill(), "a stand whose newest backup is years old was called well");
    }

    #[tokio::test]
    async fn a_hand_made_copy_is_not_a_daily_backup() {
        // A `rhapsod-before-upgrade.db` somebody made by hand would report a
        // backup that no schedule will ever replace.
        let stand = stand();
        let database = crate::db::file_of(&stand.config.database_url).unwrap();
        let dir = crate::backup::directory(&database);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("rhapsod-before-upgrade.db"), b"someone's own copy").unwrap();

        let report = examine(&stand.config).await.unwrap();
        assert_eq!(check(&report, "backups").verdict, Verdict::Watch);
        assert!(check(&report, "backups").detail.contains("none yet"), "{}", check(&report, "backups").detail);
    }

    #[test]
    fn days_are_counted_across_months_and_leap_years() {
        assert_eq!(days_between("2026-09-19", "2026-09-19"), Some(0));
        assert_eq!(days_between("2026-09-18", "2026-09-19"), Some(1));
        // Across a month boundary, where field subtraction would say -29.
        assert_eq!(days_between("2026-08-31", "2026-09-01"), Some(1));
        // Across a year, and through a leap day.
        assert_eq!(days_between("2024-02-28", "2024-03-01"), Some(2));
        assert_eq!(days_between("2025-02-28", "2025-03-01"), Some(1));
        assert_eq!(days_between("2025-12-31", "2026-01-01"), Some(1));
        // A copy stamped in the future is not a fresh one.
        assert_eq!(days_between("2026-09-20", "2026-09-19"), None);
        // Not a date at all.
        assert_eq!(days_between("before-upgrade", "2026-09-19"), None);
        assert_eq!(days_between("2026-13-01", "2026-09-19"), None);
    }

    #[tokio::test]
    async fn the_reader_side_is_counted() {
        let stand = stand();
        let report = examine(&stand.config).await.unwrap();
        // Nothing read yet: worth saying, not worth crying about.
        assert_eq!(check(&report, "reader").verdict, Verdict::Watch);

        let pool = crate::db::connect(&stand.config.database_url).await.unwrap();
        crate::progress::set_read(&pool, "a/b", true, None).await.unwrap();
        pool.close().await;

        let report = examine(&stand.config).await.unwrap();
        assert_eq!(check(&report, "reader").verdict, Verdict::Well);
        assert!(check(&report, "reader").detail.contains('1'), "{}", check(&report, "reader").detail);
    }

    #[tokio::test]
    async fn an_open_stand_on_the_network_is_worth_a_word() {
        // On loopback there is something in front holding the door; bound to
        // everything with no password, the house network is the door.
        let stand = stand();
        let report = examine(&stand.config).await.unwrap();
        assert_eq!(check(&report, "door").verdict, Verdict::Well);

        let config = Config {
            addr: "0.0.0.0:8084".parse().unwrap(),
            ..stand.config.clone()
        };
        let report = examine(&config).await.unwrap();
        assert_eq!(check(&report, "door").verdict, Verdict::Watch);
        assert!(check(&report, "door").detail.contains("no password"));

        // With a password it is a choice that has been made, not a gap.
        let config = Config {
            addr: "0.0.0.0:8084".parse().unwrap(),
            password_hash: Some(crate::auth::hash("a passphrase").unwrap()),
            ..stand.config.clone()
        };
        let report = examine(&config).await.unwrap();
        assert_eq!(check(&report, "door").verdict, Verdict::Well);
    }

    #[tokio::test]
    async fn the_report_says_what_it_measured_even_when_all_is_well() {
        // "ok" on its own is a check nobody can picture, and a check nobody
        // can picture is one nobody trusts.
        let stand = stand();
        let report = examine(&stand.config).await.unwrap();
        for check in &report.checks {
            assert!(!check.detail.trim().is_empty(), "{} said nothing", check.name);
        }
        let printed = report.to_string();
        assert!(printed.contains("1 piece on 1 shelf"), "{printed}");
        assert!(printed.contains("rhapsod 0."), "{printed}");
    }

    #[tokio::test]
    async fn a_database_that_will_not_open_does_not_take_the_rest_with_it() {
        let stand = stand();
        let config = Config {
            database_url: "sqlite://?mode=ro".to_string(),
            ..stand.config.clone()
        };
        let report = examine(&config).await.unwrap();
        assert_eq!(check(&report, "database").verdict, Verdict::Ill);
        // The library and the app were still looked at.
        assert_eq!(check(&report, "library").verdict, Verdict::Well);
        assert_eq!(check(&report, "app").verdict, Verdict::Well);
    }
}
