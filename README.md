<p align="center"><img src="https://raw.githubusercontent.com/lacodda/rhapsod/main/assets/banner.svg" alt="rhapsod" width="720"></p>

> A self-hosted reader for a markdown library: progress, notes and spaced repetition.

<p align="center">
  <a href="https://github.com/lacodda/rhapsod/actions"><img src="https://img.shields.io/github/actions/workflow/status/lacodda/rhapsod/ci.yml?style=flat-square" alt="CI"></a>
  <a href="https://github.com/lacodda/rhapsod/blob/main/LICENSE"><img src="https://img.shields.io/github/license/lacodda/rhapsod?style=flat-square" alt="License"></a>
</p>

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

## What you get

- **Your place, kept honestly.** A paragraph index rather than a scroll offset,
  so the same number is the same sentence on a phone and on a desktop - and it
  only ever moves forward, so a stale device cannot send you back up the page.
- **Notes and highlights beside the text**, never inside it. A kept line is
  anchored by its words rather than an offset, so editing the piece in your
  vault cannot land a highlight on the wrong sentence.
- **The library comes back.** A piece you finish returns a day later, then a
  week, then a month, carrying the line it wants remembered.
- **It reads on a train.** The app installs to a home screen and carries the
  whole library, not only what you opened; changes made offline are delivered
  in the order you made them once the stand is in reach.
- **The markdown is never written.** The library directory is mounted
  read-only, and `GET /api/export` hands back everything the reader remembers
  in one snapshot, for a script of yours to fold into the vault.
- **No account, no VPN, no third party.** One container on a Pi at home, and
  one SQLite file that a backup is a copy of.

## Install

Docker on a Raspberry Pi, and one container is the whole installation:

```sh
git clone https://github.com/lacodda/rhapsod && cd rhapsod
printf 'RHAPSOD_CONTENT=/srv/rhapsod/content
' > .env    # where the library is published to
docker compose -f docker-compose.prod.yml up -d --build
curl http://pi:8084/api/health
```

```json
{"status":"ok","version":"0.13.2","pieces":2,"indexed_seconds_ago":1450}
```

`pieces` answers the question a deploy actually raises: not whether the server
is up, but whether it is serving the library you just published.

A stand set up this way is open - everyone who can reach it is the reader.
Putting a password on it, publishing content, the environment it reads and the
whole walk-through are on the documentation site:
[Running on a Raspberry Pi](https://lacodda.github.io/rhapsod/guides/running-on-a-pi/).

## Status

v0.13.2, running on a Pi at home and read daily on a phone. Reading and
progress, notes and highlights, the offline app and the spaced return all work
today. What landed in each version:
[CHANGELOG](https://github.com/lacodda/rhapsod/blob/main/CHANGELOG.md).

## Documentation

[lacodda.github.io/rhapsod](https://lacodda.github.io/rhapsod) - getting started, guides, reference, and the architecture decision records.

Building it yourself: [CONTRIBUTING.md](https://github.com/lacodda/rhapsod/blob/main/CONTRIBUTING.md).

## License

MIT (c) [Kirill Lakhtachev](https://lacodda.com)
