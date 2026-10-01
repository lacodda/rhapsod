#!/usr/bin/env bash
# Stands a stand back up on a machine that has nothing on it.
#
# A Pi dies, or is replaced by a faster one, and what used to happen was a
# guide: eight commands, each one with a way of going subtly wrong, run by
# somebody holding a screwdriver. The guide is now this file, and the guide's
# job is to explain what it does.
#
# A stand is an image, a library, a database and its settings. The image is
# pulled again and the library is republished from the vault; what the reader
# did exists nowhere else, and neither does the password that locked it. So
# this is about two files from the backup - and about putting the database in
# before the first start, because a server that opens an empty volume
# migrates a database into place and then the copy has nowhere to go.
#
#   ./tools/stand/restore.sh backups/rhapsod-2026-09-19.db [v0.15.0]
#
# The version defaults to the newest tag of this checkout: an older image
# cannot open a database a newer one has migrated.
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

version=${2:-$(git -C "$here" describe --tags --abbrev=0 2>/dev/null || true)}
[ -n "$version" ] || die "name the version to stand up (e.g. v0.15.0): this checkout has no tags"
case "$version" in
    v*) ;;
    *) version="v$version" ;;
esac

# Checked here, before anything is uploaded or created. Standing a stand up
# around a file that turns out to be half a database is how an empty stand
# gets mistaken for a restored one.
say "checking the copy before anything is moved"
check_database "$copy" || die "$copy is not a whole $app database; restoring from it would build an empty stand"

# The stand's own settings, which `backup` brings along beside the copies.
# Without them the stand comes back with the defaults - and open, whatever it
# was before, which is said rather than discovered.
settings="$(dirname "$copy")/$app-stand.env"
if [ -f "$settings" ]; then
    say "using the stand's settings from $(basename "$settings")"
    env_text=$(grep -v '^RHAPSOD_VERSION=' "$settings" || true)
else
    say "no $app-stand.env beside the copy: the stand gets the default settings"
    env_text=""
fi
content=$(printf '%s\n' "$env_text" | sed -n 's/^RHAPSOD_CONTENT=//p' | tail -n 1 | tr -d "\"'")
if [ -z "$content" ]; then
    content="$dir/content"
    env_text=$(printf '%s\nRHAPSOD_CONTENT=%s' "$env_text" "$content")
fi
env_text=$(printf '%s\nRHAPSOD_VERSION=%s\n' "$env_text" "${version#v}" | sed '/^$/d')

# --- Can this machine run a stand at all? -----------------------------------
# Asked before anything is written, so a machine that is missing something
# ends up with nothing on it rather than half a stand.
say "looking at $host"
ssh "$host" "docker compose version" </dev/null >/dev/null 2>&1 ||
    die "$host has no docker with the compose plugin for this user: install Docker Engine and add the user to the docker group"
ssh "$host" "mkdir -p '$dir' && test -w '$dir'" </dev/null 2>/dev/null ||
    die "$dir cannot be created or written on $host by this user: make it with \`sudo install -d -o \$USER $dir\`"

image="ghcr.io/lacodda/$app:${version#v}"
ssh "$host" "docker manifest inspect '$image' >/dev/null 2>&1" </dev/null ||
    die "there is no image $image: the release build may still be running, or the tag was never pushed"

# --- Is there already a stand there? ----------------------------------------
# The one irreversible thing in this script is putting a database into a
# volume. A compose file in the directory means a stand lives there, and what
# is in its volume is somebody's reading.
confirmed=no
if ssh "$host" "test -f '$dir/docker-compose.yml'" </dev/null; then
    say "there is already a stand in $dir on $host."
    say "a restore replaces its database, and what is in it now is somebody's reading."
    confirm "restore over the stand in $host:$dir?" || die "stopped; nothing was changed"
    confirmed=yes
    say "stopping it, so nothing writes underneath the copy"
    on_stand "docker compose stop $service"
fi

# --- The files the stand runs from ------------------------------------------
# Two files and nothing else: the compose file of the version being stood up,
# and the stand's own settings. Not the repository - the stand pulls the image
# the release built, and source on a Pi is only something to compile by
# mistake.
say "sending the compose file of $version to $host:$dir"
send_compose "$version"

say "writing $dir/.env"
printf '%s\n' "$env_text" | ssh "$host" "cat > '$dir/.env'" || die "the settings could not be written to $host:$dir/.env"

# Made by this user, before compose sees it: a directory compose has to make
# for a mount is made by root, and the publishing script, which copies into it
# as this user, would be refused.
say "making the library directory $content"
on_stand "mkdir -p '$content'"

# --- The database, before the first start -----------------------------------
# A volume left behind by an earlier stand in a directory of the same name is
# the same volume to compose. Asked about through the service, which is the
# only way to be asking about the volume the stand will actually mount.
if [ "$confirmed" = no ] && in_service "test -e /data/$app.db"; then
    say "the volume this stand uses already holds a database, left by an earlier stand."
    confirm "replace it with $(basename "$copy")?" ||
        die "stopped; the volume was not touched (the compose file and .env in $dir were written)"
fi

# The order is the whole point. A server that starts against a volume with no
# database in it creates one and migrates it; putting the copy in afterwards
# means either overwriting a live file underneath a running server, or a
# restore that quietly does nothing.
#
# Written under another name and moved, so a transfer cut halfway leaves the
# old file rather than half a new one. The write-ahead log beside the old file
# goes with it: a log left beside a different database is replayed into it.
say "putting the database in before anything starts"
ssh "$host" "cd '$dir' && docker compose --progress quiet run --rm --no-deps -T $service sh -c 'cat > /data/$app.db.part && rm -f /data/$app.db-wal /data/$app.db-shm && mv /data/$app.db.part /data/$app.db'" < "$copy" ||
    die "the database could not be written into the stand's volume on $host"

# Read back from inside the volume, not trusted because the copy went in. The
# thing being checked is what is on the other machine now.
say "checking the database that is now in the volume"
there=$(in_service "sha256sum /data/$app.db" | cut -d' ' -f1)
[ "$there" = "$(file_hash "$copy")" ] ||
    die "the database in the volume is not the copy that was sent; nothing was started"
say "the volume holds $(basename "$copy"), byte for byte"

# --- Up ---------------------------------------------------------------------
say "pulling $image and starting the stand"
on_stand "docker compose pull && docker compose up -d --wait --wait-timeout 60" ||
    say "the stand did not report healthy - the doctor says why"

# --- Is it well? ------------------------------------------------------------
# The product's own answer, against the configuration the server is actually
# running on. A curl from here would say the port answers; this says whether
# the stand can do its job.
say "asking the stand how it is"
if on_stand "docker compose exec -T $service $app doctor"; then
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
say "  1. publish the library into $content:  ./tools/publish-content.sh"
say "  2. put the door back up: see the \"Behind a door\" guide - the certificate"
say "     and the name belong to the proxy, not to $app"
say "then run the doctor again; every line should be ok."
