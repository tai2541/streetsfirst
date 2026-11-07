# Fetch raw Seattle data into data/raw/. Safe to re-run.
# Downloads go to data/raw.tmp/ first and only replace data/raw/ if every source looks complete,
# so a failed or partial download never ends up in a published ranking.
# Usage: powershell -ExecutionPolicy Bypass -File pipeline/fetch.ps1
param(
  # 66 months back to the 1st of the month: covers the 60-month scoring window (which ends ~3 months
  # before the newest crash, because recent police reports arrive late) plus the unscored recent months.
  [string]$Since = (Get-Date -Day 1).AddMonths(-66).ToString('yyyy-MM-dd')
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$raw  = Join-Path $root 'data\raw'
$tmp  = Join-Path $root 'data\raw.tmp'
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $tmp | Out-Null
$counts = @{}

# Retry transient network failures (3 tries, backoff).
function Get-WithRetry([string]$Uri, [string]$OutFile, [int]$Timeout = 180) {
  for ($i = 1; $i -le 3; $i++) {
    try { Invoke-WebRequest $Uri -OutFile $OutFile -UseBasicParsing -TimeoutSec $Timeout; return }
    catch { if ($i -eq 3) { throw }; Write-Host "  retry $i after error: $($_.Exception.Message)"; Start-Sleep -Seconds (5 * $i) }
  }
}

# Page through an ArcGIS FeatureServer layer as GeoJSON, in a stable order (the layer's own ID field).
# Keeps going while the server says there is more (exceededTransferLimit), even if its pages are
# shorter than requested; a full page also continues, in case a server omits the flag.
function Get-ArcGISLayer([string]$Url, [string]$Fields, [string]$Prefix, [string]$Where = '1=1') {
  $oid = (Invoke-RestMethod "$($Url)?f=json" -TimeoutSec 60).objectIdField
  $offset = 0; $page = 0; $total = 0
  do {
    $q = @{ where = $Where; outFields = $Fields; outSR = 4326; f = 'geojson'
            orderByFields = $oid; resultOffset = $offset; resultRecordCount = 2000 }
    $qs = ($q.GetEnumerator() | ForEach-Object { "$($_.Key)=$([uri]::EscapeDataString([string]$_.Value))" }) -join '&'
    $file = Join-Path $tmp ('{0}_{1:D3}.json' -f $Prefix, $page)
    Get-WithRetry "$Url/query?$qs" $file
    $j = Get-Content $file -Raw | ConvertFrom-Json
    if ($j.error) { throw "$Prefix page $page : $($j.error.message)" }
    $n = @($j.features).Count; $total += $n
    $more = [bool]($j.exceededTransferLimit -or $j.properties.exceededTransferLimit) -or $n -eq 2000
    $offset += $n; $page++
  } while ($more -and $n -gt 0)
  Write-Host "$Prefix : $total"
  $counts[$Prefix] = $total
}

$gis = 'https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services'

# ---- 1. SDOT collisions ----
Get-ArcGISLayer "$gis/SDOT_Collisions_All_Years_1/FeatureServer/0" `
  'INCKEY,INTKEY,LOCATION,ADDRTYPE,INCDATE,MAXSEVERITYDESC,PERSONCOUNT,PEDCOUNT,PEDCYLCOUNT,VEHCOUNT,INJURIES,SERIOUSINJURIES,FATALITIES,WEATHER,ROADCOND,LIGHTCOND,ST_COLDESC,SPEEDING,UNDERINFL' `
  'collisions' "INCDATE >= DATE '$Since'"

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
Get-WithRetry $u (Join-Path $tmp 'service_requests.csv') 600
$counts['requests'] = (Get-Content (Join-Path $tmp 'service_requests.csv')).Count - 1
Write-Host "service requests: $($counts['requests'])"

# ---- 3. Capital budget (all departments, all years; small) ----
Get-WithRetry 'https://cos-data.seattle.gov/resource/m6va-m4qe.csv?$limit=1000000' (Join-Path $tmp 'capital_budget.csv') 300
$counts['budget'] = (Get-Content (Join-Path $tmp 'capital_budget.csv')).Count - 1
Write-Host "capital budget rows: $($counts['budget'])"

# ---- 4. Street context, SDOT's own safety layers, and safety treatments already installed ----
Get-ArcGISLayer "$gis/Seattle_Streets_1/FeatureServer/0" `
  'COMPKEY,UNITDESC,STNAME_ORD,ARTCLASS,ARTDESCRIPT,SPEEDLIMIT,SURFACEWIDTH,PVMTCONDINDX1,PVMTCATEGORY,STREETTYPE,SLOPE_PCT,INTKEYLO,INTKEYHI,SEGLENGTH' 'streets'
# SDOT publishes a new traffic-count layer each year (2015_Arterial_Traffic_Volumes ... 2024_...). The newest one
# is the current count; all of them together give each street's traffic trend. Layer numbers and field names
# differ between years, so look each one up and take every field (build.sql picks the right names).
$volYears = (Invoke-RestMethod "$($gis)?f=json" -TimeoutSec 60).services |
  Where-Object { $_.name -match '^\d{4}_Arterial_Traffic_Volumes$' } | Sort-Object name | Select-Object -ExpandProperty name
if (-not $volYears) { throw 'No *_Arterial_Traffic_Volumes layer found' }
foreach ($svc in $volYears) {
  $id = (Invoke-RestMethod "$gis/$svc/FeatureServer?f=json" -TimeoutSec 60).layers[0].id
  $yr = $svc.Substring(0, 4)
  if ($svc -eq $volYears[-1]) {
    Write-Host "traffic volumes layer (current): $svc"
    Get-ArcGISLayer "$gis/$svc/FeatureServer/$id" 'FLOWSEGID,STNAME_ORD,AWDT,ADT,DATAQUALIT,START_DATE' 'volumes'
  }
  Get-ArcGISLayer "$gis/$svc/FeatureServer/$id" '*' "volhist_$yr"
}
$counts['volhist_years'] = @($volYears).Count

# ---- 4b. More things SDOT has built: traffic calming, bike lanes, bus lanes ----
$calm = 'SEGKEY,ONSTREET,XSTRLOW,XSTRHIGH,INSTALL_DATE,CURRENT_STATUS'
Get-ArcGISLayer "$gis/Speed_Humps_(Active)/FeatureServer/0" $calm 'humps'
Get-ArcGISLayer "$gis/Speed_Cushions_(Active)/FeatureServer/0" $calm 'cushions'
Get-ArcGISLayer "$gis/Radar_Speed_Signs_CDL/FeatureServer/0" 'SEGKEY,UNITDESC,CURRENT_STATUS' 'radar'
Get-ArcGISLayer "$gis/ProtectedBikeLanes/FeatureServer/0" 'STREET_NAME,DATE_COMPLETED,STATUS,SEGKEY' 'bikelanes'
Get-ArcGISLayer "$gis/Transit_Lanes/FeatureServer/1" 'SegKey,BlockName,InstallationDate,RemovalDate,Status,OfficialClass' 'buslanes'
# King County Metro buses per day on each street (people moving through, for the traffic view)
Get-ArcGISLayer "$gis/Seattle_Bus_Volumes/FeatureServer/0" 'TLINK_ID,FULLNAME_L,DAILY_TRIP_CNT,ROUTES_SERVICE,SCHED_DAY_TYPE_CODED_NUM' 'busvol'
Get-ArcGISLayer "$gis/Vision_Zero_High_Injury_Network_Score/FeatureServer/2" 'SEGMENT_NAME,FROM_,TO_,LENGTH_MI,HIN_SCORE,PRIORITY' 'hin'
Get-ArcGISLayer "$gis/Vision_Zero_High_Collision_Locations/FeatureServer/0" 'HCL_YEAR,LOCATION,INTKEY,TYPE' 'hcl'
Get-ArcGISLayer "$gis/Vision_Zero_-_Leading_Pedestrian_Intervals_ACTIVE/FeatureServer/8" 'LOCATION,LPI_Status,LPI_Install_Date,LPI_Planned_Year' 'lpi'
Get-ArcGISLayer "$gis/nma_nhoods_main/FeatureServer/0" 'L_HOOD' 'hoods_main'          # 20 areas (Ballard, West Seattle...)
Get-ArcGISLayer "$gis/nma_nhoods_sub/FeatureServer/0" 'L_HOOD,S_HOOD' 'hoods_sub'        # 94 neighborhoods
Get-ArcGISLayer "$gis/Seattle_City_Council_Districts/FeatureServer/0" 'C_DISTRICT,DISPLAY_NAME' 'districts'   # city outline + districts
Get-ArcGISLayer "$gis/Traffic_Signal_Assemblies_(Active)/FeatureServer/0" `
  'INTKEY,UNITDESC,INSTALL_DATE,PEDSIGNALYN,PEDAUDIODEVICEYN,LTPROTECTEDYN,LTFIRSTINSTALLDT,LASTSIGNALOPTDT' 'signals'

# ---- 4b2. Sidewalks: SDOT's own priorities for missing sidewalks (Seattle Transportation Plan, Tier 1 = highest)
# and sidewalks SDOT rated poor or very poor. Owner and parcel fields are not fetched (no singling out homes).
Get-ArcGISLayer "$gis/Seattle_Transportation_Plan_Pedestrian_Element/FeatureServer/18" `
  'COMPKEY,SEGKEY,UNITDESC,Tier,TotalSc,SafetySc,EquitySc,SchSC,TransitSC,ArtClass,Remove' 'sw_missing'
Get-ArcGISLayer "$gis/Sidewalks_(Active)/FeatureServer/0" `
  'COMPKEY,SEGKEY,UNITDESC,CONDITION,CONDITION_ASSESSMENT_DATE,SIDE,SW_WIDTH' 'sw_poor' "CONDITION IN ('POOR','VERY-POOR') AND CURRENT_STATUS = 'INSVC'"

# ---- 4c. King County Metro timetable (GTFS). Metro sets scheduled run times from how long buses actually
# take at each time of day, so peak vs early-morning run times between stops show where traffic slows buses. ----
$gtfsZip = Join-Path $tmp 'gtfs.zip'
Get-WithRetry 'https://metro.kingcounty.gov/GTFS/google_transit.zip' $gtfsZip 300
$gtfsDir = Join-Path $tmp 'gtfs'
Expand-Archive $gtfsZip $gtfsDir -Force
Remove-Item $gtfsZip
foreach ($f in 'stops.txt', 'stop_times.txt', 'trips.txt', 'calendar.txt', 'routes.txt') {
  if (-not (Test-Path (Join-Path $gtfsDir $f))) { throw "GTFS is missing $f" }
}
$counts['gtfs_stops'] = (Get-Content (Join-Path $gtfsDir 'stops.txt')).Count - 1
Write-Host "gtfs stops: $($counts['gtfs_stops'])"

# ---- 5. Sanity checks, then swap into data/raw ----
$minimum = @{ collisions = 20000; requests = 50000; budget = 10000; streets = 20000; volumes = 1000
              hin = 50; hcl = 100; lpi = 500; signals = 800; districts = 7; hoods_main = 15; hoods_sub = 80
              volhist_years = 8; humps = 50; cushions = 30; radar = 30; bikelanes = 200; buslanes = 500; busvol = 2000; gtfs_stops = 3000
              sw_missing = 8000; sw_poor = 1500 }
$prev = @{}
$prevFile = Join-Path $raw 'counts.json'
if (Test-Path $prevFile) { (Get-Content $prevFile -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $prev[$_.Name] = [int]$_.Value } }
foreach ($k in $minimum.Keys) {
  if (-not $counts.ContainsKey($k) -or $counts[$k] -lt $minimum[$k]) { throw "Fetch check failed: $k has $($counts[$k]) rows (minimum $($minimum[$k])). Keeping the previous data." }
  if ($prev.ContainsKey($k) -and $prev[$k] -gt 0 -and [math]::Abs($counts[$k] - $prev[$k]) / $prev[$k] -gt 0.25) {
    throw "Fetch check failed: $k changed from $($prev[$k]) to $($counts[$k]) rows (>25%). Keeping the previous data. Delete data\raw\counts.json to accept it."
  }
}
$counts | ConvertTo-Json | Set-Content (Join-Path $tmp 'counts.json')
Set-Content (Join-Path $tmp 'fetched_at.txt') (Get-Date).ToString('yyyy-MM-dd HH:mm')
Remove-Item $raw -Recurse -Force -ErrorAction SilentlyContinue
Rename-Item $tmp 'raw'
Write-Host 'Fetch OK.'
