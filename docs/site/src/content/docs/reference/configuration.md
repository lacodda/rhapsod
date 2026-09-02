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
| `RUST_LOG` | no | `rhapsod=info,tower_http=info` | Log filter, in `tracing-subscriber` `EnvFilter` syntax. |

A `.env` file in the working directory is read first, so all of these can live there during development. The file is never committed; `.env.example` shows the shape.

## What the server does not read

`RHAPSOD_PUBLISH_SRC`, `RHAPSOD_PUBLISH_HOST`, `RHAPSOD_PUBLISH_DEST` and `RHAPSOD_PUBLISH_URL` look like server configuration and are not. They are read by the publishing scripts in `tools/`, which run on the machine the library is written on and talk to the server only through `POST /api/reindex`; the server never looks at them. They are documented with the tool that uses them, in [Publishing content](/rhapsod/guides/publishing-content/).

They share the `.env` file with the table above because a development machine is often both the thing running the server and the thing publishing to a stand, and one file for both halves beats two.

## How it is read

The server reads the environment once at startup and fails immediately if it cannot build a valid configuration:

- **`RHAPSOD_CONTENT_DIR` missing or blank** - startup aborts naming the variable.
- **`RHAPSOD_CONTENT_DIR` not a directory** - startup aborts showing the path it was given.
- **`RHAPSOD_ADDR` malformed** - startup aborts echoing the value it could not parse.
- **`RHAPSOD_DATABASE_URL` not a SQLite URL** - startup aborts naming the variable.

A blank value for an optional variable means the default: a compose file that leaves `RHAPSOD_WEB_DIR=` empty does not make the server serve its working directory.

Failing at startup is deliberate. A server that boots with a broken configuration and only discovers it on the first request has turned a deployment error into an outage.

## The app directory

`RHAPSOD_WEB_DIR` is what separates development from the stand. In development Vite serves the app on its own port and proxies `/api` to the server, so the directory can stay unbuilt; asking the server for `/` then answers `404` with a line saying so. On the stand the image carries the built app at `/app/web`, and the same process serves both.
