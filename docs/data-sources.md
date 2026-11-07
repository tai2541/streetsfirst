# Data sources

Inventory from a search of Seattle's open data catalog on 2026-11-06.

Seattle's portal moved from `data.seattle.gov` to **`cos-data.seattle.gov`** (Socrata).
API pattern: `https://cos-data.seattle.gov/resource/<id>.json` (SoQL queries, no key
needed; a free app token raises rate limits).

Entries marked **GeoData** are links (`federated_href`) to Seattle's ArcGIS GeoData hub,
not Socrata tables. They need to be fetched from the ArcGIS service each one points to.
None of these have been downloaded or inspected yet.

## Seattle: city data

### Safety and calls

Excluded on purpose (policing or sensitive): SPD calls for service, Crisis Data, collision-person fields on citations, sobriety or drug tests, and traffic camera layers.

| Dataset | ID | Type | Last updated | Notes |
|---|---|---|---|---|
| SDOT Collisions All Years | sbqc-3j3m | GeoData | 2026-05-05 | Core crash layer |
| Seattle Real Time Fire 911 Calls | kzjm-xkqj | Socrata | 2026-11-06 | Fire/EMS, near-live |
| Fire 911 Unit Dispatches | w35j-83t3 | Socrata | 2026-11-06 | Not domain-verified |

### Service requests (Find It Fix It / 311)
| Dataset | ID | Type | Last updated |
|---|---|---|---|
| Customer Service Requests | 5ngg-rpne | Socrata | 2026-11-06 |
| Customer Service Request Tracking Data | 43nw-pkdq | Socrata | 2026-11-06 |
| Illegal Dumping Reports | bpvk-ju3y | Socrata | 2026-11-06 |
| Streetlight Repair Status | ryje-ciqm | GeoData | 2025-02-03 |

### Streets, sidewalks, bridges, traffic
| Dataset | ID | Type | Last updated |
|---|---|---|---|
| Seattle Streets | w3hh-bqt5 | GeoData | 2025-06-09 |
| Sidewalks | wt8y-6s4w | GeoData | 2025-02-03 |
| Missing Sidewalks | eqw3-998w | GeoData | 2025-02-03 |
| Substandard Sidewalks | 6dya-3qec | GeoData | 2025-02-03 |
| Bridges | aii8-su3w | GeoData | 2025-02-03 |
| SDOT Drawbridge Status | gm8h-9449 | Socrata | 2026-11-06 |
| Traffic Counts by Study | xucb-vzhc | Socrata | 2026-11-06 |
| Traffic Count Studies by Hour Bins | g32r-fjzp | Socrata | 2026-11-06 |
| Traffic Signal Assemblies | mtuh-7yuz | GeoData | 2025-02-03 |
| Road Weather Information Stations | egc4-d24i | Socrata | 2026-06-18 |

The road weather stations may include pavement and air temperature, which could support
the weather analysis.

**Pavement condition is missing.** It probably lives on GeoData under an SDOT name.

### Water and drainage
| Dataset | ID | Type | Last updated |
|---|---|---|---|
| SPU Water Mains and Services | 28w5-gdpf | GeoData | 2025-02-03 |
| Surface Drainage Points | yk4y-9ax9 | GeoData | 2025-06-13 |
| SPU DWW Drainage Basins | x3nj-dxd7 | GeoData | 2025-02-03 |
| SPU DWW Green Stormwater Infrastructure | thd4-a8zc | GeoData | 2025-02-03 |

### Planned work (used to mark items as "already scheduled")
| Dataset | ID | Type | Last updated |
|---|---|---|---|
| Capital Projects Input Data | q76w-bfs5 | Socrata | 2025-09-24 |
| CIP Project Boundaries | d58s-3qjy | GeoData | 2025-02-03 |
| CIP Workorders | 327v-mikm | GeoData | 2025-02-03 |
| SPU Capital Improvement Projects | ktbb-8i44 | GeoData | 2025-02-03 |
| DotMaps Pavement Moratorium | hfs4-jhfw | GeoData | 2025-02-03 |

### Spending: past, current and future
| Dataset | ID | Type | Last updated | Notes |
|---|---|---|---|---|
| City of Seattle Capital Budget | m6va-m4qe | Socrata | 2026-09-22 | 38,831 rows, FY2018–2028 |
| City of Seattle Operating Budget | 8u2j-imqx | Socrata | 2026-09-22 | Not inspected |
| Capital Projects Input Data | q76w-bfs5 | Socrata | 2025-09-24 | 68 project shapes |

**Capital budget, checked 2026-11-06.**
- Fields: `fiscal_year, deptname, bclname (program), projecttitle, projectcode, fundname, amount`.
- **There is no location field.**
- Covers **FY2018–2028**, so it includes planned future years. Annual totals run about
  $1.1–1.7B citywide.
- FY2026 by department: SPU $577M, City Light $512M, SDOT $348M, Parks $91M.
- SDOT codes look like `MC-TR-C033`. Many lines are whole programs, not places
  (e.g. "Vision Zero" $14.1M, "Arterial Asphalt/Concrete Ph 2" $42.8M,
  "PMP - New Sidewalk Program" $23M).
- Rows per year drop from about 9,000 (2022) to about 600 (2023 on). The detail level
  changed, which affects comparisons over time.

**Project shapes (q76w-bfs5).**
- IDs look like `TC32314010`, which don't match the budget codes.
- Only 68 projects are included.
- Linking money to places needs another source.

**Sources still needed to put spending on the map:**
- **2024 Transportation Levy:** delivery plans and annual reports, $1.55B over 2025–2032.
  These list specific streets and projects by year (PDFs).
- **SDOT "Current Paving Projects"** and individual project pages, for locations, budgets
  and schedules.
- **Seattle Levy Oversight Committee reports:** planned vs actual spending.
- **USAspending.gov:** federal grants to Seattle, such as Safe Streets and Roads for All.
- **SDOT unit costs** (per lane-mile paved, per block of sidewalk), to estimate the cost
  of fixing problems that have no project yet.

### Vulnerability, heat, environment
| Dataset | ID | Type | Last updated |
|---|---|---|---|
| Racial and Social Equity Composite Index Current | x5s4-2aie | GeoData | 2025-02-03 |
| Seattle Tree Canopy 2021 | sdma-vj47 | GeoData | 2025-02-03 |
| Existing Tree Canopy % | ee2n-q642 | GeoData | 2025-02-03 |

## National and state sources (not yet checked)
- **FHWA National Bridge Inventory:** bridge condition ratings
- **NHTSA FARS:** fatal crashes
- **OpenFEMA:** flood insurance claims, disaster history (no key)
- **EPA ECHO / SDWIS:** drinking water and wastewater violations
- **CDC Social Vulnerability Index**
- **WSDOT Traveler Information API:** incidents, travel times (free access code)
- **Weather:** Open-Meteo historical archive (no key), NOAA GHCN for the Sea-Tac station
- **Traffic congestion:** TomTom or HERE free tiers, sampled over time
- **King County Metro GTFS-realtime:** transit reliability

## Added in tester round 1
- **Leading Pedestrian Intervals**: `Vision_Zero_-_Leading_Pedestrian_Intervals_ACTIVE/FeatureServer/8`
  (1,239 signals; LPI_Status Existing / Planned / Not Feasible, LPI_Install_Date, LPI_Planned_Year; multipoint).
- **Traffic signal assemblies**: `Traffic_Signal_Assemblies_(Active)/FeatureServer/0` (1,254; INTKEY,
  PEDSIGNALYN, PEDAUDIODEVICEYN, LTPROTECTEDYN, LTFIRSTINSTALLDT). Joined to crash locations by INTKEY.
- **Traffic volumes**: `DATAQUALIT` and `START_DATE` are now used. The "2024" layer is a compilation:
  about 30% are 2024 counts; others are 2013-2023 counts or undated estimates (e.g. 36,000 on Aurora).
- **Crash reporting lag**: the newest 2-3 months are far below normal (e.g. Oct 2026: 47 vs ~480 a month).

## Added for the Traffic view and more SDOT fixes (2026-11)
All read by `pipeline/fetch.ps1`, joined in `pipeline/traffic.sql`. Context only: none of these change the safety score.

| Data | Source | Used for | Notes |
|---|---|---|---|
| Arterial traffic volumes, 2015–newest | ArcGIS `YYYY_Arterial_Traffic_Volumes` (one service per year; layer id and field names vary) | Busiest streets; traffic history per spot and street | Yearly layers re-publish old counts for streets not recounted (2022: ~125 of 1,930 new). History uses each count's own date (`START_DATE` / `COUNTSTART`); undated records dropped; repeated identical values hidden. Most streets have only ~2 real counts in 10 years, so there is no "fastest-growing" ranking. |
| King County Metro GTFS timetable | https://metro.kingcounty.gov/GTFS/google_transit.zip | Where buses lose time at rush hour | The Wednesday in the next 90 days with the most trips after holiday exceptions. Stretches between timed stops (median ~1.2 mi; a few blocks downtown). Hourly average run time; baseline = mean of the 2 quickest hours (usually late night); ranking adds up every trip's time above that baseline, per mile. Includes boarding time. Inside Seattle; stretches under 0.25 mi not ranked (minute-rounded times). |
| Seattle Bus Volumes | ArcGIS `Seattle_Bus_Volumes` | Buses a weekday at each spot | Metro trips per street link. |
| Speed humps, speed cushions | ArcGIS `Speed_Humps_(Active)`, `Speed_Cushions_(Active)` | "What SDOT has done here" | Linked by street segment key. Install dates exist but aren't used yet. |
| Radar speed signs | ArcGIS `Radar_Speed_Signs_CDL` | Same | No dates. PLANNED shown as planned; TEMPOUTSVC dropped. |
| Protected bike lanes | ArcGIS `ProtectedBikeLanes` | Same, plus fix line on the timeline | `DATE_COMPLETED`; status CONST = under construction. |
| Transit (bus) lanes | ArcGIS `Transit_Lanes` layer 1 | Same | `InstallationDate` (175 of 1,174 dated); removed lanes skipped. |

## Added for the Sidewalks view (2026-11)

| Layer | Used for | Caveats |
|---|---|---|
| Seattle_Transportation_Plan_Pedestrian_Element/FeatureServer/18 (Missing Sidewalks) | SDOT's Tier 1-5 priority and scores for every block without a sidewalk | SDOT's scores and order, shown unchanged; plan-time snapshot. `Remove = 1` rows dropped. |
| Sidewalks_(Active)/FeatureServer/0, `CONDITION IN ('POOR','VERY-POOR')` | Blocks with the most sidewalk rated poor | Most poor ratings are from 2017 surveys; some may be fixed. Ranked by length, so long blocks rank high. |

Never fetched: owner or parcel fields (PROPERTY_OWNER_RESPONSIBILITY, NEAREST_PARCEL_ID_NUMBER and similar). The map is about
streets, not singling out homes. Candidates for later: Substandard Sidewalks (layer 19), Enhanced Street Crossings (layer 17),
Curb_Ramps_(Active), Marked_Crosswalks_(Active), School_Walking_Boundaries.

## Added for SDOT's planned projects (2026-11)
Shown on the map (layer "SDOT planned & recent projects"), in each crash spot's "What SDOT has done" section, on the
Sidewalks tab, and next to the matching budget programs. Never scored. Built in `pipeline/projects.sql`.

| Source | Layer | Used for | Notes |
|---|---|---|---|
| SDOT New Sidewalks map | `All_Sidewalk_Projects/FeatureServer/53` | New sidewalk blocks: moving into design (`Planning = 'Y'`), completed (`Planning` empty, year ≤ this year) | Same filters as SDOT's own "New Sidewalks Map". Rows outside them aren't on SDOT's map and are left out. Matched to the missing-sidewalk list where the project line runs along at least 3/4 of the block (within 30 ft), or the block name matches exactly; names alone miss typos and multi-block "FROM ... TO" projects. Crash spots: within 100 ft of an intersection or 40 ft of a block's street line. |
| SDOT Neighborhood-Initiated Safety Partnership Program map | `NISPP_Projects_draft/FeatureServer/0` | Small safety projects, Planned / Completed, with planned year | Names lose SDOT's internal area prefix ("S - ") and program suffix ("- NISPP"); "TBD" shown as not yet named. |
| Leading Pedestrian Intervals (already fetched) | `Vision_Zero_-_Leading_Pedestrian_Intervals_ACTIVE` | Head-start walk signals with status Planned | |

Each layer's last-edit date is saved in `data/raw/proj_edited.json` and shown on the site.

Checked and not used:
- **Capital Projects Input Data** (`q76w-bfs5`): 68 projects, last updated Sep 2025, many 2016–2020 projects still "Active". Too stale.
- **dotMaps Active Projects** (gisdata.seattle.gov `SDOT_StreetUse`): that server's service is stopped.
- **Bike_Imp_Data**: no dates or status (can't tell planned from built); last edited 2024.
- No public layer ties a capital budget line (MC-TR-C…) to a location or gives per-project costs. Two programs share a name
  with a project map (MC-TR-C058 New Sidewalk Program, MC-TR-C154 NISPP); the budget tab shows them side by side only.
