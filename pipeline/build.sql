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
--                      streets (empirical Bayes); then a small capped boost from safety-related requests.
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
  ('Damaged Sidewalk',             0.0),   -- trip and access hazards, not crash risk; still listed at each spot
  ('ADA Request (Transportation)', 0.0),   -- same: access barriers, not crash risk
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
  coalesce(FATALITIES, 0)                  as fatalities,
  coalesce(SERIOUSINJURIES, 0)             as serious_injuries,
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
  coordinates[2]                           as lat
from raw
where LOCATION is not null and coordinates is not null
-- Probable duplicate reports: same place, day, severity, crash type, people, vehicles and conditions under two
-- report numbers (about 100 of 36,000, mostly property damage). Keep one.
qualify row_number() over (partition by LOCATION, INCDATE, MAXSEVERITYDESC, ST_COLDESC, PEDCOUNT, PEDCYLCOUNT,
          FATALITIES, SERIOUSINJURIES, INJURIES, VEHCOUNT, PERSONCOUNT, WEATHER, ROADCOND, LIGHTCOND order by INCKEY) = 1;

-- Split roadways: SDOT names each side of a divided street separately ("M L KING JR WR WAY S" and "... ER ...",
-- light rail in the median), so one intersection appears twice 15-20 m apart. Merge the two sides when they
-- are within ~60 m of each other. NB/SB/EB/WB are left alone: those are separate bridges and ramps.
create or replace macro road_norm(t) as regexp_replace(t, ' (WR|ER|NR|SR) ', ' ', 'g');
create or replace table loc_merge as
with p as (select location raw, road_norm(location) k, avg(lon) lon, avg(lat) lat from collisions group by location),
g as (select k, max(lon) - min(lon) dlon, max(lat) - min(lat) dlat, count(*) n from p group by k)
select p.raw, case when g.n > 1 and g.dlon < 0.0008 and g.dlat < 0.00055 then p.k else p.raw end as location
from p join g using (k);
update collisions set location = m.location from loc_merge m where collisions.location = m.raw and m.raw <> m.location;

-- People killed and seriously injured citywide, including reports that have no location (so they can't be scored).
create or replace table collisions_unlocated as
with raw as (select unnest(features, recursive := true) from read_json('data/raw/collisions_*.json', maximum_object_size = 50000000))
select make_timestamp(INCDATE::bigint * 1000)::date as date, MAXSEVERITYDESC as severity,
       coalesce(FATALITIES, 0) as fatalities, coalesce(SERIOUSINJURIES, 0) as serious_injuries
from raw where LOCATION is null or coordinates is null;

create or replace table collisions_dropped as   -- disclosed on the site
with raw as (select unnest(features, recursive := true) from read_json('data/raw/collisions_*.json', maximum_object_size = 50000000))
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
       ST_Centroid(gj_geom(f.geometry)) as geom
from (select unnest(features) f from read_json('data/raw/lpi_*.json', maximum_object_size = 50000000))
where f.geometry is not null;

create or replace table ntor as   -- No turn on red at a signal (all or some approaches)
select f.properties.NTOR_Status as status,
       -- a handful of records carry July 1905 (a placeholder, not a real install date): treated as unknown
       case when make_timestamp(f.properties.NTOR_Install_Date::bigint * 1000) >= timestamp '1950-01-01'
            then make_timestamp(f.properties.NTOR_Install_Date::bigint * 1000)::date end as installed,
       f.properties.NTOR_Planned_Year as planned_year, nullif(trim(f.properties.Approaches), '') as approaches,
       ST_Centroid(gj_geom(f.geometry)) as geom
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
        max(s.speed) as speed_limit,
        min(s.artclass) filter (where s.artclass between 1 and 5) as art_class,
        min(s.pci) as pavement_min
      from loc_pts p join streets s on ST_DWithin(p.geom, s.geom, 60)
      where ST_Distance(p.geom, s.geom) <= p.r
        -- a freeway or ramp passing over or beside a place isn't its street (it gave downtown corners I-5's 60 mph),
        -- unless the place is that ramp
        and (s.unitdesc = p.location
             or not regexp_matches(regexp_replace(s.unitdesc, ' BETWEEN .*$', ''), '^(I ?5|I ?90|I ?405|SR ?[0-9]+)( |$)| RP( |$)'))
      group by p.location),
len as (select unitdesc as location, max(ST_Length(geom)) as block_ft from streets group by unitdesc),
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
lp as (select p.location,
         arg_min({'status': l.status, 'installed': l.installed, 'planned': l.planned_year},
                 {'s': case l.status when 'Existing' then 0 when 'Planned' then 1 else 2 end, 'd': ST_Distance(p.geom, l.geom),
                  'i': l.installed, 'p': l.planned_year}) as lpi
       from loc_pts p join locations_all a using (location) join lpi l on ST_DWithin(p.geom, l.geom, 100)
       where a.addr_type = 'I' group by p.location),
nt as (select p.location,   -- same rule as head-start signals: the nearest record within 100 ft, Existing first
         arg_min({'status': n.status, 'installed': n.installed, 'planned': n.planned_year, 'approaches': n.approaches},
                 {'s': case n.status when 'Existing' then 0 when 'Planned' then 1 else 2 end, 'd': ST_Distance(p.geom, n.geom),
                  'i': n.installed, 'p': n.planned_year}) as ntor
       from loc_pts p join locations_all a using (location) join ntor n on ST_DWithin(p.geom, n.geom, 100)
       where a.addr_type = 'I' group by p.location),
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
create or replace macro harm_in(d0, d1) as table
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
create or replace macro eb_in(d0, d1) as table
with h as (
  select h.* exclude (ksi_harm_raw), coalesce(h.ksi_harm_raw, 0) as ksi_harm, x.addr_class, x.street_bucket, x.addr_class || ' / ' || x.street_bucket as ref_group
  from harm_in(d0, d1) h join loc_context x using (location)
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
  -- state facilities: WSDOT owns or shares responsibility
  -- Aurora Ave N is SR 99 and Lake City Way NE is SR 522, although SDOT classes them as city arterials.
  case when regexp_matches(e.location, '\bAURORA (AVE N|BR)\b|\bSR ?99\b|ALASKAN WY VI|BATTERY ST TUNNEL') then 'SR 99'
       when regexp_matches(e.location, '\bLAKE CITY WAY NE\b|\bSR ?522\b') then 'SR 522'
       when regexp_matches(e.location, '\bSR ?509\b|\b1ST AVE? S BR\b') then 'SR 509'
       when regexp_matches(e.location, '\bN(E)? 145TH ST\b') and a.lon > -122.3445 then 'SR 523'
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
        where date >= (select req_start from scoring_window) and date < we()) lr
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
  -- Risk: expected harm per million vehicles over the 5 scoring years (weekday counts x 365 x 5; intersections:
  -- streets added together, i.e. vehicles entering).
  case when volume is not null and crashes >= wt('risk_min_crashes')
       then expected_harm * 1e6 / (greatest(volume, wt('risk_vol_floor')) * 365.0 * 5) end as score_risk
from b;

create or replace table ranked as
-- Intersections and stretches between them are ranked separately, the way SDOT lists High Collision Locations: they
-- aren't alike. Tested on earlier years, judging long stretches per 1,000 ft caught fewer later deaths and serious
-- injuries (long stretches really do keep producing them), so every place keeps its full score.
-- rank_type is the place's rank among its own kind. `rank` interleaves the two lists (intersection #1, stretch #1,
-- intersection #2, ...), so "rank <= 50" is the top 25 of each and every list below keeps one order.
-- Scores are rounded for ranking: sums done in parallel can differ in the last digit from build to build, which would
-- let equal scores swap places instead of falling to the tie-breaks.
with a as (
  select *, addr_type = 'I' as is_int,
    score_ksi as score_rank
  from priorities
),
b as (select *, row_number() over (partition by is_int order by round(score_rank, 9) desc, crashes desc, location) as rank_type from a)
select 2 * rank_type - case when is_int then 1 else 0 end                               as rank,
       2 * row_number() over (partition by is_int order by round(expected_harm, 9) desc, crashes desc, location)
         - case when is_int then 1 else 0 end                                               as rank_noboost,
       row_number() over (order by round(score_fatal, 9) desc, crashes desc, location)     as rank_fatal,
       case when score_risk is not null
            then row_number() over (partition by score_risk is null order by round(score_risk, 12) desc, crashes desc, location) end as rank_risk,
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
  -- the site's ranking: intersections and stretches ranked apart, the two lists interleaved
  union all select 'expected_split', location, 2 * rt - case when is_int then 1 else 0 end from (
    select t.location, x.addr_type = 'I' as is_int,
      row_number() over (partition by x.addr_type = 'I' order by
        round(t.expected_harm, 9) desc,
        t.crashes desc, t.location) as rt
    from train t join loc_context x using (location))
)
select m as method,
  coalesce(sum(t.ksi) filter (where rk <= 50), 0)::int  as future_ksi_50,
  coalesce(sum(t.ksi) filter (where rk <= 200), 0)::int as future_ksi_200
from methods left join test t using (location) group by m;

create or replace table validation_splits as
select (select test_start from scoring_window) as a_test0, ws() + interval 24 month as b_mid, ws() + interval 48 month as b_end;

create or replace table validation as
select a.method, a.future_ksi_50, a.future_ksi_200, b.future_ksi_50 as b_ksi_50, b.future_ksi_200 as b_ksi_200
from val_split(ws(), (select a_test0 from validation_splits), (select a_test0 from validation_splits), we()) a
join val_split(ws(), (select b_mid::date from validation_splits), (select b_mid::date from validation_splits),
               (select b_end::date from validation_splits)) b using (method);

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
     or killed >= 2   -- places where 2 or more people died are always shown, whatever their rank
     -- each council district's own top 25 intersections and top 25 stretches (and top 25 for how busy it is),
     -- so the list filtered to one district is complete
     or location in (select location from (
          select location,
            row_number() over (partition by council_district, addr_type = 'I' order by rank) as n_ksi,
            row_number() over (partition by council_district, rank_risk is null order by rank_risk) as n_risk,
            rank_risk
          from ranked where council_district is not null)
        where n_ksi <= 25 or (rank_risk is not null and n_risk <= 25));

-- Map areas for the on-demand detail files: a grid of about 1.1 km x 1.1 km cells.
create or replace macro cell_of(lat, lon) as floor(lat / 0.01)::int || '_' || floor(-lon / 0.015)::int;

-- Every place's site fields (the same columns for the ranked spots and, loaded on demand, for every other place).
create or replace table spot_export as
  select rank, rank_type, rank_noboost, rank_fatal, rank_risk, location, addr_type, round(lon, 6) lon, round(lat, 6) lat,
         cell_of(lat, lon) as cell,
         round(score_ksi, 1) score_ksi,
         round(score_fatal, 1) score_fatal, round(score_risk, 1) score_risk,
         round(harm, 1) harm, round(expected_harm, 1) expected_harm, round(eb_weight, 3) eb_weight,
         round(ksi_harm, 1) ksi_harm, round(block_ft) block_ft, round(ref_other_harm_per_known, 2) ref_other_harm_per_known,
         ref_group, ref_n, round(ref_ksi_share, 4) ref_ksi_share, round(ref_ksi_harm_per_crash, 2) ref_ksi_harm_per_crash,
         round(request_boost, 3) request_boost, round(request_points, 1) request_points, scored_requests,
         round(pts_old, 1) pts_old,
         area, neighborhood, speed_limit, street_type, state_route, structure, pavement_min,
         volume, volume_streets, volume_year, volume_estimated,
         sdot_hin, sdot_hcl_years, sdot_hcl_types, ksi_after_hcl,
         lpi_status, lpi_installed, lpi_planned, ntor_status, ntor_installed, ntor_planned, ntor_approaches, ped_after_lpi, signalized, ped_signal, ped_audio, lt_protected, lt_installed,
         confidence, crashes, unknown_sev, fatal, serious, injury, ksi, ksi_years, killed, seriously_injured,
         pb_crashes, ped_crashes, bike_crashes, speeding_crashes, ped_turn_after_lpi, left_turn_crashes, ped_turn_crashes, angle_crashes,
         wet_crashes, dark_crashes, unlit_crashes, road_known, light_known,
         first_crash, last_crash, requests, request_types,
         fixes, vol_history, bus_trips, bus_routes, bus_stretch_id,
         sw_missing_tier, sw_poor_ft, sw_poor_assessed, proj_ids, proj_planned, cip, signal_installed,
         crosswalks, crosswalks_midblock, crosswalk_school, crosswalk_controls, curb_ramps, curb_ramps_poor, bike_facilities,
         school, school_ft, rse_quintile, rse_year, council_district, council_member, council_url, before_after,
         rank_years, rank_month_ago, rank_year_ago
  from ranked left join place_history using (location);

copy (
  select * from spot_export where location in (select location from export_set()) order by rank
) to 'site/data/priorities.json' (format json, array true);


-- Search index: every scored location, compact: [name, lat, lon, rank, crashes, ksi, ped/bike crashes, type, hood, area, cell]
copy (
  select list([location, round(lat, 5)::varchar, round(lon, 5)::varchar, rank::varchar, crashes::varchar,
               ksi::varchar, pb_crashes::varchar, addr_type, coalesce(neighborhood, ''), coalesce(area, ''), cell_of(lat, lon)] order by rank) as idx
  from ranked
) to 'site/data/search.json' (format json, array false);


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
    select q.cell, list(to_json([to_json(r.date), to_json(r.type), to_json(r.status), to_json(r.address),
                                 to_json(round(r.lat, 6)), to_json(round(r.lon, 6))]) order by q.qi) as q
    from more_req_ids q join requests r on r.id = q.id group by q.cell
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
    select *, coalesce(nullif(regexp_extract(project, '^(MC-TR-C[0-9]+)', 1), ''), nullif(regexp_extract(code, '^(MC-TR-C[0-9]+)', 1), ''), code) as pid
    from capital_budget
    where dept = 'Seattle Department of Transportation' and year >= year(current_date) - 2),
  names as (select pid, arg_max(program, {'y': year, 'p': program}) as program, arg_max(project, {'y': year, 'p': project}) as project from b group by pid)
  select n.program, n.project, b.pid as code, b.year, round(sum(b.amount)) amount,
         round(sum(b.amount) filter (where b.fund ilike '%Transportation Levy%')) as levy
  from b join names n using (pid)
  group by all having sum(b.amount) <> 0
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
    (select round(count(*) filter (where sdot_hin is not null) * 1.0 / count(*), 3) from locations where crashes >= 10) as busy_share_on_hin,
    (select count(*) from locations where crashes >= 10)    as busy_locations,
    (select list({'method': method, 'k50': future_ksi_50, 'k200': future_ksi_200, 'b50': b_ksi_50, 'b200': b_ksi_200} order by future_ksi_50 desc, method) from validation) as validation,
    (select b_mid::date from validation_splits)            as test2_from,
    ((select b_end from validation_splits) - interval 1 day)::date as test2_to,
    (select count(*) filter (where severity in ('Fatal Collision', 'Serious Injury Collision')) from collisions
       where date >= (select b_mid from validation_splits) and date < (select b_end from validation_splits)) as test2_ksi_total,
    (select count(*) filter (where severity in ('Fatal Collision', 'Serious Injury Collision')) from collisions
       where date >= (select test_start from scoring_window) and date < we()) as test_ksi_total,
    -- citywide totals for the summary at the top of the list (people, not crashes)
    (select sum(fatalities) from collisions where date >= ws() and date < we())
      + (select coalesce(sum(fatalities), 0) from collisions_unlocated where date >= ws() and date < we()) as city_killed,
    (select sum(serious_injuries) from collisions where date >= ws() and date < we())
      + (select coalesce(sum(serious_injuries), 0) from collisions_unlocated where date >= ws() and date < we()) as city_serious,
    (select count(*) from collisions_unlocated where date >= ws() and date < we()
       and severity in ('Fatal Collision', 'Serious Injury Collision')) as city_ksi_unlocated,
    (select count(*) from collisions where date >= ws() and date < we()
       and severity in ('Fatal Collision', 'Serious Injury Collision')) as city_ksi_located,
    (select count(*) from collisions where date >= ws() and date < we() and peds + cyclists > 0
       and severity in ('Fatal Collision', 'Serious Injury Collision')) as city_ped_bike_ksi,
    (select round(sum(ksi) filter (where rank <= 50) * 1.0 / sum(ksi), 3) from ranked) as top50_ksi_share,
    (select sum(ksi) filter (where rank <= 50) from ranked) as top50_ksi,
    -- the top 50 is 25 intersections and 25 stretches of street; how many miles those stretches add up to
    (select round(sum((select sum(ST_Length(s.geom)) from streets s where s.unitdesc = r.location)) / 5280, 1)
       from ranked r where not r.is_int and r.rank <= 50) as top50_stretch_miles,
    (select sum(ksi) from ranked) as city_ksi_crashes,
    -- looking ahead: the top 50 ranked on the first 3 years (the site's rule, so the validation's own number), and
    -- their share of the next 2 years' KSI crashes
    (select future_ksi_50 from validation where method = 'expected_split') as forward_top50_ksi,
    (select count(*) from collisions where date >= ws() and date < we() and peds + cyclists > 0
       and severity = 'Fatal Collision') as city_ped_bike_fatal,
    (select count(*) from collisions where date >= ws() and date < we() and severity = 'Unknown'
       and date >= date '2026-01-01') as unknown_since_2026,
    (select count(*) from collisions where date >= ws() and date < we() and speeding) as city_speeding,
    -- citywide shares, used to flag locations that are unusually wet/dark (Unknown/Other excluded)
    (select round(sum(wet_crashes)  / sum(road_known),  3) from locations) as city_wet_share,
    (select round(sum(dark_crashes) / sum(light_known), 3) from locations) as city_dark_share,
    (select round(median(block_ft)) from loc_context where block_ft is not null) as median_block_ft,
    (select list({'k': k, 'v': v} order by k) from weights)       as weights,
    (select list({'type': type, 'w': w} order by w desc, type) from request_weights) as request_weights
) to 'site/data/meta.json' (format json, array false);

-- Council districts with their members, and public schools: so a pin or searched address can show them too.
copy (
  select {
    'council': (select list({'d': district, 'member': member, 'url': url,
                 'geom': ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(geom, 40), 'EPSG:2926', 'EPSG:4326'))::json} order by district) from council),
    'schools': (select list([name, round(ST_Y(ST_Transform(geom, 'EPSG:2926', 'EPSG:4326')), 5)::varchar,
                             round(ST_X(ST_Transform(geom, 'EPSG:2926', 'EPSG:4326')), 5)::varchar, type] order by name) from schools)
  } as ctx
) to 'site/data/context.json' (format json, array false);

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
