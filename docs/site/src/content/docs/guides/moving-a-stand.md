---
title: Moving a stand to another machine
description: The three things a stand is made of, what to copy, and how to check the move worked before the old machine goes away.
---

A Pi will die eventually, or be replaced by a faster one. This is what to carry across, and how to know it arrived.

## What a stand is made of

Three things, and only one of them is irreplaceable.

| Part | Where it lives | If it is lost |
| --- | --- | --- |
| **The image** | `ghcr.io/lacodda/rhapsod`, pulled by tag | Nothing. Pull it again. |
| **The library** | A directory of markdown on the stand | Nothing. It is a copy; the vault is the original ([ADR 0002](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0002-content-as-files.md)). Publish it again. |
| **The database** | A Docker volume, one SQLite file | **Everything the reader did**: what was read, where they stopped, notes, kept lines, review schedules. |

So a move is really about one file. The rest is a fresh install pointed at it.

## Before you start

Take an export and fold it into the vault, using [the merge ritual](/rhapsod/guides/exporting-marks/). That is not the backup - the database file below is - but it means that if everything else goes wrong, the reader's marks are in the vault, in markdown, readable without any of this software.

## Copy the database

Stop the server first. SQLite in WAL mode keeps recent writes in a sidecar file, and copying a live database can catch it mid-write; a stopped server has checkpointed everything into the one file.

```sh
cd /srv/rhapsod
docker compose stop server
```

The container image has no `sqlite3` in it, and a Pi usually has none either, so the copy is done by a throwaway container with the volume mounted:

```sh
docker run --rm -v rhapsod_data:/data -v "$PWD":/backup alpine \
  cp /data/rhapsod.db /backup/rhapsod-backup.db
```

Check that the file is the size you expect - a database with a few hundred pieces of reading state is tens of kilobytes, not zero - and copy it to the new machine along with `docker-compose.yml` and `.env`.

```sh
ls -la rhapsod-backup.db
scp rhapsod-backup.db docker-compose.yml .env newmachine:/srv/rhapsod/
```

`.env` carries the password hash and the paths, so it moves with the stand. It is not in the repository and should not be.

## Set the new machine up

Create the volume and put the database into it before the first start, so the server opens an existing database rather than migrating an empty one into place:

```sh
cd /srv/rhapsod
docker volume create rhapsod_data
docker run --rm -v rhapsod_data:/data -v "$PWD":/backup alpine \
  cp /backup/rhapsod-backup.db /data/rhapsod.db
```

Publish the library to the new content directory the way you normally publish, then start the stand:

```sh
docker compose pull
docker compose up -d
```

## Check the move before the old machine goes away

Four checks, in this order. Each one can fail while the previous passes.

**The server is running the version you expect, and sees the library:**

```sh
curl http://newmachine:8084/api/health
```

```json
{"status":"ok","version":"0.6.0","pieces":31}
```

A `pieces` of `0` means the content directory is empty or misconfigured - the library did not come across, and publishing again fixes it.

**The reader's state came with it.** This is the check that matters, because it is the part that cannot be recreated:

```sh
curl http://newmachine:8084/api/progress
```

The counters should be the ones the old stand showed. If `read` is `0` on a stand that had read pieces, the database did not arrive: the server created an empty one, and starting over is now the only option unless the old machine still has it.

**The marks are there:**

```sh
curl http://newmachine:8084/api/export | head -c 400
```

**The app loads and can be read on a phone.** Open the stand in a browser and read a piece. A server that answers every API call correctly can still be serving a build with no app in it.

Only when all four pass should the old machine be wiped. Keep the backup file somewhere else regardless - it costs nothing and it is the reader's whole side of the library.

## If the new machine has a different address

The stand's address lives in whatever publishes to it and whatever exports from it, not in the server. Update `RHAPSOD_PUBLISH_URL` where you keep it, and re-run the publishing script once against the new address.

The app on a phone remembers the stand it was installed from. Installing it again from the new address is the whole of the migration on that side; anything queued and undelivered on the old install is lost, so drain it - open the app at home while the old stand is still up - before switching.

## See also

- [Running on a Raspberry Pi](/rhapsod/guides/running-on-a-pi/) - the first install, in full.
- [Taking your marks back to the vault](/rhapsod/guides/exporting-marks/) - the export, and the ritual that folds it into markdown.
- [Publishing content](/rhapsod/guides/publishing-content/) - getting the library onto a stand.
