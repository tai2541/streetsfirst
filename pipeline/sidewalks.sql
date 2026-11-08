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
       f.properties.ArtClass as art, gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/sw_missing_*.json', maximum_object_size = 50000000))
where f.geometry is not null and f.properties.Tier is not null and coalesce(f.properties.Remove::varchar, '') <> '1';

create or replace table sw_missing_blocks as
select row_number() over (order by tier, score desc, ft desc, segkey) as id, *
from (select segkey, min(block) as block, min(tier) as tier, max(score) as score, max(safety_sc) as safety_sc,
             max(equity_sc) as equity_sc, max(school_sc) as school_sc, max(transit_sc) as transit_sc, min(art) as art,
             count(*) as sides, round(max(ST_Length(geom))) as ft, ST_Union_Agg(geom) as geom
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
create or replace table loc_sidewalk as
with m as (select p.location, min(s.tier) as tier
           from loc_pts p join sw_missing s on ST_DWithin(p.geom, s.geom, p.r) group by p.location),
q as (select p.location, round(sum(ST_Length(s.geom))) as poor_ft, max(s.assessed) as poor_assessed
      from loc_pts p join sw_poor s on ST_DWithin(p.geom, s.geom, p.r) group by p.location)
select coalesce(m.location, q.location) as location, m.tier as sw_missing_tier, q.poor_ft as sw_poor_ft, q.poor_assessed as sw_poor_assessed
from m full join q using (location);

create or replace table locations as
select l.*, s.sw_missing_tier, s.sw_poor_ft, s.sw_poor_assessed
from locations l left join loc_sidewalk s using (location);

-- ---------------------------------------------------------------- export for the Sidewalks view (top 400 of each)
create or replace macro sw_pts(g) as
  [[[round(ST_Y(x.geom), 5), round(ST_X(x.geom), 5)] for x in ST_Dump(ST_Points(part.geom))]
   for part in ST_Dump(ST_LineMerge(ST_SimplifyPreserveTopology(ST_Transform(g, 'EPSG:2926', 'EPSG:4326'), 0.00003)))];

copy (
  select {
    'missing': (select list({'id': id, 'name': block, 'tier': tier, 'score': score, 'safety': safety_sc, 'equity': equity_sc,
                             'school': school_sc, 'transit': transit_sc, 'art': art, 'sides': sides, 'ft': ft,
                             'hood': sw_hood(geom), 'pts': sw_pts(geom)} order by id)
                from sw_missing_blocks where id <= 400),
    'poor': (select list({'id': id, 'name': block, 'vp': very_poor_ft, 'p': poor_ft, 'y0': assessed_from, 'y1': assessed_to,
                          'hood': sw_hood(geom), 'pts': sw_pts(geom)} order by id)
             from sw_poor_blocks where id <= 400),
    'counts': {
      'missing_blocks': (select count(*) from sw_missing_blocks),
      'tier1_blocks': (select count(*) from sw_missing_blocks where tier = 1),
      'missing_miles': (select round(sum(ST_Length(geom)) / 5280) from sw_missing),
      'poor_blocks': (select count(*) from sw_poor_blocks),
      'poor_miles': (select round(sum(ST_Length(geom)) / 5280, 1) from sw_poor),
      'poor_assessed_median': (select median(assessed) from sw_poor)
    }
  } as sidewalks
) to 'site/data/sidewalks.json' (format json, array false);
