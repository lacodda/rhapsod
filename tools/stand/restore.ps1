# Stands a stand back up on a machine that has nothing on it.
#
# A Pi dies, or is replaced by a faster one, and what used to happen was a
# guide: eight commands, each one with a way of going subtly wrong, run by
# somebody holding a screwdriver. The guide is now this file.
#
# A stand is an image, a library, a database and its settings. The image is
# pulled again and the library is republished from the vault; what the reader
# did exists nowhere else, and neither does the password that locked it. So
# this is about two files from the backup - and about putting the database in
# before the first start, because a server that opens an empty volume
# migrates a database into place and then the copy has nowhere to go.
#
#   .\tools\stand\restore.ps1 backups\rhapsod-2026-09-19.db [v0.15.0]
#
# The version defaults to the newest tag of this checkout: an older image
# cannot open a database a newer one has migrated.
#
# Configuration, from the environment or a `.env` beside the repository:
#
#   $env:RHAPSOD_STAND_HOST = 'pi'
#   $env:RHAPSOD_STAND_DIR = '/srv/rhapsod'
#
# What this does NOT do is publish the library or set up the door. Both are
# said at the end rather than guessed at.
param(
    [Parameter(Mandatory = $true)][string]$Copy,
    [string]$Version
)

$ErrorActionPreference = 'Stop'

# --- What this stand is -----------------------------------------------------
$app = 'rhapsod'
$service = 'server'

$here = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $PSScriptRoot 'common.ps1')
Set-StandName 'restore'
Import-StandEnv (Join-Path $here '.env')

if (-not (Test-Path -LiteralPath $Copy -PathType Leaf)) { Stop-WithReason "$Copy is not a file" }
$Copy = (Resolve-Path -LiteralPath $Copy).Path
$standHost = Get-Required 'RHAPSOD_STAND_HOST' 'name the ssh host to stand the stand up on (e.g. pi)'
$standDir = Get-Required 'RHAPSOD_STAND_DIR' "name the directory on that host to run it from (e.g. /srv/$app)"

if (-not $Version) { $Version = Get-GitTag $here }
if (-not $Version) { Stop-WithReason 'name the version to stand up (e.g. v0.15.0): this checkout has no tags' }
if ($Version -notmatch '^v') { $Version = "v$Version" }
$number = $Version.Substring(1)

# Checked here, before anything is uploaded or created. Standing a stand up
# around a file that turns out to be half a database is how an empty stand
# gets mistaken for a restored one.
Say 'checking the copy before anything is moved'
if (-not (Test-StandDatabase $Copy)) {
    Stop-WithReason "$Copy is not a whole $app database; restoring from it would build an empty stand"
}

# The stand's own settings, which `backup` brings along beside the copies.
# Without them the stand comes back with the defaults - and open, whatever it
# was before, which is said rather than discovered.
$settings = Join-Path (Split-Path -Parent $Copy) "$app-stand.env"
$lines = @()
if (Test-Path -LiteralPath $settings) {
    Say "using the stand's settings from $(Split-Path -Leaf $settings)"
    $lines = @(Get-Content -LiteralPath $settings -Encoding UTF8 | Where-Object { $_ -and $_ -notmatch '^RHAPSOD_VERSION=' })
} else {
    Say "no $app-stand.env beside the copy: the stand gets the default settings"
}
$content = ''
foreach ($line in $lines) {
    if ($line -match '^RHAPSOD_CONTENT=(.*)$') { $content = $Matches[1].Trim().Trim('"').Trim("'") }
}
if (-not $content) {
    $content = "$standDir/content"
    $lines += "RHAPSOD_CONTENT=$content"
}
$lines += "RHAPSOD_VERSION=$number"

# --- Can this machine run a stand at all? -----------------------------------
# Asked before anything is written, so a machine that is missing something
# ends up with nothing on it rather than half a stand.
Say "looking at $standHost"
# Reached first, with ssh's own words left on screen: a machine rebuilt under
# an old name presents a new host key, ssh refuses it, and every check after
# this would blame something else.
& ssh $standHost true
if ($LASTEXITCODE -ne 0) {
    Stop-WithReason "$standHost cannot be reached over ssh (the lines above say why); a machine rebuilt under the same name needs ``ssh-keygen -R $standHost`` first"
}
& cmd /c "ssh $standHost `"docker compose version`" >nul 2>nul"
if ($LASTEXITCODE -ne 0) {
    Stop-WithReason "$standHost has no docker with the compose plugin for this user: install Docker Engine and add the user to the docker group"
}
& cmd /c "ssh $standHost `"mkdir -p '$standDir' && test -w '$standDir'`" 2>nul"
if ($LASTEXITCODE -ne 0) {
    Stop-WithReason "$standDir cannot be created or written on $standHost by this user: make it with ``sudo install -d -o `$USER $standDir``"
}

$image = "ghcr.io/lacodda/${app}:$number"
& ssh $standHost "docker manifest inspect '$image' > /dev/null 2>&1"
if ($LASTEXITCODE -ne 0) {
    Stop-WithReason "there is no image ${image}: the release build may still be running, or the tag was never pushed"
}

# --- Is there already a stand there? ----------------------------------------
# The one irreversible thing in this script is putting a database into a
# volume. A compose file in the directory means a stand lives there, and what
# is in its volume is somebody's reading.
$confirmed = $false
& ssh $standHost "test -f '$standDir/docker-compose.yml'"
if ($LASTEXITCODE -eq 0) {
    Say "there is already a stand in $standDir on $standHost."
    Say "a restore replaces its database, and what is in it now is somebody's reading."
    if (-not (Confirm-Stand "restore over the stand in ${standHost}:${standDir}?")) {
        Stop-WithReason 'stopped; nothing was changed'
    }
    $confirmed = $true
    Say 'stopping it, so nothing writes underneath the copy'
    Invoke-OnStand $standHost "cd '$standDir' && docker compose stop $service" 'the stand could not be stopped'
}

# --- The files the stand runs from ------------------------------------------
# Two files and nothing else: the compose file of the version being stood up,
# and the stand's own settings. Not the repository - the stand pulls the image
# the release built, and source on a Pi is only something to compile by
# mistake.
Say "sending the compose file of $Version to ${standHost}:$standDir"
Send-Compose $here $standHost $standDir $Version

# Written here with LF and no byte-order mark, then copied: a `.env` with
# either would hand compose a variable whose name or value ends in garbage.
Say "writing $standDir/.env"
$staged = [System.IO.Path]::GetTempFileName()
try {
    [System.IO.File]::WriteAllText($staged, (($lines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
    & scp -q $staged "${standHost}:$standDir/.env"
    if ($LASTEXITCODE -ne 0) { Stop-WithReason "the settings could not be written to ${standHost}:$standDir/.env" }
} finally {
    Remove-Item -LiteralPath $staged -ErrorAction SilentlyContinue
}

# Made by this user, before compose sees it: a directory compose has to make
# for a mount is made by root, and the publishing script, which copies into it
# as this user, would be refused.
Say "making the library directory $content"
Invoke-OnStand $standHost "mkdir -p '$content'" "$content could not be created on $standHost"

# --- The database, before the first start -----------------------------------
# A volume left behind by an earlier stand in a directory of the same name is
# the same volume to compose. Asked about through the service, which is the
# only way to be asking about the volume the stand will actually mount.
if (-not $confirmed) {
    Invoke-InService $standHost $standDir $service "test -e /data/$app.db" | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Say 'the volume this stand uses already holds a database, left by an earlier stand.'
        if (-not (Confirm-Stand "replace it with $(Split-Path -Leaf $Copy)?")) {
            Stop-WithReason "stopped; the volume was not touched (the compose file and .env in $standDir were written)"
        }
    }
}

# The order is the whole point. A server that starts against a volume with no
# database in it creates one and migrates it; putting the copy in afterwards
# means either overwriting a live file underneath a running server, or a
# restore that quietly does nothing.
#
# Written under another name and moved, so a transfer cut halfway leaves the
# old file rather than half a new one. The write-ahead log beside the old file
# goes with it: a log left beside a different database is replayed into it.
# `cmd /c` for the redirect, so the bytes are not decoded as text.
Say 'putting the database in before anything starts'
$write = "cat > /data/$app.db.part && rm -f /data/$app.db-wal /data/$app.db-shm && mv /data/$app.db.part /data/$app.db"
& cmd /c "ssh $standHost `"cd '$standDir' && docker compose --progress quiet run --rm --no-deps -T $service sh -c '$write'`" < `"$Copy`""
if ($LASTEXITCODE -ne 0) { Stop-WithReason "the database could not be written into the stand's volume on $standHost" }

# Read back from inside the volume, not trusted because the copy went in. The
# thing being checked is what is on the other machine now.
Say 'checking the database that is now in the volume'
$there = "$(Invoke-InService $standHost $standDir $service "sha256sum /data/$app.db")".Split(' ')[0]
if ($there -ne (Get-StandHash $Copy)) {
    Stop-WithReason 'the database in the volume is not the copy that was sent; nothing was started'
}
Say "the volume holds $(Split-Path -Leaf $Copy), byte for byte"

# --- Up ---------------------------------------------------------------------
Say "pulling $image and starting the stand"
& ssh $standHost "cd '$standDir' && docker compose pull && docker compose up -d --wait --wait-timeout 60"
if ($LASTEXITCODE -ne 0) { Say 'the stand did not report healthy - the doctor says why' }

# --- Is it well? ------------------------------------------------------------
# The product's own answer, against the configuration the server is actually
# running on. A curl from here would say the port answers; this says whether
# the stand can do its job.
Say 'asking the stand how it is'
& ssh $standHost "cd '$standDir' && docker compose exec -T $service $app doctor"
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
Say "  1. publish the library into ${content}:  .\tools\publish-content.ps1"
Say '  2. put the door back up: see the "Behind a door" guide - the certificate'
Say "     and the name belong to the proxy, not to $app"
Say 'then run the doctor again; every line should be ok.'
