// Fails if the page's text types in a fact that can go stale: a number of years, months, feet, places, crashes..., a
// year, or a "top N", written into the words instead of read from the data (meta.cfg, the settings in build.sql, or a
// measured value). Every number a reader sees should change on its own when the data or a setting changes.
//   1. Prose in site/app.js and site/index.html (string and template text; code, comments and ${...} are skipped) is
//      searched for numbers next to a unit or a ranking word. Each hit must be on the allowlist below, with a reason.
//   2. Every cfg('key') the page asks for exists in site/data/meta.json's cfg (a missing one would print nothing).
//   3. .github/workflows/weekly.yml still runs once a week, since the page says the data is updated weekly.
// Run by check.ps1 before publishing. Locally: node pipeline/check_text.js
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

// Allowed hits: [file, text the line contains, why it can't go stale].
const ALLOW = [
  ['site/app.js', "'a quarter mile'", 'distWords(): the words for a distance, chosen from the number given'],
  ['site/app.js', "'half a mile'", 'distWords(): the words for a distance, chosen from the number given'],
  ['site/app.js', 'NEAR_M = 402', "the page's own setting, defined once; the text reads it"],
  ['site/app.js', 'STREET_M = 244', "the page's own setting, defined once; the text reads it"],
  ['site/app.js', 'this site\'s rule until November 2026', 'history: when the site changed its own method'],
  ['site/app.js', '80 m a minute', 'walking speed used to turn a distance into minutes'],
  ['site/app.js', 'PANDEMIC = [2020, 2021]', "the page's own setting, defined once (historic years); the text reads it"],
  ['site/app.js', 'a crash that hurt three people counts once', 'a made-up illustration of the rule, not a fact'],
  ['site/app.js', 'A spot with 5 crashes leans', 'a worked example of the formula; the percentages are computed'],
  ['site/app.js', 'Tier 1 (build first)', "SDOT's tiers start at 1 (its first priority); the last tier is read from the data"],
  ['site/app.js', 'blocks with a missing sidewalk are Tier 1', "the count is measured; Tier 1 is the name of SDOT's first tier"],
  ['site/app.js', '(Tier 1 = build first)', "SDOT's tiers start at 1 (its first priority)"],
  ['site/app.js', 'sorts them into Tier 1 to', "SDOT's tiers start at 1; the last tier is read from the data"],
  ['site/app.js', 'pavement condition (0–100,', 'the scale of the pavement condition index (always 0 to 100)'],
  ['site/app.js', "'the 1 place'", 'singular wording for a computed count'],
];

const NUMWORD = 'two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|fifty|hundred|hundreds|a quarter|half a|a dozen';
const UNIT = 'years?|months?|weeks?|days?|hours?|ft|feet|foot|miles?|mi|places?|spots?|crashes|levels?|tiers?|blocks?|stretches|intersections|people|members?|programs?|positions?|percent|%';
const PATTERNS = [
  new RegExp(`\\b(\\d[\\d,.]*|${NUMWORD})(-| )(${UNIT})\\b`, 'i'),             // "5 years", "200 ft", "five levels"
  new RegExp(`\\b(top|worst|tier|positions?|within|under|over|least|than)[- ](\\d[\\d,]*|${NUMWORD})\\b`, 'i'), // "top 50", "Tier 5", "at least 2"
  /\b(19[5-9]\d|20[0-4]\d)\b/,                                                    // a year
  /\b\d+\s*[–-]\s*\d+\b/,                                                         // a typed range "51–150"
  /[½¼¾]/,
];

const problems = [];
// Template literals span lines: track whether a line starts inside one.
function scanJs(file) {
  const lines = read(file).split(/\r?\n/);
  let inTpl = false, nest = [];
  lines.forEach((raw, k) => {
    const line = raw;
    const s = line.trim();
    // comment-only lines outside templates
    if (!inTpl && (/^\/\//.test(s) || /^\*/.test(s) || /^\/\*/.test(s))) return;
    // Run a small state machine across lines to know template state; collect prose
    let text = '', i = 0, mode = inTpl ? '`' : null;
    const stack = nest.slice();
    while (i < line.length) {
      const c = line[i], n = line[i + 1];
      if (!mode) {
        if (c === '/' && n === '/') break;
        if (c === "'" || c === '"' || c === '`') { mode = c; text += ' '; i++; continue; }
        if (c === '{') stack.push('{');
        if (c === '}') { const t = stack.pop(); if (t === '`') { mode = '`'; i++; continue; } }
        i++; continue;
      }
      if (c === '\\') { text += line[i + 1] || ''; i += 2; continue; }
      if (c === mode) { mode = null; text += ' | '; i++; continue; }
      if (mode === '`' && c === '$' && n === '{') { stack.push('`'); mode = null; text += ' # '; i += 2; continue; }
      text += c; i++;
    }
    inTpl = mode === '`'; nest = stack;
    if (mode === "'" || mode === '"') { /* unterminated plain string: ignore */ }
    check(file, k + 1, raw, text);
  });
}
function scanHtml(file) {
  const lines = read(file).split(/\r?\n/);
  let inScript = false;
  lines.forEach((raw, k) => {
    if (/<script\b/i.test(raw) && !/<\/script>/i.test(raw)) { inScript = true; return; }
    if (/<\/script>/i.test(raw)) { inScript = false; return; }
    if (inScript || /^\s*<!--/.test(raw)) return;
    // visible text and attribute values people read (title, content, aria-label, alt, placeholder)
    const attrs = [...raw.matchAll(/\b(title|content|aria-label|alt|placeholder)="([^"]*)"/g)].map(m => m[2]).join(' | ');
    const text = raw.replace(/<[^>]*>/g, ' | ') + ' | ' + attrs;
    check(file, k + 1, raw, text);
  });
}
function check(file, ln, raw, text) {
  // phone numbers are checked against their sources by check_outside.js; "hundred block" is an address term
  text = text.replace(/\(\d{3}\) \d{3}-\d{4}|\b\d{3}-\d{4}\b/g, ' ').replace(/hundred block/gi, ' ');
  if (!/[A-Za-z]{3,}/.test(text)) return;
  // only prose: at least three words in a row
  if (!/[A-Za-z']{2,}[ ,;:]+[A-Za-z']{2,}[ ,;:]+[A-Za-z']{2,}/.test(text)) return;
  const hit = PATTERNS.map(p => text.match(p)).find(Boolean);
  if (!hit) return;
  if (ALLOW.some(([f, t]) => f === file && raw.includes(t))) return;
  problems.push(`${file}:${ln}: typed-in "${hit[0].trim()}" in: ${raw.trim().slice(0, 160)}`);
}

scanJs('site/app.js');
scanHtml('site/index.html');

// 2. settings the page asks for
const app = read('site/app.js');
let cfg = {};
try { cfg = JSON.parse(read('site/data/meta.json')).cfg || {}; } catch (e) { problems.push('site/data/meta.json has no cfg (run the build first)'); }
for (const m of app.matchAll(/cfg\('([a-z_0-9]+)'\)/g)) if (!(m[1] in cfg)) problems.push(`site/app.js asks for setting "${m[1]}", which meta.json's cfg doesn't have`);

// 3. the page says "weekly": the scheduled run must still be weekly (one day of the week in the cron line)
const wf = read('.github/workflows/weekly.yml');
const cron = (wf.match(/cron:\s*['"]([^'"]+)['"]/) || [])[1];
if (!cron) problems.push('weekly.yml has no schedule, but the site says it is updated weekly');
else { const f = cron.trim().split(/\s+/); if (f.length !== 5 || f[2] !== '*' || f[3] !== '*' || !/^[0-6]$/.test(f[4])) problems.push(`weekly.yml's schedule "${cron}" isn't once a week, but the site says weekly`); }

const unused = ALLOW.filter(([f, t]) => !read(f).includes(t));
for (const [f, t] of unused) problems.push(`allowlist entry no longer matches anything (remove it): ${f}: ${t}`);

if (problems.length) { problems.forEach(p => console.log('TEXT CHECK FAILED: ' + p)); process.exit(1); }
console.log(`Text check: no typed-in facts in the page's text; ${Object.keys(cfg).length} settings, all found; weekly schedule OK.`);
