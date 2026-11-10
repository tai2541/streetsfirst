# Streets First

Live at **https://streetsfirst.org/seattle/** (each city gets its own folder; the top level sends visitors to Seattle for now). Earlier name: Seattle Infrastructure Priority Map.

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

**One list.** Intersections and stretches of street are ranked together, 1 to N, on the same score
(ties: more crashes first). Picking only intersections, only stretches, or a council district on the site
re-numbers the places within that choice; the citywide number is shown beside it. Where SDOT draws a road's two
directions as separate lines (e.g. "M L KING JR ER WAY S" and "... WR ..."), crashes on two lines that close
together count as one place.

The site also offers "Risk for its traffic" (the same expected harm per vehicle). The original
fatal-weighted ranking was retired from the site. All weights are in the
`weights` table at the top of `pipeline/build.sql`.

## Status
Live at https://streetsfirst.org/seattle/, rebuilt weekly and on every push to `main` by
`.github/workflows/weekly.yml` (fetch, build, check, deploy). It ranks Seattle intersections and stretches by
crash harm plus nearby repair requests, shows what SDOT has done and plans at each place, tracks need against
published work by district, and shows the SDOT capital budget by program. Search finds streets, corners, schools
and Seattle street addresses (King County address points, with a geocoder as a fallback).

- Data inventory: [docs/data-sources.md](docs/data-sources.md)
- Deployment plan and roadmap: [docs/deployment.md](docs/deployment.md)

## Setup (Windows)
1. Download the DuckDB CLI (v2.0.0, `duckdb-cli-windows-amd64`) from
   https://github.com/duckdb/duckdb/releases and put `duckdb.exe` in `tools/duckdb/`.
2. Run `powershell -ExecutionPolicy Bypass -File run.ps1` to fetch the data and build. Add `-SkipFetch` to rebuild from data already downloaded. If DuckDB says the spatial
   extension is missing, run `tools\duckdb\duckdb.exe -c "install spatial;"` once.
3. Open `site/index.html` in a browser.
4. Optional: `powershell -ExecutionPolicy Bypass -File pipeline/check.ps1` checks the build (data sizes, plus a
   self-test of the page in headless Edge or Chrome). The weekly job won't publish a build that fails it.

## Layout
```
pipeline/fetch.ps1   download raw city and county data -> data/raw/   (git-ignored)
pipeline/build.sql   DuckDB: clean, score, export          (weights at the top; dates in UTC)
pipeline/context.sql "the street", schools, council members, older crashes for before/after
pipeline/projects.sql SDOT projects and work near each place
pipeline/traffic.sql traffic counts, speed humps, "risk for its traffic"
pipeline/sidewalks.sql missing and poor sidewalks
pipeline/addresses.sql King County address points -> address search suggestions
pipeline/history.sql past rankings (yearly since 2018, monthly for a year), "what changed", need vs work by district
run.ps1              fetch + build, then writes into site/data/:
                       data.js        the map and ranked lists (loaded first)
                       data-late.js   search index, "Is it getting fixed?", budget (loaded right after)
                       more/          per-area details, loaded when a place there is opened
                       addr/          address numbers by street, loaded while typing an address
                     then dist/ (the publishable copy, with versioned file addresses)
pipeline/check.ps1   checks a build before publishing; site/index.html#selftest runs the page self-test
.github/workflows/   weekly rebuild -> check -> GitHub Pages
site/                static web page (Leaflet map; Leaflet and the font are vendored, no outside scripts)
docs/                data sources, deployment plan
```

## License

All rights reserved. The code is public so anyone can read it and check how the numbers are calculated. Any other use
(running, copying, changing or deploying it, for any organization) needs written permission: see [LICENSE](LICENSE).
The data belongs to its publishers (the City of Seattle, King County and others) and stays under their terms.
