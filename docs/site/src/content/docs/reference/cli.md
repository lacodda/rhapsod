---
title: Commands
description: Everything the rhapsod binary does - serve, doctor, restore and hash - with what each one reads and what it exits with.
---

One binary, four commands. Three of them are for the person who runs the stand; the fourth is what the container does all day.

```
rhapsod [COMMAND]
```

With no command, it serves. That is what a container image or a systemd unit expects, so the image's entrypoint needs no arguments.

| Command | What it does | Needs a library |
| --- | --- | --- |
| [`serve`](#rhapsod-serve) | Runs the HTTP server: the API and the reading app | yes |
| [`doctor`](#rhapsod-doctor) | Says whether this stand is well | no |
| [`restore`](#rhapsod-restore) | Puts a reader's side back from an export | no |
| [`hash`](#rhapsod-hash) | Hashes a password for `RHAPSOD_PASSWORD_HASH` | no |

Every command reads its settings from the environment, and from a `.env` file beside the working directory if there is one - see [Configuration](/rhapsod/reference/configuration/).

## `rhapsod serve`

Indexes the library, opens the database, and listens.

```sh
rhapsod serve
```

The index is built before the port is bound, so a stand that answers is a stand that has read its library - there is no window after a restart where the shelves are empty. A content directory that is not there is a deployment error and is reported before anything listens.

While it serves, it takes [one backup a day](/rhapsod/guides/moving-a-stand/#backups) of the database, opens the copy to check it, and keeps a fortnight of them.

## `rhapsod doctor`

Asks, in one command, the questions that get asked when something is wrong.

```sh
rhapsod doctor
```

```
ok version   rhapsod 0.14.1
ok library   62 pieces on 19 shelves in /content
ok app       built at /app/web
ok database  whole
ok reader    48 pieces of reading state, 12 notes, 31 quotes
ok backups   14 kept, newest from 2026-09-19 (today)
ok door      listening on 0.0.0.0:8084 - anything on the network can reach it; a password is set
```

It runs against the same configuration the server runs on. That is the point of it being a command of the product rather than a script beside it: a check with its own idea of where the library and the database are can pass while the server fails, because the two were never looking at the same stand.

Each line is one of three marks:

| Mark | Means |
| --- | --- |
| `ok` | Nothing to do. |
| `--` | Worth knowing, not worth waking up for: no backup yet on a stand started an hour ago, an empty library before the first publish, an open stand on the network. |
| `XX` | The stand cannot do its job. |

The exit code is `1` only if something is marked `XX`, so this can be the last line of a deployment script without failing it over a stand that is merely new. Anything `--` exits `0`.

What it does **not** check is the door itself. The certificate, the name and the secure context belong to the proxy in front of the server ([Behind a door](/rhapsod/guides/behind-a-door/)), and a product grading its own proxy would be guessing. What it can say is where the server listens, and whether there is a password on it.

In a container, the settings are already in the environment, so it runs with no arguments:

```sh
docker compose -f docker-compose.prod.yml exec server rhapsod doctor
```

`exec` rather than `run`: the running container is the stand being asked about, and a fresh one would open its own copy of the database and report on that.

## `rhapsod restore`

Fills a database from an export document.

```sh
rhapsod restore rhapsod-export.json
```

For a stand that was rebuilt. The image is pulled again and the library is republished from the vault, but what the reader did exists nowhere else unless it was carried out. Rows that are already there are left alone, so running this twice changes nothing the second time and running it against a live stand cannot overwrite what has happened since.

Restored rows keep the dates they were made on. Stamping them "now" would tell the streak that a hundred pieces were finished today and hand back every review schedule with its intervals restarted.

This is the weaker of the two recoveries - copying the database file is the stronger one, because it carries everything exactly as it was, including sessions. See [Moving a stand](/rhapsod/guides/moving-a-stand/).

## `rhapsod hash`

Turns a password into the string `RHAPSOD_PASSWORD_HASH` wants.

```sh
rhapsod hash 'a good passphrase'
```

```
$argon2id$v=19$m=19456,t=2,p=1$...
```

Without the argument it prompts, so the password does not land in the shell's history:

```sh
rhapsod hash
```

It needs nothing else - no library, no database - which is why the image on a stand can do it before there is anything else set up. The value it prints is full of `$`, so it is single-quoted in a `.env` file. See [Locking a stand](/rhapsod/guides/locking-a-stand/).

## See also

- [Configuration](/rhapsod/reference/configuration/) - every variable these commands read.
- [Health endpoint](/rhapsod/reference/health/) - the same question over HTTP, for a monitor.
- [Moving a stand](/rhapsod/guides/moving-a-stand/) - the scripts that wrap these for a whole stand.
