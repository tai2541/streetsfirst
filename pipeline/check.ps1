# Checks a built site before it's published. Fails (exit 1) if anything looks wrong, so a bad build never goes live.
#   1. Data files: present, plausible sizes and counts.
#   2. The page itself, in a headless browser (Edge or Chrome): opens index.html#selftest, which draws the map and list,
#      opens the #1 spot and a place outside the ranked list, and reports PASS or FAIL in the page title.
# Usage: powershell -ExecutionPolicy Bypass -File pipeline/check.ps1 [-Dir dist]
param([string]$Dir = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
# The published copy keeps each city in its own folder (dist\seattle\), with a top-level page that sends visitors there.
if (-not $Dir) { $Dir = if (Test-Path (Join-Path $root 'dist\seattle\index.html')) { 'dist\seattle' } else { 'site' } }
$site = Join-Path $root $Dir
$fails = @()
if ($Dir -match '^dist[\\/]') {
  foreach ($f in 'index.html', 'go.js') { if (-not (Test-Path (Join-Path $root "dist\$f"))) { $fails += "top-level dist\$f is missing" } }
}

# ---- 1. data files
$dataJs = Join-Path $site 'data\data.js'
if (-not (Test-Path $dataJs)) { $fails += 'data/data.js is missing' }
else {
  $kb = (Get-Item $dataJs).Length / 1KB
  if ($kb -lt 800) { $fails += "data/data.js is only $([int]$kb) KB" }
  if ($kb -gt 6000) { $fails += "data/data.js is $([int]$kb) KB (over 6 MB: too slow for phones' first screen; move more data to data-late.js or on-demand files)" }
}
# search, "Is it getting fixed?" and the budget
$lateJs = Join-Path $site 'data\data-late.js'
if (-not (Test-Path $lateJs)) { $fails += 'data/data-late.js is missing' }
elseif ((Get-Item $lateJs).Length / 1KB -lt 300) { $fails += "data/data-late.js is only $([int]((Get-Item $lateJs).Length / 1KB)) KB" }
$more = @(Get-ChildItem (Join-Path $site 'data\more') -Filter *.js -ErrorAction SilentlyContinue)
if ($more.Count -lt 100) { $fails += "only $($more.Count) area files in data/more" }
$addrFiles = @(Get-ChildItem (Join-Path $site 'data\addr') -Filter *.js -ErrorAction SilentlyContinue)
# none at all is allowed (the county's server was down on a run with no earlier copy: suggestions pause for a week)
if ($addrFiles.Count -gt 0 -and $addrFiles.Count -lt 60) { $fails += "only $($addrFiles.Count) address files in data/addr" }
$big = $more | Where-Object { $_.Length -gt 3MB }
if ($big) { $fails += "area files over 3 MB: $($big.Name -join ', ')" }
# Text read with the wrong encoding shows up as mangled sequences (UTF-8 dash read as ANSI, etc.). ASCII-only pattern,
# because Windows PowerShell reads this script file as ANSI.
foreach ($f in $dataJs, $lateJs) { if ((Test-Path $f) -and ([IO.File]::ReadAllText($f, [Text.Encoding]::UTF8) -match '\u00E2\u20AC|\u00C3[\u0080-\u00BF]')) { $fails += "data/$(Split-Path $f -Leaf) has garbled characters (encoding)" } }
# Every fact on the site comes from the data or a setting. pipeline/check_text.js fails on a number, year or "top N"
# typed into the page's text (each exception is on its list, with a reason), on a setting the page reads that the data
# doesn't have, and on a schedule that is no longer weekly.
$textOut = & node (Join-Path $root 'pipeline\check_text.js') 2>&1
if ($LASTEXITCODE -ne 0) { $fails += @($textOut | ForEach-Object { "$_" }) } else { Write-Host ($textOut -join "`n") }
foreach ($f in 'data\increases.csv','vendor\leaflet\leaflet.js', 'vendor\leaflet\leaflet.css', 'vendor\inter\inter.css', 'app.js', 'style.css', 'index.html', 'favicon.svg', 'favicon-32.png', 'apple-touch-icon.png', 'share.png') {
  if (-not (Test-Path (Join-Path $site $f))) { $fails += "$f is missing" }
}

# ---- 2. the page, in a headless browser
$browser = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $browser) { $fails += 'no Edge or Chrome found for the page test' }
elseif (-not $fails) {
  $url = ([Uri](Join-Path $site 'index.html')).AbsoluteUri + '#selftest'
  $userDir = Join-Path ([IO.Path]::GetTempPath()) ('ipm-check-' + [guid]::NewGuid())
  # The browser logs harmless noise to stderr; PowerShell 5.1 would treat that as a failure under 'Stop'.
  # (Edge hands off to a child process, so it's run with the call operator, which waits for its output; the CI job's
  # own time limit covers a browser that never finishes.)
  $ErrorActionPreference = 'Continue'
  $dom = & $browser --headless=new --disable-gpu --no-first-run --user-data-dir="$userDir" `
    --allow-file-access-from-files --virtual-time-budget=60000 --dump-dom $url 2>$null | Out-String
  $ErrorActionPreference = 'Stop'
  Remove-Item $userDir -Recurse -Force -ErrorAction SilentlyContinue
  $title = if ($dom -match '<title>([^<]*)</title>') { $Matches[1] } else { '(no title)' }
  if ($title -ne 'SELFTEST PASS') { $fails += "page self-test: $title" }
  else { Write-Host 'page self-test: PASS' }
}

if ($fails) { $fails | ForEach-Object { Write-Host "CHECK FAILED: $_" }; exit 1 }
Write-Host "All checks passed ($Dir)."
