---
title: Moving a stand to another machine
description: Backing a stand up, standing it back up on a new machine, and moving it to a new version - three scripts, and what each of them is careful about.
---

A Pi will die eventually, or be replaced by a faster one. This used to be a page of commands to run in order, each with a way of going subtly wrong, at the moment when the machine holding everything had just stopped working. It is now three scripts, and this page is what they do and why they do it in that order.

```
tools/stand/backup.sh     # bring a copy of the database here
tools/stand/restore.sh    # stand it back up on a machine with nothing on it
tools/stand/update.sh     # move it to a released version
```

Each has a `.ps1` beside it that does the same thing on Windows - the stand is a Pi and the machine it is driven from usually is not, and a procedure that only exists as a shell script is one that cannot be run on the day it is needed.

## What a stand is made of

Three things, and only one of them is irreplaceable.

| Part | Where it lives | If it is lost |
| --- | --- | --- |
| **The image** | `ghcr.io/lacodda/rhapsod`, pulled by tag | Nothing. Pull it again. |
| **The library** | A directory of markdown on the stand | Nothing. It is a copy; the vault is the original ([ADR 0002](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0002-content-as-files.md)). Publish it again. |
| **The database** | A Docker volume, one SQLite file | **Everything the reader did**: what was read, where they stopped, notes, kept lines, review schedules. |

So all of this is really about one file. The rest is a fresh install pointed at it.

## Settings

All three read the same two values, from the environment or from a `.env` beside the repository:

```sh
RHAPSOD_STAND_HOST=pi              # the ssh host the stand runs on
RHAPSOD_STAND_DIR=/srv/rhapsod     # where its compose file lives
```

`RHAPSOD_STAND_COMPOSE` names the compose file on the stand if it is not `docker-compose.yml`. How a stand is deployed is a fact about that machine, so it is a setting rather than something this repository decides.

`backup` takes two more, both optional: `RHAPSOD_BACKUP_TO` (default `./backups`) and `RHAPSOD_BACKUP_KEEP` (default 14).

## Backups

The server takes one a day by itself, into `backups/` beside the database, and keeps a fortnight. It does not merely write the file - it opens it, runs `integrity_check` and reads a row out of it, and a copy that fails is deleted rather than left under today's name. A copy nobody has opened is not a backup, and a fortnight of unreadable files would push the last good one out of the window.

That copy is on the same card as the original, which covers a database going bad and covers nothing else. `backup.sh` brings the newest one here:

```sh
./tools/stand/backup.sh
```

```
backup: asking pi for the newest copy
backup: fetching rhapsod-2026-09-19.db
backup: checked rhapsod-2026-09-19.db: whole, 23 pieces of reading state
backup: kept ./backups/rhapsod-2026-09-19.db (148 kB)
backup: done: 14 copies in ./backups
```

It opens the copy again on arrival. That is not the same check twice: the server checked what it wrote, this checks what survived the network and the disk at this end, which is the copy that will actually be reached for. It needs `sqlite3` on this machine, and refuses rather than skipping the check if there is none - a check that quietly says yes when it cannot look is the worst of the three answers.

Nothing on the stand is changed and the server is not stopped: the daily copy is a finished file, so there is nothing to catch mid-write.

This is not the export. The [export](/rhapsod/guides/exporting-marks/) produces something readable without any of this software and folds into the vault as markdown; run it too, and for the same reason people keep two kinds of backup.

## Standing a stand up somewhere else

On a machine with nothing on it:

```sh
RHAPSOD_STAND_HOST=newmachine ./tools/stand/restore.sh backups/rhapsod-2026-09-19.db
```

It checks the copy **before** it moves anything - standing a stand up around a file that turns out to be half a database is how an empty stand gets mistaken for a restored one - then sends the repository's tracked files, sends `.env` if there is one here, creates the volume, and puts the database in.

The order is the point. The database goes into the volume **before the first start**. A server that opens a volume with no database in it creates one and migrates it into place; putting the copy in afterwards means either overwriting a live file underneath a running server, or a restore that quietly does nothing.

If there is already a stand on that host it says so and asks, because the one irreversible thing in the script is writing into that volume, and what is in it is somebody's reading.

Then it pulls, starts, and asks the stand how it is:

```
restore: asking the stand how it is
ok version   rhapsod 0.15.0
XX library   /content is empty - nothing has been published
ok database  whole
ok reader    23 pieces of reading state, 0 notes, 7 quotes
```

An empty library there is expected: nothing has been published to this machine yet. The line that matters is `reader`, because it is the one thing that could not have been recreated.

Two things are left, and the script says so rather than guessing at them:

1. **Publish the library** - `./tools/publish-content.sh`. It comes from the vault and belongs to whoever writes it.
2. **Put the door back up** - see [Behind a door](/rhapsod/guides/behind-a-door/). The certificate and the name belong to the proxy in front of the stand, not to rhapsod.

Then `rhapsod doctor` again; every line should be `ok`.

### If all that survived is an export

Copying the database is the way to move a stand, because it carries everything exactly as it was. When that is not possible - the old machine is gone, the file is corrupt - a stand can be filled from an export instead:

```sh
docker compose -f docker-compose.prod.yml run --rm server rhapsod restore /data/rhapsod-export.json
```

This is a weaker recovery, and it is worth knowing why. The export carries what the reader made: progress, notes, kept lines, review schedules. It does not carry sessions, so every device signs in again.

Rows that are already there are left alone, so running it twice changes nothing the second time and running it against a live stand cannot overwrite what has happened since. Restored rows keep the dates they were made on: a restore is not the reader doing anything, and stamping everything "now" would tell the streak that a hundred pieces were finished today and hand back every review schedule with its intervals restarted.

## Moving to a new version

```sh
./tools/stand/update.sh v0.15.0
```

```
update: looking for the image for v0.15.0
update: copying the database aside on pi: rhapsod-before-v0.15.0-20260919T193404Z.db
update: stopping the stand for the copy
update: copied aside; a rollback restores rhapsod-before-v0.15.0-20260919T193404Z.db
update: setting the version in /srv/rhapsod/.env
update: pulling ghcr.io/lacodda/rhapsod:0.15.0
update: starting v0.15.0
update: asking the stand how it is
ok version   rhapsod 0.15.0
ok library   62 pieces on 50 shelves in /content
ok app       built at /app/web
ok database  whole
ok reader    23 pieces of reading state, 0 notes, 7 quotes
ok backups   14 kept, newest from 2026-09-19 (today)
update: the stand is on v0.15.0 and well.
```

Three things it is careful about, all of them learnt the hard way:

**The image is looked for first.** From here, where there is a network, rather than discovered on the Pi with the old container already stopped. A release build that is still running means the tag exists and the image does not.

**The copy is taken before the new version starts.** A release that migrates the database is a release whose migration has already run by the time anything looks wrong, and [a migration that has shipped is frozen](https://github.com/lacodda/rhapsod/blob/main/docs/adr) - only a new one moves it forward. The copy is the thing to go back to, and it is kept on the stand, because that is the machine a rollback happens on. If it cannot be taken, the stand is started again and nothing is updated: a version must not move without something to move back to.

**The version is written into `.env` on the stand,** not passed on the command line. A later `docker compose up -d` run by hand then brings up the same version rather than whatever `latest` has become.

The stand runs the image the release built rather than building on the Pi. A Pi recompiling Rust for every tag is half an hour of a release, and the binary it ends up with is not the one CI went green on.

## Asking how a stand is, at any time

```sh
docker compose -f docker-compose.prod.yml exec server rhapsod doctor
```

The library, the database, the backups, the app, the door - in one answer, against the same configuration the server runs on. See [Commands](/rhapsod/reference/cli/#rhapsod-doctor).

`exec` rather than `run`: the running container is the stand being asked about, and a fresh one would open its own copy of the database and report on that.

## If the new machine has a different address

The stand's address lives in whatever publishes to it and whatever exports from it, not in the server. Update `RHAPSOD_PUBLISH_URL` and `RHAPSOD_STAND_HOST` where you keep them, and re-run the publishing script once against the new address.

The app on a phone remembers the stand it was installed from. Installing it again from the new address is the whole of the migration on that side; anything queued and undelivered on the old install is lost, so drain it - open the app at home while the old stand is still up - before switching.

## See also

- [Commands](/rhapsod/reference/cli/) - `doctor`, `restore` and the rest, in full.
- [Running on a Raspberry Pi](/rhapsod/guides/running-on-a-pi/) - the first install.
- [Taking your marks back to the vault](/rhapsod/guides/exporting-marks/) - the export, and the ritual that folds it into markdown.
- [Publishing content](/rhapsod/guides/publishing-content/) - getting the library onto a stand.
