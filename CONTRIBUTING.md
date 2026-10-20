# Contributing to rhapsod

## Development

Requires Rust (see `rust-version` in `Cargo.toml`) and Node LTS with pnpm.

```sh
mkdir content && cp .env.example .env    # a library to serve; RHAPSOD_CONTENT_DIR points at it
cargo run -- serve                       # the API on :8084; /api/health reports the database

cd web && pnpm install && pnpm dev        # the app on :5173, proxying /api to the server
cd docs/site && pnpm install && pnpm dev  # the documentation site
```

`cargo run -- hash` prints a value for `RHAPSOD_PASSWORD_HASH`, prompting for
the password so it stays out of the shell history.

## The gate

`cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`;
`pnpm lint && pnpm test && pnpm build && pnpm road` in `web/`; `pnpm build` in
`docs/site/`. `pnpm road` drives a real Chromium against a running stand - that
is the one that catches what the unit tests cannot.

CI adds two more. `lyrn check` holds the README, the manifests, the changelog
and the documentation site to one version and one description. The audit
(`.github/workflows/audit.yml`, and
[ADR 0007](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0007-dependabot-is-off.md)
for why it stands in for Dependabot) runs `cargo deny check`, `pnpm audit --prod`
with `node ../tools/check-licenses.mjs` in `web/`, and `pnpm audit` in
`docs/site/`; run the same locally before a release.

## Architecture decisions

Anything that would be asked about again later is written down in
[`docs/adr/`](https://github.com/lacodda/rhapsod/tree/main/docs/adr) as a short
Context / Decision / Consequences note, in the same commit as the change.

## Commits

Conventional Commits, English, no trailers.
