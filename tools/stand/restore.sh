#!/usr/bin/env bash
# Stands a stand back up on a machine that has nothing on it.
#
# This is the script the whole of v0.14 is about. A Pi dies, or is replaced by
# a faster one, and what used to happen was a guide: eight commands, each one
# with a way of going subtly wrong, run by somebody holding a screwdriver.
# The guide is now this file, and the guide's job is to explain what it does.
#
# A stand is three things and only one of them is irreplaceable: the image is
# pulled again, the library is republished from the vault, and what the reader
# did exists nowhere else. So this is about one file - and about putting it in
# before the first start, because a server that opens an empty database
# migrates one into place and then the copy has nowhere to go.
#
#   ./tools/stand/restore.sh backups/rhapsod-2026-09-19.db
#
# Configuration, from the environment or a `.env` beside the repository:
#
#   RHAPSOD_STAND_HOST=pi                    # the ssh host to stand it up on
#   RHAPSOD_STAND_DIR=/srv/rhapsod           # where its compose file will live
#
# What this does NOT do is publish the library or set up the door. The library
# comes from the vault with `tools/publish-content.*` and belongs to whoever
# writes it; the certificate and the name belong to the proxy in front of the
# stand ("Behind a door"). Both are said at the end rather than guessed at.
set -euo pipefail

# --- What this stand is -----------------------------------------------------
app=rhapsod
volume=rhapsod_data
volume_data=/data
# The compose file on the stand. A setting, not a constant: a stand is a
# machine somebody set up, and how it is deployed is a fact about that
# machine rather than something this repository gets to decide. The real one
# is called docker-compose.yml.
compose_file=${RHAPSOD_STAND_COMPOSE:-docker-compose.yml}
service=server

here="$(cd "$(dirname "$0")/../.." && pwd)"
. "$here/tools/stand/common.sh"

copy=${1:-}
[ -n "$copy" ] || die "name the backup to restore from: ./tools/stand/restore.sh backups/$app-2026-09-19.db"
[ -f "$copy" ] || die "$copy is not a file"
need RHAPSOD_STAND_HOST "name the ssh host to stand the stand up on (e.g. pi)"
need RHAPSOD_STAND_DIR "name the directory on that host to run it from (e.g. /srv/$app)"
host=$RHAPSOD_STAND_HOST
dir=$RHAPSOD_STAND_DIR

# Checked here, before anything is uploaded or created. Standing a stand up
# around a file that turns out to be half a database is how an empty stand
# gets mistaken for a restored one.
say "checking the copy before anything is moved"
check_database "$copy" || die "$copy is not a whole $app database; restoring from it would build an empty stand"

# --- Is there already a stand there? ----------------------------------------
# The one irreversible thing in this script is putting a database into a
# volume. If a stand is already running on that host, this would be pointed at
# a machine that has a reader's real state on it.
existing=$(ssh "$host" "docker volume ls --format '{{.Name}}' | grep -x '$volume' || true" </dev/null)
if [ -n "$existing" ]; then
    say "there is already a $volume volume on $host."
    say "a restore writes into it, and what is in it now is somebody's reading."
    confirm "restore over the existing stand on $host?" || die "stopped; nothing was changed"
fi

# --- The files the stand runs from ------------------------------------------
# `git archive`, not a copy of the working tree: it emits tracked files and
# nothing else, so a local `.env`, a `target/` of host-architecture artifacts
# and whatever else is lying about cannot travel. The same filter the deploy
# staging uses, for the same reason.
say "sending the stand's files to $host:$dir"
ssh "$host" "mkdir -p '$dir'" </dev/null
git -C "$here" archive --format=tar HEAD | ssh "$host" "tar -x -C '$dir'"

# `.env` is not in the repository and must not be: it carries the password
# hash and the paths. It travels only if it is here to travel.
if [ -f "$here/.env" ]; then
    say "sending .env (the password hash and the paths live in it)"
    scp -q "$here/.env" "$host:$dir/.env"
else
    say "no .env here to send - the stand will need one before it starts (see below)"
fi

# --- The database, before the first start -----------------------------------
# The order is the whole point. A server that starts against a volume with no
# database in it creates one and migrates it; putting the copy in afterwards
# means either overwriting a live file underneath a running server, or a
# restore that quietly does nothing.
say "creating the $volume volume and putting the database in before anything starts"
ssh "$host" "docker volume create '$volume' >/dev/null" </dev/null

# Through a throwaway container with the volume mounted: the volume is
# Docker's, not a path on the host, and a Pi has no sqlite3 to do it with
# anyway. `alpine` because it is small and it is already how the guide did it.
if ! ssh "$host" "docker run --rm -i -v '$volume:$volume_data' alpine sh -c 'cat > $volume_data/$app.db'" < "$copy"; then
    die "the database could not be written into $volume on $host"
fi

# Read back from inside the volume, not trusted because the copy went in. The
# thing being checked is what is on the other machine now.
say "checking the database that is now in the volume"
ssh "$host" "docker run --rm -v '$volume:$volume_data' alpine sh -c 'ls -l $volume_data/$app.db'" </dev/null

# --- Up ---------------------------------------------------------------------
say "pulling the image and starting the stand"
ssh "$host" "cd '$dir' && docker compose -f '$compose_file' pull && docker compose -f '$compose_file' up -d" </dev/null

# --- Is it well? ------------------------------------------------------------
# The product's own answer, against the configuration the server is actually
# running on. A curl from here would say the port answers; this says whether
# the stand can do its job.
say "asking the stand how it is"
if ssh "$host" "cd '$dir' && docker compose -f '$compose_file' exec -T $service $app doctor" </dev/null; then
    say "the stand is up and well."
else
    # Not a failure of this script: a restored stand with no library yet is
    # exactly what is expected at this point, and the doctor says which lines
    # are which.
    say "the stand is up, and the doctor found something - the lines above say what."
    say "an empty library is normal here: nothing has been published to this machine yet."
fi

echo
say "what is left, and neither of them is this script's to do:"
say "  1. publish the library:  ./tools/publish-content.sh"
say "  2. put the door back up: see the \"Behind a door\" guide - the certificate"
say "     and the name belong to the proxy, not to $app"
say "then run the doctor again; every line should be ok."
