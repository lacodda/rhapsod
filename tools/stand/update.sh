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
# Configuration, from the environment or a `.env` beside the repository:
#
#   RHAPSOD_STAND_HOST=pi                    # the ssh host the stand runs on
#   RHAPSOD_STAND_DIR=/srv/rhapsod           # where its compose file lives
set -euo pipefail

# --- What this stand is -----------------------------------------------------
app=rhapsod
volume=rhapsod_data
volume_data=/data
compose_file=docker-compose.prod.yml
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

# The tag, or the one this checkout is standing on. Named rather than guessed
# from the manifest: a version in `Cargo.toml` is a version that is *going* to
# ship, and the image for it exists only once the tag has been built.
version=${1:-$(git -C "$here" describe --tags --exact-match 2>/dev/null || true)}
[ -n "$version" ] || die "name the version to move to (e.g. v0.14.0), or run this from a tagged checkout"
case "$version" in
    v*) ;;
    *) version="v$version" ;;
esac

# The image has to exist before the stand is stopped for it. Checked from
# here, where there is a network and a docker, rather than discovering it on
# the Pi with the old container already down.
say "looking for the image for $version"
image="ghcr.io/lacodda/$app:${version#v}"
if ! ssh "$host" "docker manifest inspect '$image' >/dev/null 2>&1"; then
    die "there is no image $image yet: the release build may still be running, or the tag was never pushed"
fi

# --- The copy, before anything moves ----------------------------------------
# Taken from the running stand, and kept on the stand: this is the thing to
# roll back to, and it has to be reachable from the machine the rollback
# happens on. `tools/stand/backup.sh` is what brings copies off the machine;
# this is the one taken because a version is about to change under it.
stamp=$(date -u +%Y%m%dT%H%M%SZ)
aside="$volume_data/backups/$app-before-$version-$stamp.db"
say "copying the database aside on $host: $(basename "$aside")"

# Stopped for the copy, and only for the copy. A stopped server has
# checkpointed its write-ahead log into the one file, so a plain copy is
# whole - and the stand is about to be stopped for the new image anyway, so
# this costs nothing extra in downtime.
say "stopping the stand for the copy"
ssh "$host" "cd '$dir' && docker compose -f '$compose_file' stop $service" </dev/null

if ! ssh "$host" "docker run --rm -v '$volume:$volume_data' alpine sh -c 'mkdir -p $volume_data/backups && cp $volume_data/$app.db $aside'" </dev/null; then
    say "the copy could not be taken; starting the stand again and stopping here"
    ssh "$host" "cd '$dir' && docker compose -f '$compose_file' up -d" </dev/null
    die "nothing was updated: a version must not move without something to move back to"
fi
say "copied aside; a rollback restores $(basename "$aside")"

# --- The version ------------------------------------------------------------
# Written into `.env` on the stand rather than passed on the command line, so
# that a later `docker compose up -d` run by hand brings up the same version
# and not whatever `latest` has become.
say "setting the version in $dir/.env"
ssh "$host" "cd '$dir' && touch .env && sed -i '/^$version_var=/d' .env && echo '$version_var=${version#v}' >> .env" </dev/null

say "pulling $image"
ssh "$host" "cd '$dir' && docker compose -f '$compose_file' pull" </dev/null

say "starting $version"
ssh "$host" "cd '$dir' && docker compose -f '$compose_file' up -d" </dev/null

# --- Is it the version that was asked for, and is it well? ------------------
# The doctor rather than a curl: the port answering says the process started,
# and this says the stand can do its job. Its first line is the version, so
# one command answers both questions.
say "asking the stand how it is"
if ssh "$host" "cd '$dir' && docker compose -f '$compose_file' exec -T $service $app doctor" </dev/null; then
    say "the stand is on $version and well."
else
    say "the stand answered, and the doctor found something - the lines above say what."
    say "to go back: restore $(basename "$aside") into the volume and set the old version in .env."
    exit 1
fi
