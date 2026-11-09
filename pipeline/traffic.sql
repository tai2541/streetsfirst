-- Read by build.sql after `locations` exists. Adds, for each location:
--   * more things SDOT has built there (speed humps/cushions, radar signs, protected bike lanes, bus lanes)
--   * traffic over the years (SDOT counts 2015 onward), buses a weekday, and rush-hour bus slowdown
-- and exports the city-wide traffic layers for the Traffic view (site/data/traffic.json).
-- None of this changes the safety ranking.

-- ---------------------------------------------------------------- fixes SDOT has built
-- Status from SDOT: in service = Built, PLANNED = Planned; signs temporarily out of service are left out.
create or replace table fix_points as
select kind, segkey, case when st = 'PLANNED' then 'Planned' else 'Built' end as status, d, geom from (
  select 'Speed humps' as kind, f.properties.SEGKEY as segkey, f.properties.CURRENT_STATUS as st,
         to_timestamp(f.properties.INSTALL_DATE::double / 1000)::date as d, gj_geom(f.geometry) as geom
  from (select unnest(features) f from read_json('data/raw/humps_*.json', maximum_object_size = 50000000)) where f.geometry is not null
  union all
  select 'Speed cushions', f.properties.SEGKEY, f.properties.CURRENT_STATUS,
         to_timestamp(f.properties.INSTALL_DATE::double / 1000)::date, gj_geom(f.geometry)
  from (select unnest(features) f from read_json('data/raw/cushions_*.json', maximum_object_size = 50000000)) where f.geometry is not null
  union all
  select 'Radar speed sign', f.properties.SEGKEY, f.properties.CURRENT_STATUS, null::date, gj_geom(f.geometry)
  from (select unnest(features) f from read_json('data/raw/radar_*.json', maximum_object_size = 50000000)) where f.geometry is not null
) x
where coalesce(st, 'INSVC') not in ('TEMPOUTSVC', 'REMOVED', 'RETIRED');

create or replace table fix_lines as
select 'Protected bike lane' as kind,
       to_timestamp(f.properties.DATE_COMPLETED::double / 1000)::date as d,
       case f.properties.STATUS when 'CONST' then 'Under construction' else 'Built' end as status,
       gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/bikelanes_*.json', maximum_object_size = 50000000)) where f.geometry is not null
union all
select 'Bus lane', to_timestamp(f.properties.InstallationDate::double / 1000)::date,
       case f.properties.Status when 'Planned' then 'Planned' else 'Built' end, gj_geom(f.geometry)
from (select unnest(features) f from read_json('data/raw/buslanes_*.json', maximum_object_size = 50000000))
where f.geometry is not null and f.properties.RemovalDate is null;

-- Points (humps, cushions, radar signs) belong to the street block they're on (SDOT's segment key);
-- at intersections, anything within 100 ft. Lanes count when they pass within the spot's radius.
-- Every match, with its own install date (dates before 1990 are placeholders in SDOT's data). Kept for the history view.
create or replace table loc_fix_hits as
select location, kind, case when d >= date '1990-01-01' then d end as d, status from (
  select a.location, fp.kind, fp.d, fp.status
  from locations_all a join streets s on s.loc_name = a.location join fix_points fp on fp.segkey = s.compkey
  where a.addr_type <> 'I'
  union all
  select p.location, fp.kind, fp.d, fp.status
  from loc_pts p join locations_all a using (location) join fix_points fp on ST_DWithin(p.geom, fp.geom, 100)
  where a.addr_type = 'I'
  union all
  select p.location, fl.kind, fl.d, fl.status
  from loc_pts p join fix_lines fl on ST_DWithin(p.geom, fl.geom, p.r)
);

create or replace table loc_fixes as
select location, list({'k': kind, 'n': case when kind in ('Speed humps', 'Speed cushions', 'Radar speed sign') then n end,
                       'd': d, 's': status} order by kind, status) as fixes
from (select location, kind, status, count(*) as n, min(d) as d from loc_fix_hits group by all)
group by location;

-- ---------------------------------------------------------------- traffic over the years
-- One SDOT count layer per year; field names changed in 2017 (FIRST_STNAME_ORD/COUNTAAWDT before).
-- Each year's layer re-publishes older counts for streets that weren't recounted (in 2022 only ~125 of
-- 1,930 segments were new), so the year used is the count's own date, and undated records are dropped.
create or replace table volhist as
select distinct
       year(to_timestamp(coalesce(f->'properties'->>'START_DATE', f->'properties'->>'COUNTSTART')::double / 1000)) as yr,
       coalesce(f->'properties'->>'STNAME_ORD', f->'properties'->>'FIRST_STNAME_ORD') as street,
       nullif(try_cast(coalesce(f->'properties'->>'AWDT', f->'properties'->>'COUNTAAWDT') as double), 0) as awdt,
       ST_Transform(ST_GeomFromGeoJSON((f->'geometry')::varchar), 'EPSG:4326', 'EPSG:2926') as geom
from (select filename, unnest(features) as f
      from read_json('data/raw/volhist_*.json', columns = {'features': 'JSON[]'}, filename = true, maximum_object_size = 50000000))
where json_type(f->'geometry') = 'OBJECT'
  and coalesce(f->'properties'->>'START_DATE', f->'properties'->>'COUNTSTART') is not null;

-- one row per street name (some counts list two streets), split-roadway names normalized like loc_names
create or replace table volhist_named as
select yr, road_norm(trim(unnest(string_split(street, ',')))) as street, awdt, geom from volhist where street is not null;

-- Per street at the spot: every real count on that street within 300 ft, the nearest one per count year.
-- Kept per street, not added up at intersections: cross streets are counted in different years.
create or replace table loc_volhist as
with nearest as (
  select n.location, n.name, v.yr, arg_min(v.awdt, {'d': ST_Distance(p.geom, v.geom), 'a': v.awdt})::int as v
  from loc_names n join loc_pts p using (location)
  join volhist_named v on v.street = n.name and v.awdt is not null and ST_DWithin(p.geom, v.geom, 300)
  group by all
)
select location, list({'s': name, 'y': yr, 'v': v} order by name, yr) as vol_history
from nearest group by location;

-- ---------------------------------------------------------------- buses
create or replace table busvol as
select f.properties.FULLNAME_L as street, f.properties.DAILY_TRIP_CNT as trips, f.properties.ROUTES_SERVICE as routes,
       gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/busvol_*.json', maximum_object_size = 50000000))
where f.geometry is not null and f.properties.DAILY_TRIP_CNT > 0;

create or replace table loc_bus as
with near as (
  select p.location, b.street, max(b.trips) as trips, arg_max(b.routes, {'t': b.trips, 'r': b.routes}) as routes
  from loc_pts p join busvol b on ST_DWithin(p.geom, b.geom, p.r) group by all
)
select location, sum(trips)::int as bus_trips,
       list_sort(list_distinct(flatten(list(string_split(routes, ', '))))) as bus_routes
from near group by location;

-- ---------------------------------------------------------------- rush-hour bus slowdown (Metro timetable)
-- Metro sets each trip's scheduled time between "timed" stops from how long buses really take at that hour.
-- For each stretch between two timed stops on a typical weekday: the quickest hourly median run time
-- (light traffic) vs the slowest one in the rush hours (7-9 am, 3-6 pm). Includes extra boarding time
-- at busy hours, not only traffic. Stretches run between timed stops (usually 1/2 to 1 1/2 miles); only those inside Seattle are kept.
create or replace macro secs(t) as split_part(t, ':', 1)::int * 3600 + split_part(t, ':', 2)::int * 60 + split_part(t, ':', 3)::int;
create or replace table gtfs_cal as select * from read_csv('data/raw/gtfs/calendar.txt', all_varchar = true);
create or replace table gtfs_cd as select * from read_csv('data/raw/gtfs/calendar_dates.txt', all_varchar = true);
-- The Wednesday in the next 90 days with the most bus trips, after Metro's holiday exceptions
-- (so a holiday or reduced-service day is never picked).
create or replace table gtfs_trips_all as select * from read_csv('data/raw/gtfs/trips.txt', all_varchar = true);
create or replace table gtfs_day as
with wed as (select strftime(x, '%Y%m%d') as d
             from (select unnest(generate_series(current_date::timestamp, current_date::timestamp + interval 90 day, interval 1 day)) as x)
             where dayofweek(x) = 3),
svc as (
  (select w.d, c.service_id from wed w join gtfs_cal c on c.wednesday = '1' and c.start_date <= w.d and c.end_date >= w.d
   union select w.d, x.service_id from wed w join gtfs_cd x on x.date = w.d and x.exception_type = '1')
  except select w.d, x.service_id from wed w join gtfs_cd x on x.date = w.d and x.exception_type = '2')
select d from svc join gtfs_trips_all t using (service_id)
group by d order by count(*) desc, d limit 1;
create or replace table gtfs_svc as
(select service_id from gtfs_cal, gtfs_day where wednesday = '1' and start_date <= gtfs_day.d and end_date >= gtfs_day.d
 union select service_id from gtfs_cd, gtfs_day where date = gtfs_day.d and exception_type = '1')
except select service_id from gtfs_cd, gtfs_day where date = gtfs_day.d and exception_type = '2';
create or replace table gtfs_trips as
select t.* from gtfs_trips_all t join gtfs_svc using (service_id);
create or replace table gtfs_tp as
select s.trip_id, t.route_id, t.shape_id, s.stop_id, s.stop_sequence::int as sq, s.shape_dist_traveled::double as d,
       secs(s.arrival_time) as arr, secs(s.departure_time) as dep
from read_csv('data/raw/gtfs/stop_times.txt', all_varchar = true) s join gtfs_trips t using (trip_id)
where s.timepoint = '1';
create or replace table gtfs_legs as
select * from (
  select trip_id, route_id, shape_id, lag(stop_id) over w as a, stop_id as b,
         lag(d) over w as d0, d as d1, lag(dep) over w as t0, arr as t1
  from gtfs_tp window w as (partition by trip_id order by sq)
) where a is not null and t1 > t0;

create or replace table gtfs_stops as
select stop_id, stop_name, stop_lat::double as lat, stop_lon::double as lon
from read_csv('data/raw/gtfs/stops.txt', all_varchar = true);
create or replace table gtfs_routes as
select route_id, route_short_name from read_csv('data/raw/gtfs/routes.txt', all_varchar = true);

-- Geometry of each stretch: the route shape between the two stops' distances along it, from the shape
-- of one of the trips that run it.
create or replace table gtfs_shape_pts as
select shape_id, shape_pt_sequence::int as sq, shape_dist_traveled::double as d,
       ST_Point(shape_pt_lon::double, shape_pt_lat::double) as pt
from read_csv('data/raw/gtfs/shapes.txt', all_varchar = true);

create or replace table city_area as
select ST_Union_Agg(gj_geom(f.geometry)) as geom
from (select unnest(features) f from read_json('data/raw/districts_*.json', maximum_object_size = 50000000));

create or replace table bus_stretch as
-- Timetables are in whole minutes, so use each hour's average over its trips (rounding differs trip to trip and
-- mostly cancels), and the light-traffic baseline is the average of the two quickest hours (one is pulled low by noise).
with h as (select a, b, t0 // 3600 as hr, avg(t1 - t0) as med, count(*) as n from gtfs_legs group by a, b, hr),
base as (select a, b, avg(med) as base from (select a, b, med, row_number() over (partition by a, b order by med) as k from h where n >= 2) where k <= 2 group by a, b),
peak as (select a, b, arg_max(hr, {'m': med, 'h': -hr}) as peak_hr, max(med) as peak from h where n >= 2 and hr in (7, 8, 15, 16, 17) group by a, b),
tot as (select l.a, l.b, count(*) as trips, sum(greatest(0, (l.t1 - l.t0) - base.base)) / 60.0 as lost_min,
               list_sort(list_distinct(list(r.route_short_name))) as routes,
               min({'shape_id': l.shape_id, 'd0': l.d0, 'd1': l.d1}) as pick   -- the same shape every build
        from gtfs_legs l join base using (a, b) join gtfs_routes r using (route_id) group by l.a, l.b),
geo as (select t.a, t.b, ST_MakeLine(list(sp.pt order by sp.sq)) as line
        from tot t join gtfs_shape_pts sp on sp.shape_id = t.pick.shape_id and sp.d between t.pick.d0 and t.pick.d1
        group by t.a, t.b having count(*) >= 2)
select row_number() over (order by tot.lost_min desc, a, b) as id, a, b,
       sa.stop_name as from_stop, sb.stop_name as to_stop,
       base / 60.0 as base_min, peak / 60.0 as peak_min, peak_hr,
       (peak - base) * 1.0 / base as slower,
       trips, lost_min, ST_Length(ST_Transform(geo.line, 'EPSG:4326', 'EPSG:2926')) / 5280 as miles, routes,
       ST_Transform(geo.line, 'EPSG:4326', 'EPSG:2926') as geom, geo.line as line_ll
from base join peak using (a, b) join tot using (a, b) join geo using (a, b)
join gtfs_stops sa on sa.stop_id = a join gtfs_stops sb on sb.stop_id = b
where ST_Within(ST_Centroid(ST_Transform(geo.line, 'EPSG:4326', 'EPSG:2926')), (select geom from city_area));

-- per mile, so long stretches don't win just for being long; short stretches are too coarse to trust
create or replace table bus_stretch as
select *, case when miles >= 0.25 then lost_min / miles end as lost_per_mile from bus_stretch;
create or replace table bus_stretch as
select *, case when lost_per_mile is not null then row_number() over (partition by lost_per_mile is null order by lost_per_mile desc, id) end as rank_bus
from bus_stretch;

-- The stretch through each spot that loses buses the most time (if any passes within its radius).
create or replace table loc_bus_stretch as
select p.location, arg_max(s.id, {'l': s.lost_per_mile, 'i': -s.id}) as bus_stretch_id
from loc_pts p join bus_stretch s on ST_DWithin(p.geom, s.geom, p.r)
where s.lost_per_mile is not null group by p.location;

-- ---------------------------------------------------------------- busiest streets (today's count segments)
-- Each current count segment with its history: the same street's count nearest its middle each year.
create or replace table count_segments as
select row_number() over (order by awdt desc, street) as id, * from (
  -- SDOT splits one count across several map segments: merge pieces of the same street with the same count
  select street, awdt::int as awdt, count_year, quality = 'Estimate' as estimated, ST_Union_Agg(geom) as geom
  from volumes where awdt is not null
  group by street, awdt, count_year, quality = 'Estimate'
);
create or replace table count_seg_history as
with m as (select id, street, ST_PointOnSurface(geom) as mid from count_segments),
near as (select m.id, v.yr, arg_min(v.awdt, {'d': ST_Distance(m.mid, v.geom), 'a': v.awdt}) as v
         from m join volhist v on v.street = m.street and v.awdt is not null and ST_DWithin(m.mid, v.geom, 150)
         group by all)
select id, list({'y': yr, 'v': v::int} order by yr) as history from near group by id;

-- Neighborhood at the middle of each counted segment, so two segments of the same street can be told apart.
create or replace table count_seg_hood as
select c.id, arg_min(h.neighborhood, {'d': ST_Distance(ST_PointOnSurface(c.geom), h.geom), 'n': h.neighborhood}) as hood
from count_segments c join hoods h on ST_DWithin(ST_PointOnSurface(c.geom), h.geom, 300)
group by c.id;

-- ---------------------------------------------------------------- add to locations
create or replace table locations as
select l.*, f.fixes, h.vol_history, b.bus_trips, b.bus_routes, bs.bus_stretch_id
from locations l
left join loc_fixes f using (location) left join loc_volhist h using (location)
left join loc_bus b using (location) left join loc_bus_stretch bs using (location);

-- ---------------------------------------------------------------- export for the Traffic view
copy (
  select {
    'weekday': (select strptime(d, '%Y%m%d')::date from gtfs_day),
    'stretches': (select list({
        'id': id, 'from': from_stop, 'to': to_stop, 'base': round(base_min, 1), 'peak': round(peak_min, 1),
        'hr': peak_hr, 'slower': round(slower, 3), 'trips': trips, 'lost': round(lost_min), 'mi': round(miles, 2),
        'lpm': round(lost_per_mile), 'rank': rank_bus, 'routes': routes,
        'pts': [[round(ST_Y(x.geom), 5), round(ST_X(x.geom), 5)] for x in ST_Dump(ST_Points(ST_SimplifyPreserveTopology(line_ll, 0.00005)))]
      } order by id) from bus_stretch where lost_per_mile is not null),
    'segments': (select list({
        'id': c.id, 'street': c.street, 'awdt': c.awdt, 'yr': c.count_year, 'est': c.estimated, 'hist': h.history, 'hood': nh.hood,
        'pts': [[[round(ST_Y(x.geom), 5), round(ST_X(x.geom), 5)] for x in ST_Dump(ST_Points(part.geom))]
                for part in ST_Dump(ST_LineMerge(ST_SimplifyPreserveTopology(ST_Transform(c.geom, 'EPSG:2926', 'EPSG:4326'), 0.00005)))]
      } order by c.id) from count_segments c left join count_seg_history h using (id) left join count_seg_hood nh using (id))
  } as traffic
) to 'site/data/traffic.json' (format json, array false);
