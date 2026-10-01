---
title: Moving a stand to another machine
description: Backing a stand up, standing it back up on a new machine, rolling it back, and moving it to a new version - three scripts, and what each of them is careful about.
---

A Pi will die eventually, or be replaced by a faster one. This used to be a page of commands to run in order, each with a way of going subtly wrong, at the moment when the machine holding everything had just stopped working. It is now three scripts, and this page is what they do and why they do it in that order.

```
tools/stand/backup.sh     # bring a copy of the database and the settings here
tools/stand/restore.sh    # stand it back up on a machine with nothing on it
tools/stand/update.sh     # move it to a released version
```

Each has a `.ps1` beside it that does the same thing on Windows - the stand is a Pi and the machine it is driven from usually is not, and a procedure that only exists as a shell script is one that cannot be run on the day it is needed. What they need on both machines is listed in [Running on a Raspberry Pi](/rhapsod/guides/running-on-a-pi/#what-it-needs).

## What a stand is made of

| Part | Where it lives | If it is lost |
| --- | --- | --- |
| **The image** | `ghcr.io/lacodda/rhapsod`, pulled by tag | Nothing. Pull it again. |
| **The compose file** | `docker-compose.yml` in the stand's directory | Nothing. It is `docker-compose.prod.yml` of the release, and the scripts send it. |
| **The library** | `content/` in the stand's directory | Nothing. It is a copy; the vault is the original ([ADR 0002](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0002-content-as-files.md)). Publish it again. |
| **The settings** | `.env` in the stand's directory | The password hash that locks it, and where things are. A stand restored without them comes back **open**. |
| **The database** | A Docker volume, one SQLite file | **Everything the reader did**: what was read, where they stopped, notes, kept lines, review schedules. |

So all of this is really about two files. The rest is a fresh install pointed at them.

## Settings

All three read the same two values, from the environment or from a `.env` in the root of your clone of this repository:

```sh
RHAPSOD_STAND_HOST=pi              # the ssh host the stand runs on
RHAPSOD_STAND_DIR=/srv/rhapsod     # the stand's directory on that host
```

This `.env` holds the tools' settings. It is not the stand's `.env`, which lives on the Pi and travels only as `rhapsod-stand.env` in the backups.

`backup` and `update` take `RHAPSOD_BACKUP_TO` - where copies land here; `backups/` in your clone if unset, which git ignores - and `backup` takes `RHAPSOD_BACKUP_KEEP` (default 14). `RHAPSOD_YES=1` answers the scripts' questions for a run nobody is watching; without it, no answer means no.

## Backups

The server takes one a day by itself, into `backups/` beside the database, and keeps a fortnight. It does not merely write the file - it opens it, runs `integrity_check` and reads a row out of it, and a copy that fails is deleted rather than left under today's name. The first one is written within an hour of the server starting.

That copy is on the same card as the original, which covers a database going bad and covers nothing else. `backup.sh` brings the newest one here, and the stand's settings with it:

```sh
./tools/stand/backup.sh
```

```
backup: asking pi for the newest copy
backup: fetching rhapsod-2026-10-01.db
backup: checked rhapsod-2026-10-01.db: whole, 23 pieces of reading state
backup: kept ./backups/rhapsod-2026-10-01.db (148 kB)
backup: kept the stand's settings as rhapsod-stand.env
backup: done: 14 copies in ./backups
```

It opens the copy again on arrival. That is not the same check twice: the server checked what it wrote, this checks what survived the network and the disk at this end, which is the copy that will actually be reached for. It refuses rather than skipping the check when there is no `sqlite3` here.

`rhapsod-stand.env` is the stand's `.env` as it is now, one file replaced on every run. It carries the password hash, so the backups directory is as private as the stand.

Nothing on the stand is changed and the server is not stopped. Run it on a schedule, so the copy that matters is never older than a week. On Windows, a weekly task - PowerShell does not run scripts by default, hence the policy flag:

```powershell
schtasks /create /tn "rhapsod backup" /sc weekly /d SUN /st 03:00 /tr "powershell -NoProfile -ExecutionPolicy Bypass -File C:\path\to\rhapsod\tools\stand\backup.ps1"
```

On Linux or macOS, a cron line:

```
0 3 * * 0  /path/to/rhapsod/tools/stand/backup.sh
```

Both find the clone's `.env` and its `backups/` wherever they are started from. A scheduled run has nobody to type a passphrase, so the ssh key it uses must work without one.

This is not the export. The [export](/rhapsod/guides/exporting-marks/) produces something readable without any of this software; run it too, and for the same reason people keep two kinds of backup.

## Standing a stand up somewhere else

On a machine with nothing on it but Docker and a directory the ssh user owns:

```sh
RHAPSOD_STAND_HOST=newpi ./tools/stand/restore.sh backups/rhapsod-2026-10-01.db
```

In order, it:

1. **Checks the copy** before it moves anything - standing a stand up around half a database is how an empty stand gets mistaken for a restored one.
2. **Looks at the machine:** Docker with compose, the directory writable, the image of the version published. A machine missing any of them ends up with nothing on it.
3. **Sends two files:** the compose file of the version, and the stand's settings from `rhapsod-stand.env` beside the copy, with the version set. Without that file the stand gets the defaults - and is open.
4. **Makes `content/`** as the ssh user, so publishing into it is not refused.
5. **Puts the database into the volume** through the stand's own service, before anything starts, and reads it back to check it arrived byte for byte.
6. **Pulls, starts, and asks the stand how it is.**

The version is the newest tag of your checkout, or the one you name: `restore.sh <copy> v0.15.1`. An older image cannot open a database a newer one has migrated.

The order is the point. A server that opens an empty volume creates a database and migrates it into place; putting the copy in afterwards means either overwriting a live file underneath a running server, or a restore that quietly does nothing. The database goes through the service rather than a throwaway container because the image runs as its own user, and a file written by anything else is one the server is not allowed to open.

If there is already a stand in that directory, it says so, asks, and stops it before writing - the one irreversible thing in the script is replacing that database, and what is in it is somebody's reading.

```
restore: asking the stand how it is
ok version   rhapsod 0.15.1
-- library   /content is empty - nothing has been published
ok app       built at /app/web
ok database  whole
ok reader    23 pieces of reading state, 0 notes, 7 quotes
ok backups   1 kept, newest from 2026-10-01 (today)
ok door      published on 127.0.0.1:8084 - only a proxy on this machine can reach it; no password: the stand is open
```

An empty library there is expected. The line that matters is `reader`, because it is the one thing that could not have been recreated. Two things are left, and the script says so rather than guessing at them:

1. **Publish the library** - `./tools/publish-content.sh`, with `RHAPSOD_PUBLISH_DEST` pointing at the new `content/`.
2. **Put the door back up** - see [Behind a door](/rhapsod/guides/behind-a-door/). If the old machine's certificate authority died with it, every device has to trust the new one's root again.

Then `docker compose exec server rhapsod doctor` again; no line should say `XX`.

### If all that survived is an export

Copying the database is the way to move a stand, because it carries everything exactly as it was. When that is not possible - the old machine is gone, the file is corrupt - a stand can be filled from an export instead. Stand up an empty one first ([Running on a Raspberry Pi](/rhapsod/guides/running-on-a-pi/#bringing-it-up)), copy the export into its directory, and read it in there:

```sh
scp rhapsod-export.json pi:/srv/rhapsod/
ssh pi 'cd /srv/rhapsod && docker compose run --rm -T server rhapsod restore /dev/stdin < rhapsod-export.json'
```

This is a weaker recovery, and it is worth knowing why. The export carries what the reader made: progress, notes, kept lines, review schedules. It does not carry sessions, so every device signs in again.

Rows that are already there are left alone, so running it twice changes nothing the second time and running it against a live stand cannot overwrite what has happened since. Restored rows keep the dates they were made on: a restore is not the reader doing anything, and stamping everything "now" would tell the streak that a hundred pieces were finished today.

## Moving to a new version

```sh
./tools/stand/update.sh v0.15.1
```

```
update: looking for the image for v0.15.1
update: copying the database aside on pi: rhapsod-before-v0.15.1-20261001T120000Z.db
update: stopping the stand for the copy
update: copied aside; a rollback restores rhapsod-before-v0.15.1-20261001T120000Z.db
update: sending the compose file of v0.15.1
update: setting the version in /srv/rhapsod/.env
update: pulling ghcr.io/lacodda/rhapsod:0.15.1
update: starting v0.15.1
update: asking the stand how it is
ok version   rhapsod 0.15.1
ok library   62 pieces on 50 shelves in /content
ok app       built at /app/web
ok database  whole
ok reader    23 pieces of reading state, 0 notes, 7 quotes
ok backups   14 kept, newest from 2026-10-01 (today)
-- door      published on 0.0.0.0:8084 - anything on the network can reach it; no password: the stand is open
update: the stand is on v0.15.1 and well.
```

What it is careful about, all of it learnt the hard way:

**The image and the tag are looked for first,** before anything stops. A release build that is still running means the tag exists and the image does not, and the compose file is sent from the tag, so a checkout without the tag cannot update.

**The copy is taken before the new version starts.** A release that migrates the database is a release whose migration has already run by the time anything looks wrong, and [a migration that has shipped is frozen](https://github.com/lacodda/rhapsod/blob/main/docs/adr/0005-a-shipped-migration-is-frozen.md) - only a new one moves it forward. The copy is kept on the stand, because that is the machine a rollback happens on. If it cannot be taken, the stand is started again and nothing is updated.

**The copy is refused if the server did not close its database.** A stopped server folds its write-ahead log into the file; a log still holding something means it was killed, and a copy of the file alone would miss the reader's last steps.

**The compose file goes with the version.** A release that changes how the stand runs reaches the stand together with the image it was written for.

**The version is written into the stand's `.env`,** not passed on the command line, so a later `docker compose up -d` brings up the same version rather than whatever `latest` has become.

## Rolling back

When the doctor is unhappy after an update, the copy taken aside is the way back. `update` has already brought it here, into `backups/` beside the stand's settings as they were at that moment:

```
update: kept a copy here as backups/rhapsod-before-v0.15.1-20261001T120000Z.db
```

Restore it with the version it came from:

```sh
./tools/stand/restore.sh backups/rhapsod-before-v0.15.1-20261001T120000Z.db v0.15.0
```

`restore` finds the stand already there, asks, stops it, and puts the old database back with the old version's compose file and image. Anything the reader did between the update and the rollback is in the newer database, not this one; export it first if it matters.

If the copy could not be brought here, `update` says so and names it on the stand, in the volume's `backups/`. Fetch it through the service, which works even while a bad release keeps restarting - with `cmd /c` from PowerShell, whose own `>` would write the database as text:

```sh
ssh pi 'cd /srv/rhapsod && docker compose run --rm --no-deps -T server cat /data/backups/rhapsod-before-v0.15.1-20261001T120000Z.db' > backups/rhapsod-before-v0.15.1-20261001T120000Z.db
```

## Asking how a stand is, at any time

In the stand's directory:

```sh
docker compose exec server rhapsod doctor
```

The library, the database, the backups, the app, the door - in one answer, against the same configuration the server runs on. See [Commands](/rhapsod/reference/cli/#rhapsod-doctor).

`exec` rather than `run`: the running container is the stand being asked about, and a fresh one would open the database beside it and report on a server that is not running.

## If the new machine has a different address

The stand's address lives in whatever publishes to it and whatever exports from it, not in the server. Update `RHAPSOD_PUBLISH_URL`, `RHAPSOD_PUBLISH_HOST` and `RHAPSOD_STAND_HOST` where you keep them, and re-run the publishing script once against the new address.

A new machine under the old name or address presents a new host key, and ssh refuses it until the old one is forgotten: `ssh-keygen -R pi`. `restore` stops at that step and says so.

The app on a phone remembers the stand it was installed from. Installing it again from the new address is the whole of the migration on that side; anything queued and undelivered on the old install stays there, so drain it - open the app at home while the old stand is still up - before switching. See [Reading on the road](/rhapsod/guides/reading-on-the-road/).

## See also

- [Commands](/rhapsod/reference/cli/) - `doctor`, `restore` and the rest, in full.
- [Running on a Raspberry Pi](/rhapsod/guides/running-on-a-pi/) - the first install.
- [Taking your marks back to the vault](/rhapsod/guides/exporting-marks/) - the export.
- [Publishing content](/rhapsod/guides/publishing-content/) - getting the library onto a stand.
