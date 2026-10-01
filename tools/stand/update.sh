#!/usr/bin/env bash
# Moves the stand to a released version.
#
# This is what used to be done by hand after every tag: copy the volume
# somewhere safe, edit a version into `.env`, pull, up, and then curl the
# health endpoint and squint at the number. Five steps, done from memory,
# after the part of the work that felt finished.
#
# The order matters and is the reason this exists. The copy is taken *before*
# the new image starts, because a release that migrates the database is a
# release whose migration has already run by the time anything looks wrong -
# and the schema cannot be walked back (a migration that has shipped is
# frozen; only a new one moves it forward).
#
#   ./tools/stand/update.sh v0.14.0
#   ./tools/stand/update.sh              # whatever the repository is tagged at
#
# The compose file goes with the version: the stand's `docker-compose.yml` is
# replaced by the one the tag shipped, so a release that changes how the
# stand runs reaches the stand with the image it was written for.
#
# Configuration, from the environment or a `.env` beside the repository:
#
#   RHAPSOD_STAND_HOST=pi                    # the ssh host the stand runs on
#   RHAPSOD_STAND_DIR=/srv/rhapsod           # where its compose file lives
#   RHAPSOD_BACKUP_TO=./backups              # where the rollback copy lands here;
#                                            # backups/ in this checkout if unset
set -euo pipefail

# --- What this stand is -----------------------------------------------------
app=rhapsod
service=server
# The variable the compose file reads the image tag from. Spelt out rather
# than derived from `$app`: upper-casing a variable is a bashism, and these
# scripts run in whatever /bin/sh a rescue image has.
version_var=RHAPSOD_VERSION

here="$(cd "$(dirname "$0")/../.." && pwd)"
. "$here/tools/stand/common.sh"

need RHAPSOD_STAND_HOST "name the ssh host the stand runs on (e.g. pi)"
need RHAPSOD_STAND_DIR "name the directory on that host its compose file lives in (e.g. /srv/$app)"
host=$RHAPSOD_STAND_HOST
dir=$RHAPSOD_STAND_DIR
to=${RHAPSOD_BACKUP_TO:-$here/backups}

# The tag, or the one this checkout is standing on. Named rather than guessed
# from the manifest: a version in `Cargo.toml` is a version that is *going* to
# ship, and the image for it exists only once the tag has been built.
version=${1:-$(git -C "$here" describe --tags --exact-match 2>/dev/null || true)}
[ -n "$version" ] || die "name the version to move to (e.g. v0.14.0), or run this from a tagged checkout"
case "$version" in
    v*) ;;
    *) version="v$version" ;;
esac

# The image has to exist before the stand is stopped for it. Asked of the
# registry before anything stops, rather than discovered by a pull with the
# old container already down.
say "looking for the image for $version"
image="ghcr.io/lacodda/$app:${version#v}"
if ! ssh "$host" "docker manifest inspect '$image' >/dev/null 2>&1"; then
    die "there is no image $image yet: the release build may still be running, or the tag was never pushed"
fi
# And the compose file of that version has to be here to send, for the same
# reason: found missing after the stop, it would leave the stand down.
git -C "$here" cat-file -e "$version:docker-compose.prod.yml" 2>/dev/null ||
    die "$version is not a tag in this checkout: run \`git fetch --tags\` and try again"

# --- The copy, before anything moves ----------------------------------------
# Taken from the running stand, and kept on the stand: this is the thing to
# roll back to, and it has to be reachable from the machine the rollback
# happens on. `tools/stand/backup.sh` is what brings copies off the machine;
# this is the one taken because a version is about to change under it.
stamp=$(date -u +%Y%m%dT%H%M%SZ)
aside="/data/backups/$app-before-$version-$stamp.db"
say "copying the database aside on $host: $(basename "$aside")"

# Stopped for the copy, and only for the copy. A server that stops cleanly
# closes its database, which folds the write-ahead log into the one file, so a
# plain copy is whole - and the stand is about to be stopped for the new image
# anyway, so this costs nothing extra in downtime.
say "stopping the stand for the copy"
on_stand "docker compose stop $service"

# A log with something in it means the server was killed rather than stopped,
# and a copy of the database alone would miss the last things the reader did.
# Refused rather than copied: a rollback copy that is quietly behind is found
# out on the day it is needed.
if ! in_service "test ! -s /data/$app.db-wal"; then
    on_stand "docker compose up -d"
    die "the stand did not close its database cleanly (its write-ahead log is not empty); it is running again and nothing was updated"
fi

# Through the service, so the copy is made as the user the server runs as and
# lands in the volume the stand actually mounts.
if ! in_service "mkdir -p /data/backups && cp /data/$app.db $aside"; then
    say "the copy could not be taken; starting the stand again and stopping here"
    on_stand "docker compose up -d"
    die "nothing was updated: a version must not move without something to move back to"
fi
say "copied aside; a rollback restores $(basename "$aside")"

# And brought here, with the stand's settings beside it, while the server is
# still stopped. A rollback is then `restore` with this file and the old
# version - run from the machine that drives the stand, with nothing to fish
# out of a volume by hand. Not a reason to stop the update if it fails: the
# copy on the stand is the one that counts, and the line says where it is.
mkdir -p "$to"
landing="$to/$(basename "$aside")"
if in_service "cat $aside" > "$landing.part" && check_database "$landing.part" "$(basename "$aside")"; then
    mv "$landing.part" "$landing"
    on_stand "cat .env" > "$to/$app-stand.env" 2>/dev/null || true
    say "kept a copy here as $landing"
else
    rm -f "$landing.part"
    say "the rollback copy could not be brought here; it is on the stand as $aside"
fi

# --- The version ------------------------------------------------------------
say "sending the compose file of $version"
send_compose "$version"

# Written into `.env` on the stand rather than passed on the command line, so
# that a later `docker compose up -d` run by hand brings up the same version
# and not whatever `latest` has become.
say "setting the version in $dir/.env"
on_stand "touch .env && sed -i '/^$version_var=/d' .env && echo '$version_var=${version#v}' >> .env"

say "pulling $image"
on_stand "docker compose pull"

say "starting $version"
on_stand "docker compose up -d --wait --wait-timeout 60" ||
    say "the stand did not report healthy - the doctor says why"

# --- Is it the version that was asked for, and is it well? ------------------
# The doctor rather than a curl: the port answering says the process started,
# and this says the stand can do its job. Its first line is the version, so
# one command answers both questions.
say "asking the stand how it is"
if on_stand "docker compose exec -T $service $app doctor"; then
    say "the stand is on $version and well."
else
    say "the stand answered, and the doctor found something - the lines above say what."
    say "to go back, see \"Rolling back\" in the \"Moving a stand\" guide: $(basename "$aside") and the old version."
    exit 1
fi
