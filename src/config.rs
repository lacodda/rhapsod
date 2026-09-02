//! Runtime configuration, read from the environment and nothing else.

use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::{Context, Result};

/// Default bind address when `RHAPSOD_ADDR` is not set.
const DEFAULT_ADDR: &str = "0.0.0.0:8084";

/// Default database when `RHAPSOD_DATABASE_URL` is not set. `mode=rwc`
/// creates the file on first start; the directory is created by `db::connect`.
const DEFAULT_DATABASE_URL: &str = "sqlite://data/rhapsod.db?mode=rwc";

/// Default SPA directory when `RHAPSOD_WEB_DIR` is not set: what `pnpm build`
/// in `web/` produces, relative to the working directory.
const DEFAULT_WEB_DIR: &str = "web/dist";

/// Runtime configuration, read from the environment.
#[derive(Debug, Clone)]
pub struct Config {
    /// Address the HTTP server binds to (`RHAPSOD_ADDR`).
    pub addr: SocketAddr,
    /// Directory of markdown files with frontmatter: the library
    /// (`RHAPSOD_CONTENT_DIR`). The server reads it and never writes to it.
    pub content_dir: PathBuf,
    /// `SQLite` connection string (`RHAPSOD_DATABASE_URL`): everything the
    /// reader remembers lives in this one file.
    pub database_url: String,
    /// Directory holding the built SPA (`RHAPSOD_WEB_DIR`).
    pub web_dir: PathBuf,
    /// Argon2 hash of the reading password (`RHAPSOD_PASSWORD_HASH`).
    ///
    /// Absent means the stand is open: on a home network with one reader that
    /// is a reasonable way to run, and demanding a password before there is
    /// anything to protect would only teach the owner to set an empty one.
    pub password_hash: Option<String>,
}

impl Config {
    /// Reads the configuration from the process environment.
    ///
    /// # Errors
    ///
    /// Fails when `RHAPSOD_CONTENT_DIR` is missing or `RHAPSOD_ADDR` is not a
    /// socket address; the message names the variable.
    pub fn from_env() -> Result<Self> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// The environment is passed in as a lookup so tests can supply their own.
    fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self> {
        let addr = lookup("RHAPSOD_ADDR").unwrap_or_else(|| DEFAULT_ADDR.to_string());
        let addr = addr.parse().with_context(|| format!("RHAPSOD_ADDR is not a valid socket address: {addr}"))?;
        let content_dir = lookup("RHAPSOD_CONTENT_DIR")
            .filter(|path| !path.trim().is_empty())
            .map(PathBuf::from)
            .context("RHAPSOD_CONTENT_DIR is not set: point it at the directory of markdown files to serve")?;
        let database_url = lookup("RHAPSOD_DATABASE_URL")
            .filter(|url| !url.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_DATABASE_URL.to_string());
        let web_dir = lookup("RHAPSOD_WEB_DIR")
            .filter(|path| !path.trim().is_empty())
            .map_or_else(|| PathBuf::from(DEFAULT_WEB_DIR), PathBuf::from);
        let password_hash = lookup("RHAPSOD_PASSWORD_HASH").filter(|hash| !hash.trim().is_empty());
        Ok(Self {
            addr,
            content_dir,
            database_url,
            web_dir,
            password_hash,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |key| pairs.iter().find(|(k, _)| *k == key).map(|(_, v)| (*v).to_string())
    }

    const CONTENT: (&str, &str) = ("RHAPSOD_CONTENT_DIR", "/srv/library");

    #[test]
    fn defaults_everything_but_the_library() {
        let config = Config::from_lookup(env(&[CONTENT])).expect("config should build with only the content directory set");
        assert_eq!(config.addr, DEFAULT_ADDR.parse().unwrap());
        assert_eq!(config.database_url, DEFAULT_DATABASE_URL);
        assert_eq!(config.web_dir, PathBuf::from(DEFAULT_WEB_DIR));
        assert_eq!(config.content_dir, PathBuf::from("/srv/library"));
    }

    #[test]
    fn requires_the_content_directory() {
        // The library is the product; a server without one has nothing to
        // serve and should say so at startup rather than answer empty pages.
        let error = Config::from_lookup(env(&[])).unwrap_err();
        assert!(error.to_string().contains("RHAPSOD_CONTENT_DIR"));

        let error = Config::from_lookup(env(&[("RHAPSOD_CONTENT_DIR", "  ")])).unwrap_err();
        assert!(error.to_string().contains("RHAPSOD_CONTENT_DIR"), "a blank value is not a directory");
    }

    #[test]
    fn reads_the_overrides() {
        let config = Config::from_lookup(env(&[
            CONTENT,
            ("RHAPSOD_ADDR", "127.0.0.1:9090"),
            ("RHAPSOD_DATABASE_URL", "sqlite:///data/reader.db?mode=rwc"),
            ("RHAPSOD_WEB_DIR", "/app/web"),
        ]))
        .expect("config should accept valid overrides");
        assert_eq!(config.addr, "127.0.0.1:9090".parse().unwrap());
        assert_eq!(config.database_url, "sqlite:///data/reader.db?mode=rwc");
        assert_eq!(config.web_dir, PathBuf::from("/app/web"));
    }

    #[test]
    fn treats_blank_optionals_as_unset() {
        // A compose file that leaves a variable empty means "the default",
        // not "a database with no name" or "serve the working directory".
        let config = Config::from_lookup(env(&[CONTENT, ("RHAPSOD_DATABASE_URL", ""), ("RHAPSOD_WEB_DIR", " ")])).unwrap();
        assert_eq!(config.database_url, DEFAULT_DATABASE_URL);
        assert_eq!(config.web_dir, PathBuf::from(DEFAULT_WEB_DIR));
    }

    #[test]
    fn a_stand_without_a_password_is_open() {
        // One reader on a home network: making a password mandatory before
        // there is anything to protect only teaches the owner to set a blank
        // one.
        let config = Config::from_lookup(env(&[CONTENT])).unwrap();
        assert!(config.password_hash.is_none());

        let config = Config::from_lookup(env(&[CONTENT, ("RHAPSOD_PASSWORD_HASH", "  ")])).unwrap();
        assert!(config.password_hash.is_none(), "a blank hash is not a password");
    }

    #[test]
    fn rejects_a_malformed_bind_address() {
        let error = Config::from_lookup(env(&[CONTENT, ("RHAPSOD_ADDR", "not-an-address")])).unwrap_err();
        assert!(error.to_string().contains("RHAPSOD_ADDR"));
    }
}
