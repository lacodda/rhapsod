#!/usr/bin/env bash
# Carries a copy of the stand's database off the machine it lives on.
#
# The server already takes one a day into `backups/` beside the database, and
# opens it to check it (see `rhapsod doctor`). That copy is on the same card
# as the original, which covers a database going bad and covers nothing else:
# a card that dies takes the backups with it.
#
# So this brings the newest one here, and opens it again on arrival. Two
# different checks, not one in two places: the server checks what it wrote,
# this checks what survived the network and the disk at this end. A copy
# nobody has opened is not a backup - and the copy that matters is the one
# that is here, not the one that was there.
#
# Nothing on the stand is changed, and the server is not stopped: the daily
# copy is a finished file, so there is nothing to catch mid-write.
#
#   ./tools/stand/backup.sh [directory]
#
# Configuration, from the environment or a `.env` beside the repository:
#
#   RHAPSOD_STAND_HOST=pi                    # the ssh host the stand runs on
#   RHAPSOD_STAND_DIR=/srv/rhapsod           # where its compose file lives
#   RHAPSOD_BACKUP_TO=./backups              # where copies land here
#   RHAPSOD_BACKUP_KEEP=14                   # how many to keep here
set -euo pipefail

# --- What this stand is -----------------------------------------------------
# The only lines that differ between products on this Pi. Everything below is
# the same in every one of them; a sibling takes these scripts by changing
# this block and nothing else.
app=rhapsod
volume_data=/data
# The compose file on the stand. A setting, not a constant: a stand is a
# machine somebody set up, and how it is deployed is a fact about that
# machine rather than something this repository gets to decide. The real one
# is called docker-compose.yml.
compose_file=${RHAPSOD_STAND_COMPOSE:-docker-compose.yml}
service=server

here="$(cd "$(dirname "$0")/../.." && pwd)"
. "$here/tools/stand/common.sh"

to=${1:-${RHAPSOD_BACKUP_TO:-./backups}}
keep=${RHAPSOD_BACKUP_KEEP:-14}
need RHAPSOD_STAND_HOST "name the ssh host the stand runs on (e.g. pi)"
need RHAPSOD_STAND_DIR "name the directory on that host its compose file lives in (e.g. /srv/$app)"
host=$RHAPSOD_STAND_HOST
dir=$RHAPSOD_STAND_DIR

mkdir -p "$to"

# The newest daily copy, by the date in its name. The name carries the day the
# copy is *of*; a modification time is the day the file was last touched, and
# a directory copied about arrives stamped today.
#
# Listed through the container, not over ssh alone: the database lives in a
# Docker volume, so `$volume_data` is a path inside the running service and
# does not exist on the host at all. An `ls` on the host finds nothing and
# looks exactly like a stand that has taken no backups yet.
say "asking $host for the newest copy"
newest=$(ssh "$host" "cd '$dir' && docker compose -f '$compose_file' exec -T $service sh -c 'ls -1 $volume_data/backups/$app-????-??-??.db 2>/dev/null | sort | tail -n 1'" </dev/null || true)
newest=$(printf '%s' "$newest" | tr -d '
')

if [ -z "$newest" ]; then
    # The server writes one within the hour of starting. Nothing here can make
    # that happen sooner, and taking a copy of the live database from outside
    # would be exactly the mid-write copy the daily one exists to avoid.
    die "no daily copy on $host yet: the server writes the first within an hour of starting, and \`$app doctor\` will say so"
fi

name=$(basename "$newest")
landing="$to/$name"
say "fetching $name"

# The volume is inside a container, so the file is read through the running
# service rather than from a path on the host. `exec`, not `run`: a fresh
# container would mount the same volume but the running one is the stand being
# backed up, and on a machine where the volume is named differently a `run`
# can silently mount a new empty one.
#
# Straight to a file here, so nothing is held in memory: a database is tens of
# megabytes and a shell that buffers it is a shell that fails on a Pi.
if ! ssh "$host" "cd '$dir' && docker compose -f '$compose_file' exec -T $service cat '$newest'" </dev/null > "$landing.part"; then
    rm -f "$landing.part"
    die "the copy could not be read off $host: check that the stand is up (docker compose ps) and that $dir is its directory"
fi

# Opened here, before it is given the name of a backup. A file under the right
# name that turns out to be truncated is worse than no file: it is the one
# somebody reaches for.
if ! check_database "$landing.part" "$name"; then
    rm -f "$landing.part"
    die "what arrived is not a whole $app database - the copy was not kept"
fi

mv "$landing.part" "$landing"
say "kept $landing ($(file_size "$landing"))"

# Old copies go by the date in the name, the same rule the server prunes by.
# A file that is not one of these is left alone: this deletes, and a delete
# that guesses eventually guesses wrong.
copies=$(ls -1 "$to"/$app-????-??-??.db 2>/dev/null | sort || true)
count=$(printf '%s' "$copies" | grep -c . || true)
if [ "$count" -gt "$keep" ]; then
    drop=$((count - keep))
    printf '%s\n' "$copies" | head -n "$drop" | while IFS= read -r old; do
        rm -f "$old"
        say "dropped $(basename "$old")"
    done
fi

kept=$(ls -1 "$to"/$app-????-??-??.db 2>/dev/null | wc -l | tr -d ' ')
say "done: $kept $([ "$kept" -eq 1 ] && echo copy || echo copies) in $to"
