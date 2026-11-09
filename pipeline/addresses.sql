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
