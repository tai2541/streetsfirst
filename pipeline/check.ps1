# Checks a built site before it's published. Fails (exit 1) if anything looks wrong, so a bad build never goes live.
#   1. Data files: present, plausible sizes and counts.
#   2. The page itself, in a headless browser (Edge or Chrome): opens index.html#selftest, which draws the map and list,
#      opens the #1 spot and a place outside the ranked list, and reports PASS or FAIL in the page title.
# Usage: powershell -ExecutionPolicy Bypass -File pipeline/check.ps1 [-Dir dist]
param([string]$Dir = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Dir) { $Dir = if (Test-Path (Join-Path $root 'dist\index.html')) { 'dist' } else { 'site' } }
$site = Join-Path $root $Dir
$fails = @()

# ---- 1. data files
$dataJs = Join-Path $site 'data\data.js'
if (-not (Test-Path $dataJs)) { $fails += 'data/data.js is missing' }
else {
  $kb = (Get-Item $dataJs).Length / 1KB
  if ($kb -lt 1000) { $fails += "data/data.js is only $([int]$kb) KB" }
  if ($kb -gt 8000) { $fails += "data/data.js is $([int]$kb) KB (over 8 MB: too slow for phones; move more data to on-demand files)" }
}
$more = @(Get-ChildItem (Join-Path $site 'data\more') -Filter *.js -ErrorAction SilentlyContinue)
if ($more.Count -lt 100) { $fails += "only $($more.Count) area files in data/more" }
$big = $more | Where-Object { $_.Length -gt 3MB }
if ($big) { $fails += "area files over 3 MB: $($big.Name -join ', ')" }
foreach ($f in 'vendor\leaflet\leaflet.js', 'vendor\leaflet\leaflet.css', 'vendor\inter\inter.css', 'app.js', 'style.css', 'index.html') {
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
  $profile = Join-Path ([IO.Path]::GetTempPath()) ('ipm-check-' + [guid]::NewGuid())
  # The browser logs harmless noise to stderr; PowerShell 5.1 would treat that as a failure under 'Stop'.
  $ErrorActionPreference = 'Continue'
  $dom = & $browser --headless=new --disable-gpu --no-first-run --user-data-dir="$profile" `
    --allow-file-access-from-files --virtual-time-budget=60000 --dump-dom $url 2>$null | Out-String
  $ErrorActionPreference = 'Stop'
  Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue
  $title = if ($dom -match '<title>([^<]*)</title>') { $Matches[1] } else { '(no title)' }
  if ($title -ne 'SELFTEST PASS') { $fails += "page self-test: $title" }
  else { Write-Host 'page self-test: PASS' }
}

if ($fails) { $fails | ForEach-Object { Write-Host "CHECK FAILED: $_" }; exit 1 }
Write-Host "All checks passed ($Dir)."
