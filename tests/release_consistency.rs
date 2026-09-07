//! Guards the facts that must agree before a version is published.
//!
//! rhapsod ships to several places - GitHub, the container registry, the docs
//! site - and each renders its own copy of the README or carries its own
//! manifest. Drift is only visible after publishing, when it is too late to
//! take back, so these checks run in CI instead.

use std::fs;
use std::path::{Path, PathBuf};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn read(path: impl AsRef<Path>) -> String {
    let path = repo_root().join(path);
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
}

/// Reads a top-level `key = "value"` from the `[package]` block of Cargo.toml.
///
/// Deliberately naive: it stops at the next section, which is all these checks
/// need, and avoids a TOML parser as a dev-dependency.
fn cargo_field(key: &str) -> String {
    let manifest = read("Cargo.toml");
    for line in manifest.lines() {
        let line = line.trim();
        // `version` also appears under [dependencies] and in every dependency.
        if line.starts_with('[') && line != "[package]" {
            break;
        }
        let Some((name, value)) = line.split_once('=') else { continue };
        // Exact match, so `rust-version` cannot answer a lookup for `version`.
        if name.trim() != key {
            continue;
        }
        return value.trim().trim_matches('"').to_string();
    }
    panic!("`{key}` not found in the [package] block of Cargo.toml");
}

/// Pulls `"version": "x.y.z"` out of a package.json without a JSON dependency:
/// the field is the only thing these checks care about.
fn package_json_version(path: &str) -> String {
    let manifest = read(path);
    let key = "\"version\"";
    let at = manifest.find(key).unwrap_or_else(|| panic!("{path} has no version field"));
    let rest = &manifest[at + key.len()..];
    let open = rest.find('"').unwrap_or_else(|| panic!("{path}: malformed version field"));
    let rest = &rest[open + 1..];
    let close = rest.find('"').unwrap_or_else(|| panic!("{path}: unterminated version string"));
    rest[..close].to_string()
}

#[test]
fn readme_links_resolve_off_github() {
    // The same file is rendered wherever the package lands - the container
    // registry, the docs site - and a relative path has no repository to
    // resolve against there: the banner turns into a broken image and the
    // links 404.
    let readme = read("README.md");

    for (line_no, line) in readme.lines().enumerate() {
        for (marker, kind) in [("src=\"", "image"), ("](", "link")] {
            let mut rest = line;
            while let Some(at) = rest.find(marker) {
                let target = &rest[at + marker.len()..];
                let end = if marker == "](" { ')' } else { '"' };
                let target = &target[..target.find(end).unwrap_or(target.len())];

                let relative = !target.starts_with("http") && !target.starts_with('#') && !target.is_empty();
                assert!(
                    !relative,
                    "README line {}: relative {kind} `{target}` breaks off GitHub; use an absolute URL",
                    line_no + 1
                );

                rest = &rest[at + marker.len()..];
            }
        }
    }
}

#[test]
fn readme_is_not_duplicated() {
    // One README for every storefront. A second copy is where descriptions
    // start to drift; the SPA and the docs site must reuse the root file
    // rather than fork it.
    for candidate in ["web/README.md", "docs/README.md", "docs/site/README.md"] {
        let duplicate = repo_root().join(candidate);
        assert!(
            !duplicate.exists(),
            "{candidate} exists; it will drift from the root README, which is the single source"
        );
    }
}

#[test]
fn every_manifest_carries_the_same_version() {
    // Three manifests, one release. A stale number in web/ or docs/ ships a
    // build that claims a version it is not.
    let crate_version = cargo_field("version");
    assert_eq!(crate_version, env!("CARGO_PKG_VERSION"), "the manifest reader disagrees with cargo");

    for manifest in ["web/package.json", "docs/site/package.json"] {
        assert_eq!(
            package_json_version(manifest),
            crate_version,
            "{manifest} disagrees with Cargo.toml about the version"
        );
    }
}

#[test]
fn the_changelog_covers_the_version_being_shipped() {
    // The tag drives a release, and the release notes are cut from the
    // changelog. A manifest bumped without a changelog entry ships a version
    // nobody can read the changes of.
    let version = cargo_field("version");
    let changelog = read("CHANGELOG.md");
    let heading = format!("## [{version}]");

    assert!(
        changelog.contains(&heading),
        "CHANGELOG.md has no `{heading}` section; run `git-cliff --tag v{version}` before tagging"
    );
}

#[test]
fn the_readme_documents_every_environment_variable() {
    // The configuration table is the only place an operator learns these
    // exist. A variable added to the code and not to the table is invisible
    // until someone reads the source, which is not what a self-hosted product
    // can ask of them.
    //
    // The rule is "read by the server", not "starts with RHAPSOD_", which is
    // why this scans `config.rs` for `lookup(...)` rather than grepping the
    // repository for the prefix. `.env.example` also carries `RHAPSOD_PUBLISH_*`
    // for the scripts in `tools/`; those are never read by any Rust code, they
    // belong in the publishing guide rather than in the server's configuration
    // table, and a check that swept the prefix would demand they be documented
    // as server configuration - which would be a lie.
    let config = read("src/config.rs");
    let readme = read("README.md");
    let example = read(".env.example");

    let mut found = 0;
    for line in config.lines() {
        let Some(start) = line.find("lookup(\"RHAPSOD_") else { continue };
        let rest = &line[start + "lookup(\"".len()..];
        let Some(end) = rest.find('"') else { continue };
        let variable = &rest[..end];
        found += 1;

        assert!(
            readme.contains(variable),
            "{variable} is read by the server but missing from the README's configuration table"
        );
        assert!(example.contains(variable), "{variable} is read by the server but missing from .env.example");
    }
    assert!(found > 0, "no variables were found in src/config.rs; the check is looking in the wrong place");
}

#[test]
fn the_compose_files_name_the_image_this_repository_publishes() {
    // The stand builds from source; the publish workflow pushes an image
    // under the repository's own name. If the two drift, `docker compose
    // pull` on someone else's machine fails while ours keeps working.
    let workflow = read(".github/workflows/publish.yml");
    assert!(
        workflow.contains("ghcr.io/${{ github.repository }}"),
        "the publish workflow must push under the repository's own name"
    );

    let prod = read("docker-compose.prod.yml");
    assert!(prod.contains("build:"), "the stand compose must build from source");
}

/// Captured output in the docs must show the version being shipped.
///
/// The manifests are checked against each other above, but a transcript pasted
/// into a page is a copy of what the server said on the day it was run, and
/// nothing pulls it forward. Three pages and the README were still showing
/// `0.1.1` while the manifests read `0.2.0`, which teaches a reader that the
/// examples are approximate - and once that is true of one number it is true
/// of all of them.
#[test]
fn captured_output_shows_the_version_being_shipped() {
    let version = cargo_field("version");
    let expected = format!("\"version\":\"{version}\"");

    let mut stale = Vec::new();
    let mut pages = vec![repo_root().join("README.md")];
    let docs = repo_root().join("docs/site/src/content/docs");
    let mut stack = vec![docs];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).expect("the docs directory should be readable").flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|extension| extension == "md" || extension == "mdx") {
                pages.push(path);
            }
        }
    }

    for page in pages {
        let text = read(&page);
        // Only the health transcript carries a version; anything else naming
        // one is prose, where a release note about an older version is fine.
        for line in text.lines().filter(|line| line.contains("\"status\":") && line.contains("\"pieces\":")) {
            if !line.contains(&expected) {
                stale.push(format!("{}: {}", page.display(), line.trim()));
            }
        }
    }

    assert!(
        stale.is_empty(),
        "captured output still shows an older version than {version}:\n  {}",
        stale.join("\n  ")
    );
}

/// Every place a colour is written down as a literal.
///
/// The theme is dowel's, where `--bg` is computed from tokens, and a manifest
/// and a `<meta>` tag cannot read CSS. So the installed app's frame colour is
/// spelled out by hand in two files - and a hand-copied colour is exactly the
/// kind of fact that drifts once and is noticed a release later, as a white
/// flash on opening the app on a phone.
const DARK_BACKGROUND: &str = "#181b1a";
const LIGHT_BACKGROUND: &str = "#eef1ed";

#[test]
fn the_installed_app_is_painted_the_colour_the_app_actually_is() {
    let manifest = read("web/public/manifest.webmanifest");
    for field in ["background_color", "theme_color"] {
        let line = manifest
            .lines()
            .find(|line| line.contains(field))
            .unwrap_or_else(|| panic!("the manifest has no {field}"));
        assert!(
            line.contains(DARK_BACKGROUND),
            "the manifest's {field} is not {DARK_BACKGROUND}, so an installed reader opens on the wrong colour: {}",
            line.trim()
        );
    }

    // The two `theme-color` tags, one per scheme. A phone paints the frame
    // around the app with these before a stylesheet has loaded.
    let index = read("web/index.html");
    for colour in [DARK_BACKGROUND, LIGHT_BACKGROUND] {
        assert!(
            index.contains(colour),
            "index.html has no theme-color of {colour}; the frame around the app will not match it"
        );
    }
}

#[test]
fn the_service_worker_takes_the_version_it_is_built_with() {
    // The worker caches the shell under a name carrying the app's version, so
    // that a deploy retires the previous one. The placeholder is substituted
    // at build time (see the plugin in vite.config.ts); if the token is ever
    // renamed on one side only, every release would share one cache and
    // readers would sit on an old build with no way to be updated.
    let worker = read("web/public/sw.js");
    assert!(
        worker.contains("__APP_VERSION__"),
        "sw.js no longer carries the __APP_VERSION__ placeholder the build stamps"
    );
    let config = read("web/vite.config.ts");
    assert!(
        config.contains("__APP_VERSION__") && config.contains("dist/sw.js"),
        "the build no longer stamps a version into dist/sw.js"
    );
}

/// Every route the router mounts has a section in the API reference.
///
/// The rule is "a feature without a doc does not exist", and the way it gets
/// broken is not by leaving a whole endpoint out but by adding a second
/// method to an existing path - a `DELETE` beside a `POST` - and documenting
/// only the first. The router is the source of truth for what exists; the
/// reference has to match it method by method.
#[test]
fn every_endpoint_is_documented() {
    let router = read("src/app.rs");
    let reference = read("docs/site/src/content/docs/reference/api.md");

    let mut missing = Vec::new();
    for line in router.lines() {
        let Some(rest) = line.trim().strip_prefix(".route(\"") else { continue };
        let Some((path, methods)) = rest.split_once("\", ") else { continue };
        for method in ["get", "post", "put", "patch", "delete"] {
            if !methods.contains(&format!("{method}(")) {
                continue;
            }
            let heading = format!("## `{} /api{path}`", method.to_uppercase());
            if !reference.contains(&heading) {
                missing.push(heading);
            }
        }
    }

    assert!(
        missing.is_empty(),
        "routes mounted in src/app.rs with no section in reference/api.md:\n  {}",
        missing.join("\n  ")
    );
}

/// Nothing about where the author lives is in the repository.
///
/// The stand is a Pi on a home network and the library is a folder in a
/// private vault; the repository is public. The address of the one and the
/// layout of the other belong in a local `.env` and nowhere else - and the
/// way they get in is not through the code but through a fixture, a
/// transcript or a comment that was written with the real thing in front of
/// it. Only this file is skipped, because it names the patterns.
#[test]
fn nothing_private_is_in_the_repository() {
    const PRIVATE: &[&str] = &["192.168.", "C:\\Users", "/Users/", "/home/", "Studio/", "obsidian", "Новелл"];
    const SKIPPED_DIRS: &[&str] = &[".git", "target", "node_modules", "dist", "data", "content", "backups"];

    let root = repo_root();
    let own = root.join("tests/release_consistency.rs");
    let mut found = Vec::new();
    let mut stack = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).expect("the repository should be readable").flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                if !SKIPPED_DIRS.contains(&name.as_str()) {
                    stack.push(path);
                }
                continue;
            }
            if path == own {
                continue;
            }
            // `.env` is where the private values are meant to live, and git
            // ignores it; `.env.example` is checked like any other file.
            if name == ".env" || (name.starts_with(".env.") && name != ".env.example") {
                continue;
            }
            // Binary files are skipped by not being text.
            let Ok(text) = fs::read_to_string(&path) else { continue };
            for (number, line) in text.lines().enumerate() {
                if let Some(pattern) = PRIVATE.iter().find(|pattern| line.contains(*pattern)) {
                    found.push(format!("{}:{}: `{pattern}`", path.strip_prefix(&root).unwrap_or(&path).display(), number + 1));
                }
            }
        }
    }

    assert!(
        found.is_empty(),
        "something about the author's own machine or vault is in the repository:\n  {}",
        found.join("\n  ")
    );
}
