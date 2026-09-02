//! The router: what the browser asks the server for.

use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use axum::{
    Json, Router,
    extract::{Path as UrlPath, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::SqlitePool;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;

use crate::auth::{self, Reader};
use crate::library::{Library, PieceSummary, Section};
use crate::marks;
use crate::progress;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    /// The index, rebuilt by `POST /api/reindex` while the server keeps
    /// answering. A read lock is held only long enough to clone what a
    /// response needs, so publishing content never blocks a reader mid-page.
    pub library: Arc<RwLock<Library>>,
    /// Where the library is read from, so a reindex knows what to re-read.
    pub content_dir: PathBuf,
    /// Argon2 hash of the reading password; `None` leaves the stand open.
    pub password_hash: Option<String>,
}

/// The router: the API under `/api`, the reading app everywhere else.
///
/// The SPA is served from `web_dir` as real files when they exist and as
/// `index.html` otherwise, so a deep link into a novella loads the app rather
/// than a 404. The API never falls through to it: a misspelled endpoint has to
/// look like a mistake, not like a page.
pub fn router(pool: SqlitePool, web_dir: &Path, library: Library, content_dir: PathBuf, password_hash: Option<String>) -> Router {
    let state = AppState {
        pool,
        library: Arc::new(RwLock::new(library)),
        content_dir,
        password_hash,
    };

    let api = Router::new()
        .route("/health", get(health))
        .route("/library", get(library_index))
        .route("/sections", get(sections))
        .route("/sections/{section}", get(section_pieces))
        .route("/pieces/{section}/{piece}", get(piece))
        .route("/reindex", post(reindex))
        .route("/session", get(session).post(sign_in).delete(sign_out))
        .route("/progress", get(read_progress))
        .route("/progress/{section}/{piece}", post(record_progress))
        .route("/next", get(what_next))
        .route("/notes", get(read_notes))
        .route("/notes/{section}/{piece}", post(write_note))
        .route("/quotes", get(read_quotes).post(keep_quote))
        .route("/quotes/{id}", post(edit_quote).delete(drop_quote))
        .route("/export", get(export))
        .fallback(api_not_found)
        .with_state(state);

    // `ServeDir`'s own `not_found_service` is deliberately not used: it serves
    // the fallback body but keeps the 404 of the request that missed, which a
    // browser renders fine and every crawler and uptime monitor reads as
    // "broken". Routing the miss through the router's fallback gives the
    // handler's own status.
    let index = web_dir.join("index.html");
    let files = ServeDir::new(web_dir);
    let spa = get(move || serve_index(index.clone()));

    Router::new()
        .nest("/api", api)
        .fallback_service(files.fallback(spa))
        .layer(TraceLayer::new_for_http())
}

/// The SPA's entry point, answered with 200 for any client-side route.
///
/// A missing entry point is not an error in the process but in what was
/// deployed next to it: the reading app was not built, or `RHAPSOD_WEB_DIR`
/// points elsewhere. Saying so beats a blank page.
async fn serve_index(path: PathBuf) -> Response {
    match tokio::fs::read(&path).await {
        Ok(bytes) => ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], bytes).into_response(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (
            StatusCode::NOT_FOUND,
            "the reading app is not built; run `pnpm build` in web/ or set RHAPSOD_WEB_DIR",
        )
            .into_response(),
        Err(error) => {
            tracing::error!(%error, path = %path.display(), "the SPA entry point could not be read");
            (StatusCode::INTERNAL_SERVER_ERROR, "the application could not be loaded").into_response()
        }
    }
}

/// What `GET /api/health` answers.
#[derive(Serialize)]
struct Health {
    status: &'static str,
    version: &'static str,
    pieces: usize,
}

/// Liveness and readiness in one place: the process answers, the database
/// round-trip tells whether the server can do its job, and the piece count
/// tells whether the library it was pointed at is the one that was published.
async fn health(State(state): State<AppState>) -> Response {
    let version = env!("CARGO_PKG_VERSION");
    let pieces = state.library.read().map_or(0, |library| library.len());
    match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => (StatusCode::OK, Json(Health { status: "ok", version, pieces })).into_response(),
        Err(error) => {
            tracing::error!(%error, "health check: database unreachable");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(Health {
                    status: "degraded",
                    version,
                    pieces,
                }),
            )
                .into_response()
        }
    }
}

/// What `GET /api/library` answers: everything the app needs to render its
/// shelves and to cache the library offline, in one request.
#[derive(Serialize)]
struct LibraryIndex {
    sections: Vec<Section>,
    pieces: Vec<PieceSummary>,
}

/// The whole index in one response.
///
/// Behind the reader gate like everything else about the library: a password
/// that protects the reading state but hands out the text protects nothing
/// that matters. On an open stand the gate lets everyone through.
///
/// One request rather than one per section: the app caches the library for
/// offline reading, and a phone on a home network pays for round trips more
/// than for bytes.
async fn library_index(_: Reader, State(state): State<AppState>) -> Response {
    with_library(&state, |library| {
        Json(LibraryIndex {
            sections: library.sections().to_vec(),
            pieces: library.summaries(),
        })
        .into_response()
    })
}

async fn sections(_: Reader, State(state): State<AppState>) -> Response {
    with_library(&state, |library| Json(library.sections().to_vec()).into_response())
}

async fn section_pieces(_: Reader, State(state): State<AppState>, UrlPath(section): UrlPath<String>) -> Response {
    with_library(&state, |library| {
        if library.sections().iter().all(|shelf| shelf.id != section) {
            return not_found("no such section");
        }
        Json(library.summaries_in(&section)).into_response()
    })
}

/// One piece with its text.
///
/// The id is two path segments rather than one escaped string: it is a shelf
/// and a piece on it, and a URL that shows that is one a person can edit.
async fn piece(_: Reader, State(state): State<AppState>, UrlPath((section, piece)): UrlPath<(String, String)>) -> Response {
    let id = format!("{section}/{piece}");
    with_library(&state, |library| {
        library
            .piece(&id)
            .map_or_else(|| not_found("no such piece"), |piece| Json(piece.clone()).into_response())
    })
}

/// Rebuilds the index from the content directory.
///
/// Called by the publishing script after it copies new files onto the stand.
/// It is the one endpoint that changes what the server holds, and it changes
/// nothing on disk: the library is read, never written (ADR 0002).
async fn reindex(State(state): State<AppState>) -> Response {
    let content_dir = state.content_dir.clone();
    let loaded = tokio::task::spawn_blocking(move || Library::load(&content_dir)).await;

    let library = match loaded {
        Ok(Ok(library)) => library,
        Ok(Err(error)) => {
            tracing::error!(%error, "reindex failed");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "the library could not be read" }))).into_response();
        }
        Err(error) => {
            tracing::error!(%error, "the reindex task failed");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "the library could not be read" }))).into_response();
        }
    };

    let pieces = library.len();
    let sections = library.sections().len();
    match state.library.write() {
        Ok(mut held) => *held = library,
        Err(_) => return lock_poisoned(),
    }
    tracing::info!(pieces, sections, "library reindexed");
    Json(json!({ "pieces": pieces, "sections": sections })).into_response()
}

/// Reads the index for the length of one response.
///
/// The lock is poisoned only if a writer panicked, which would mean the index
/// is of unknown shape; saying so is better than serving half a library.
fn with_library(state: &AppState, render: impl FnOnce(&Library) -> Response) -> Response {
    match state.library.read() {
        Ok(library) => render(&library),
        Err(_) => lock_poisoned(),
    }
}

fn lock_poisoned() -> Response {
    tracing::error!("the library lock is poisoned");
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "the library is unavailable" }))).into_response()
}

fn not_found(message: &'static str) -> Response {
    (StatusCode::NOT_FOUND, Json(json!({ "error": message }))).into_response()
}

/// Whether this browser is signed in, and whether it has to be.
///
/// The app asks this first: an open stand and a signed-in reader look the same
/// to it, and a locked one gets the sign-in screen.
#[derive(Serialize)]
struct SessionState {
    /// True when the stand has no password: everyone is a reader.
    open: bool,
    /// True when this browser may read.
    reader: bool,
}

async fn session(State(state): State<AppState>, headers: axum::http::HeaderMap) -> Response {
    let open = state.password_hash.is_none();
    let reader = if open {
        true
    } else {
        match auth::token_from_headers(&headers) {
            Some(token) => auth::is_live(&state.pool, &token).await.unwrap_or(false),
            None => false,
        }
    };
    Json(SessionState { open, reader }).into_response()
}

#[derive(Deserialize)]
struct SignIn {
    password: String,
}

/// Signs in, setting the session cookie.
async fn sign_in(State(state): State<AppState>, Json(body): Json<SignIn>) -> Response {
    let Some(hash) = state.password_hash.as_deref() else {
        // Nothing to sign in to. Saying so beats handing out a session that
        // protects nothing and would confuse the app's own state.
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "this stand has no password" }))).into_response();
    };

    match auth::verify(&body.password, hash) {
        Ok(true) => {}
        Ok(false) => return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "that is not the password" }))).into_response(),
        Err(error) => {
            // A hash the server cannot parse is a deployment error; reading it
            // as a wrong password would leave the owner typing the right one
            // forever against a server that cannot check it.
            tracing::error!(%error, "the configured password hash cannot be used");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "the stand's password is misconfigured" })),
            )
                .into_response();
        }
    }

    let token = auth::new_token();
    if let Err(error) = auth::start(&state.pool, &token).await {
        return failed(&error, "the session could not be started");
    }

    ([(header::SET_COOKIE, auth::cookie(&token))], Json(SessionState { open: false, reader: true })).into_response()
}

/// Signs out, ending the session rather than only forgetting the cookie.
async fn sign_out(State(state): State<AppState>, headers: axum::http::HeaderMap) -> Response {
    if let Some(token) = auth::token_from_headers(&headers)
        && let Err(error) = auth::end(&state.pool, &token).await
    {
        return failed(&error, "the session could not be ended");
    }
    let open = state.password_hash.is_none();
    ([(header::SET_COOKIE, auth::cleared_cookie())], Json(SessionState { open, reader: open })).into_response()
}

/// Everything the reader has read, and what it adds up to.
#[derive(Serialize)]
struct Progress {
    pieces: Vec<progress::State>,
    stats: progress::Stats,
    /// The piece to continue, if there is one.
    continue_with: Option<String>,
}

async fn read_progress(_: Reader, State(state): State<AppState>) -> Response {
    let pieces = match progress::all(&state.pool).await {
        Ok(pieces) => pieces,
        Err(error) => return failed(&error, "the reading state could not be read"),
    };

    // The library is cloned out of the lock rather than held across the
    // queries below: a read lock held over an await would block a reindex for
    // as long as the database takes.
    let library = {
        let Ok(held) = state.library.read() else {
            return lock_poisoned();
        };
        held.clone()
    };

    let totals = match progress::stats(&state.pool, &library).await {
        Ok(totals) => totals,
        Err(error) => return failed(&error, "the statistics could not be read"),
    };
    let continue_with = match progress::continue_with(&state.pool).await {
        Ok(unfinished) => unfinished.map(|row| row.piece_id),
        Err(error) => return failed(&error, "the reading state could not be read"),
    };

    Json(Progress {
        pieces,
        stats: totals,
        continue_with,
    })
    .into_response()
}

/// What the app reports as the reader moves.
#[derive(Deserialize)]
struct Moved {
    /// Paragraph last seen, if the report is about position.
    paragraph: Option<i64>,
    /// Set to finish or unfinish the piece.
    read: Option<bool>,
    /// When the device recorded this, so a report drained from an offline
    /// queue does not overwrite a newer one (ADR 0003). Absent from a report
    /// sent live, which is the same thing as "now".
    marked_at: Option<String>,
}

/// Records where the reader is in a piece.
///
/// One endpoint for both kinds of report: they arrive from the same screen,
/// often in the same second, and splitting them would only make the app choose
/// between two calls.
async fn record_progress(_: Reader, State(state): State<AppState>, UrlPath((section, piece)): UrlPath<(String, String)>, Json(moved): Json<Moved>) -> Response {
    let id = format!("{section}/{piece}");

    // A report about a piece that is not in the library is a stale phone or a
    // typed URL; storing it would leave rows no screen can ever show.
    {
        let Ok(library) = state.library.read() else {
            return lock_poisoned();
        };
        if library.piece(&id).is_none() {
            return not_found("no such piece");
        }
    }

    let marked_at = moved.marked_at.as_deref();

    if let Some(paragraph) = moved.paragraph {
        if let Err(error) = progress::at_paragraph(&state.pool, &id, paragraph, marked_at).await {
            return failed(&error, "the reading position could not be saved");
        }
    } else if moved.read.is_none()
        && let Err(error) = progress::opened(&state.pool, &id, marked_at).await
    {
        return failed(&error, "the reading state could not be saved");
    }

    if let Some(read) = moved.read
        && let Err(error) = progress::set_read(&state.pool, &id, read, marked_at).await
    {
        return failed(&error, "the reading state could not be saved");
    }

    StatusCode::NO_CONTENT.into_response()
}

/// What the reader asks for at the end of a piece.
#[derive(Deserialize)]
struct After {
    /// The piece just finished, so the answer can come from another shelf.
    after: Option<String>,
}

/// What to read next.
///
/// The default is an unread piece from another shelf: reading straight down
/// one shelf turns thirty pieces about paradoxes into a textbook, and the
/// format is built for the opposite. Within that, reading order decides, so
/// the answer is the same on every device and does not shuffle underfoot.
async fn what_next(_: Reader, State(state): State<AppState>, axum::extract::Query(after): axum::extract::Query<After>) -> Response {
    let touched = match progress::all(&state.pool).await {
        Ok(states) => states,
        Err(error) => return failed(&error, "the reading state could not be read"),
    };
    let read: std::collections::HashSet<String> = touched.into_iter().filter(|row| row.status == "read").map(|row| row.piece_id).collect();

    with_library(&state, |library| {
        let current_section = after.after.as_deref().and_then(|id| library.piece(id)).map(|piece| piece.section.clone());

        let summaries = library.summaries();
        let unread: Vec<&PieceSummary> = summaries.iter().filter(|piece| !read.contains(&piece.id)).collect();

        // Another shelf first; if everything unread is on this one, the shelf
        // itself is the answer rather than nothing.
        let pick = unread
            .iter()
            .find(|piece| current_section.as_deref() != Some(piece.section.as_str()))
            .or_else(|| unread.first())
            .map(|piece| (*piece).clone());

        Json(json!({ "next": pick })).into_response()
    })
}

fn failed(error: &anyhow::Error, message: &'static str) -> Response {
    tracing::error!(%error, message);
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": message }))).into_response()
}

/// Every note the reader has written.
async fn read_notes(_: Reader, State(state): State<AppState>) -> Response {
    match marks::notes(&state.pool).await {
        Ok(notes) => Json(notes).into_response(),
        Err(error) => failed(&error, "the notes could not be read"),
    }
}

/// What the app sends when a note changes.
#[derive(Deserialize)]
struct NoteBody {
    body: String,
    /// When the device wrote this; see `Moved::marked_at`.
    marked_at: Option<String>,
}

/// Writes the note on a piece.
///
/// The whole note every time rather than a diff: it is a few hundred words at
/// most, typed by one person on one device at a time, and a merge algorithm
/// would be more machinery than the problem has.
async fn write_note(_: Reader, State(state): State<AppState>, UrlPath((section, piece)): UrlPath<(String, String)>, Json(note): Json<NoteBody>) -> Response {
    let id = format!("{section}/{piece}");
    {
        let Ok(library) = state.library.read() else {
            return lock_poisoned();
        };
        if library.piece(&id).is_none() {
            return not_found("no such piece");
        }
    }

    match marks::set_note(&state.pool, &id, &note.body, note.marked_at.as_deref()).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => failed(&error, "the note could not be saved"),
    }
}

/// Every quote the reader has kept.
async fn read_quotes(_: Reader, State(state): State<AppState>) -> Response {
    match marks::quotes(&state.pool).await {
        Ok(quotes) => Json(quotes).into_response(),
        Err(error) => failed(&error, "the quotes could not be read"),
    }
}

/// What the app sends when a line is kept.
#[derive(Deserialize)]
struct NewQuote {
    piece_id: String,
    paragraph: i64,
    text: String,
    comment: Option<String>,
    /// The identity the device minted for this act of keeping. It is the
    /// quote's id: a highlight made away from home is addressable there, and
    /// a delivery retried after a dropped connection lands once (ADR 0003).
    client_id: String,
}

/// Keeps a line.
async fn keep_quote(_: Reader, State(state): State<AppState>, Json(quote): Json<NewQuote>) -> Response {
    {
        let Ok(library) = state.library.read() else {
            return lock_poisoned();
        };
        if library.piece(&quote.piece_id).is_none() {
            return not_found("no such piece");
        }
    }

    match marks::add_quote(
        &state.pool,
        &quote.client_id,
        &quote.piece_id,
        quote.paragraph,
        &quote.text,
        quote.comment.as_deref(),
    )
    .await
    {
        Ok(kept) => (StatusCode::CREATED, Json(kept)).into_response(),
        // A quote with no text is the app sending a mis-tap, not a server
        // failure: saying so as a 400 lets it tell the difference.
        Err(error) => (StatusCode::BAD_REQUEST, Json(json!({ "error": error.to_string() }))).into_response(),
    }
}

/// What the app sends when a comment changes.
#[derive(Deserialize)]
struct CommentBody {
    comment: Option<String>,
}

/// Changes what the reader said about a quote.
async fn edit_quote(_: Reader, State(state): State<AppState>, UrlPath(id): UrlPath<String>, Json(body): Json<CommentBody>) -> Response {
    match marks::comment_on(&state.pool, &id, body.comment.as_deref()).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("no such quote"),
        Err(error) => failed(&error, "the comment could not be saved"),
    }
}

/// Removes a quote.
async fn drop_quote(_: Reader, State(state): State<AppState>, UrlPath(id): UrlPath<String>) -> Response {
    match marks::remove_quote(&state.pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("no such quote"),
        Err(error) => failed(&error, "the quote could not be removed"),
    }
}

/// Everything the reader has left behind, in one document.
#[derive(Serialize)]
struct Export {
    /// When the export was taken, so a vault knows what it is merging.
    exported_at: String,
    version: &'static str,
    reading: Vec<progress::State>,
    notes: Vec<marks::Note>,
    quotes: Vec<marks::Quote>,
}

/// The whole of the reader's side of the library, for the vault to take back.
///
/// One document rather than an endpoint per kind: this is read by a script
/// that writes the result into markdown files, and a consistent snapshot in
/// one request is what makes that safe to run at any moment.
async fn export(_: Reader, State(state): State<AppState>) -> Response {
    let reading = match progress::all(&state.pool).await {
        Ok(reading) => reading,
        Err(error) => return failed(&error, "the reading state could not be read"),
    };
    let notes = match marks::notes(&state.pool).await {
        Ok(notes) => notes,
        Err(error) => return failed(&error, "the notes could not be read"),
    };
    let quotes = match marks::quotes(&state.pool).await {
        Ok(quotes) => quotes,
        Err(error) => return failed(&error, "the quotes could not be read"),
    };

    // Not defaulted away: a vault-merge script keys "as of" on this field, and
    // an empty string would pass every check it makes while meaning nothing.
    let exported_at = match sqlx::query_scalar::<_, String>("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
        .fetch_one(&state.pool)
        .await
    {
        Ok(stamp) => stamp,
        Err(error) => return failed(&anyhow::Error::new(error), "the export could not be timestamped"),
    };

    Json(Export {
        exported_at,
        version: env!("CARGO_PKG_VERSION"),
        reading,
        notes,
        quotes,
    })
    .into_response()
}

/// Anything under `/api` that does not exist is a client's mistake, answered
/// in JSON like every other API failure.
async fn api_not_found() -> Response {
    not_found("no such endpoint")
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, http::Request};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use super::*;

    /// An in-memory database with the schema applied: the real thing, minus
    /// the file.
    async fn pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.expect("an in-memory database");
        sqlx::migrate!().run(&pool).await.expect("migrations should apply");
        pool
    }

    /// A directory laid out the way a built SPA is.
    fn web_root() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("a temporary directory");
        std::fs::write(dir.path().join("index.html"), "<!doctype html><title>rhapsod</title>").unwrap();
        std::fs::create_dir_all(dir.path().join("assets")).unwrap();
        std::fs::write(dir.path().join("assets/app.js"), "console.log('rhapsod')").unwrap();
        dir
    }

    /// A library laid out the way a published one is.
    fn content_root() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("a temporary directory");
        write_piece(dir.path(), "02 — История", "Год без лета", "Июнь 1816 года.");
        dir
    }

    fn write_piece(root: &Path, section: &str, title: &str, text: &str) {
        let dir = root.join(section);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(format!("{title}.md")),
            format!("---\ntopic: {title}\nwritten: 2026-09-01\nwords: 3\n---\n\n# {title}\n\n{text}\n\n## Одной строкой\n\n**«Строка».**\n"),
        )
        .unwrap();
    }

    fn app(web: &tempfile::TempDir, content: &tempfile::TempDir, pool: SqlitePool) -> Router {
        let library = Library::load(content.path()).expect("the library should load");
        // No password: an open stand is how this runs on a home network, and
        // the locked case is exercised where it matters, in the auth tests.
        router(pool, web.path(), library, content.path().to_path_buf(), None)
    }

    async fn get_json(app: Router, uri: &str) -> (StatusCode, serde_json::Value) {
        let response = app.oneshot(Request::get(uri).body(Body::empty()).unwrap()).await.unwrap();
        let status = response.status();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        (status, serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null))
    }

    #[tokio::test]
    async fn health_reports_ok_with_the_version_and_the_library_size() {
        let (web, content) = (web_root(), content_root());
        let (status, body) = get_json(app(&web, &content, pool().await), "/api/health").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["status"], "ok");
        assert_eq!(body["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(body["pieces"], 1, "health should say what library the server is serving");
    }

    #[tokio::test]
    async fn the_whole_index_comes_in_one_request() {
        // The app caches the library for offline reading; a request per
        // section would make that a walk over the network.
        let (web, content) = (web_root(), content_root());
        write_piece(content.path(), "19 — Любовь и пары", "Абеляр и Элоиза", "Париж.");
        let (status, body) = get_json(app(&web, &content, pool().await), "/api/library").await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["sections"].as_array().unwrap().len(), 2);
        assert_eq!(body["pieces"].as_array().unwrap().len(), 2);
        assert_eq!(body["pieces"][0]["id"], "02-istoriya/god-bez-leta");
        assert!(body["pieces"][0].get("paragraphs").is_none(), "a summary carried the text");
    }

    #[tokio::test]
    async fn a_piece_comes_with_its_paragraphs() {
        let (web, content) = (web_root(), content_root());
        let (status, body) = get_json(app(&web, &content, pool().await), "/api/pieces/02-istoriya/god-bez-leta").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["title"], "Год без лета");
        assert_eq!(body["paragraphs"][0], "Июнь 1816 года.");
        assert_eq!(body["one_liner"], "Строка.", "the one-liner is normalised to end in a full stop");
    }

    #[tokio::test]
    async fn a_missing_piece_says_which_thing_is_missing() {
        let (web, content) = (web_root(), content_root());
        let (status, body) = get_json(app(&web, &content, pool().await), "/api/pieces/02-istoriya/nope").await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"], "no such piece");

        let (status, body) = get_json(app(&web, &content, pool().await), "/api/sections/nope").await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"], "no such section", "a missing shelf is not an empty shelf");
    }

    #[tokio::test]
    async fn a_section_lists_only_its_own_pieces() {
        let (web, content) = (web_root(), content_root());
        write_piece(content.path(), "19 — Любовь и пары", "Абеляр и Элоиза", "Париж.");
        let (status, body) = get_json(app(&web, &content, pool().await), "/api/sections/19-lyubov-i-pary").await;
        assert_eq!(status, StatusCode::OK);
        let pieces = body.as_array().unwrap();
        assert_eq!(pieces.len(), 1);
        assert_eq!(pieces[0]["title"], "Абеляр и Элоиза");
    }

    #[tokio::test]
    async fn reindex_picks_up_what_was_just_published() {
        // The publishing script copies files onto the stand and calls this;
        // without it the new pieces would wait for a restart.
        let (web, content) = (web_root(), content_root());
        let app = app(&web, &content, pool().await);

        write_piece(content.path(), "19 — Любовь и пары", "Абеляр и Элоиза", "Париж.");
        let response = app.clone().oneshot(Request::post("/api/reindex").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body: serde_json::Value = serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
        assert_eq!(body["pieces"], 2);

        let (status, body) = get_json(app, "/api/pieces/19-lyubov-i-pary/abelyar-i-eloiza").await;
        assert_eq!(status, StatusCode::OK, "the piece published a moment ago is not being served");
        assert_eq!(body["title"], "Абеляр и Элоиза");
    }

    #[tokio::test]
    async fn an_open_stand_remembers_reading_without_a_sign_in() {
        // A stand with no password has no gate. The first live run showed the
        // opposite: the library answered and every progress call came back
        // "sign in to read", so an open stand could be read but never
        // remembered anything.
        let (web, content) = (web_root(), content_root());
        let app = app(&web, &content, pool().await);

        let (status, _) = get_json(app.clone(), "/api/progress").await;
        assert_eq!(status, StatusCode::OK, "an open stand refused to report progress");

        let response = app
            .clone()
            .oneshot(
                Request::post("/api/progress/02-istoriya/god-bez-leta")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"paragraph":3}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        let (_, body) = get_json(app, "/api/progress").await;
        assert_eq!(body["pieces"][0]["paragraph"], 3, "the position was not kept");
    }

    #[tokio::test]
    async fn a_locked_stand_asks_for_the_password_first() {
        let (web, content) = (web_root(), content_root());
        let library = Library::load(content.path()).unwrap();
        let hash = crate::auth::hash("a good passphrase").unwrap();
        let app = router(pool().await, web.path(), library, content.path().to_path_buf(), Some(hash));

        let (status, body) = get_json(app.clone(), "/api/session").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["open"], false);
        assert_eq!(body["reader"], false);

        let (status, body) = get_json(app.clone(), "/api/progress").await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body["error"], "sign in to read");

        // The wrong password does not open it, and the right one does.
        let response = app
            .clone()
            .oneshot(
                Request::post("/api/session")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"password":"not it"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        let response = app
            .clone()
            .oneshot(
                Request::post("/api/session")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"password":"a good passphrase"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let cookie = response
            .headers()
            .get(axum::http::header::SET_COOKIE)
            .expect("signing in should set a cookie")
            .to_str()
            .unwrap()
            .to_string();

        let token = cookie.split(';').next().unwrap().to_string();
        let response = app
            .oneshot(
                Request::get("/api/progress")
                    .header(axum::http::header::COOKIE, token)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "the session did not let the reader in");
    }

    #[tokio::test]
    async fn a_locked_stand_does_not_hand_out_the_text() {
        // The first live run of a locked stand answered /api/library and every
        // piece in it without a session: the password protected the reading
        // state and gave away the library, which is the wrong way round.
        let (web, content) = (web_root(), content_root());
        let library = Library::load(content.path()).unwrap();
        let hash = crate::auth::hash("a good passphrase").unwrap();
        let app = router(pool().await, web.path(), library, content.path().to_path_buf(), Some(hash));

        for path in [
            "/api/library",
            "/api/sections",
            "/api/sections/02-istoriya",
            "/api/pieces/02-istoriya/god-bez-leta",
        ] {
            let (status, _) = get_json(app.clone(), path).await;
            assert_eq!(status, StatusCode::UNAUTHORIZED, "{path} was readable without signing in");
        }

        // The app has to be able to ask whether it needs a password, and the
        // stand has to be able to say it is alive, without one.
        for path in ["/api/session", "/api/health"] {
            let (status, _) = get_json(app.clone(), path).await;
            assert_eq!(status, StatusCode::OK, "{path} should answer before signing in");
        }
    }

    #[tokio::test]
    async fn what_to_read_next_comes_from_another_shelf() {
        // Reading straight down one shelf turns thirty pieces about paradoxes
        // into a textbook; the format is built for the opposite.
        let (web, content) = (web_root(), content_root());
        write_piece(content.path(), "19 — Любовь и пары", "Абеляр и Элоиза", "Париж.");
        let app = app(&web, &content, pool().await);

        let (status, body) = get_json(app.clone(), "/api/next?after=02-istoriya/god-bez-leta").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["next"]["section"], "19-lyubov-i-pary");

        // With everything else read, the shelf just finished is the answer
        // rather than nothing at all.
        app.clone()
            .oneshot(
                Request::post("/api/progress/19-lyubov-i-pary/abelyar-i-eloiza")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"read":true}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        let (_, body) = get_json(app, "/api/next?after=02-istoriya/god-bez-leta").await;
        assert_eq!(body["next"]["id"], "02-istoriya/god-bez-leta");
    }

    #[tokio::test]
    async fn progress_about_a_piece_that_is_not_there_is_refused() {
        // A stale phone or a typed URL; storing it would leave rows no screen
        // can ever show.
        let (web, content) = (web_root(), content_root());
        let response = app(&web, &content, pool().await)
            .oneshot(
                Request::post("/api/progress/02-istoriya/nope")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"paragraph":1}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    /// Sends a body to an endpoint and returns the status.
    async fn post(app: Router, uri: &str, body: &str) -> (StatusCode, serde_json::Value) {
        let response = app
            .oneshot(
                Request::post(uri)
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (status, serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null))
    }

    #[tokio::test]
    async fn a_note_is_written_read_back_and_cleared() {
        let (web, content) = (web_root(), content_root());
        let app = app(&web, &content, pool().await);

        let (status, _) = post(app.clone(), "/api/notes/02-istoriya/god-bez-leta", r#"{"body":"the letter took a year"}"#).await;
        assert_eq!(status, StatusCode::NO_CONTENT);

        let (_, body) = get_json(app.clone(), "/api/notes").await;
        assert_eq!(body[0]["piece_id"], "02-istoriya/god-bez-leta");
        assert_eq!(body[0]["body"], "the letter took a year");

        // An emptied note is no note: a marker on a piece with nothing written
        // about it would be a lie on the shelf.
        let (status, _) = post(app.clone(), "/api/notes/02-istoriya/god-bez-leta", r#"{"body":"  "}"#).await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let (_, body) = get_json(app, "/api/notes").await;
        assert_eq!(body.as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn a_note_about_a_piece_that_is_not_there_is_refused() {
        let (web, content) = (web_root(), content_root());
        let (status, body) = post(app(&web, &content, pool().await), "/api/notes/02-istoriya/nope", r#"{"body":"x"}"#).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"], "no such piece");
    }

    #[tokio::test]
    async fn a_quote_is_kept_commented_and_removed() {
        let (web, content) = (web_root(), content_root());
        let app = app(&web, &content, pool().await);

        let (status, quote) = post(
            app.clone(),
            "/api/quotes",
            r#"{"client_id":"kept-on-a-train","piece_id":"02-istoriya/god-bez-leta","paragraph":0,"text":"Июнь 1816 года.","comment":null}"#,
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(quote["text"], "Июнь 1816 года.");
        // The id is the one the device minted, not one the server chose: the
        // app addresses a highlight it made offline by the id it already has.
        let id = quote["id"].as_str().expect("a quote has an id");
        assert_eq!(id, "kept-on-a-train");

        let (status, _) = post(app.clone(), &format!("/api/quotes/{id}"), r#"{"comment":"this is the mechanism"}"#).await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let (_, body) = get_json(app.clone(), "/api/quotes").await;
        assert_eq!(body[0]["comment"], "this is the mechanism");

        let response = app
            .clone()
            .oneshot(Request::delete(format!("/api/quotes/{id}")).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        let (_, body) = get_json(app, "/api/quotes").await;
        assert_eq!(body.as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn a_quote_with_no_text_is_a_mistake_not_a_failure() {
        // A selection of nothing is a mis-tap in the app; 400 lets it tell
        // that apart from a server that broke.
        let (web, content) = (web_root(), content_root());
        let (status, _) = post(
            app(&web, &content, pool().await),
            "/api/quotes",
            r#"{"client_id":"a-mis-tap","piece_id":"02-istoriya/god-bez-leta","paragraph":0,"text":"   ","comment":null}"#,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn changing_a_quote_that_is_gone_says_so() {
        // Two devices, one stale list: the app has to learn the quote is gone
        // rather than believe it changed something.
        let (web, content) = (web_root(), content_root());
        let app = app(&web, &content, pool().await);
        let (status, body) = post(app.clone(), "/api/quotes/999", r#"{"comment":"x"}"#).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"], "no such quote");

        let response = app.oneshot(Request::delete("/api/quotes/999").body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn the_export_carries_everything_the_reader_left() {
        // One document, because a script writes it back into markdown files
        // and a snapshot taken in one request is what makes that safe.
        let (web, content) = (web_root(), content_root());
        let app = app(&web, &content, pool().await);

        post(app.clone(), "/api/progress/02-istoriya/god-bez-leta", r#"{"read":true}"#).await;
        post(app.clone(), "/api/notes/02-istoriya/god-bez-leta", r#"{"body":"a note"}"#).await;
        post(
            app.clone(),
            "/api/quotes",
            r#"{"client_id":"a-line-kept","piece_id":"02-istoriya/god-bez-leta","paragraph":0,"text":"a line","comment":"why"}"#,
        )
        .await;

        let (status, body) = get_json(app, "/api/export").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(body["reading"][0]["status"], "read");
        assert_eq!(body["notes"][0]["body"], "a note");
        assert_eq!(body["quotes"][0]["text"], "a line");
        // The field a vault-merge script keys "as of" on: an empty string
        // would pass a naive check while meaning nothing.
        let stamp = body["exported_at"].as_str().expect("the export is timestamped");
        assert!(stamp.ends_with('Z') && stamp.len() >= 20, "not a usable timestamp: {stamp:?}");
    }

    #[tokio::test]
    async fn a_locked_stand_keeps_the_marks_to_itself() {
        // Notes and quotes are the reader's own words about what they read;
        // if the text is behind the password, these are too.
        let (web, content) = (web_root(), content_root());
        let library = Library::load(content.path()).unwrap();
        let hash = crate::auth::hash("a good passphrase").unwrap();
        let app = router(pool().await, web.path(), library, content.path().to_path_buf(), Some(hash));

        for path in ["/api/notes", "/api/quotes", "/api/export"] {
            let (status, _) = get_json(app.clone(), path).await;
            assert_eq!(status, StatusCode::UNAUTHORIZED, "{path} was readable without signing in");
        }
    }

    #[tokio::test]
    async fn an_existing_file_is_served_as_it_is() {
        let (web, content) = (web_root(), content_root());
        let response = app(&web, &content, pool().await)
            .oneshot(Request::get("/assets/app.js").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(&body[..], b"console.log('rhapsod')", "the file came back altered");
    }

    #[tokio::test]
    async fn an_unknown_path_falls_back_to_the_spa() {
        // A deep link into a novella is a client route, not a file: it has to
        // load the app, and with a 200 rather than the 404 the miss produced.
        let (web, content) = (web_root(), content_root());
        let response = app(&web, &content, pool().await)
            .oneshot(Request::get("/read/some-novella").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert!(body.starts_with(b"<!doctype"), "a client route did not get the SPA");
    }

    #[tokio::test]
    async fn an_unknown_api_path_never_gets_the_spa() {
        // A misspelled endpoint has to look like a mistake. Serving the app
        // here would tell a client that a wrong URL worked.
        let (web, content) = (web_root(), content_root());
        let (status, body) = get_json(app(&web, &content, pool().await), "/api/no-such-endpoint").await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"], "no such endpoint");
    }

    #[tokio::test]
    async fn an_unbuilt_spa_says_so() {
        // The directory exists but holds no build: the answer names the fix
        // instead of a blank page or a stack trace.
        let dir = tempfile::tempdir().unwrap();
        let content = content_root();
        let library = Library::load(content.path()).unwrap();
        let response = router(pool().await, dir.path(), library, content.path().to_path_buf(), None)
            .oneshot(Request::get("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert!(
            String::from_utf8_lossy(&body).contains("pnpm build"),
            "the message should say how to build the app"
        );
    }
}
