# Moves the stand to a released version.
#
# This is what used to be done by hand after every tag: copy the volume
# somewhere safe, edit a version into `.env`, pull, up, and then curl the
# health endpoint and squint at the number.
#
# The order matters and is the reason this exists. The copy is taken *before*
# the new image starts, because a release that migrates the database is a
# release whose migration has already run by the time anything looks wrong -
# and the schema cannot be walked back.
#
#   .\tools\stand\update.ps1 v0.14.0
#   .\tools\stand\update.ps1              # whatever the repository is tagged at
#
# The compose file goes with the version: the stand's `docker-compose.yml` is
# replaced by the one the tag shipped, so a release that changes how the
# stand runs reaches the stand with the image it was written for.
#
# Configuration, from the environment or a `.env` beside the repository:
#
#   $env:RHAPSOD_STAND_HOST = 'pi'
#   $env:RHAPSOD_STAND_DIR = '/srv/rhapsod'
param([string]$Version)

$ErrorActionPreference = 'Stop'

# --- What this stand is -----------------------------------------------------
$app = 'rhapsod'
$service = 'server'
# The variable the compose file reads the image tag from.
$versionVar = 'RHAPSOD_VERSION'

$here = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $PSScriptRoot 'common.ps1')
Set-StandName 'update'
Import-StandEnv (Join-Path $here '.env')

$standHost = Get-Required 'RHAPSOD_STAND_HOST' 'name the ssh host the stand runs on (e.g. pi)'
$standDir = Get-Required 'RHAPSOD_STAND_DIR' "name the directory on that host its compose file lives in (e.g. /srv/$app)"

# The tag, or the one this checkout is standing on. Named rather than guessed
# from the manifest: a version in `Cargo.toml` is a version that is *going* to
# ship, and the image for it exists only once the tag has been built.
if (-not $Version) { $Version = Get-GitTag $here -Exact }
if (-not $Version) {
    Stop-WithReason 'name the version to move to (e.g. v0.14.0), or run this from a tagged checkout'
}
$Version = "$Version".Trim()
if ($Version -notmatch '^v') { $Version = "v$Version" }
$number = $Version.Substring(1)

# The image has to exist before the stand is stopped for it. Asked of the
# registry before anything stops, rather than discovered by a pull with the
# old container already down.
Say "looking for the image for $Version"
$image = "ghcr.io/lacodda/${app}:$number"
& ssh $standHost "docker manifest inspect '$image' > /dev/null 2>&1"
if ($LASTEXITCODE -ne 0) {
    Stop-WithReason "there is no image $image yet: the release build may still be running, or the tag was never pushed"
}
# And the compose file of that version has to be here to send, for the same
# reason: found missing after the stop, it would leave the stand down.
if (-not (Test-GitObject $here "${Version}:docker-compose.prod.yml")) {
    Stop-WithReason "$Version is not a tag in this checkout: run ``git fetch --tags`` and try again"
}

# --- The copy, before anything moves ----------------------------------------
# Taken from the running stand, and kept on the stand: this is the thing to
# roll back to, and it has to be reachable from the machine the rollback
# happens on.
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$aside = "/data/backups/$app-before-$Version-$stamp.db"
Say "copying the database aside on ${standHost}: $(Split-Path -Leaf $aside)"

# Stopped for the copy, and only for the copy. A server that stops cleanly
# closes its database, which folds the write-ahead log into the one file, so a
# plain copy is whole - and the stand is about to be stopped for the new image
# anyway.
Say 'stopping the stand for the copy'
Invoke-OnStand $standHost "cd '$standDir' && docker compose stop $service" 'the stand could not be stopped'

# A log with something in it means the server was killed rather than stopped,
# and a copy of the database alone would miss the last things the reader did.
# Refused rather than copied: a rollback copy that is quietly behind is found
# out on the day it is needed.
Invoke-InService $standHost $standDir $service "test ! -s /data/$app.db-wal" | Out-Null
if ($LASTEXITCODE -ne 0) {
    & ssh $standHost "cd '$standDir' && docker compose up -d"
    Stop-WithReason 'the stand did not close its database cleanly (its write-ahead log is not empty); it is running again and nothing was updated'
}

# Through the service, so the copy is made as the user the server runs as and
# lands in the volume the stand actually mounts.
Invoke-InService $standHost $standDir $service "mkdir -p /data/backups && cp /data/$app.db $aside" | Out-Null
if ($LASTEXITCODE -ne 0) {
    Say 'the copy could not be taken; starting the stand again and stopping here'
    & ssh $standHost "cd '$standDir' && docker compose up -d"
    Stop-WithReason 'nothing was updated: a version must not move without something to move back to'
}
Say "copied aside; a rollback restores $(Split-Path -Leaf $aside)"

# --- The version ------------------------------------------------------------
Say "sending the compose file of $Version"
Send-Compose $here $standHost $standDir $Version

# Written into `.env` on the stand rather than passed on the command line, so
# that a later `docker compose up -d` run by hand brings up the same version
# and not whatever `latest` has become.
Say "setting the version in $standDir/.env"
Invoke-OnStand $standHost "cd '$standDir' && touch .env && sed -i '/^$versionVar=/d' .env && echo '$versionVar=$number' >> .env" 'the version could not be written to .env on the stand'

Say "pulling $image"
Invoke-OnStand $standHost "cd '$standDir' && docker compose pull" "$image could not be pulled"

Say "starting $Version"
& ssh $standHost "cd '$standDir' && docker compose up -d --wait --wait-timeout 60"
if ($LASTEXITCODE -ne 0) { Say 'the stand did not report healthy - the doctor says why' }

# --- Is it the version that was asked for, and is it well? ------------------
# The doctor rather than a curl: the port answering says the process started,
# and this says the stand can do its job. Its first line is the version, so
# one command answers both questions.
Say 'asking the stand how it is'
& ssh $standHost "cd '$standDir' && docker compose exec -T $service $app doctor"
if ($LASTEXITCODE -eq 0) {
    Say "the stand is on $Version and well."
} else {
    Say 'the stand answered, and the doctor found something - the lines above say what.'
    Say "to go back, see `"Rolling back`" in the `"Moving a stand`" guide: $(Split-Path -Leaf $aside) and the old version."
    exit 1
}
