# Deployment plan

## v1 (now): local
- `run.ps1` fetches the data, runs the DuckDB scoring (`pipeline/build.sql`) and writes `site/data/data.js`.
- `site/index.html` opens directly in a browser. No server is needed.

## v2: public, static, rebuilt nightly
The site has no backend. Everything a visitor needs is precomputed into static files.

```
GitHub Actions (nightly cron, ~2am Pacific)
  -> fetch city data -> DuckDB build -> site/data/*.json
  -> deploy site/ to GitHub Pages (or Cloudflare Pages)
```
- **Cost:** free on both GitHub Pages and Cloudflare Pages.
- **Pipeline portability:** DuckDB runs on Linux runners. Port `fetch.ps1` to a
  cross-platform script (PowerShell 7 works on Linux, or switch to Python/Node).
- **History:** commit or upload a dated snapshot of the scores each night, e.g. to a
  `history/` branch or object storage. That enables "what changed since last month"
  views and tracking whether flagged spots ever get fixed.
- **Live layers:** fire/EMS 911 calls and drawbridge status are fetched by the browser
  directly from Socrata at page load (CORS is allowed). The ranking stays precomputed.
- **Domain:** optional custom domain on Pages.

## v3+: if it outgrows static
Triggers: many cities/regions, user accounts, comments, or data too large for static files.
- **Database:** Postgres + PostGIS on a managed host (Supabase, Neon, Railway).
- **Map data:** vector tiles (PMTiles on object storage) instead of JSON.
- **API:** a small API for per-region queries.

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
