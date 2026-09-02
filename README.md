<p align="center"><img src="https://raw.githubusercontent.com/lacodda/rhapsod/main/assets/banner.svg" alt="rhapsod" width="720"></p>

# rhapsod

[![CI](https://github.com/lacodda/rhapsod/actions/workflows/ci.yml/badge.svg)](https://github.com/lacodda/rhapsod/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/lacodda/rhapsod/blob/main/LICENSE)

> A self-hosted reader for a markdown library: progress, notes and spaced repetition.

You write in markdown - novellas, essays, whatever a vault holds - and publish a directory of those files to a Raspberry Pi at home. **rhapsod** turns that directory into a reading app on your phone: it keeps your place, holds your notes and highlights beside the text, and brings the lines you marked back to you on a schedule, so the library stays read rather than merely finished. It reads offline and syncs when you are home; no VPN, no account, no third party.

<p align="center">
  <img src="https://raw.githubusercontent.com/lacodda/rhapsod/main/assets/screenshot.png" alt="rhapsod - the reading view on a phone" width="720">
</p>

## A day with it

Morning, on the train. The phone has no way to reach the Pi and does not need one: the whole library was cached the last time it did. You open the piece you stopped in last night and it opens where you stopped. A line is worth keeping; you mark it, and write two words in the margin. Both are saved on the phone and queued.

Evening, at home. The phone finds the Pi, drains the queue, and the highlight and the note are in the one SQLite file on the stand that holds everything rhapsod remembers - which is also the file a backup is a copy of. Meanwhile a new piece was published to the library directory; the server indexed it, and it is on the shelf, unread, next in line.

A week later. The line you marked comes back as a card: do you still know it? You do, or you do not, and the schedule adjusts. The text it came from is one tap away.

## Running it on a Pi

Requires Docker on the Pi. The image is built there, for the Pi's own architecture, and one container is the whole installation.

```sh
git clone https://github.com/lacodda/rhapsod && cd rhapsod
printf 'RHAPSOD_CONTENT=/srv/rhapsod/content\n' > .env    # where the library is published to
docker compose -f docker-compose.prod.yml up -d --build
curl http://pi:8084/api/health
```

```json
{"status":"ok","version":"0.1.0"}
```

The library directory is mounted read-only, because the server never edits content ([ADR 0002](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0002-content-as-files.md)). Everything the reader remembers lives in the `data` volume as one file; back it up by copying it ([ADR 0001](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0001-stack.md)). The full walk-through is in [Running on a Raspberry Pi](https://lacodda.github.io/rhapsod/guides/running-on-a-pi/).

## Publishing content

The library is a directory of markdown files, each with a YAML frontmatter block. Put them there by whatever means you publish with - a sync tool, a script, a copy by hand - and the server picks them up.

```markdown
---
type: novella
section: the-first-shelf
topic: beginnings
written: 2026-09-02
words: 1840
---

The text begins here.
```

| Field | Meaning |
| --- | --- |
| `type` | What kind of piece this is. |
| `section` | Where it sits on the shelf: the grouping the reader browses by. |
| `topic` | What it is about. |
| `written` | When it was written; ordering within a section follows it. |
| `words` | Its length, so the shelf can say how long a piece is before it is opened. |

Re-publishing changes what is on the shelf and nothing about your reading of it: progress, notes and review state are keyed to the piece and kept in the database.

## Configuration

Everything comes from the environment; a `.env` file is read first, and `.env.example` shows the shape.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `RHAPSOD_CONTENT_DIR` | yes | - | Directory of markdown files with frontmatter: the library. Read, never written. |
| `RHAPSOD_DATABASE_URL` | no | `sqlite://data/rhapsod.db?mode=rwc` | The SQLite file holding everything the reader remembers. |
| `RHAPSOD_ADDR` | no | `0.0.0.0:8084` | Socket address the HTTP server binds to. |
| `RHAPSOD_WEB_DIR` | no | `web/dist` | Directory holding the built app, served for every path outside `/api`. |
| `RHAPSOD_PASSWORD_HASH` | no | - | Argon2 hash of the reading password, from `rhapsod hash`. Unset leaves the stand open, which is how a home network usually runs it. |
| `RUST_LOG` | no | `rhapsod=info,tower_http=info` | Log filter, in `tracing-subscriber` `EnvFilter` syntax. |

## Status

v0.1, reading: a directory of markdown files becomes a library you can read on a phone and on a desktop. The server indexes the directory and answers it over the API; the app renders the shelves, a shelf and a piece, and moves between pieces with the arrow keys or the links at the foot of the text. The architecture is recorded in three decisions - [the stack](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0001-stack.md), [content as files](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0002-content-as-files.md) and [offline first](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0003-offline-first.md).

What the reader remembers - where you stopped, your notes and highlights, the repetition schedule - is what v0.2 and the releases after it build. Watch this repository.

## Development

Requires Rust (see `rust-version` in `Cargo.toml`) and Node LTS with pnpm.

```sh
mkdir content && cp .env.example .env    # a library to serve; RHAPSOD_CONTENT_DIR points at it
cargo run -- serve                       # the API on :8084; /api/health reports the database

cd web && pnpm install && pnpm dev        # the app on :5173, proxying /api to the server
cd docs/site && pnpm install && pnpm dev  # the documentation site
```

## Documentation

[lacodda.github.io/rhapsod](https://lacodda.github.io/rhapsod) - getting started, guides, reference, and the architecture decision records.

## License

[MIT](https://github.com/lacodda/rhapsod/blob/main/LICENSE)
