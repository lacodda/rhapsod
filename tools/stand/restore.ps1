# Stands a stand back up on a machine that has nothing on it.
#
# A Pi dies, or is replaced by a faster one, and what used to happen was a
# guide: eight commands, each one with a way of going subtly wrong, run by
# somebody holding a screwdriver. The guide is now this file.
#
# A stand is three things and only one of them is irreplaceable: the image is
# pulled again, the library is republished from the vault, and what the reader
# did exists nowhere else. So this is about one file - and about putting it in
# before the first start, because a server that opens an empty database
# migrates one into place and then the copy has nowhere to go.
#
#   .\tools\stand\restore.ps1 backups\rhapsod-2026-09-19.db
#
# Configuration, from the environment or a `.env` beside the repository:
#
#   $env:RHAPSOD_STAND_HOST = 'pi'
#   $env:RHAPSOD_STAND_DIR = '/srv/rhapsod'
#
# What this does NOT do is publish the library or set up the door. Both are
# said at the end rather than guessed at.
param([Parameter(Mandatory = $true)][string]$Copy)

$ErrorActionPreference = 'Stop'

# --- What this stand is -----------------------------------------------------
$app = 'rhapsod'
$volume = 'rhapsod_data'
$volumeData = '/data'
$composeFile = 'docker-compose.prod.yml'
$service = 'server'

$here = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $PSScriptRoot 'common.ps1')
Set-StandName 'restore'
Import-StandEnv (Join-Path $here '.env')

if (-not (Test-Path $Copy)) { Stop-WithReason "$Copy is not a file" }
$standHost = Get-Required 'RHAPSOD_STAND_HOST' 'name the ssh host to stand the stand up on (e.g. pi)'
$standDir = Get-Required 'RHAPSOD_STAND_DIR' "name the directory on that host to run it from (e.g. /srv/$app)"

# Checked here, before anything is uploaded or created. Standing a stand up
# around a file that turns out to be half a database is how an empty stand
# gets mistaken for a restored one.
Say 'checking the copy before anything is moved'
if (-not (Test-StandDatabase $Copy)) {
    Stop-WithReason "$Copy is not a whole $app database; restoring from it would build an empty stand"
}

# --- Is there already a stand there? ----------------------------------------
# The one irreversible thing in this script is putting a database into a
# volume. If a stand is already running on that host, this would be pointed at
# a machine that has a reader's real state on it.
$existing = (& ssh $standHost "docker volume ls --format '{{.Name}}' | grep -x '$volume' || true") | Select-Object -First 1
if ($existing) {
    Say "there is already a $volume volume on $standHost."
    Say "a restore writes into it, and what is in it now is somebody's reading."
    if (-not (Confirm-Stand "restore over the existing stand on ${standHost}?")) {
        Stop-WithReason 'stopped; nothing was changed'
    }
}

# --- The files the stand runs from ------------------------------------------
# `git archive`, not a copy of the working tree: it emits tracked files and
# nothing else, so a local `.env`, a `target/` of host-architecture artifacts
# and whatever else is lying about cannot travel.
Say "sending the stand's files to ${standHost}:$standDir"
Invoke-OnStand $standHost "mkdir -p '$standDir'" "$standDir could not be created on $standHost"
& cmd /c "git -C `"$here`" archive --format=tar HEAD | ssh $standHost `"tar -x -C '$standDir'`""
if ($LASTEXITCODE -ne 0) { Stop-WithReason "the stand's files could not be sent to $standHost" }

# `.env` is not in the repository and must not be: it carries the password
# hash and the paths. It travels only if it is here to travel.
$envFile = Join-Path $here '.env'
if (Test-Path $envFile) {
    Say 'sending .env (the password hash and the paths live in it)'
    & scp -q $envFile "${standHost}:$standDir/.env"
    if ($LASTEXITCODE -ne 0) { Stop-WithReason '.env could not be sent' }
} else {
    Say 'no .env here to send - the stand will need one before it starts (see below)'
}

# --- The database, before the first start -----------------------------------
# The order is the whole point. A server that starts against a volume with no
# database in it creates one and migrates it; putting the copy in afterwards
# means either overwriting a live file underneath a running server, or a
# restore that quietly does nothing.
Say "creating the $volume volume and putting the database in before anything starts"
Invoke-OnStand $standHost "docker volume create '$volume' > /dev/null" "the $volume volume could not be created on $standHost"

# Through a throwaway container with the volume mounted: the volume is
# Docker's, not a path on the host, and a Pi has no sqlite3 to do it with
# anyway. `cmd /c` for the redirect, so the bytes are not decoded as text.
$remote = "docker run --rm -i -v '${volume}:$volumeData' alpine sh -c 'cat > $volumeData/$app.db'"
& cmd /c "ssh $standHost `"$remote`" < `"$Copy`""
if ($LASTEXITCODE -ne 0) { Stop-WithReason "the database could not be written into $volume on $standHost" }

# Read back from inside the volume, not trusted because the copy went in. The
# thing being checked is what is on the other machine now.
Say 'checking the database that is now in the volume'
Invoke-OnStand $standHost "docker run --rm -v '${volume}:$volumeData' alpine sh -c 'ls -l $volumeData/$app.db'" 'the database is not in the volume'

# --- Up ---------------------------------------------------------------------
Say 'pulling the image and starting the stand'
Invoke-OnStand $standHost "cd '$standDir' && docker compose -f '$composeFile' pull && docker compose -f '$composeFile' up -d" 'the stand could not be started'

# --- Is it well? ------------------------------------------------------------
# The product's own answer, against the configuration the server is actually
# running on. A curl from here would say the port answers; this says whether
# the stand can do its job.
Say 'asking the stand how it is'
& ssh $standHost "cd '$standDir' && docker compose -f '$composeFile' exec -T $service $app doctor"
if ($LASTEXITCODE -eq 0) {
    Say 'the stand is up and well.'
} else {
    # Not a failure of this script: a restored stand with no library yet is
    # exactly what is expected at this point.
    Say 'the stand is up, and the doctor found something - the lines above say what.'
    Say 'an empty library is normal here: nothing has been published to this machine yet.'
}

Write-Host ''
Say "what is left, and neither of them is this script's to do:"
Say '  1. publish the library:  .\tools\publish-content.ps1'
Say '  2. put the door back up: see the "Behind a door" guide - the certificate'
Say "     and the name belong to the proxy, not to $app"
Say 'then run the doctor again; every line should be ok.'
