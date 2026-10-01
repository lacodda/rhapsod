---
title: Running on a Raspberry Pi
description: The stand - the released image, the library mounted read-only, the database in a volume, port 8084.
---

The stand is a Raspberry Pi running Docker. It runs the image the release built for its architecture; nothing is compiled on the Pi. A Pi recompiling Rust for every version is half an hour of every release, and the binary it produced would not be the one the pipeline went green on.

## What it needs

On the Pi:

- **A 64-bit system.** Images are published for `arm64` and `amd64`; a 32-bit Raspberry Pi OS cannot run them.
- **Docker Engine with the compose plugin.** `docker compose version` answers. Docker's own script installs both: `curl -fsSL https://get.docker.com | sh`.
- **An ssh user in the `docker` group,** reachable with a key. Every script in this repository drives the stand as `ssh <host> docker ...`, without `sudo` and without a password prompt: `sudo usermod -aG docker $USER`, then log in again.

On the machine you write and publish from, a key and a name for the Pi. Make the key once with `ssh-keygen -t ed25519`, put its public half on the Pi, and give the Pi a short name in `~/.ssh/config` - this guide calls it `pi`, and it is what `RHAPSOD_STAND_HOST` and `RHAPSOD_PUBLISH_HOST` name:

```
Host pi
    HostName 192.0.2.10
    User pi
```

```sh
ssh-copy-id pi                                                        # Linux, macOS
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh pi "cat >> ~/.ssh/authorized_keys"   # Windows
```

`ssh pi true` answering without a prompt is the test.

Also on that machine:

- **A clone of this repository,** not a downloaded archive. The scripts take the compose file of a release from its tag, so they need the tags: `git fetch --tags`.
- **`ssh` and `scp`.** Windows has both; `rsync` is used when it is there.
- **`sqlite3`,** for checking backups (`winget install SQLite.SQLite`, `apt install sqlite3`).

## The stand's directory

A stand is one directory on the Pi. It belongs to the ssh user, because publishing and the scripts write into it as that user:

```sh
sudo install -d -o "$USER" /srv/rhapsod
```

Three things live in it:

| | What | Where it comes from |
| --- | --- | --- |
| `docker-compose.yml` | How the stand runs: the image, the port, the volume. | `docker-compose.prod.yml` of the release being run. |
| `.env` | The stand's own settings, never committed. | Written once, by hand or by `restore`. |
| `content/` | The library, a published copy of your markdown. | `tools/publish-content.*` |

The database is not in the directory. It lives in a Docker volume named after it - `rhapsod_data` for `/srv/rhapsod` - and is reached through the service, never by path.

Every command on the stand is run in this directory, as a plain `docker compose`: the compose file is installed as `docker-compose.yml`, so none of them needs `-f`.

## Bringing it up

```sh
cd /srv/rhapsod && mkdir content
curl -fsSLo docker-compose.yml https://raw.githubusercontent.com/lacodda/rhapsod/v0.15.1/docker-compose.prod.yml
```

Make `content/` yourself, before the first start. A directory Docker has to create for a mount is created by root, and publishing into it as your user would then be refused.

The `.env` beside it:

```sh
RHAPSOD_CONTENT=/srv/rhapsod/content   # the library, as a path on the Pi
RHAPSOD_VERSION=0.15.1                 # the released version to run
RHAPSOD_PORT=8084                      # the stand's address; the default
```

`RHAPSOD_CONTENT` is a path on the Pi, which compose mounts into the container as `/content`. It is not the server's `RHAPSOD_CONTENT_DIR`, which the image already sets to that `/content`.

```sh
docker compose up -d --wait
curl http://localhost:8084/api/health
```

```json
{"status":"ok","version":"0.15.1","pieces":0,"indexed_seconds_ago":3}
```

`pieces` is `0` until the first publish. The container's healthcheck calls the same endpoint, so `docker compose ps` says whether the server has actually reached its database. `/api/health` stays open on a locked stand, precisely so a monitor can keep asking.

`RHAPSOD_VERSION` pins the image. Without it the stand follows `latest` and changes version whenever a release goes out. [`tools/stand/update.*`](/rhapsod/guides/moving-a-stand/#moving-to-a-new-version) rewrites this line, and the compose file with it, when you move to a new version.

## Open, or locked

A stand set up this way is **open**: everyone who can reach it on the network is the reader, which is how one reader at home usually runs it.

It is also served over plain HTTP, which is enough to read at home and not enough to read on a train: browsers keep an offline copy for secure pages only. Putting a proxy with a certificate in front of it is a separate job and its own guide - [Behind a door](/rhapsod/guides/behind-a-door/). The stand screen says which of the two you have.

To lock it, put the hash of a password in `.env`, single-quoted because a PHC string is full of `$`. The image on the stand makes one; it prompts, so the password stays out of the shell history:

```sh
docker compose run --rm server rhapsod hash
```

```sh
RHAPSOD_PASSWORD_HASH='$argon2id$v=19$m=19456,t=2,p=1$wVUyLxTmlnEWzGSHbJINbg$sdR7z5K3zoywehEIBHEqAXDsZILU908I9bQLGkCRYgg'
```

The server reads it once at startup, so it takes a `docker compose up -d`. Unquoted, the hash reaches the container as `=19=19456,t=2,p=1` and the right password is rejected forever. See [Locking a stand](/rhapsod/guides/locking-a-stand/).

## Where the state is

The database is one file in the volume: where you stopped in each piece, what you have finished, your notes and kept lines, and the sessions of any browser signed in to a locked stand. It is the only part of a stand that exists nowhere else.

The server copies it once a day into `backups/` beside it, opens the copy to check it, and keeps a fortnight. [`tools/stand/backup.*`](/rhapsod/guides/moving-a-stand/#backups) brings the newest of those onto another machine, together with the stand's `.env`, because a copy on the same card as the original does not survive the card.

To take one by hand, stop the server first:

```sh
docker compose stop server
docker compose cp server:/data/rhapsod.db ./rhapsod-backup.db
docker compose up -d
```

The stop matters. In WAL mode recent writes live in a sidecar file until the database is closed; a server that is stopped closes it, and the one file is then whole. Copying `rhapsod.db` from underneath a running server can produce a file that opens and is missing the last thing the reader did. (The daily copy needs no stop because it is written with `VACUUM INTO`, SQLite's own way of taking a consistent snapshot of a live database.)

Whatever the copy, open it before trusting it - `backup` does this for you:

```sh
sqlite3 rhapsod-backup.db 'PRAGMA integrity_check;'
```

## Asking how the stand is

```sh
docker compose exec server rhapsod doctor
```

The library, the database, the backups, the app and the door in one answer, against the configuration the server is actually running on. See [Commands](/rhapsod/reference/cli/#rhapsod-doctor).

## Updating the library

Publish the new files into `content/`, then ask the server to read it again:

```sh
curl -X POST http://localhost:8084/api/reindex
```

```json
{"pieces":2,"sections":2}
```

The index lives in memory, so the reindex is what turns new files into a library; without it they would wait for a restart. `tools/publish-content.sh` and `tools/publish-content.ps1` do the copy and this call in one step from the machine you write on - see [Publishing content](/rhapsod/guides/publishing-content/).

Nothing about your reading is lost, because none of it lives in that directory ([ADR 0002](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0002-content-as-files.md)).
