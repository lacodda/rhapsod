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
docker compose -f docker-compose.prod.yml up -d --build
```

The first build on a Pi takes a while - a Rust release build and a Node build. Later builds reuse the dependency layers and are much shorter.

```sh
curl http://pi:8084/api/health
```

The container's own healthcheck calls the same endpoint, so `docker compose ps` says whether the server has actually reached its database. `/api/health` stays open on a locked stand, precisely so a monitor can keep asking.

## Where the state is

The database is one file in the `data` volume: where you stopped in each piece, what you have finished, and the sessions of any browser signed in to a locked stand. A backup is a copy of it:

```sh
docker compose -f docker-compose.prod.yml cp server:/data/rhapsod.db ./rhapsod-backup.db
```

Copying while the server runs is safe: the database is in WAL mode. Restoring is copying the file back and restarting the container.

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
