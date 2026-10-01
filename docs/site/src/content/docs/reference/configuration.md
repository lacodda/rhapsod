---
title: Configuration
description: Environment variables the server reads, their defaults, and what happens when they are wrong.
---

rhapsod is configured entirely through the environment. There is no configuration file to drift from the deployment.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `RHAPSOD_CONTENT_DIR` | yes | - | Directory of markdown files with frontmatter: the library. Read, never written. |
| `RHAPSOD_DATABASE_URL` | no | `sqlite://data/rhapsod.db?mode=rwc` | The SQLite file holding everything the reader remembers. `mode=rwc` creates it; the server creates the directory. |
| `RHAPSOD_ADDR` | no | `0.0.0.0:8084` | Socket address the HTTP server binds to. |
| `RHAPSOD_WEB_DIR` | no | `web/dist` | Directory holding the built app, served for every path outside `/api`. |
| `RHAPSOD_PASSWORD_HASH` | no | - | Argon2id hash of the reading password, from `rhapsod hash`. Unset leaves the stand open. |
| `RHAPSOD_HOST_ADDR` | no | - | Where the host publishes the server, when the port is mapped (`127.0.0.1:8084`). Only `rhapsod doctor` reads it, to say who can reach the stand; the stand's compose file sets it. |
| `RUST_LOG` | no | `rhapsod=info,tower_http=info` | Log filter, in `tracing-subscriber` `EnvFilter` syntax. |

A `.env` file in the working directory is read first, so all of these can live there during development. The file is never committed; `.env.example` shows the shape.

## What the server does not read

Two more sets of `RHAPSOD_*` variables look like server configuration and are not. One lives on the stand and is read by its compose file; the other lives on the machine you write and publish from and is read by the scripts in `tools/`.

### The stand's `.env`

Beside `docker-compose.yml` in the stand's directory on the Pi ([Running on a Raspberry Pi](/rhapsod/guides/running-on-a-pi/)). Compose reads these and turns them into the container's mounts, port and environment.

| Variable | Default | Purpose |
| --- | --- | --- |
| `RHAPSOD_CONTENT` | - (required) | The library, as a path on the host. Mounted read-only as `/content`, which is the image's `RHAPSOD_CONTENT_DIR`. |
| `RHAPSOD_VERSION` | `latest` | The released image to run. `tools/stand/update.*` writes it. |
| `RHAPSOD_PORT` | `8084` | The host port the stand answers on. |
| `RHAPSOD_BIND` | `0.0.0.0` | The host address that port is bound to; `127.0.0.1` behind a proxy on the same machine. Passed to the server as `RHAPSOD_HOST_ADDR` together with the port. |
| `RHAPSOD_PASSWORD_HASH` | - | Passed through to the server as above. |

`tools/stand/backup.*` brings a copy of this file to your machine as `rhapsod-stand.env`, and `restore.*` sends it back: it holds the lock, and a stand restored without it comes back open.

### The tools' `.env`

Beside your clone of the repository. The server never looks at these.

| Variable | Read by | Purpose |
| --- | --- | --- |
| `RHAPSOD_PUBLISH_SRC` | `publish-content.*` | The local library directory to publish. |
| `RHAPSOD_PUBLISH_HOST` | `publish-content.*` | The ssh host to publish to. |
| `RHAPSOD_PUBLISH_DEST` | `publish-content.*` | The directory on that host to publish into: the stand's `RHAPSOD_CONTENT`. |
| `RHAPSOD_PUBLISH_TOPICS` | `publish-content.*` | Optional: a plan of topics, published beside the library as `topics.md`. |
| `RHAPSOD_PUBLISH_URL` | `publish-content.*`, `export-marks.*` | Base URL of the stand: reindexed after a publish, asked for the export. |
| `RHAPSOD_EXPORT_TO` | `export-marks.*` | Where to write the export document. Defaults to `./rhapsod-export.json`. |
| `RHAPSOD_PASSWORD` | `export-marks.*` | The reading password, in plain text, for exporting from a locked stand. |
| `RHAPSOD_STAND_HOST` | `tools/stand/*` | The ssh host the stand runs on. |
| `RHAPSOD_STAND_DIR` | `tools/stand/*` | The stand's directory on that host. |
| `RHAPSOD_BACKUP_TO` | `backup.*` | Where copies land here. Defaults to `./backups`, which git ignores. |
| `RHAPSOD_BACKUP_KEEP` | `backup.*` | How many copies to keep here. Defaults to 14. |
| `RHAPSOD_YES` | `restore.*` | `1` answers the scripts' questions, for a run nobody is watching. |

They are documented with the tools that use them, in [Publishing content](/rhapsod/guides/publishing-content/), [Taking your marks back to the vault](/rhapsod/guides/exporting-marks/) and [Moving a stand](/rhapsod/guides/moving-a-stand/).

`RHAPSOD_PASSWORD` is worth telling apart from `RHAPSOD_PASSWORD_HASH`. The hash is what the server reads to decide whether a password is right; this is the password itself, sent to `POST /api/session`. The hash belongs on the stand, the password on the machine that exports from it, and a stand that read the plaintext would be storing the answer next to the lock.

On a development machine the server's variables and the tools' share one `.env`, because the machine is often both the thing running the server and the thing publishing to a stand.

## How it is read

The server reads the environment once at startup and fails immediately if it cannot build a valid configuration:

- **`RHAPSOD_CONTENT_DIR` missing or blank** - startup aborts naming the variable.
- **`RHAPSOD_CONTENT_DIR` not a directory** - startup aborts showing the path it was given.
- **`RHAPSOD_ADDR` malformed** - startup aborts echoing the value it could not parse.
- **`RHAPSOD_DATABASE_URL` not a SQLite URL** - startup aborts naming the variable.

A blank value for an optional variable means the default: a compose file that leaves `RHAPSOD_WEB_DIR=` empty does not make the server serve its working directory.

`RHAPSOD_PASSWORD_HASH` is the exception to failing at startup. It is not parsed until someone tries to sign in, because a hash the server cannot read is only discovered by using it; that attempt answers `500` with `{"error":"the stand's password is misconfigured"}` and logs the variable's name, rather than being read as a wrong password.

Failing at startup is deliberate. A server that boots with a broken configuration and only discovers it on the first request has turned a deployment error into an outage.

## The password

`RHAPSOD_PASSWORD_HASH` decides whether the stand is open or locked. Unset - which is the default - means open: everyone who can reach the stand is the reader. A blank or whitespace-only value is unset, so `RHAPSOD_PASSWORD_HASH=` does not lock a stand with an empty password.

The value is the whole PHC string that `rhapsod hash` prints, and it contains `$`, so it must be single-quoted in a `.env` file:

```sh
RHAPSOD_PASSWORD_HASH='$argon2id$v=19$m=19456,t=2,p=1$wVUyLxTmlnEWzGSHbJINbg$sdR7z5K3zoywehEIBHEqAXDsZILU908I9bQLGkCRYgg'
```

The full walk-through is in [Locking a stand](/rhapsod/guides/locking-a-stand/).

## The app directory

`RHAPSOD_WEB_DIR` is what separates development from the stand. In development Vite serves the app on its own port and proxies `/api` to the server, so the directory can stay unbuilt; asking the server for `/` then answers `404` with a line saying so. On the stand the image carries the built app at `/app/web`, and the same process serves both.
