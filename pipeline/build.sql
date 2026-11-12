-- Build the priority ranking from data/raw/ into data/priority.duckdb and site/data/*.json
-- Run from the project root:  tools\duckdb\duckdb.exe -no-agent data\priority.duckdb -f pipeline\build.sql
-- All weights live in the `weights` / `request_weights` tables below so they are easy to tune.

-- ---------------------------------------------------------------- memory
-- GitHub's Windows build machine has 16 GB of memory. DuckDB is capped below that, and big steps spill to disk
-- (data/duckdb_tmp) instead of failing. read_json's maximum_object_size is kept at 50 MB: DuckDB reserves about twice
-- that per thread, so the old 500 MB setting alone needed ~1 GB per thread. The downloaded files are a few MB each.
set memory_limit = '10GB';
set temp_directory = 'data/duckdb_tmp';

-- ---------------------------------------------------------------- settings
-- Three rankings are computed side by side; the site lets people switch between them.
--   ksi (recommended): expected harm. Crash harm (fatal = serious injury, "KSI") with repeated deaths
--                      compounding; the fatal/serious part is blended with the typical share on similar
--                      streets (empirical Bayes). Safety-related requests are shown but don't change the score
--                      (request_boost_max = 0): how often people report problems depends on who lives and travels there.
--   risk:              the same expected harm per million vehicles entering the spot (5 years of weekday counts).
--   fatal (old v1):    fatal crashes weighted far above everything else. Retired from the site; still
--                      computed so the change can be compared.
create or replace table weights as select * from (values
  ('ksi',               30.0),   -- points per fatal OR serious-injury collision
  ('fatal_growth',       1.5),   -- the nth fatal crash at a location counts ksi x growth^(n-1)
                                 --   (1st = 30, 2nd = 45, 3rd = 67.5 ...: repeated deaths compound)
  ('injury',             5.0),   -- other injury collision
  ('pdo',                1.0),   -- property damage only (Unknown severity: see expected harm, filled with the typical non-KSI harm)
  ('ped_bike_mult',      1.5),   -- x this when a pedestrian or cyclist was involved AND someone was hurt
  ('ksi_prior_crashes', 20.0),   -- expected harm: how many crashes a spot needs before its own fatal/serious
                                 --   share counts as much as the typical share for similar streets
  ('request_boost_max',  0.0),   -- off: requests could raise the score by up to this share (was 0.25)...
  ('request_boost_half', 50.0),  -- ...reaching half that boost at this many request points
  ('request_radius_m',  60.0),   -- requests within this distance count toward a location
  ('risk_min_crashes',  10.0),   -- risk mode: only locations with at least this many crashes
  ('risk_vol_floor',  2000.0),   -- risk mode: treat volumes below this as this (avoids extreme rates)
  ('fatal',            100.0),   -- old fatal-weighted mode: points per fatal collision
  ('serious',           30.0),   -- old mode: serious injury collision
  ('request_mult',       0.25)   -- old mode: request points are scaled by this before adding to score
) t(k, v);

-- Only request types plausibly tied to crash risk earn points (w > 0), and only from a date when every
-- one of them was being collected (Signal and Sign requests start 2023-05-30). Others are shown, not scored.
create or replace table request_weights as select * from (values
  ('Traffic Signal Maintenance',   3.0),
  ('Streetlight Maintenance',      2.0),
  ('Street Sign Maintenance',      2.0),
  ('Damaged Sidewalk',             0.0),   -- trip and access hazards, not crash risk; still listed at each spot
  ('ADA Request (Transportation)', 0.0),   -- same: access barriers, not crash risk
  ('Safe Routes to School',        2.0),
  ('Bicycle Facility Maintenance', 0.0),   -- only collected since 2024-11
  ('Pothole',                      0.0),
  ('Clogged Storm Drain',          0.0),
  ('Snow and Ice',                 0.0)
) t(type, w);

create or replace macro wt(name) as (select v from weights where k = name);

-- ---------------------------------------------------------------- settings the site's explanations also state
-- Each is set once here and used by the pipeline below. meta.json publishes them ("cfg") and the page's text reads them
-- from there, so an explanation can never repeat a number that has since changed. Never type one of these numbers into
-- site/app.js or site/index.html; pipeline/check_text.js fails the build if a new typed-in number appears in the page text.
create or replace macro window_months() as 60;      -- the scored crash window, in full months
create or replace macro window_years() as window_months() // 12;   -- the same in years (past rankings use whole years)
create or replace macro lag_months() as 3;          -- the newest months left unscored: police reports arrive late
create or replace macro top_n() as 50;              -- "the top 50": the summary, the SDOT comparison, districts' lists
create or replace macro list_n() as 200;            -- places published with full details in the ranked lists
create or replace macro busy_min_crashes() as 10;   -- "busy" places, for the High Injury Network comparison
create or replace macro near_ix_ft() as 100;        -- "nearby" an intersection: SDOT work, projects, crosswalks, curb ramps
create or replace macro near_block_ft() as 40;      -- "nearby" a block: within this of its street line
create or replace macro school_ft() as 1000;        -- the nearest public school is shown within this
create or replace macro merge_dlat() as 0.00055;    -- the two sides of a divided street merge within this (degrees of
create or replace macro merge_dlon() as 0.0008;     --   latitude and longitude: about 60 m each way)
create or replace macro hist_from_year() as 2018;   -- past rankings: 1 January of each year from this one
create or replace macro worst_n() as 50;            -- "Did the worst places get fixed?": the worst of a year...
create or replace macro worst_ref_to() as 150;      -- ...next to the places ranked just below them, down to this rank
create or replace macro recent_fix_days() as 365;   -- "Fixes SDOT recorded in the last 12 months"
create or replace macro ba_min_days() as 365;       -- before and after a fix: at least this long on each side...
create or replace macro ba_max_days() as 1095;      -- ...and at most this long
create or replace macro inc_min_crashes() as 2;     -- "Increases to look into": at least this many targeted crashes before and after...
create or replace macro inc_min_days() as 730;      -- ...over at least this long on each side
create or replace macro wide_n() as 100;            -- "Whole streets": places in the citywide top 100 (and top_n)
create or replace macro cmp_lag_months() as 6;      -- past rankings are compared with the last full years ending this long ago (severity fills in late)
create or replace macro move_min() as 5;             -- "what changed since last month": top places that moved at least this many ranks
create or replace macro deaths_min() as 2;          -- places where at least this many people died are always listed
create or replace macro repeat_years() as 3;        -- "repeat serious crashes": someone killed or seriously hurt in this many different years
create or replace macro ba_few_dates() as 5;         -- "Is it working?": a kind of fix with fewer separate install dates than this is too few to tell...
create or replace macro ba_cluster_dates() as 30;     -- ...and under this many, no claim about chance (blocks done in one project rise and fall together)
create or replace macro bus_min_mi() as 0.25;       -- bus stretches shorter than this aren't ranked (whole-minute timetables)
-- Interstate numbers are federal names (I-5 rather than SR 5); they don't change. Which routes are freeways comes from
-- WSDOT's access-control data instead (state_routes.sql).
create or replace macro signal_from() as date '1990-01-01';   -- signal install dates before this aren't shown as fixes
create or replace macro interstate(srn) as srn in ('005', '090', '405');

-- A place on a bridge, viaduct, tunnel or ramp, judged by its own street (not the cross streets that bound a stretch);
-- an intersection only when every street meeting there is one (a ramp's end on a surface street is at street level).
-- BR/BRIDGE only as the street's last word (or before a direction): Bridge Way N and CAMBRIDGE aren't bridges. Such a place is above or below the streets around it, so requests,
-- crosswalks, sidewalks and projects found by distance belong to those streets, not to it.
create or replace macro on_structure(loc) as
  list_bool_and(list_transform(string_split(regexp_replace(loc, ' BETWEEN .*', ''), ' AND '),
    lambda s: regexp_matches(s, '\b(BR|BRIDGE)( (NB|SB|EB|WB|N|S|E|W))?$|\b(VI|VIADUCT|TUNNEL|TUN)\b|\b(ON|OFF) RP\b')));

-- ---------------------------------------------------------------- raw -> clean
create or replace table collisions as
with raw as (
  select unnest(features, recursive := true)
  from read_json('data/raw/collisions_*.json', maximum_object_size = 50000000)
)
select
  INCKEY                                   as id,
  INTKEY                                   as intkey,
  trim(LOCATION)                           as location,
  ADDRTYPE                                 as addr_type,          -- I intersection, B block, A alley
  make_timestamp(INCDATE::bigint * 1000)::date as date,
  coalesce(MAXSEVERITYDESC, 'Unknown')     as severity,
  coalesce(PEDCOUNT, 0)                    as peds,
  coalesce(PEDCYLCOUNT, 0)                 as cyclists,
  -- a crash SDOT codes fatal or serious with no person listed in that column still had at least one (a few reports leave it 0)
  case when MAXSEVERITYDESC = 'Fatal Collision' then greatest(coalesce(FATALITIES, 0), 1) else coalesce(FATALITIES, 0) end as fatalities,
  case when MAXSEVERITYDESC = 'Serious Injury Collision' then greatest(coalesce(SERIOUSINJURIES, 0), 1) else coalesce(SERIOUSINJURIES, 0) end as serious_injuries,
  coalesce(INJURIES, 0)                    as injuries,
  coalesce(VEHCOUNT, 0)                    as vehicles,
  coalesce(PERSONCOUNT, 0)                 as persons,
  ROADCOND                                 as road_cond,
  LIGHTCOND                                as light_cond,
  WEATHER                                  as weather,
  ST_COLDESC                               as coll_type,
  -- time of day as written in the police report (null when the report has no time)
  hour(try_strptime(INCDTTM, '%m/%d/%Y %I:%M:%S %p')) as hour,
  SPEEDING = 'Y'                           as speeding,
  coordinates[1]                           as lon,
  coordinates[2]                           as lat,
  trim(LOCATION)                           as sdot_location      -- SDOT's own name, kept when split roadways are merged below
from raw
where LOCATION is not null and coordinates is not null
-- Probable duplicate reports: same place, day, severity, crash type, people, vehicles and conditions under two
-- report numbers (about 100 of 36,000, mostly property damage). Keep one.
qualify row_number() over (partition by LOCATION, INCDATE, MAXSEVERITYDESC, ST_COLDESC, PEDCOUNT, PEDCYLCOUNT,
          FATALITIES, SERIOUSINJURIES, INJURIES, VEHCOUNT, PERSONCOUNT, WEATHER, ROADCOND, LIGHTCOND order by INCKEY) = 1;

-- Split roadways: SDOT names each side of a divided street separately ("M L KING JR WR WAY S" and "... ER ...",
-- light rail in the median), so one intersection appears twice 15-20 m apart. Merge the two sides when they
-- are within ~60 m of each other. NB/SB/EB/WB are left alone: those are separate bridges and ramps.
-- Dates made from epoch milliseconds (to_timestamp) follow the session time zone: fixed to UTC so a local build and the
-- weekly build (which runs in UTC) agree to the day.
set TimeZone = 'UTC';
create or replace macro road_norm(t) as regexp_replace(t, ' (WR|ER|NR|SR) ', ' ', 'g');
create or replace table loc_merge as
with p as (select location raw, road_norm(location) k, avg(lon) lon, avg(lat) lat from collisions group by location),
g as (select k, max(lon) - min(lon) dlon, max(lat) - min(lat) dlat, count(*) n from p group by k)
select p.raw, case when g.n > 1 and g.dlon < merge_dlon() and g.dlat < merge_dlat() then p.k else p.raw end as location
from p join g using (k);
update collisions set location = m.location from loc_merge m where collisions.location = m.raw and m.raw <> m.location;

-- People killed and seriously injured citywide, including reports that have no location (so they can't be scored).
create or replace table collisions_unlocated as
with raw as (select unnest(features, recursive := true) from read_json('data/raw/collisions_*.json', maximum_object_size = 50000000))
select make_timestamp(INCDATE::bigint * 1000)::date as date, MAXSEVERITYDESC as severity,
       case when MAXSEVERITYDESC = 'Fatal Collision' then greatest(coalesce(FATALITIES, 0), 1) else coalesce(FATALITIES, 0) end as fatalities,
       case when MAXSEVERITYDESC = 'Serious Injury Collision' then greatest(coalesce(SERIOUSINJURIES, 0), 1) else coalesce(SERIOUSINJURIES, 0) end as serious_injuries
from raw where LOCATION is null or coordinates is null;



create or replace table requests as
select servicerequestnumber as id,
       webintakeservicerequests as type,
       createddate::date as date,
       servicerequeststatusname as status,
       location as address,
       latitude::double as lat, longitude::double as lon,
       councildistrict as council_district
from read_csv('data/raw/service_requests.csv');

create or replace table capital_budget as
select fiscal_year::int as year, deptname as dept, bclname as program,
       projecttitle as project, projectcode as code, fundname as fund, amount::double as amount
from read_csv('data/raw/capital_budget.csv', all_varchar = true);

-- ---------------------------------------------------------------- scoring window
-- 60 full months ending 3 months before the newest crash: police reports arrive late, so the latest
-- months are incomplete. Crashes after the window are shown on the site but not scored yet.
-- The day the data was fetched (not the build day, so a rebuild of older data works the same). A report dated after
-- it is a typing error in the source: it is left out of the window's end, so one wrong date can't move the window.
create or replace table fetch_day as
select coalesce(try_cast(left(trim(column0), 10) as date), current_date) as d
from read_csv('data/raw/fetched_at.txt', header = false, all_varchar = true, columns = {'column0': 'VARCHAR'});
create or replace macro fetched() as (select d from fetch_day);
create or replace table scoring_window as
with e as (select (date_trunc('month', max(date) filter (where date <= fetched())) - to_months(lag_months()))::date as w_end from collisions)
select (w_end - to_months(window_months()))::date as w_start, w_end,
       (w_end - interval 24 month)::date as test_start,                       -- validation split
       greatest(date '2023-06-01', (w_end - interval 36 month)::date) as req_start  -- request scoring window
from e;
create or replace macro ws() as (select w_start from scoring_window);
create or replace macro we() as (select w_end from scoring_window);
-- The fetch starts a few months before the scored years; if SDOT's data ever fell far enough behind that the scored years
-- began before the first crash fetched, the early months would be silently missing. Stop instead.
create or replace temp table window_ok as select case when (select min(date) from collisions) > ws() + interval 31 day
            then error('The scored years start before the first crash fetched: widen $Since in fetch.ps1') end;
create or replace table collisions_dropped as   -- disclosed on the site: reports in the scored years with no location
select count(*) n,
       count(*) filter (where severity in ('Fatal Collision', 'Serious Injury Collision')) ksi,
       count(*) filter (where severity = 'Fatal Collision') fatal
from collisions_unlocated where date >= ws() and date < we();

-- ---------------------------------------------------------------- location context (spatial)
-- Everything is projected to WA State Plane North (EPSG:2926, US feet) for distance math.
load spatial;
set geometry_always_xy = true;
create or replace macro gj_geom(g) as ST_Transform(ST_GeomFromGeoJSON(g::json), 'EPSG:4326', 'EPSG:2926');

-- Every pick below has a fixed tie-break (most common, then lowest), so two builds from the same data match exactly.
create or replace table locations_all as
with atype as (select location, arg_max(addr_type, {'n': n, 't': addr_type}) as addr_type
            from (select location, addr_type, count(*) as n from collisions group by all) group by location),
ik as (select location, arg_max(intkey, {'n': n, 'k': -intkey}) as intkey
       from (select location, intkey, count(*) as n from collisions where intkey is not null and intkey > 0 group by all)
       group by location)
select c.location, any_value(atype.addr_type) as addr_type, avg(c.lon) as lon, avg(c.lat) as lat, any_value(ik.intkey) as intkey
from collisions c left join atype using (location) left join ik using (location) group by c.location;

create or replace table streets as
select f.properties.COMPKEY as compkey, f.properties.UNITDESC as unitdesc,
       coalesce((select m.location from loc_merge m where m.raw = f.properties.UNITDESC), f.properties.UNITDESC) as loc_name,   -- the place name it belongs to (close split-roadway pairs merged, as for crashes)
       nullif(f.properties.SPEEDLIMIT, 0) as speed, f.properties.ARTCLASS as artclass,
       nullif(f.properties.PVMTCONDINDX1, 0) as pci,
       gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/streets_*.json', maximum_object_size = 50000000))
where f.geometry is not null;

create or replace table volumes as
select f.properties.STNAME_ORD as street, nullif(f.properties.AWDT, 0) as awdt,
       f.properties.DATAQUALIT as quality,
       year(make_timestamp(f.properties.START_DATE::bigint * 1000)) as count_year,
       gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/volumes_*.json', maximum_object_size = 50000000))
where f.geometry is not null;

create or replace table hin as   -- SDOT Vision Zero High Injury Network
select f.properties.PRIORITY as priority, gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/hin_*.json', maximum_object_size = 50000000))
where f.geometry is not null;

create or replace table hcl as   -- SDOT Vision Zero High Collision Locations (by year; its list type, and whether it's a corner)
select f.properties.HCL_YEAR as year, f.properties.TYPE as type,
       coalesce(nullif(trim(f.properties.INTKEY::varchar), ''), null) is not null as at_corner, gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/hcl_*.json', maximum_object_size = 50000000))
where f.geometry is not null;

create or replace table lpi as   -- Leading Pedestrian Intervals (walk signal starts before green)
select f.properties.LPI_Status as status,
       make_timestamp(f.properties.LPI_Install_Date::bigint * 1000)::date as installed,
       f.properties.LPI_Planned_Year as planned_year,
       ST_Centroid(gj_geom(f.geometry)) as geom, gj_geom(f.geometry) as geom_all
from (select unnest(features) f from read_json('data/raw/lpi_*.json', maximum_object_size = 50000000))
where f.geometry is not null;

create or replace table ntor as   -- No turn on red at a signal (all or some approaches)
select f.properties.NTOR_Status as status,
       -- a handful of records carry July 1905 (a placeholder, not a real install date): treated as unknown
       case when make_timestamp(f.properties.NTOR_Install_Date::bigint * 1000) >= timestamp '1950-01-01'
            then make_timestamp(f.properties.NTOR_Install_Date::bigint * 1000)::date end as installed,
       f.properties.NTOR_Planned_Year as planned_year, nullif(trim(f.properties.Approaches), '') as approaches,
       ST_Centroid(gj_geom(f.geometry)) as geom, gj_geom(f.geometry) as geom_all
from (select unnest(features) f from read_json('data/raw/ntor_*.json', maximum_object_size = 50000000))
where f.geometry is not null;

create or replace table signals as
select f.properties.INTKEY as intkey,
       f.properties.PEDSIGNALYN = 'Y' as ped_signal,
       f.properties.PEDAUDIODEVICEYN = 'Y' as ped_audio,
       f.properties.LTPROTECTEDYN = 'Y' as lt_protected,
       make_timestamp(f.properties.LTFIRSTINSTALLDT::bigint * 1000)::date as lt_installed,
       make_timestamp(f.properties.INSTALL_DATE::bigint * 1000)::date as installed,
       case when f.geometry is not null then gj_geom(f.geometry) end as geom
from (select unnest(features) f from read_json('data/raw/signals_*.json', maximum_object_size = 50000000));

-- Intersections look 60 ft around the point (all approaching streets); blocks 40 ft (the block itself).
create or replace table loc_pts as
select location, ST_Transform(ST_Point(lon, lat), 'EPSG:4326', 'EPSG:2926') as geom,
       case when addr_type = 'I' then 60 else 40 end as r
from locations_all;

-- Street names at each location, from SDOT's location text: "A AND B" (intersection) or "A BETWEEN x AND y" (block).
create or replace table loc_names as
select location, road_norm(name) as name from (
  select location, unnest(case when addr_type = 'I' then string_split(location, ' AND ')
                               else [split_part(location, ' BETWEEN ', 1)] end) as name
  from locations_all);

-- Count names can list several streets ("20TH AVE S,S JUDKINS ST"): one row per street name.
create or replace table volumes_named as
select road_norm(trim(unnest(string_split(street, ',')))) as street, awdt, quality, count_year, geom
from volumes where street is not null;

-- Traffic volume. For each street at the spot, the nearest SDOT count on that same street within 300 ft
-- (so a cross street with no count right at the corner still finds its count). Intersections add the
-- streets together (vehicles entering); blocks use their own street. Count year and quality are kept.
create or replace table loc_volume as
with nearest as (
  select n.location, n.name,
         arg_min({'awdt': v.awdt, 'yr': v.count_year, 'est': v.quality = 'Estimate'},
                 {'d': ST_Distance(p.geom, v.geom), 'y': -v.count_year, 'a': v.awdt}) as hit   -- ties: newest count
  from loc_names n join loc_pts p using (location)
  join volumes_named v on v.street = n.name and v.awdt is not null and ST_DWithin(p.geom, v.geom, 300)
  group by n.location, n.name
)
select location, sum(hit.awdt)::int as volume, count(*) as volume_streets,
       min(hit.yr) as volume_year, bool_or(hit.est) as volume_estimated
from nearest group by location;

create or replace table loc_context as
with
s as (select p.location,
        -- (on a bridge or tunnel, the streets around it are not its street: no speed rather than theirs)
        coalesce(max(s.speed) filter (where own.name is not null), case when not on_structure(p.location) then max(s.speed) end) as speed_limit,
        min(s.artclass) filter (where s.artclass between 1 and 5) as art_class,
        min(s.pci) as pavement_min
      from loc_pts p join streets s on ST_DWithin(p.geom, s.geom, 60)
      left join loc_names own on own.location = p.location and own.name = road_norm(regexp_replace(s.unitdesc, ' BETWEEN .*$', ''))
      where ST_Distance(p.geom, s.geom) <= p.r
        -- a freeway or ramp passing over or beside a place isn't its street (it gave downtown corners I-5's 60 mph),
        -- unless the place is that ramp
        and (s.loc_name = p.location
             or not regexp_matches(regexp_replace(s.unitdesc, ' BETWEEN .*$', ''), '^(I ?5|I ?90|I ?405|SR ?[0-9]+)( |$)| RP( |$)'))
      group by p.location),
len as (select loc_name as location, max(ST_Length(geom)) as block_ft from streets group by loc_name),
h as (select p.location, min(case h.priority when 'High' then 1 when 'Mid' then 2 when 'Low' then 3 end) as hin_level
      from loc_pts p join hin h on ST_DWithin(p.geom, h.geom, 60) group by p.location),
-- A corner entry (SDOT gives it an intersection key) labels only the intersection, within 80 ft; a mid-block entry labels
-- only the stretch whose street line runs within 40 ft of it. (Matching both by distance let a corner's entry spill onto
-- short stretches beside it.)
c as (select location, list(distinct year order by year) as hcl_years, list(distinct type order by type) as hcl_types
      from (select p.location, c.year, c.type from loc_pts p join hcl c on c.at_corner and p.r <> 40 and ST_DWithin(p.geom, c.geom, 80)
            union all
            select s.unitdesc, c.year, c.type from streets s join hcl c on not c.at_corner and ST_DWithin(s.geom, c.geom, 40)
            where s.unitdesc in (select location from loc_pts where r = 40))
      group by location),
-- Each point of a head-start walk signal or no turn on red record belongs to its one nearest intersection (within
-- 100 ft), so a record at a skewed or offset junction that SDOT splits into several intersections isn't counted at each
-- of them. A record can have several points (e.g. both halves of a split roadway, up to ~300 ft apart): each point is
-- matched on its own (their midpoint can fall between the corners, which dropped some records before).
lpi_pt as (select row_number() over () as pid, * from (select rid, unnest(ST_Dump(geom_all)).geom as g from (select rowid as rid, geom_all from lpi))),
ntor_pt as (select row_number() over () as pid, * from (select rid, unnest(ST_Dump(geom_all)).geom as g from (select rowid as rid, geom_all from ntor))),
lpi_at as (select distinct rid, location from (
             select l.rid, l.pid, arg_min(p.location, ST_Distance(p.geom, l.g)) as location
             from lpi_pt l join loc_pts p on p.r = 60 and ST_DWithin(p.geom, l.g, near_ix_ft()) group by l.rid, l.pid)),
ntor_at as (select distinct rid, location from (
             select n.rid, n.pid, arg_min(p.location, ST_Distance(p.geom, n.g)) as location
             from ntor_pt n join loc_pts p on p.r = 60 and ST_DWithin(p.geom, n.g, near_ix_ft()) group by n.rid, n.pid)),
lp as (select p.location,   -- at a place with several records: Existing first, then the nearest
         arg_min({'status': l.status, 'installed': l.installed, 'planned': l.planned_year},
                 {'s': case l.status when 'Existing' then 0 when 'Planned' then 1 else 2 end, 'd': ST_Distance(p.geom, l.geom),
                  'i': l.installed, 'p': l.planned_year}) as lpi
       from loc_pts p join lpi_at x using (location) join lpi l on l.rowid = x.rid
       group by p.location),
nt as (select p.location,   -- same rule as head-start signals
         arg_min({'status': n.status, 'installed': n.installed, 'planned': n.planned_year, 'approaches': n.approaches},
                 {'s': case n.status when 'Existing' then 0 when 'Planned' then 1 else 2 end, 'd': ST_Distance(p.geom, n.geom),
                  'i': n.installed, 'p': n.planned_year}) as ntor
       from loc_pts p join ntor_at x using (location) join ntor n on n.rowid = x.rid
       group by p.location),
sg as (select a.location, bool_or(ped_signal) ped_signal, bool_or(ped_audio) ped_audio,
              bool_or(lt_protected) lt_protected, min(lt_installed) filter (where lt_protected) lt_installed,
              max(installed) signal_installed   -- the newest signal install (a new or rebuilt signal)
       -- matched by SDOT's intersection key, or by place (within 80 ft) when the key differs, e.g. merged split roadways
       from locations_all a join loc_pts p using (location)
       join signals g on g.intkey = a.intkey or (a.addr_type = 'I' and g.geom is not null and ST_DWithin(p.geom, g.geom, 80))
       group by a.location)
select a.location, a.addr_type, a.intkey, s.speed_limit, s.art_class, s.pavement_min,
       case when a.addr_type <> 'I' then len.block_ft end as block_ft,
       v.volume, v.volume_streets, v.volume_year, v.volume_estimated,
       h.hin_level, coalesce(c.hcl_years, []) as hcl_years, c.hcl_types,
       lp.lpi.status as lpi_status, lp.lpi.installed as lpi_installed, lp.lpi.planned as lpi_planned,
       nt.ntor.status as ntor_status, nt.ntor.installed as ntor_installed, nt.ntor.planned as ntor_planned, nt.ntor.approaches as ntor_approaches,
       sg.location is not null as signalized, sg.ped_signal, sg.ped_audio, sg.lt_protected, sg.lt_installed, sg.signal_installed,
       -- reference group for expected harm
       case when a.addr_type = 'I' then 'I' else 'B' end as addr_class,
       case s.art_class when 1 then 'principal' when 2 then 'minor' when 3 then 'collector'
                        when 4 then 'state' when 5 then 'state' else 'local' end as street_bucket
from locations_all a
left join s using (location) left join len using (location) left join loc_volume v using (location)
left join h using (location) left join c using (location)
left join lp using (location) left join nt using (location) left join sg using (location);

-- Neighborhoods (City of Seattle Neighborhood Map Atlas): 20 large areas, 94 neighborhoods. Used to say where a
-- spot is ("West Seattle · Alki") and to label the map.
create or replace table hoods as
select f.properties.L_HOOD as area, f.properties.S_HOOD as neighborhood, gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/hoods_sub_*.json', maximum_object_size = 50000000))
where f.geometry is not null;

-- A spot on a border (arterials often are) gets both names: every neighborhood within 40 ft of it,
-- otherwise the nearest one within 200 ft.
create or replace table loc_context as
with d as (select p.location, h.area, h.neighborhood, ST_Distance(p.geom, h.geom) as dist
           from loc_pts p join hoods h on ST_DWithin(p.geom, h.geom, 200)),
near as (select *, min(dist) over (partition by location) as dmin from d),
pick as (select * from near where dist <= greatest(dmin, 40))
select x.*, n.area, n.neighborhood
from loc_context x
left join (select location,
             array_to_string(list(distinct area order by area), ' / ') as area,
             array_to_string(list(distinct neighborhood order by neighborhood), ' / ') as neighborhood
           from pick group by location) n using (location);

-- ---------------------------------------------------------------- crash harm (any date range)
-- pb: only crashes involving someone walking or biking (the walking and biking ranking)
create or replace macro harm_in(d0, d1, pb := false) as table
with c as (
  select location, date, id, severity, peds, cyclists, road_cond, light_cond, speeding, fatalities, serious_injuries, coll_type,
    severity in ('Fatal Collision', 'Serious Injury Collision') as is_ksi,
    (case severity
       when 'Fatal Collision'                then wt('ksi')
       when 'Serious Injury Collision'       then wt('ksi')
       when 'Injury Collision'               then wt('injury')
       when 'Property Damage Only Collision' then wt('pdo')
       else 0 end)
    * (case when peds + cyclists > 0 and severity in ('Fatal Collision', 'Serious Injury Collision', 'Injury Collision')
            then wt('ped_bike_mult') else 1 end)
    -- repeated deaths at the same location compound (oldest first)
    * (case when severity = 'Fatal Collision'
            then power(wt('fatal_growth'),
                       row_number() over (partition by location, severity = 'Fatal Collision' order by date, id) - 1)
            else 1 end) as pts,
    (case severity
       when 'Fatal Collision'                then wt('fatal')
       when 'Serious Injury Collision'       then wt('serious')
       when 'Injury Collision'               then wt('injury')
       when 'Property Damage Only Collision' then wt('pdo')
       else 0 end)
    * (case when peds + cyclists > 0 then wt('ped_bike_mult') else 1 end) as pts_old
  from collisions where date >= d0 and date < d1 and (not pb or peds + cyclists > 0)
)
select location,
  count(*)                                                        as crashes,
  count(*) filter (where severity = 'Unknown')                    as unknown_sev,
  count(*) filter (where severity = 'Fatal Collision')            as fatal,
  count(*) filter (where severity = 'Serious Injury Collision')   as serious,
  count(*) filter (where severity = 'Injury Collision')           as injury,
  count(*) filter (where is_ksi)                                  as ksi,
  count(distinct year(date)) filter (where is_ksi)                as ksi_years,
  sum(fatalities)                                                 as killed,
  sum(serious_injuries)                                           as seriously_injured,
  count(*) filter (where peds + cyclists > 0)                     as pb_crashes,
  count(*) filter (where peds > 0)                                as ped_crashes,
  count(*) filter (where cyclists > 0)                            as bike_crashes,
  count(*) filter (where road_cond ilike 'wet%' or road_cond ilike '%ice%' or road_cond ilike '%snow%') as wet_crashes,
  count(*) filter (where light_cond ilike 'dark%')                as dark_crashes,
  count(*) filter (where light_cond ilike 'dark - street lights off%' or light_cond ilike 'dark - no street lights%') as unlit_crashes,
  count(*) filter (where road_cond is not null and road_cond not in ('Unknown', 'Other'))   as road_known,
  count(*) filter (where light_cond is not null and light_cond not in ('Unknown', 'Other')) as light_known,
  count(*) filter (where speeding)                                as speeding_crashes,
  -- crash patterns with well-known fixes (shown as context, not scored)
  count(*) filter (where coll_type = 'From opposite direction - one left turn - one straight') as left_turn_crashes,
  count(*) filter (where coll_type ilike 'Vehicle turning % hits pedestrian')               as ped_turn_crashes,
  count(*) filter (where coll_type = 'Vehicle turning right hits pedestrian')               as ped_right_crashes,
  count(*) filter (where nullif(trim(coll_type), '') is not null)                            as typed_crashes,
  count(*) filter (where coll_type = 'Entering at angle')                                    as angle_crashes,
  min(date) as first_crash, max(date) as last_crash,
  sum(pts)       as harm,
  sum(pts) filter (where is_ksi) as ksi_harm_raw,
  sum(pts_old)   as pts_old
from c group by location;


-- ---------------------------------------------------------------- expected harm (empirical Bayes on severity)
-- Whether a crash kills or seriously injures someone also depends on things beyond the street (speed, age, vehicle,
-- how fast help arrives).
-- So a spot's fatal/serious harm is estimated by blending its own record with the typical fatal/serious
-- share on similar streets (same kind of location and street class), weighted by how many crashes it has:
--   own-record weight  w = crashes / (crashes + A)              (A = ksi_prior_crashes)
--   expected harm      = other-crash harm + w * own KSI harm + (1 - w) * crashes * typical KSI harm per crash
-- A spot with 3 crashes leans mostly on the typical share; one with 60 leans on its own record. Every crash
-- is evidence of exposure, so busy spots with many minor crashes still count. Chosen because it predicted
-- future fatal/serious crashes better than the alternatives (see the validation table below).
-- With pb, the same from crashes involving someone walking or biking only, with its own typical share for similar streets.
create or replace macro eb_in(d0, d1, pb := false) as table
with h as (
  select h.* exclude (ksi_harm_raw), coalesce(h.ksi_harm_raw, 0) as ksi_harm, x.addr_class, x.street_bucket, x.addr_class || ' / ' || x.street_bucket as ref_group
  from harm_in(d0, d1, pb := pb) h join loc_context x using (location)
),
g as (select ref_group, count(*) ref_n, sum(ksi_harm) / sum(crashes) as ref_ksi_harm_per_crash,
             sum(harm - ksi_harm) / nullif(sum(crashes - unknown_sev), 0) as ref_other_harm_per_known,
             sum(ksi) / sum(crashes) as ref_ksi_share
      from h group by ref_group)
select h.*, g.ref_n, g.ref_ksi_share, g.ref_ksi_harm_per_crash, g.ref_other_harm_per_known,
  h.crashes / (h.crashes + wt('ksi_prior_crashes')) as eb_weight,
  (h.harm - h.ksi_harm)
    + h.crashes / (h.crashes + wt('ksi_prior_crashes')) * h.ksi_harm
    + wt('ksi_prior_crashes') / (h.crashes + wt('ksi_prior_crashes')) * h.crashes * g.ref_ksi_harm_per_crash
    + h.unknown_sev * coalesce(g.ref_other_harm_per_known, 0) as expected_harm
from h join g using (ref_group);

-- ---------------------------------------------------------------- state highways and who runs them (WSDOT's layers)
.read pipeline/state_routes.sql

-- ---------------------------------------------------------------- locations in the scoring window
create or replace table locations as
select e.*, x.addr_type, x.intkey, x.speed_limit, x.art_class,
  case x.art_class when 1 then 'Principal arterial' when 2 then 'Minor arterial' when 3 then 'Collector arterial'
                   when 4 then 'State route' when 5 then 'Freeway' else 'Neighborhood street' end as street_type,
  x.pavement_min, x.block_ft, x.volume, x.volume_streets, x.volume_year, x.volume_estimated,
  case x.hin_level when 1 then 'High' when 2 then 'Mid' when 3 then 'Low' end as sdot_hin,
  x.hcl_years as sdot_hcl_years, x.hcl_types as sdot_hcl_types,
  x.area, x.neighborhood,
  x.lpi_status, x.lpi_installed, x.lpi_planned, x.ntor_status, x.ntor_installed, x.ntor_planned, x.ntor_approaches, x.signalized, x.ped_signal, x.ped_audio, x.lt_protected, x.lt_installed, x.signal_installed,
  a.lon, a.lat,
  -- state highways (pipeline/state_routes.sql): state_route only where WSDOT runs it (freeways, ramps, state bridges, the
  -- tunnel); state_hwy where it's a city street on a state highway, which the City runs (counted as a city street)
  case when ps.runs = 'wsdot' then ps.route end as state_route,
  case when ps.runs = 'city' then ps.route end as state_hwy, ps.bridge as state_bridge,
  on_structure(e.location) as structure,
  case when e.crashes < 5 then 'low' when e.crashes < 15 then 'medium' else 'high' end as confidence
from eb_in(ws(), we()) e
join loc_context x using (location)
join locations_all a using (location)
left join place_state ps using (location);

-- Still dangerous after SDOT acted or listed it: KSI crashes after the first High Collision listing,
-- and pedestrian crashes after a Leading Pedestrian Interval was installed.
create or replace table locations as
select l.*,
  (select count(*) from collisions c where c.location = l.location and c.date >= ws() and c.date < we()
     and c.severity in ('Fatal Collision', 'Serious Injury Collision')
     and len(l.sdot_hcl_years) > 0 and year(c.date) > l.sdot_hcl_years[1]) as ksi_after_hcl,
  (select count(*) from collisions c where c.location = l.location and c.date >= ws() and c.date < we()
     and c.peds > 0 and l.lpi_status = 'Existing' and c.date > l.lpi_installed) as ped_after_lpi,
  (select count(*) from collisions c where c.location = l.location and c.date >= ws() and c.date < we()
     and c.peds > 0 and c.coll_type ilike '%turning%' and l.lpi_status = 'Existing' and c.date > l.lpi_installed) as ped_turn_after_lpi
from locations l;

-- ---------------------------------------------------------------- nearby requests
-- bounding-box prefilter (~0.001 deg) then equirectangular distance in meters
create or replace table location_requests as
select l.location, r.type, r.date, r.id, r.lat, r.lon,
       111320 * sqrt(power(r.lat - l.lat, 2) + power((r.lon - l.lon) * cos(radians(l.lat)), 2)) as dist_m
from locations_all l
join requests r
  on r.lat between l.lat - 0.0008 and l.lat + 0.0008
 and r.lon between l.lon - 0.0012 and l.lon + 0.0012
where 111320 * sqrt(power(r.lat - l.lat, 2) + power((r.lon - l.lon) * cos(radians(l.lat)), 2)) <= wt('request_radius_m');

-- Scored requests: safety-related types, one shared date range, duplicates collapsed
-- (same type, same ~10 m spot, same month = one report).
create or replace table location_request_summary as
with all_types as (
  select location, sum(n) as requests,
         list({'type': type, 'n': n} order by n desc, type) as request_types
  from (select location, type, count(*) n from location_requests group by all)
  group by location
),
scored as (
  select lr.location, sum(rw.w) as request_points, count(*) as scored_requests
  from (select distinct location, type, round(lat, 4) la, round(lon, 4) lo, date_trunc('month', date) mo
        from location_requests
        where date >= (select req_start from scoring_window) and date < we() and not on_structure(location)) lr
  join request_weights rw on rw.type = lr.type and rw.w > 0
  group by lr.location
)
select a.location, a.requests, a.request_types, coalesce(s.request_points, 0) request_points,
       coalesce(s.scored_requests, 0) scored_requests
from all_types a left join scored s using (location);

-- fixes SDOT has built, traffic over the years, buses and rush-hour bus slowdown (context only, not scored)
.read pipeline/traffic.sql
-- sidewalks: SDOT's missing-sidewalk priorities and sidewalks in poor condition (context only, not scored)
.read pipeline/sidewalks.sql
-- SDOT's published project maps: planned and recently finished work (context only, not scored)
.read pipeline/projects.sql
-- what's on the street, nearby school, equity index, council district, before/after (context only, not scored)
.read pipeline/context.sql

-- ---------------------------------------------------------------- source checks
-- The scoring and the "built / planned" labels match SDOT's category values by name. A value SDOT renames or adds would
-- otherwise fall through silently (a renamed severity would score its crashes as 0), so any value outside the known set
-- stops the build and the site keeps last week's version. To accept a new value, add it here and to the code that reads it.
create or replace temp table source_values as
select 'crash severity' as what, v from (select distinct severity as v from collisions)
  where v not in ('Fatal Collision', 'Serious Injury Collision', 'Injury Collision', 'Property Damage Only Collision', 'Unknown')
union all select 'head-start walk signal status', v from (select distinct status as v from lpi) where v not in ('Existing', 'Planned', 'Not Feasible')
union all select 'no turn on red status', v from (select distinct status as v from ntor) where v not in ('Existing', 'Planned', 'Not Feasible')
union all select 'bike lane STATUS', v from (select distinct upper(f.properties.STATUS) as v
    from (select unnest(features) f from read_json('data/raw/bikelanes_*.json', maximum_object_size = 50000000)))
  where v not in ('CONST', 'INSVC', 'MEETS', 'UPGRADE')
union all select 'bus lane Status', v from (select distinct f.properties.Status as v
    from (select unnest(features) f from read_json('data/raw/buslanes_*.json', maximum_object_size = 50000000)))
  where v not in ('Active', 'Planned')
union all select 'bike facility CATEGORY', v from (select distinct f.properties.CATEGORY as v
    from (select unnest(features) f from read_json('data/raw/bikefac_*.json', maximum_object_size = 50000000)))
  where v not in ('BKF-PBL', 'BKF-OFFST', 'BKF-BBL', 'BKF-BL', 'BKF-CLMB', 'BKF-NGW', 'BKF-SHW')
-- coded fields the scoring and context depend on: a renamed code would otherwise fall through quietly
union all select 'crash ADDRTYPE', v from (select distinct addr_type as v from collisions) where v not in ('I', 'B', 'A')
union all select 'High Injury Network PRIORITY', v from (select distinct priority as v from hin) where v not in ('High', 'Mid', 'Low')
union all select 'street ARTCLASS', v::varchar from (select distinct artclass as v from streets) where v not in (0, 1, 2, 3, 4, 5, 9)
union all select 'speed hump/cushion/radar CURRENT_STATUS', v from (select distinct st as v from (
    select f.properties.CURRENT_STATUS as st from (select unnest(features) f from read_json('data/raw/humps_*.json', maximum_object_size = 50000000))
    union all select f.properties.CURRENT_STATUS from (select unnest(features) f from read_json('data/raw/cushions_*.json', maximum_object_size = 50000000))
    union all select f.properties.CURRENT_STATUS from (select unnest(features) f from read_json('data/raw/radar_*.json', maximum_object_size = 50000000))))
  where v not in ('INSVC', 'PLANNED', 'TEMPOUTSVC', 'REMOVED', 'RETIRED')
union all select 'neighborhood safety project stage', v from (select distinct stage as v from proj_raw_nispp)
  where v not in ('Completed', 'Complete', 'Planned', 'In Design', 'Design', 'Construction', 'In Construction');
create or replace temp table source_values_ok as
select case when count(*) > 0 then error('Unknown source values (add them to build.sql if they are real): ' ||
         string_agg(what || ' = ' || v, '; ')) end from source_values;
-- A source that stopped updating still downloads fine: the newest crash report and the newest request must be recent
-- (crash reports arrive weeks late, so 60 days; requests arrive daily).
create or replace temp table freshness_ok as
select case when (select max(date) from collisions where date <= fetched()) < fetched() - interval 60 day
              then error('Crash data looks stale: newest report ' || (select max(date) from collisions where date <= fetched())::varchar)
            when (select max(date) from requests) < fetched() - interval 14 day
              then error('Request data looks stale: newest request ' || (select max(date) from requests)::varchar)
            -- the budget years the site shows must reach the current year
            when (select max(year) from capital_budget where dept = 'Seattle Department of Transportation') < year(fetched())
              then error('SDOT capital budget has no rows for ' || year(fetched())::varchar)
       end;
-- street addresses for search suggestions (not scored)
.read pipeline/addresses.sql

-- ---------------------------------------------------------------- final ranking
create or replace table priorities as
with b as (
  select l.*,
    coalesce(s.requests, 0) as requests, coalesce(s.scored_requests, 0) as scored_requests,
    coalesce(s.request_points, 0) as request_points, s.request_types,
    wt('request_boost_max') * coalesce(s.request_points, 0)
      / (coalesce(s.request_points, 0) + wt('request_boost_half')) as request_boost
  from locations l left join location_request_summary s using (location)
),
-- Walking and biking: the same expected harm, from crashes involving someone walking or biking only (places with none
-- aren't ranked on it), with the same boost for repair requests.
pb as (select location, expected_harm as pb_expected_harm, round(eb_weight, 3) as pb_eb_weight, ref_ksi_share as pb_ref_ksi_share
       from eb_in(ws(), we(), pb := true))
select b.*, pb.pb_expected_harm, pb.pb_eb_weight, pb.pb_ref_ksi_share,
  pb.pb_expected_harm * (1 + request_boost)                         as score_pb,
  expected_harm * (1 + request_boost)                                as score_ksi,
  pts_old + request_points * wt('request_mult')                      as score_fatal,
  -- Risk: expected harm per million vehicles over the 5 scoring years (weekday counts x 365 x 5; intersections:
  -- streets added together, i.e. vehicles entering).
  case when volume is not null and crashes >= wt('risk_min_crashes')
       then expected_harm * 1e6 / (greatest(volume, wt('risk_vol_floor')) * 365.0 * window_months() / 12.0) end as score_risk
from b left join pb using (location);

create or replace table ranked as
-- One list: intersections and the stretches of street between them ranked together by score, so #1 is the place most
-- likely to hurt people, whichever kind it is. (Tested on earlier years, this does about as well as ranking the two
-- kinds apart in the top 50 and better in the top 200: see the validation table.) Judging long stretches per 1,000 ft
-- caught fewer later deaths and serious injuries (long stretches really do keep producing them), so every place keeps
-- its full score. rank_type is the place's rank among its own kind, for the lists filtered to one kind.
-- Scores are rounded for ranking: sums done in parallel can differ in the last digit from build to build, which would
-- let equal scores swap places instead of falling to the tie-breaks.
with a as (
  select *, addr_type = 'I' as is_int,
    score_ksi as score_rank
  from priorities
),
b as (select *, row_number() over (partition by is_int order by round(score_rank, 9) desc, crashes desc, location) as rank_type from a)
select row_number() over (order by round(score_rank, 9) desc, crashes desc, location)     as rank,
       row_number() over (order by round(expected_harm, 9) desc, crashes desc, location)  as rank_noboost,
       row_number() over (order by round(score_fatal, 9) desc, crashes desc, location)     as rank_fatal,
       case when score_risk is not null
            then row_number() over (partition by score_risk is null order by round(score_risk, 12) desc, crashes desc, location) end as rank_risk,
       case when score_pb is not null
            then row_number() over (partition by score_pb is null order by round(score_pb, 9) desc, pb_crashes desc, location) end as rank_pb,
       *
from b;

-- the ranking at earlier dates; what changed; need and published work by district (context only, not scored)
.read pipeline/history.sql

-- ---------------------------------------------------------------- validation
-- 1) Out of sample: rank on earlier years only, then count the fatal/serious crashes that happened afterwards at each
--    method's top 50. A ranking that finds lasting danger should catch more of them. Two splits, so one unusual split
--    can't carry the result: (a) rank on the first 3 years, test the last 2; (b) rank on the first 2, test the next 2.
create or replace macro val_split(t0, t1, v0, v1) as table
with train as (select * from eb_in(t0, t1)),
test as (select location, count(*) filter (where severity in ('Fatal Collision', 'Serious Injury Collision')) ksi
         from collisions where date >= v0 and date < v1 group by location),
methods as (
  select 'expected' m, location, row_number() over (order by round(expected_harm, 9) desc, crashes desc, location) rk from train
  union all select 'raw_harm', location, row_number() over (order by round(harm, 9) desc, crashes desc, location) from train
  union all select 'old_reliability', location, row_number() over (order by round(harm * crashes / (crashes + 3), 9) desc, crashes desc, location) from train
  union all select 'crash_count', location, row_number() over (order by crashes desc, harm desc, location) from train
  union all select 'ksi_count', location, row_number() over (order by ksi desc, crashes desc, location) from train
  -- the alternative: intersections and stretches ranked apart, the two lists interleaved (the site's rule until Nov 2026)
  union all select 'expected_split', location, 2 * rt - case when is_int then 1 else 0 end from (
    select t.location, x.addr_type = 'I' as is_int,
      row_number() over (partition by x.addr_type = 'I' order by
        round(t.expected_harm, 9) desc,
        t.crashes desc, t.location) as rt
    from train t join loc_context x using (location))
)
select m as method,
  coalesce(sum(t.ksi) filter (where rk <= top_n()), 0)::int  as future_ksi_50,
  coalesce(sum(t.ksi) filter (where rk <= list_n()), 0)::int as future_ksi_200
from methods left join test t using (location) group by m;

create or replace table validation_splits as
select (select test_start from scoring_window) as a_test0, ws() + interval 24 month as b_mid, ws() + interval 48 month as b_end;

create or replace table validation as
select a.method, a.future_ksi_50, a.future_ksi_200, b.future_ksi_50 as b_ksi_50, b.future_ksi_200 as b_ksi_200
from val_split(ws(), (select a_test0 from validation_splits), (select a_test0 from validation_splits), we()) a
join val_split(ws(), (select b_mid::date from validation_splits), (select b_mid::date from validation_splits),
               (select b_end::date from validation_splits)) b using (method);

-- 1b) The same test for the walking and biking ranking: rank on earlier years only, then count the crashes that killed or
--    seriously hurt someone walking or biking afterwards at each method's top 50 and top 200. Against: the main ranking
--    (all crashes), and counting the walking and biking crashes, or the worst of them, alone.
create or replace macro val_split_pb(t0, t1, v0, v1) as table
with train as (select * from eb_in(t0, t1, pb := true)),
main as (select * from eb_in(t0, t1)),
test as (select location, count(*) filter (where severity in ('Fatal Collision', 'Serious Injury Collision')) ksi
         from collisions where date >= v0 and date < v1 and peds + cyclists > 0 group by location),
methods as (
  select 'pb_expected' m, location, row_number() over (order by round(expected_harm, 9) desc, crashes desc, location) rk from train
  union all select 'main_expected', location, row_number() over (order by round(expected_harm, 9) desc, crashes desc, location) from main
  union all select 'pb_crash_count', location, row_number() over (order by crashes desc, harm desc, location) from train
  union all select 'pb_ksi_count', location, row_number() over (order by ksi desc, crashes desc, location) from train
)
select m as method,
  coalesce(sum(t.ksi) filter (where rk <= top_n()), 0)::int  as future_ksi_50,
  coalesce(sum(t.ksi) filter (where rk <= list_n()), 0)::int as future_ksi_200
from methods left join test t using (location) group by m;

create or replace table validation_pb as
select a.method, a.future_ksi_50, a.future_ksi_200, b.future_ksi_50 as b_ksi_50, b.future_ksi_200 as b_ksi_200
from val_split_pb(ws(), (select a_test0 from validation_splits), (select a_test0 from validation_splits), we()) a
join val_split_pb(ws(), (select b_mid::date from validation_splits), (select b_mid::date from validation_splits),
                  (select b_end::date from validation_splits)) b using (method);

-- 2) Consistency with SDOT's own lists (built from overlapping crash data, so not independent),
--    with fair baselines: busy crash locations are on the High Injury Network anyway.
create or replace table sdot_agreement as
with yr as (select year(ws()) y0),
sets as (
  select 'ksi' m, * from ranked where rank <= top_n()
  union all select 'risk', * from ranked where rank_risk <= top_n()
  union all select 'pb', * from ranked where rank_pb <= top_n()
  union all select 'baseline_crash_count', * from (select * from ranked order by crashes desc, location limit top_n())
)
select m as mode,
  count(*) filter (where sdot_hin is not null)                                       as on_hin,
  count(*) filter (where sdot_hin = 'High')                                          as on_hin_high,
  count(*) filter (where list_max(sdot_hcl_years) >= (select y0 from yr))            as sdot_hcl_recent
from sets group by m;

-- Coverage: things that are always there, so a source that quietly blanked a field, or a join that came back empty,
-- stops the build instead of publishing a site with the context missing.
create or replace temp table coverage_ok as
with c as (select
  (select count(*) filter (where severity = 'Unknown') * 1.0 / count(*) from collisions where date >= ws() and date < we()) as unknown_share,
  (select count(*) from collisions where date >= ws() and date < we()
     and coll_type in ('Vehicle turning left hits pedestrian', 'Vehicle turning right hits pedestrian')) as turnped,
  (select count(*) from collisions where date >= ws() and date < we() and coll_type = 'From opposite direction - one left turn - one straight') as leftturn,
  (select count(*) from collisions where date >= ws() and date < we() and speeding) as speeding,
  (select count(*) filter (where council_district is not null) * 1.0 / count(*) from ranked) as district_share,
  (select count(*) filter (where neighborhood is not null) * 1.0 / count(*) from ranked) as hood_share,
  (select count(*) filter (where speed_limit is not null) * 1.0 / count(*) from ranked) as speed_share,
  (select count(*) filter (where sdot_hin is not null) * 1.0 / count(*) from ranked) as hin_share,
  (select list(distinct district order by district) from council) as districts,
  (select count(*) from bus_stretch) as bus_stretches,
  (select count(*) from loc_bus) as bus_places)
select case
  when unknown_share > 0.15 then error('Coverage: ' || round(100 * unknown_share) || '% of scored crashes have unknown severity')
  when turnped < 300 or leftturn < 500 or speeding < 500 then error('Coverage: crash type or speeding codes look renamed (turning-hits-pedestrian '
       || turnped || ', left-turn ' || leftturn || ', speeding ' || speeding || ')')
  when district_share < 0.99 or hood_share < 0.99 then error('Coverage: council district or neighborhood missing on many places')
  when speed_share < 0.95 then error('Coverage: speed limit missing on ' || round(100 * (1 - speed_share)) || '% of places')
  when hin_share < 0.15 then error('Coverage: High Injury Network matched on only ' || round(100 * hin_share) || '% of places')
  when districts <> [1, 2, 3, 4, 5, 6, 7] then error('Coverage: council districts are ' || districts::varchar)
  when bus_stretches < 300 or bus_places < 3000 then error('Coverage: bus timetable joins look empty (' || bus_stretches || ' stretches, '
       || bus_places || ' places)')
end from c;
-- ---------------------------------------------------------------- exports for the site
create or replace macro export_set() as table
  select * from ranked where rank <= list_n() or rank_type <= list_n() or rank_risk <= list_n() or rank_pb <= list_n()
     or killed >= deaths_min()   -- places where deaths_min() or more people died are always shown, whatever their rank
     -- each council district's own top 50 intersections and top 50 stretches (and top 50 for how busy it is),
     -- so the list filtered to one district (and to one kind) is complete; a place on the line between two districts
     -- is in both districts' lists
     or location in (select location from (
          select location,
            row_number() over (partition by d, addr_type = 'I' order by rank) as n_ksi,
            row_number() over (partition by d, addr_type = 'I', rank_risk is null order by rank_risk) as n_risk,
            row_number() over (partition by d, addr_type = 'I', rank_pb is null order by rank_pb) as n_pb,
            rank_risk, rank_pb
          from (select *, unnest(list_filter([council_district, council_district2], lambda x: x is not null)) as d from ranked))
        where n_ksi <= top_n() or (rank_risk is not null and n_risk <= top_n()) or (rank_pb is not null and n_pb <= top_n()))
     -- and for "how busy", each kind's top 200 citywide (the district lists above are per kind too)
     or location in (select location from (
          select location, row_number() over (partition by addr_type = 'I' order by rank_risk) as n
          from ranked where rank_risk is not null) where n <= list_n())
     or location in (select location from (
          select location, row_number() over (partition by addr_type = 'I' order by rank_pb) as n
          from ranked where rank_pb is not null) where n <= list_n());

-- Map areas for the on-demand detail files: a grid of about 1.1 km x 1.1 km cells.
create or replace macro cell_of(lat, lon) as floor(lat / 0.01)::int || '_' || floor(-lon / 0.015)::int;

-- Every place's site fields (the same columns for the ranked spots and, loaded on demand, for every other place).
create or replace table spot_export as
  select rank, rank_type, rank_noboost, rank_fatal, rank_risk, rank_pb, location, addr_type, round(lon, 6) lon, round(lat, 6) lat,
         cell_of(lat, lon) as cell,
         round(score_ksi, 1) score_ksi,
         round(score_fatal, 1) score_fatal, round(score_risk, 1) score_risk, round(score_pb, 1) score_pb,
         round(pb_expected_harm, 1) pb_expected_harm, pb_eb_weight, round(pb_ref_ksi_share, 4) pb_ref_ksi_share,
         round(harm, 1) harm, round(expected_harm, 1) expected_harm, round(eb_weight, 3) eb_weight,
         round(ksi_harm, 1) ksi_harm, round(block_ft) block_ft, round(ref_other_harm_per_known, 2) ref_other_harm_per_known,
         ref_group, ref_n, round(ref_ksi_share, 4) ref_ksi_share, round(ref_ksi_harm_per_crash, 2) ref_ksi_harm_per_crash,
         round(request_boost, 3) request_boost, round(request_points, 1) request_points, scored_requests,
         round(pts_old, 1) pts_old,
         area, neighborhood, speed_limit, street_type, state_route, state_hwy, state_bridge, structure, pavement_min,
         volume, volume_streets, volume_year, volume_estimated,
         sdot_hin, sdot_hcl_years, sdot_hcl_types, ksi_after_hcl,
         lpi_status, lpi_installed, lpi_planned, ntor_status, ntor_installed, ntor_planned, ntor_approaches, ped_after_lpi, signalized, ped_signal, ped_audio, lt_protected, lt_installed,
         confidence, crashes, unknown_sev, fatal, serious, injury, ksi, ksi_years, killed, seriously_injured,
         pb_crashes, ped_crashes, bike_crashes, speeding_crashes, ped_turn_after_lpi, left_turn_crashes, ped_turn_crashes, ped_right_crashes, typed_crashes, angle_crashes,
         wet_crashes, dark_crashes, unlit_crashes, road_known, light_known,
         first_crash, last_crash, requests, request_types,
         fixes, end_fixes, vol_history, bus_trips, bus_routes, bus_stretch_id,
         sw_missing_tier, sw_poor_ft, sw_poor_assessed, proj_ids, proj_planned, cip, signal_installed,
         crosswalks, crosswalks_midblock, crosswalk_school, crosswalk_controls, curb_ramps, curb_ramps_poor, bike_facilities,
         school, school_ft, walk_zones, rse_quintile, rse_year, council_district, council_district2, council_member, council_url, before_after,
         rank_years, rank_month_ago, rank_year_ago
  from ranked left join place_history using (location) left join end_fixes using (location);

copy (
  select * from spot_export where location in (select location from export_set()) order by rank
) to 'site/data/priorities.json' (format json, array true);

-- The top 50 as a checking sheet (site/data/top50_check.csv, finished by run.ps1 with the header, date and links): how the
-- site reads SDOT's layers at each place, with SDOT's own intersection keys and names, so someone at SDOT can check a row
-- against their records. A date SDOT gives as the year only (Jan 1 in the walk-signal layers, Dec 30/31 in the bike
-- layers) is written as the year.
create or replace macro yr_only(d, jan) as
  case when d is null then null
       when strftime(d, '%m-%d') in ('12-30', '12-31') or (jan and strftime(d, '%m-%d') = '01-01')
         then year(d)::varchar || ' (year only)' else d::varchar end;
create or replace macro walk_layer(st, d, plan, appr) as
  case when st is null then 'no record in SDOT layer' else
    concat_ws(', ', st,
      case when st = 'Existing' then coalesce(yr_only(d, true), 'no install date') end,
      case when st = 'Planned' and plan is not null and plan <> '' then 'for ' || plan end,
      case when appr is not null and appr <> '' then 'approaches as SDOT lists them: ' || appr end) end;
copy (
  with ik as (
    select location, string_agg(intkey || ': ' || sdot_location || ' (' || n || ')', '; ' order by n desc, intkey) as keys
    from (select location, intkey, arg_max(sdot_location, 1) as sdot_location, count(*) as n
          from collisions where intkey is not null and intkey > 0 and addr_type = 'I' and date >= ws() and date < we()
          group by all)
    group by location)
  select s.rank, case s.addr_type when 'I' then 'Intersection' else 'Stretch' end as type, s.location,
    case when s.addr_type = 'I' then ik.keys end as intkeys,
    concat_ws(' and ', s.council_district, s.council_district2) as districts, s.crashes, s.ksi,
    case when s.addr_type = 'I' then walk_layer(s.ntor_status, s.ntor_installed, s.ntor_planned, s.ntor_approaches) end as ntor,
    case when s.addr_type = 'I' then walk_layer(s.lpi_status, s.lpi_installed, s.lpi_planned, null) end as lpi,
    case when s.addr_type <> 'I' then null
         when s.lt_protected then 'Y' || coalesce(' since ' || s.lt_installed, '')
         when s.signalized then 'N' else 'not in SDOT signal layer' end as left_turn,
    array_to_string(list_transform(coalesce(s.fixes, []), lambda f: f.k || ': ' || f.s || coalesce(' ' || yr_only(f.d, false), '')
      || case when f.u and f.d is not null then ' (some sections undated)' when f.d is null then ' (no date)' else '' end), '; ') as other_work,
    array_to_string(list_transform(list_sort(list_filter(coalesce(s.end_fixes, []), lambda f: f.d >= w.w0)),
      lambda f: f.at || ': ' || f.k || ' ' || f.d), '; ') as end_work,
    case when nullif(s.state_route, '') is not null then 'WSDOT (' || s.state_route || ')'
         when nullif(s.state_hwy, '') is not null then 'City (' || s.state_hwy || ', a state highway the City runs)' else 'City' end as run_by,
    ws() as crashes_from, (we() - interval 1 day)::date as crashes_to
  from spot_export s left join ik using (location) cross join (select ws() as w0) w
  where s.rank <= top_n() order by s.rank
) to 'data/top50_raw.csv' (header true);


-- A stretch's point is the middle of its crashes, which on a long block can be far from its ends. For stretches with an
-- end over 30 m from that point: the two ends of the street line, in metres east and north of it ("ax,ay,bx,by"), so an
-- address search can measure to the street itself.
create or replace table stretch_ends as
with pts as (
  select p.location, p.geom as m, unnest([ST_StartPoint(s.geom), ST_EndPoint(s.geom)]) as pt
  from loc_pts p join ranked r using (location) join streets s on s.loc_name = p.location where r.addr_type = 'B'),
d as (select location, pt, m, ST_Distance(m, pt) as dm from pts),
p1 as (select location, arg_max(pt, dm) as a, max(dm) as dmax, any_value(m) as m from d group by location),
p2 as (select d.location, arg_max(d.pt, ST_Distance(d.pt, p1.a)) as b from d join p1 using (location) group by d.location)
select location, concat_ws(',', round((ST_X(a) - ST_X(m)) * 0.3048)::int, round((ST_Y(a) - ST_Y(m)) * 0.3048)::int,
                                round((ST_X(b) - ST_X(m)) * 0.3048)::int, round((ST_Y(b) - ST_Y(m)) * 0.3048)::int) as ends
from p1 join p2 using (location) where dmax * 0.3048 > 30;

-- Search index: every scored location, compact: [name, lat, lon, rank, crashes, ksi, ped/bike crashes, type, hood, area, cell, ends]
copy (
  select list([location, round(lat, 5)::varchar, round(lon, 5)::varchar, rank::varchar, crashes::varchar,
               ksi::varchar, pb_crashes::varchar, addr_type, coalesce(neighborhood, ''), coalesce(area, ''), cell_of(lat, lon),
               coalesce(e.ends, '')] order by rank) as idx
  from ranked left join stretch_ends e using (location)
) to 'site/data/search.json' (format json, array false);

-- This week's full ranked list, for the dated weekly snapshot (run.ps1 adds the date and each place's link, and the
-- weekly job keeps a copy of every week as a GitHub release, so a rank quoted on a given day can be checked later).
-- Places keep SDOT's own names; counts only, no costs.
copy (
  select rank, case addr_type when 'I' then 'Intersection' when 'B' then 'Stretch' else 'Alley' end as type,
         location, council_district, council_district2, area, crashes, ksi, fatal, killed, seriously_injured,
         ped_crashes, bike_crashes, state_route, round(score_ksi, 1) as score,
         ws() as crashes_from, (we() - interval 1 day)::date as crashes_to
  from ranked order by rank
) to 'data/ranks_raw.csv' (header true);


-- Drill-down for every place: each crash (including recent, not-yet-scored ones) and each nearby repair request, plus
-- the place's fields for places outside the ranked lists. Kept out of the main data file and split by map area; the site
-- loads one area's file when someone opens a place there. Severity codes: F fatal, S serious injury, I injury,
-- P property damage only, U unknown; n = not scored (outside the window). No per-crash coordinates: SDOT snaps every
-- crash to the intersection or block midpoint. Compact: field names once per file, rows as arrays; nearby requests
-- stored once per area and referenced by index.
create or replace table more_rows as
select s.cell, s.rank, s.location, to_json(s) as j from spot_export s;

create or replace table more_crashes as
select c.location, list(to_json([to_json(c.date),
         to_json(case c.severity when 'Fatal Collision' then 'F' when 'Serious Injury Collision' then 'S'
                                 when 'Injury Collision' then 'I' when 'Property Damage Only Collision' then 'P' else 'U' end),
         to_json(c.coll_type), to_json(c.peds), to_json(c.cyclists), to_json(c.injuries), to_json(c.serious_injuries),
         to_json(c.fatalities), to_json(c.road_cond), to_json(c.light_cond), to_json(c.weather), to_json(c.speeding),
         to_json(c.date >= we() or c.date < ws()), to_json(c.hour), to_json(isodow(c.date))]) order by c.date desc, c.id) as k
from collisions c join more_rows using (location) group by c.location;

create or replace table more_req_ids as
select cell, id, (row_number() over (partition by cell order by id) - 1)::int as qi
from (select distinct m.cell, lr.id from location_requests lr join more_rows m using (location));

create or replace table more_req_refs as
select m.location, list([q.qi, round(lr.dist_m)::int] order by r.date desc, r.id) as l
from location_requests lr join more_rows m using (location) join more_req_ids q on q.cell = m.cell and q.id = lr.id
join requests r on r.id = lr.id
group by m.location;

copy (
  with q as (
    -- Accessibility (ADA) and Safe Routes to School requests can point to a resident (a disabled person, a family), so
    -- the page shows those as the hundred block ("9200 block of 31ST AVE SW") at about 11 m; scoring keeps exact points.
    select q.cell, list(to_json([to_json(r.date), to_json(r.type), to_json(r.status),
                                 to_json(case when r.sensitive and regexp_matches(r.address, '^\d+[A-Z]?(-\d+)?\s+\S')
                                   then ((regexp_extract(r.address, '^(\d+)', 1)::bigint // 100) * 100)::varchar || ' block of '
                                        || regexp_replace(r.address, '^\d+[A-Z]?(-\d+)?\s+', '')
                                   else r.address end),
                                 to_json(round(r.lat, case when r.sensitive then 4 else 6 end)),
                                 to_json(round(r.lon, case when r.sensitive then 4 else 6 end))]) order by q.qi) as q
    from more_req_ids q join (select *, type ilike 'ADA%' or type ilike '%Safe Routes%' as sensitive from requests) r on r.id = q.id group by q.cell
  ),
  rows as (
    select m.cell,
      list(to_json(list_transform(json_keys(m.j), lambda k: json_extract(m.j, '$.' || k))) order by m.rank) as r,
      list(coalesce(to_json(c.k), '[]'::json) order by m.rank) as k,
      list(coalesce(to_json(l.l), '[]'::json) order by m.rank) as l
    from more_rows m left join more_crashes c using (location) left join more_req_refs l using (location)
    group by m.cell
  )
  select rows.cell, {
    'c': (select json_keys(j) from more_rows limit 1),
    'kc': ['d', 's', 't', 'pd', 'cy', 'inj', 'ser', 'fat', 'rd', 'lt', 'wx', 'sp', 'n', 'h', 'w'],
    'qc': ['d', 't', 'st', 'a', 'lat', 'lon'],
    'r': rows.r, 'k': rows.k, 'l': rows.l, 'q': coalesce(q.q, [])
  } as data
  from rows left join q using (cell)
  order by rows.cell
) to 'data/more.ndjson' (format json);

-- SDOT capital budget by program and year (budgeted amounts, net of reductions; not money spent; no locations)
-- Projects are matched across years by their MC-TR-C id (2024 lines put it in the title, e.g. "MC-TR-C064 - TRC0681 -
-- Vision Zero BUD"; later years use it as the code), and shown under their newest name and program.
copy (
  with b as (
    select *, coalesce(nullif(regexp_extract(project, '^(MC-TR-C[0-9]+)', 1), ''), nullif(regexp_extract(code, '^(MC-TR-C[0-9]+)', 1), ''),
                      nullif(nullif(trim(code), ''), '(blank)'), program || ' / ' || project) as pid
    from capital_budget
    where dept = 'Seattle Department of Transportation' and year >= year(current_date) - 2),
  names as (select pid, arg_max(program, {'y': year, 'p': program}) as program, arg_max(project, {'y': year, 'p': project}) as project from b group by pid)
  select n.program, n.project, b.pid as code, b.year, round(sum(b.amount)) amount,
         round(sum(b.amount) filter (where b.fund ilike '%levy%')) as levy
  from b join names n using (pid)
  group by all having round(sum(b.amount)) <> 0
  order by n.program, n.project, b.year
) to 'site/data/sdot_budget.json' (format json, array true);

copy (
  select
    (select count(*) from collisions)                       as collisions,
    (select min(date) from collisions)                      as collisions_from,
    (select max(date) from collisions)                      as collisions_to,
    ws()                                                    as window_from,
    (we() - interval 1 day)::date                           as window_to,
    (select test_start from scoring_window)                 as test_from,
    (select req_start from scoring_window)                  as requests_scored_from,
    (select count(*) from collisions where date >= ws() and date < we()) as collisions_scored,
    (select count(*) from collisions where date >= ws() and date < we() and severity = 'Unknown') as unknown_severity,
    (select n from collisions_dropped)                      as dropped_no_location,
    (select ksi from collisions_dropped)                    as dropped_ksi,
    (select fatal from collisions_dropped)                  as dropped_fatal,
    (select count(*) from requests)                         as requests,
    (select count(*) from locations)                        as locations_scored,
    (select count(*) from locations where addr_type = 'I')  as intersections_scored,
    (select count(*) from locations where addr_type <> 'I') as stretches_scored,
    (select list({'mode': mode, 'on_hin': on_hin, 'on_hin_high': on_hin_high, 'sdot_hcl_recent': sdot_hcl_recent} order by mode)
     from sdot_agreement)                                   as sdot_agreement,
    (select round(count(*) filter (where sdot_hin is not null) * 1.0 / count(*), 3) from locations where crashes >= busy_min_crashes()) as busy_share_on_hin,
    (select count(*) from locations where crashes >= busy_min_crashes())    as busy_locations,
    (select list({'method': method, 'k50': future_ksi_50, 'k200': future_ksi_200, 'b50': b_ksi_50, 'b200': b_ksi_200} order by future_ksi_50 desc, method) from validation) as validation,
    (select list({'method': method, 'k50': future_ksi_50, 'k200': future_ksi_200, 'b50': b_ksi_50, 'b200': b_ksi_200} order by future_ksi_50 desc, method) from validation_pb) as validation_pb,
    (select count(*) from ranked where rank_pb is not null) as pb_places,
    (select count(*) from collisions where date >= ws() and date < we() and peds + cyclists > 0) as pb_crashes_scored,
    (select count(*) filter (where severity in ('Fatal Collision', 'Serious Injury Collision')) from collisions
       where peds + cyclists > 0 and date >= (select test_start from scoring_window) and date < we()) as test_pb_ksi_total,
    (select count(*) filter (where severity in ('Fatal Collision', 'Serious Injury Collision')) from collisions
       where peds + cyclists > 0 and date >= (select b_mid from validation_splits) and date < (select b_end from validation_splits)) as test2_pb_ksi_total,
    (select b_mid::date from validation_splits)            as test2_from,
    ((select b_end from validation_splits) - interval 1 day)::date as test2_to,
    (select count(*) filter (where severity in ('Fatal Collision', 'Serious Injury Collision')) from collisions
       where date >= (select b_mid from validation_splits) and date < (select b_end from validation_splits)) as test2_ksi_total,
    (select count(*) filter (where severity in ('Fatal Collision', 'Serious Injury Collision')) from collisions
       where date >= (select test_start from scoring_window) and date < we()) as test_ksi_total,
    -- citywide totals for the summary at the top of the list (people, not crashes)
    (select sum(fatalities) from collisions where date >= ws() and date < we())
      + (select coalesce(sum(fatalities), 0) from collisions_unlocated where date >= ws() and date < we()) as city_killed,
    (select count(*) filter (where severity = 'Fatal Collision') from collisions where date >= ws() and date < we())
      + (select count(*) filter (where severity = 'Fatal Collision') from collisions_unlocated where date >= ws() and date < we()) as city_fatal,
    (select sum(serious_injuries) from collisions where date >= ws() and date < we())
      + (select coalesce(sum(serious_injuries), 0) from collisions_unlocated where date >= ws() and date < we()) as city_serious,
    (select count(*) from collisions_unlocated where date >= ws() and date < we()
       and severity in ('Fatal Collision', 'Serious Injury Collision')) as city_ksi_unlocated,
    (select count(*) from collisions where date >= ws() and date < we()
       and severity in ('Fatal Collision', 'Serious Injury Collision')) as city_ksi_located,
    (select count(*) from collisions where date >= ws() and date < we() and peds + cyclists > 0
       and severity in ('Fatal Collision', 'Serious Injury Collision')) as city_ped_bike_ksi,
    (select round(sum(ksi) filter (where rank <= top_n()) * 1.0 / sum(ksi), 3) from ranked) as top50_ksi_share,
    (select sum(ksi) filter (where rank <= top_n()) from ranked) as top50_ksi,
    -- how many of the top 50 are intersections, and how many miles the stretches among them add up to
    (select count(*) filter (where rank <= top_n() and is_int) from ranked) as top50_intersections,
    (select round(sum((select sum(ST_Length(s.geom)) from streets s where s.loc_name = r.location)) / 5280, 1)
       from ranked r where not r.is_int and r.rank <= top_n()) as top50_stretch_miles,
    (select sum(ksi) from ranked) as city_ksi_crashes,
    -- looking ahead: the top 50 ranked on the first 3 years (the site's rule, so the validation's own number), and
    -- their share of the next 2 years' KSI crashes
    (select future_ksi_50 from validation where method = 'expected') as forward_top50_ksi,
    (select count(*) from collisions where date >= ws() and date < we() and peds + cyclists > 0
       and severity = 'Fatal Collision') as city_ped_bike_fatal,
    -- the first month from which every scored month has at least 5% of reports with no severity (null if none)
    (with m as (select date_trunc('month', date)::date mo, avg((severity = 'Unknown')::int) sh
                from collisions where date < we() group by 1)
     select min(mo) from m where not exists (select 1 from m m2 where m2.mo >= m.mo and m2.sh < 0.05)) as unknown_from,
    (with m as (select date_trunc('month', date)::date mo, avg((severity = 'Unknown')::int) sh
                from collisions where date < we() group by 1),
          f as (select min(mo) s from m where not exists (select 1 from m m2 where m2.mo >= m.mo and m2.sh < 0.05))
     select {'n': count(*) filter (where severity = 'Unknown'), 'share': round(avg((severity = 'Unknown')::int), 3)}
     from collisions, f where date >= f.s and date >= ws() and date < we()) as unknown_recent,
    -- the years of SDOT's traffic counts in use
    (select {'from': min(count_year), 'to': max(count_year)} from volumes) as count_years,
    -- the latest date SDOT gives for each kind of dated fix, from its citywide layers (signal changes from the places)
    (select list({'k': k, 'd': d} order by d) from (
       select kind k, max(d) d from fix_lines where status = 'Built' and d is not null group by kind
       union all select 'Traffic circle', max(d) from circles
       union all select kind, max(d) from dated_fixes where kind in ('Head-start walk signal', 'No turn on red', 'Protected left-turn signal') group by kind)) as fix_last,
    -- voter-approved levy funds in the budget years shown, with the years each has money
    (select list({'fund': regexp_replace(fund, '^[0-9]+ - ', ''), 'from': y0, 'to': y1} order by y0) from (
       select fund, min(year) y0, max(year) y1 from capital_budget
       where dept = 'Seattle Department of Transportation' and year >= year(current_date) - 2 and fund ilike '%levy%' and amount <> 0
       group by fund)) as levy_funds,
    (select count(*) from collisions where date >= ws() and date < we() and speeding) as city_speeding,
    -- citywide shares, used to flag locations that are unusually wet/dark (Unknown/Other excluded)
    (select round(sum(wet_crashes)  / sum(road_known),  3) from locations) as city_wet_share,
    (select round(sum(dark_crashes) / sum(light_known), 3) from locations) as city_dark_share,
    (select round(median(block_ft)) from loc_context where block_ft is not null) as median_block_ft,
    -- The settings at the top of this file, for the page's text: it reads them from here rather than typing them in.
    {'window_months': window_months(), 'window_years': window_years(), 'lag_months': lag_months(), 'top_n': top_n(),
     'list_n': list_n(), 'busy_min_crashes': busy_min_crashes(), 'near_ix_ft': near_ix_ft(), 'near_block_ft': near_block_ft(),
     'school_ft': school_ft(), 'merge_ft': round(merge_dlat() * 111320 / 0.3048, -1)::int, 'hist_from_year': hist_from_year(),
     'worst_n': worst_n(), 'worst_ref_to': worst_ref_to(), 'recent_fix_days': recent_fix_days(), 'ba_min_days': ba_min_days(),
     'ba_max_days': ba_max_days(), 'inc_min_crashes': inc_min_crashes(), 'inc_min_days': inc_min_days(), 'wide_n': wide_n(),
     'cmp_lag_months': cmp_lag_months(), 'move_min': move_min(), 'ba_few_dates': ba_few_dates(), 'ba_cluster_dates': ba_cluster_dates(), 'bus_min_mi': bus_min_mi(),
     'signal_from_year': year(signal_from()), 'deaths_min': deaths_min(), 'repeat_years': repeat_years()} as cfg,
    hist_start() as crash_hist_from,
    -- plain street names (addresses.sql): SDOT's names with a roadway code the page shows without it, and the names that keep
    -- SDOT's spelling because they'd match another; with how many places each way, reported by the weekly build
    {'parts': map_from_entries(coalesce((select list({'k': p, 'v': plain} order by p) from plain_parts), [])),
     'keep': coalesce((select list(x order by x) from plain_keep), []),
     'places_plain': (select count(*) from (select distinct location from collisions) where plain_name(location) <> location and location not in (select x from plain_keep)),
     'places_kept': (select count(*) from (select distinct location from collisions) where location in (select x from plain_keep))} as plain_names,
    -- Facts the page states about the data, measured each week (so a sentence like "has no locations" can't go stale):
    -- the divided street with the most crashes whose two sides were merged into one place (the page's example)
    (select arg_max(location, n) from (select location, count(*) as n from collisions
       where location in (select location from loc_merge where raw <> location) group by location)) as merge_example,
    (select count(distinct quintile) from rse where quintile is not null) as rse_levels,
    (select max(tier) from sw_missing) as sw_max_tier,
    -- whether the City's budget file has any column that could locate spending, and the project maps any cost column
    (select count(*) = 0 from (describe select * from read_csv('data/raw/capital_budget.csv'))
       where regexp_matches(column_name, '(?i)(location|address|lat|lon|geom|coord|street|district|neighborhood)')) as budget_no_location,
    (select count(*) = 0 from (select unnest(json_keys(f.properties::json)) as k from (select unnest(features) f
       from read_json(['data/raw/proj_sidewalk_*.json', 'data/raw/proj_nispp_*.json'], maximum_object_size = 50000000, union_by_name = true)))
       where regexp_matches(k, '(?i)(cost|budget|amount|dollar|fund|price)')) as proj_no_cost,
    -- speed humps: how many SDOT lists, and how many with an install date
    (select {'n': count(*), 'dated': count(f.properties::json->>'INSTALL_DATE')}
       from (select unnest(features) f from read_json('data/raw/humps_*.json', maximum_object_size = 50000000))) as humps,
    -- repair requests: the share of those over a year old still marked "Reported", and how many per full calendar year
    (select round(avg((status = 'Reported')::int), 3) from requests where date < fetched() - interval 365 day) as requests_old_reported,
    (select list({'y': y, 'n': n} order by y) from (select year(date) as y, count(*) as n from requests group by 1)
       where y > (select year(min(date)) from requests) and y < year(fetched())) as requests_by_year,
    -- crash reports SDOT places at places WSDOT runs (freeways, ramps, state bridges), in the scored years
    (select count(*) from collisions c join locations l using (location)
       where l.state_route is not null and c.date >= ws() and c.date < we()) as wsdot_crashes,
    (select list({'k': k, 'v': v} order by k) from weights)       as weights,
    (select list({'type': type, 'w': w} order by w desc, type) from request_weights) as request_weights
) to 'site/data/meta.json' (format json, array false);

-- Council districts with their members, and public schools: so a pin or searched address can show them too.
copy (
  select {
    'council': (select list({'d': district, 'member': member, 'url': url,
                 'geom': ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(geom, 40), 'EPSG:2926', 'EPSG:4326'))::json} order by district) from council),
    -- serving council members not tied to a district map seat: the citywide positions (from the City Clerk's list)
    'citywide': (select list(full_name order by full_name) from council_now
                 where n not in (select lower(trim(member)) from council where member is not null)
                   and (started is null or started <= current_date)),
    'schools': (select list([name, round(ST_Y(ST_Transform(geom, 'EPSG:2926', 'EPSG:4326')), 5)::varchar,
                             round(ST_X(ST_Transform(geom, 'EPSG:2926', 'EPSG:4326')), 5)::varchar, type] order by name) from schools)
  } as ctx
) to 'site/data/context.json' (format json, array false);

-- School walk zones' outlines for the map layer (simplified to ~20 ft), with each school's name and grades.
copy (
  select {'zones': coalesce((select list({'n': name, 'g': grades,
          'geom': ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(geom, 20), 'EPSG:2926', 'EPSG:4326'))::json} order by name) from walk_zones), [])} as wz
) to 'site/data/walk_zones.json' (format json, array false);

-- City outline (council districts merged), simplified to ~40 ft, so the map shows exactly the area covered.
copy (
  with d as (select gj_geom(f.geometry) g
             from (select unnest(features) f from read_json('data/raw/districts_*.json', maximum_object_size = 50000000))
             where f.geometry is not null)
  select ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(ST_Union_Agg(g), 40), 'EPSG:2926', 'EPSG:4326'))::json as boundary
  from d
) to 'site/data/boundary.json' (format json, array false);

-- Map labels: one point inside each area / neighborhood (level 1 = 20 areas, level 2 = 94 neighborhoods).
copy (
  select list({'n': n, 'lvl': lvl, 'lat': round(ST_Y(pt), 5), 'lon': round(ST_X(pt), 5)} order by lvl, n) as labels
  from (
    select area as n, 1 as lvl, ST_Transform(ST_PointOnSurface(ST_Union_Agg(geom)), 'EPSG:2926', 'EPSG:4326') pt from hoods group by area
    union all
    select neighborhood, 2, ST_Transform(ST_PointOnSurface(ST_Union_Agg(geom)), 'EPSG:2926', 'EPSG:4326') from hoods
    group by neighborhood having not bool_or(neighborhood = area)   -- skip names already shown as an area (e.g. Interbay)
  )
) to 'site/data/labels.json' (format json, array false);
