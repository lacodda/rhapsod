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
    let app = rhapsod::app::router(pool, web.path(), index, content.path().to_path_buf());
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
