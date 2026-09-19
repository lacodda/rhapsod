# Shared by the three stand scripts. Sourced, never run.
#
# The three of them say the same things in the same words - a refusal names
# what to set, a step says what it is doing before it does it - and the
# checking of a database file is the one piece of real logic they share. Three
# copies of that would drift, and the one that drifted would be the one
# deciding whether a backup is any good.
#
# POSIX shell throughout: this runs on a Pi, in Git Bash on Windows, and in
# whatever /bin/sh a rescue image has.

# The name of the script that sourced this, for the prefix on every line.
# Taken from `$0` so each script says its own name without repeating it.
_stand_who=${0##*/}
_stand_who=${_stand_who%.sh}

say() {
    echo "$_stand_who: $1"
}

# A refusal is one line naming what to fix, on stderr, and then nothing.
die() {
    echo "$_stand_who: $1" >&2
    exit 1
}

# A variable that must be set, with the sentence that says what to put in it.
# Checked before anything is copied or started: a script that fails halfway
# across a network has already changed the stand.
need() {
    eval "value=\${$1:-}"
    [ -n "$value" ] || die "$1 is not set: $2"
}

# A `.env` beside the repository, for the values a person would otherwise
# retype. Values already in the environment win, which is what makes a one-off
# run against another machine a prefix on the command line rather than an edit.
#
# Only this product's own variables are read, and only ones shaped like a
# name: a `.env` is a file people put things in, and sourcing it would run
# whatever is in there.
load_env() {
    file="$1"
    [ -f "$file" ] || return 0
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            RHAPSOD_*=*) ;;
            *) continue ;;
        esac
        name=${line%%=*}
        value=${line#*=}
        # Quotes are how a value with a space is written in a .env file; they
        # are not part of the value.
        value=${value%\"}
        value=${value#\"}
        value=${value%\'}
        value=${value#\'}
        eval "export ${name}=\"\${${name}:-\$value}\""
    done < "$file"
}

# Whether a file is a whole database of this product's.
#
# `integrity_check` reads every page and every index, so it answers the
# question that matters - can this be read back - rather than the one a file
# size answers. The tables are queried too: a structurally perfect copy of
# somebody else's database passes the check and would restore a stand to
# nothing.
#
# Needs `sqlite3`. A Pi usually has none and neither does the container image,
# which is why this runs at the end that keeps the copies rather than on the
# stand - and why a missing `sqlite3` is a refusal with the package name in
# it, not a silent pass. A check that quietly says yes when it cannot look is
# the worst of the three answers.
check_database() {
    file="$1"
    # The name to say in the report. A copy is checked under a temporary name
    # so a failed one never exists under the real one, and "rhapsod-...db.part
    # is whole" reads as a different file from the one being kept.
    shown=${2:-$(basename "$file")}
    [ -s "$file" ] || { echo "$_stand_who: $file is empty" >&2; return 1; }

    command -v sqlite3 >/dev/null 2>&1 || {
        echo "$_stand_who: sqlite3 is not installed, so the copy cannot be checked." >&2
        echo "$_stand_who: install it (apt install sqlite3, or winget install SQLite.SQLite) and run this again." >&2
        return 1
    }

    verdict=$(sqlite3 "file:$file?mode=ro" 'PRAGMA integrity_check;' 2>&1) || {
        echo "$_stand_who: $file could not be opened: $verdict" >&2
        return 1
    }
    [ "$verdict" = "ok" ] || {
        echo "$_stand_who: $file is damaged: $verdict" >&2
        return 1
    }

    # The schema, not just the format: this has to be a stand's database and
    # not merely a database.
    rows=$(sqlite3 "file:$file?mode=ro" 'SELECT count(*) FROM reading_state;' 2>&1) || {
        echo "$_stand_who: $file does not hold a $app database: $rows" >&2
        return 1
    }
    say "checked $shown: whole, $rows pieces of reading state"
    return 0
}

# A file's size in something a person reads, without depending on which `stat`
# or `du` this machine has.
file_size() {
    bytes=$(wc -c < "$1" | tr -d ' ')
    if [ "$bytes" -ge 1048576 ]; then
        echo "$((bytes / 1048576)) MB"
    elif [ "$bytes" -ge 1024 ]; then
        echo "$((bytes / 1024)) kB"
    else
        echo "$bytes bytes"
    fi
}

# Asks the reader before something that cannot be taken back. `-y` on the
# command line, or a non-interactive shell with `RHAPSOD_YES=1`, answers for
# them; without either, no answer means no.
confirm() {
    case "${RHAPSOD_YES:-}" in
        1 | yes | true) return 0 ;;
    esac
    printf '%s: %s [y/N] ' "$_stand_who" "$1"
    read -r answer </dev/tty 2>/dev/null || answer=
    case "$answer" in
        y | Y | yes | YES) return 0 ;;
        *) return 1 ;;
    esac
}

load_env "$here/.env"
