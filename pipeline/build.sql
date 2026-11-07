-- Build the v1 priority ranking from data/raw/ into data/priority.duckdb and site/data/*.json
-- Run from the project root:  tools\duckdb\duckdb.exe data\priority.duckdb -f pipeline\build.sql
-- All weights live in the `weights` / `request_weights` tables below so they are easy to tune.

-- ---------------------------------------------------------------- settings
create or replace table weights as select * from (values
  ('fatal',            100.0),   -- points per fatal collision
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
  * (case when peds + cyclists > 0 then wt('ped_bike_mult') else 1 end) as points
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
  min(date) as first_crash, max(date) as last_crash,
  sum(points)                                           as crash_points
from collision_points
group by location;

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
       list({'type': lr.type, 'n': lr.n} order by lr.n desc) as request_types
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
  round(l.crash_points + coalesce(s.request_points, 0) * wt('request_mult'), 1) as score
from locations l
left join location_request_summary s using (location);

create or replace table ranked as
select row_number() over (order by score desc, crashes desc) as rank, *
from priorities;

-- ---------------------------------------------------------------- exports for the site
copy (
  select rank, location, addr_type, round(lon, 6) lon, round(lat, 6) lat, score,
         round(crash_points, 1) crash_points, round(request_points, 1) request_points,
         crashes, fatal, serious, injury, ped_crashes, bike_crashes,
         wet_crashes, dark_crashes, unlit_crashes, road_known, light_known,
         first_crash, last_crash, requests, request_types
  from ranked where rank <= 200 order by rank
) to 'site/data/priorities.json' (format json, array true);

-- Drill-down: every crash and nearby request for the top 200 locations, keyed by location.
-- Severity codes: F fatal, S serious injury, I injury, P property damage only, U unknown.
copy (
  with top as (select location from ranked where rank <= 200),
  c as (
    select c.location, list({
      'd': c.date,
      's': case c.severity when 'Fatal Collision' then 'F' when 'Serious Injury Collision' then 'S'
                           when 'Injury Collision' then 'I' when 'Property Damage Only Collision' then 'P' else 'U' end,
      't': c.coll_type, 'pd': c.peds, 'cy': c.cyclists,
      'inj': c.injuries, 'ser': c.serious_injuries, 'fat': c.fatalities,
      'rd': c.road_cond, 'lt': c.light_cond, 'wx': c.weather, 'sp': c.speeding
      -- no per-crash coordinates: SDOT snaps every crash to the intersection or block midpoint
    } order by c.date desc) as crashes
    from collisions c join top using (location) group by c.location
  ),
  r as (
    select lr.location, list({
      'd': r.date, 't': r.type, 'st': r.status, 'a': r.address, 'm': round(lr.dist_m),
      'lat': round(r.lat, 6), 'lon': round(r.lon, 6)
    } order by r.date desc) as requests
    from location_requests lr join top using (location) join requests r on r.id = lr.id
    group by lr.location
  )
  select map_from_entries(list((c.location, {'crashes': c.crashes, 'requests': coalesce(r.requests, [])}))) as details
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
    -- citywide shares, used to flag locations that are unusually wet/dark
    (select round(sum(wet_crashes)  / sum(road_known),  3) from locations) as city_wet_share,
    (select round(sum(dark_crashes) / sum(light_known), 3) from locations) as city_dark_share,
    (select list({'k': k, 'v': v}) from weights)       as weights,
    (select list({'type': type, 'w': w}) from request_weights) as request_weights
) to 'site/data/meta.json' (format json, array false);
