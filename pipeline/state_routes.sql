-- Read by build.sql after loc_pts and streets exist, before `locations`.
-- Which places are on a state highway, and who runs them, from WSDOT's own layers (fetched weekly):
--   * WSDOT's state route lines (increasing, decreasing and ramps), for where the routes run;
--   * WSDOT's access control: limited-access sections (freeways, the SR 99 tunnel and its ramps) are WSDOT's to run;
--   * WSDOT's state bridges (all are owned by Washington State or its ferries).
-- In cities over 25,000 people, a state highway on a city street that isn't limited access is run by the city (RCW 47.24):
-- in Seattle that is Aurora Ave N north of the ship canal, Lake City Way, NE 145th St, Montlake Blvd, East and West
-- Marginal Way, and others. Those count as city streets everywhere on the site; only places WSDOT runs are set apart.

-- Each place's shape: an intersection's point, or a block's own street line (falls back to its point).
create or replace table loc_shape as
select p.location, p.r, coalesce(b.geom, p.geom) as geom
from loc_pts p
left join (select loc_name, ST_Union_Agg(geom) as geom from streets group by loc_name) b
  on p.r = 40 and b.loc_name = p.location;

create or replace temp table sr_box as select ST_Buffer(ST_Envelope(ST_Union_Agg(geom)), 2000) as b from loc_shape;
create or replace table wsdot_routes as
select * from (
  select f.properties.StateRouteNumber::varchar as srn, gj_geom(f.geometry) as geom, filename like '%wsdot_ramps%' as ramp
  from (select unnest(features) as f, filename
        from read_json(['data/raw/wsdot_rt_inc_*.json', 'data/raw/wsdot_rt_dec_*.json', 'data/raw/wsdot_ramps_*.json'],
                       maximum_object_size = 50000000, filename = true))
  where f.geometry is not null)
where ST_Intersects(geom, (select b from sr_box));
-- WSDOT's access control by route: each piece's route number (RouteIdentifier "099i" -> 99) and whether it's limited access.
create or replace table wsdot_access as
select * from (
  select ltrim(regexp_extract(f.properties.RouteIdentifier::varchar, '^(\d+)', 1), '0') as rn,
         f.properties.RouteIdentifier::varchar as rid,
         f.properties.AccessControlTypeDescription::varchar like 'Limited%' as limited, gj_geom(f.geometry) as geom
  from (select unnest(features) as f from read_json('data/raw/wsdot_access_*.json', maximum_object_size = 50000000))
  where f.geometry is not null)
where ST_Intersects(geom, (select b from sr_box));
create or replace table wsdot_limited as select geom from wsdot_access where limited;
create or replace table wsdot_bridges as
select * from (
  select f.properties.StructureName::varchar as name, gj_geom(f.geometry) as geom
  from (select unnest(features) as f from read_json('data/raw/wsdot_bridges_*.json', maximum_object_size = 50000000))
  where f.geometry is not null)
where ST_Intersects(geom, (select b from sr_box));

-- A place is on a route when its own street runs along it: most of a block's line, or most of one of the street pieces
-- meeting at an intersection, within 50 ft of the route line. (Distance alone would also catch streets passing under a
-- bridge or over a tunnel.)
create or replace temp table sr_cand as
-- (art: SDOT's own class for the street piece, 4 = state route, 5 = freeway)
select s.location, r.srn, bool_or(r.ramp) as ramp, s.geom as part,
  sum(ST_Length(ST_Intersection(s.geom, ST_Buffer(r.geom, 50)))) / nullif(ST_Length(s.geom), 0) as share,
  (select max(artclass) from streets x where x.loc_name = s.location) as art
from loc_shape s join wsdot_routes r on s.r = 40 and ST_DWithin(s.geom, r.geom, 50)
group by s.location, r.srn, s.geom
union all
select p.location, r.srn, r.ramp, st.geom,
  ST_Length(ST_Intersection(st.geom, ST_Buffer(r.geom, 50))) / nullif(ST_Length(st.geom), 0), st.artclass
from loc_pts p join streets st on p.r <> 40 and ST_DWithin(p.geom, st.geom, 15)
join wsdot_routes r on ST_DWithin(st.geom, r.geom, 50);

create or replace table place_state as
-- The best-matching piece, all from one row. Ties (two pieces both fully along a route, e.g. a ramp and the street
-- beside it, or a street over the SR 99 tunnel and the cross street that is the route) are broken the same way every
-- build: a street before a ramp, then the shorter piece (the one that is most nearly the route itself), then the route.
with m as (
  select location, b.srn, b.ramp, b.part, b.art from (
    select location, arg_max({'srn': srn, 'ramp': ramp, 'part': part, 'art': art},
                             {'share': share, 'street': not ramp, 'short': -ST_Length(part), 'srn': srn}) as b
    from sr_cand where share > 0.5 group by location)
),
c as (
  select m.location,
    case when interstate(m.srn) then 'I-' || ltrim(m.srn, '0') else 'SR ' || ltrim(m.srn, '0') end as route,
    -- most of it along a limited-access section (any interstate or ramp is one). The ramp/interstate shortcut only holds
    -- when the place's own street (a block: the name before BETWEEN) is a state route, ramp, viaduct or tunnel by name:
    -- ramps merge onto City bridges (the West Seattle Bridge) and run beside them, which doesn't make the bridge WSDOT's.
    ((m.ramp or interstate(m.srn)) and regexp_matches(case when m.location like '% BETWEEN %' then split_part(m.location, ' BETWEEN ', 1)
      else m.location end, '\b(SR ?\d+|I ?5|I ?90|RP|VI|TUNNEL)\b')) or coalesce((select sum(ST_Length(ST_Intersection(m.part, ST_Buffer(l.geom, 50))))
      from wsdot_limited l where ST_DWithin(m.part, l.geom, 50)) / nullif(ST_Length(m.part), 0) > 0.5, false) as lim,
    m.ramp or interstate(m.srn) or exists(select 1 from wsdot_limited l where ST_DWithin(m.part, l.geom, 50)) as lim_near,
    (select arg_max(b.name, ST_Length(ST_Intersection(m.part, ST_Buffer(b.geom, 30)))) from wsdot_bridges b
      where ST_DWithin(m.part, b.geom, 30) and ST_Length(ST_Intersection(m.part, ST_Buffer(b.geom, 30))) > 0.5 * ST_Length(m.part)) as bridge,
    -- SDOT names its bridges, ramps, tunnels and highway pieces; a plain street can't be part of a freeway or state bridge
    -- (a block by its own street: "Cherry St between 6th Ave and Cherry St on RP" is Cherry St, not the ramp)
    on_structure(m.location) or regexp_matches(regexp_replace(m.location, ' BETWEEN .*', ''), '\b(SR ?\d+|I ?5|I ?90|RP|BR|TUNNEL|VI)\b') as struct,
    -- a street with a City name is WSDOT's only where both agencies say so: SDOT's street data classes it as a state route
    -- or freeway, and it runs along a limited-access section of its own route in WSDOT's access-control data (West Marginal
    -- Way S where it is SR 99's freeway; not 1st Ave over the SR 99 tunnel, or Lake City Way). "Along": the route's line inside the street's
    -- 50 ft band is at least half as long as the street plus that band (a route crossing a short block isn't along it).
    coalesce((select max(x) from (select ST_Length(ST_Intersection(ST_Union_Agg(a.geom), ST_Buffer(m.part, 50))) / (ST_Length(m.part) + 100) as x
      from wsdot_access a where a.limited and a.rn = ltrim(m.srn, '0') and ST_DWithin(a.geom, m.part, 50) group by a.rid)), 0) > 0.5
      and coalesce(m.art, 0) in (4, 5) and m.location like '% BETWEEN %' as along_lim,   -- (blocks only: a freeway section has no street-level intersections)
    -- and a piece named for the route itself (SR99 SB ...) on a section WSDOT lists as not limited access is a state
    -- highway the City runs, like any other (RCW 47.24)
    coalesce((select max(x) from (select ST_Length(ST_Intersection(ST_Union_Agg(a.geom), ST_Buffer(m.part, 50))) / (ST_Length(m.part) + 100) as x
      from wsdot_access a where not a.limited and a.rn = ltrim(m.srn, '0') and ST_DWithin(a.geom, m.part, 50) group by a.rid)), 0) > 0.5 as along_open
  from m
)
select location, route,
  case when (struct and (lim or bridge is not null)) or (not struct and along_lim) then 'wsdot'
       when (not struct and not lim_near and bridge is null) or (struct and not lim and bridge is null and along_open) then 'city' end as runs,
  bridge
from c
where (struct and (lim or bridge is not null)) or (not struct and along_lim)
   or (not struct and not lim_near and bridge is null) or (struct and not lim and bridge is null and along_open);
