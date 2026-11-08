-- Read by build.sql after sidewalks.sql. Where SDOT's own published project maps show planned or recently finished
-- work, so the site can show it next to the crash ranking and the sidewalk lists. Context only: never scored.
--   * New sidewalk projects (the layer behind SDOT's "New Sidewalks Map"). Same categories as SDOT's map:
--       Planning = 'Y'                      -> "moving into design" (SDOT's wording), with the year SDOT lists
--       Planning empty and year <= this year -> completed
--     Anything else isn't shown on SDOT's own map, so it's left out here too (and counted, so the site can say so).
--   * Neighborhood-Initiated Safety Partnership Program (NISPP): small safety projects, Planned or Completed.
--   * Head-start walk signals (LPI) SDOT lists as Planned (already read into `lpi` by build.sql).
-- None of these layers carry budget line numbers or dollars, and the City's budget data has no locations, so no
-- dollar figure is ever attached to a mapped project.

create or replace table proj_raw_sidewalk as
select f.properties.UNITDESC as unitdesc,
       trim(regexp_replace(f.properties.UNITDESC, ',?\s*\b[A-Z]+ SIDE\s*$', '')) as block,
       f.properties.Year::int as year, f.properties.Planning as planning, f.properties.Scope as scope,
       gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/proj_sidewalk_*.json', maximum_object_size = 50000000))
where f.geometry is not null;

create or replace table proj_raw_nispp as
select f.properties.Project_Name as name, f.properties.Scope as scope, f.properties.Neighborhood as hood,
       f.properties.Project_Stage___Website as stage, f.properties.Planned_Delivery_Year::int as year,
       f.properties.Project_Source as source, f.properties.Link as link, gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/proj_nispp_*.json', maximum_object_size = 50000000))
where f.geometry is not null;

-- One row per project. Sidewalk projects are listed per side of a block; both sides of one block become one row.
create or replace table proj as
-- (many planned walk signals share a name and year: their place breaks the tie, so ids match from build to build)
select row_number() over (order by kind, stage, year nulls last, name, scope, ST_AsText(geom)) as id, *
from (
  select 'sidewalk' as kind,
         case when planning = 'Y' then 'design' else 'done' end as stage,
         block as name, string_agg(distinct scope, ', ' order by scope) as scope, min(year) as year,
         null::varchar as program, null::varchar as link, ST_Union_Agg(geom) as geom
  from proj_raw_sidewalk
  where planning = 'Y' or (planning is null and year <= year(current_date))
  group by block, planning = 'Y'
  union all
  select 'safety', case when stage ilike 'complete%' then 'done' else 'planned' end,
         -- names like "S - 15th Ave S ... - Crossing - NISPP": drop SDOT's internal area prefix and program suffix
         nullif(trim(regexp_replace(regexp_replace(regexp_replace(name, '\x{200B}', '', 'g'),
                '^\s*(N|NE|NW|S|SE|SW|E|W)\s+-\s+', ''), '\s+-\s+(NISPP|TSP VZ|VZ)\s*$', '')), 'TBD'),
         nullif(trim(scope), 'TBD'), year, source, nullif(trim(link), ''), geom
  from proj_raw_nispp
  union all
  select 'lpi', 'planned', null, 'Head-start walk signal (Leading Pedestrian Interval)', try_cast(planned_year as int),
         null, null, geom
  from lpi where status = 'Planned'
);

-- Projects at each scored location: within about 100 ft of an intersection, or 40 ft of anywhere along a block
-- (the block's own street line, so a long block isn't judged from its midpoint; falls back to the point).
create or replace table loc_shape as
select p.location, p.r, coalesce(b.geom, p.geom) as geom
from loc_pts p
left join (select unitdesc, ST_Union_Agg(geom) as geom from streets group by unitdesc) b
  on p.r = 40 and b.unitdesc = p.location;

create or replace table loc_proj as
select p.location, list(j.id order by j.stage = 'done', j.year nulls last, j.id) as proj_ids,
       bool_or(j.stage <> 'done') as proj_planned
from loc_shape p join proj j on ST_DWithin(p.geom, j.geom, case when p.r = 40 then 40 else p.r + 40 end)
group by p.location;

create or replace table locations as
select l.*, coalesce(j.proj_ids, []::bigint[]) as proj_ids, coalesce(j.proj_planned, false) as proj_planned
from locations l left join loc_proj j using (location);

-- Missing-sidewalk blocks SDOT already has a sidewalk project for: the project's line runs along most of the block
-- (three quarters of the block within 30 ft of it), or SDOT's block name matches exactly. Names alone miss projects with
-- typos or multi-block "FROM ... TO" names, so the shape is the main test.
create or replace table sw_block_proj as
select b.id as block_id, arg_min(j.id, {'d': j.stage = 'done', 'i': j.id}) as proj_id
from sw_missing_blocks b join proj j on j.kind = 'sidewalk'
  and (j.name = b.block
       or (ST_DWithin(b.geom, j.geom, 30)
           and ST_Length(ST_Intersection(b.geom, ST_Buffer(j.geom, 30))) > 0.75 * ST_Length(b.geom)))
group by b.id;

-- ---------------------------------------------------------------- export for the map
copy (
  select {
    'list': (select list({'id': id, 'kind': kind, 'stage': stage, 'name': name, 'scope': scope, 'year': year,
                          'program': program, 'link': link, 'hood': sw_hood(geom),
                          'pt': case when ST_GeometryType(geom)::varchar ilike '%POINT%'
                                     then [round(ST_Y(ST_Transform(ST_Centroid(geom), 'EPSG:2926', 'EPSG:4326')), 5),
                                           round(ST_X(ST_Transform(ST_Centroid(geom), 'EPSG:2926', 'EPSG:4326')), 5)] end,
                          'pts': case when not ST_GeometryType(geom)::varchar ilike '%POINT%' then sw_pts(geom) end} order by id)
             from proj),
    'missing_blocks': (select list({'b': block_id, 'p': proj_id} order by block_id) from sw_block_proj),
    'counts': {
      'sidewalk_design': (select count(*) from proj where kind = 'sidewalk' and stage = 'design'),
      'sidewalk_done': (select count(*) from proj where kind = 'sidewalk' and stage = 'done'),
      'sidewalk_left_out': (select count(*) from proj_raw_sidewalk
                            where not (planning = 'Y' or (planning is null and year <= year(current_date)))),
      'safety_planned': (select count(*) from proj where kind = 'safety' and stage = 'planned'),
      'safety_done': (select count(*) from proj where kind = 'safety' and stage = 'done'),
      'lpi_planned': (select count(*) from proj where kind = 'lpi'),
      'locations_with_plans': (select count(*) from locations where proj_planned)
    }
  } as projects
) to 'site/data/projects.json' (format json, array false);
