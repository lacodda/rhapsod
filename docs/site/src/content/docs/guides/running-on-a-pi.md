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
RHAPSOD_PORT=8084                        # the stand's address
```

## Bringing it up

```sh
docker compose -f docker-compose.prod.yml up -d --build
```

The first build on a Pi takes a while - a Rust release build and a Node build. Later builds reuse the dependency layers and are much shorter.

```sh
curl http://pi:8084/api/health
```

The container's own healthcheck calls the same endpoint, so `docker compose ps` says whether the server has actually reached its database.

## Where the state is

The database is one file in the `data` volume. A backup is a copy of it:

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
