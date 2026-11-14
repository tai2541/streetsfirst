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
-- work: whether it counts as safety work (done or planned) anywhere on the site. Pavement art and bus stop improvements
-- (a transit project, like a bus lane) are listed among a place's projects but aren't counted. The one place this rule
-- lives: the page reads 'work' from the projects file.
select row_number() over (order by kind, stage, year nulls last, name, scope, ST_AsText(geom)) as id, *,
       not regexp_matches(coalesce(scope, ''), '(?i)pavement art|bus stop') as work
from (
  select 'sidewalk' as kind,
         case when planning = 'Y' then 'design' else 'done' end as stage,
         block as name, string_agg(distinct scope, ', ' order by scope) as scope, min(year) as year,
         null::varchar as program, null::varchar as link, ST_Union_Agg(geom) as geom
  from proj_raw_sidewalk
  -- (a project with no planning flag counts as finished once its year has come, unless its scope is still "TBD")
  where planning = 'Y' or (planning is null and year <= year(current_date) and upper(trim(coalesce(scope, ''))) <> 'TBD')
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
-- (the block's own street line without its ends, loc_inner in traffic.sql: a long block isn't judged from its midpoint,
-- and work at the corners at its ends or on a side street belongs to those, not to the block).

create or replace table loc_proj as
select p.location, list(j.id order by j.stage = 'done', j.year nulls last, j.id) as proj_ids,
       coalesce(bool_or(j.stage <> 'done' and j.work), false) as proj_planned
from loc_inner p join proj j on ST_DWithin(p.geom, j.geom, case when p.r = 40 then near_block_ft() else near_ix_ft() end)
  and not on_structure(p.location)
group by p.location;

create or replace table locations as
select l.*, coalesce(j.proj_ids, []::bigint[]) as proj_ids, coalesce(j.proj_planned, false) as proj_planned
from locations l left join loc_proj j using (location);

-- ---------------------------------------------------------------- budget projects named for a street
-- SDOT's capital budget gives project titles and dollars by year, but no locations. A title that names a street
-- ("Aurora Avenue North Safety Improvements") is matched to the scored places on that street, automatically, with no
-- list kept by hand. The project's exact limits aren't published, so the site shows it as "a budget project named for
-- this street", never as a fix at the place. Rules: street names are compared in one spelling (Avenue = Ave,
-- North = N, ...); a direction written after the name must match exactly (1st Ave NE is not 1st Ave S); a direction
-- written before a named street may be left out (Madison St covers E Madison St); a title may also leave out the
-- direction after the name or the street type ("NE 130th St/NE 125th", "Roosevelt Multimodal Corridor", "Shoreline
-- 145th"), but such a short name links only when it fits one street; when a title names a
-- neighborhood ("Northgate ..."), only places in that neighborhood match; when it names a light-rail station, built or
-- planned ("Graham Street Station ..."), only places within station_area_ft of it. A name used with more than one
-- leading direction (S Graham St, SW Graham St) links only when those place rules leave places on just one of them.
-- Projects with money in the last two budget years or later.
create or replace macro station_area_ft() as 2640;   -- a station's area: half a mile, the usual walk to a station

create or replace table stations as
select f.properties.NAME as name, f.properties.STATUS as status, gj_geom(f.geometry) as geom
from (select unnest(features) f from read_json('data/raw/stations_*.json'))
where f.geometry is not null and f.properties.NAME ilike '% station';

create or replace macro street_norm(s) as
  trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(replace(regexp_replace(' ' || upper(s) || ' ', '[^A-Z0-9]+', ' ', 'g'), ' ', '  '), ' AVENUE | AV ', ' AVE ', 'g'), ' STREET ', ' ST ', 'g'), ' BOULEVARD ', ' BLVD ', 'g'), ' PLACE ', ' PL ', 'g'), ' DRIVE ', ' DR ', 'g'), ' ROAD ', ' RD ', 'g'), ' NORTHEAST ', ' NE ', 'g'), ' NORTHWEST ', ' NW ', 'g'), ' SOUTHEAST ', ' SE ', 'g'), ' SOUTHWEST ', ' SW ', 'g'), ' NORTH ', ' N ', 'g'), ' SOUTH ', ' S ', 'g'), ' EAST ', ' E ', 'g'), ' WEST ', ' W ', 'g'), ' MARTIN +LUTHER +KING ', ' M L KING ', 'g'), ' +', ' ', 'g'));

create or replace table loc_cip as
with cip as (
  select pid, arg_max(title, {'y': year, 't': title}) as title, min(year) as y0, max(year) as y1
  from (select year, amount,
               coalesce(nullif(regexp_extract(project, '^(MC-TR-C[0-9]+)', 1), ''), code) as pid,
               trim(regexp_replace(project, '^MC-TR-C[0-9]+\s*-\s*', '')) as title
        from capital_budget where dept = 'Seattle Department of Transportation' and amount > 0 and year >= budget_from())
  group by pid having max(year) >= year(current_date) - 1
),
-- "/" and "&" join two names ("NE 130th St/NE 125th"): read as "and", so the second name's direction isn't taken for
-- the first name's suffix
cipn0 as (select *, ' ' || street_norm(regexp_replace(title, '\s*[/&]\s*', ' and ', 'g')) || ' ' as tn from cip),
-- a title naming a crossing by its number alone ("Roosevelt and 85th") is about the places at that crossing
cipn as (select *, case when not regexp_matches(tn, ' AND [0-9]+(ST|ND|RD|TH) (ST|AVE|WAY|PL|BLVD|DR|RD|CT|LN|TER|PKWY) ')
                        then nullif(regexp_extract(tn, ' AND ([0-9]+(ST|ND|RD|TH)) ', 1), '') end as cross_n
         from cipn0),
hood_names as (select distinct upper(n) as hn from (select area as n from hoods union select neighborhood from hoods) where length(n) >= 5
                     and not regexp_matches(street_norm(n), '^(N|S|E|W|NE|NW|SE|SW)$')),   -- "Northeast" isn't a name in a title
cip_hoods as (select c.pid, list(street_norm(h.hn)) as hns from cipn c join hood_names h on c.tn like '% ' || street_norm(h.hn) || ' %' group by c.pid),
cip_station as (select c.pid, s.geom from cipn c join stations s on c.tn like '% ' || street_norm(s.name) || ' %'),
streets_at as (   -- the streets a place is on: a block's own street, or both streets of an intersection
  select distinct location, street_norm(s) as s
  from (select location, unnest(string_split(regexp_replace(location, ' BETWEEN .*$', ''), ' AND ')) as s from locations)
),
cand0 as (        -- each street, and for a named street with a leading direction, the name without it
  select location, s as full_s, s as m, false as dropped from streets_at where s like '% %'
  union
  select location, s, regexp_replace(s, '^(N|S|E|W|NE|NW|SE|SW) ', ''), true from streets_at
  where regexp_matches(s, '^(N|S|E|W|NE|NW|SE|SW) [A-Z]') and regexp_replace(s, '^(N|S|E|W|NE|NW|SE|SW) ', '') like '% %'
),
-- Shorter names a title may use for a street: without the direction after it ("E Marginal Way" for E Marginal Way S);
-- without "St"/"Ave"/... ("NE 125th" for NE 125th St, "Roosevelt" for Roosevelt Way NE, "145th" for N and NE 145th St,
-- which are one street). A name without its street type links only when the title goes on with a corridor word
-- ("Roosevelt Multimodal Corridor") or names a crossing ("Roosevelt and 85th"), and never when the title gives a
-- different type or a direction in front of it.
cand1 as (
  select location, full_s, regexp_replace(m, ' (N|S|E|W|NE|NW|SE|SW)$', '') as m, dropped from cand0
  where regexp_matches(m, '. (N|S|E|W|NE|NW|SE|SW)$') and regexp_replace(m, ' (N|S|E|W|NE|NW|SE|SW)$', '') like '% %'
),
bare0 as (
  select location, full_s, regexp_replace(m, ' (ST|AVE|WAY|PL|BLVD|DR|RD|CT|LN|TER|PKWY)$', '') as m, dropped
  from (select * from cand0 union select * from cand1)
  where regexp_matches(m, ' (ST|AVE|WAY|PL|BLVD|DR|RD|CT|LN|TER|PKWY)$')
),
bare as (
  select * from bare0 where regexp_matches(m, '^(N|S|E|W|NE|NW|SE|SW) [0-9]+(ST|ND|RD|TH)$')        -- NE 125th
     or (not regexp_matches(m, '[0-9]') and length(replace(m, ' ', '')) >= 5 and not regexp_matches(m, '^(N|S|E|W|NE|NW|SE|SW) '))
  union                                                                                              -- 145th (N, NE, NW)
  select location, full_s, regexp_replace(m, '^(N|NE|NW) ', ''), true from bare0 where regexp_matches(m, '^(N|NE|NW) [0-9]+(ST|ND|RD|TH)$')
),
forms as (
  select *, 'full' as kind from cand0 union select *, 'nodir' from cand1 union select *, 'bare' from bare
),
fam as (          -- one street under its spellings: N, NE and NW of a numbered street are one street (N 145th St runs
                  -- on as NE 145th St); SDOT sometimes writes a direction inside the name (Roosevelt N Way NE)
  select *, regexp_replace(regexp_replace(full_s, '^(N|NE|NW) ([0-9])', 'N \2'), '(\S) (N|S|E|W) (\S)', '\1 \3', 'g') as f from forms
),
amb_lead as (     -- a name without its leading direction that fits more than one street: E and W Harrison St
  select m from fam where dropped group by m having count(distinct f) > 1
),
amb_tail as (     -- a name without its direction after it or its type that fits more than one street: 3rd Ave, 3rd Ave N
  select m from fam where kind <> 'full' or not dropped group by m having count(distinct f) > 1
),
hits0 as (
  select distinct k.location, k.full_s, k.f, k.m,
         (k.dropped and k.m in (select m from amb_lead)) or (k.kind <> 'full' and k.m in (select m from amb_tail)) as amb,
         c.pid, c.title, c.y0, c.y1
  from fam k join cipn c on c.tn like '% ' || k.m || ' %'
  join locations l using (location)
  left join cip_hoods h on h.pid = c.pid
  where (h.hns is null or list_has_any(h.hns, [street_norm(coalesce(l.area, '')), street_norm(coalesce(l.neighborhood, ''))]))
    and (c.cross_n is null or ' ' || street_norm(l.location) || ' ' like '% ' || c.cross_n || ' %')
    and (k.kind = 'full' or not regexp_matches(c.tn, ' (N|S|E|W|NE|NW|SE|SW) ' || k.m || ' ') or regexp_matches(k.m, '^(N|S|E|W|NE|NW|SE|SW) '))
    and (k.kind <> 'bare' or (not regexp_matches(c.tn, ' ' || k.m || ' (ST|AVE|WAY|PL|BLVD|DR|RD|CT|LN|TER|PKWY) ')
         and (regexp_matches(k.m, '[0-9]') or c.cross_n is not null
              or regexp_matches(c.tn, ' ' || k.m || ' (CORRIDOR|MULTIMODAL|COMPLETE|SAFETY|TRANSIT|IMPROVEMENTS?|REPAVING|PAVING) '))))
    and (c.pid not in (select pid from cip_station)
         or exists (select 1 from cip_station st join loc_pts lp on lp.location = l.location where st.pid = c.pid and ST_DWithin(st.geom, lp.geom, station_area_ft())))
    -- a direction written after the street in the title must be the place's own (1st Ave S is not 1st Ave)
    and not regexp_matches(c.tn, ' ' || k.m || ' (N|S|E|W|NE|NW|SE|SW) ')
    -- a bridge, viaduct or tunnel project is about that structure, so only places on a structure match it
    --   (on the structure itself: a ramp leading to a bridge isn't the bridge)
    and (not regexp_matches(c.tn, ' (BRIDGE|BRDG|VIADUCT|TUNNEL|SPAN) ') or (l.structure and regexp_matches(' ' || l.location || ' ', ' (BR|BRIDGE|VI|VIADUCT|TUNNEL|TUN|SPAN) ')))
),
settled as (      -- an ambiguous name counts only when the rules above left places on one of its streets
  select pid, m from hits0 where amb group by pid, m having count(distinct f) = 1
),
hits as (
  select distinct location, pid, title, y0, y1 from hits0 h
  where not amb or exists (select 1 from settled s where s.pid = h.pid and s.m = h.m)
)
select location, list({'c': pid, 't': title, 'y0': y0, 'y1': y1} order by y1 desc, pid) as cip
from hits group by location;

create or replace table locations as
select l.*, j.cip from locations l left join loc_cip j using (location);

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
    'list': (select list({'id': id, 'kind': kind, 'stage': stage, 'name': name, 'scope': scope, 'year': year, 'work': work,
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
                            where not coalesce(planning = 'Y' or (planning is null and year <= year(current_date)), false)),
      'safety_planned': (select count(*) from proj where kind = 'safety' and stage = 'planned'),
      'safety_done': (select count(*) from proj where kind = 'safety' and stage = 'done'),
      'lpi_planned': (select count(*) from proj where kind = 'lpi'),
      'locations_with_plans': (select count(*) from locations where proj_planned)
    }
  } as projects
) to 'site/data/projects.json' (format json, array false);
