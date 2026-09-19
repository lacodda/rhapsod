# Carries a copy of the stand's database off the machine it lives on.
#
# The server already takes one a day into `backups/` beside the database, and
# opens it to check it (see `rhapsod doctor`). That copy is on the same card
# as the original, which covers a database going bad and covers nothing else:
# a card that dies takes the backups with it.
#
# So this brings the newest one here, and opens it again on arrival. Two
# different checks, not one in two places: the server checks what it wrote,
# this checks what survived the network and the disk at this end.
#
# Nothing on the stand is changed, and the server is not stopped: the daily
# copy is a finished file, so there is nothing to catch mid-write.
#
#   .\tools\stand\backup.ps1 [directory]
#
# Configuration, from the environment or a `.env` beside the repository:
#
#   $env:RHAPSOD_STAND_HOST = 'pi'
#   $env:RHAPSOD_BACKUP_TO = './backups'
#   $env:RHAPSOD_BACKUP_KEEP = '14'
param([string]$To)

$ErrorActionPreference = 'Stop'

# --- What this stand is -----------------------------------------------------
# The only lines that differ between products on this Pi. Everything below is
# the same in every one of them.
$app = 'rhapsod'
$volumeData = '/data'
# The compose file on the stand. A setting, not a constant: how a stand is
# deployed is a fact about that machine, not something this repository gets
# to decide.
$composeFile = $env:RHAPSOD_STAND_COMPOSE
if (-not $composeFile) { $composeFile = 'docker-compose.yml' }
$service = 'server'

$here = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $PSScriptRoot 'common.ps1')
Set-StandName 'backup'
Import-StandEnv (Join-Path $here '.env')

if (-not $To) { $To = $env:RHAPSOD_BACKUP_TO }
if (-not $To) { $To = './backups' }
$keep = $env:RHAPSOD_BACKUP_KEEP
if (-not $keep) { $keep = 14 }
$keep = [int]$keep

$standHost = Get-Required 'RHAPSOD_STAND_HOST' 'name the ssh host the stand runs on (e.g. pi)'
$standDir = Get-Required 'RHAPSOD_STAND_DIR' "name the directory on that host its compose file lives in (e.g. /srv/$app)"

New-Item -ItemType Directory -Force -Path $To | Out-Null

# The newest daily copy, by the date in its name. The name carries the day the
# copy is *of*; a modification time is the day the file was last touched, and
# a directory copied about arrives stamped today.
Say "asking $standHost for the newest copy"
# Listed through the container, not over ssh alone: the database lives in a
# Docker volume, so this path is inside the running service and does not
# exist on the host. An `ls` on the host finds nothing and looks exactly
# like a stand that has taken no backups yet.
$listing = "cd '$standDir' && docker compose -f '$composeFile' exec -T $service sh -c 'ls -1 $volumeData/backups/$app-????-??-??.db 2>/dev/null | sort | tail -n 1'"
$newest = (& ssh $standHost $listing) | Select-Object -Last 1
if (-not $newest) {
    # The server writes one within the hour of starting. Taking a copy of the
    # live database from outside would be exactly the mid-write copy the daily
    # one exists to avoid.
    Stop-WithReason "no daily copy on $standHost yet: the server writes the first within an hour of starting, and ``$app doctor`` will say so"
}
$newest = "$newest".Trim()

$name = Split-Path -Leaf $newest
$landing = Join-Path $To $name
$part = "$landing.part"
Say "fetching $name"

# The volume is inside a container, so the file is read through the running
# service rather than from a path on the host. `exec`, not `run`: the running
# container is the stand being backed up, and a `run` on a machine where the
# volume is named differently can silently mount a new empty one.
#
# `cmd /c` with a redirect, because the bytes must land in a file without
# PowerShell decoding them as text: a pipeline here would turn a database into
# mojibake and the check below would reject what arrived.
$remote = "cd '$standDir' && docker compose -f '$composeFile' exec -T $service cat '$newest'"
& cmd /c "ssh $standHost `"$remote`" > `"$part`"" 2>$null
if ($LASTEXITCODE -ne 0) {
    Remove-Item $part -ErrorAction SilentlyContinue
    Stop-WithReason "the copy could not be read off ${standHost}: check that the stand is up (docker compose ps) and that $standDir is its directory"
}

# Opened here, before it is given the name of a backup. A file under the right
# name that turns out to be truncated is worse than no file: it is the one
# somebody reaches for.
if (-not (Test-StandDatabase $part)) {
    Remove-Item $part -ErrorAction SilentlyContinue
    Stop-WithReason "what arrived is not a whole $app database - the copy was not kept"
}

Move-Item -Force $part $landing
Say "kept $landing ($(Get-ReadableSize $landing))"

# Old copies go by the date in the name, the same rule the server prunes by. A
# file that is not one of these is left alone: this deletes, and a delete that
# guesses eventually guesses wrong.
$copies = Get-ChildItem -Path $To -Filter "$app-*.db" |
    Where-Object { $_.Name -match "^$app-\d{4}-\d{2}-\d{2}\.db$" } |
    Sort-Object Name
if ($copies.Count -gt $keep) {
    $copies | Select-Object -First ($copies.Count - $keep) | ForEach-Object {
        Remove-Item $_.FullName
        Say "dropped $($_.Name)"
    }
}

$kept = (Get-ChildItem -Path $To -Filter "$app-*.db" | Where-Object { $_.Name -match "^$app-\d{4}-\d{2}-\d{2}\.db$" }).Count
Say "done: $kept copies in $To"
