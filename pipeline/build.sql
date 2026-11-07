-- Build the priority ranking from data/raw/ into data/priority.duckdb and site/data/*.json
-- Run from the project root:  tools\duckdb\duckdb.exe -no-agent data\priority.duckdb -f pipeline\build.sql
-- All weights live in the `weights` / `request_weights` tables below so they are easy to tune.

-- ---------------------------------------------------------------- settings
-- Three rankings are computed side by side; the site lets people switch between them.
--   ksi (recommended): expected harm. Crash harm (fatal = serious injury, "KSI") with repeated deaths
--                      compounding; the fatal/serious part is blended with the typical share on similar
--                      streets (empirical Bayes); then a small capped boost from safety-related requests.
--   risk:              the same expected harm per 10,000 vehicles entering the spot.
--   fatal (old v1):    fatal crashes weighted far above everything else. Retired from the site; still
--                      computed so the change can be compared.
create or replace table weights as select * from (values
  ('ksi',               30.0),   -- points per fatal OR serious-injury collision
  ('fatal_growth',       1.5),   -- the nth fatal crash at a location counts ksi x growth^(n-1)
                                 --   (1st = 30, 2nd = 45, 3rd = 67.5 ...: repeated deaths compound)
  ('injury',             5.0),   -- other injury collision
  ('pdo',                1.0),   -- property damage only (Unknown severity counts 0: treated as missing)
  ('ped_bike_mult',      1.5),   -- x this when a pedestrian or cyclist was involved AND someone was hurt
  ('ksi_prior_crashes', 20.0),   -- expected harm: how many crashes a spot needs before its own fatal/serious
                                 --   share counts as much as the typical share for similar streets
  ('request_boost_max',  0.25),  -- safety-related requests raise the score by at most +25%...
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
  ('Damaged Sidewalk',             2.0),
  ('ADA Request (Transportation)', 2.0),
  ('Safe Routes to School',        2.0),
  ('Bicycle Facility Maintenance', 0.0),   -- only collected since 2024-11
  ('Pothole',                      0.0),
  ('Clogged Storm Drain',          0.0),
  ('Snow and Ice',                 0.0)
) t(type, w);

create or replace macro wt(name) as (select v from weights where k = name);

-- ---------------------------------------------------------------- raw -> clean
create or replace table collisions as
with raw as (
  select unnest(features, recursive := true)
  from read_json('data/raw/collisions_*.json', maximum_object_size = 200000000)
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
  coalesce(FATALITIES, 0)                  as fatalities,
  coalesce(SERIOUSINJURIES, 0)             as serious_injuries,
  coalesce(INJURIES, 0)                    as injuries,
  ROADCOND                                 as road_cond,
  LIGHTCOND                                as light_cond,
  WEATHER                                  as weather,
  ST_COLDESC                               as coll_type,
  SPEEDING = 'Y'                           as speeding,
  coordinates[1]                           as lon,
  coordinates[2]                           as lat
from raw
where LOCATION is not null and coordinates is not null;

create or replace table collisions_dropped as   -- disclosed on the site
with raw as (select unnest(features, recursive := true) from read_json('data/raw/collisions_*.json', maximum_object_size = 200000000))
select count(*) n,
       count(*) filter (where MAXSEVERITYDESC in ('Fatal Collision', 'Serious Injury Collision')) ksi,
       count(*) filter (where MAXSEVERITYDESC = 'Fatal Collision') fatal
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
create or replace table scoring_window as
with e as (select (date_trunc('month', max(date)) - interval 3 month)::date as w_end from collisions)
select (w_end - interval 60 month)::date as w_start, w_end,
       (w_end - interval 24 month)::date as test_start,                       -- validation split
       greatest(date '2023-06-01', (w_end - interval 36 month)::date) as req_start  -- request scoring window
from e;
create or replace macro ws() as (select w_start from scoring_window);
create or replace macro we() as (select w_end from scoring_window);

-- ---------------------------------------------------------------- location context (spatial)
-- Everything is projected to WA State Plane North (EPSG:2926, US feet) for distance math.
load spatial;
set geometry_always_xy = true;
create or replace macro gj_geom(g) as ST_Transform(ST_GeomFromGeoJSON(g::json), 'EPSG:4326', 'EPSG:2926');

create or replace table locations_all as
select location, any_value(addr_type) as addr_type, avg(lon) as lon, avg(lat) as lat,
       mode(intkey) filter (where intkey is not null and intkey > 0) as intkey
from collisions group by location;

create or replace table streets as
select f.properties.COMPKEY as compkey, f.properties.UNITDESC as unitdesc,
       nullif(f.properties.SPEEDLIMIT, 0) as speed, f.properties.ARTCLASS as artclass,
       nullif(f.properties.PVMTCONDINDX1, 0) as pci,
       gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/streets_*.json', maximum_object_size = 500000000))
where f.geometry is not null;

create or replace table volumes as
select f.properties.STNAME_ORD as street, nullif(f.properties.AWDT, 0) as awdt,
       f.properties.DATAQUALIT as quality,
       year(make_timestamp(f.properties.START_DATE::bigint * 1000)) as count_year,
       gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/volumes_*.json', maximum_object_size = 500000000))
where f.geometry is not null;

create or replace table hin as   -- SDOT Vision Zero High Injury Network
select f.properties.PRIORITY as priority, gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/hin_*.json', maximum_object_size = 500000000))
where f.geometry is not null;

create or replace table hcl as   -- SDOT Vision Zero High Collision Locations (by year)
select f.properties.HCL_YEAR as year, gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/hcl_*.json', maximum_object_size = 500000000))
where f.geometry is not null;

create or replace table lpi as   -- Leading Pedestrian Intervals (walk signal starts before green)
select f.properties.LPI_Status as status,
       make_timestamp(f.properties.LPI_Install_Date::bigint * 1000)::date as installed,
       f.properties.LPI_Planned_Year as planned_year,
       ST_Centroid(gj_geom(f.geometry)) as geom
from (select unnest(features) f from read_json('data/raw/lpi_*.json', maximum_object_size = 500000000))
where f.geometry is not null;

create or replace table signals as
select f.properties.INTKEY as intkey,
       f.properties.PEDSIGNALYN = 'Y' as ped_signal,
       f.properties.PEDAUDIODEVICEYN = 'Y' as ped_audio,
       f.properties.LTPROTECTEDYN = 'Y' as lt_protected,
       make_timestamp(f.properties.LTFIRSTINSTALLDT::bigint * 1000)::date as lt_installed,
       make_timestamp(f.properties.INSTALL_DATE::bigint * 1000)::date as installed
from (select unnest(features) f from read_json('data/raw/signals_*.json', maximum_object_size = 500000000));

-- Intersections look 60 ft around the point (all approaching streets); blocks 40 ft (the block itself).
create or replace table loc_pts as
select location, ST_Transform(ST_Point(lon, lat), 'EPSG:4326', 'EPSG:2926') as geom,
       case when addr_type = 'I' then 60 else 40 end as r
from locations_all;

-- Street names at each location, from SDOT's location text: "A AND B" (intersection) or "A BETWEEN x AND y" (block).
create or replace table loc_names as
select location, unnest(case when addr_type = 'I' then string_split(location, ' AND ')
                             else [split_part(location, ' BETWEEN ', 1)] end) as name
from locations_all;

-- Traffic volume. For each street at the spot, the nearest SDOT count on that same street within 300 ft
-- (so a cross street with no count right at the corner still finds its count). Intersections add the
-- streets together (vehicles entering); blocks use their own street. Count year and quality are kept.
create or replace table loc_volume as
with nearest as (
  select n.location, n.name,
         arg_min({'awdt': v.awdt, 'yr': v.count_year, 'est': v.quality = 'Estimate'}, ST_Distance(p.geom, v.geom)) as hit
  from loc_names n join loc_pts p using (location)
  join volumes v on v.street = n.name and v.awdt is not null and ST_DWithin(p.geom, v.geom, 300)
  group by n.location, n.name
)
select location, sum(hit.awdt)::int as volume, count(*) as volume_streets,
       min(hit.yr) as volume_year, bool_or(hit.est) as volume_estimated
from nearest group by location;

create or replace table loc_context as
with
s as (select p.location,
        max(s.speed) as speed_limit,
        min(s.artclass) filter (where s.artclass between 1 and 5) as art_class,
        min(s.pci) as pavement_min
      from loc_pts p join streets s on ST_DWithin(p.geom, s.geom, 60)
      where ST_Distance(p.geom, s.geom) <= p.r
      group by p.location),
len as (select unitdesc as location, max(ST_Length(geom)) as block_ft from streets group by unitdesc),
h as (select p.location, min(case h.priority when 'High' then 1 when 'Mid' then 2 when 'Low' then 3 end) as hin_level
      from loc_pts p join hin h on ST_DWithin(p.geom, h.geom, 60) group by p.location),
c as (select p.location, list(distinct c.year order by c.year) as hcl_years
      from loc_pts p join hcl c on ST_DWithin(p.geom, c.geom, 80) group by p.location),
lp as (select p.location,
         arg_min({'status': l.status, 'installed': l.installed, 'planned': l.planned_year},
                 case l.status when 'Existing' then 0 when 'Planned' then 1 else 2 end) as lpi
       from loc_pts p join locations_all a using (location) join lpi l on ST_DWithin(p.geom, l.geom, 100)
       where a.addr_type = 'I' group by p.location),
sg as (select a.location, bool_or(ped_signal) ped_signal, bool_or(ped_audio) ped_audio,
              bool_or(lt_protected) lt_protected, min(lt_installed) filter (where lt_protected) lt_installed,
              min(installed) signal_installed
       from locations_all a join signals g on g.intkey = a.intkey group by a.location)
select a.location, a.addr_type, a.intkey, s.speed_limit, s.art_class, s.pavement_min,
       case when a.addr_type <> 'I' then len.block_ft end as block_ft,
       v.volume, v.volume_streets, v.volume_year, v.volume_estimated,
       h.hin_level, coalesce(c.hcl_years, []) as hcl_years,
       lp.lpi.status as lpi_status, lp.lpi.installed as lpi_installed, lp.lpi.planned as lpi_planned,
       sg.location is not null as signalized, sg.ped_signal, sg.ped_audio, sg.lt_protected, sg.lt_installed, sg.signal_installed,
       -- reference group for expected harm
       case when a.addr_type = 'I' then 'I' else 'B' end as addr_class,
       case s.art_class when 1 then 'principal' when 2 then 'minor' when 3 then 'collector'
                        when 4 then 'state' when 5 then 'state' else 'local' end as street_bucket
from locations_all a
left join s using (location) left join len using (location) left join loc_volume v using (location)
left join h using (location) left join c using (location)
left join lp using (location) left join sg using (location);

-- ---------------------------------------------------------------- crash harm (any date range)
create or replace macro harm_in(d0, d1) as table
with c as (
  select location, date, id, severity, peds, cyclists, road_cond, light_cond, speeding,
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
  from collisions where date >= d0 and date < d1
)
select location,
  count(*)                                                        as crashes,
  count(*) filter (where severity = 'Unknown')                    as unknown_sev,
  count(*) filter (where severity = 'Fatal Collision')            as fatal,
  count(*) filter (where severity = 'Serious Injury Collision')   as serious,
  count(*) filter (where severity = 'Injury Collision')           as injury,
  count(*) filter (where is_ksi)                                  as ksi,
  count(distinct year(date)) filter (where is_ksi)                as ksi_years,
  count(*) filter (where peds > 0)                                as ped_crashes,
  count(*) filter (where cyclists > 0)                            as bike_crashes,
  count(*) filter (where road_cond ilike 'wet%' or road_cond ilike '%ice%' or road_cond ilike '%snow%') as wet_crashes,
  count(*) filter (where light_cond ilike 'dark%')                as dark_crashes,
  count(*) filter (where light_cond ilike 'dark - street lights off%' or light_cond ilike 'dark - no street lights%') as unlit_crashes,
  count(*) filter (where road_cond is not null and road_cond not in ('Unknown', 'Other'))   as road_known,
  count(*) filter (where light_cond is not null and light_cond not in ('Unknown', 'Other')) as light_known,
  count(*) filter (where speeding)                                as speeding_crashes,
  min(date) as first_crash, max(date) as last_crash,
  sum(pts)       as harm,
  sum(pts) filter (where is_ksi) as ksi_harm_raw,
  sum(pts_old)   as pts_old
from c group by location;


-- ---------------------------------------------------------------- expected harm (empirical Bayes on severity)
-- Whether a crash kills or seriously injures someone is partly chance (speed, age, vehicle, ambulance time).
-- So a spot's fatal/serious harm is estimated by blending its own record with the typical fatal/serious
-- share on similar streets (same kind of location and street class), weighted by how many crashes it has:
--   own-record weight  w = crashes / (crashes + A)              (A = ksi_prior_crashes)
--   expected harm      = other-crash harm + w * own KSI harm + (1 - w) * crashes * typical KSI harm per crash
-- A spot with 3 crashes leans mostly on the typical share; one with 60 leans on its own record. Every crash
-- is evidence of exposure, so busy spots with many minor crashes still count. Chosen because it predicted
-- future fatal/serious crashes better than the alternatives (see the validation table below).
create or replace macro eb_in(d0, d1) as table
with h as (
  select h.* exclude (ksi_harm_raw), coalesce(h.ksi_harm_raw, 0) as ksi_harm, x.addr_class, x.street_bucket, x.addr_class || ' / ' || x.street_bucket as ref_group
  from harm_in(d0, d1) h join loc_context x using (location)
),
g as (select ref_group, count(*) ref_n, sum(ksi_harm) / sum(crashes) as ref_ksi_harm_per_crash,
             sum(ksi) / sum(crashes) as ref_ksi_share
      from h group by ref_group)
select h.*, g.ref_n, g.ref_ksi_share, g.ref_ksi_harm_per_crash,
  h.crashes / (h.crashes + wt('ksi_prior_crashes')) as eb_weight,
  (h.harm - h.ksi_harm)
    + h.crashes / (h.crashes + wt('ksi_prior_crashes')) * h.ksi_harm
    + wt('ksi_prior_crashes') / (h.crashes + wt('ksi_prior_crashes')) * h.crashes * g.ref_ksi_harm_per_crash as expected_harm
from h join g using (ref_group);

-- ---------------------------------------------------------------- locations in the scoring window
create or replace table locations as
select e.*, x.addr_type, x.intkey, x.speed_limit, x.art_class,
  case x.art_class when 1 then 'Principal arterial' when 2 then 'Minor arterial' when 3 then 'Collector arterial'
                   when 4 then 'State route' when 5 then 'Freeway' else 'Neighborhood street' end as street_type,
  x.pavement_min, x.block_ft, x.volume, x.volume_streets, x.volume_year, x.volume_estimated,
  case x.hin_level when 1 then 'High' when 2 then 'Mid' when 3 then 'Low' end as sdot_hin,
  x.hcl_years as sdot_hcl_years,
  x.lpi_status, x.lpi_installed, x.lpi_planned, x.signalized, x.ped_signal, x.ped_audio, x.lt_protected, x.lt_installed,
  a.lon, a.lat,
  -- state facilities: WSDOT owns or shares responsibility
  -- Aurora Ave N is SR 99 and Lake City Way NE is SR 522, although SDOT classes them as city arterials.
  case when regexp_matches(e.location, '^AURORA AVE N|\bSR ?99\b|ALASKAN WY VI|BATTERY ST TUNNEL') then 'SR 99'
       when regexp_matches(e.location, '^LAKE CITY WAY NE|\bSR ?522\b') then 'SR 522'
       when regexp_matches(e.location, '\bSR ?509\b|1ST AVE S BR') then 'SR 509'
       when regexp_matches(e.location, '\bSR ?520\b') then 'SR 520'
       when regexp_matches(e.location, '\bI ?5\b|\bI ?90\b') then 'Interstate'
       when x.art_class in (4, 5) then 'State route' end as state_route,
  regexp_matches(e.location, '(\bBR\b|BRIDGE|VIADUCT|TUNNEL|\bON RP\b|\bOFF RP\b)') as structure,
  case when e.crashes < 5 then 'low' when e.crashes < 15 then 'medium' else 'high' end as confidence
from eb_in(ws(), we()) e
join loc_context x using (location)
join locations_all a using (location);

-- Still dangerous after SDOT acted or listed it: KSI crashes after the first High Collision listing,
-- and pedestrian crashes after a Leading Pedestrian Interval was installed.
create or replace table locations as
select l.*,
  (select count(*) from collisions c where c.location = l.location and c.date >= ws() and c.date < we()
     and c.severity in ('Fatal Collision', 'Serious Injury Collision')
     and len(l.sdot_hcl_years) > 0 and year(c.date) > l.sdot_hcl_years[1]) as ksi_after_hcl,
  (select count(*) from collisions c where c.location = l.location and c.date >= ws() and c.date < we()
     and c.peds > 0 and l.lpi_status = 'Existing' and c.date > l.lpi_installed) as ped_after_lpi
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
        where date >= (select req_start from scoring_window) and date < we()) lr
  join request_weights rw on rw.type = lr.type and rw.w > 0
  group by lr.location
)
select a.location, a.requests, a.request_types, coalesce(s.request_points, 0) request_points,
       coalesce(s.scored_requests, 0) scored_requests
from all_types a left join scored s using (location);

-- ---------------------------------------------------------------- final ranking
create or replace table priorities as
with b as (
  select l.*,
    coalesce(s.requests, 0) as requests, coalesce(s.scored_requests, 0) as scored_requests,
    coalesce(s.request_points, 0) as request_points, s.request_types,
    wt('request_boost_max') * coalesce(s.request_points, 0)
      / (coalesce(s.request_points, 0) + wt('request_boost_half')) as request_boost
  from locations l left join location_request_summary s using (location)
)
select *,
  expected_harm * (1 + request_boost)                                as score_ksi,
  pts_old + request_points * wt('request_mult')                      as score_fatal,
  -- Risk: expected harm per 10,000 vehicles entering the spot (intersections: streets added together).
  case when volume is not null and crashes >= wt('risk_min_crashes')
       then expected_harm / (greatest(volume, wt('risk_vol_floor')) / 10000.0) end as score_risk
from b;

create or replace table ranked as
select row_number() over (order by score_ksi desc, crashes desc, location)       as rank,
       row_number() over (order by expected_harm desc, crashes desc, location)   as rank_noboost,
       row_number() over (order by score_fatal desc, crashes desc, location)     as rank_fatal,
       case when score_risk is not null
            then row_number() over (partition by score_risk is null order by score_risk desc, crashes desc, location) end as rank_risk,
       *
from priorities;

-- ---------------------------------------------------------------- validation
-- 1) Out of sample: rank on the first 3 years of the window, then count the fatal/serious crashes that
--    happened in the last 2 years at each method's top 50. A ranking that finds lasting danger (not luck)
--    should catch more future KSI crashes.
create or replace table validation as
with train as (select * from eb_in(ws(), (select test_start from scoring_window))),
test as (select location, count(*) filter (where severity in ('Fatal Collision', 'Serious Injury Collision')) ksi,
                count(*) crashes
         from collisions where date >= (select test_start from scoring_window) and date < we() group by location),
methods as (
  select 'expected' m, location, row_number() over (order by expected_harm desc, crashes desc, location) rk from train
  union all select 'raw_harm', location, row_number() over (order by harm desc, crashes desc, location) from train
  union all select 'old_reliability', location, row_number() over (order by harm * crashes / (crashes + 3) desc, crashes desc, location) from train
  union all select 'crash_count', location, row_number() over (order by crashes desc, harm desc, location) from train
  union all select 'ksi_count', location, row_number() over (order by ksi desc, crashes desc, location) from train
)
select m as method,
  coalesce(sum(t.ksi) filter (where rk <= 50), 0)::int  as future_ksi_50,
  coalesce(sum(t.ksi) filter (where rk <= 200), 0)::int as future_ksi_200
from methods left join test t using (location) group by m;

-- 2) Consistency with SDOT's own lists (built from overlapping crash data, so not independent),
--    with fair baselines: busy crash locations are on the High Injury Network anyway.
create or replace table sdot_agreement as
with yr as (select year(ws()) y0),
sets as (
  select 'ksi' m, * from ranked where rank <= 50
  union all select 'risk', * from ranked where rank_risk <= 50
  union all select 'baseline_crash_count', * from (select * from ranked order by crashes desc, location limit 50)
)
select m as mode,
  count(*) filter (where sdot_hin is not null)                                       as on_hin,
  count(*) filter (where sdot_hin = 'High')                                          as on_hin_high,
  count(*) filter (where list_max(sdot_hcl_years) >= (select y0 from yr))            as sdot_hcl_recent
from sets group by m;

-- ---------------------------------------------------------------- exports for the site
create or replace macro export_set() as table
  select * from ranked where rank <= 200 or rank_risk <= 200
     or fatal >= 2;   -- repeated deaths are always shown, whatever their rank

copy (
  select rank, rank_noboost, rank_fatal, rank_risk, location, addr_type, round(lon, 6) lon, round(lat, 6) lat,
         round(score_ksi, 1) score_ksi, round(score_fatal, 1) score_fatal, round(score_risk, 1) score_risk,
         round(harm, 1) harm, round(expected_harm, 1) expected_harm, round(eb_weight, 3) eb_weight,
         round(ksi_harm, 1) ksi_harm, round(block_ft) block_ft,
         ref_group, ref_n, round(ref_ksi_share, 4) ref_ksi_share, round(ref_ksi_harm_per_crash, 2) ref_ksi_harm_per_crash,
         round(request_boost, 3) request_boost, round(request_points, 1) request_points, scored_requests,
         round(pts_old, 1) pts_old,
         speed_limit, street_type, state_route, structure, pavement_min,
         volume, volume_streets, volume_year, volume_estimated,
         sdot_hin, sdot_hcl_years, ksi_after_hcl,
         lpi_status, lpi_installed, lpi_planned, ped_after_lpi, signalized, ped_signal, ped_audio, lt_protected, lt_installed,
         confidence, crashes, unknown_sev, fatal, serious, injury, ksi, ksi_years,
         ped_crashes, bike_crashes, speeding_crashes,
         wet_crashes, dark_crashes, unlit_crashes, road_known, light_known,
         first_crash, last_crash, requests, request_types
  from export_set() order by rank
) to 'site/data/priorities.json' (format json, array true);

-- Search index: every scored location, compact: [name, lat, lon, rank, crashes, ksi, ped/bike crashes, type]
copy (
  select list([location, round(lat, 5)::varchar, round(lon, 5)::varchar, rank::varchar, crashes::varchar,
               ksi::varchar, (ped_crashes + bike_crashes)::varchar, addr_type] order by rank) as idx
  from ranked
) to 'site/data/search.json' (format json, array false);

-- Drill-down: every crash (including recent, not-yet-scored ones) and nearby request, keyed by location.
-- Severity codes: F fatal, S serious injury, I injury, P property damage only, U unknown. n = not scored (after window).
copy (
  with top as (select location from export_set()),
  c as (
    select c.location, list({
      'd': c.date,
      's': case c.severity when 'Fatal Collision' then 'F' when 'Serious Injury Collision' then 'S'
                           when 'Injury Collision' then 'I' when 'Property Damage Only Collision' then 'P' else 'U' end,
      't': c.coll_type, 'pd': c.peds, 'cy': c.cyclists,
      'inj': c.injuries, 'ser': c.serious_injuries, 'fat': c.fatalities,
      'rd': c.road_cond, 'lt': c.light_cond, 'wx': c.weather, 'sp': c.speeding,
      'n': c.date >= we() or c.date < ws()
      -- no per-crash coordinates: SDOT snaps every crash to the intersection or block midpoint
    } order by c.date desc, c.id) as crashes
    from collisions c join top using (location) group by c.location
  ),
  r as (
    select lr.location, list({
      'd': r.date, 't': r.type, 'st': r.status, 'a': r.address, 'm': round(lr.dist_m),
      'lat': round(r.lat, 6), 'lon': round(r.lon, 6)
    } order by r.date desc, r.id) as requests
    from location_requests lr join top using (location) join requests r on r.id = lr.id
    group by lr.location
  )
  select map_from_entries(list((c.location, {'crashes': c.crashes, 'requests': coalesce(r.requests, [])}) order by c.location)) as details
  from c left join r using (location)
) to 'site/data/details.json' (format json, array false);

-- SDOT capital budget by program and year (budgeted amounts, net of reductions; not money spent; no locations)
copy (
  select program, project, code, year, round(sum(amount)) amount
  from capital_budget
  where dept = 'Seattle Department of Transportation' and year >= 2024
  group by all having sum(amount) <> 0
  order by program, project, year
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
    (select list({'mode': mode, 'on_hin': on_hin, 'on_hin_high': on_hin_high, 'sdot_hcl_recent': sdot_hcl_recent} order by mode)
     from sdot_agreement)                                   as sdot_agreement,
    (select round(count(*) filter (where sdot_hin is not null) * 1.0 / count(*), 3) from locations where crashes >= 10) as busy_share_on_hin,
    (select count(*) from locations where crashes >= 10)    as busy_locations,
    (select list({'method': method, 'k50': future_ksi_50, 'k200': future_ksi_200} order by future_ksi_50 desc, method) from validation) as validation,
    (select count(*) filter (where severity in ('Fatal Collision', 'Serious Injury Collision')) from collisions
       where date >= (select test_start from scoring_window) and date < we()) as test_ksi_total,
    -- citywide shares, used to flag locations that are unusually wet/dark (Unknown/Other excluded)
    (select round(sum(wet_crashes)  / sum(road_known),  3) from locations) as city_wet_share,
    (select round(sum(dark_crashes) / sum(light_known), 3) from locations) as city_dark_share,
    (select round(median(block_ft)) from loc_context where block_ft is not null) as median_block_ft,
    (select list({'k': k, 'v': v} order by k) from weights)       as weights,
    (select list({'type': type, 'w': w} order by w desc, type) from request_weights) as request_weights
) to 'site/data/meta.json' (format json, array false);

-- City outline (council districts merged), simplified to ~40 ft, so the map shows exactly the area covered.
copy (
  with d as (select gj_geom(f.geometry) g
             from (select unnest(features) f from read_json('data/raw/districts_*.json', maximum_object_size = 500000000))
             where f.geometry is not null)
  select ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(ST_Union_Agg(g), 40), 'EPSG:2926', 'EPSG:4326'))::json as boundary
  from d
) to 'site/data/boundary.json' (format json, array false);
