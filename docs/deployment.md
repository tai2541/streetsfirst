# Deployment plan

## v1 (now): local
- `run.ps1` fetches the data, runs the DuckDB scoring (`pipeline/build.sql`) and writes `site/data/data.js`. It also writes `site/data/more/`: one small script per map area (about 1.1 km square) with the full crash and request details for every place outside the ranked lists. The site loads an area's file only when someone opens a place there; publish the folder with the rest of `site/`.
- `site/index.html` opens directly in a browser. No server is needed.

## v2: public, static, rebuilt weekly (set up: `.github/workflows/weekly.yml`)
The site has no backend. Everything a visitor needs is precomputed into static files.
Weekly is enough: the scored window moves once a month (it ends ~3 months before the newest crash), so only repair
requests and the newest unscored crashes change in between.

```
GitHub Actions (Mondays ~2am Pacific, or the "Run workflow" button)
  -> pinned DuckDB (checksum-verified) -> fetch.ps1 (row-count checks) -> build.sql -> dist/
  -> check.ps1 (file sizes + page self-test in headless Edge) -> deploy dist/ to GitHub Pages
```
- **To turn it on:** push the repository to GitHub, then Settings -> Pages -> Source: "GitHub Actions".
- **Safety:** any failed step stops the job before deploy, so the live site keeps the last good build. The fetch
  refuses a dataset that drops below its minimum or changes by more than 25% since the last run. Each build publishes
  its row counts as `data/counts.json` on the live site, and the next run downloads them, so the check works however long
  it has been. To accept a real big change once, run the workflow by hand with "accept_counts" ticked. `check.ps1` opens `index.html#selftest`, which draws the map and list, opens
  the #1 spot and a place outside the ranked list, and fails the build if any part doesn't show.
- **Security:** no outside scripts: Leaflet and the font are vendored, and a Content-Security-Policy allows only this
  site plus the map tiles and the address-lookup services.
- **Don't commit the data each week:** a rebuild rewrites ~25 MB of files under `site/data/`. Build and publish them as
  the Pages artifact instead of committing them, or the repository grows by over a gigabyte a year.
- **Caching:** `run.ps1` puts a short fingerprint of each file's contents in its address (`data/data.js?v=...`,
  `app.js?v=...`, `style.css?v=...`; the area files get the data fingerprint). Unchanged files keep their address, so
  returning visitors reuse them; a changed file has a new address, so browsers fetch it right away. After editing
  `app.js` or `style.css` by hand, re-run `run.ps1` (or the weekly job) to refresh the fingerprints.
- **Cost:** free on both GitHub Pages and Cloudflare Pages.
- **Pipeline portability:** the job runs on a Windows runner with Windows PowerShell, same as local. Moving to Linux
  runners later means porting `fetch.ps1`/`run.ps1` to PowerShell 7 or Node.
- **History (done, no storage needed):** `pipeline/history.sql` re-runs the ranking for 1 January of each year since 2018
  and for each of the last 12 months, from the crash records (2011 on) and SDOT's dated fixes. That powers the
  "Is it getting fixed?" view (since last month; did the worst places of a past year get a fix; need vs published work
  by council district and equity index) and each place's rank over the years. Late police reports slightly revise past
  months, which is intended. Saving weekly snapshots is still worth adding later for things that aren't dated in the
  data (repair-request status, project stage changes).
- **Domain:** **streetsfirst.org**, registered at Cloudflare (streetfirst.org, if held, redirects to it for typos).
  DNS at Cloudflare, every record set to **DNS only (grey cloud)** so GitHub can issue the https certificate:
  four `A` records for `@` (185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153), four `AAAA` records
  for `@` (2606:50c0:8000::153, 2606:50c0:8001::153, 2606:50c0:8002::153, 2606:50c0:8003::153), and `CNAME www` to
  `<github-user>.github.io`. In GitHub: repository Settings -> Pages -> Custom domain `streetsfirst.org`, then Enforce
  HTTPS once offered; and verify the domain under the account's Settings -> Pages (a TXT record) so no one else can
  claim it on GitHub. The weekly job reads last week's row counts from `SITE_URL` in `.github/workflows/weekly.yml`;
  change it there if the address ever changes.

## v3+: if it outgrows static
Triggers: many cities/regions, user accounts, comments, or data too large for static files.
- **Database:** Postgres + PostGIS on a managed host (Supabase, Neon, Railway).
- **Map data:** vector tiles (PMTiles on object storage) instead of JSON.
- **API:** a small API for per-region queries.

## Done in tester round 1
- Expected harm (empirical Bayes on severity), chosen by an out-of-sample test; honest SDOT consistency check.
- Traffic volume per street at each spot, with count year and estimate flags; risk ranking per vehicle entering.
- Scoring window that skips the last 3 months (late police reports); Unknown severity scored 0.
- SDOT actions per spot: head-start walk signals (LPI), protected left turns, accessible signals; "still dangerous after" flags.
- Fetch writes to data/raw.tmp and only swaps in if row counts look sane; retries; paging by exceededTransferLimit.

## Next (from the developer review, accepted)
1. Sidewalk and curb-ramp ranking (Sidewalk_Observation, Sidewalks_(Active), Curb_Ramps_(Active)), weighted by
   transit walksheds, school walk zones and the city's Race and Social Equity index. Show property-owner responsibility.
2. Request-to-repair tracking with SDOT_Sidewalk_WorkOrders_Public (links to 311 numbers; time to fix; recorded cost).
3. Before/after look at head-start walk signals vs comparable signals (labelled as observed change, not effect).
4. Nightly score snapshots keyed on stable IDs (INTKEY / COMPKEY instead of SDOT's location text).
5. Planned work: All_Sidewalk_Projects, Transportation_Plans_and_Projects (incl. unfunded), paving moratoria.
6. Port fetch to Node or DuckDB httpfs for Linux CI; lazy-load per-spot details once hosted.
7. Expansion: a canonical collision schema with per-city adapters (Vancouver WA publishes WSDOT-schema crashes).

## Roadmap for the data
1. Normalize by traffic volume (SDOT traffic counts) so busy streets aren't automatically on top.
2. ~~Smooth fatal crashes~~ Done: KSI weighting, compounding repeated fatal crashes,
   reliability factor, capped request boost. A possible next step is empirical-Bayes
   comparison with similar locations (same street type and volume).
2b. A "repair hotspots" view for places with many requests but few crashes (these are
   excluded from the safety ranking on purpose).
3. Link planned work: levy delivery plans, SDOT paving and project pages, project shapes.
   Mark items "scheduled" vs "unfunded".
4. Spending vs need by council district.
5. More layers: bridges (NBI and SDOT), sidewalk condition, pavement condition,
   drainage/flooding, heat and tree canopy, the equity index.
6. Weather: daily weather joined to crash dates; road-weather stations.
7. Expand: other WA cities, then statewide using national datasets.
