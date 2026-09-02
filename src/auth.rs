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
/// # Errors
///
/// Fails when the database rejects the insert.
pub async fn start(pool: &SqlitePool, token: &str) -> Result<()> {
    sqlx::query("INSERT INTO sessions (token) VALUES (?)")
        .bind(token)
        .execute(pool)
        .await
        .context("failed to store the session")?;
    Ok(())
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
        start(&pool, &token).await.unwrap();
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
        start(&pool, &token).await.unwrap();
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
        start(&pool, &token).await.unwrap();
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
}
