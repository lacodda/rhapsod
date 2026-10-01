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

The server needs a directory of markdown files to serve, and a piece has to sit inside a shelf: a subdirectory of the library. A markdown file placed directly in the top-level directory is not indexed. Make one shelf with one piece in it:

```sh
mkdir -p "content/01 — Paradoxes"
printf -- '---
type: novella
section: 01 — Paradoxes
topic: Beginnings
written: 2026-09-02
words: 12
---

A first piece, so the shelf is not empty.
' > "content/01 — Paradoxes/first.md"
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

The server binds the address in `RHAPSOD_ADDR`. Without the variable that is `0.0.0.0:8084`, every interface; the `.env.example` you just copied sets `127.0.0.1:8084`, so this machine only, which is what you want while developing. Delete that line to be reachable from other machines. It creates `data/rhapsod.db` if it is not there, applies any pending migrations, and serves `/api/health`:

```sh
curl http://127.0.0.1:8084/api/health
```

```json
{"status":"ok","version":"0.15.1","pieces":1,"indexed_seconds_ago":2}
```

`pieces` is 1 because the library holds one shelf with one piece. `indexed_seconds_ago` is small because the server indexed the directory a moment ago, when it started.

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
- [Taking your marks back to the vault](/rhapsod/guides/exporting-marks/) - the export, and what a script does with it.
- [Moving a stand](/rhapsod/guides/moving-a-stand/) - the backup, and restoring it on another machine.
- [Configuration](/rhapsod/reference/configuration/) - every variable the server reads.
