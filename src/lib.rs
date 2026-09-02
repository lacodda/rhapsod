//! A self-hosted reader for a markdown library: progress, notes and spaced
//! repetition.
//!
//! The crate is a library so the integration tests can build the router the
//! way `main` does; the binary in `main.rs` is the command line over it.

pub mod app;
pub mod auth;
pub mod backup;
pub mod bookmarks;
pub mod config;
pub mod db;
pub mod library;
pub mod marks;
pub mod progress;
pub mod restore;
pub mod reviews;
