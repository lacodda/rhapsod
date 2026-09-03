---
title: Getting started
description: Run rhapsod locally - the server over a directory of markdown, the reading app, and this documentation site.
---

rhapsod is one process: a Rust server over a SQLite file, serving a JSON API and a React app. "Getting started" means pointing it at a directory of markdown on your own machine and watching it come back as a library.

## What you need

- **Rust** - at least the version in `rust-version` in `Cargo.toml`. `rustup update stable` is enough.
- **Node LTS with pnpm** - `corepack enable` provides pnpm.
- **Docker** - only to run the image the way the stand does; nothing else needs it.

## The library

The server needs a directory of markdown files to serve. Make one with anything in it:

```sh
mkdir -p content
printf -- '---\ntype: novella\nsection: first\ntopic: beginnings\nwritten: 2026-09-02\nwords: 12\n---\n\nA first piece, so the shelf is not empty.\n' > content/first.md
```

Copy the example environment; `RHAPSOD_CONTENT_DIR` already points at that directory:

```sh
cp .env.example .env
```

## The server

```sh
cargo run -- serve
```

`serve` is also what running the binary with no arguments does, which is what a container image or a service unit expects.

The server binds `0.0.0.0:8084` (override with `RHAPSOD_ADDR`), creates `data/rhapsod.db` if it is not there, applies any pending migrations, and serves `/api/health`:

```sh
curl http://127.0.0.1:8084/api/health
```

```json
{"status":"ok","version":"0.9.3","pieces":1,"indexed_seconds_ago":1450}
```

## The app

```sh
cd web
pnpm install
pnpm dev
```

Vite serves the app on `http://localhost:5173` and proxies `/api` to the server, so the two run as one origin. `pnpm build` writes `web/dist`, which is where the server looks for the app when it serves it itself (`RHAPSOD_WEB_DIR`).

## This site

```sh
cd docs/site
pnpm install
pnpm dev
```

## Next

- [The library](/rhapsod/concepts/the-library/) - how a directory of markdown becomes shelves and pieces.
- [What the reader remembers](/rhapsod/concepts/what-the-reader-remembers/) - the three statuses, the position, the streak.
- [API](/rhapsod/reference/api/) - every endpoint, with real responses.
- [Publishing content](/rhapsod/guides/publishing-content/) - getting a library onto the stand.
- [Running on a Raspberry Pi](/rhapsod/guides/running-on-a-pi/) - the stand.
- [Locking a stand](/rhapsod/guides/locking-a-stand/) - putting a password on the reader.
- [Configuration](/rhapsod/reference/configuration/) - every variable the server reads.
