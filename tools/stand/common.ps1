# Shared by the three stand scripts. Dot-sourced, never run.
#
# The same words and the same checks as `common.sh`, for the machine the
# author actually publishes from. Written for Windows PowerShell 5.1, which is
# what a Windows machine has without installing anything: no `&&`, no ternary,
# no null-coalescing.

$ErrorActionPreference = 'Stop'

# The name of the script that dot-sourced this, for the prefix on every line.
$script:StandWho = [System.IO.Path]::GetFileNameWithoutExtension($MyInvocation.PSCommandPath)
if (-not $script:StandWho) { $script:StandWho = 'stand' }

function Set-StandName($name) {
    $script:StandWho = $name
}

function Say($message) {
    Write-Host "$($script:StandWho): $message"
}

# A refusal is one line naming what to fix. `Write-Error` would wrap the same
# sentence in a stack trace pointing at this script, which reads as a bug in
# the tool rather than a value the caller has not set yet.
function Stop-WithReason($reason) {
    [Console]::Error.WriteLine("$($script:StandWho): $reason")
    exit 1
}

# A value that must be set, with the sentence that says what to put in it.
# Checked before anything is copied or started: a script that fails halfway
# across a network has already changed the stand.
function Get-Required($name, $hint) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if (-not $value) { Stop-WithReason "$name is not set: $hint" }
    return $value
}

# A `.env` beside the repository, for the values a person would otherwise
# retype. Values already in the environment win, which is what makes a one-off
# run against another machine an assignment on the command line rather than an
# edit.
function Import-StandEnv($file) {
    if (-not (Test-Path $file)) { return }
    # Read as UTF-8 rather than by the console's codepage. Windows PowerShell
    # 5.1 decodes a file without a BOM using the system's ANSI codepage, so a
    # non-ASCII path comes back as mojibake and a script refuses a directory
    # that is plainly there.
    foreach ($line in Get-Content $file -Encoding UTF8) {
        if ($line -notmatch '^\s*RHAPSOD_[A-Z_]+\s*=') { continue }
        $pair = $line.Split('=', 2)
        $name = $pair[0].Trim()
        # Quotes are how a value with a space is written in a .env file; they
        # are not part of the value.
        $value = $pair[1].Trim().Trim('"').Trim("'")
        if (-not [Environment]::GetEnvironmentVariable($name)) {
            [Environment]::SetEnvironmentVariable($name, $value)
        }
    }
}

# Whether a file is a whole database of this product's.
#
# `integrity_check` reads every page and every index, so it answers the
# question that matters - can this be read back - rather than the one a file
# size answers. The tables are queried too: a structurally perfect copy of
# somebody else's database passes the check and would restore a stand to
# nothing.
#
# A missing `sqlite3` is a refusal with the package name in it, not a silent
# pass: a check that quietly says yes when it cannot look is the worst of the
# three answers.
function Test-StandDatabase($file) {
    if (-not (Test-Path $file)) {
        [Console]::Error.WriteLine("$($script:StandWho): $file is not there")
        return $false
    }
    if ((Get-Item $file).Length -eq 0) {
        [Console]::Error.WriteLine("$($script:StandWho): $file is empty")
        return $false
    }

    $sqlite = Get-Command sqlite3 -ErrorAction SilentlyContinue
    if (-not $sqlite) {
        [Console]::Error.WriteLine("$($script:StandWho): sqlite3 is not installed, so the copy cannot be checked.")
        [Console]::Error.WriteLine("$($script:StandWho): install it (winget install SQLite.SQLite) and run this again.")
        return $false
    }

    # A URI with mode=ro, so the check cannot create or migrate what it is
    # checking: a check that made the file it was asked about would turn a
    # missing backup into a passing one.
    $uri = "file:///$(($file -replace '\\', '/') -replace '^/*', '')?mode=ro"
    $verdict = & sqlite3 $uri 'PRAGMA integrity_check;' 2>&1
    if ($LASTEXITCODE -ne 0) {
        [Console]::Error.WriteLine("$($script:StandWho): $file could not be opened: $verdict")
        return $false
    }
    if ("$verdict".Trim() -ne 'ok') {
        [Console]::Error.WriteLine("$($script:StandWho): $file is damaged: $verdict")
        return $false
    }

    # The schema, not just the format: this has to be a stand's database and
    # not merely a database.
    $rows = & sqlite3 $uri 'SELECT count(*) FROM reading_state;' 2>&1
    if ($LASTEXITCODE -ne 0) {
        [Console]::Error.WriteLine("$($script:StandWho): $file does not hold a rhapsod database: $rows")
        return $false
    }
    Say "checked $(Split-Path -Leaf $file): whole, $("$rows".Trim()) pieces of reading state"
    return $true
}

# A file's size in something a person reads.
function Get-ReadableSize($file) {
    $bytes = (Get-Item $file).Length
    if ($bytes -ge 1MB) { return "$([math]::Round($bytes / 1MB)) MB" }
    if ($bytes -ge 1KB) { return "$([math]::Round($bytes / 1KB)) kB" }
    return "$bytes bytes"
}

# Asks before something that cannot be taken back. `RHAPSOD_YES=1` answers for
# the caller; without an answer, no answer means no.
function Confirm-Stand($question) {
    if ($env:RHAPSOD_YES -in @('1', 'yes', 'true')) { return $true }
    $answer = Read-Host "$($script:StandWho): $question [y/N]"
    return $answer -in @('y', 'Y', 'yes', 'YES')
}

# Runs a command on the stand over ssh and fails loudly if it fails.
#
# `ssh` is a native executable, so a non-zero exit does not throw on its own:
# without this, every remote step would "succeed" and the script would carry
# on standing a stand up around a step that never ran.
function Invoke-OnStand($standHost, $command, $reason) {
    & ssh $standHost $command
    if ($LASTEXITCODE -ne 0) { Stop-WithReason $reason }
}
