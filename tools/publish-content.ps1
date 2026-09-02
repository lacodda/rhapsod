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
#   $env:RHAPSOD_PUBLISH_SRC = './library'
#   $env:RHAPSOD_PUBLISH_HOST = 'pi'
#   $env:RHAPSOD_PUBLISH_DEST = '/srv/rhapsod/content'
#   $env:RHAPSOD_PUBLISH_URL = 'http://pi:8084'
#   $env:RHAPSOD_PUBLISH_TOPICS = './plan.md'   # optional: what could be written
#
#   .\tools\publish-content.ps1
#
# Written for Windows PowerShell 5.1, which is what a Windows machine has
# without installing anything: no `&&`, no ternary, no null-coalescing.

$ErrorActionPreference = 'Stop'

# A refusal is one line naming what to fix. `Write-Error` would wrap the same
# sentence in a stack trace pointing at this script, which reads as a bug in
# the tool rather than a variable the caller has not set yet.
function Stop-WithReason($reason) {
    [Console]::Error.WriteLine("publish-content: $reason")
    exit 1
}

# A `.env` next to the repository is the same file the server reads in
# development, so one place holds both halves of a local setup. Values already
# in the environment win, which is what makes a one-off publish to a different
# stand an assignment on the command line rather than an edit.
$envFile = Join-Path (Split-Path -Parent $PSScriptRoot) '.env'
if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
        if ($line -notmatch '^\s*RHAPSOD_PUBLISH_[A-Z_]+\s*=') { continue }
        $pair = $line.Split('=', 2)
        $name = $pair[0].Trim()
        # Quotes are how a path with a space is written in a .env file; they
        # are not part of the path.
        $value = $pair[1].Trim().Trim('"').Trim("'")
        $existing = [Environment]::GetEnvironmentVariable($name, 'Process')
        if ([string]::IsNullOrWhiteSpace($existing)) {
            [Environment]::SetEnvironmentVariable($name, $value, 'Process')
        }
    }
}

$src = $env:RHAPSOD_PUBLISH_SRC
$remoteHost = $env:RHAPSOD_PUBLISH_HOST
$dest = $env:RHAPSOD_PUBLISH_DEST
$url = $env:RHAPSOD_PUBLISH_URL
if ([string]::IsNullOrWhiteSpace($url)) { $url = 'http://localhost:8084' }

# Every requirement is checked before anything is copied: a publish that fails
# halfway across a network has already changed the stand.
if ([string]::IsNullOrWhiteSpace($src)) {
    Stop-WithReason 'RHAPSOD_PUBLISH_SRC is not set: point it at the local library directory to publish (e.g. ./library)'
}
if ([string]::IsNullOrWhiteSpace($remoteHost)) {
    Stop-WithReason 'RHAPSOD_PUBLISH_HOST is not set: name the ssh host to publish to (e.g. pi)'
}
if ([string]::IsNullOrWhiteSpace($dest)) {
    Stop-WithReason 'RHAPSOD_PUBLISH_DEST is not set: name the directory on the host to publish into (e.g. /srv/rhapsod/content)'
}
if (-not (Test-Path -LiteralPath $src -PathType Container)) {
    Stop-WithReason "RHAPSOD_PUBLISH_SRC is not a directory: $src"
}

$src = $src.TrimEnd('/', '\')
$dest = $dest.TrimEnd('/')
$target = "${remoteHost}:${dest}"

$rsync = Get-Command rsync -ErrorAction SilentlyContinue
if ($null -ne $rsync) {
    # `--delete` is the point of preferring rsync: a piece removed from the
    # source has to disappear from the stand, and a copy that only ever adds
    # leaves deleted pieces on the shelf forever.
    Write-Host "publish-content: rsync $src/ -> $target/ (with --delete)"
    & rsync -a --delete "$src/" "$target/"
    if (-not $?) { Stop-WithReason 'rsync failed; nothing was reindexed' }
    $copier = 'rsync'
}
else {
    # Windows usually has ssh and scp but no rsync. scp cannot delete, so the
    # removal is done explicitly before the copy: same end state, one more
    # round trip, and the whole directory on the wire instead of the diff.
    Write-Host 'publish-content: rsync not found, falling back to scp'
    Write-Host "publish-content: clearing $target/ so removed pieces do not survive"
    # The contents go, the directory itself stays. Removing and recreating it
    # gives a new inode, and a container that bind-mounts this path keeps the
    # old one: the files land on the host and the server serves an empty
    # library forever. Cost the stand its first deployment; the shell script
    # was fixed then and this one was not.
    & ssh $remoteHost "mkdir -p -- '$dest' && find '$dest' -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +"
    if (-not $?) { Stop-WithReason 'ssh failed; nothing was copied or reindexed' }
    Write-Host "publish-content: scp $src/. -> $target/"
    & scp -r "$src/." "$target/"
    if (-not $?) { Stop-WithReason 'scp failed; the stand is in a partial state, run the script again' }
    $copier = 'scp'
}

# The plan of topics, if there is one. It travels as `topics.md` beside the
# library so the reader can ask for something that has not been written yet.
#
# Copied after the library rather than with it, and this order is not
# incidental: the plan usually lives elsewhere in the author's vault, so it is
# not in the source directory, and rsync's `--delete` would remove it as a
# stray if it arrived first.
$topics = $env:RHAPSOD_PUBLISH_TOPICS
if ($topics) {
    if (-not (Test-Path -LiteralPath $topics -PathType Leaf)) {
        Stop-WithReason "RHAPSOD_PUBLISH_TOPICS is not a file: $topics"
    }
    Write-Host "publish-content: topics $topics -> $target/topics.md"
    & scp $topics "$target/topics.md"
    if (-not $?) { Stop-WithReason 'scp of the plan failed; the library was published without it' }
}

# The server holds the index in memory, so files on disk are not yet a
# library: without this the new pieces would wait for a restart.
Write-Host "publish-content: reindexing $url"
$counts = Invoke-RestMethod -Method Post -Uri "$url/api/reindex"

Write-Host "publish-content: published with $copier; the server now serves $($counts.pieces) pieces in $($counts.sections) sections"

# How many files were sent, and how many the server ended up serving. A copy
# that lands on the host but not inside the container is invisible to every
# step above: the files are there, the reindex answers 200, and the reader gets
# an empty library. This happened on the stand's first deployment, and the
# shell script has checked for it since; this one did not.
$sent = (Get-ChildItem -Path $src -Recurse -Filter '*.md' -File | Where-Object { $_.DirectoryName -ne (Resolve-Path $src).Path }).Count
if ($counts.pieces -eq 0 -and $sent -gt 0) {
    [Console]::Error.WriteLine("publish-content: sent $sent pieces but the server serves none.")
    [Console]::Error.WriteLine('publish-content: the files reached the host; the server is not seeing them.')
    [Console]::Error.WriteLine('publish-content: restart it so it picks the directory up: docker compose restart')
    exit 1
}
