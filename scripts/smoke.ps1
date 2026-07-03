# End-to-end smoke test: scan -> transcribe -> ready -> render -> assert 1080x1920 output.
# Run from the repo root on the host. Requires docker compose and ffprobe.
param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$studioBase = "http://localhost:3000"
$whisperBase = "http://localhost:8090"
$overall = [System.Diagnostics.Stopwatch]::StartNew()
$timings = [ordered]@{}

function Fail([string]$message) {
    Write-Host "FAIL: $message" -ForegroundColor Red
    docker compose down | Out-Null
    exit 1
}

function Wait-Until([string]$what, [int]$timeoutSec, [scriptblock]$check) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $timeoutSec) {
        $result = & $check
        if ($null -ne $result) { return $result }
        Start-Sleep -Seconds 3
    }
    Fail "timed out after ${timeoutSec}s waiting for $what"
}

# --- 1. Bring the stack up -------------------------------------------------
$step = [System.Diagnostics.Stopwatch]::StartNew()
if ($SkipBuild) {
    Write-Host "== docker compose up -d"
    docker compose up -d
} else {
    Write-Host "== docker compose up -d --build"
    docker compose up -d --build
}
if ($LASTEXITCODE -ne 0) { Fail "docker compose up exited with $LASTEXITCODE" }

Write-Host "== waiting for service health (timeout 120s)"
Wait-Until "studio /api/health" 120 {
    try { if ((Invoke-RestMethod "$studioBase/api/health" -TimeoutSec 5).status -eq "ok") { $true } } catch { $null }
} | Out-Null
Wait-Until "whisper /health" 120 {
    try { if ((Invoke-RestMethod "$whisperBase/health" -TimeoutSec 5).status -eq "ok") { $true } } catch { $null }
} | Out-Null
$timings["startup"] = $step.Elapsed

# --- 2. Scan and pick the shortest clip ------------------------------------
$step.Restart()
Write-Host "== POST /api/scan"
Invoke-RestMethod -Method Post "$studioBase/api/scan" -ContentType "application/json" -Body "{}" | Out-Null

# ForEach-Object unroll: on Windows PowerShell 5 Invoke-RestMethod can emit a JSON
# array as a single Object[] pipeline item, which @() alone would not flatten.
$clips = @(Invoke-RestMethod "$studioBase/api/clips" | ForEach-Object { $_ })
if ($clips.Count -eq 0) { Fail "no clips found after scan - is the recordings folder mounted and non-empty?" }
$clip = $clips | Where-Object { $null -ne $_.duration } | Sort-Object duration | Select-Object -First 1
if ($null -eq $clip) { $clip = $clips[0] }
Write-Host ("== picked clip #{0}: {1} ({2}s)" -f $clip.id, $clip.path, $clip.duration)
$timings["scan"] = $step.Elapsed

# --- 3. Transcribe ----------------------------------------------------------
$step.Restart()
Write-Host "== POST /api/clips/$($clip.id)/transcribe"
Invoke-RestMethod -Method Post "$studioBase/api/clips/$($clip.id)/transcribe" -ContentType "application/json" -Body "{}" | Out-Null

$clip = Wait-Until "transcription of clip $($clip.id)" 600 {
    $c = Invoke-RestMethod "$studioBase/api/clips/$($clip.id)"
    if ($c.status -notin @("new", "transcribing")) { $c } else { $null }
}
Write-Host "== transcription finished with status '$($clip.status)'"
if ($clip.status -eq "error") { Fail "transcription errored: $($clip.error)" }
$timings["transcribe"] = $step.Elapsed

# --- 4. Mark ready and render ------------------------------------------------
$step.Restart()
if ($clip.status -in @("review", "no_speech")) {
    Write-Host "== PATCH clip -> ready"
    $clip = Invoke-RestMethod -Method Patch "$studioBase/api/clips/$($clip.id)" `
        -ContentType "application/json" -Body (@{ status = "ready" } | ConvertTo-Json)
}
if ($clip.status -notin @("ready", "done")) { Fail "clip not renderable (status '$($clip.status)')" }

Write-Host "== POST /api/clips/$($clip.id)/render"
$queued = Invoke-RestMethod -Method Post "$studioBase/api/clips/$($clip.id)/render" -ContentType "application/json" -Body "{}"
if ($queued.queued -lt 1) { Fail "render was not queued" }

$clip = Wait-Until "render of clip $($clip.id)" 600 {
    $c = Invoke-RestMethod "$studioBase/api/clips/$($clip.id)"
    if ($c.status -in @("done", "error")) { $c } else { $null }
}
if ($clip.status -ne "done") { Fail "render errored: $($clip.error)" }
$timings["render"] = $step.Elapsed

# --- 5. Verify the output file ----------------------------------------------
$output = Get-ChildItem (Join-Path $repoRoot "output") -Filter *.mp4 |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($null -eq $output) { Fail "no mp4 found in ./output" }
Write-Host "== newest output: $($output.FullName)"

$dims = ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 $output.FullName
if ($LASTEXITCODE -ne 0) { Fail "ffprobe failed on $($output.FullName)" }
# ffprobe csv output can carry a trailing comma/newline depending on platform
if (($dims -join ",").Trim().TrimEnd(",") -ne "1080,1920") { Fail "expected 1080x1920 output, got '$dims'" }

# --- Summary ------------------------------------------------------------------
docker compose down | Out-Null
Write-Host ""
Write-Host "PASS" -ForegroundColor Green
Write-Host ("  clip:   #{0} {1}" -f $clip.id, $clip.path)
Write-Host ("  output: {0} ({1})" -f $output.FullName, $dims.Trim())
foreach ($key in $timings.Keys) {
    Write-Host ("  {0,-11} {1:mm\:ss}" -f "$($key):", $timings[$key])
}
Write-Host ("  total:      {0:mm\:ss}" -f $overall.Elapsed)
exit 0
