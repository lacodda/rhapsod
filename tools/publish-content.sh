#!/usr/bin/env bash
# Publishes a library to a stand and makes the server pick it up.
#
# The content is files and stays files (ADR 0002): publishing is a copy, and
# the only thing the server is asked to do afterwards is read the directory
# again. Nothing here writes to the library, and nothing here touches the
# database - what a reader remembers survives a republish untouched.
#
# Configuration is environment only, so the script carries no addresses of its
# own and a checkout of this repository names nobody's machine:
#
#   RHAPSOD_PUBLISH_SRC=./library
#   RHAPSOD_PUBLISH_HOST=pi
#   RHAPSOD_PUBLISH_DEST=/srv/rhapsod/content
#   RHAPSOD_PUBLISH_URL=http://pi:8084
#
#   ./tools/publish-content.sh
set -euo pipefail

# A `.env` next to the repository is the same file the server reads in
# development, so one place holds both halves of a local setup. Values already
# in the environment win, which is what makes a one-off publish to a different
# stand a prefix on the command line rather than an edit.
env_file="$(dirname "$0")/../.env"
if [ -f "$env_file" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            RHAPSOD_PUBLISH_*=*) ;;
            *) continue ;;
        esac
        name=${line%%=*}
        value=${line#*=}
        # Quotes are how a path with a space is written in a .env file; they
        # are not part of the path.
        value=${value%\"}
        value=${value#\"}
        value=${value%\'}
        value=${value#\'}
        # `-` after the name: only set what the environment has not already.
        eval "export ${name}=\"\${${name}:-\$value}\""
    done < "$env_file"
fi

: "${RHAPSOD_PUBLISH_URL:=http://localhost:8084}"

die() {
    echo "publish-content: $1" >&2
    exit 1
}

# Every requirement is checked before anything is copied: a publish that fails
# halfway across a network has already changed the stand.
[ -n "${RHAPSOD_PUBLISH_SRC:-}" ] || die "RHAPSOD_PUBLISH_SRC is not set: point it at the local library directory to publish (e.g. ./library)"
[ -n "${RHAPSOD_PUBLISH_HOST:-}" ] || die "RHAPSOD_PUBLISH_HOST is not set: name the ssh host to publish to (e.g. pi)"
[ -n "${RHAPSOD_PUBLISH_DEST:-}" ] || die "RHAPSOD_PUBLISH_DEST is not set: name the directory on the host to publish into (e.g. /srv/rhapsod/content)"
[ -d "$RHAPSOD_PUBLISH_SRC" ] || die "RHAPSOD_PUBLISH_SRC is not a directory: $RHAPSOD_PUBLISH_SRC"

# The trailing slash is what makes rsync copy the *contents* of the directory
# rather than nest it inside the destination. Getting this wrong turns
# /srv/rhapsod/content into /srv/rhapsod/content/library and indexes to zero
# pieces, so it is normalised here rather than left to whoever sets the
# variable.
src=${RHAPSOD_PUBLISH_SRC%/}
dest=${RHAPSOD_PUBLISH_DEST%/}
target="$RHAPSOD_PUBLISH_HOST:$dest"

if command -v rsync >/dev/null 2>&1; then
    # `--delete` is the point of preferring rsync: a piece removed from the
    # source has to disappear from the stand, and a copy that only ever adds
    # leaves deleted pieces on the shelf forever.
    echo "publish-content: rsync $src/ -> $target/ (with --delete)"
    rsync -a --delete "$src/" "$target/"
    copier=rsync
else
    # Windows usually has ssh and scp but no rsync. scp cannot delete, so the
    # removal is done explicitly before the copy: same end state, one more
    # round trip, and the whole directory on the wire instead of the diff.
    echo "publish-content: rsync not found, falling back to scp"
    echo "publish-content: clearing $target/ so removed pieces do not survive"
    # The contents go, the directory itself stays. Removing and recreating it
    # would give a new inode, and a container that bind-mounts this path keeps
    # the old one: the files land on the host and the server serves an empty
    # library forever. Cost the stand its first deployment.
    ssh "$RHAPSOD_PUBLISH_HOST" "mkdir -p -- '$dest' && find '$dest' -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +"
    echo "publish-content: scp $src/. -> $target/"
    scp -r "$src/." "$target/"
    copier=scp
fi

# The server holds the index in memory, so files on disk are not yet a
# library: without this the new pieces would wait for a restart.
echo "publish-content: reindexing $RHAPSOD_PUBLISH_URL"
counts=$(curl -fsS -X POST "$RHAPSOD_PUBLISH_URL/api/reindex")

# How many files were sent, and how many the server ended up serving. A copy
# that lands on the host but not inside the container is invisible to every
# step above: the files are there, the reindex answers 200, and the reader
# gets an empty library. This happened on the stand's first deployment - a
# container started against a directory that was empty at the time keeps
# serving that emptiness - so the counts are compared rather than reported.
sent=$(find "$RHAPSOD_PUBLISH_SRC" -mindepth 2 -name '*.md' | wc -l | tr -d ' ')
serving=$(printf '%s' "$counts" | tr -dc '0-9,' | cut -d, -f1)
sent=${sent:-0}
serving=${serving:-0}

echo "publish-content: published with $copier; the server now serves $counts"

if [ "${serving:-0}" -eq 0 ] && [ "$sent" -gt 0 ]; then
    echo "publish-content: sent $sent pieces but the server serves none." >&2
    echo "publish-content: the files reached the host; the server is not seeing them." >&2
    echo "publish-content: restart it so it picks the directory up: docker compose restart" >&2
    exit 1
fi
