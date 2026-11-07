# Infrastructure Priority Map

A public map that answers one question: **what in this city most needs to be worked on next?**

Today it ranks Seattle's crash locations using SDOT collision reports, Find It Fix It repair
requests, and SDOT's street, traffic, signal and Vision Zero layers, with the reasons behind
each score. The goal is to add more: emergency calls, infrastructure condition, weather and
neighborhood vulnerability (see the roadmap).

First region: **Seattle, WA**. The design keeps the scoring engine separate from the
data sources so other Washington cities, the whole state, and later other states can be
added by plugging in new sources.

## Three questions the site is built to answer
*Question 1 is answered today. Questions 2 and 3 are partly answered (SDOT actions per spot, the capital
budget by program) and are the main roadmap.*

1. **What needs work next?** A ranked map of problem spots with the reasons for each score.
2. **Why is this being worked on?** Every current and future project, its cost, and the
   evidence of need behind it (or the lack of it).
3. **What's being ignored?** High-need spots with no funded project, and how spending per
   area compares with need per area.

## Principles
- **Fixes, not policing.** Focus on call types with a fixable cause (crashes, medical,
  fire, infrastructure). Leave out crime-type calls. Never single out people or exact homes.
- **Show the reasons.** Every ranked item explains why it ranks where it does.
- **Respect work already done.** Each spot shows what SDOT has already installed or planned there
  (head-start walk signals, protected left turns) and flags spots that are still dangerous after it.
  *Roadmap:* link funded capital projects to locations and mark them as scheduled.
- **Check against reality.** Validate rankings against known Seattle problems
  (e.g. West Seattle Bridge, Magnolia Bridge, SDOT high-injury streets) and SDOT's
  Asset Status & Condition Report (published every 5 years; latest data 2020, next expected 2026).
- **Borrow SDOT's own criteria.** SDOT ranks paving by condition, traffic volume, equity,
  cost and coordination, and sidewalks by mobility impact, risk, cost, usage and equity.

## Priority score
**Long-term goal:** `condition x usage x consequence of failure x area vulnerability`,
reduced when repair work is already scheduled.

**Current (crashes + repair requests)**, "Most likely to hurt people" ranking (the default), over 60 full months ending 3 months
before the newest crash (recent police reports arrive late):
1. **Crash harm:** fatal or serious injury 30 (KSI), injury 5, property damage 1, unknown 0,
   x1.5 when a pedestrian or cyclist was hurt.
2. **Repeated deaths compound:** the nth fatal crash at a spot counts 30 x 1.5^(n-1).
3. **Expected harm (empirical Bayes):** the fatal/serious part is blended with the typical
   rate for similar spots (same location type and street class), weighted crashes / (crashes + 20).
   Chosen because it best predicted later fatal/serious crashes in an out-of-sample test
   (rank on the first 3 years, count KSI crashes in the last 2). Results are on the site.
4. **Repair boost:** safety-related requests (signals, streetlights, signs, sidewalks, ADA,
   Safe Routes to School) since mid-2023, duplicates collapsed, raise the score by at most +25%.

The site also offers "Risk for its traffic" (the same expected harm per vehicle). The original
fatal-weighted ranking was retired from the site. All weights are in the
`weights` table at the top of `pipeline/build.sql`.

## Status
**v1** is a local site that ranks Seattle intersections and blocks by collision harm plus
nearby infrastructure repair requests, and shows the SDOT capital budget through 2028.

- Data inventory: [docs/data-sources.md](docs/data-sources.md)
- Deployment plan and roadmap: [docs/deployment.md](docs/deployment.md)

## Setup (Windows)
1. Download the DuckDB CLI (v2.0.0, `duckdb-cli-windows-amd64`) from
   https://github.com/duckdb/duckdb/releases and put `duckdb.exe` in `tools/duckdb/`.
2. Run `powershell -ExecutionPolicy Bypass -File run.ps1` to fetch the data (about a minute)
   and build. Add `-SkipFetch` to rebuild from data already downloaded.
3. Open `site/index.html` in a browser.

## Layout
```
pipeline/fetch.ps1   download raw city data -> data/raw/   (git-ignored)
pipeline/build.sql   DuckDB: clean, score, export          (weights at the top)
run.ps1              fetch + build + write site/data/data.js
site/                static web page (Leaflet map)
docs/                data sources, deployment plan
```
