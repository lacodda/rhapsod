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
#   $env:RHAPSOD_PUBLISH_URL = 'http://pi:8084'
#   $env:RHAPSOD_EXPORT_TO = './rhapsod-export.json'
#   $env:RHAPSOD_PASSWORD = 'a good passphrase'   # only on a locked stand
#
#   .\tools\export-marks.ps1
#
# Written for Windows PowerShell 5.1, which is what a Windows machine has
# without installing anything: no `&&`, no ternary, no null-coalescing.

$ErrorActionPreference = 'Stop'

# A refusal is one line naming what to fix. `Write-Error` would wrap the same
# sentence in a stack trace pointing at this script, which reads as a bug in
# the tool rather than a variable the caller has not set yet.
function Stop-WithReason($reason) {
    [Console]::Error.WriteLine("export-marks: $reason")
    exit 1
}

# A `.env` next to the repository is the same file the server reads in
# development, so one place holds both halves of a local setup. Values already
# in the environment win, which is what makes a one-off export from a different
# stand an assignment on the command line rather than an edit.
$envFile = Join-Path (Split-Path -Parent $PSScriptRoot) '.env'
if (Test-Path $envFile) {
    # Read as UTF-8 rather than by the console's codepage. Windows PowerShell
    # 5.1 decodes a file without a BOM using the system's ANSI codepage, so a
    # non-ASCII path in this file comes back as mojibake and the script refuses
    # to publish a directory that is plainly there. The library lives in a
    # directory named in the author's own language, which is exactly the case
    # that breaks.
    foreach ($line in Get-Content $envFile -Encoding UTF8) {
        if ($line -notmatch '^\s*RHAPSOD_(PUBLISH_URL|EXPORT_TO|PASSWORD)\s*=') { continue }
        $pair = $line.Split('=', 2)
        $name = $pair[0].Trim()
        # Quotes are how a path with a space - or a passphrase with one - is
        # written in a .env file; they are not part of the value.
        $value = $pair[1].Trim().Trim('"').Trim("'")
        $existing = [Environment]::GetEnvironmentVariable($name, 'Process')
        if ([string]::IsNullOrWhiteSpace($existing)) {
            [Environment]::SetEnvironmentVariable($name, $value, 'Process')
        }
    }
}

$url = $env:RHAPSOD_PUBLISH_URL
if ([string]::IsNullOrWhiteSpace($url)) { $url = 'http://localhost:8084' }
$url = $url.TrimEnd('/')

$out = $env:RHAPSOD_EXPORT_TO
if ([string]::IsNullOrWhiteSpace($out)) { $out = './rhapsod-export.json' }

# The directory has to exist before the download rather than after: a fetch
# that succeeds and then cannot be written has already spent the round trip and
# leaves nothing to show for it.
$outDir = Split-Path -Parent $out
if ([string]::IsNullOrWhiteSpace($outDir)) { $outDir = '.' }
if (-not (Test-Path -LiteralPath $outDir -PathType Container)) {
    Stop-WithReason "the directory for RHAPSOD_EXPORT_TO does not exist: $outDir"
}

$session = $null
if (-not [string]::IsNullOrWhiteSpace($env:RHAPSOD_PASSWORD)) {
    # A locked stand keeps everything about the reading behind the session, the
    # export included. Signing in first is the whole difference; an open stand
    # needs none of this and is not asked for it.
    Write-Host "export-marks: signing in to $url"
    # `ConvertTo-Json` rather than a hand-built string, so a passphrase with a
    # quote or a backslash in it survives the trip.
    $body = @{ password = $env:RHAPSOD_PASSWORD } | ConvertTo-Json -Compress
    try {
        Invoke-RestMethod -Method Post -Uri "$url/api/session" -ContentType 'application/json' -Body $body -SessionVariable session | Out-Null
    }
    catch {
        Stop-WithReason "signing in to $url failed: RHAPSOD_PASSWORD is wrong, or the stand is not answering"
    }
}

Write-Host "export-marks: fetching $url/api/export"
# Fetched as a response rather than through `Invoke-RestMethod`, which would
# parse it invisibly and leave nothing to write out as it arrived.
try {
    if ($null -ne $session) {
        $response = Invoke-WebRequest -Uri "$url/api/export" -WebSession $session -UseBasicParsing
    }
    else {
        $response = Invoke-WebRequest -Uri "$url/api/export" -UseBasicParsing
    }
}
catch {
    if ($null -ne $session) {
        Stop-WithReason "the export could not be fetched from $url"
    }
    Stop-WithReason "the export could not be fetched from $url (a locked stand needs RHAPSOD_PASSWORD)"
}

# The bytes are decoded as UTF-8 here rather than read off `.Content`. The
# server sends `content-type: application/json` with no charset - which JSON
# does not have one, being UTF-8 by definition - and Windows PowerShell 5.1
# reads a charset-less response as Latin-1. A library in Russian comes out of
# `.Content` as mojibake, and it is written to the file that way: valid JSON,
# wrong text, and nothing complains at any step.
$stream = $response.RawContentStream
$stream.Position = 0
$raw = New-Object byte[] $stream.Length
[void]$stream.Read($raw, 0, $raw.Length)
$text = [System.Text.UTF8Encoding]::new($false).GetString($raw)

# What arrived is read back before it is written anywhere. A proxy with an
# opinion, a captive portal, or the wrong port answering cheerfully all produce
# a body that exists and is not an export - a difference only visible if
# somebody looks, so the script looks, and prints what it found.
$document = $null
try {
    $document = $text | ConvertFrom-Json
}
catch {
    Stop-WithReason "what came back from $url is not valid JSON: check that the URL names a rhapsod server"
}

$missing = @()
if ($null -eq $document.exported_at) { $missing += 'exported_at' }
foreach ($kind in @('reading', 'notes', 'quotes')) {
    if ($null -eq $document.PSObject.Properties[$kind]) { $missing += $kind }
}
if ($missing.Count -gt 0) {
    Stop-WithReason "what came back from $url is not an export, it has no $($missing -join ', '): check that the URL names a rhapsod server, and that a locked stand got RHAPSOD_PASSWORD"
}

# A single-element array comes back from ConvertFrom-Json as the element
# itself, and an empty one as $null, so the counts go through @() rather than
# through .Count - which would otherwise report 1 note as no notes at all.
$reading = @($document.reading).Count
$notes = @($document.notes).Count
$quotes = @($document.quotes).Count

# UTF-8 without a BOM: the file is read back by scripts and by the vault, and a
# BOM at the head of a JSON document is a parse error in most of them.
$encoding = New-Object System.Text.UTF8Encoding($false)
$resolved = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($out)
[System.IO.File]::WriteAllText($resolved, $text, $encoding)

Write-Host "export-marks: wrote $out"
Write-Host "export-marks: $reading pieces read, $notes notes, $quotes quotes, taken at $($document.exported_at)"
