// The published downloads (data/ranks.csv, data/ranks.geojson, data/streets.csv) checked before publishing: every row has
// as many columns as the header, the map layer has the same places as the spreadsheet, the score's parts add up to its
// expected harm, points fall in Seattle, and every intersection has SDOT's key. Usage: node pipeline/check_downloads.js <site dir>
'use strict';
const fs = require('fs');
const path = require('path');
const dir = process.argv[2] || path.join(__dirname, '..', 'site');
const problems = [];
const read = f => fs.readFileSync(path.join(dir, f), 'utf8').replace(/^﻿/, '');

// A CSV file as rows of fields (quoted fields may hold commas, quotes and line breaks).
function csv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
function table(file) {
  const rows = csv(read(file)), head = rows[0] || [];
  rows.slice(1).forEach((r, i) => { if (r.length !== head.length) problems.push(`${file} row ${i + 2}: ${r.length} columns, header has ${head.length}`); });
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const inCity = (lat, lon) => lat > 47.48 && lat < 47.74 && lon > -122.46 && lon < -122.22;

try {
  const R = table('data/ranks.csv');
  if (R.length < 1000) problems.push(`ranks.csv has only ${R.length} places`);
  const col = k => { const h = Object.keys(R[0] || {}).find(x => x.startsWith(k)); if (!h) problems.push(`ranks.csv has no column "${k}..."`); return h; };
  const cLat = col('Latitude'), cLon = col('Longitude'), cType = col('Type'), cIk = col('SDOT intersection key'), cSk = col('SDOT street segment key');
  const parts = ['Score part: harm from', "Score part: this place's own", 'Score part: deaths and serious injuries typical', 'Score part: crashes of unknown'].map(col);
  const cEh = col('Expected harm (the four parts'), cBoost = col('Repair-request boost'), cScore = col('Score (expected harm');
  let bad = { pt: [], sum: [], key: [], score: [] };
  for (const r of R) {
    if (!inCity(+r[cLat], +r[cLon])) bad.pt.push(r.Rank);
    const s = parts.reduce((t, p) => t + +r[p], 0);
    if (Math.abs(s - +r[cEh]) > 0.05) bad.sum.push(r.Rank);
    if (Math.abs(+r[cEh] * +r[cBoost] - +r[cScore]) > Math.max(0.1, 0.001 * +r[cScore])) bad.score.push(r.Rank);
    if (r[cType] === 'Intersection' ? !r[cIk] : r[cType] === 'Stretch' && !r[cSk]) bad.key.push(r.Rank);
  }
  if (bad.pt.length) problems.push(`ranks.csv: ${bad.pt.length} places outside Seattle (ranks ${bad.pt.slice(0, 5).join(', ')})`);
  if (bad.sum.length) problems.push(`ranks.csv: score parts don't add up to expected harm (ranks ${bad.sum.slice(0, 5).join(', ')})`);
  if (bad.score.length) problems.push(`ranks.csv: expected harm x boost isn't the score (ranks ${bad.score.slice(0, 5).join(', ')})`);
  // a few places have no key in SDOT's records; more than a sliver means a join broke
  if (bad.key.length > 0.02 * R.length) problems.push(`ranks.csv: ${bad.key.length} places without SDOT's key`);

  const G = JSON.parse(read('data/ranks.geojson'));
  if (G.type !== 'FeatureCollection' || !Array.isArray(G.features)) problems.push('ranks.geojson is not a FeatureCollection');
  else {
    if (G.features.length !== R.length) problems.push(`ranks.geojson has ${G.features.length} places, ranks.csv ${R.length}`);
    const off = G.features.filter((f, i) => { const [lon, lat] = f.geometry.coordinates;
      return !inCity(lat, lon) || f.properties.rank !== +R[i].Rank || f.properties.place !== R[i]["Place (SDOT's name; the two sides of a divided street merged)"]; });
    if (off.length) problems.push(`ranks.geojson: ${off.length} places out of place or not matching ranks.csv (e.g. rank ${off[0].properties.rank})`);
  }

  const S = table('data/streets.csv');
  if (S.length < 100) problems.push(`streets.csv has only ${S.length} streets`);
} catch (e) { problems.push('downloads: ' + e.message); }

if (problems.length) { problems.forEach(p => console.log('DOWNLOAD CHECK FAILED: ' + p)); process.exit(1); }
console.log('Downloads: ranks.csv, ranks.geojson and streets.csv check out.');
