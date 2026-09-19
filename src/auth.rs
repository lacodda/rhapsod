//! Who is asking.
//!
//! One reader, one password, sessions as rows in the database. There are no
//! accounts to manage, so there is no user table: the password is a hash in
//! the environment, and everything else is about keeping a phone logged in
//! for months without asking again.

use anyhow::{Context, Result};
use argon2::password_hash::phc::PasswordHash;
use argon2::{Argon2, PasswordHasher, PasswordVerifier};
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use sqlx::SqlitePool;

use crate::app::AppState;

/// The cookie the session token travels in.
pub const COOKIE: &str = "rhapsod_session";

/// How long a session lives without being used.
///
/// Ninety days: the reader is one person on their own phone, and the cost of
/// being logged out mid-journey is worse than the risk of a stale row in a
/// database on a home network. Every request refreshes it.
pub const SESSION_DAYS: i64 = 90;

/// Hashes a password for `RHAPSOD_PASSWORD_HASH`.
///
/// Argon2id with the crate's defaults, which are the OWASP-recommended
/// parameters. The salt is random per password and travels inside the PHC
/// string, so nothing else has to be stored beside it.
///
/// # Errors
///
/// Fails when the hasher rejects the password.
pub fn hash(password: &str) -> Result<String> {
    Argon2::default()
        .hash_password(password.as_bytes())
        .map(|hash| hash.to_string())
        .map_err(|error| anyhow::anyhow!("failed to hash the password: {error}"))
}

/// Checks a password against the configured hash.
///
/// # Errors
///
/// Fails when the configured hash is not a valid PHC string, which is a
/// deployment error worth naming rather than reading as a wrong password.
pub fn verify(password: &str, hash: &str) -> Result<bool> {
    let parsed = PasswordHash::new(hash).map_err(|error| anyhow::anyhow!("RHAPSOD_PASSWORD_HASH is not a valid Argon2 hash: {error}"))?;
    Ok(Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok())
}

/// A fresh session token: 256 bits from the operating system's generator,
/// hex-encoded so it survives a cookie header unescaped.
#[must_use]
pub fn new_token() -> String {
    use std::fmt::Write as _;

    let bytes: [u8; 32] = rand::random();
    let mut token = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(token, "{byte:02x}");
    }
    token
}

/// Stores a new session and returns its token.
///
/// The device label is worked out here, once, rather than on every request:
/// a browser that updates itself would otherwise rewrite the list under the
/// reader while they are looking at it.
///
/// # Errors
///
/// Fails when the database rejects the insert.
pub async fn start(pool: &SqlitePool, token: &str, device: Option<&str>) -> Result<()> {
    sqlx::query("INSERT INTO sessions (token, device) VALUES (?, ?)")
        .bind(token)
        .bind(device)
        .execute(pool)
        .await
        .context("failed to store the session")?;
    Ok(())
}

/// One session, as the stand screen shows it.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Device {
    /// What kind of thing it is: "Android phone", "Windows desktop".
    pub device: String,
    /// When it signed in.
    pub started: String,
    /// When it was last used.
    pub seen: String,
    /// Whether this is the device doing the asking.
    ///
    /// The one fact the list exists to carry. Everything else answers "what
    /// is signed in"; this answers "which of these must I not sign out",
    /// which is the question a reader actually has in front of the list.
    pub current: bool,
}

/// Every live session, newest first.
///
/// Dead ones are left out by the same rule that refuses them a request, so a
/// session ninety days idle is gone from the list at the moment it is gone
/// from the gate - rather than lingering as a row that says a device is
/// signed in when it is not.
///
/// # Errors
///
/// Fails when the database cannot be read.
pub async fn devices(pool: &SqlitePool, current: Option<&str>) -> Result<Vec<Device>> {
    let rows: Vec<(String, Option<String>, String, String)> = sqlx::query_as(
        "SELECT token, device, created_at, seen_at
           FROM sessions
          WHERE seen_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
          ORDER BY seen_at DESC",
    )
    .bind(format!("-{SESSION_DAYS} days"))
    .fetch_all(pool)
    .await
    .context("failed to read the sessions")?;

    Ok(rows
        .into_iter()
        .map(|(token, device, created, seen)| Device {
            // A session from before devices were recorded knows nothing about
            // itself. "A device" is honest; guessing at a phone is not.
            device: device.unwrap_or_else(|| "a device".to_string()),
            started: created,
            seen,
            current: current.is_some_and(|current| current == token),
        })
        .collect())
}

/// Ends every session, including the one asking.
///
/// Including the one asking on purpose. "All the others" reads as the kinder
/// option and is useless in the case the button exists for: a phone left on a
/// train, the reader at somebody else's machine, where "all but this one"
/// spares exactly the session that has to die.
///
/// # Errors
///
/// Fails when the database rejects the delete.
pub async fn end_everywhere(pool: &SqlitePool) -> Result<u64> {
    let done = sqlx::query("DELETE FROM sessions").execute(pool).await.context("failed to end the sessions")?;
    Ok(done.rows_affected())
}

/// What a user agent says the device is, in words a person would use.
///
/// A dozen substrings rather than a crate: the crates that do this carry
/// tables of megabytes to answer questions far finer than "phone or not", and
/// the whole use of the answer is helping a reader tell three rows apart.
///
/// Order matters. Android carries "Linux" in its user agent and an iPad has
/// carried "Macintosh" since iPadOS 13, so the specific cases are asked
/// before the general ones - which is the sort of thing that looks fine until
/// every phone in the list says "Linux desktop".
#[must_use]
pub fn device_from(agent: Option<&str>) -> Option<String> {
    let agent = agent?;
    if agent.trim().is_empty() {
        return None;
    }
    let lower = agent.to_lowercase();

    let kind = if lower.contains("android") {
        if lower.contains("mobile") { "Android phone" } else { "Android tablet" }
    } else if lower.contains("iphone") {
        "iPhone"
    } else if lower.contains("ipad") {
        "iPad"
    } else if lower.contains("windows") {
        "Windows desktop"
    } else if lower.contains("macintosh") || lower.contains("mac os") {
        "Mac"
    } else if lower.contains("cros") {
        "Chromebook"
    } else if lower.contains("linux") {
        "Linux desktop"
    } else if lower.contains("curl") || lower.contains("wget") || lower.contains("python") {
        // Not a browser at all: an export script, or the author poking at the
        // stand. Saying so beats calling it a desktop.
        "a script"
    } else {
        return None;
    };
    Some(kind.to_string())
}

/// The user agent of a request, if it sent one.
#[must_use]
pub fn agent_of(headers: &axum::http::HeaderMap) -> Option<&str> {
    headers.get(header::USER_AGENT)?.to_str().ok()
}

/// Ends a session.
///
/// # Errors
///
/// Fails when the database rejects the delete.
pub async fn end(pool: &SqlitePool, token: &str) -> Result<()> {
    sqlx::query("DELETE FROM sessions WHERE token = ?")
        .bind(token)
        .execute(pool)
        .await
        .context("failed to end the session")?;
    Ok(())
}

/// Whether a token names a live session, refreshing it if it does.
///
/// # Errors
///
/// Fails when the database cannot be read.
pub async fn is_live(pool: &SqlitePool, token: &str) -> Result<bool> {
    // The lifetime is enforced in the query rather than by a sweep: a session
    // that has not been used in ninety days is dead the moment it is asked
    // about, whether or not anything has cleaned it up.
    let refreshed = sqlx::query(
        "UPDATE sessions
            SET seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE token = ?
            AND seen_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)",
    )
    .bind(token)
    .bind(format!("-{SESSION_DAYS} days"))
    .execute(pool)
    .await
    .context("failed to check the session")?;
    Ok(refreshed.rows_affected() > 0)
}

/// The token in a request's cookies, if there is one.
pub fn token_from(parts: &Parts) -> Option<String> {
    token_from_headers(&parts.headers)
}

/// The token in a cookie header, if there is one.
pub fn token_from_headers(headers: &axum::http::HeaderMap) -> Option<String> {
    let header = headers.get(header::COOKIE)?.to_str().ok()?;
    header.split(';').find_map(|pair| {
        let (name, value) = pair.split_once('=')?;
        (name.trim() == COOKIE).then(|| value.trim().to_string())
    })
}

/// The cookie a session travels in.
///
/// `HttpOnly` because no script needs to read it; `SameSite=Lax` because the
/// app never posts from another origin; not `Secure`, because the stand is
/// reached over plain HTTP on a home network and a `Secure` cookie would
/// simply never be stored.
#[must_use]
pub fn cookie(token: &str) -> String {
    let seconds = SESSION_DAYS * 24 * 60 * 60;
    format!("{COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={seconds}")
}

/// The cookie that clears the session.
#[must_use]
pub fn cleared_cookie() -> String {
    format!("{COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
}

/// A reader who has proved who they are.
///
/// An extractor rather than a middleware so that a handler which needs a
/// reader says so in its own signature, and one that does not cannot forget
/// to check.
pub struct Reader;

impl FromRequestParts<AppState> for Reader {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        // A stand with no password has no gate: everyone who can reach it is
        // the reader. Without this, an open stand answered the library but
        // refused to remember anything about reading it - which is what the
        // first live run showed.
        if state.password_hash.is_none() {
            return Ok(Self);
        }
        let Some(token) = token_from(parts) else {
            return Err(unauthorised());
        };
        match is_live(&state.pool, &token).await {
            Ok(true) => Ok(Self),
            Ok(false) => Err(unauthorised()),
            Err(error) => {
                tracing::error!(%error, "the session could not be checked");
                Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    axum::Json(serde_json::json!({ "error": "the session could not be checked" })),
                )
                    .into_response())
            }
        }
    }
}

fn unauthorised() -> Response {
    (StatusCode::UNAUTHORIZED, axum::Json(serde_json::json!({ "error": "sign in to read" }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hash_of(password: &str) -> String {
        hash(password).expect("a password should hash")
    }

    async fn pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        pool
    }

    #[test]
    fn accepts_the_password_and_nothing_else() {
        let hash = hash_of("a good passphrase");
        assert!(verify("a good passphrase", &hash).unwrap());
        assert!(!verify("a good passphrasf", &hash).unwrap());
        assert!(!verify("", &hash).unwrap());
    }

    #[test]
    fn a_malformed_hash_is_a_deployment_error_not_a_wrong_password() {
        // Reading it as "wrong password" would leave the owner typing the
        // right one forever against a server that cannot check it.
        let error = verify("anything", "not-a-phc-string").unwrap_err();
        assert!(error.to_string().contains("RHAPSOD_PASSWORD_HASH"), "{error:#}");
    }

    #[test]
    fn the_same_password_hashes_differently_every_time() {
        // The salt is per password and lives inside the PHC string; two
        // identical passwords must not produce the same stored value.
        assert_ne!(hash_of("same passphrase"), hash_of("same passphrase"));
    }

    #[test]
    fn tokens_do_not_repeat() {
        let first = new_token();
        assert_eq!(first.len(), 64);
        assert_ne!(first, new_token());
    }

    #[tokio::test]
    async fn a_session_lives_until_it_is_ended() {
        let pool = pool().await;
        let token = new_token();
        start(&pool, &token, None).await.unwrap();
        assert!(is_live(&pool, &token).await.unwrap());

        end(&pool, &token).await.unwrap();
        assert!(!is_live(&pool, &token).await.unwrap(), "signing out did not end the session");
    }

    #[tokio::test]
    async fn an_unknown_token_is_not_a_session() {
        let pool = pool().await;
        assert!(!is_live(&pool, &new_token()).await.unwrap());
    }

    #[tokio::test]
    async fn a_session_unused_for_too_long_is_dead() {
        // The check is in the query, so an old row is dead when it is asked
        // about, whether or not anything swept it up.
        let pool = pool().await;
        let token = new_token();
        start(&pool, &token, None).await.unwrap();
        sqlx::query("UPDATE sessions SET seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-91 days') WHERE token = ?")
            .bind(&token)
            .execute(&pool)
            .await
            .unwrap();
        assert!(!is_live(&pool, &token).await.unwrap());
    }

    #[tokio::test]
    async fn using_a_session_keeps_it_alive() {
        let pool = pool().await;
        let token = new_token();
        start(&pool, &token, None).await.unwrap();
        // Eighty-nine days: still inside the window, and the refresh should
        // push it back to now rather than let it expire two days later.
        sqlx::query("UPDATE sessions SET seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-89 days') WHERE token = ?")
            .bind(&token)
            .execute(&pool)
            .await
            .unwrap();
        assert!(is_live(&pool, &token).await.unwrap());

        let (seen,): (String,) = sqlx::query_as("SELECT seen_at FROM sessions WHERE token = ?")
            .bind(&token)
            .fetch_one(&pool)
            .await
            .unwrap();
        let (now,): (String,) = sqlx::query_as("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')").fetch_one(&pool).await.unwrap();
        assert_eq!(&seen[..10], &now[..10], "the session was not refreshed on use");
    }

    #[test]
    fn reads_the_token_out_of_a_cookie_header() {
        let request = axum::http::Request::builder()
            .header(header::COOKIE, format!("theme=dark; {COOKIE}=abc123; other=1"))
            .body(())
            .unwrap();
        let (parts, ()) = request.into_parts();
        assert_eq!(token_from(&parts).as_deref(), Some("abc123"));
    }

    #[test]
    fn a_request_without_the_cookie_has_no_token() {
        let request = axum::http::Request::builder().header(header::COOKIE, "theme=dark").body(()).unwrap();
        let (parts, ()) = request.into_parts();
        assert!(token_from(&parts).is_none());
    }

    #[test]
    fn the_cookie_is_not_readable_by_scripts_and_outlives_a_journey() {
        let cookie = cookie("abc");
        assert!(cookie.contains("HttpOnly"));
        assert!(cookie.contains("SameSite=Lax"));
        assert!(cookie.contains(&format!("Max-Age={}", SESSION_DAYS * 86_400)));
        // The stand is plain HTTP on a home network; a Secure cookie would
        // never be stored and the reader would never stay signed in.
        assert!(!cookie.contains("Secure"));
    }

    #[test]
    fn a_device_is_named_the_way_a_person_would_name_it() {
        // Order matters and these are the cases that get it wrong: Android
        // carries "Linux" in its user agent, and an iPad has carried
        // "Macintosh" since iPadOS 13. Asked in the wrong order, every phone
        // in the list says "Linux desktop".
        let android = "Mozilla/5.0 (Linux; Android 14; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36";
        assert_eq!(device_from(Some(android)).as_deref(), Some("Android phone"));

        let tablet = "Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
        assert_eq!(device_from(Some(tablet)).as_deref(), Some("Android tablet"));

        let ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 iPad";
        assert_eq!(device_from(Some(ipad)).as_deref(), Some("iPad"));

        let iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
        assert_eq!(device_from(Some(iphone)).as_deref(), Some("iPhone"));

        let windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
        assert_eq!(device_from(Some(windows)).as_deref(), Some("Windows desktop"));

        let mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";
        assert_eq!(device_from(Some(mac)).as_deref(), Some("Mac"));

        let linux = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
        assert_eq!(device_from(Some(linux)).as_deref(), Some("Linux desktop"));

        // Not a browser: an export script, or the author poking at the stand.
        assert_eq!(device_from(Some("curl/8.4.0")).as_deref(), Some("a script"));
    }

    #[test]
    fn an_unrecognised_agent_is_not_guessed_at() {
        // A label that is made up is worse than none: the reader is deciding
        // which row to sign out on the strength of it.
        assert_eq!(device_from(None), None);
        assert_eq!(device_from(Some("")), None);
        assert_eq!(device_from(Some("   ")), None);
        assert_eq!(device_from(Some("something nobody has seen before")), None);
    }

    #[tokio::test]
    async fn the_list_marks_the_device_that_is_asking() {
        // The one fact the list exists to carry: which row must not be signed
        // out. Everything else answers "what is signed in".
        let pool = pool().await;
        let phone = new_token();
        let laptop = new_token();
        start(&pool, &phone, Some("Android phone")).await.unwrap();
        start(&pool, &laptop, Some("Windows desktop")).await.unwrap();

        let list = devices(&pool, Some(&phone)).await.unwrap();
        assert_eq!(list.len(), 2);
        let here = list.iter().find(|row| row.current).expect("one row should be this device");
        assert_eq!(here.device, "Android phone");
        assert_eq!(list.iter().filter(|row| row.current).count(), 1, "more than one row claimed to be this device");
    }

    #[tokio::test]
    async fn a_session_from_before_devices_were_recorded_says_so() {
        // Nothing recorded what it was, and guessing at a phone would be a
        // label the reader acts on.
        let pool = pool().await;
        let token = new_token();
        start(&pool, &token, None).await.unwrap();

        let list = devices(&pool, None).await.unwrap();
        assert_eq!(list[0].device, "a device");
    }

    #[tokio::test]
    async fn a_dead_session_is_not_in_the_list() {
        // A row that is refused at the gate must not be shown as a device
        // that is signed in: the list would be telling the reader that a
        // phone has access when it does not.
        let pool = pool().await;
        let live = new_token();
        let stale = new_token();
        start(&pool, &live, Some("Windows desktop")).await.unwrap();
        start(&pool, &stale, Some("Android phone")).await.unwrap();
        sqlx::query("UPDATE sessions SET seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-91 days') WHERE token = ?")
            .bind(&stale)
            .execute(&pool)
            .await
            .unwrap();

        let list = devices(&pool, None).await.unwrap();
        assert_eq!(list.len(), 1, "a session too old to be used was listed as a signed-in device");
        assert_eq!(list[0].device, "Windows desktop");
        // And the gate agrees: the list and the gate use the same rule.
        assert!(!is_live(&pool, &stale).await.unwrap());
    }

    #[tokio::test]
    async fn signing_out_everywhere_includes_the_device_that_asked() {
        // "All the others" is useless in the case the button exists for: a
        // phone left on a train, the reader at somebody else's machine.
        let pool = pool().await;
        let phone = new_token();
        let laptop = new_token();
        start(&pool, &phone, Some("Android phone")).await.unwrap();
        start(&pool, &laptop, Some("Windows desktop")).await.unwrap();

        assert_eq!(end_everywhere(&pool).await.unwrap(), 2);
        assert!(!is_live(&pool, &phone).await.unwrap(), "the device that asked was spared");
        assert!(!is_live(&pool, &laptop).await.unwrap());
        assert!(devices(&pool, None).await.unwrap().is_empty());
    }

    #[test]
    fn the_agent_is_read_out_of_the_header() {
        let request = axum::http::Request::builder().header(header::USER_AGENT, "curl/8.4.0").body(()).unwrap();
        assert_eq!(device_from(agent_of(request.headers())).as_deref(), Some("a script"));

        let request = axum::http::Request::builder().body(()).unwrap();
        assert!(agent_of(request.headers()).is_none());
    }
}
