---
title: Running on a Raspberry Pi
description: The stand - one container built on the Pi, the library mounted read-only, the database in a volume, port 8084.
---

The stand is a Raspberry Pi 4 running Docker. The image is built on the Pi itself, which keeps the architecture honest: no cross-compilation and no chance of an x86 binary that only fails there.

## What goes on the Pi

Three things, and only the first is part of this repository:

- **The source tree**, staged from a committed state by `tools/stage-deploy.sh` and uploaded. `git archive` is the filter, so a file that was never committed cannot reach the stand.
- **The library**: a directory of markdown files, published from wherever they are written. The server never writes to it, and the compose file mounts it read-only.
- **A `.env` file** next to the compose file, never committed:

```sh
RHAPSOD_CONTENT=/srv/rhapsod/content   # the published library
RHAPSOD_PORT=8084                      # the stand's address
```

That is enough to run. A stand set up this way is **open**: everyone who can reach it on the network is the reader, which is how one reader at home usually runs it.

It is also served over plain HTTP, which is enough to read at home and not enough to read on a train: browsers keep an offline copy for secure pages only. Putting a proxy with a certificate in front of it is a separate job and its own guide - [Behind a door](/rhapsod/guides/behind-a-door/). The stand screen says which of the two you have.

To lock it, add the hash of a password to the same file - single-quoted, because a PHC string is full of `$`:

```sh
RHAPSOD_PASSWORD_HASH='$argon2id$v=19$m=19456,t=2,p=1$wVUyLxTmlnEWzGSHbJINbg$sdR7z5K3zoywehEIBHEqAXDsZILU908I9bQLGkCRYgg'
```

Generate one with `rhapsod hash`. It needs nothing else - no library, no database - so the image on the stand can do it:

```sh
docker compose -f docker-compose.prod.yml run --rm server rhapsod hash
```

That prompts for the password, so it stays out of the shell history.

Compose expands `$VAR` in an unquoted value, and a PHC string is full of `$`. Unquoted, the hash reaches the container as `=19=19456,t=2,p=1` and the right password is rejected forever; single-quoted, it arrives whole.

The variable is read once at startup, so adding it takes a `docker compose up -d`. See [Locking a stand](/rhapsod/guides/locking-a-stand/).

## Bringing it up

```sh
docker compose -f docker-compose.prod.yml up -d
```

That pulls the image the release built, for this Pi's architecture, and starts it. Nothing is compiled here: a Pi recompiling Rust for every version is half an hour of every release, and the binary it produced was not the one the pipeline went green on.

To pin a version rather than follow `latest`, put it in `.env` - which is what [`tools/stand/update.sh`](/rhapsod/guides/moving-a-stand/#moving-to-a-new-version) does:

```sh
RHAPSOD_VERSION=0.14.1
```

```sh
curl http://pi:8084/api/health
```

The container's own healthcheck calls the same endpoint, so `docker compose ps` says whether the server has actually reached its database. `/api/health` stays open on a locked stand, precisely so a monitor can keep asking.

## Where the state is

The database is one file in the `data` volume: where you stopped in each piece, what you have finished, and the sessions of any browser signed in to a locked stand. It is the only part of a stand that exists nowhere else.

The server copies it once a day into `backups/` beside it, opens the copy to check it, and keeps a fortnight. [`tools/stand/backup.sh`](/rhapsod/guides/moving-a-stand/#backups) brings the newest of those onto another machine, because a copy on the same card as the original does not survive the card.

To take one by hand, stop the server first:

```sh
docker compose -f docker-compose.prod.yml stop server
docker compose -f docker-compose.prod.yml cp server:/data/rhapsod.db ./rhapsod-backup.db
docker compose -f docker-compose.prod.yml up -d
```

The stop matters. In WAL mode recent writes live in a sidecar file, so copying `rhapsod.db` from underneath a running server can catch it mid-write and produce a file that opens and is missing the last thing the reader did. A stopped server has checkpointed everything into the one file. (The daily copy needs no stop because it is written with `VACUUM INTO`, which is SQLite's own way of taking a consistent snapshot of a live database.)

Whatever the copy, open it before trusting it - `backup.sh` does this for you:

```sh
sqlite3 rhapsod-backup.db 'PRAGMA integrity_check;'
```

## Asking how the stand is

```sh
docker compose -f docker-compose.prod.yml exec server rhapsod doctor
```

The library, the database, the backups, the app and the door in one answer, against the configuration the server is actually running on. See [Commands](/rhapsod/reference/cli/#rhapsod-doctor).

## Updating the library

Publish the new files into the directory `RHAPSOD_CONTENT` points at, then ask the server to read it again:

```sh
curl -X POST http://pi:8084/api/reindex
```

```json
{"pieces":2,"sections":2}
```

The index lives in memory, so the reindex is what turns new files into a library; without it they would wait for a restart. `tools/publish-content.sh` and `tools/publish-content.ps1` do the copy and this call in one step - see [Publishing content](/rhapsod/guides/publishing-content/).

Nothing about your reading is lost, because none of it lives in that directory ([ADR 0002](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0002-content-as-files.md)).
