-- Read by build.sql after projects.sql. Context only: none of this changes the ranking.
--   * What's on the street: marked crosswalks, curb ramps (intersections), bike facilities of every type, traffic circles
--   * Nearby public school, the City's Race and Social Equity Index for the census tract, the council district and member
--   * Before and after: crashes in equal periods before and after something SDOT built with a known date, next to the
--     citywide change in the same kind of crash over the same periods (uses older crash years, 2011 on)

-- ---------------------------------------------------------------- what's on the street
create or replace table crosswalks as
select f.properties.MIDBLOCK_CROSSWALK = 'Y' as midblock, f.properties.SCHOOL = 'Y' as school,
       nullif(trim(f.properties.CROSSWALK_CONTROL), '') as control, gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/crosswalks_*.json', maximum_object_size = 50000000))
where f.geometry is not null;

create or replace table curbramps as
select f.properties.CONDITION as cond, gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/curbramps_*.json', maximum_object_size = 50000000))
where f.geometry is not null;

-- SDOT's bike facility categories, in plain words (most protective first)
create or replace table bikefac as
select case f.properties.CATEGORY when 'BKF-PBL' then 'Protected bike lane' when 'BKF-OFFST' then 'Off-street trail'
            when 'BKF-BBL' then 'Buffered bike lane' when 'BKF-BL' then 'Painted bike lane' when 'BKF-CLMB' then 'Uphill bike lane'
            when 'BKF-NGW' then 'Neighborhood greenway' when 'BKF-SHW' then 'Shared lane markings (sharrows)' end as kind,
       case f.properties.CATEGORY when 'BKF-PBL' then 1 when 'BKF-OFFST' then 2 when 'BKF-BBL' then 3 when 'BKF-BL' then 4
            when 'BKF-CLMB' then 5 when 'BKF-NGW' then 6 else 7 end as ord,
       gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/bikefac_*.json', maximum_object_size = 50000000))
where f.geometry is not null and f.properties.CATEGORY like 'BKF-%';

create or replace table circles as
select try_cast(make_timestamp(f.properties.INSTALL_DATE::bigint * 1000) as date) as d, gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/circles_*.json', maximum_object_size = 50000000))
where f.geometry is not null;

-- Crosswalks: within 100 ft of an intersection, or along the block (its street line without the ends, 40 ft; the
-- crosswalks at its end corners belong to those intersections). Curb ramps: intersections.
create or replace table loc_street_ctx as
with cw as (
  select s.location, count(*) as n, count(*) filter (where c.midblock) as midblock, bool_or(c.school) as school,
         list(distinct c.control order by c.control) filter (where c.control is not null) as controls
  from loc_inner s join crosswalks c on ST_DWithin(s.geom, c.geom, case when s.r = 40 then 40 else 100 end) and not on_structure(s.location)
  group by s.location),
rp as (
  select p.location, count(*) as n, count(*) filter (where r.cond in ('POOR', 'VERY-POOR')) as poor
  from loc_pts p join curbramps r on ST_DWithin(p.geom, r.geom, 100) where p.r = 60 group by p.location),
-- Bike facilities: at an intersection, any within 60 ft; on a block, only one running along most of it (not a cross street)
bk as (
  select s.location, list(distinct b.kind order by b.kind) as kinds, min(b.ord) as best
  from loc_shape s join bikefac b on ST_DWithin(s.geom, b.geom, case when s.r = 40 then 30 else 60 end)
  where s.r <> 40 or ST_Length(ST_Intersection(s.geom, ST_Buffer(b.geom, 30))) > 0.5 * greatest(ST_Length(s.geom), 1)
  group by s.location),
tc as (
  select p.location, min(c.d) as d from loc_pts p join circles c on ST_DWithin(p.geom, c.geom, 100) where p.r = 60 group by p.location)
select l.location,
  coalesce(cw.n, 0) as crosswalks, coalesce(cw.midblock, 0) as crosswalks_midblock, coalesce(cw.school, false) as crosswalk_school,
  coalesce(cw.controls, []) as crosswalk_controls,
  rp.n as curb_ramps, rp.poor as curb_ramps_poor,
  bk.kinds as bike_facilities,
  tc.d as circle_d, tc.location is not null as circle
from locations l left join cw using (location) left join rp using (location) left join bk using (location) left join tc using (location);

-- ---------------------------------------------------------------- schools, equity index, council district
create or replace table schools as
select coalesce(nullif(trim(f.properties.NAME), ''), nullif(trim(f.properties.SCHOOL), '')) as name, f.properties.TYPE as type, gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/schools_*.json', maximum_object_size = 50000000))
where f.geometry is not null;

create or replace table rse as
select f.properties.COMPOSITE_QUINTILE as quintile, f.properties.INDEX_YEAR as yr, gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/rse_*.json', maximum_object_size = 50000000))
where f.geometry is not null;

-- A district's member is named only if the City Clerk's list of serving members (Legistar, fetched the same day)
-- includes them; with no list (fetch failed), no names are shown that week rather than unconfirmed ones.
-- A term that ends within the week counts as ended: the site is rebuilt weekly, so this never names a former member
-- (at worst, the district shows without a name for a few days).
create or replace table council_now as
select lower(trim(OfficeRecordFullName)) as n
from read_json('data/raw/legistar_council.json', columns = {'OfficeRecordFullName': 'VARCHAR', 'OfficeRecordEndDate': 'VARCHAR'})
where OfficeRecordEndDate is null or try_cast(OfficeRecordEndDate as timestamp) is null
   or try_cast(OfficeRecordEndDate as timestamp) >= current_date + interval 7 day;
create or replace table council as
select f.properties.C_DISTRICT::int as district,
       case when lower(trim(f.properties.Name)) in (select n from council_now)
            then f.properties.Name end as member,
       -- the district map's link, when it is a council page (one district's has been a stray file link); else the council's own page
       case when regexp_matches(f.properties.Website, '^https://(www\.)?seattle\.gov/council/[a-z]')
            then f.properties.Website else 'https://www.seattle.gov/council' end as url, gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/council_*.json', maximum_object_size = 50000000))
where f.geometry is not null;

create or replace table loc_area_ctx as
with sch as (   -- nearest public school within 1,000 ft
  select p.location, arg_min(s.name, {'d': ST_Distance(p.geom, s.geom), 'n': s.name}) as school, min(ST_Distance(p.geom, s.geom)) as school_ft
  from loc_pts p join schools s on ST_DWithin(p.geom, s.geom, 1000) group by p.location),
-- A place just outside every district (streets on the city limit, e.g. N 145th St) takes the nearest one within
-- 300 ft: the district whose residents use that street.
-- Boundaries run down the middle of main streets, where SDOT puts each crash, so a place within 25 ft of the nearest
-- area is treated as on the line: for the equity index it takes the higher priority of the areas there; for districts
-- it keeps the nearest (the lower number if exactly on the line) and also names the other (council_district2).
eqd as (select p.location, r.quintile, r.yr, ST_Distance(p.geom, r.geom) as d,
               case r.quintile when 'Highest Equity Priority' then 1 when 'Second Highest' then 2 when 'Middle' then 3
                               when 'Second Lowest' then 4 when 'Lowest' then 5 else 6 end as pri
        from loc_pts p join rse r on ST_DWithin(p.geom, r.geom, 300)),
eq as (select location, arg_min({'q': quintile, 'y': yr}, {'p': pri, 'd': d}) as e
       from (select *, min(d) over (partition by location) as d0 from eqd) where d <= d0 + 25 group by location),
cdd as (select p.location, c.district, c.member, c.url, ST_Distance(p.geom, c.geom) as d
        from loc_pts p join council c on ST_DWithin(p.geom, c.geom, 300)),
cd as (select location, arg_min({'d': district, 'm': member, 'u': url}, {'x': d, 'd': district}) as c,
              list(distinct district) filter (where d <= d0 + 25) as near
       from (select *, min(d) over (partition by location) as d0 from cdd) group by location)
select l.location, sch.school, round(sch.school_ft) as school_ft, eq.e.q as rse_quintile, eq.e.y as rse_year,
       cd.c.d as council_district, cd.c.m as council_member, cd.c.u as council_url,
       list_min(list_filter(cd.near, lambda x: x <> cd.c.d)) as council_district2
from locations l left join sch using (location) left join eq using (location) left join cd using (location);

-- ---------------------------------------------------------------- before and after
-- Older crashes (2011 up to the scored years) plus the current ones, with the current place names: intersections by
-- SDOT's intersection key, blocks by name (split roadways merged the same way as the scored crashes).
create or replace table crash_hist as
with raw as (select unnest(features, recursive := true)
             from read_json('data/raw/crashhist_*.json', maximum_object_size = 50000000, maximum_sample_files = 1000)),
ik as (select intkey, arg_max(location, {'n': n, 'l': location}) as location
       from (select intkey, location, count(*) as n from collisions where intkey is not null group by all) group by intkey)
select coalesce(ik.location, m.location, trim(r.LOCATION)) as location,
       make_timestamp(r.INCDATE::bigint * 1000)::date as date,
       coalesce(r.PEDCOUNT, 0) as peds, coalesce(r.PEDCYLCOUNT, 0) as cyclists, r.ST_COLDESC as coll_type,
       coalesce(r.MAXSEVERITYDESC, 'Unknown') as severity, r.ADDRTYPE as addr_type,
       r.coordinates[1] as lon, r.coordinates[2] as lat
from raw r left join ik on r.ADDRTYPE = 'I' and ik.intkey = r.INTKEY
left join loc_merge m on m.raw = trim(r.LOCATION)
where r.LOCATION is not null and r.coordinates is not null
-- the same duplicate-report rule as the scored crashes
qualify row_number() over (partition by r.LOCATION, r.INCDATE, r.MAXSEVERITYDESC, r.ST_COLDESC, r.PEDCOUNT, r.PEDCYLCOUNT order by r.INCKEY) = 1;

create or replace table crash_all as
select location, date, peds, cyclists, coll_type from crash_hist where date < ws()
union all
select location, date, peds, cyclists, coll_type from collisions;

-- Dated things SDOT built at each place, and the kind of crash each one is meant to reduce.
create or replace table dated_fixes as
select location, 'Head-start walk signal' as kind, lpi_installed as d, 'turnped' as m from locations where lpi_status = 'Existing' and lpi_installed is not null
union all select location, 'No turn on red', ntor_installed, 'turnped' from locations where ntor_status = 'Existing' and ntor_installed is not null
union all select location, 'Protected left-turn signal', lt_installed, 'left' from locations where lt_protected and lt_installed is not null
union all select location, f.k, f.d, case when f.k = 'Protected bike lane' then 'bike' else 'all' end
  from (select location, unnest(fixes) f from locations) where f.d is not null and f.s = 'Built' and not f.u
union all select location, 'Traffic circle', circle_d, 'all' from loc_street_ctx where circle_d is not null;

create or replace macro crash_kind(m, peds, cyclists, coll_type) as
  -- No turn on red stops turns on a red light (right turns, and left turns onto a one-way street), so it's judged on
  -- people walking hit by a turning driver, not on every crash involving someone walking
  case m when 'ped' then peds > 0 when 'bike' then cyclists > 0
         when 'turnped' then coll_type in ('Vehicle turning left hits pedestrian', 'Vehicle turning right hits pedestrian')
         when 'left' then coll_type = 'From opposite direction - one left turn - one straight' else true end;

-- Equal periods, up to 3 years each side; the month it went in is skipped. Needs at least a year on both sides
-- (crash data here starts 2011; the after period ends when the scored years end).
-- Some SDOT layers give only a year, written as Dec 30 or 31 (most protected bike lanes): for those the whole year is
-- skipped (before ends Jan 1 of that year, after starts Jan 1 of the next), since the real day could be any in it.
-- The walk-signal layers (head-start walk signal, no turn on red) write a year-only date as Jan 1.
create or replace table before_after as
with f00 as (
  select *, (month(d) = 12 and day(d) >= 30)
            or (kind in ('Head-start walk signal', 'No turn on red') and month(d) = 1 and day(d) = 1) as yo
  from dated_fixes where d >= date '2012-01-01'),
f0 as (
  select *, case when yo then make_date(year(d), 1, 1) else d end as b_end,
            case when yo then make_date(year(d) + 1, 1, 1) else d + 30 end as a_start
  from f00),
f as (select *, least(1095, b_end - date '2011-01-01', we() - a_start)::int as days from f0),
f2 as (select * from f where days >= 365)
select f2.location, list({'k': kind, 'd': d, 'm': m, 'days': days, 'yo': yo,
    'b': (select count(*) from crash_all c where c.location = f2.location and c.date >= f2.b_end - f2.days and c.date < f2.b_end
                                          and crash_kind(f2.m, c.peds, c.cyclists, c.coll_type)),
    'a': (select count(*) from crash_all c where c.location = f2.location and c.date >= f2.a_start and c.date < f2.a_start + f2.days
                                          and crash_kind(f2.m, c.peds, c.cyclists, c.coll_type)),
    'cb': (select count(*) from crash_all c where c.date >= f2.b_end - f2.days and c.date < f2.b_end and crash_kind(f2.m, c.peds, c.cyclists, c.coll_type)),
    'ca': (select count(*) from crash_all c where c.date >= f2.a_start and c.date < f2.a_start + f2.days and crash_kind(f2.m, c.peds, c.cyclists, c.coll_type)),
    -- An earlier stretch of the same length, before the "before" (the month between is skipped, as after a fix). The
    -- "before" can be high because it got the place picked; the earlier stretch had no part in that, so earlier against
    -- after is the fairer test. Needs crash data back that far (2011; these counts don't use severity, whose coding is
    -- thin before 2013).
    'pb': case when f2.b_end - 2 * f2.days - 30 >= date '2011-01-01' then (select count(*) from crash_all c where c.location = f2.location
            and c.date >= f2.b_end - 2 * f2.days - 30 and c.date < f2.b_end - f2.days - 30 and crash_kind(f2.m, c.peds, c.cyclists, c.coll_type)) end,
    'pcb': case when f2.b_end - 2 * f2.days - 30 >= date '2011-01-01' then (select count(*) from crash_all c
            where c.date >= f2.b_end - 2 * f2.days - 30 and c.date < f2.b_end - f2.days - 30 and crash_kind(f2.m, c.peds, c.cyclists, c.coll_type)) end,
    -- another dated fix at the same place from the earlier stretch to the end of the after period: its effect would be
    -- mixed in (a head-start walk signal next to a no turn on red, say), so the citywide summary leaves these out
    'other': exists (select 1 from dated_fixes o where o.location = f2.location and not (o.kind = f2.kind and o.d = f2.d)
                     and o.d >= f2.b_end - 2 * f2.days - 30 and o.d < f2.a_start + f2.days)
  } order by d, kind, m) as before_after
from f2 group by f2.location;

create or replace table locations as
select l.*, s.* exclude (location, circle_d, circle),
       case when s.circle then list_concat(coalesce(l.fixes, []),
              [{'k': 'Traffic circle', 'n': null::bigint, 'd': s.circle_d, 's': 'Built'}]) else l.fixes end as fixes2,
       a.* exclude (location), b.before_after
from locations l left join loc_street_ctx s using (location) left join loc_area_ctx a using (location)
left join before_after b using (location);
alter table locations drop column fixes;
alter table locations rename column fixes2 to fixes;
