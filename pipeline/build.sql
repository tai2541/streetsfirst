-- Build the v1 priority ranking from data/raw/ into data/priority.duckdb and site/data/*.json
-- Run from the project root:  tools\duckdb\duckdb.exe data\priority.duckdb -f pipeline\build.sql
-- All weights live in the `weights` / `request_weights` tables below so they are easy to tune.

-- ---------------------------------------------------------------- settings
-- Two scoring modes are computed side by side; the site lets people switch between them.
--   ksi (default): fatal counts like serious injury (KSI = killed or seriously injured),
--                  doubled where fatal crashes repeat, then scaled by a reliability factor
--                  so a pattern of harm outranks a one-off event.
--   fatal (v1):    fatal crashes weighted far above everything else.
create or replace table weights as select * from (values
  ('ksi',               30.0),   -- ksi mode: points per fatal OR serious-injury collision
  ('fatal_growth',       1.5),   -- ksi mode: the nth fatal crash at a location counts ksi x growth^(n-1)
                                 --   (1st = 30, 2nd = 45, 3rd = 67.5 ...: repeated deaths compound)
  ('reliability_k',      3.0),   -- ksi mode: crash points x crashes / (crashes + k)
  ('request_boost_max',  0.5),   -- ksi mode: requests raise the crash score by at most +50%...
  ('request_boost_half', 50.0),  -- ...reaching half that boost at this many request points
  ('risk_min_crashes',   10.0),  -- risk mode: only locations with at least this many crashes
  ('risk_awdt_floor',  2000.0),  -- risk mode: treat volumes below this as this (avoids extreme rates)
  ('fatal',            100.0),   -- fatal mode: points per fatal collision
  ('serious',           30.0),   -- serious injury collision
  ('injury',             5.0),   -- other injury collision
  ('pdo',                1.0),   -- property damage only
  ('ped_bike_mult',      1.5),   -- multiplier when a pedestrian or cyclist was involved
  ('request_radius_m',  60.0),   -- requests within this distance count toward a location
  ('request_mult',       0.25)   -- request points are scaled by this before adding to score
) t(k, v);

create or replace table request_weights as select * from (values
  ('Traffic Signal Maintenance',   3.0),
  ('Streetlight Maintenance',      2.0),
  ('Street Sign Maintenance',      2.0),
  ('Damaged Sidewalk',             2.0),
  ('ADA Request (Transportation)', 2.0),
  ('Safe Routes to School',        2.0),
  ('Pothole',                      1.0),
  ('Clogged Storm Drain',          1.0),
  ('Bicycle Facility Maintenance', 1.0),
  ('Snow and Ice',                 1.0)
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

-- ---------------------------------------------------------------- score collisions
create or replace table collision_points as
select *,
  (case severity
     when 'Fatal Collision'          then wt('fatal')
     when 'Serious Injury Collision' then wt('serious')
     when 'Injury Collision'         then wt('injury')
     else wt('pdo') end)
  * (case when peds + cyclists > 0 then wt('ped_bike_mult') else 1 end) as points,
  (case severity
     when 'Fatal Collision'          then wt('ksi')
     when 'Serious Injury Collision' then wt('ksi')
     when 'Injury Collision'         then wt('injury')
     else wt('pdo') end)
  * (case when peds + cyclists > 0 then wt('ped_bike_mult') else 1 end)
  -- compounding for repeated fatal crashes at the same location (oldest first)
  * (case when severity = 'Fatal Collision'
          then power(wt('fatal_growth'),
                     row_number() over (partition by location, severity = 'Fatal Collision' order by date, id) - 1)
          else 1 end) as points_ksi
from collisions;

create or replace table locations as
select
  location,
  any_value(addr_type)                                  as addr_type,
  avg(lon) as lon, avg(lat) as lat,
  count(*)                                              as crashes,
  count(*) filter (where severity = 'Fatal Collision')          as fatal,
  count(*) filter (where severity = 'Serious Injury Collision') as serious,
  count(*) filter (where severity = 'Injury Collision')         as injury,
  count(*) filter (where peds > 0)                      as ped_crashes,
  count(*) filter (where cyclists > 0)                  as bike_crashes,
  count(*) filter (where road_cond ilike 'wet%' or road_cond ilike '%ice%' or road_cond ilike '%snow%') as wet_crashes,
  count(*) filter (where light_cond ilike 'dark%')      as dark_crashes,
  count(*) filter (where light_cond ilike 'dark - street lights off%' or light_cond ilike 'dark - no street lights%') as unlit_crashes,
  count(*) filter (where road_cond is not null)         as road_known,
  count(*) filter (where light_cond is not null)        as light_known,
  count(*) filter (where speeding)                      as speeding_crashes,
  min(date) as first_crash, max(date) as last_crash,
  sum(points)                                           as crash_points,          -- fatal mode
  sum(points_ksi)                                       as ksi_points_raw
from collision_points
group by location;

-- ksi mode: reliability factor (patterns outrank one-off events)
create or replace table locations as
select *,
  crashes / (crashes + wt('reliability_k')) as reliability,
  case when crashes < 5 then 'low' when crashes < 15 then 'medium' else 'high' end as confidence
from locations;

-- ---------------------------------------------------------------- street context (spatial)
-- Everything is projected to WA State Plane North (EPSG:2926, US feet) for distance math.
load spatial;
set geometry_always_xy = true;

create or replace macro gj_geom(g) as ST_Transform(ST_GeomFromGeoJSON(g::json), 'EPSG:4326', 'EPSG:2926');

create or replace table streets as
select f.properties.COMPKEY as compkey, f.properties.UNITDESC as unitdesc,
       nullif(f.properties.SPEEDLIMIT, 0) as speed, f.properties.ARTCLASS as artclass,
       f.properties.ARTDESCRIPT as artdesc, nullif(f.properties.PVMTCONDINDX1, 0) as pci,
       gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/streets_*.json', maximum_object_size = 500000000))
where f.geometry is not null;

create or replace table volumes as
select f.properties.STNAME_ORD as street, nullif(f.properties.AWDT, 0) as awdt, gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/volumes_*.json', maximum_object_size = 500000000))
where f.geometry is not null;

create or replace table hin as   -- SDOT Vision Zero High Injury Network, 2026
select f.properties.SEGMENT_NAME as name, f.properties.PRIORITY as priority, f.properties.HIN_SCORE as hin_score,
       gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/hin_*.json', maximum_object_size = 500000000))
where f.geometry is not null;

create or replace table hcl as   -- SDOT Vision Zero High Collision Locations (by year)
select f.properties.LOCATION as name, f.properties.HCL_YEAR as year, gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/hcl_*.json', maximum_object_size = 500000000))
where f.geometry is not null;

-- Intersections look 60 ft around the point (all approaching streets); blocks 40 ft (the block itself).
create or replace table loc_pts as
select location, ST_Transform(ST_Point(lon, lat), 'EPSG:4326', 'EPSG:2926') as geom,
       case when addr_type = 'I' then 60 else 40 end as r
from locations;

-- One spatial join per layer (fast), then aggregate per location.
create or replace table loc_context as
with
s as (select p.location,
        max(s.speed) as speed_limit,
        min(s.artclass) filter (where s.artclass between 1 and 5) as art_class,
        min(s.pci) as pavement_min
      from loc_pts p join streets s on ST_DWithin(p.geom, s.geom, 60)
      where ST_Distance(p.geom, s.geom) <= p.r
      group by p.location),
v as (select p.location, max(v.awdt) as awdt
      from loc_pts p join volumes v on ST_DWithin(p.geom, v.geom, 60) group by p.location),
h as (select p.location, min(case h.priority when 'High' then 1 when 'Mid' then 2 when 'Low' then 3 end) as hin_level
      from loc_pts p join hin h on ST_DWithin(p.geom, h.geom, 60) group by p.location),
c as (select p.location, list(distinct c.year order by c.year) as hcl_years
      from loc_pts p join hcl c on ST_DWithin(p.geom, c.geom, 80) group by p.location)
select p.location, s.speed_limit, s.art_class, s.pavement_min, v.awdt, h.hin_level, c.hcl_years
from loc_pts p
left join s using (location) left join v using (location)
left join h using (location) left join c using (location);

create or replace table locations as
select l.*, c.speed_limit,
  c.art_class,
  case c.art_class when 1 then 'Principal arterial' when 2 then 'Minor arterial' when 3 then 'Collector arterial'
                   when 4 then 'State route' when 5 then 'Freeway' else 'Neighborhood street' end as street_type,
  c.pavement_min, c.awdt,
  case c.hin_level when 1 then 'High' when 2 then 'Mid' when 3 then 'Low' end as sdot_hin,
  coalesce(c.hcl_years, []) as sdot_hcl_years
from locations l left join loc_context c using (location);

-- ---------------------------------------------------------------- nearby requests
-- bounding-box prefilter (~0.001 deg) then equirectangular distance in meters
create or replace table location_requests as
select l.location, r.type, r.date, r.id,
       111320 * sqrt(power(r.lat - l.lat, 2) + power((r.lon - l.lon) * cos(radians(l.lat)), 2)) as dist_m
from locations l
join requests r
  on r.lat between l.lat - 0.0008 and l.lat + 0.0008
 and r.lon between l.lon - 0.0012 and l.lon + 0.0012
where 111320 * sqrt(power(r.lat - l.lat, 2) + power((r.lon - l.lon) * cos(radians(l.lat)), 2)) <= wt('request_radius_m');

create or replace table location_request_summary as
select lr.location,
       sum(lr.n) as requests,
       sum(lr.n * coalesce(rw.w, 1)) as request_points,
       list({'type': lr.type, 'n': lr.n} order by lr.n desc, lr.type) as request_types
from (select location, type, count(*) n from location_requests group by all) lr
left join request_weights rw on rw.type = lr.type
group by lr.location;

-- ---------------------------------------------------------------- final ranking
create or replace table priorities as
select
  l.*,
  coalesce(s.requests, 0)       as requests,
  coalesce(s.request_points, 0) as request_points,
  s.request_types,
  round(l.ksi_points_raw * l.reliability, 1) as ksi_points,
  round(wt('request_boost_max') * coalesce(s.request_points, 0)
        / (coalesce(s.request_points, 0) + wt('request_boost_half')), 3) as request_boost,
  round(l.ksi_points_raw * l.reliability
        * (1 + wt('request_boost_max') * coalesce(s.request_points, 0)
               / (coalesce(s.request_points, 0) + wt('request_boost_half'))), 1) as score_ksi,
  round(l.crash_points + coalesce(s.request_points, 0) * wt('request_mult'), 1) as score_fatal
from locations l
left join location_request_summary s using (location);

-- Risk for its traffic: reliability-adjusted harm per 10,000 weekday vehicles on the busiest street there.
-- Only where SDOT has a volume count and there are enough crashes (>= risk_min_crashes) to be meaningful.
-- Volume floor avoids huge rates on very quiet streets.
create or replace table priorities as
select *,
  case when awdt is not null and crashes >= wt('risk_min_crashes')
       then round(ksi_points / (greatest(awdt, wt('risk_awdt_floor')) / 10000.0), 1) end as score_risk
from priorities;

create or replace table ranked as
select row_number() over (order by score_ksi desc, crashes desc, location)   as rank,        -- default mode
       row_number() over (order by score_fatal desc, crashes desc, location) as rank_fatal,
       case when score_risk is not null
            then row_number() over (partition by score_risk is null order by score_risk desc, crashes desc, location) end as rank_risk,
       score_ksi as score, *
from priorities;

-- ---------------------------------------------------------------- exports for the site
copy (
  select rank, rank_fatal, rank_risk, location, addr_type, round(lon, 6) lon, round(lat, 6) lat,
         score_ksi, score_fatal, score_risk,
         speed_limit, street_type, pavement_min, awdt, sdot_hin, sdot_hcl_years,
         round(crash_points, 1) crash_points, round(ksi_points_raw, 1) ksi_points_raw,
         round(reliability, 3) reliability, ksi_points, request_boost, confidence,
         round(request_points, 1) request_points,
         crashes, fatal, serious, injury, ped_crashes, bike_crashes, speeding_crashes,
         wet_crashes, dark_crashes, unlit_crashes, road_known, light_known,
         first_crash, last_crash, requests, request_types
  from ranked where rank <= 200 or rank_fatal <= 200 or rank_risk <= 200 order by rank
) to 'site/data/priorities.json' (format json, array true);

-- Drill-down: every crash and nearby request for the top 200 locations, keyed by location.
-- Severity codes: F fatal, S serious injury, I injury, P property damage only, U unknown.
copy (
  with top as (select location from ranked where rank <= 200 or rank_fatal <= 200 or rank_risk <= 200),
  c as (
    select c.location, list({
      'd': c.date,
      's': case c.severity when 'Fatal Collision' then 'F' when 'Serious Injury Collision' then 'S'
                           when 'Injury Collision' then 'I' when 'Property Damage Only Collision' then 'P' else 'U' end,
      't': c.coll_type, 'pd': c.peds, 'cy': c.cyclists,
      'inj': c.injuries, 'ser': c.serious_injuries, 'fat': c.fatalities,
      'rd': c.road_cond, 'lt': c.light_cond, 'wx': c.weather, 'sp': c.speeding
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

-- SDOT capital spending by program and year (no locations in this dataset)
copy (
  select program, project, code, year, round(sum(amount)) amount
  from capital_budget
  where dept = 'Seattle Department of Transportation' and year >= 2024
  group by all having sum(amount) <> 0
  order by program, project, year
) to 'site/data/sdot_budget.json' (format json, array true);

copy (
  select
    (select count(*) from collisions)                  as collisions,
    (select min(date) from collisions)                 as collisions_from,
    (select max(date) from collisions)                 as collisions_to,
    (select count(*) from requests)                    as requests,
    (select count(*) from locations)                   as locations_scored,
    -- agreement with SDOT's own Vision Zero analysis, for each ranking's top 50
    (select list({'mode': m, 'on_hin': on_hin, 'on_hin_high': on_hin_high, 'sdot_hcl': hcl, 'either': either} order by m)
     from (
       select m,
         count(*) filter (where sdot_hin is not null)                                as on_hin,
         count(*) filter (where sdot_hin = 'High')                                   as on_hin_high,
         count(*) filter (where len(sdot_hcl_years) > 0)                             as hcl,
         count(*) filter (where sdot_hin is not null or len(sdot_hcl_years) > 0)     as either
       from (select 'ksi' m, * from ranked where rank <= 50
             union all select 'fatal', * from ranked where rank_fatal <= 50
             union all select 'risk', * from ranked where rank_risk <= 50)
       group by m))                                    as sdot_agreement,
    (select count(*) filter (where sdot_hin is not null) * 1.0 / count(*) from locations) as city_share_on_hin,
    -- citywide shares, used to flag locations that are unusually wet/dark
    (select round(sum(wet_crashes)  / sum(road_known),  3) from locations) as city_wet_share,
    (select round(sum(dark_crashes) / sum(light_known), 3) from locations) as city_dark_share,
    (select list({'k': k, 'v': v} order by k) from weights)       as weights,
    (select list({'type': type, 'w': w} order by w desc, type) from request_weights) as request_weights
) to 'site/data/meta.json' (format json, array false);
