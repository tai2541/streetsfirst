-- Read by build.sql after the final ranking. The ranking at earlier dates, worked out again from the crash records, so the
-- site can show (1) whether the places that ranked worst years ago got a fix and how they're doing now, (2) what changed
-- since last month, and (3) where serious crashes happen compared with where SDOT's published work is, by council district
-- and by the City's equity index. Nothing here changes the current ranking.
--
-- Past rankings use the same expected-harm method on the 5 years of crashes before each date. Repair requests aren't
-- available that far back, so past ranks are by crashes alone, like today's (requests don't change scores). The monthly
-- snapshots (for "what changed") keep the request term, now zero, so last month's list is comparable with today's.
-- Yearly snapshots start in hist_from_year() (its crash years are the window_years() before it): in the oldest years
-- SDOT's data records far fewer injury crashes.

-- Every crash on hand (from hist_start()), with today's place names.
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

-- The dates: 1 January of each year (window_years() full years before it), and the end of each of the last 12 scored months.
create or replace table hist_periods as
select 'y' || y as id, 'year' as kind, y::int as yr, null::int as months_ago,
       make_date(y::int - window_years(), 1, 1) as d0, make_date(y::int, 1, 1) as d1
from scoring_window s, range(hist_from_year(), year(current_date)::int + 2) t(y) where make_date(y::int, 1, 1) <= s.w_end
union all
select 'm' || k, 'month', null, k::int, (s.w_end - to_months(window_months() + k::int))::date, (s.w_end - to_months(k::int))::date
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

-- Ranks. Yearly: crashes alone. Monthly: with each place's current request boost, now always zero (m0 is today's ranking).
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
  from locations where addr_type = 'I' and signal_installed >= signal_from()
  union all
  select l.location, case j.kind when 'sidewalk' then 'New sidewalk' when 'safety' then 'Neighborhood safety project'
                                 else 'Head-start walk signal' end, make_date(j.year, 7, 1)
  from (select location, unnest(proj_ids) as id from locations) l join proj j using (id)
  where j.stage = 'done' and j.year is not null
) where d <= current_date   -- a finished project's assumed mid-year date can't be in the future
     or (month(d) = 12 and day(d) >= 30 and year(d) = year(current_date));   -- SDOT's year-only date for something built this year

-- The years "then" is compared with: the last window_years() full calendar years whose crash reports are complete. The newest
-- months still have many crashes with severity not yet recorded, so they're left out of this comparison.
create or replace table cmp_window as
select make_date(year(w_end - to_months(cmp_lag_months()))::int - window_years(), 1, 1) as c0,
       make_date(year(w_end - to_months(cmp_lag_months()))::int, 1, 1) as c1
from scoring_window;

-- Fatal and serious crashes at places with a known location, any date range (the same rule for every period).
create or replace macro ksi_city(d0, d1) as (
  select count(*) from crash_full c join hist_places hp using (location)
  where hp.lat is not null and c.date >= d0 and c.date < d1 and c.severity in ('Fatal Collision', 'Serious Injury Collision'));

-- The worst worst_n() of each year, plus places ranked just below them, to worst_ref_to(), the same year (a comparison group that was also bad, but less so).
-- Each place's fixes are grouped by when the first one came: during the ranked years, between them and the comparison
-- years, during the comparison years, or not until after them / none.
create or replace table worst_then as
with t as (
  select p.yr, h.location, h.rk, h.crashes, h.ksi, p.d0, p.d1
  from hist_rank h join hist_periods p using (id) where p.kind = 'year' and h.rk <= worst_ref_to()
),
f as (
  select t.yr, t.location, min(pf.d) as first_fix,
    list({'k': pf.k, 'y': pf.y} order by pf.d, pf.k) as fixes
  from t join place_fixes pf on pf.location = t.location and pf.d >= t.d0
  group by t.yr, t.location
)
select t.yr, t.rk as rank_then, t.location, t.crashes as crashes_then, t.ksi as ksi_then,
  r.rank_noboost as rank_now, r.state_route, r.structure,   -- rank today on crashes only, like the past years beside it
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
  case when r.rank <= top_n() and coalesce(m1.rk, 1e9) > top_n() then 'in'
       when r.rank > top_n() and m1.rk <= top_n() then 'out' end as top50
from ranked r left join m1 using (location)
where r.rank <= list_n() or m1.rk <= top_n();

-- Newest crash records, not in the ranking yet: the months after the scored window.
create or replace table recent_ksi as
select c.location, count(*) filter (where c.severity = 'Fatal Collision') as fatal, sum(c.fatalities) as killed,
       count(*) filter (where c.severity = 'Serious Injury Collision') as serious,
       max(c.date) as last_date, any_value(r.rank) as rank, any_value(r.lat) as lat, any_value(r.lon) as lon
from collisions c left join ranked r using (location)
where c.date >= we() and c.severity in ('Fatal Collision', 'Serious Injury Collision')
group by c.location;

-- Fixes SDOT recorded in the recent_fix_days() before the data was fetched (dated fixes only, not year-only projects).
create or replace table recent_fixes as
select distinct f.location, f.k, f.d, r.rank, r.lat, r.lon
from place_fixes f join ranked r using (location)
where f.d >= (select max(date) from collisions) - to_days(recent_fix_days())
  and (f.d <= current_date or (month(f.d) = 12 and day(f.d) >= 30 and year(f.d) = year(current_date)))
  and f.k not in ('New sidewalk', 'Neighborhood safety project');

-- ---------------------------------------------------------------- (3) need and published work, by district and equity index
-- SDOT's projects, plus planned no turn on red signs (published in their own layer; each place's page counts them as planned)
create or replace table proj_area as
with j as (select id::varchar as id, kind, stage, year, geom from proj
           union all select null, 'ntor', 'planned', try_cast(planned_year as int), geom from ntor where status = 'Planned' and geom is not null)
select j.id, j.kind, j.stage, j.year,
  (select min(c.district) from council c where ST_Within(ST_Centroid(j.geom), c.geom)) as district,
  (select min(r.quintile) from rse r where ST_Within(ST_Centroid(j.geom), r.geom)) as rse_quintile
from j;

-- Places with no council district or equity-index tract are on the city limits (border streets, some bridges): grouped
-- as 'none' so the columns add up to the city totals.
-- "Planned" is the same test as the place's own page: a planned SDOT project nearby, a planned head-start walk signal or
-- no turn on red, or a budget project named for the street. Places WSDOT runs (freeways, ramps, state bridges) are
-- counted on their own, not as "none recorded".
-- Dated fixes since the crash window began at a block's end intersections. The block's page lists them and the district
-- table says how many blocks have only those, but they don't count as the block's own work: a fix at a corner doesn't
-- reach crashes in the middle of the block (crashes near a corner are recorded at the corner).
create or replace table end_fixes as
select e.block as location,
  list(distinct {'at': coalesce(list_filter(string_split(e.ix, ' AND '), lambda s: s <> split_part(e.block, ' BETWEEN ', 1))[1], e.ix),
                 'k': f.k, 'y': f.y, 'd': f.d}) as end_fixes
from block_ends e join place_fixes f on f.location = e.ix
where f.d >= ws() and f.k not in ('New sidewalk', 'Neighborhood safety project')
group by e.block;

-- Planned work at a block's end intersections (a planned head-start walk signal or no turn on red, or a planned SDOT
-- project at the corner that isn't already listed for the block itself). Listed on the block's page; like end_fixes,
-- not counted as the block's own work.
create or replace table end_planned as
with ix_plans as (
  select location, 'Head-start walk signal' as k, null::varchar as id from ranked where lpi_status = 'Planned'
  union all select location, 'No turn on red', null from ranked where ntor_status = 'Planned'
  union all select r.location, null, j.id::varchar from (select location, unnest(proj_ids) as id from ranked) r
            join proj j on j.id::varchar = r.id::varchar where j.stage <> 'done' and j.kind <> 'lpi'
)
select e.block as location,
  list(distinct {'at': coalesce(list_filter(string_split(e.ix, ' AND '), lambda s: s <> split_part(e.block, ' BETWEEN ', 1))[1], e.ix),
                 'k': x.k, 'id': x.id}) as end_planned
from block_ends e join ix_plans x on x.location = e.ix
left join ranked b on b.location = e.block
where x.id is null or not list_contains(coalesce(b.proj_ids, [])::varchar[], x.id)
group by e.block;

create or replace table place_work as
-- Fix counts start on the same day as the crash counts (the window's first day). "Work since" a place's crash window began
-- is by date: a dated fix on or after the window's first day. A new bus lane alone isn't counted as work: SDOT builds
-- them as transit projects (place pages say so in "In short"), so this matches what each place's page says.
with fx as (
  select location, count(*) filter (where k = 'Head-start walk signal') as lpi, count(*) filter (where k <> 'Head-start walk signal') as other
  from place_fixes where d >= ws() group by location
),
recent as (select distinct location from place_fixes where d >= ws()),
places as (
  select r.location, coalesce(r.council_district::varchar, 'none') as district, coalesce(r.rse_quintile, 'none') as rse,
    r.ksi, r.killed, r.fatal, r.seriously_injured, r.rank, r.addr_type, r.lat, r.lon, r.rank <= top_n() as top50, coalesce(fx.lpi, 0) as lpi, coalesce(fx.other, 0) as other,
    r.location in (select location from recent) as fixed_recently,
    r.location in (select location from end_fixes) as ends_fixed,
    coalesce(r.proj_planned or r.lpi_status = 'Planned' or r.ntor_status = 'Planned' or len(r.cip) > 0, false) as proj_planned,
    r.state_route, r.council_district2, r.crashes, r.ped_crashes, r.bike_crashes
  from ranked r left join fx using (location)
)
select * from places;

-- Need and work by council district and by the City's equity index.
create or replace table need_work as
with places as (select * exclude (crashes, ped_crashes, bike_crashes) from place_work),
-- A place on a district line (the boundary runs down its street) counts in both districts, as on the map's district lists,
-- so each office sees it; district totals then add up to more than the city's (the page says by how many places).
long as (
  select 'district' as dim, district as grp, council_district2::varchar as line, * exclude (district, rse) from places
  union all select 'district', council_district2::varchar, district, * exclude (district, rse) from places where council_district2 is not null
  union all select 'rse', rse, null, * exclude (district, rse) from places
),
by_g as (
  select dim, grp, sum(ksi) as ksi, sum(killed) as killed, sum(fatal) as fatal, sum(seriously_injured) as hurt, sum(lpi) as fixes_lpi, sum(other) as fixes_other,
    count(*) filter (where top50) as top50,
    count(*) filter (where top50 and not fixed_recently and not proj_planned and state_route is null) as top50_nothing,
    count(*) filter (where top50 and not fixed_recently and not proj_planned and state_route is null and ends_fixed) as top50_ends,
    count(*) filter (where top50 and state_route is not null) as top50_state,
    list({'loc': location, 'r': rank, 't': addr_type, 'fixed': fixed_recently, 'ends': ends_fixed, 'planned': proj_planned, 'state': state_route, 'k': ksi,
          'line': line}
         order by rank) filter (where top50) as top50_list
  from long group by dim, grp
),
proj_long as (
  select 'district' as dim, coalesce(district::varchar, 'none') as grp, * from proj_area
  union all select 'rse', coalesce(rse_quintile, 'none'), * from proj_area
),
proj_g as (select dim, grp, count(*) filter (where stage <> 'done') as proj_planned from proj_long group by dim, grp)
select b.*, coalesce(p.proj_planned, 0) as proj_planned
from by_g b full join proj_g p using (dim, grp);

-- Totals along each street (all its intersections and the stretches between them), ranked by crashes that killed or
-- seriously hurt someone. A crash at an intersection counts for each street that meets there, so a street's total is
-- complete but totals of different streets can't be added together. Counts only, no costs. Street names are SDOT's.
-- "No work": a top-100 place on a city street with no dated safety fix since the window began and no planned
-- work (as in the district table); places WSDOT runs are counted apart.
create or replace table street_totals as
with sp as (
  select unnest(case when addr_type = 'B' then [split_part(location, ' BETWEEN ', 1)]
                     else list_distinct(string_split(location, ' AND ')) end) as street, *
  from place_work
)
select street, count(*) as places, sum(crashes) as crashes, sum(ksi) as ksi, sum(killed) as killed, sum(fatal) as fatal,
  sum(seriously_injured) as hurt, sum(ped_crashes) as ped, sum(bike_crashes) as bike,
  count(*) filter (where rank <= top_n()) as top50, count(*) filter (where rank <= wide_n()) as top100,
  count(*) filter (where rank <= wide_n() and state_route is not null) as top100_state,
  count(*) filter (where rank <= wide_n() and state_route is null and not fixed_recently and not proj_planned) as top100_nothing,
  list_sort(list_distinct(list(district) filter (where district <> 'none'))) as districts,
  arg_min(location, rank) as worst, min(rank) as worst_rank
from sp where street <> '' group by street;

-- ---------------------------------------------------------------- is it working?
-- Each dated fix, the crashes it's meant to reduce in equal periods before and after (context.sql: before_after), next
-- to the citywide change in that same kind of crash over the same days. Fixes go where crashes were high, and such places
-- tend to improve somewhat on their own, so a drop here isn't proof the fix worked; a place where the targeted crashes
-- didn't drop at all is worth a closer look.
create or replace table working_fix as
select x.location, x.district, r.rank, x.f.k as k, x.f.m as m, x.f.d as d, x.f.days as days,
       x.f.b as b, x.f.a as a, x.f.cb as cb, x.f.ca as ca, x.f.yo as yo, x.f.pb as pb, x.f.pcb as pcb, x.f.other as other
from (select location, council_district as district, unnest(before_after) as f from locations) x
left join ranked r using (location);

create or replace table working_kind as
-- Only fixes with no other dated fix at the place over these years (n_all counts them all). e_*: the earlier stretch
-- against the after period, on the fixes with data back that far. p_had / p_fewer: of those, the ones with any targeted
-- crash in the earlier stretch, and how many had fewer in the next equal stretch (the "before"), with no fix yet.
select k, m, count(*) filter (where not other) as n, count(*) as n_all,
       count(distinct location) filter (where not other) as n_places, count(distinct d) filter (where not other) as n_dates,
       sum(b) filter (where not other) as b, sum(a) filter (where not other) as a,
       sum(cb) filter (where not other) as cb, sum(ca) filter (where not other) as ca,
       count(*) filter (where not other and pb is not null) as e_n,
       sum(pb) filter (where not other) as eb, sum(a) filter (where not other and pb is not null) as ea,
       sum(pcb) filter (where not other) as ecb, sum(ca) filter (where not other and pcb is not null) as eca,
       count(*) filter (where not other and pb > 0) as p_had, count(*) filter (where not other and pb > 0 and b < pb) as p_fewer
from working_fix group by k, m;

-- places where the targeted crashes didn't go down: at least inc_min_crashes() before and after, no fewer after
create or replace table working_places as
select * from working_fix where a >= inc_min_crashes() and a >= b and b >= inc_min_crashes() and k not in ('Bus lane', 'Protected bike lane') and not other
  and days >= inc_min_days()
qualify row_number() over (partition by k order by a - b desc, a desc, rank nulls last, location) <= 40;

-- The same list as a spreadsheet (site/data/increases.csv, finished by run.ps1 with the data date and each place's link):
-- the rows the page shows (kinds of fix with too few separate install dates are left off there, so here too), with SDOT's
-- own location text and intersection key, so a row can be checked against SDOT's records.
copy (
  with sdot as (select location, string_agg(distinct sdot_location, ' / ' order by sdot_location) as sdot_names
                from collisions where sdot_location is not null group by location)
  select w.k as fix, case when w.yo then year(w.d)::varchar || ' (year only)' else w.d::varchar end as fix_date,
         case w.m when 'ped' then 'Crashes involving someone walking' when 'turnped' then 'People walking hit by turning drivers'
                  when 'rightped' then 'People walking hit by right-turning drivers' when 'bike' then 'Crashes involving someone on a bike'
                  when 'left' then 'Left-turn crashes' when 'all' then 'Crashes of any kind' else w.m end as targets,
         w.location, s.sdot_names, l.intkey, w.district, w.rank, w.b as before, w.a as after,
         round(w.days / 365.25, 1) as years_each_side, w.pb as earlier
  from working_places w
  join working_kind k on k.k = w.k and k.m = w.m and coalesce(k.n_dates, 0) >= ba_cluster_dates()
  left join sdot s using (location) left join locations_all l using (location)
  order by w.k, w.a - w.b desc, w.a desc, w.rank nulls last, w.location
) to 'data/increases_raw.csv' (header true);

-- ---------------------------------------------------------------- reported sidewalk damage: what happened to each report
-- SDOT's work orders made from Find It Fix It reports, matched to the "Damaged Sidewalk" reports by report number. Each
-- report gets one outcome, in this order: fixed (a sidewalk work order closed as done: SDOT's problem type names a
-- sidewalk, curb or wheelchair ramp; most are a "Sidewalk Preliminary Repair", a first fix that isn't necessarily a rebuilt
-- sidewalk; work on something else, like a pothole, isn't a sidewalk fix), still open, assigned to the property owner,
-- closed as a duplicate of another report, no work done (SDOT's result: none needed, or couldn't find it), other (other
-- work, sent elsewhere, cancelled, or the report was transferred to another department), or no work order at all. Only
-- reports at least sw_min_age_days() old on the data date count, so each had time for a fix.
create or replace macro sw_work(problem) as
  regexp_matches(problem, '(?i)sidewalk|curb|wheel ?chair ramp') and not regexp_matches(problem, '(?i)non-s/w|owner');
create or replace table report_wo as
select f.properties.EXTREFNO::varchar as id, f.properties.PROBLEMDESC::varchar as problem, f.properties.RESULTDESC::varchar as result,
       f.properties.CANCELLEDFLAG::varchar = 'Y' as cancelled,
       make_timestamp(f.properties.ADDDTTM::bigint * 1000)::date as opened,
       case when f.properties.CLOSEDDT is not null then make_timestamp(f.properties.CLOSEDDT::bigint * 1000)::date end as closed
from (select unnest(features) f from read_json('data/raw/reportwo_*.json', maximum_object_size = 100000000))
where f.properties.EXTREFNO is not null;

create or replace table sidewalk_wait as
with rep as (
  select r.id, r.date, coalesce(r.council_district::varchar, 'none') as district, count(w.id) as n_wo,
         coalesce(any_value(r.status) like 'Transferred%', false) as transferred,
         min(w.closed) filter (where not w.cancelled and w.closed is not null and sw_work(w.problem)
                               and w.result in ('Completed as specified', 'Temporary repair completed', 'Different work completed')) as fixed,
         coalesce(bool_or(w.closed is null and not w.cancelled), false) as open,
         coalesce(bool_or(w.result like '%property owner%' or w.problem like '%property owner%'), false) as owner,
         coalesce(bool_or(w.result like 'Duplicate%'), false) as dup,
         coalesce(bool_or(w.result like 'No work%' or w.result like 'Field Check%'), false) as nowork
  from requests r left join report_wo w on w.id = r.id
  where r.type = 'Damaged Sidewalk' and r.date <= fetched() - sw_min_age_days()
  group by all),
d as (select *, case when fixed is not null then greatest(0, fixed - date) end as days,
             case when fixed is not null then 'fixed' when open then 'open' when owner then 'owner' when dup then 'dup'
                  when nowork then 'nowork' when n_wo > 0 or transferred then 'other' else 'none' end as k from rep),
g as (select district, * exclude (district) from d union all select 'city', * exclude (district) from d)
select district as g, count(*) as n, count(*) filter (where k = 'fixed') as fixed,
       count(*) filter (where days <= sw_fast_days()) as fast,
       quantile_disc(days, 0.5) as med,                    -- of the reports fixed: half within this many days
       count(*) filter (where k = 'open') as open, count(*) filter (where k = 'owner') as owner, count(*) filter (where k = 'dup') as dup,
       count(*) filter (where k = 'other' and transferred) as transferred,
       count(*) filter (where k = 'nowork') as nowork, count(*) filter (where k = 'other') as other,
       count(*) filter (where k = 'none') as no_wo
from g where district <> 'none' group by district;

-- ---------------------------------------------------------------- export: site/data/progress.json
copy (
  select {
    'cmp': (select {'d0': c0, 'd1': c1, 'ksi_city': (select ksi from ksi_by_period where id = 'cmp'),
                    'crashes_city': (select crashes from ksi_by_period where id = 'cmp')} from cmp_window),
    'years': (select list({'yr': p.yr, 'd0': p.d0, 'd1': p.d1,
                'ksi_city': (select k.ksi from ksi_by_period k where k.id = p.id),
                'crashes_city': (select k.crashes from ksi_by_period k where k.id = p.id),
                'ref': (select {'n': count(*), 'ksi': sum(w.ksi_then), 'ksi_cmp': sum(w.ksi_cmp)} from worst_then w
                        where w.yr = p.yr and w.rank_then between worst_n() + 1 and worst_ref_to()),
                'places': (select list({'r': w.rank_then, 'loc': w.location, 'ksi': w.ksi_then, 'c': w.crashes_then,
                                        'now': w.rank_now, 'ksi_cmp': w.ksi_cmp, 'c_cmp': w.crashes_cmp, 'd': w.district,
                                        'state': w.state_route, 'g': w.fix_group, 'fx': w.fixes,
                                        't': coalesce((select hp.addr_type from hist_places hp where hp.location = w.location), 'B')} order by w.rank_then)
                           from worst_then w where w.yr = p.yr and w.rank_then <= worst_n())} order by p.yr)
              from hist_periods p, cmp_window cw where p.kind = 'year' and p.d1 <= cw.c0),
    'month': {
      'd_before': (select d1 from hist_periods where id = 'm1'),
      'd_now': (select d1 from hist_periods where id = 'm0'),
      'moves': (select list({'loc': location, 'now': rank_now, 'was': rank_before, 'in50': top50} order by rank_now)
                from month_change where top50 is not null or (rank_now <= top_n() and rank_before - rank_now >= move_min())
                  or (rank_before <= top_n() and rank_now - rank_before >= move_min())),
      'recent_ksi': (select list({'loc': location, 'f': fatal, 'kd': killed, 's': serious, 'last': last_date, 'rank': rank}
                                 order by fatal desc, serious desc, last_date desc, location) from recent_ksi),
      'recent_ksi_total': (select {'f': sum(fatal), 'kd': sum(killed), 's': sum(serious), 'from': we(), 'to': max(last_date)} from recent_ksi),
      'recent_fixes': (select list({'loc': location, 'k': k, 'd': d, 'rank': rank} order by d desc, rank) from recent_fixes)
    },
    'district_line': (select {'n': count(*), 'ksi': coalesce(sum(ksi), 0), 'top': count(*) filter (where top50)} from place_work where council_district2 is not null),
    'need': (select list({'dim': dim, 'g': grp, 'ksi': ksi, 'killed': killed, 'fatal': fatal, 'hurt': hurt, 'top50': top50, 'top50_nothing': top50_nothing, 'top50_state': top50_state, 'top50_ends': top50_ends,
                          'lpi': fixes_lpi, 'other': fixes_other, 'proj_planned': proj_planned, 'list': top50_list}
                         order by dim, grp) from need_work),
    'working': {
      'kinds': (select list({'k': k, 'm': m, 'n': n, 'n_all': n_all, 'n_places': n_places, 'n_dates': n_dates,
                             'b': b, 'a': a, 'cb': cb, 'ca': ca, 'e_n': e_n, 'eb': eb, 'ea': ea, 'ecb': ecb, 'eca': eca,
                             'p_had': p_had, 'p_fewer': p_fewer}
                            order by n desc, k) from working_kind where n > 0),
      'places': (select list({'loc': location, 'k': k, 'm': m, 'd': d, 'yo': yo, 'days': days, 'b': b, 'a': a, 'pb': pb, 'rank': rank, 'dist': district}
                             order by k, a - b desc, a desc, rank nulls last, location) from working_places)
    },
    'streets': (select list({'s': street, 'n': places, 'c': crashes, 'ksi': ksi, 'killed': killed, 'fatal': fatal, 'hurt': hurt, 'ped': ped, 'bike': bike,
                              't50': top50, 't100': top100, 't100_state': top100_state, 't100_none': top100_nothing,
                              'dist': districts, 'worst': worst, 'wr': worst_rank} order by ksi desc, crashes desc, street)
                 from (select * from street_totals order by ksi desc, crashes desc, street limit 30)),
    'sidewalk': {
      'rows': (select list({'g': g, 'n': n, 'fixed': fixed, 'fast': fast, 'med': med, 'open': open, 'owner': owner, 'dup': dup, 'nowork': nowork,
                            'other': other, 'transferred': transferred, 'no_wo': no_wo} order by g) from sidewalk_wait),
      'd0': (select min(date) from requests where type = 'Damaged Sidewalk'), 'd1': fetched() - sw_min_age_days(),
      -- work orders on the reports counted above, and how many of them were closed as done on something other than a sidewalk
      'wo': (select count(*) from report_wo w join requests r on r.id = w.id
             where r.type = 'Damaged Sidewalk' and r.date <= fetched() - sw_min_age_days()),
      'wo_not_sw': (select count(*) from report_wo w join requests r on r.id = w.id
                    where r.type = 'Damaged Sidewalk' and r.date <= fetched() - sw_min_age_days() and not w.cancelled
                      and w.result in ('Completed as specified', 'Temporary repair completed', 'Different work completed') and not sw_work(w.problem)),
      'wo_not_sw_top': (select list(problem order by n desc, problem) from (
                          select w.problem, count(*) as n from report_wo w join requests r on r.id = w.id
                          where r.type = 'Damaged Sidewalk' and r.date <= fetched() - sw_min_age_days() and not w.cancelled and w.problem <> 'Other'
                            and w.result in ('Completed as specified', 'Temporary repair completed', 'Different work completed') and not sw_work(w.problem)
                          group by 1 order by n desc, problem limit 2))
    },
    'since': year(ws()),
    -- injury crashes (fatal, serious and other injury) on hand each calendar year: why past rankings start where they do
    'inj_years': (select list({'y': y, 'n': n} order by y) from (select year(date) as y, count(*) as n from crash_full
                  where severity in ('Fatal Collision', 'Serious Injury Collision', 'Injury Collision') group by 1)),
    -- the kinds of work counted as a fix, and the share of those fixes at intersections (not along blocks)
    'fix_kinds': (select list(distinct k order by k) from place_fixes),
    'fix_ix_share': (select round(avg((l.addr_type = 'I')::int), 3) from place_fixes f join locations_all l using (location)),
    'since_d': strftime(ws(), '%B %Y'),
    -- budget lines named for a street in each council district (the same street-name matching as each place's page; a place on a
    -- district line counts in both), with how many places with crashes there are on those streets
    'cip_district': (select list({'g': g, 'c': c, 't': t, 'y0': y0, 'y1': y1, 'n': n} order by g, y1 desc, n desc, c) from (
      select g, x.c, x.t, x.y0, x.y1, count(distinct location) as n from (
        select council_district::varchar as g, location, unnest(cip) as x from ranked r where r.cip is not null and council_district is not null
        union all
        select council_district2::varchar, location, unnest(cip) from ranked r where r.cip is not null and council_district2 is not null)
      group by all)),
    'window': {'d0': ws(), 'd1': we()}
  } as progress
) to 'site/data/progress.json' (format json, array false);
