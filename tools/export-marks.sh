#!/usr/bin/env bash
# Takes everything the reader left behind off a stand and writes it to a file.
#
# The mirror of publishing: the library goes out to the stand as files, and what
# a reader made of it comes back as one JSON document. Nothing here writes to
# the library or to the database - the export is a read, and running it twice
# changes nothing but the file it produces.
#
# One request rather than one per kind: a script that turns this into markdown
# in a vault needs the reading state, the notes and the quotes to be from the
# same moment, and a snapshot taken in one call is what makes it safe to run
# while somebody is still reading.
#
# Configuration is environment only, so the script carries no addresses of its
# own and a checkout of this repository names nobody's machine:
#
#   RHAPSOD_PUBLISH_URL=http://pi:8084
#   RHAPSOD_EXPORT_TO=./rhapsod-export.json
#   RHAPSOD_PASSWORD='a good passphrase'   # only on a locked stand
#
#   ./tools/export-marks.sh
set -euo pipefail

# A `.env` next to the repository is the same file the server reads in
# development, so one place holds both halves of a local setup. Values already
# in the environment win, which is what makes a one-off export from a different
# stand a prefix on the command line rather than an edit.
env_file="$(dirname "$0")/../.env"
if [ -f "$env_file" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            RHAPSOD_PUBLISH_URL=*|RHAPSOD_EXPORT_TO=*|RHAPSOD_PASSWORD=*) ;;
            *) continue ;;
        esac
        name=${line%%=*}
        value=${line#*=}
        # Quotes are how a path with a space - or a passphrase with one - is
        # written in a .env file; they are not part of the value.
        value=${value%\"}
        value=${value#\"}
        value=${value%\'}
        value=${value#\'}
        # `-` after the name: only set what the environment has not already.
        eval "export ${name}=\"\${${name}:-\$value}\""
    done < "$env_file"
fi

: "${RHAPSOD_PUBLISH_URL:=http://localhost:8084}"
: "${RHAPSOD_EXPORT_TO:=./rhapsod-export.json}"

die() {
    echo "export-marks: $1" >&2
    exit 1
}

# Everything the script needs is checked before the first request, so a missing
# tool is a refusal rather than a downloaded file nobody can vouch for.
command -v curl >/dev/null 2>&1 || die "curl is not on this machine: it is what talks to the stand"

# The export is only worth writing if it can be read back, and reading JSON
# needs a JSON parser. jq first because it is the one people install for this;
# python otherwise, because a machine that publishes to a Pi usually has it.
if command -v jq >/dev/null 2>&1; then
    reader=jq
elif command -v python3 >/dev/null 2>&1; then
    reader=python3
elif command -v python >/dev/null 2>&1; then
    reader=python
else
    die "no jq and no python on this machine: one of them is needed to check that what the stand sends back is really an export"
fi

url=${RHAPSOD_PUBLISH_URL%/}
out=$RHAPSOD_EXPORT_TO

# The directory has to exist before the download rather than after: a fetch
# that succeeds and then cannot be written has already spent the round trip and
# leaves nothing to show for it.
out_dir=$(dirname "$out")
[ -d "$out_dir" ] || die "the directory for RHAPSOD_EXPORT_TO does not exist: $out_dir"

# Downloaded beside the destination and moved into place only once it has been
# read back, so a stand that answers with a login page cannot overwrite a good
# export with it.
tmp="$out.partial"
jar=
cleanup() {
    rm -f "$tmp"
    [ -n "$jar" ] && rm -f "$jar"
    return 0
}
trap cleanup EXIT

if [ -n "${RHAPSOD_PASSWORD:-}" ]; then
    # A locked stand keeps everything about the reading behind the session, the
    # export included. Signing in first is the whole difference; an open stand
    # needs none of this and is not asked for it.
    jar="$out.cookies"
    echo "export-marks: signing in to $url"
    # The password is put into JSON by the parser that is already required, so
    # a passphrase with a quote or a backslash in it survives the trip.
    if [ "$reader" = jq ]; then
        body=$(printf '%s' "${RHAPSOD_PASSWORD}" | jq -Rs '{password: .}')
    else
        body=$("$reader" -c 'import json,os; print(json.dumps({"password": os.environ["RHAPSOD_PASSWORD"]}))')
    fi
    printf '%s' "$body" \
        | curl -fsS -X POST "$url/api/session" -H 'content-type: application/json' -c "$jar" --data-binary @- >/dev/null \
        || die "signing in to $url failed: RHAPSOD_PASSWORD is wrong, or the stand is not answering"
fi

echo "export-marks: fetching $url/api/export"
if [ -n "$jar" ]; then
    curl -fsS "$url/api/export" -b "$jar" -o "$tmp" \
        || die "the export could not be fetched from $url"
else
    curl -fsS "$url/api/export" -o "$tmp" \
        || die "the export could not be fetched from $url (a locked stand needs RHAPSOD_PASSWORD)"
fi

# What arrived is read back before it replaces anything. A proxy with an
# opinion, a captive portal, or the wrong port answering cheerfully all produce
# a file that exists and is not an export - a difference only visible if
# somebody looks, so the script looks, and prints what it found.
if [ "$reader" = jq ]; then
    counts=$(jq -er '
        if (.exported_at | type) != "string" then error("no exported_at")
        elif (.reading | type) != "array" then error("no reading")
        elif (.notes | type) != "array" then error("no notes")
        elif (.quotes | type) != "array" then error("no quotes")
        else "\(.reading | length) \(.notes | length) \(.quotes | length) \(.exported_at)"
        end' "$tmp" 2>/dev/null) \
        || die "what came back from $url is not an export: check that the URL names a rhapsod server, and that a locked stand got RHAPSOD_PASSWORD"
else
    counts=$("$reader" -c '
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    doc = json.load(handle)
if not isinstance(doc.get("exported_at"), str):
    raise SystemExit(1)
rows = [doc.get(kind) for kind in ("reading", "notes", "quotes")]
if not all(isinstance(row, list) for row in rows):
    raise SystemExit(1)
print(len(rows[0]), len(rows[1]), len(rows[2]), doc["exported_at"])
' "$tmp" 2>/dev/null) \
        || die "what came back from $url is not an export: check that the URL names a rhapsod server, and that a locked stand got RHAPSOD_PASSWORD"
fi

# shellcheck disable=SC2086
set -- $counts

mv -f "$tmp" "$out"

echo "export-marks: wrote $out"
echo "export-marks: $1 pieces read, $2 notes, $3 quotes, taken at $4"
