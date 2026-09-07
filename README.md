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

Morning, on the train. You open the library and the first thing on it is the piece you stopped in last night - not a choice, the thing you were already in the middle of. It opens where you stopped, at the paragraph you were on rather than at some pixel that meant something on a different screen.

You finish it, and say so: finishing is a button, because scrolling to the bottom to see how long something is should not quietly mark it read. The shelf counter moves, and underneath the piece is what to read next - from another shelf, because reading straight down one turns thirty pieces about paradoxes into a textbook.

Evening, at home, on the desktop. The same place, the same marks: what the reader remembers lives in one SQLite file on the stand, which is also the file a backup is a copy of. You pick up a piece you left half-read on the phone, and the position does not jump backwards when the phone catches up - it only ever moves forward. Meanwhile a new piece was published to the library directory; the server indexed it, and it is on the shelf, unread, next in line.

A line stops you, and you keep it: drag across the sentence, tap once, and it is yours - with a thought beside it if you have one. At the foot of the piece you write what it left you with. None of that goes into the markdown; it lives beside it, and one command brings all of it back to the vault when you want it there.

Later. The lines worth keeping come back on a schedule - a day, a week, a month - and the whole library rides along on the phone for a train with no signal. The journal says which days you were in it.

## Running it on a Pi

Requires Docker on the Pi. The image is built there, for the Pi's own architecture, and one container is the whole installation.

```sh
git clone https://github.com/lacodda/rhapsod && cd rhapsod
printf 'RHAPSOD_CONTENT=/srv/rhapsod/content\n' > .env    # where the library is published to
docker compose -f docker-compose.prod.yml up -d --build
curl http://pi:8084/api/health
```

```json
{"status":"ok","version":"0.11.0","pieces":2,"indexed_seconds_ago":1450}
```

`pieces` answers the question a deploy actually raises: not whether the server is up, but whether it is serving the library you just published.

A stand set up this way is open - everyone who can reach it is the reader. To put a password on it, add `RHAPSOD_PASSWORD_HASH` from `rhapsod hash` to that same `.env`, single-quoted because a PHC string is full of `$`; see [Locking a stand](https://lacodda.github.io/rhapsod/guides/locking-a-stand/).

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
| `RHAPSOD_PASSWORD_HASH` | no | - | Argon2id hash of the reading password, from `rhapsod hash`. Unset leaves the stand open, which is how a home network usually runs it. Single-quote it: a PHC string contains `$`. |
| `RUST_LOG` | no | `rhapsod=info,tower_http=info` | Log filter, in `tracing-subscriber` `EnvFilter` syntax. |

## Status

**Reading, and remembering where you are.** A directory of markdown files becomes a library you can read on a phone and on a desktop: the server indexes the directory and answers it over the API, and the app renders the shelves, a shelf and a piece, moving between pieces with the arrow keys or the links at the foot of the text.

The reader now keeps your place. A piece is **not opened**, **reading** or **read** - the first needs no storage, being simply the absence of a row. Your position is a paragraph index rather than a scroll offset, so the same number is the same sentence on a phone and on a desktop, and it only ever moves forward, so a stale device syncing cannot send you back up the page. The library screen leads with what you were in the middle of and counts what you have read: pieces, words, and a streak of consecutive days that re-reading an old favourite cannot repair. At the end of a piece it offers an unread one from another shelf.

A stand can be locked. `rhapsod hash` makes the value for `RHAPSOD_PASSWORD_HASH`; without it the stand is open, which is how one reader on a home network usually runs it. Sessions are rows rather than signed tokens, so signing out actually ends one.

**And now it keeps what you make of it.** Drag across a sentence and a bar appears over it - nothing asks you to enter a mode first - and the line is kept, with a comment if you have one. Every piece takes a note in your own words, saved a moment after you stop typing rather than on every keystroke. A kept line is anchored by its **words**, not by an offset into the file: a piece edited in the vault would shift every offset silently, and a highlight that lands on the wrong sentence is worse than one that no longer matches. An emptied note is deleted rather than stored empty, so a note marker never appears on a piece with nothing written about it; and the same line can be kept twice, because two readings can mark the same sentence and the second is not a mistake.

None of it touches the library. The markdown is still read and never written, and `GET /api/export` hands the whole of it back - reading state, notes, quotes, schedules, bookmarks, requests, reactions and typos in one snapshot - for `tools/export-marks.sh` and `tools/export-marks.ps1` to write to a file and a script of yours to fold into the vault. One document rather than one request per kind, because a script writing into a vault needs every kind from the same moment.

**And now it goes where you go.** The app installs to a home screen and carries the whole library with it - every piece, not only the ones you happened to open - so a train with no signal is a place to read rather than a spinner. Everything you do there is written on the device and shown as done at once: a position, a finished piece, a note, a kept line. When the stand is in reach again the changes are delivered in the order you made them, and the header says how many are still waiting. Where two devices disagree, the change made later wins - by the clock of the device that made it, not by which one reached the Pi first.

**And now it brings the library back.** A piece you finish returns three times - a day later, then a week, then a month - as a card carrying its title and the line it wants remembered, never its text. Two answers, neither of them a grade: **I remember** retires the return, **open it** takes you to the piece and keeps its place in the schedule, because rereading something is not the same as having recalled it. Nothing expires: a week away leaves you the backlog, not an empty screen. When nothing is due, the screen says nothing at all.

**And now the library is reachable from inside a piece.** A drawer opens from the edge - by the button or by a swipe - and closes on the same paragraph you left, so looking up what else is on a shelf no longer costs your place. A piece takes one **bookmark** of four kinds (loved, come back, for a song, read again), shown as a dot on every shelf and filterable from the menu.

**And now the reader has a voice.** The author's plan of what could be written is published beside the library, and the reader points at a topic: *this one next*. Asking twice is asking once - a count would turn one reader's list into a poll with one voter - and a request keeps the topic's words as well as its id, because a written topic leaves the plan and an id nobody can read is no use to the author either.

**And now it says how a piece landed.** Two reactions at the foot of a piece: **good** and **struck me**. Not degrees of one scale - the first says the piece works, the second says it did something to you, and that is the thing an author writes for and cannot see from a word count. There is no negative one: a piece that failed already says so twice, by sitting unfinished and by having no reaction at all. Select a misspelt word and the same bar that keeps a line will report it; the report carries **the words**, not just their position, because paragraphs shift whenever a piece is edited and a number would point at something else by the time it is read. Nothing is corrected here - the stand never writes to the library, and the fix is made in the vault.

**And the author can see the reading.** One screen, computed when asked for rather than stored: what is read, started and waiting, how the pieces landed, and - the point of it - **where they were put down**, each with how far in. A piece given up on two paragraphs in and one given up on at the last are the same row in a list and completely different problems. A piece counts as put down only a day after you were last in it; without that gap the screen would open with whatever you are reading right now.

**And now it keeps a journal.** The library screen counts what you have read; the journal says when. Months, each with what was finished, how many words that was, and how many pieces were carried through the review schedule - and below them the openings: which piece was in your hands on which day, with the hour, and a count when you came back to it. A return to something you finished in spring is an opening too, which is the thing one row per piece could never say. Days and months follow **your device's clock**, not the stand's, so a piece finished at eleven at night is not filed under tomorrow. Nothing on it is a goal. A second screen, with nothing to press, says what the stand is running, how much of the library this device holds for the train, and whether anything you did is still waiting to be delivered.

**And now it is tidied for 1.0.** The one thing to press on the stand screen fetches the library again and drops what is no longer in it, so an edit published to the vault reaches the phone now rather than the next time the piece happens to be opened at home. The author's report counts only what is on the shelf, so read, started and waiting add up to the library even when a row outlives its file. Two more checks run before every release: every route the server mounts has a section in the API reference, and nothing about the author's own machine or vault is anywhere in the repository. The tests that guard the incremental export now prove it for every kind by changing one row across the boundary, and a locked stand is checked against every reader endpoint, writes included.

The architecture is recorded in three decisions - [the stack](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0001-stack.md), [content as files](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0002-content-as-files.md) and [offline first](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0003-offline-first.md).

What comes next is 1.0 itself: not a feature, but the proof that the circle from vault to phone and back holds up for a week of real reading, that a stand can be rebuilt from its backup on a clean machine by the guide alone, and that a reader and an author can run it without asking the person who wrote the code. Watch this repository.

## Development

Requires Rust (see `rust-version` in `Cargo.toml`) and Node LTS with pnpm.

```sh
mkdir content && cp .env.example .env    # a library to serve; RHAPSOD_CONTENT_DIR points at it
cargo run -- serve                       # the API on :8084; /api/health reports the database

cd web && pnpm install && pnpm dev        # the app on :5173, proxying /api to the server
cd docs/site && pnpm install && pnpm dev  # the documentation site
```

`cargo run -- hash` prints a value for `RHAPSOD_PASSWORD_HASH`, prompting for the password so it stays out of the shell history.

## Documentation

[lacodda.github.io/rhapsod](https://lacodda.github.io/rhapsod) - getting started, guides, reference, and the architecture decision records.

## License

[MIT](https://github.com/lacodda/rhapsod/blob/main/LICENSE)
