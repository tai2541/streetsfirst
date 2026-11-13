// The picture shown when a link to the site is shared (messages, social posts): Seattle's outline with this week's top
// places as dots, the site's name and the data date. Everything on it comes from this week's data and settings.
// Writes an HTML page that run.ps1 photographs with a headless browser at 1200 x 630 (the size link previews use).
// Usage: node pipeline/share_image.js <site dir> <fetched_at.txt> <out.html>
const fs = require('fs'), path = require('path');
const [site, fetchedFile, out] = process.argv.slice(2);
const read = f => JSON.parse(fs.readFileSync(path.join(site, 'data', f), 'utf8'));
const meta = read('meta.json'), boundary = read('boundary.json').boundary, places = read('priorities.json');
const cfg = meta.cfg || {};
const top = cfg.top_n;
if (!top) throw new Error('share_image: no top_n setting in meta.json');
const fetched = fs.readFileSync(fetchedFile, 'utf8').trim().slice(0, 10);
const asOf = new Date(fetched + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const icon = fs.readFileSync(path.join(site, 'favicon.svg'), 'utf8');

// Map area: the right part of the card. Equirectangular, scaled for Seattle's latitude.
const W = 1200, H = 630, box = { x: 700, y: 30, w: 470, h: 570 };
const polys = boundary.type === 'MultiPolygon' ? boundary.coordinates : [boundary.coordinates];
const all = polys.flat(2);
const lon0 = Math.min(...all.map(p => p[0])), lon1 = Math.max(...all.map(p => p[0]));
const lat0 = Math.min(...all.map(p => p[1])), lat1 = Math.max(...all.map(p => p[1]));
const k = Math.cos(((lat0 + lat1) / 2) * Math.PI / 180);
const s = Math.min(box.w / ((lon1 - lon0) * k), box.h / (lat1 - lat0));
const ox = box.x + (box.w - (lon1 - lon0) * k * s) / 2, oy = box.y + (box.h - (lat1 - lat0) * s) / 2;
const X = lon => ox + (lon - lon0) * k * s, Y = lat => oy + (lat1 - lat) * s;
const d = polys.map(poly => poly.map(ring => 'M' + ring.map(([lo, la]) => `${X(lo).toFixed(1)},${Y(la).toFixed(1)}`).join('L') + 'Z').join('')).join('');
const topPlaces = places.filter(p => p.rank != null && p.rank <= top && p.lat && p.lon).sort((a, b) => b.rank - a.rank);
if (topPlaces.length < top / 2) throw new Error(`share_image: only ${topPlaces.length} top places with a location`);
const dots = topPlaces.map(p => `<circle cx="${X(p.lon).toFixed(1)}" cy="${Y(p.lat).toFixed(1)}" r="${p.rank <= 10 ? 9 : 6}" fill="#e63946" stroke="#fff" stroke-width="2"/>`).join('');

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
  body { background: linear-gradient(135deg, #1d3461, #101b33); color: #fff; font-family: 'Segoe UI', Arial, sans-serif; position: relative; }
  .txt { position: absolute; left: 64px; top: 70px; width: 600px; }
  .brand { display: flex; align-items: center; gap: 18px; font-size: 34px; font-weight: 700; letter-spacing: .01em; }
  .brand svg { width: 64px; height: 64px; }
  h1 { font-size: 58px; line-height: 1.08; margin: 44px 0 26px; font-weight: 800; }
  p { font-size: 27px; line-height: 1.35; margin: 0; color: #d6deec; }
  .date { position: absolute; left: 64px; bottom: 56px; font-size: 22px; color: #f2b632; font-weight: 600; }
  .map { position: absolute; left: 0; top: 0; }
</style></head><body>
  <svg class="map" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <path d="${d}" fill="rgba(255,255,255,.10)" stroke="rgba(255,255,255,.55)" stroke-width="2" stroke-linejoin="round"/>${dots}
  </svg>
  <div class="txt">
    <div class="brand">${icon.replace(/<svg /, '<svg width="64" height="64" ')}Streets First · Seattle</div>
    <h1>Where streets hurt people most</h1>
    <p>And whether it's getting fixed. Red dots: the ${top} places with the highest expected harm, estimated from past crashes that killed or hurt people.</p>
  </div>
  <div class="date">Data as of ${asOf} · rebuilt every week</div>
</body></html>`;
fs.writeFileSync(out, html);
console.log(`Share image page: ${topPlaces.length} top places, data as of ${asOf}`);
