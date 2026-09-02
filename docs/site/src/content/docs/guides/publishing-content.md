---
title: Publishing content
description: Copy a library onto the stand and make the server pick it up - one script per platform, configured from the environment.
---

The library is written somewhere else - a vault, an editor, wherever writing happens - and **published** to the directory the server reads. Publishing is a copy followed by one API call, and `tools/publish-content.sh` and `tools/publish-content.ps1` are that copy and that call.

## Configuration

Both scripts read the same four variables from the environment, and read a `.env` in the repository root if there is one. Values already set in the environment win, so a one-off publish to a different stand is a prefix on the command line rather than an edit.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `RHAPSOD_PUBLISH_SRC` | yes | - | The local library directory to publish. |
| `RHAPSOD_PUBLISH_HOST` | yes | - | The ssh host to publish to, as ssh resolves it. |
| `RHAPSOD_PUBLISH_DEST` | yes | - | The directory on that host to publish into: what `RHAPSOD_CONTENT_DIR` points at over there. |
| `RHAPSOD_PUBLISH_URL` | no | `http://localhost:8084` | Base URL of the running server, called to reindex after the copy. |

These are **not** server configuration. The server never reads them; it only ever learns about a publish through `POST /api/reindex`. The variables the server itself reads are on the [Configuration](/rhapsod/reference/configuration/) page.

Publishing works the same whether the stand is open or [locked](/rhapsod/guides/locking-a-stand/): `POST /api/reindex` and `GET /api/health` are in front of the password, because a publishing script on the same network is not a browser and a monitor is not a reader.

`.env.example` carries all four, commented out.

## Publishing

On Linux, macOS, or Git Bash:

```sh
export RHAPSOD_PUBLISH_SRC=./library
export RHAPSOD_PUBLISH_HOST=pi
export RHAPSOD_PUBLISH_DEST=/srv/rhapsod/content
export RHAPSOD_PUBLISH_URL=http://pi:8084

./tools/publish-content.sh
```

On Windows, in PowerShell:

```powershell
$env:RHAPSOD_PUBLISH_SRC = './library'
$env:RHAPSOD_PUBLISH_HOST = 'pi'
$env:RHAPSOD_PUBLISH_DEST = '/srv/rhapsod/content'
$env:RHAPSOD_PUBLISH_URL = 'http://pi:8084'

.\tools\publish-content.ps1
```

The PowerShell script is written for Windows PowerShell 5.1, which is what a Windows machine has without installing anything.

Either way the script says what it did and ends with what the server now holds:

```
publish-content: rsync ./library/ -> pi:/srv/rhapsod/content/ (with --delete)
publish-content: reindexing http://pi:8084
publish-content: published with rsync; the server now serves {"pieces":184,"sections":26}
```

Those counts come from the server, not from the script, and they are the receipt that the publish landed. A copy that silently went to the wrong directory shows up here as a number that did not move.

## rsync, or scp

The scripts prefer `rsync -a --delete` and fall back to `scp -r` when rsync is not on the machine - which on Windows it usually is not. The line they print says which one ran, because the two are not equivalent in cost:

- **rsync** sends the difference. Republishing a library after correcting one piece moves one file.
- **scp** sends everything, every time, and cannot delete on its own - so the fallback clears the destination over ssh first and copies the whole library back.

Both end at the same state. If you publish often, installing rsync on the Windows side is worth it.

## What `--delete` implies

`--delete` means the stand becomes a mirror of the source, not an accumulation of everything ever published. A piece you removed from your vault disappears from the shelf.

That is the point. Without it, a piece deleted at the source would stay readable on the stand forever, and the library on the Pi would slowly become a different library from the one you write - with no way to tell which pieces are real except by comparing them by hand.

Two consequences worth knowing before the first run:

- **The destination directory belongs to rhapsod.** Anything in it that is not part of your library gets deleted. Publish into a directory that holds nothing else - `/srv/rhapsod/content`, not a home directory.
- **Pointing `RHAPSOD_PUBLISH_SRC` at the wrong directory empties the stand.** A source with no markdown in it mirrors faithfully: the shelf ends up empty. The reindex counts are how you notice immediately - `{"pieces":0,"sections":0}` after a publish that should have moved nothing.

Nothing about your reading is at risk either way. Progress, notes and highlights live in the database, keyed to the piece, and never in the content directory ([ADR 0002](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0002-content-as-files.md)). Republishing a piece - or removing and restoring it - leaves what you marked in it intact. Getting those marks back out is the other direction, and its own script: [Taking your marks back to the vault](/rhapsod/guides/exporting-marks/).

## When it refuses

Every requirement is checked before anything is copied, because a publish that fails halfway across a network has already changed the stand. A missing variable names itself:

```
publish-content: RHAPSOD_PUBLISH_HOST is not set: name the ssh host to publish to (e.g. pi)
```

and so does a source that is not there:

```
publish-content: RHAPSOD_PUBLISH_SRC is not a directory: ./no-such-library
```

If the copy itself fails - an unreachable host, a refused key - the script stops there and does **not** reindex. Leaving the old index in place is the safer half-state: the stand keeps serving the library it had rather than reindexing a directory that a failed copy left half-written.

## Checking what landed

The reindex counts are the immediate answer. `/api/health` is the one you can ask later, from anywhere:

```sh
curl http://pi:8084/api/health
```

```json
{"status":"ok","version":"0.4.0","pieces":2}
```

For everything else the API offers, see the [API reference](/rhapsod/reference/api/).
