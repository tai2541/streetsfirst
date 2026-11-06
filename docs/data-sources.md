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
| Dataset | ID | Type | Last updated | Notes |
|---|---|---|---|---|
| SDOT Collisions All Years | sbqc-3j3m | GeoData | 2026-05-05 | Core crash layer |
| Seattle Real Time Fire 911 Calls | kzjm-xkqj | Socrata | 2026-11-06 | Fire/EMS, near-live |
| Fire 911 Unit Dispatches | w35j-83t3 | Socrata | 2026-11-06 | Not domain-verified |
| Call Data (SPD calls for service) | 33kz-ixgy | Socrata | 2026-11-06 | Use non-crime call types only |
| Crisis Data | i2q9-thny | Socrata | 2026-11-06 | Behavioral-health signal |

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
