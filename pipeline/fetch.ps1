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
$ProgressPreference = 'SilentlyContinue'   # Windows PowerShell downloads many times slower while drawing a progress bar
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
  'INCKEY,INTKEY,LOCATION,ADDRTYPE,INCDATE,INCDTTM,MAXSEVERITYDESC,PERSONCOUNT,PEDCOUNT,PEDCYLCOUNT,VEHCOUNT,INJURIES,SERIOUSINJURIES,FATALITIES,WEATHER,ROADCOND,LIGHTCOND,ST_COLDESC,SPEEDING,UNDERINFL' `
  'collisions' "INCDATE >= DATE '$Since'"
# Older crashes (2011 up to the scored years), fewer fields: only for "before and after" around things SDOT built.
# Never scored. Named crashhist so the collisions_* files above stay the scored set.
Get-ArcGISLayer "$gis/SDOT_Collisions_All_Years_1/FeatureServer/0" `
  'INCKEY,INTKEY,LOCATION,ADDRTYPE,INCDATE,MAXSEVERITYDESC,PEDCOUNT,PEDCYLCOUNT,ST_COLDESC' `
  'crashhist' "INCDATE >= DATE '2011-01-01' AND INCDATE < DATE '$Since'"

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
# No turn on red (NTOR), SDOT's companion to the head-start walk signal: Existing (with date), Planned (with year), Not Feasible
Get-ArcGISLayer "$gis/Vision_Zero_-_No_Turns_on_Red_ACTIVE/FeatureServer/8" 'LOCATION,NTOR_Status,NTOR_Install_Date,NTOR_Planned_Year,Approaches' 'ntor'
Get-ArcGISLayer "$gis/nma_nhoods_main/FeatureServer/0" 'L_HOOD' 'hoods_main'          # 20 areas (Ballard, West Seattle...)
Get-ArcGISLayer "$gis/nma_nhoods_sub/FeatureServer/0" 'L_HOOD,S_HOOD' 'hoods_sub'        # 94 neighborhoods
Get-ArcGISLayer "$gis/Seattle_City_Council_Districts/FeatureServer/0" 'C_DISTRICT,DISPLAY_NAME' 'districts'   # city outline + districts
Get-ArcGISLayer "$gis/Traffic_Signal_Assemblies_(Active)/FeatureServer/0" `
  'INTKEY,UNITDESC,INSTALL_DATE,PEDSIGNALYN,PEDAUDIODEVICEYN,LTPROTECTEDYN,LTFIRSTINSTALLDT,LASTSIGNALOPTDT' 'signals'

# ---- 4b1. What's on the street (context only, never scored): marked crosswalks, curb ramps, bike facilities of
# every type, traffic circles; nearby public schools; the City's Race and Social Equity Index (by census tract);
# and each council district's member, for "who to contact".
Get-ArcGISLayer "$gis/Marked_Crosswalks_(Active)/FeatureServer/0" `
  'UNITDESC,SEGKEY,MARKING_TYPE,SCHOOL,MIDBLOCK_CROSSWALK,CROSSWALK_CONTROL,INSTALL_DATE' 'crosswalks' "CURRENT_STATUS = 'INSVC'"
Get-ArcGISLayer "$gis/Curb_Ramps_(Active)/FeatureServer/0" 'INT_UNITDESC,CONDITION,INSTALL_DATE' 'curbramps' "CURRENT_STATUS = 'INSVC'"
Get-ArcGISLayer "$gis/SDOT_Bike_Facilities/FeatureServer/2" 'UNITDESC,SEGKEY,CATEGORY,INSTALL_DATE' 'bikefac' "CURRENT_STATUS = 'INSVC'"
Get-ArcGISLayer "$gis/Traffic_Circles_view/FeatureServer/0" 'INTKEY,UNITDESC,INSTALL_DATE' 'circles' "CURRENT_STATUS = 'INSVC'"
Get-ArcGISLayer "$gis/Public_School/FeatureServer/0" 'NAME,SCHOOL,TYPE,GRADE' 'schools' `
  "TYPE IN ('Elementary','Middle School','High School','Option Elementary','Option High School','K-8')"
# Seattle street addresses, for suggestions while someone types an address in the search box: King County's address
# points (house number, street, ZIP, location only; no parcel fields). One point per address (PRIM_ADDR = 1), so the units
# of a building aren't listed separately. If the county's server can't be reached, last week's copy is kept.
$addrSkipped = $false
$prevAddr = $null
if (Test-Path (Join-Path $raw 'counts.json')) { $prevAddr = (Get-Content (Join-Path $raw 'counts.json') -Raw | ConvertFrom-Json).addresses }
try {
  Get-ArcGISLayer 'https://gismaps.kingcounty.gov/arcgis/rest/services/Address/KingCo_AddressPoints/MapServer/0' `
    'ADDR_NUM,ADDR_PD,ADDR_SN,ADDR_ST,ADDR_SD,ZIP5' 'addresses' "CTYNAME = 'SEATTLE' AND PRIM_ADDR = 1"
} catch {
  # Last week's raw files exist only on a machine that ran the fetch before (not on the weekly runner). Without them,
  # address suggestions pause until the next run; search still finds addresses through "Find this address".
  Write-Warning "Address points not fetched ($($_.Exception.Message))."
  Remove-Item (Join-Path $tmp 'addresses_*.json') -ErrorAction SilentlyContinue
  if (Test-Path (Join-Path $raw 'addresses_000.json')) { Copy-Item (Join-Path $raw 'addresses_*.json') $tmp; $counts['addresses'] = $prevAddr }
  else { '{"type":"FeatureCollection","features":[]}' | Set-Content (Join-Path $tmp 'addresses_000.json'); $addrSkipped = $true }
}
Get-ArcGISLayer "$gis/Race_and_Social_Equity_Composite_Index_Current/FeatureServer/0" `
  'GEOID,NAMELSAD,COMPOSITE_QUINTILE,COMPOSITE_PERCENTILE,INDEX_YEAR' 'rse'
Get-ArcGISLayer "$gis/Council_District_Member_Info/FeatureServer/0" 'C_DISTRICT,DISPLAY_NAME,Name,Website' 'council'
# Who is on the Council today, from the City Clerk's legislative records (Legistar). The district map above isn't always
# updated when a member changes, so the site names a district's member only when this list confirms they're serving.
# If this list can't be fetched, the build goes on without the check.
$today = (Get-Date).ToString('yyyy-MM-dd')
$leg = "https://webapi.legistar.com/v1/seattle/OfficeRecords?`$filter=OfficeRecordBodyName eq 'City Council' and " +
       "OfficeRecordStartDate le datetime'$today' and OfficeRecordEndDate ge datetime'$today'"
try { Get-WithRetry $leg (Join-Path $tmp 'legistar_council.json') 60 }
catch { Write-Host "  council member list unavailable ($($_.Exception.Message)); names from the district map are shown unchecked"; '[]' | Set-Content (Join-Path $tmp 'legistar_council.json') }

# ---- 4b2. Sidewalks: SDOT's own priorities for missing sidewalks (Seattle Transportation Plan, Tier 1 = highest)
# and sidewalks SDOT rated poor or very poor. Owner and parcel fields are not fetched (no singling out homes).
Get-ArcGISLayer "$gis/Seattle_Transportation_Plan_Pedestrian_Element/FeatureServer/18" `
  'COMPKEY,SEGKEY,UNITDESC,Tier,TotalSc,SafetySc,EquitySc,SchSC,TransitSC,ArtClass,Remove' 'sw_missing'
Get-ArcGISLayer "$gis/Sidewalks_(Active)/FeatureServer/0" `
  'COMPKEY,SEGKEY,UNITDESC,CONDITION,CONDITION_ASSESSMENT_DATE,SIDE,SW_WIDTH' 'sw_poor' "CONDITION IN ('POOR','VERY-POOR') AND CURRENT_STATUS = 'INSVC'"

# ---- 4b3. SDOT's own published project maps: where SDOT shows planned (and recently finished) work.
#   * New sidewalk projects: the layer behind SDOT's "New Sidewalks Map".
#   * Neighborhood-Initiated Safety Partnership Program (NISPP): small safety projects with a planned year.
# The City's budget data has no locations, and none of these layers carry budget line numbers or dollars, so the
# site never puts a dollar figure on a mapped project. These lists are small and change as projects are added,
# so they get a low floor and skip the 25% change check. Each layer's last-edit date is kept and shown on the site.
Get-ArcGISLayer "$gis/All_Sidewalk_Projects/FeatureServer/53" 'COMPKEY,UNITID,UNITDESC,Year,Scope,Planning' 'proj_sidewalk'
Get-ArcGISLayer "$gis/NISPP_Projects_draft/FeatureServer/0" `
  'Neighborhood,Project_Name,Location,Scope,Project_Stage___Website,Planned_Delivery_Year,Project_Source,Link' 'proj_nispp'
$projEdited = [ordered]@{}
foreach ($p in @(@('proj_sidewalk', "$gis/All_Sidewalk_Projects/FeatureServer/53"), @('proj_nispp', "$gis/NISPP_Projects_draft/FeatureServer/0"))) {
  $info = Invoke-RestMethod "$($p[1])?f=json" -TimeoutSec 60
  $projEdited[$p[0]] = if ($info.editingInfo.lastEditDate) { [DateTimeOffset]::FromUnixTimeMilliseconds($info.editingInfo.lastEditDate).ToString('yyyy-MM-dd') } else { '' }
}
$projEdited | ConvertTo-Json | Set-Content (Join-Path $tmp 'proj_edited.json')

# ---- 4c. King County Metro timetable (GTFS). Metro sets scheduled run times from how long buses actually
# take at each time of day, so peak vs early-morning run times between stops show where traffic slows buses. ----
$gtfsZip = Join-Path $tmp 'gtfs.zip'
Get-WithRetry 'https://metro.kingcounty.gov/GTFS/google_transit.zip' $gtfsZip 300
$gtfsDir = Join-Path $tmp 'gtfs'
Expand-Archive $gtfsZip $gtfsDir -Force
Remove-Item $gtfsZip
foreach ($f in 'stops.txt', 'stop_times.txt', 'trips.txt', 'calendar.txt', 'calendar_dates.txt', 'routes.txt', 'shapes.txt') {
  if (-not (Test-Path (Join-Path $gtfsDir $f))) { throw "GTFS is missing $f" }
}
$counts['gtfs_stops'] = (Get-Content (Join-Path $gtfsDir 'stops.txt')).Count - 1
Write-Host "gtfs stops: $($counts['gtfs_stops'])"

# ---- 5. Sanity checks, then swap into data/raw ----
$minimum = @{ collisions = 20000; requests = 50000; budget = 10000; streets = 20000; volumes = 1000
              hin = 50; hcl = 100; lpi = 500; ntor = 400; signals = 800; districts = 7; hoods_main = 15; hoods_sub = 80
              volhist_years = 8; humps = 50; cushions = 30; radar = 30; bikelanes = 200; buslanes = 500; busvol = 2000; gtfs_stops = 3000
              sw_missing = 8000; sw_poor = 1500; proj_sidewalk = 20; proj_nispp = 5
              crashhist = 50000; crosswalks = 4000; curbramps = 25000; bikefac = 1500; circles = 500; schools = 70; rse = 150; council = 7
              addresses = 150000 }
$volatile = @('proj_sidewalk', 'proj_nispp')   # small project lists: big swings are normal
$prev = @{}
$prevFile = Join-Path $raw 'counts.json'
if (Test-Path $prevFile) { (Get-Content $prevFile -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $prev[$_.Name] = [int]$_.Value } }
if ($addrSkipped) { $minimum.Remove('addresses') }
foreach ($k in $minimum.Keys) {
  if (-not $counts.ContainsKey($k) -or $counts[$k] -lt $minimum[$k]) { throw "Fetch check failed: $k has $($counts[$k]) rows (minimum $($minimum[$k])). Keeping the previous data." }
  if ($k -notin $volatile -and $prev.ContainsKey($k) -and $prev[$k] -gt 0 -and [math]::Abs($counts[$k] - $prev[$k]) / $prev[$k] -gt 0.25) {
    throw "Fetch check failed: $k changed from $($prev[$k]) to $($counts[$k]) rows (>25%). Keeping the previous data. Delete data\raw\counts.json to accept it."
  }
}
# Map credits: each Esri map layer's own credit line as Esri publishes it (it changes when their data providers do),
# so the site always shows the current wording. A layer that can't be reached keeps last week's line.
$credits = [ordered]@{}
$prevCreditsFile = Join-Path $raw 'basemap_credits.json'
$prevCredits = if (Test-Path $prevCreditsFile) { [IO.File]::ReadAllText($prevCreditsFile, [Text.Encoding]::UTF8) | ConvertFrom-Json } else { $null }
foreach ($svc in 'Canvas/World_Light_Gray_Base', 'Canvas/World_Light_Gray_Reference', 'World_Street_Map', 'World_Imagery', 'Reference/World_Transportation') {
  $text = $null
  try { $text = (Invoke-RestMethod "https://server.arcgisonline.com/ArcGIS/rest/services/$svc/MapServer?f=json" -TimeoutSec 60).copyrightText } catch { }
  if (-not $text -and $prevCredits) { $text = $prevCredits.$svc }
  if (-not $text) { throw "Fetch check failed: no map credit line for $svc. Keeping the previous data." }
  $credits[$svc] = $text.Trim()
}
[IO.File]::WriteAllText((Join-Path $tmp 'basemap_credits.json'), ($credits | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
$counts | ConvertTo-Json | Set-Content (Join-Path $tmp 'counts.json')
Set-Content (Join-Path $tmp 'fetched_at.txt') (Get-Date).ToString('yyyy-MM-ddTHH:mmzzz')   # with the time zone (runners use UTC)
# Swap without a moment with no data: old -> raw.old, new -> raw, then delete the old copy.
$old = Join-Path $root 'data\raw.old'
Remove-Item $old -Recurse -Force -ErrorAction SilentlyContinue
if (Test-Path $raw) { Rename-Item $raw 'raw.old' }
try { Rename-Item $tmp 'raw' }
catch { if (Test-Path $old) { Rename-Item $old 'raw' }; throw }
Remove-Item $old -Recurse -Force -ErrorAction SilentlyContinue
Write-Host 'Fetch OK.'
