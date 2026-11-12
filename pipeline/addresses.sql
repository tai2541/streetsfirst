-- ---------------------------------------------------------------- street addresses, for search suggestions
-- King County's address points for Seattle (one per address; the units of a building aren't separate): house number,
-- street, ZIP and location. Nothing else is read (no parcel fields). Used only to suggest addresses while someone types
-- one in the search box, so a pin can be placed without asking an outside address service.
-- Out: addr_streets (one row per street: its name as shown, a lowercase key for matching, which file holds it) and
-- addr_shards (one row per file: each street's house numbers and locations).
create or replace table addr_pts as
select f.properties.ADDR_NUM::int as num,
       nullif(trim(f.properties.ADDR_PD), '') as pd, trim(f.properties.ADDR_SN) as sn,
       nullif(trim(f.properties.ADDR_ST), '') as st, nullif(trim(f.properties.ADDR_SD), '') as sd,
       f.properties.ZIP5 as zip,
       f.geometry.coordinates[2]::double as lat, f.geometry.coordinates[1]::double as lon
from (select unnest(features) f from read_json('data/raw/addresses_*.json', maximum_object_size = 50000000))
where f.properties.ADDR_NUM is not null and f.properties.ADDR_NUM > 0 and f.properties.ADDR_SN is not null
  and f.geometry.coordinates[2]::double between 47.4 and 47.8;

-- "120TH" -> "120th", "MARTIN LUTHER KING JR" -> "Martin Luther King Jr"; directions stay capitals (N, NE, SW).
create or replace macro addr_word(w) as upper(left(w, 1)) || lower(substr(w, 2));
create or replace table addr_streets as
with s as (
  select pd, sn, st, sd,
    concat_ws(' ', pd, array_to_string(list_transform(string_split(sn, ' '), lambda w: addr_word(w)), ' '),
              case when st is not null then addr_word(st) end, sd) as name,
    count(*) as n, mode(zip) as zip
  from addr_pts group by all
)
select row_number() over (order by name) - 1 as id, name, lower(name) as key, n, zip,
       hash(lower(name)) % 64 as shard
from s;

-- One entry per house number and street (a few numbers have more than one point: their average). Locations as whole
-- numbers of 1/100,000 degree from 47 N, 122 W (about 1 m), to keep the files small.
create or replace table addr_shards as
with a as (
  select s.shard, s.id, p.num,
    round((avg(p.lat) - 47) * 1e5)::int as y, round((avg(p.lon) + 122) * 1e5)::int as x
  from addr_pts p join addr_streets s on s.name = concat_ws(' ', p.pd,
       array_to_string(list_transform(string_split(p.sn, ' '), lambda w: addr_word(w)), ' '),
       case when p.st is not null then addr_word(p.st) end, p.sd)
  group by all
)
select shard, list({'s': id, 'a': flatten(nums)} order by id) as streets
from (select shard, id, list([num, y, x] order by num) as nums from a group by shard, id)
group by shard;

copy (select list([name, shard::varchar, zip] order by id) as streets from addr_streets) to 'site/data/addr_streets.json' (format json);
copy (select shard as s, streets from addr_shards order by shard) to 'data/addr.ndjson' (format json);

-- ---------------------------------------------------------------- plain street names
-- SDOT names each side of a divided street separately by adding a code just before the street type: "M L KING JR WR WAY S"
-- (west roadway), "N 107TH S ST". The page shows the plain name ("N 107th St") when all of these hold, and SDOT's own
-- spelling otherwise (and always in small print on the place's page, in downloads and in search):
--   1. the code is one of SDOT's roadway codes (WR/ER/NR/SR, or one direction letter), not the name's first word, and the
--      next word is a street type King County's addresses use (with SDOT's AV and WY read as AVE and WAY);
--   2. the name without it is a street King County has addresses on, and SDOT's name itself is not;
--   3. no two places (or streets) would end up with the same name, and no two streets in one name would read the same:
--      those keep SDOT's spelling, so a map pin's name always tells it apart.
-- No street is listed by hand; a new SDOT pattern just keeps SDOT's spelling.
create or replace macro sdot_to_addr(s) as regexp_replace(regexp_replace(s, ' AV( |$)', ' AVE\1', 'g'), ' WY( |$)', ' WAY\1', 'g');
create or replace table plain_parts as
with addr as (select distinct upper(concat_ws(' ', pd, sn, st, sd)) as s from addr_pts),
types as (select '(' || string_agg(distinct st, '|') || '|AV|WY)' as t from addr_pts where st is not null),
parts as (select distinct trim(unnest(string_split(regexp_replace(location, ' BETWEEN ', ' AND '), ' AND '))) as p from collisions),
q as (select p, regexp_replace(p, '^(\S.*) (WR|ER|NR|SR|N|S|E|W) ' || t || '( (N|S|E|W|NE|NW|SE|SW))?$', '\1 \3\4') as plain
      from parts, types where regexp_matches(p, '^(\S.*) (WR|ER|NR|SR|N|S|E|W) ' || t || '( (N|S|E|W|NE|NW|SE|SW))?$'))
select p, plain from q
where sdot_to_addr(plain) in (select s from addr) and sdot_to_addr(p) not in (select s from addr);

set variable plain_map = map_from_entries(coalesce((select list({'k': p, 'v': plain}) from plain_parts), []));
create or replace macro plain_part(e) as coalesce(map_extract_value(getvariable('plain_map'), trim(e)), trim(e));
create or replace macro plain_name(x) as
  case when contains(x, ' BETWEEN ')
       then plain_part(split_part(x, ' BETWEEN ', 1)) || ' BETWEEN '
            || array_to_string(list_transform(string_split(split_part(x, ' BETWEEN ', 2), ' AND '), lambda e: plain_part(e)), ' AND ')
       else array_to_string(list_transform(string_split(x, ' AND '), lambda e: plain_part(e)), ' AND ') end;
-- Names that would match another place's or street's: kept in SDOT's spelling.
create or replace table plain_keep as
with names as (
  select distinct location as x from collisions
  union select distinct trim(unnest(string_split(regexp_replace(location, ' BETWEEN .*$', ''), ' AND '))) from collisions),
m as (select x, sdot_to_addr(plain_name(x)) as k, plain_name(x) <> x as changed from names)
select x from m where changed and (k in (select k from m group by k having count(*) > 1)
  -- or two of its own streets would read the same ("between Fauntleroy Way SW and Fauntleroy Way SW")
  or len(list_distinct(string_split(regexp_replace(k, ' BETWEEN ', ' AND '), ' AND '))) < len(string_split(regexp_replace(k, ' BETWEEN ', ' AND '), ' AND ')));
