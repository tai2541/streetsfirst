-- Read by build.sql after the final ranking. The ranking at earlier dates, worked out again from the crash records, so the
-- site can show (1) whether the places that ranked worst years ago got a fix and how they're doing now, (2) what changed
-- since last month, and (3) where serious crashes happen compared with where SDOT's published work is, by council district
-- and by the City's equity index. Nothing here changes the current ranking.
--
-- Past rankings use the same expected-harm method on the 5 years of crashes before each date. Repair requests aren't
-- available that far back, so past ranks are by crashes alone. Monthly snapshots (for "what changed") add each place's
-- current request boost, so last month's list is directly comparable with today's.
-- Yearly snapshots start in 2018 (crashes 2013-2017): before 2013 SDOT's data records far fewer injury crashes.

-- Every crash since 2011, with today's place names.
create or replace table crash_full as
select location, date, severity, peds, cyclists from crash_hist where date < ws()
union all
select location, date, severity, peds, cyclists from collisions;

-- Places, including ones with crashes only in earlier years (no crashes in the current 5 years).
create or replace table hist_places as
with old as (
  select location, mode(addr_type) as addr_type, avg(lon) as lon, avg(lat) as lat
  from crash_hist where lon is not null group by location)
select coalesce(a.location, o.location) as location, coalesce(a.addr_type, o.addr_type) as addr_type,
       coalesce(a.lon, o.lon) as lon, coalesce(a.lat, o.lat) as lat,
       a.location is not null as current,
       coalesce(x.addr_class || ' / ' || x.street_bucket,
                case when coalesce(a.addr_type, o.addr_type) = 'I' then 'I' else 'B' end || ' / local') as ref_group
from locations_all a full join old o using (location)
left join loc_context x on x.location = coalesce(a.location, o.location);

-- The dates: 1 January of each year (5 full years before it), and the end of each of the last 12 scored months.
create or replace table hist_periods as
select 'y' || y as id, 'year' as kind, y::int as yr, null::int as months_ago,
       make_date(y::int - 5, 1, 1) as d0, make_date(y::int, 1, 1) as d1
from scoring_window s, range(2018, 2101) t(y) where make_date(y::int, 1, 1) <= s.w_end
union all
select 'm' || k, 'month', null, k::int, (s.w_end - to_months(60 + k::int))::date, (s.w_end - to_months(k::int))::date
from scoring_window s, range(0, 13) t(k);

-- Expected harm per place for every period at once (the same formula as eb_in in build.sql).
create or replace table hist_eb as
with c as (
  select p.id, f.location, f.date,
    f.severity in ('Fatal Collision', 'Serious Injury Collision') as is_ksi,
    f.severity = 'Unknown' as unk,
    (case f.severity
       when 'Fatal Collision'                then wt('ksi')
       when 'Serious Injury Collision'       then wt('ksi')
       when 'Injury Collision'               then wt('injury')
       when 'Property Damage Only Collision' then wt('pdo')
       else 0 end)
    * (case when f.peds + f.cyclists > 0 and f.severity in ('Fatal Collision', 'Serious Injury Collision', 'Injury Collision')
            then wt('ped_bike_mult') else 1 end)
    * (case when f.severity = 'Fatal Collision'
            then power(wt('fatal_growth'), row_number() over (partition by p.id, f.location, f.severity = 'Fatal Collision' order by f.date) - 1)
            else 1 end) as pts
  from crash_full f join hist_periods p on f.date >= p.d0 and f.date < p.d1
),
h as (
  select c.id, c.location, count(*) as crashes, count(*) filter (where is_ksi) as ksi, count(*) filter (where unk) as unknown_sev,
         sum(pts) as harm, coalesce(sum(pts) filter (where is_ksi), 0) as ksi_harm, any_value(hp.ref_group) as ref_group
  from c join hist_places hp using (location) group by c.id, c.location
),
g as (
  select id, ref_group, sum(ksi_harm) / sum(crashes) as kpc, sum(harm - ksi_harm) / nullif(sum(crashes - unknown_sev), 0) as opk
  from h group by id, ref_group
)
select h.id, h.location, h.crashes, h.ksi,
  (h.harm - h.ksi_harm)
    + h.crashes / (h.crashes + wt('ksi_prior_crashes')) * h.ksi_harm
    + wt('ksi_prior_crashes') / (h.crashes + wt('ksi_prior_crashes')) * h.crashes * g.kpc
    + h.unknown_sev * coalesce(g.opk, 0) as expected_harm
from h join g using (id, ref_group);

-- Ranks. Yearly: crashes alone. Monthly: with each place's current request boost (m0 is then exactly today's ranking).
create or replace table hist_rank as
select e.id, e.location, e.crashes, e.ksi, e.expected_harm,
  row_number() over (partition by e.id order by
    e.expected_harm * (1 + case when p.kind = 'month' then coalesce(r.request_boost, 0) else 0 end) desc,
    e.crashes desc, e.location) as rk
from hist_eb e join hist_periods p using (id) left join ranked r using (location);

-- Per place: rank on each 1 January, a month ago, and a year ago (for the place's detail panel and the list).
create or replace table place_history as
select h.location,
  list([p.yr, h.rk] order by p.yr) filter (where p.kind = 'year') as rank_years,
  any_value(h.rk) filter (where p.id = 'm1') as rank_month_ago,
  any_value(h.rk) filter (where p.id = 'm12') as rank_year_ago
from hist_rank h join hist_periods p using (id) group by h.location;

-- ---------------------------------------------------------------- (1) the worst places of each year: what happened since
-- Fixes with a date, at every place (today's crash places from dated_fixes) and finished projects with a year nearby.
-- Bus lanes are left out: they're mainly for buses, not crash safety. New signals: the signal's install date.
create or replace table place_fixes as
select location, kind as k, d, null::int as y from dated_fixes
where kind in ('Head-start walk signal', 'Protected left-turn signal', 'Traffic circle')
union all
select distinct location, kind, d, null from loc_fix_hits where d is not null and status = 'Built' and kind <> 'Bus lane'
union all
select l.location, 'New traffic signal', g.installed, null
from locations_all l join signals g on g.intkey = l.intkey
where l.addr_type = 'I' and g.installed >= date '1990-01-01'
union all
select l.location, case j.kind when 'sidewalk' then 'New sidewalk' when 'safety' then 'Neighborhood safety project'
                               else 'Head-start walk signal' end, null, j.year
from (select location, unnest(proj_ids) as id from locations) l join proj j using (id)
where j.stage = 'done' and j.year is not null;

create or replace table worst_then as
with t as (
  select p.yr, h.location, h.rk, h.crashes, h.ksi, p.d0, p.d1
  from hist_rank h join hist_periods p using (id) where p.kind = 'year' and h.rk <= 50
)
select t.yr, t.rk as rank_then, t.location, t.crashes as crashes_then, t.ksi as ksi_then,
  r.rank as rank_now, r.crashes as crashes_now, r.ksi as ksi_now,
  coalesce(r.lat, hp.lat) as lat, coalesce(r.lon, hp.lon) as lon,
  coalesce(r.council_district, null) as district,
  (select list({'k': f.k, 'y': coalesce(year(f.d), f.y)} order by coalesce(year(f.d), f.y))
     from place_fixes f where f.location = t.location and coalesce(year(f.d), f.y) >= t.yr) as fixes_since,
  -- the same kind of comparison for the place's 5 years before the ranking and its most recent 5 years
  (select count(*) from crash_full c where c.location = t.location and c.date >= ws() and c.date < we()
     and c.severity in ('Fatal Collision', 'Serious Injury Collision')) as ksi_recent
from t left join ranked r using (location) left join hist_places hp using (location);

-- Citywide fatal and serious crashes in each yearly window and the current one, so a place's change can be read
-- against the city's.
create or replace table ksi_by_period as
select p.id, p.yr, p.d0, p.d1,
  (select count(*) from crash_full c where c.date >= p.d0 and c.date < p.d1
     and c.severity in ('Fatal Collision', 'Serious Injury Collision')) as ksi
from hist_periods p
union all
select 'now', null, ws(), we(),
  (select count(*) from crash_full c where c.date >= ws() and c.date < we()
     and c.severity in ('Fatal Collision', 'Serious Injury Collision'));

-- ---------------------------------------------------------------- (2) what changed since last month
create or replace table month_change as
with m0 as (select location, rk from hist_rank where id = 'm0'),
     m1 as (select location, rk from hist_rank where id = 'm1')
select r.location, r.rank as rank_now, m1.rk as rank_before, r.crashes, r.ksi, r.lat, r.lon,
  case when r.rank <= 50 and coalesce(m1.rk, 1e9) > 50 then 'in'
       when r.rank > 50 and m1.rk <= 50 then 'out' end as top50
from ranked r left join m1 using (location)
where r.rank <= 200 or m1.rk <= 50;

-- Newest crash records, not in the ranking yet: the months after the scored window.
create or replace table recent_ksi as
select c.location, count(*) filter (where c.severity = 'Fatal Collision') as fatal,
       count(*) filter (where c.severity = 'Serious Injury Collision') as serious,
       max(c.date) as last_date, any_value(r.rank) as rank, any_value(r.lat) as lat, any_value(r.lon) as lon
from collisions c left join ranked r using (location)
where c.date >= we() and c.severity in ('Fatal Collision', 'Serious Injury Collision')
group by c.location;

-- Fixes SDOT recorded in the last 12 months of fix data (dated fixes only: projects carry just a year).
create or replace table recent_fixes as
select distinct f.location, f.k, f.d, r.rank, r.lat, r.lon
from place_fixes f join ranked r using (location)
where f.d >= current_date - interval 365 day and f.d <= current_date;

-- ---------------------------------------------------------------- (3) need and published work, by district and equity index
create or replace table proj_area as
select j.id, j.kind, j.stage, j.year,
  (select c.district from council c where ST_Within(ST_Centroid(j.geom), c.geom) limit 1) as district,
  (select r.quintile from rse r where ST_Within(ST_Centroid(j.geom), r.geom) limit 1) as rse_quintile
from proj j;

create or replace table need_work as
with places as (
  select r.location, r.council_district as district, r.rse_quintile, r.ksi, r.killed, r.rank,
    r.rank <= 50 as top50,
    exists (select 1 from place_fixes f where f.location = r.location and coalesce(year(f.d), f.y) >= year(ws())) as fixed_recently,
    r.proj_planned
  from ranked r
),
fx as (select f.location, count(*) as n from place_fixes f where coalesce(year(f.d), f.y) >= year(ws()) group by f.location),
by_d as (
  select 'district' as dim, district::varchar as grp,
    sum(ksi) as ksi, sum(killed) as killed, count(*) filter (where top50) as top50,
    count(*) filter (where top50 and not fixed_recently and not proj_planned) as top50_nothing
  from places where district is not null group by district
  union all
  select 'rse', rse_quintile, sum(ksi), sum(killed), count(*) filter (where top50),
    count(*) filter (where top50 and not fixed_recently and not proj_planned)
  from places where rse_quintile is not null group by rse_quintile
),
fixes_d as (
  select 'district' as dim, r.council_district::varchar as grp, sum(fx.n) as fixes
  from fx join ranked r using (location) where r.council_district is not null group by 2
  union all
  select 'rse', r.rse_quintile, sum(fx.n) from fx join ranked r using (location) where r.rse_quintile is not null group by 2
),
proj_d as (
  select 'district' as dim, district::varchar as grp,
    count(*) filter (where stage = 'done' and coalesce(year, 0) >= year(ws())) as proj_done,
    count(*) filter (where stage <> 'done') as proj_planned
  from proj_area where district is not null group by district
  union all
  select 'rse', rse_quintile, count(*) filter (where stage = 'done' and coalesce(year, 0) >= year(ws())),
    count(*) filter (where stage <> 'done')
  from proj_area where rse_quintile is not null group by rse_quintile
)
select b.*, coalesce(f.fixes, 0) as fixes, coalesce(p.proj_done, 0) as proj_done, coalesce(p.proj_planned, 0) as proj_planned
from by_d b left join fixes_d f using (dim, grp) left join proj_d p using (dim, grp);

-- ---------------------------------------------------------------- export: site/data/progress.json
copy (
  select {
    'years': (select list({'yr': p.yr, 'd0': p.d0, 'd1': p.d1,
                'ksi_city': (select k.ksi from ksi_by_period k where k.id = p.id),
                'places': (select list({'r': w.rank_then, 'loc': w.location, 'ksi': w.ksi_then, 'c': w.crashes_then,
                                        'now': w.rank_now, 'ksi_now': w.ksi_recent, 'd': w.district,
                                        'lat': round(w.lat, 5), 'lon': round(w.lon, 5), 'fx': w.fixes_since} order by w.rank_then)
                           from worst_then w where w.yr = p.yr)} order by p.yr)
              from hist_periods p where p.kind = 'year' and p.yr < year(we())),
    'now': (select {'d0': d0, 'd1': d1, 'ksi_city': ksi} from ksi_by_period where id = 'now'),
    'month': {
      'd_before': (select d1 from hist_periods where id = 'm1'),
      'd_now': (select d1 from hist_periods where id = 'm0'),
      'moves': (select list({'loc': location, 'now': rank_now, 'was': rank_before, 'in50': top50,
                             'lat': round(lat, 5), 'lon': round(lon, 5)} order by rank_now)
                from month_change where top50 is not null or (rank_now <= 50 and rank_before - rank_now >= 5)
                  or (rank_before <= 50 and rank_now - rank_before >= 5)),
      'recent_ksi': (select list({'loc': location, 'f': fatal, 's': serious, 'last': last_date, 'rank': rank,
                                  'lat': round(lat, 5), 'lon': round(lon, 5)} order by fatal desc, serious desc, last_date desc)
                     from recent_ksi where lat is not null),
      'recent_ksi_total': (select {'f': sum(fatal), 's': sum(serious), 'from': we(), 'to': max(last_date)} from recent_ksi),
      'recent_fixes': (select list({'loc': location, 'k': k, 'd': d, 'rank': rank, 'lat': round(lat, 5), 'lon': round(lon, 5)}
                                   order by d desc, rank) from recent_fixes)
    },
    'need': (select list({'dim': dim, 'g': grp, 'ksi': ksi, 'killed': killed, 'top50': top50, 'top50_nothing': top50_nothing,
                          'fixes': fixes, 'proj_done': proj_done, 'proj_planned': proj_planned} order by dim, grp) from need_work),
    'since': year(ws())
  } as progress
) to 'site/data/progress.json' (format json, array false);
