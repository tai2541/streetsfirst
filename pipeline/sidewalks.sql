-- Read by build.sql after `locations` exists. The Sidewalks view (site/data/sidewalks.json) and, for each location,
-- the sidewalk situation right there. Context only: none of this changes the safety ranking.
--   * Missing sidewalks: SDOT's own priorities from the Seattle Transportation Plan's Pedestrian Element. SDOT scores
--     each missing block for safety, equity, schools, transit, parks and land use and sorts them into Tier 1 (highest)
--     to Tier 5. Ranked here by SDOT's tier, then SDOT's score, then length.
--   * Sidewalks in poor condition: blocks with the most sidewalk SDOT rated poor or very poor in its inventory.
-- Owner and parcel fields are never fetched: this is about streets, not about singling out homes.

-- ---------------------------------------------------------------- missing sidewalks
create or replace table sw_missing as
select f.properties.SEGKEY as segkey,
       trim(regexp_replace(f.properties.UNITDESC, ',\s*[A-Z]+ SIDE\s*$', '')) as block,
       f.properties.Tier as tier, f.properties.TotalSc as score, f.properties.SafetySc as safety_sc,
       f.properties.EquitySc as equity_sc, f.properties.SchSC as school_sc, f.properties.TransitSC as transit_sc,
       f.properties.ArtClass as art, gj_geom(f.geometry) as geom,
       nullif(regexp_extract(f.properties.UNITDESC, ',\s*([A-Z]+) SIDE\s*$', 1), '') as side
from (select unnest(features) f from read_json('data/raw/sw_missing_*.json', maximum_object_size = 50000000))
where f.geometry is not null and f.properties.Tier is not null and coalesce(f.properties.Remove::varchar, '') <> '1';

create or replace table sw_missing_blocks as
select row_number() over (order by tier, score desc, ft desc, segkey) as id, *
from (select segkey, min(block) as block, min(tier) as tier, max(score) as score, max(safety_sc) as safety_sc,
             max(equity_sc) as equity_sc, max(school_sc) as school_sc, max(transit_sc) as transit_sc, min(art) as art,
             -- the sides SDOT names (two records can be one side, in pieces; four can be both), else one per record
             case when count(side) = count(*) then count(distinct side) else count(*) end as sides,
             case when count(side) = count(*) and count(distinct side) = 1 then min(side) end as side1,
             round(max(ST_Length(geom))) as ft, ST_Union_Agg(geom) as geom
      from sw_missing group by segkey);

-- ---------------------------------------------------------------- sidewalks in poor condition
create or replace table sw_poor as
select f.properties.SEGKEY as segkey,
       trim(regexp_replace(f.properties.UNITDESC, ',\s*[A-Z]+ SIDE\s*$', '')) as block,
       f.properties.CONDITION as cond,
       year(make_timestamp(f.properties.CONDITION_ASSESSMENT_DATE::bigint * 1000)) as assessed,
       gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/sw_poor_*.json', maximum_object_size = 50000000))
where f.geometry is not null;

create or replace table sw_poor_blocks as
select row_number() over (order by poor_ft + very_poor_ft desc, very_poor_ft desc, segkey) as id, *
from (select segkey, min(block) as block,
             round(coalesce(sum(ST_Length(geom)) filter (where cond = 'VERY-POOR'), 0)) as very_poor_ft,
             round(coalesce(sum(ST_Length(geom)) filter (where cond = 'POOR'), 0)) as poor_ft,
             min(assessed) as assessed_from, max(assessed) as assessed_to, ST_Union_Agg(geom) as geom
      from sw_poor group by segkey);

-- neighborhood at the middle of each block
create or replace macro sw_hood(g) as (select arg_min(h.neighborhood, {'d': ST_Distance(ST_PointOnSurface(g), h.geom), 'n': h.neighborhood})
                                       from hoods h where ST_DWithin(ST_PointOnSurface(g), h.geom, 300));

-- ---------------------------------------------------------------- at each safety location
-- A block: SDOT's own records for that block (its segment key; a bridge too), so a sidewalk set back on a wide street
-- isn't missed and a cross street's isn't picked up. An intersection: the blocks within its radius.
create or replace table loc_sidewalk as
with blk as (select distinct a.location, s.compkey from locations a join streets s on s.loc_name = a.location where a.addr_type <> 'I'),
ix as (select p.location, p.geom, p.r from loc_pts p join locations a using (location) where a.addr_type = 'I' and not on_structure(p.location)),
m as (select location, min(tier) as tier from (
        select b.location, s.tier from blk b join sw_missing s on s.segkey = b.compkey
        union all select p.location, s.tier from ix p join sw_missing s on ST_DWithin(p.geom, s.geom, p.r)) group by location),
q as (select location, round(sum(ft)) as poor_ft, max(assessed) as poor_assessed from (
        select b.location, ST_Length(s.geom) as ft, s.assessed from blk b join sw_poor s on s.segkey = b.compkey
        union all select p.location, ST_Length(s.geom), s.assessed from ix p join sw_poor s on ST_DWithin(p.geom, s.geom, p.r)) group by location)
select coalesce(m.location, q.location) as location, m.tier as sw_missing_tier, q.poor_ft as sw_poor_ft, q.poor_assessed as sw_poor_assessed
from m full join q using (location);

create or replace table locations as
select l.*, s.sw_missing_tier, s.sw_poor_ft, s.sw_poor_assessed
from locations l left join loc_sidewalk s using (location);

-- ---------------------------------------------------------------- export for the Sidewalks view (top 400 of each)
create or replace macro sw_pts(g) as
  [[[round(ST_Y(x.geom), 5), round(ST_X(x.geom), 5)] for x in ST_Dump(ST_Points(part.geom))]
   for part in ST_Dump(ST_LineMerge(ST_SimplifyPreserveTopology(ST_Transform(g, 'EPSG:2926', 'EPSG:4326'), 0.00003)))];

-- Each block's council districts (traffic.sql: dists_of); the export has the top 400 citywide and each district's own top
-- 100, so the list filtered to one district is complete to that many.
-- (a block along the city limit runs on the district shapes' outer edge: within 50 ft of them, as bus stretches are)
create or replace table sw_missing_ds as select id, coalesce(nullif(dists_of(geom), []), dists_near(geom)) as ds from sw_missing_blocks;
create or replace table sw_poor_ds as select id, coalesce(nullif(dists_of(geom), []), dists_near(geom)) as ds from sw_poor_blocks;
create or replace macro sw_keep(t) as table
  select id from (select id, unnest(ds) as d from query_table(t)) qualify row_number() over (partition by d order by id) <= 100;
copy (
  select {
    'missing': (select list({'id': id, 'name': block, 'ds': ds, 'tier': tier, 'score': score, 'safety': safety_sc, 'equity': equity_sc,
                             'school': school_sc, 'transit': transit_sc, 'art': art, 'sides': sides, 'side1': side1, 'ft': ft,
                             'hood': sw_hood(geom), 'pts': sw_pts(geom)} order by id)
                from sw_missing_blocks join sw_missing_ds using (id) where id <= 400 or id in (select id from sw_keep('sw_missing_ds'))),
    'poor': (select list({'id': id, 'name': block, 'ds': ds, 'vp': very_poor_ft, 'p': poor_ft, 'y0': assessed_from, 'y1': assessed_to,
                          'hood': sw_hood(geom), 'pts': sw_pts(geom), 'len': len} order by id)
             -- len: the block's own length (SDOT's street segment): the poor length adds both sides, so it can be near twice that
             from sw_poor_blocks join sw_poor_ds using (id)
             left join (select compkey, round(max(ST_Length(geom))) as len from streets group by compkey) st on st.compkey = sw_poor_blocks.segkey
             where id <= 400 or id in (select id from sw_keep('sw_poor_ds'))),
    'counts': {
      'missing_blocks': (select count(*) from sw_missing_blocks),
      'tier1_blocks': (select count(*) from sw_missing_blocks where tier = 1),
      -- the highest points SDOT gave any block for each reason, so the page can say "16 of 16"
      'max': (select {'score': max(score), 'safety': max(safety_sc), 'equity': max(equity_sc), 'school': max(school_sc),
                      'transit': max(transit_sc)} from sw_missing),
      'missing_miles': (select round(sum(ST_Length(geom)) / 5280) from sw_missing),
      'poor_blocks': (select count(*) from sw_poor_blocks),
      'poor_miles': (select round(sum(ST_Length(geom)) / 5280, 1) from sw_poor),
      'poor_assessed_median': (select median(assessed) from sw_poor),
      -- by council district: blocks missing a sidewalk (and of those, SDOT's Tier 1) and blocks with poor sidewalk
      'by_district': (select list({'g': d, 'missing': m, 'tier1': t1, 'poor': p} order by d) from (
          select d, count(*) filter (where k = 'm') as m, count(*) filter (where k = 'm' and tier = 1) as t1, count(*) filter (where k = 'p') as p
          from (select unnest(x.ds) as d, 'm' as k, b.tier from sw_missing_blocks b join sw_missing_ds x using (id)
                union all select unnest(x.ds), 'p', null from sw_poor_ds x) group by d))
    }
  } as sidewalks
) to 'site/data/sidewalks.json' (format json, array false);
