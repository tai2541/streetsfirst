// Weekly check of everything on the site that can't come from the data: phone numbers, laws, City request forms, outside links.
//   1. Each fact in pipeline/outside_facts.json: the site still says it, and its official source page still says it.
//   2. Every City request form the site links to is still linked from the City's own pages.
//   3. Every outside link in the site's code still opens.
// Exit 1 with a list of problems if anything fails. Run by the weekly job (it opens a GitHub issue; the data update
// still goes ahead, so a City website redesign never freezes the crash data). Locally: node pipeline/check_outside.js
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const siteFiles = ['site/app.js', 'site/index.html'];
const site = siteFiles.map(read).join('\n');
const { facts, formPages } = JSON.parse(read('pipeline/outside_facts.json'));
const UA = 'Mozilla/5.0 (compatible; StreetsFirstFactCheck/1.0; +https://streetsfirst.org)';

// A page's readable text: tags and entities out, spaces collapsed.
const text = html => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&rsquo;|&#8217;/g, "'").replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');

async function get(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      return { status: r.status, body: await r.text() };
    } catch (e) {
      if (i >= tries) return { status: 0, body: '', error: e.message };
      await new Promise(res => setTimeout(res, 5000 * i));
    }
  }
}

(async () => {
  const problems = [];
  // 1. facts
  for (const f of facts) {
    for (const s of f.says) if (!site.includes(s)) problems.push(`${f.id}: the site no longer says "${s}" (update outside_facts.json to match the site)`);
    const r = await get(f.source);
    if (r.status !== 200) { problems.push(`${f.id}: source page ${f.source} returned ${r.status || r.error}`); continue; }
    const t = text(r.body);
    for (const e of f.expect) if (!new RegExp(e, 'i').test(t)) problems.push(`${f.id}: source page no longer says /${e}/ (${f.what}; ${f.source})`);
  }
  // 2. the City's request-form codes: each still linked from an official City page
  const codes = [...new Set([...site.matchAll(/CWI \+ '([A-Z0-9]+)'/g)].map(m => m[1]))];
  const linked = new Set();
  for (const u of formPages.pages) {
    const r = await get(u);
    if (r.status !== 200) { problems.push(`form page ${u} returned ${r.status || r.error}`); continue; }
    for (const m of r.body.matchAll(/cwi\/direct\/([A-Z0-9]+)/g)) linked.add(m[1]);
  }
  for (const c of codes) if (!linked.has(c)) problems.push(`City request form ${c} is no longer linked from the City's pages (the form may have moved or been renamed)`);
  if (!codes.length) problems.push('no City request-form codes found in site/app.js (did the RESOURCES list change?)');
  // 3. outside links in the site's code (skips links built from data, which contain ${...})
  const links = [...new Set([...site.matchAll(/https:\/\/[^\s"'`<>)\\]+/g)].map(m => m[0].replace(/[.,;]+$/, '')))]
    .filter(u => !u.includes('${') && !/^https:\/\/(server\.arcgisonline\.com|geocode\.arcgis\.com|nominatim\.openstreetmap\.org)/.test(u)
      && !/\{[a-z]\}/.test(u));
  for (const u of links) {
    const r = await get(u);
    if (r.status === 0 || r.status >= 400) problems.push(`link no longer opens (${r.status || r.error}): ${u}`);
  }
  console.log(`Checked ${facts.length} outside facts, ${codes.length} City request forms and ${links.length} outside links.`);
  if (problems.length) { problems.forEach(p => console.log('OUTSIDE CHECK FAILED: ' + p)); process.exit(1); }
  console.log('All outside facts and links check out.');
})();
