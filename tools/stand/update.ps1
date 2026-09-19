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
# Configuration, from the environment or a `.env` beside the repository:
#
#   $env:RHAPSOD_STAND_HOST = 'pi'
#   $env:RHAPSOD_STAND_DIR = '/srv/rhapsod'
param([string]$Version)

$ErrorActionPreference = 'Stop'

# --- What this stand is -----------------------------------------------------
$app = 'rhapsod'
$volume = 'rhapsod_data'
$volumeData = '/data'
# The compose file on the stand. A setting, not a constant: how a stand is
# deployed is a fact about that machine, not something this repository gets
# to decide.
$composeFile = $env:RHAPSOD_STAND_COMPOSE
if (-not $composeFile) { $composeFile = 'docker-compose.yml' }
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
if (-not $Version) {
    $Version = (& git -C $here describe --tags --exact-match 2>$null) | Select-Object -First 1
}
if (-not $Version) {
    Stop-WithReason 'name the version to move to (e.g. v0.14.0), or run this from a tagged checkout'
}
$Version = "$Version".Trim()
if ($Version -notmatch '^v') { $Version = "v$Version" }
$number = $Version.Substring(1)

# The image has to exist before the stand is stopped for it. Checked from
# here, rather than discovering it on the Pi with the old container down.
Say "looking for the image for $Version"
$image = "ghcr.io/lacodda/${app}:$number"
& ssh $standHost "docker manifest inspect '$image' > /dev/null 2>&1"
if ($LASTEXITCODE -ne 0) {
    Stop-WithReason "there is no image $image yet: the release build may still be running, or the tag was never pushed"
}

# --- The copy, before anything moves ----------------------------------------
# Taken from the running stand, and kept on the stand: this is the thing to
# roll back to, and it has to be reachable from the machine the rollback
# happens on.
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$aside = "$volumeData/backups/$app-before-$Version-$stamp.db"
Say "copying the database aside on ${standHost}: $(Split-Path -Leaf $aside)"

# Stopped for the copy, and only for the copy. A stopped server has
# checkpointed its write-ahead log into the one file, so a plain copy is
# whole - and the stand is about to be stopped for the new image anyway.
Say 'stopping the stand for the copy'
Invoke-OnStand $standHost "cd '$standDir' && docker compose -f '$composeFile' stop $service" 'the stand could not be stopped'

& ssh $standHost "docker run --rm -v '${volume}:$volumeData' alpine sh -c 'mkdir -p $volumeData/backups && cp $volumeData/$app.db $aside'"
if ($LASTEXITCODE -ne 0) {
    Say 'the copy could not be taken; starting the stand again and stopping here'
    & ssh $standHost "cd '$standDir' && docker compose -f '$composeFile' up -d"
    Stop-WithReason 'nothing was updated: a version must not move without something to move back to'
}
Say "copied aside; a rollback restores $(Split-Path -Leaf $aside)"

# --- The version ------------------------------------------------------------
# Written into `.env` on the stand rather than passed on the command line, so
# that a later `docker compose up -d` run by hand brings up the same version
# and not whatever `latest` has become.
Say "setting the version in $standDir/.env"
Invoke-OnStand $standHost "cd '$standDir' && touch .env && sed -i '/^$versionVar=/d' .env && echo '$versionVar=$number' >> .env" 'the version could not be written to .env on the stand'

Say "pulling $image"
Invoke-OnStand $standHost "cd '$standDir' && docker compose -f '$composeFile' pull" "$image could not be pulled"

Say "starting $Version"
Invoke-OnStand $standHost "cd '$standDir' && docker compose -f '$composeFile' up -d" 'the stand could not be started'

# --- Is it the version that was asked for, and is it well? ------------------
# The doctor rather than a curl: the port answering says the process started,
# and this says the stand can do its job. Its first line is the version, so
# one command answers both questions.
Say 'asking the stand how it is'
& ssh $standHost "cd '$standDir' && docker compose -f '$composeFile' exec -T $service $app doctor"
if ($LASTEXITCODE -eq 0) {
    Say "the stand is on $Version and well."
} else {
    Say 'the stand answered, and the doctor found something - the lines above say what.'
    Say "to go back: restore $(Split-Path -Leaf $aside) into the volume and set the old version in .env."
    exit 1
}
