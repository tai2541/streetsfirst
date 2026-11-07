# Fetch raw Seattle data into data/raw/. Safe to re-run; overwrites previous downloads.
# Usage: powershell -ExecutionPolicy Bypass -File pipeline/fetch.ps1
param(
  [string]$Since = (Get-Date).AddYears(-5).ToString('yyyy-01-01')  # collisions + requests window
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$raw  = Join-Path $root 'data\raw'
New-Item -ItemType Directory -Force $raw | Out-Null

# ---- 1. SDOT collisions (ArcGIS FeatureServer, 2000 records per page) ----
$svc = 'https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/SDOT_Collisions_All_Years_1/FeatureServer/0/query'
$fields = 'INCKEY,INTKEY,LOCATION,ADDRTYPE,INCDATE,MAXSEVERITYDESC,PERSONCOUNT,PEDCOUNT,PEDCYLCOUNT,VEHCOUNT,INJURIES,SERIOUSINJURIES,FATALITIES,WEATHER,ROADCOND,LIGHTCOND,ST_COLDESC,SPEEDING,UNDERINFL'
$where = "INCDATE >= DATE '$Since'"
Remove-Item "$raw\collisions_*.json" -ErrorAction SilentlyContinue
$offset = 0; $page = 0
do {
  $q = @{ where = $where; outFields = $fields; outSR = 4326; f = 'geojson'
          orderByFields = 'INCKEY'; resultOffset = $offset; resultRecordCount = 2000 }
  $qs = ($q.GetEnumerator() | ForEach-Object { "$($_.Key)=$([uri]::EscapeDataString([string]$_.Value))" }) -join '&'
  $file = Join-Path $raw ('collisions_{0:D3}.json' -f $page)
  Invoke-WebRequest "$svc`?$qs" -OutFile $file -UseBasicParsing -TimeoutSec 120
  $n = ((Get-Content $file -Raw | ConvertFrom-Json).features).Count
  Write-Host "collisions page $page : $n"
  $offset += 2000; $page++
} while ($n -eq 2000)

# ---- 2. Find It Fix It requests: infrastructure types only (no encampment/parking/etc.) ----
$types = @(
  'Pothole','Street Sign Maintenance','Streetlight Maintenance','Traffic Signal Maintenance',
  'Clogged Storm Drain','Bicycle Facility Maintenance','Damaged Sidewalk','Snow and Ice',
  'Safe Routes to School','ADA Request (Transportation)'
)
$in = ($types | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }) -join ','
$soql = "`$select=servicerequestnumber,webintakeservicerequests,createddate,servicerequeststatusname,location,latitude,longitude,councildistrict" +
        "&`$where=createddate >= '$Since' AND webintakeservicerequests in ($in) AND latitude IS NOT NULL" +
        "&`$order=servicerequestnumber&`$limit=2000000"
$u = 'https://cos-data.seattle.gov/resource/5ngg-rpne.csv?' + ($soql -replace ' ', '%20' -replace "'", '%27')
Invoke-WebRequest $u -OutFile (Join-Path $raw 'service_requests.csv') -UseBasicParsing -TimeoutSec 600
Write-Host "service requests: $((Get-Content (Join-Path $raw 'service_requests.csv')).Count - 1)"

# ---- 3. Capital budget (all departments, all years; small) ----
Invoke-WebRequest 'https://cos-data.seattle.gov/resource/m6va-m4qe.csv?$limit=1000000' `
  -OutFile (Join-Path $raw 'capital_budget.csv') -UseBasicParsing -TimeoutSec 300
Write-Host "capital budget rows: $((Get-Content (Join-Path $raw 'capital_budget.csv')).Count - 1)"

Set-Content (Join-Path $raw 'fetched_at.txt') (Get-Date).ToString('yyyy-MM-dd HH:mm')
