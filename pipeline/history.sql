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
  select location, arg_max(addr_type, {'n': n, 't': addr_type}) as addr_type,
         sum(slon) / sum(n) as lon, sum(slat) / sum(n) as lat
  from (select location, addr_type, count(*) as n, sum(lon) as slon, sum(lat) as slat
        from crash_hist where lon is not null group by all)
  group by location)
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
            then power(wt('fatal_growth'), row_number() over (partition by p.id, f.location, f.severity = 'Fatal Collision' order by f.date, f.peds, f.cyclists) - 1)
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
-- One list, intersections and stretches together: the same rule as today's.
create or replace table hist_rank as
with s as (
  select e.id, e.location, e.crashes, e.ksi, e.expected_harm, coalesce(hp.addr_type, 'B') = 'I' as is_int,
    e.expected_harm * (1 + case when p.kind = 'month' then coalesce(r.request_boost, 0) else 0 end) as sc
  from hist_eb e join hist_periods p using (id) left join ranked r using (location)
  left join hist_places hp using (location)
)
select id, location, crashes, ksi, expected_harm,
  row_number() over (partition by id order by round(sc, 9) desc, crashes desc, location) as rk
from s;

-- Per place: rank on each 1 January, a month ago, and a year ago (for the place's detail panel and the list).
create or replace table place_history as
select h.location,
  list([p.yr, h.rk] order by p.yr) filter (where p.kind = 'year') as rank_years,
  any_value(h.rk) filter (where p.id = 'm1') as rank_month_ago,
  any_value(h.rk) filter (where p.id = 'm12') as rank_year_ago
from hist_rank h join hist_periods p using (id) group by h.location;

-- ---------------------------------------------------------------- (1) the worst places of each year: what happened since
-- Fixes with a date at each place: SDOT's dated fixes, new signals (the signal's install date) and finished projects nearby
-- (SDOT gives those a year only; counted as 1 July). One row per place, kind and date (some signals are listed twice).
-- Bus lanes are left out: they're mainly for buses, not crash safety.
create or replace table place_fixes as
select distinct location, k, d, year(d) as y from (
  select location, kind as k, d from dated_fixes
  where kind in ('Head-start walk signal', 'No turn on red', 'Protected left-turn signal', 'Traffic circle')
  union all
  select location, kind, d from loc_fix_hits where d is not null and status = 'Built' and kind <> 'Bus lane'
  union all
  -- the same signal date the place's page shows (so a "fix" here is always one a reader can see there)
  select location, 'Traffic signal installed or rebuilt', signal_installed
  from locations where addr_type = 'I' and signal_installed >= date '1990-01-01'
  union all
  select l.location, case j.kind when 'sidewalk' then 'New sidewalk' when 'safety' then 'Neighborhood safety project'
                                 else 'Head-start walk signal' end, make_date(j.year, 7, 1)
  from (select location, unnest(proj_ids) as id from locations) l join proj j using (id)
  where j.stage = 'done' and j.year is not null
);

-- The years "then" is compared with: the last 5 full calendar years whose crash reports are complete. The newest
-- months still have many crashes with severity not yet recorded, so they're left out of this comparison.
create or replace table cmp_window as
select make_date(year(w_end - interval 6 month)::int - 5, 1, 1) as c0, make_date(year(w_end - interval 6 month)::int, 1, 1) as c1
from scoring_window;

-- Fatal and serious crashes at places with a known location, any date range (the same rule for every period).
create or replace macro ksi_city(d0, d1) as (
  select count(*) from crash_full c join hist_places hp using (location)
  where hp.lat is not null and c.date >= d0 and c.date < d1 and c.severity in ('Fatal Collision', 'Serious Injury Collision'));

-- The worst 50 of each year, plus places ranked 51-150 the same year (a comparison group that was also bad, but less so).
-- Each place's fixes are grouped by when the first one came: during the ranked years, between them and the comparison
-- years, during the comparison years, or not until after them / none.
create or replace table worst_then as
with t as (
  select p.yr, h.location, h.rk, h.crashes, h.ksi, p.d0, p.d1
  from hist_rank h join hist_periods p using (id) where p.kind = 'year' and h.rk <= 150
),
f as (
  select t.yr, t.location, min(pf.d) as first_fix,
    list({'k': pf.k, 'y': pf.y} order by pf.d, pf.k) as fixes
  from t join place_fixes pf on pf.location = t.location and pf.d >= t.d0
  group by t.yr, t.location
)
select t.yr, t.rk as rank_then, t.location, t.crashes as crashes_then, t.ksi as ksi_then,
  r.rank as rank_now, r.state_route, r.structure,
  coalesce(r.lat, hp.lat) as lat, coalesce(r.lon, hp.lon) as lon, r.council_district as district,
  f.fixes,
  case when f.first_fix is null or f.first_fix >= w.c1 then 'none'
       when f.first_fix < t.d1 then 'then'
       when f.first_fix < w.c0 then 'between'
       else 'during' end as fix_group,
  (select count(*) from crash_full c where c.location = t.location and c.date >= w.c0 and c.date < w.c1
     and c.severity in ('Fatal Collision', 'Serious Injury Collision')) as ksi_cmp,
  (select count(*) from crash_full c where c.location = t.location and c.date >= w.c0 and c.date < w.c1) as crashes_cmp
from t cross join cmp_window w
left join f using (yr, location) left join ranked r using (location) left join hist_places hp using (location);

-- Citywide fatal and serious crashes in each ranked period and in the comparison years.
create or replace macro all_city(d0, d1) as (
  select count(*) from crash_full c join hist_places hp using (location) where hp.lat is not null and c.date >= d0 and c.date < d1);
create or replace table ksi_by_period as
select p.id, p.yr, p.d0, p.d1, ksi_city(p.d0, p.d1) as ksi, all_city(p.d0, p.d1) as crashes from hist_periods p where p.kind = 'year'
union all
select 'cmp', null, w.c0, w.c1, ksi_city(w.c0, w.c1), all_city(w.c0, w.c1) from cmp_window w;

-- ---------------------------------------------------------------- (2) what changed since last month
create or replace table month_change as
with m1 as (select location, rk from hist_rank where id = 'm1')
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

-- Fixes SDOT recorded in the 12 months before the data was fetched (dated fixes only, not year-only projects).
create or replace table recent_fixes as
select distinct f.location, f.k, f.d, r.rank, r.lat, r.lon
from place_fixes f join ranked r using (location)
where f.d >= (select max(date) from collisions) - interval 365 day and f.d <= current_date
  and f.k not in ('New sidewalk', 'Neighborhood safety project');

-- ---------------------------------------------------------------- (3) need and published work, by district and equity index
create or replace table proj_area as
select j.id, j.kind, j.stage, j.year,
  (select min(c.district) from council c where ST_Within(ST_Centroid(j.geom), c.geom)) as district,
  (select min(r.quintile) from rse r where ST_Within(ST_Centroid(j.geom), r.geom)) as rse_quintile
from proj j;

-- Places with no council district or equity-index tract are on the city limits (border streets, some bridges): grouped
-- as 'none' so the columns add up to the city totals.
create or replace table need_work as
with fx as (
  select location, count(*) filter (where k = 'Head-start walk signal') as lpi, count(*) filter (where k <> 'Head-start walk signal') as other
  from place_fixes where y >= year(ws()) group by location
),
places as (
  select r.location, coalesce(r.council_district::varchar, 'none') as district, coalesce(r.rse_quintile, 'none') as rse,
    r.ksi, r.rank, r.addr_type, r.lat, r.lon, r.rank <= 50 as top50, coalesce(fx.lpi, 0) as lpi, coalesce(fx.other, 0) as other,
    fx.location is not null as fixed_recently, r.proj_planned
  from ranked r left join fx using (location)
),
long as (
  select 'district' as dim, district as grp, * exclude (district, rse) from places
  union all select 'rse', rse, * exclude (district, rse) from places
),
by_g as (
  select dim, grp, sum(ksi) as ksi, sum(lpi) as fixes_lpi, sum(other) as fixes_other,
    count(*) filter (where top50) as top50,
    count(*) filter (where top50 and not fixed_recently and not proj_planned) as top50_nothing,
    list({'loc': location, 'r': rank, 't': addr_type, 'fixed': fixed_recently, 'planned': proj_planned} order by rank) filter (where top50) as top50_list
  from long group by dim, grp
),
proj_long as (
  select 'district' as dim, coalesce(district::varchar, 'none') as grp, * from proj_area
  union all select 'rse', coalesce(rse_quintile, 'none'), * from proj_area
),
proj_g as (select dim, grp, count(*) filter (where stage <> 'done') as proj_planned from proj_long group by dim, grp)
select b.*, coalesce(p.proj_planned, 0) as proj_planned
from by_g b full join proj_g p using (dim, grp);

-- ---------------------------------------------------------------- is it working?
-- Each dated fix, the crashes it's meant to reduce in equal periods before and after (context.sql: before_after), next
-- to the citywide change in that same kind of crash over the same days. Fixes go where crashes were high, and such places
-- tend to improve somewhat on their own, so a drop here isn't proof the fix worked; a place where the targeted crashes
-- didn't drop at all is worth a closer look.
create or replace table working_fix as
select x.location, x.district, r.rank, x.f.k as k, x.f.m as m, x.f.d as d, x.f.days as days,
       x.f.b as b, x.f.a as a, x.f.cb as cb, x.f.ca as ca, x.f.yo as yo
from (select location, council_district as district, unnest(before_after) as f from locations) x
left join ranked r using (location);

create or replace table working_kind as
select k, m, count(*) as n, count(*) filter (where b > 0) as n_had, sum(b) as b, sum(a) as a, sum(cb) as cb, sum(ca) as ca,
       count(*) filter (where b > 0 and a < b) as fewer, count(*) filter (where b > 0 and a >= b) as not_fewer,
       count(*) filter (where b = 0 and a > 0) as new_after
from working_fix group by k, m;

-- places where the targeted crashes didn't go down: at least 2 after, and no fewer than before
create or replace table working_places as
select * from working_fix where a >= 2 and a >= b
qualify row_number() over (partition by k order by a - b desc, a desc, rank nulls last, location) <= 40;

-- ---------------------------------------------------------------- export: site/data/progress.json
copy (
  select {
    'cmp': (select {'d0': c0, 'd1': c1, 'ksi_city': (select ksi from ksi_by_period where id = 'cmp'),
                    'crashes_city': (select crashes from ksi_by_period where id = 'cmp')} from cmp_window),
    'years': (select list({'yr': p.yr, 'd0': p.d0, 'd1': p.d1,
                'ksi_city': (select k.ksi from ksi_by_period k where k.id = p.id),
                'crashes_city': (select k.crashes from ksi_by_period k where k.id = p.id),
                'ref': (select {'n': count(*), 'ksi': sum(w.ksi_then), 'ksi_cmp': sum(w.ksi_cmp)} from worst_then w
                        where w.yr = p.yr and w.rank_then between 51 and 150),
                'places': (select list({'r': w.rank_then, 'loc': w.location, 'ksi': w.ksi_then, 'c': w.crashes_then,
                                        'now': w.rank_now, 'ksi_cmp': w.ksi_cmp, 'c_cmp': w.crashes_cmp, 'd': w.district,
                                        'state': w.state_route, 'g': w.fix_group, 'fx': w.fixes,
                                        't': coalesce((select hp.addr_type from hist_places hp where hp.location = w.location), 'B')} order by w.rank_then)
                           from worst_then w where w.yr = p.yr and w.rank_then <= 50)} order by p.yr)
              from hist_periods p, cmp_window cw where p.kind = 'year' and p.d1 <= cw.c0),
    'month': {
      'd_before': (select d1 from hist_periods where id = 'm1'),
      'd_now': (select d1 from hist_periods where id = 'm0'),
      'moves': (select list({'loc': location, 'now': rank_now, 'was': rank_before, 'in50': top50} order by rank_now)
                from month_change where top50 is not null or (rank_now <= 50 and rank_before - rank_now >= 5)
                  or (rank_before <= 50 and rank_now - rank_before >= 5)),
      'recent_ksi': (select list({'loc': location, 'f': fatal, 's': serious, 'last': last_date, 'rank': rank}
                                 order by fatal desc, serious desc, last_date desc, location) from recent_ksi),
      'recent_ksi_total': (select {'f': sum(fatal), 's': sum(serious), 'from': we(), 'to': max(last_date)} from recent_ksi),
      'recent_fixes': (select list({'loc': location, 'k': k, 'd': d, 'rank': rank} order by d desc, rank) from recent_fixes)
    },
    'need': (select list({'dim': dim, 'g': grp, 'ksi': ksi, 'top50': top50, 'top50_nothing': top50_nothing,
                          'lpi': fixes_lpi, 'other': fixes_other, 'proj_planned': proj_planned, 'list': top50_list}
                         order by dim, grp) from need_work),
    'working': {
      'kinds': (select list({'k': k, 'm': m, 'n': n, 'n_had': n_had, 'b': b, 'a': a, 'cb': cb, 'ca': ca,
                             'fewer': fewer, 'not_fewer': not_fewer, 'new_after': new_after} order by n desc, k) from working_kind),
      'places': (select list({'loc': location, 'k': k, 'm': m, 'd': d, 'yo': yo, 'days': days, 'b': b, 'a': a, 'rank': rank, 'dist': district}
                             order by k, a - b desc, a desc, rank nulls last, location) from working_places)
    },
    'since': year(ws()),
    'window': {'d0': ws(), 'd1': we()}
  } as progress
) to 'site/data/progress.json' (format json, array false);
