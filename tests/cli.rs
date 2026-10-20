//! The binary as a person at a terminal meets it.

use std::process::Command;

/// A `.env` the configuration loader refuses: an unquoted value with a space.
fn beside_a_broken_env() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("a temporary directory");
    std::fs::write(dir.path().join(".env"), "RHAPSOD_PUBLISH_TOPICS=./a plan.md\n").expect("the .env");
    dir
}

#[test]
fn help_answers_beside_a_env_it_cannot_read() {
    let dir = beside_a_broken_env();
    let output = Command::new(env!("CARGO_BIN_EXE_rhapsod"))
        .arg("--help")
        .current_dir(dir.path())
        .output()
        .expect("the binary should start");

    assert!(output.status.success(), "--help failed: {}", String::from_utf8_lossy(&output.stderr));
    let help = String::from_utf8_lossy(&output.stdout);
    assert!(help.contains("Usage:"), "--help printed no usage: {help}");
}

#[test]
fn version_answers_beside_a_env_it_cannot_read() {
    let dir = beside_a_broken_env();
    let output = Command::new(env!("CARGO_BIN_EXE_rhapsod"))
        .arg("--version")
        .current_dir(dir.path())
        .output()
        .expect("the binary should start");

    assert!(output.status.success(), "--version failed: {}", String::from_utf8_lossy(&output.stderr));
    assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), format!("rhapsod {}", env!("CARGO_PKG_VERSION")));
}

#[test]
fn serving_beside_a_env_it_cannot_read_says_so() {
    let dir = beside_a_broken_env();
    let output = Command::new(env!("CARGO_BIN_EXE_rhapsod"))
        .arg("serve")
        .current_dir(dir.path())
        .output()
        .expect("the binary should start");

    // The file is still read, and still refused, wherever configuration is
    // needed: a server that quietly skipped a broken .env would run on
    // settings nobody wrote.
    assert!(!output.status.success(), "serve started beside a broken .env");
    assert!(String::from_utf8_lossy(&output.stderr).contains("failed to read .env"));
}
