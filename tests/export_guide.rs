//! The guide to taking marks back names everything the export carries.
//!
//! A kind added to `GET /api/export` without a line in the guide is a kind no
//! vault ritual knows to take: it rides along in every export and lands
//! nowhere, which is how typos and reactions stayed on the stand for two
//! versions while every merge reported success. So the list of kinds is asked
//! of a real server, not written down a second time here.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt;

const GUIDE: &str = "docs/site/src/content/docs/guides/exporting-marks.md";

async fn export_kinds() -> Vec<String> {
    let data = tempfile::tempdir().expect("a temporary directory");
    let url = format!("sqlite://{}?mode=rwc", data.path().join("rhapsod.db").display());
    let pool = rhapsod::db::connect(&url).await.expect("the database should open and migrate from empty");
    let content = tempfile::tempdir().expect("a temporary directory");
    let index = rhapsod::library::Library::load(content.path()).expect("an empty library should index");
    let web = tempfile::tempdir().expect("a temporary directory");
    let app = rhapsod::app::router(pool, web.path(), index, content.path().to_path_buf(), None);

    let response = app.oneshot(Request::get("/api/export").body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK, "the export did not answer");
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let document: serde_json::Value = serde_json::from_slice(&body).unwrap();

    // An empty stand answers with every kind present and empty, which is
    // exactly the list wanted: the arrays are the kinds, the scalars are the
    // envelope.
    document
        .as_object()
        .expect("the export is an object")
        .iter()
        .filter(|(_, value)| value.is_array())
        .map(|(key, _)| key.clone())
        .collect()
}

#[tokio::test]
async fn the_guide_names_every_kind_the_export_carries() {
    let kinds = export_kinds().await;
    assert!(kinds.len() >= 9, "the export lost its kinds: {kinds:?}");

    let guide = std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(GUIDE)).expect("the guide");

    // A row of the kinds table, not a mention anywhere: `reading` appears in
    // prose a dozen times whether or not the table has it.
    let missing: Vec<&String> = kinds
        .iter()
        .filter(|kind| !guide.lines().any(|line| line.starts_with(&format!("| `{kind}` |"))))
        .collect();
    assert!(
        missing.is_empty(),
        "{GUIDE} has no row for {missing:?}; say where each of them lands in the vault"
    );
}

#[tokio::test]
async fn every_kind_in_the_guide_says_where_it_lands() {
    // The table has a third column for a reason: a kind listed with nowhere
    // to go is the same hole as a kind not listed.
    let kinds = export_kinds().await;
    let guide = std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(GUIDE)).expect("the guide");
    for kind in &kinds {
        let row = guide
            .lines()
            .find(|line| line.starts_with(&format!("| `{kind}` |")))
            .unwrap_or_else(|| panic!("no row for {kind}"));
        let cells: Vec<&str> = row.split('|').map(str::trim).collect();
        // `| kind | holds | lands in |` splits into five cells, the outer two empty.
        assert!(
            cells.len() >= 5 && !cells[3].is_empty() && cells[3] != "-",
            "the row for `{kind}` does not say where it lands: {row}"
        );
    }
}
