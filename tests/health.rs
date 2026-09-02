//! The server as a client sees it.
//!
//! The unit tests in `src/app.rs` prove each handler answers correctly; this
//! proves the pieces are wired together the way a deployment relies on: a
//! database opened the real way and migrated from empty, a library read from
//! real files on disk, and the router built over both.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt;

/// A published library: the shape the stand's content volume has.
fn library(root: &std::path::Path) {
    let section = root.join("02 — История");
    std::fs::create_dir_all(&section).expect("the section directory");
    std::fs::write(
        section.join("Год без лета.md"),
        "---\ntopic: Год без лета\nwritten: 2026-09-01\nwords: 953\n---\n\n# Год без лета\n\nИюнь 1816 года, берег Женевского озера.\n\n## Одной строкой\n\n**«Письмо шло год и пришло без обратного адреса».**\n",
    )
    .expect("the piece");
}

async fn stand() -> (axum::Router, tempfile::TempDir, tempfile::TempDir) {
    // A real file in a fresh directory, not an in-memory database: this is
    // the path a stand takes on its first start.
    let data = tempfile::tempdir().expect("a temporary directory");
    let url = format!("sqlite://{}?mode=rwc", data.path().join("rhapsod.db").display());
    let pool = rhapsod::db::connect(&url).await.expect("the database should open and migrate from empty");

    let content = tempfile::tempdir().expect("a temporary directory");
    library(content.path());
    let index = rhapsod::library::Library::load(content.path()).expect("the library should index");

    let web = tempfile::tempdir().expect("a temporary directory");
    // No password: the stand runs open on a home network by default, and
    // the locked case has its own test below.
    let app = rhapsod::app::router(pool, web.path(), index, content.path().to_path_buf(), None);
    (app, data, content)
}

async fn json(app: axum::Router, uri: &str) -> serde_json::Value {
    let response = app.oneshot(Request::get(uri).body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK, "{uri} did not answer");
    let body = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&body).unwrap()
}

#[tokio::test]
async fn health_answers_ok_with_the_crate_version() {
    let (app, _data, _content) = stand().await;
    let body = json(app, "/api/health").await;
    assert_eq!(body["status"], "ok");
    assert_eq!(body["version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(body["pieces"], 1);
}

#[tokio::test]
async fn a_published_file_can_be_read_through_the_api() {
    // The whole point of the product, end to end: a markdown file in a
    // directory comes back as something the reading app can render.
    let (app, _data, _content) = stand().await;

    let index = json(app.clone(), "/api/library").await;
    assert_eq!(index["sections"][0]["title"], "История");
    assert_eq!(index["pieces"][0]["id"], "02-istoriya/god-bez-leta");

    let piece = json(app, "/api/pieces/02-istoriya/god-bez-leta").await;
    assert_eq!(piece["title"], "Год без лета");
    assert!(
        piece["paragraphs"][0].as_str().unwrap().starts_with("Июнь 1816 года"),
        "the prose did not survive the round trip"
    );
    assert_eq!(piece["one_liner"], "Письмо шло год и пришло без обратного адреса.");
}

/// The migrations up to the one being tested, applied to an empty database.
///
/// Applying a prefix rather than all of them is the point: the upgrade a live
/// stand performs starts from the schema it already has, and a test that
/// migrates from empty every time never exercises that path at all.
async fn migrated_up_to(pool: &sqlx::SqlitePool, last_version: i64) {
    use sqlx::Executor as _;

    let migrator = sqlx::migrate!();
    let mut connection = pool.acquire().await.expect("a connection");

    // sqlx accepts only `&'static str` as SQL, to keep dynamic strings out of
    // queries. These are compile-time constants from `migrate!()` that happen
    // to be reachable only through a local, so leaking them says what they are
    // rather than working around the rule; the count is the number of
    // migrations in the crate.
    //
    // sqlx's own runner is not used here at all: it would apply every
    // migration, and the schema being started from is the point of this
    // helper.
    let wanted: Vec<(i64, &'static str)> = migrator
        .iter()
        .filter(|migration| migration.version <= last_version)
        .map(|migration| (migration.version, &*Box::leak(migration.sql.as_str().to_owned().into_boxed_str())))
        .collect();

    for (version, sql) in wanted {
        // Several statements in one string, which is what `execute` on a
        // connection takes.
        connection
            .execute(sql)
            .await
            .unwrap_or_else(|error| panic!("migration {version} should apply: {error}"));
    }

    // sqlx records what it has applied, and a migrator run afterwards trusts
    // that table: without these rows it would re-apply 0001 onto a database
    // that already has it and fail on a table that exists.
    connection
        .execute(
            "CREATE TABLE IF NOT EXISTS _sqlx_migrations (
                version BIGINT PRIMARY KEY,
                description TEXT NOT NULL,
                installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                success BOOLEAN NOT NULL,
                checksum BLOB NOT NULL,
                execution_time BIGINT NOT NULL
            )",
        )
        .await
        .expect("the migration bookkeeping table");
    for migration in migrator.iter().filter(|migration| migration.version <= last_version) {
        sqlx::query("INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (?, ?, TRUE, ?, 0)")
            .bind(migration.version)
            .bind(migration.description.as_ref())
            .bind(migration.checksum.as_ref())
            .execute(&mut *connection)
            .await
            .expect("recording an applied migration");
    }
}

#[tokio::test]
async fn the_lines_a_reader_kept_survive_the_change_of_identity() {
    // The riskiest thing in the offline release: quotes stopped being keyed by
    // a number the server chose and became keyed by an id the device mints,
    // which means the table is rebuilt under a reader who already has
    // highlights in it. Losing those would be losing the part of the library
    // that is theirs and not recoverable from the vault.
    let dir = tempfile::tempdir().expect("a temporary directory");
    let url = format!("sqlite://{}?mode=rwc", dir.path().join("rhapsod.db").display());
    let pool = sqlx::SqlitePool::connect(&url).await.expect("the database should open");

    // The schema as it stood before the queue existed, with a line kept in it.
    // 0003 is the last migration before the offline release.
    migrated_up_to(&pool, 3).await;
    sqlx::query("INSERT INTO quotes (piece_id, paragraph, text, comment) VALUES (?, ?, ?, ?)")
        .bind("02-istoriya/god-bez-leta")
        .bind(3_i64)
        .bind("the line that was kept")
        .bind("and what was said about it")
        .execute(&pool)
        .await
        .expect("the old schema should take a quote");

    // The upgrade, exactly as a stand performs it on the first start after
    // the release.
    sqlx::migrate!().run(&pool).await.expect("the migrations should apply over the old schema");

    let (id, text, comment, paragraph): (String, String, Option<String>, i64) = sqlx::query_as("SELECT id, text, comment, paragraph FROM quotes")
        .fetch_one(&pool)
        .await
        .expect("the kept line should still be there");
    assert_eq!(text, "the line that was kept", "the reader's own words did not survive the upgrade");
    assert_eq!(comment.as_deref(), Some("and what was said about it"));
    assert_eq!(paragraph, 3, "the quote lost the paragraph it came from");
    assert!(!id.is_empty(), "the migrated quote has no id to address it by");

    // And it is addressable: a quote whose id the app cannot use is a
    // highlight the reader can see but never remove.
    let removed = sqlx::query("DELETE FROM quotes WHERE id = ?").bind(&id).execute(&pool).await.unwrap();
    assert_eq!(removed.rows_affected(), 1, "the migrated quote could not be addressed by its id");
}
