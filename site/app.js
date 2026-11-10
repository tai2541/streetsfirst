/* Streets First (Seattle): front end. Data comes from window.SITE_DATA (data/data.js). */
(function () {
  const D = window.SITE_DATA;
  if (!D || !D.meta || !window.L) {   // data file or map library didn't load (network hiccup, blocked file)
    document.body.insertAdjacentHTML('afterbegin', '<div role="alert" style="padding:16px;background:#fde8e8;font:16px system-ui">' +
      'The map couldn’t load its data. Please check your connection and reload the page.</div>');
    return;
  }
  D.details = D.details || {};   // filled per map area as places are opened (data/more/<cell>.js)
  const meta = D.meta;
  // Search, "Is it getting fixed?" and the budget come in a second file (data/data-late.js), asked for only now that the
  // map's own data is in, so the first screen doesn't share the connection with them. Same build fingerprint.
  const lateReady = new Promise(res => {
    // From another build (a deploy between the two files): its ranks wouldn't match this page's, so it isn't used.
    const check = L => (L && L.version && D.version && L.version !== D.version ? { failed: true, stale: true } : L || { failed: true });
    if (window.SITE_LATE) { res(check(window.SITE_LATE)); return; }
    let done = false;
    const end = L => { if (!done) { done = true; clearTimeout(t); res(check(L)); } };
    window.siteLateReady = end;
    const t = setTimeout(() => end({ failed: true }), 20000);
    const sc = document.createElement('script');
    sc.src = 'data/data-late.js' + (D.version ? '?v=' + D.version : '');
    sc.onload = () => end(window.SITE_LATE);          // also settles a file that loaded but didn't run
    sc.onerror = () => end({ failed: true });
    document.head.appendChild(sc);
  });
  let lateOK = false;
  const fmt = n => Number(n).toLocaleString('en-US');
  const money = n => (n < 0 ? '−' : '') + '$' + (Math.abs(n) >= 1e8 ? Math.round(Math.abs(n) / 1e6) + 'M' : Math.abs(n) >= 1e6 ? (Math.abs(n) / 1e6).toFixed(1) + 'M' : fmt(Math.round(Math.abs(n))));
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : (many || one + 's')}`;
  const ft = m => Math.round(m * 3.28084 / 10) * 10;        // meters -> feet, rounded to 10
  // whole years between two ISO dates (the scoring window and its test split are whole years)
  function yrsBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / (365.25 * 864e5)); }
  const monthYear = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  // A fix date SDOT gives only as a year is written Dec 30 or 31 in its data: show just the year (the pipeline does the same).
  const fixDate = (d, yo) => (yo || /-12-3[01]/.test(d) ? d.slice(0, 4) : monthYear(d));   // yo: the layer gives only the year
  // the scored crash window as "Jul 2021–Jun 2026" (window_to is its last day)
  const windowTxt = () => monthYear(meta.window_from) + '–' + monthYear(meta.window_to);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // SDOT's location names, made readable: abbreviations spelled out, travel direction in words, bridge markers dropped.
  const DIRW = { EB: 'eastbound', WB: 'westbound', NB: 'northbound', SB: 'southbound' };
  const ord = n => n + (/1[123]$/.test(n) ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n.slice(-1)] || 'th');
  function nicePart(u) {
    let t = ' ' + u.replace(/ - |-(?=[A-Z])/g, '–') + ' ';
    t = t.replace(/([ –])(W SEA BR?|WSB|W SEATTLE BR) /g, '$1WEST SEATTLE BR ')
      .replace(/ AV /g, ' AVE ').replace(/ AV /g, ' AVE ').replace(/ VI /g, ' VIADUCT ').replace(/ BV /g, ' BLVD ')
      .replace(/ (\d+) (AVE|ST|PL) /g, (m, n, k) => ` ${ord(n)} ${k} `)
      .replace(/ SR ?(\d+)/g, ' SR $1').replace(/ I ?(5|90|405) /g, ' I-$1 ')
      .replace(/ OFF RP /g, ' OFF-RAMP ').replace(/ ON RP /g, ' ON-RAMP ').replace(/ RP /g, ' RAMP ');
    // one travel direction goes to the end in words; several stay where they are, in words
    const dirs = t.match(/ (EB|WB|NB|SB)(?= )/g) || [];
    if (dirs.length === 1) t = t.replace(/ (EB|WB|NB|SB) /, ' ') + `(${DIRW[dirs[0].trim()]})`;
    else t = t.replace(/ (EB|WB|NB|SB)(?= )/g, (m, d) => ' ' + DIRW[d]);
    t = t.trim().replace(/\s+/g, ' ');
    t = t.toLowerCase().replace(/(^|[\s–(])([a-z])/g, (m, a, c) => a + c.toUpperCase())
      .replace(/\b(Ne|Nw|Se|Sw|N|S|E|W)\b/g, m => m.toUpperCase())
      .replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase())
      .replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (m, n, s) => n + s.toLowerCase())
      .replace(/\bSr (\d)/g, 'SR $1')
      .replace(/\bWy\b/g, 'Way').replace(/\bBr\b/g, 'Bridge')
      .replace(/\b(On|Off)-[Rr]amp\b/g, m => m.toLowerCase()).replace(/\bRamp\b/g, 'ramp')
      .replace(/\((\w+bound)\)/gi, (m, d) => '(' + d.toLowerCase() + ')').replace(/\b(Northbound|Southbound|Eastbound|Westbound)\b/g, m => m.toLowerCase())
      .replace(/\bM L King Jr (?:[A-Z][a-z] )?(?:([NS]) )?Way\b/g, (m, d) => 'Martin Luther King Jr Way' + (d ? ' (' + d + ')' : ''));
    return t;
  }
  function niceName(s) {
    const b = s.split(' BETWEEN ');
    if (b.length === 2) {
      const main = nicePart(b[0]);
      // SDOT marks points along bridges as "POINT A", "POINT B": not places anyone knows, so name the real end only
      const ends = b[1].split(' AND ').map(e => e.trim()).filter(e => !/^POINT [A-Z]$/.test(e));
      if (ends.length === 2) return `${main} between ${nicePart(ends[0])} and ${nicePart(ends[1])}`;
      if (ends.length === 1) return `${main} near ${nicePart(ends[0])}`;
      return main;
    }
    return s.split(' AND ').map(nicePart).join(' & ');
  }
  // SDOT's crash-type codes in plain words (the common ones; anything else is shown as SDOT writes it)
  const CRASH_WORDS = {
    'Entering at angle': 'Side impact at an angle',
    'One parked--one moving': 'Hit a parked vehicle',
    'Fixed object': 'Hit a fixed object (pole, wall, tree)',
    'From same direction - both going straight - one stopped - rear-end': 'Rear-end: one vehicle stopped',
    'From same direction - both going straight - both moving - sideswipe': 'Sideswipe, same direction',
    'From opposite direction - one left turn - one straight': 'Left-turning driver hit by oncoming traffic',
    'From same direction - both going straight - both moving - rear-end': 'Rear-end, both moving',
    'Vehicle going straight hits pedestrian': 'Driver going straight hit a person walking',
    'From same direction - all others': 'Same direction, other',
    'Vehicle Strikes Pedalcyclist': 'Driver hit a person on a bike',
    'Vehicle turning left hits pedestrian': 'Driver turning left hit a person walking',
    'Pedalcyclist Strikes Moving Vehicle': 'Person on a bike hit a moving vehicle',
    'One car leaving parked position': 'Car pulling out of parking',
    'From same direction - one right turn - one straight': 'Right-turning and straight-going vehicles, same direction',
    'From same direction - one left turn - one straight': 'Left-turning and straight-going vehicles, same direction',
    'From opposite direction - all others': 'Opposite directions, other',
    'Vehicle turning right hits pedestrian': 'Driver turning right hit a person walking',
    'From same direction - both going straight - one stopped - sideswipe': 'Sideswipe of a stopped vehicle',
    'From opposite direction - both going straight - sideswipe': 'Sideswipe, opposite directions',
    'From opposite direction - both moving - head-on': 'Head-on',
    'One car entering parked position': 'Car pulling into parking',
    'Vehicle overturned': 'Vehicle overturned',
    'Vehicle backing hits pedestrian': 'Driver backing up hit a person walking',
    'Vehicle hits Pedestrian - All Other Actions': 'Driver hit a person walking (other)'
  };
  const crashType = t => CRASH_WORDS[t] || t.replace(/\s*--\s*/g, ', ');
  // Reporting is the point: people who see a problem should be one click from telling the City.
  const REPORT_URL = 'https://www.seattle.gov/customer-service-bureau#popular';
  // Where to go for what. City forms only; on purpose no encampment or parking-enforcement links (this map is about fixing streets).
  const CWI = 'https://seattle-cwiprod.motorolasolutions.com/cwi/direct/';
  const RESOURCES = [
    ['Pothole', CWI + 'TRPOTHOL', 'SDOT'],
    ['Broken or damaged sidewalk', CWI + 'TRDMGSDW', 'SDOT'],
    ['Traffic signal or street sign problem', CWI + 'TRTFCMNT', 'SDOT (also faded crosswalks and road markings)'],
    ['Streetlight out', CWI + 'CLSTLT', 'Seattle City Light · (206) 684-7056'],
    ['Clogged storm drain', CWI + 'PUCLOGDR', 'Seattle Public Utilities'],
    ['Plants blocking a sidewalk, sign or view', CWI + 'OVERVEGI', 'Overgrown vegetation'],
    ['Illegal dumping', CWI + 'PUILDUMP', 'Seattle Public Utilities (also discarded needles)'],
    ['Unsafe walk or crossing near a school', 'https://seattle-cwiprod.motorolasolutions.com/cwi/select', 'In the City’s list, choose “Safe Routes to School”'],
    ['Curb ramp or accessibility barrier', 'https://www.seattle.gov/transportation/projects-and-programs/programs/ada-program/make-an-ada-request', 'SDOT ADA request'],
    ['Something else', 'https://seattle-cwiprod.motorolasolutions.com/cwi/select', 'Full list of City request types']
  ];
  const resItem = ([t, u, w]) => `<li><a class="res-link" href="${u}" target="_blank" rel="noopener">${t} ↗</a><span>${w}</span></li>`;
  const resourceList = () => `<ul class="res-list">${RESOURCES.map(([t, u, w]) =>
    `<li><a class="res-link" href="${u}" target="_blank" rel="noopener">${t} ↗</a><span>${w}</span></li>`).join('')}</ul>
    <p class="res-more"><b>Street flooding or a sewer backup right now?</b> Call Seattle Public Utilities, 24/7: <a href="tel:+12063861800">(206) 386-1800</a>.
      Danger to life: call 911.<br>Not sure? Call the City at <a href="tel:+12066842489">(206) 684-2489</a> (weekdays 8 to 5),
      use the <a href="https://www.seattle.gov/customer-service-bureau/find-it-fix-it-mobile-app" target="_blank" rel="noopener">Find It, Fix It app ↗</a>,
      or see <a href="${REPORT_URL}" target="_blank" rel="noopener">all popular services ↗</a>.</p>`;
  // The City's forms can't be pre-filled from a link (they only read the request type), so opening one copies the spot instead.
  const reportBox = place => `<div class="report" data-loc="${esc(place)}">
      <div><b>See a problem here?</b> Reports are how problems get on the City's repair list. Opening a form also copies
        this location (<b>${esc(place)}</b>) so you can paste it in.</div>
      <ul class="res-list">${RESOURCES.slice(0, 3).map(resItem).join('')}</ul>
      <details class="res-fold"><summary>More problem types</summary><ul class="res-list">${RESOURCES.slice(3).map(resItem).join('')}</ul></details></div>`;
  // ---------- who to contact, nearby school (for any point: spots carry these from the build; pins look them up) ----------
  const CTX = D.context || { council: [], schools: [] };
  const inRing = (x, y, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const inPoly = (x, y, g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)
    .some(poly => inRing(x, y, poly[0]) && !poly.slice(1).some(h => inRing(x, y, h)));
  const councilAt = (lat, lon) => (CTX.council || []).find(c => c.geom && inPoly(lon, lat, c.geom)) || null;
  const metersBetween = (a, b, c, d) => {
    const k = Math.PI / 180, x = (d - b) * k * Math.cos((a + c) / 2 * k), y = (c - a) * k;
    return 6371000 * Math.hypot(x, y);
  };
  const schoolNear = (lat, lon) => {   // nearest public school within 1,000 ft
    let best = null;
    (CTX.schools || []).forEach(([n, la, lo]) => { const m = metersBetween(lat, lon, +la, +lo); if (m <= 305 && (!best || m < best.m)) best = { name: n, m }; });
    return best;
  };
  // Capitals at the start of each word only ("Int'l", not "Int'L"); K-8 stays as written.
  const schoolName = n => String(n).toLowerCase().replace(/(^|[\s-])\w/g, c => c.toUpperCase()).replace(/\bK-8\b/i, 'K-8');
  // The council member for a place, the City's equity index (spots only), and a print button.
  function civicBox(c, rse) {
    if (!c) return '';
    return `<div class="civic">
      <div><b>Bigger fixes</b> (redesigns, signals, sidewalks) are paid for through the City budget, which the City Council
        votes on. The council member for this district: <b>${esc(c.member || '—')}</b> (District ${c.d})${c.url
          ? (/^https:\/\//.test(c.url) ? ` · <a href="${esc(c.url)}" target="_blank" rel="noopener">Their page ↗</a>` : '') : ''}. Seattle also has two citywide
        council members (Positions 8 and 9).${c.d2 ? ` This place is on the line between District ${c.d} and District ${c.d2}
        (the boundary runs down the street), so it's listed in both districts; the district totals count it in District ${c.d}.` : ''}
        <a href="#progress=d${c.d}">Is it getting fixed in District ${c.d}?</a></div>
      ${rse && rse.q ? `<div class="note">How the City ranks this neighborhood for investment (its Race and Social Equity Index, by census tract): <b>${esc(({ 'Highest Equity Priority': 'highest equity priority',
          'Second Highest': 'second-highest equity priority', 'Middle': 'middle', 'Second Lowest': 'second-lowest equity priority',
          'Lowest': 'lowest equity priority' })[rse.q] || rse.q)}</b> (of five levels${rse.y ? `, ${rse.y} index` : ''}).
        The City uses it to help decide where to invest first. Shown for context; it isn't part of this site's score.</div>` : ''}
      <button type="button" class="linkbtn print-btn">Print or save this summary</button>
    </div>`;
  }
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.print-btn')) window.print(); });
  // Printed or saved pages say what they are, when the data is from, the source, and the link back.
  window.addEventListener('beforeprint', () => {
    const d = document.getElementById('detail'); if (!d) return;
    let h = d.querySelector('.print-head'); if (!h) { h = document.createElement('div'); h.className = 'print-head'; d.prepend(h); }
    const asOf = D.fetchedAt ? new Date(D.fetchedAt.replace(' ', 'T')) : null;
    h.textContent = `Streets First · Seattle — ${asOf && !isNaN(asOf) ? 'data as of ' + asOf.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) + ' — ' : ''}` +
      `from SDOT's police-reported crash data and SDOT's published records — ${location.href}`;
  });

  // One status region for screen readers, outside every panel (panels can be hidden or inert when a message is sent).
  const srLive = document.createElement('div');
  srLive.className = 'sr-only'; srLive.setAttribute('role', 'status'); srLive.setAttribute('aria-live', 'polite');
  document.body.appendChild(srLive);
  function announce(t) { srLive.textContent = ''; setTimeout(() => (srLive.textContent = t), 60); }
  const toast = msg => {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('aria-hidden', 'true'); document.body.appendChild(t); }
    announce(msg);
    t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 4000);
  };
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('.res-link'); if (!a) return;
    const box = a.closest('[data-loc]'); if (!box || !navigator.clipboard) return;
    const loc = /seattle/i.test(box.dataset.loc) ? box.dataset.loc : box.dataset.loc + ', Seattle, WA';
    navigator.clipboard.writeText(loc).then(() => toast('Location copied: ' + loc + '. Paste it into the form.'), () => {});
  });
  const copyLoc = place => `<button type="button" class="linkbtn copyloc" data-loc="${esc(place)}">Copy this location</button>`;
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.copyloc'); if (!b) return;
    const done = () => { b.textContent = 'Location copied'; setTimeout(() => (b.textContent = 'Copy this location'), 1800); };
    if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.loc + ', Seattle').then(done, () => prompt('Copy this location:', b.dataset.loc));
    else prompt('Copy this location:', b.dataset.loc);
  });

  const resDlg = document.getElementById('resources');
  document.getElementById('resBody').innerHTML = resourceList();
  document.getElementById('reportHead').addEventListener('click', e => { e.preventDefault(); resDlg.showModal(); });
  document.getElementById('resClose').addEventListener('click', () => resDlg.close());
  resDlg.addEventListener('click', e => { if (e.target === resDlg) resDlg.close(); });

  // ---------- ranking modes ----------
  const MODES = {
    ksi: { label: 'Most likely to hurt people', hint: 'Where crashes are most likely to kill or seriously hurt someone next, estimated from 5 years of every crash, not only the worst. The score adds up every crash here, weighted by how badly people were hurt; ▲ and ▼ show places that moved up or down the ranking since last month. Start here.', unit: 'score' },
    risk: { label: 'Most dangerous for how busy it is', hint: 'Crash harm for every million vehicles that pass through. Often quieter streets.', unit: 'per million vehicles' }
  };
  let mode = (() => { try { return JSON.parse(localStorage.getItem('ipm.mode')) || 'ksi'; } catch { return 'ksi'; } })();
  if (!MODES[mode]) mode = 'ksi';
  D.priorities.forEach(p => { p.rank_ksi = p.rank; p.name = niceName(p.location); });
  const byId = new Map(D.priorities.map(p => [p.rank_ksi, p]));   // the recommended rank doubles as a stable id
  const N = meta.locations_scored;
  function applyMode() {
    D.priorities.forEach(p => {
      p.rank = { ksi: p.rank_ksi, risk: p.rank_risk }[mode] ?? null;
      p.score = { ksi: p.score_ksi, risk: p.score_risk }[mode] ?? null;
    });
    byId.forEach(p => { if (p.more) { p.rank = { ksi: p.rank_ksi, risk: p.rank_risk }[mode] ?? null; p.score = { ksi: p.score_ksi, risk: p.score_risk }[mode] ?? null; } });
    // Locations without a rank in this mode (e.g. no traffic count for "risk") sort last and aren't shown.
    D.priorities.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
    document.getElementById('modeHint').textContent = MODES[mode].hint;
  }
  applyMode();
  const modeSel = document.getElementById('mode');
  modeSel.value = mode;
  modeSel.onchange = () => {
    mode = modeSel.value;
    try { localStorage.setItem('ipm.mode', JSON.stringify(mode)); } catch { /* ignore */ }
    applyMode(); closeDetail(false); render(); renderAbout();
  };

  document.getElementById('provenance').textContent =
    `Scored: ${fmt(meta.collisions_scored)} SDOT collision reports from ${monthYear(meta.window_from)} to ${monthYear(meta.window_to)} ` +
    `at ${fmt(N)} places, plus Find It Fix It repair requests. Data fetched ${(d => d && !isNaN(d)
      ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'unknown')(D.fetchedAt && new Date(D.fetchedAt.replace(' ', 'T')))}.`;

  const scoreText = p => (mode === 'risk' ? `${p.score.toFixed(1)} <small>harm points per million vehicles</small>` : `<small>score</small> ${fmt(Math.round(p.score))}`);
  const topShare = rank => { const s = (100 * rank) / kindCount(rank); return s < 1 ? `top ${Math.max(0.1, Math.ceil(s * 10) / 10)}%` : s <= 50 ? `top ${Math.ceil(s)}%` : 'lower half'; };

  // ---------- reasons: plain-language chips, most important first ----------
  function reasons(p) {
    const out = [];
    if (p.killed) out.push({ cls: 'fatal', text: `${p.killed} ${p.killed === 1 ? 'person' : 'people'} killed` });
    if (p.seriously_injured) out.push({ cls: 'serious', text: `${p.seriously_injured} seriously injured` });
    const pb = [p.ped_crashes ? `${p.ped_crashes} involved someone walking` : '', p.bike_crashes ? `${p.bike_crashes} involved someone on a bike` : ''].filter(Boolean);
    if (pb.length) out.push({ cls: 'ped', text: pb.join(', ') });
    const still = stillDangerous(p);
    if (still) out.push({ cls: 'sdot', text: still.short });
    patterns(p).forEach(t => out.push({ cls: 'fixable', text: t }));
    if (p.ksi_years >= 3) out.push({ cls: 'still', text: `killed or seriously hurt in ${p.ksi_years} different years` });
    if (p.injury) out.push({ cls: '', text: `${p.injury} injury crashes` });
    // (shown only when chance is an unlikely explanation: 15+ known crashes and under a 1-in-100 chance at the city's share)
    const wet = pct(p.wet_crashes, p.road_known), cityWet = Math.round(100 * meta.city_wet_share);
    if (p.road_known >= 15 && wet >= cityWet + 15 && binomUpper(p.wet_crashes, p.road_known, meta.city_wet_share) < 0.01) out.push({ cls: 'cond', text: `${wet}% on wet roads (city ${cityWet}%)` });
    const dark = pct(p.dark_crashes, p.light_known), cityDark = Math.round(100 * meta.city_dark_share);
    if (p.light_known >= 15 && dark >= cityDark + 15 && binomUpper(p.dark_crashes, p.light_known, meta.city_dark_share) < 0.01) out.push({ cls: 'cond', text: `${dark}% in the dark (city ${cityDark}%)` });
    if (p.unlit_crashes) out.push({ cls: 'cond', text: `${p.unlit_crashes} with streetlights off/none` });
    if (p.speeding_crashes >= 2 && pct(p.speeding_crashes, p.crashes) >= 15)
      out.push({ cls: 'cond', text: `speed-related: ${p.speeding_crashes} of ${p.crashes}` });
    if (p.state_route) out.push({ cls: 'state', text: `${p.state_route}: run by WSDOT` });
    if (!p.ksi) out.push({ cls: 'conf', text: 'no one killed or seriously hurt here in these years: ranked on its other crashes' });
    if (p.confidence !== 'high')
      out.push({ cls: 'conf', text: `only ${plural(p.crashes, 'crash', 'crashes')}, so less certain` });
    return out;
  }

  // Chance of k or more of n at rate q (binomial upper tail), for "more than the city's share" chips.
  function binomUpper(k, n, q) {
    let lf = [0]; for (let i = 1; i <= n; i++) lf[i] = lf[i - 1] + Math.log(i);
    let s = 0; for (let i = k; i <= n; i++) s += Math.exp(lf[n] - lf[i] - lf[n - i] + i * Math.log(q) + (n - i) * Math.log(1 - q));
    return s;
  }
  // Crash patterns that match a well-known fix this spot doesn't have yet (from SDOT's signal and Vision Zero data).
  // Stated as facts side by side; whether the fix fits is for engineers to judge.
  // "for 2026", or, once that year is over in SDOT's data (fetched later), say it's still listed as planned.
  function plannedFor(y) {
    if (!y) return '';
    const now = +(String(D.fetchedAt || '').slice(0, 4)) || new Date().getFullYear();
    return +y < now ? ` for ${esc(y)} (that year has passed; still listed as planned in SDOT's data)` : ` for ${esc(y)}`;
  }
  function patterns(p) {
    const out = [], n = p.crashes || 1, lt = p.left_turn_crashes || 0;
    // Left turns: enough of them, and a real share of this spot's crashes, before pointing at the signal phasing.
    const manyLeft = lt >= 5 && lt / n >= 0.15;
    if (p.addr_type === 'I') {
      if (p.signalized && p.lt_protected === false && manyLeft)
        out.push(`${lt} left-turn crashes; no protected left-turn arrow in SDOT signal data`);
      // No turn on red only covers right turns on red, so with it in place only drivers turning left are counted.
      const pedTurn = p.ntor_status === 'Existing' ? (p.ped_turn_crashes || 0) - (p.ped_right_crashes || 0) : p.ped_turn_crashes;
      if (p.signalized && p.lpi_status !== 'Existing' && pedTurn >= 2)
        out.push(`${pedTurn} people walking hit by drivers turning${p.ntor_status === 'Existing' ? ' left (no turn on red covers right turns)' : ''}; ${p.lpi_status === 'Planned'
          ? `head-start walk signal planned${plannedFor(p.lpi_planned)}` : p.lpi_status === 'Not Feasible'
          ? 'SDOT assessed a head-start walk signal as not feasible here' : 'no head-start walk signal'} (SDOT data)`);
      if (p.signalized && p.angle_crashes >= 10 && p.angle_crashes / (p.typed_crashes || n) >= 0.4)
        out.push(`${p.angle_crashes} of ${p.typed_crashes || n} crashes with a recorded type were vehicles hitting each other at an angle (from the side) at this signal: SDOT could check whether drivers can see the signal well and whether the yellow and red lights last long enough`);
      if (!p.signalized && p.angle_crashes >= 5)
        out.push(`${p.angle_crashes} angle crashes and no traffic signal (SDOT data): worth checking whether this corner needs a signal or stop signs`);
    } else {
      if (p.ped_crashes >= 3) out.push(`${p.ped_crashes} crashes with people walking, away from the corners: crossings, lighting and speed worth a look`);
      if (manyLeft) out.push(`${lt} left-turn crashes along this stretch, often at driveways or mid-block turns`);
    }
    return out;
  }

  // Already treated or listed by SDOT, and still hurting people.
  function stillDangerous(p) {
    const laterNtor = p.ntor_status === 'Existing' && p.ntor_installed && p.lpi_installed && p.ntor_installed > p.lpi_installed;
    if (p.lpi_status === 'Existing' && p.ped_after_lpi >= 2 && !laterNtor) {
      const y = p.lpi_installed ? p.lpi_installed.slice(0, 4) : '';
      const from = p.lpi_installed && p.lpi_installed > meta.window_from ? monthYear(p.lpi_installed) : monthYear(meta.window_from);
      return { short: `Head-start walk signal since ${y || 'an unknown year'}; pedestrians still hit here: ${p.ped_after_lpi} crashes since ${from}, ${p.ped_turn_after_lpi || 0} with a turning vehicle`,
        long: `SDOT added a head-start walk signal here in ${y || 'an unknown year'}. From ${from} to ${monthYear(meta.window_to)},
          ${p.ped_after_lpi} crashes involving pedestrians were reported (${p.ped_turn_after_lpi || 0} with a turning vehicle, the kind
          this signal targets). ${(p.before_after || []).some(b => b.m === 'ped')
            ? 'For the years before and after the signal, see "Before and after" below.'
            : 'Crash data from far enough before the signal isn\'t available here, so this doesn\'t show whether it helped, only that pedestrians are still being hit here.'}` };
    }
    const hy = p.sdot_hcl_years || [], first = hy[0], last = hy[hy.length - 1];
    if (first && first <= +meta.window_from.slice(0, 4) && p.ksi_after_hcl >= 2)
      return { short: `First on SDOT's High Collision list in ${first}${hy.length > 1 ? ` (listed ${hy.length} times, most recently ${last})` : ''}; ${plural(p.ksi_after_hcl, 'crash', 'crashes')} that killed or seriously hurt someone ${windowTxt()}`,
        long: `SDOT first put this on its High Collision Locations list in ${first}. Since then (in the scored years) ${p.ksi_after_hcl} crashes have killed or seriously injured someone. Being listed doesn't mean it was redesigned.` };
    return null;
  }

  // SDOT list membership as a compact row (instead of a chip on nearly every card).
  function sdotRow(p) {
    const parts = [];
    if (p.sdot_hin) parts.push(`High Injury Network: ${p.sdot_hin}`);
    if (p.sdot_hcl_years && p.sdot_hcl_years.length) parts.push(`High Collision list ${p.sdot_hcl_years.slice(-1)[0]}`);
    const w = workSummary(p);
    return (parts.length ? `<div class="sdotrow"><span class="sdot-mark" aria-hidden="true">SDOT</span> ${parts.join(' · ')}</div>` : '') +
      `<div class="workrow w-${w.cls}">${esc(w.short)}</div>`;
  }

  // What has been done here, in one line, from the layers this site reads (SDOT's data has gaps, so "nothing" is
  // always worded as "nothing recorded in these layers"). Budget projects are shown, never counted as fixes; a bus lane since then counts as work, but not as a safety fix.
  const projKind = j => (j.kind === 'lpi' ? 'head-start walk signal' : j.kind === 'sidewalk' ? 'new sidewalk' : (j.scope || 'safety project').toLowerCase().split(',')[0]);
  function workSummary(p) {
    const d0 = meta.window_from, since = monthYear(d0);
    const done = [], bus = [], at = (d, k) => ({ d, y: +d.slice(0, 4), k });
    if (p.lpi_status === 'Existing' && p.lpi_installed) done.push(at(p.lpi_installed, 'head-start walk signal'));
    if (p.lt_protected && p.lt_installed) done.push(at(p.lt_installed, 'protected left turn'));
    if (p.ntor_status === 'Existing' && p.ntor_installed) done.push(at(p.ntor_installed, 'no turn on red'));
    if (p.signalized && p.signal_installed && +p.signal_installed.slice(0, 4) >= 1990) done.push(at(p.signal_installed, 'signal installed or rebuilt'));
    (p.fixes || []).filter(f => f.s === 'Built' && f.d).forEach(f => (f.k === 'Bus lane' ? bus : done).push(at(f.d, f.k.toLowerCase())));
    // a finished project has a year only: counted as 1 July, as on "Is it getting fixed?"
    projectsAt(p).filter(j => j.stage === 'done' && j.year).forEach(j => done.push(at(j.year + '-07-01', projKind(j))));
    done.sort((a, b) => b.d.localeCompare(a.d) || a.k.localeCompare(b.k));
    const uniq = a => [...new Map(a.map(f => [f.k, f])).values()];
    const list = a => uniq(a).slice(0, 3).map(f => `${f.k} (${f.y})`).join(', ') + (uniq(a).length > 3 ? ', more' : '');
    const recent = done.filter(f => f.d >= d0), older = done.filter(f => f.d < d0);
    const planned = [...new Set(projectsAt(p).filter(j => j.stage !== 'done').map(projKind))];
    if (p.lpi_status === 'Planned' && !planned.includes('head-start walk signal')) planned.push('head-start walk signal');
    if (p.ntor_status === 'Planned') planned.push('no turn on red');
    const cip = p.cip || [];
    const parts = [];
    if (recent.length) parts.push(`Since ${since}: ${list(recent)}`);
    // a block: dated work at the intersections at its two ends (SDOT records corridor signal work there)
    const ends = (p.end_fixes || []).filter(f => f.d >= d0);
    if (ends.length) {
      const atC = [...new Set(ends.map(f => f.at))].map(a => `at ${nicePart(a)}: ` + uniq(ends.filter(f => f.at === a)
        .sort((a, b) => b.y - a.y || a.k.localeCompare(b.k)).map(f => ({ k: f.k.toLowerCase(), y: f.y }))).map(f => `${f.k} (${f.y})`).join(', '));
      parts.push(`${recent.length ? 'At' : 'Only at'} the corners at its ends since ${since} (they don't reach crashes along the block): ${atC.join('; ')}`);
    }
    if (planned.length) parts.push(`Planned here or nearby: ${planned.join(', ')}`);
    if (cip.length) parts.push(`Money budgeted ${cip[0].y0 === cip[0].y1 ? 'in ' + cip[0].y0 : cip[0].y0 + '–' + cip[0].y1} for a project named for this street, “${cip[0].t}” (it may not reach this spot)`);
    if (older.length) parts.push(`${recent.length ? 'Earlier' : 'Older work only'}: ${list(older)}`);
    const busNew = bus.filter(f => f.d >= d0);
    if (busNew.length) parts.push(`Bus lane (${busNew[0].y}), a transit project that changes the street`);
    else if (!recent.length && bus.length) parts.push(`Older bus lane (${bus[0].y})`);
    // in place, but SDOT's data gives no date: never "no work recorded"
    const undated = [...new Set([
      ...(p.lpi_status === 'Existing' && !p.lpi_installed ? ['head-start walk signal'] : []),
      ...(p.ntor_status === 'Existing' && !p.ntor_installed ? ['no turn on red'] : []),
      ...(p.lt_protected && !p.lt_installed ? ['protected left turn'] : []),
      ...(p.fixes || []).filter(f => f.s === 'Built' && !f.d).map(f => f.k.toLowerCase())])]
      .filter(k => !done.some(f => f.k === k) && !(k === 'bus lane' && bus.length));
    if (undated.length) parts.push(`In place with no install date in SDOT's data: ${undated.join(', ')}`);
    const cls = recent.length || busNew.length ? 'done' : planned.length || cip.length ? 'planned' : 'none';
    // say so when nothing is planned, since "what's planned here?" is the first question people bring
    if (parts.length && !planned.length && !cip.length) parts.push("nothing planned on SDOT's published project maps");
    const text = parts.length ? parts.join(' · ') : 'No work recorded here in the SDOT layers this site reads';
    return { cls, text, short: parts[0] || text };
  }

  // ---------- map ----------
  const map = L.map('map', { zoomControl: true, zoomSnap: 0.25, zoomAnimation: !reduceMotion }).setView([47.61, -122.33], 12);
  // Drawn shapes (circles, rings, lines) are reached through the list, not one Tab stop each.
  map.on('layeradd', e => { const el = e.layer.getElement && e.layer.getElement();
    if (el && el.tagName && el.tagName.toLowerCase() === 'path') { el.setAttribute('tabindex', '-1'); el.setAttribute('focusable', 'false'); } });
  const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  // Credits: each map layer's credit line exactly as Esri publishes it, fetched every week by the pipeline (D.credits),
  // with names that two layers share listed once.
  const credit = (...svcs) => {
    const seen = new Set(), parts = [];
    for (const s of svcs) for (const p of String((D.credits || {})[s] || 'Esri').replace(/^Sources?:\s*/i, '').split(/,\s*(?:and\s+)?|\s+and\s+/)) {
      const t = p.trim().replace(/\(c\)\s*/gi, '© '), key = t.toLowerCase().replace(/^© /, '');
      if (t && !seen.has(key)) { seen.add(key); parts.push(t); }
    }
    return 'Map: ' + esc(parts.join(', ')) + ' · Data: City of Seattle';
  };
  // Tiles load while the map is dragged (Leaflet waits until a drag ends on phones, which leaves blank squares behind
  // a pan) and a wider ring of tiles is kept around the screen, so panning back and forth doesn't load them again.
  const tile = (path, opts = {}) => L.tileLayer(esri + path + '/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, maxNativeZoom: 16, updateWhenIdle: false, updateInterval: 150, keepBuffer: 4, ...opts });
  const baseLayers = {
    'Light gray': L.layerGroup([
      tile('Canvas/World_Light_Gray_Base', { attribution: credit('Canvas/World_Light_Gray_Base', 'Canvas/World_Light_Gray_Reference') }),
      tile('Canvas/World_Light_Gray_Reference')
    ]),
    'Streets': tile('World_Street_Map', { maxNativeZoom: 19, attribution: credit('World_Street_Map') }),
    'Satellite': L.layerGroup([
      tile('World_Imagery', { maxNativeZoom: 19, attribution: credit('World_Imagery', 'Reference/World_Transportation') }),
      tile('Reference/World_Transportation', { maxNativeZoom: 19 })
    ])
  };
  baseLayers['Light gray'].addTo(map);
  // On a phone the credits fold into a small (i) button: open in full when the page loads, folded at the first touch
  // of the map (or after 8 seconds), and a tap on the button opens or folds them (links inside still work as links).
  // (The button sits next to Leaflet's credits box, not inside it: Leaflet rewrites the box when the base map changes.)
  { const at = map.attributionControl && map.attributionControl.getContainer();
    if (at) {
      at.id = 'mapCredits';
      const btn = L.DomUtil.create('button', 'attr-btn');
      btn.type = 'button'; btn.textContent = 'i'; btn.setAttribute('aria-label', 'Map credits'); btn.setAttribute('aria-controls', 'mapCredits');
      at.after(btn);
      const show = open => { at.classList.toggle('open', open); btn.setAttribute('aria-expanded', String(open)); };
      show(true);
      // the first fold is automatic (first touch of the map, or 8 seconds); after that only the button opens or folds them
      const timer = setTimeout(() => show(false), 8000);
      map.getContainer().addEventListener('pointerdown', e => {
        if (!at.contains(e.target) && e.target !== btn) { clearTimeout(timer); show(false); }
      }, { once: true });
      L.DomEvent.disableClickPropagation(btn); L.DomEvent.disableClickPropagation(at);
      btn.addEventListener('click', () => { clearTimeout(timer); show(!at.classList.contains('open')); });
    } }
  // Neighborhood names: the 20 large areas (Ballard, West Seattle...) when zoomed out, the 94 neighborhoods when zoomed in.
  map.createPane('labels'); map.getPane('labels').style.zIndex = 450; map.getPane('labels').style.pointerEvents = 'none';
  const hoodLabels = L.layerGroup((D.labels || []).map(l => Object.assign(L.marker([l.lat, l.lon], {
    pane: 'labels', interactive: false, keyboard: false,
    icon: L.divIcon({ className: 'hood-label lvl' + l.lvl, iconSize: null, html: `<span>${esc(l.n)}</span>` })
  }), { _label: l.n }))).addTo(map);
  // When names overlap, the best-known ones win.
  const WELL_KNOWN = ['Downtown', 'West Seattle', 'Ballard', 'Capitol Hill', 'Queen Anne', 'University District', 'Beacon Hill', 'Rainier Valley', 'Lake City', 'Northgate', 'Magnolia', 'Central Area', 'Fremont', 'Georgetown', 'Columbia City', 'Wallingford', 'Green Lake'];
  const rankOf = m => { const i = WELL_KNOWN.indexOf(m._label); return i < 0 ? 99 : i; };
  // Hide any name that would overlap one already drawn, so the names stay readable at every zoom.
  const declutter = () => {
    if (!map.hasLayer(hoodLabels)) return;
    const c = map.getContainer();
    c.classList.toggle('zoomed-in', map.getZoom() >= 13.5);
    c.classList.toggle('zoomed-out', map.getZoom() < 12);
    const kept = [];
    hoodLabels.getLayers().sort((x, y) => rankOf(x) - rankOf(y)).forEach(m => {
      const el = m.getElement(); if (!el) return;
      el.classList.remove('clash');
      const s = el.firstElementChild, r = s.getBoundingClientRect();
      if (!r.width) return;   // this level is hidden at this zoom
      const hit = kept.some(k => r.left < k.right + 4 && r.right > k.left - 4 && r.top < k.bottom + 2 && r.bottom > k.top - 2);
      if (hit) el.classList.add('clash'); else kept.push(r);
    });
  };
  map.on('zoomend overlayadd', declutter); declutter();

  // ---------- SDOT's published project maps: planned and recently finished work (context, never scored) ----------
  // Only what SDOT publishes on a map with a location: new sidewalk projects, Neighborhood-Initiated Safety Partnership
  // Program projects, and planned head-start walk signals. None carry budget numbers, so no dollars are shown per project.
  const PJ = D.projects || { list: [], missing_blocks: [], counts: {} };
  const PE = D.projEdited || {};
  const projById = new Map(PJ.list.map(j => [j.id, j]));
  // Projects within about 100 ft of an intersection or 40 ft of a block's street line (matched in pipeline/projects.sql).
  function projectsAt(p) { return (p.proj_ids || []).map(i => projById.get(i)).filter(Boolean); }
  const dateText = d => (d ? new Date(d + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
  const PROJ_SRC = {
    sidewalk: () => `SDOT's New Sidewalks map${PE.proj_sidewalk ? ` (last updated ${dateText(PE.proj_sidewalk)})` : ''}`,
    safety: () => `SDOT's Neighborhood-Initiated Safety Partnership Program map (a layer SDOT labels draft)${PE.proj_nispp ? ` (last updated ${dateText(PE.proj_nispp)})` : ''}`,
    lpi: () => `SDOT's head-start walk signal (Leading Pedestrian Interval) list`
  };
  const projTitle = j => j.kind === 'sidewalk' ? `New sidewalk: ${niceName(j.name.replace(/ BETWEEN /, ' between ').replace(/ AND /, ' and '))}`
    : j.kind === 'lpi' ? 'Head-start walk signal' : (j.name || 'Project (name not yet published by SDOT)');
  // SDOT's own words for each stage; a year SDOT lists for a project in design is a target, not a promise.
  const projStage = j => j.kind === 'sidewalk'
    ? (j.stage === 'design' ? `moving into design${j.year ? ` (SDOT lists ${j.year})` : ''}` : `completed${j.year ? ' ' + j.year : ''}`)
    : j.stage === 'done' ? `completed${j.year ? ' ' + j.year : ''}` : `planned${j.year ? ' for ' + j.year : ''}`;
  const projWhat = j => j.kind === 'sidewalk' ? (j.scope ? `${j.scope} sidewalk` : 'New sidewalk') : j.kind === 'lpi' ? '' : (j.scope || '');
  const projHtml = j => `<b>${esc(projTitle(j))}</b>${projWhat(j) ? ` <span class="muted">· ${esc(projWhat(j))}</span>` : ''}
    — ${esc(projStage(j))}.${j.link && /^https?:\/\//.test(j.link) ? ` <a href="${esc(j.link)}" target="_blank" rel="noopener">SDOT page</a>` : ''}`;
  map.createPane('projects'); map.getPane('projects').style.zIndex = 420;
  const PROJ_COLOR = '#5b3fd1';
  const projLayer = L.layerGroup();
  // Planned head-start walk signals are always shown: they're points, light on the map, and say where SDOT means to act.
  const lpiLayer = L.layerGroup().addTo(map);
  PJ.list.forEach(j => {
    const done = j.stage === 'done';
    const style = { pane: 'projects', color: PROJ_COLOR, weight: done ? 3 : 4, opacity: done ? 0.45 : 0.9, dashArray: done ? null : '6 5', lineCap: 'round' };
    const shape = j.pt ? L.circleMarker(j.pt, { ...style, radius: 5, weight: 2, fillColor: '#fff', fillOpacity: 1, dashArray: null })
      : j.pts && j.pts.length ? L.polyline(j.pts, style) : null;
    if (!shape) return;
    shape.bindPopup(`<div class="proj-pop">${projHtml(j)}<div class="muted proj-src">From ${esc(PROJ_SRC[j.kind]())}.
      Not tied to a budget line: SDOT doesn't publish costs on these maps.</div></div>`, { maxWidth: 300 });
    shape.addTo(j.kind === 'lpi' && j.stage !== 'done' ? lpiLayer : projLayer);
  });
  const projOn = () => map.hasLayer(projLayer);
  // SDOT's planned and finished project lines are shown unless someone switched them off on this device.
  { let on = true; try { on = localStorage.getItem('ipm.projects') !== '0'; } catch { /* storage unavailable */ } if (on) projLayer.addTo(map); }
  document.body.classList.toggle('proj-on', projOn());
  // Same state whether it's switched from the layer menu or a "show on map" button; remembered on this device.
  const projLabel = () => (projOn() ? 'Hide SDOT projects on the map' : 'Show SDOT projects on the map');
  map.on('layeradd layerremove', e => {
    if (e.layer !== projLayer) return;
    try { localStorage.setItem('ipm.projects', projOn() ? '1' : '0'); } catch { /* ignore */ }
    document.body.classList.toggle('proj-on', projOn());
    document.querySelectorAll('.proj-toggle').forEach(b => { b.textContent = projLabel(); b.setAttribute('aria-pressed', String(projOn())); });
  });
  const setProjects = on => { if (on && !projOn()) projLayer.addTo(map); else if (!on && projOn()) map.removeLayer(projLayer); };
  const projToggleBtn = () => `<button type="button" class="linkbtn proj-toggle" aria-pressed="${projOn()}">${projLabel()}</button>`;
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.proj-toggle')) setProjects(!projOn()); });
  L.control.layers(baseLayers, { 'Neighborhood names': hoodLabels, 'SDOT planned & recent projects': projLayer }, { position: 'topleft' }).addTo(map);
  // The area this map covers: Seattle city limits. Everything outside is dimmed and the edge is outlined,
  // so it's obvious where the data stops. Drawn in its own pane, under the markers, and not clickable.
  if (D.boundary) {
    map.createPane('boundary'); map.getPane('boundary').style.zIndex = 350; map.getPane('boundary').style.pointerEvents = 'none';
    const polys = D.boundary.type === 'MultiPolygon' ? D.boundary.coordinates : [D.boundary.coordinates];
    const toLL = ring => ring.map(([x, y]) => [y, x]);
    const world = [[85, -180], [85, 180], [-85, 180], [-85, -180]];
    L.polygon([world, ...polys.map(p => toLL(p[0]))], { pane: 'boundary', stroke: false, fillColor: '#1d2430', fillOpacity: 0.16, interactive: false }).addTo(map);
    polys.forEach(p => L.polygon(toLL(p[0]), { pane: 'boundary', color: '#3a4456', weight: 3, opacity: 0.85, fill: false, interactive: false }).addTo(map));
  }
  const layer = L.featureGroup().addTo(map);
  const isNarrow = () => window.innerWidth <= 760;
  // Desktop: the list floats over the map's left side, so map fitting keeps clear of it (panel + its 16px margin).
  const leftPad = () => (isNarrow() ? 0 : document.getElementById('panel').offsetWidth + 16);

  const flyBounds = (b, opts) => (reduceMotion ? map.fitBounds(b, opts) : map.flyToBounds(b, { ...opts, duration: 0.6 }));
  function showAll() {
    const g = trafficOn ? tLayer : layer;
    if (!g.getLayers().length) return;
    const right = !detailEl.hidden && !isNarrow() ? detailEl.offsetWidth + 30 : 30;
    const bottom = isNarrow() ? cover + 20 : 30;
    flyBounds(g.getBounds(), { paddingTopLeft: [leftPad() + 30, 30], paddingBottomRight: [right, bottom], maxZoom: 15 });
  }
  const ShowAll = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const a = L.DomUtil.create('button', 'zoomout-btn');
      a.type = 'button'; a.title = 'Zoom out to see everything on this list (H)'; a.setAttribute('aria-label', 'Zoom out to see the whole list');
      a.innerHTML = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 10l4.2 4.2M4.3 6.5h4.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>Zoom out';
      L.DomEvent.disableClickPropagation(a);
      L.DomEvent.on(a, 'click', e => { L.DomEvent.preventDefault(e); showAll(); });
      return a;
    }
  });
  new ShowAll().addTo(map);
  // Tiers differ by color AND outline, so they don't rely on hue alone.
  const tier = r => (r <= 10 ? 0 : r <= 25 ? 1 : r <= 50 ? 2 : 3);
  // Crash places: one list, intersections and the stretches of street between them ranked together (#1 is the place
  // most likely to hurt people, whichever kind it is). A place's kind comes from its own type (I = intersection).
  const typeWord = t => (t === 'I' ? 'intersection' : 'stretch');
  const rankTxt = r => (r == null ? '–' : `#${fmt(r)}`);
  const tierK = r => tier(r);
  // A place as shown in the list: its citywide rank, or with a district or one kind picked, its rank within that list.
  const shownN = p => p.dr ?? p.rank;
  const pTier = p => (p.rank == null ? 3 : tier(shownN(p)));
  const pRank = p => (p.rank == null ? '—' : `#${fmt(shownN(p))}`);
  const kindCount = () => meta.locations_scored || N;
  const TIERS = [
    { color: '#b3141b' },
    { color: '#e0561f', stroke: '#6b1f04', weight: 2.5 },
    { color: '#f0a020', stroke: '#8a5300', weight: 1.5 },   // dark edge: light orange alone is faint on the gray map
    { color: '#7a8597', stroke: '#fff', weight: 1 }
  ];

  let markers = {};
  function dim(m, faded) {
    if (m.setStyle) m.setStyle({ fillOpacity: faded ? 0.25 : 0.85, opacity: faded ? 0.4 : 1 });
    else { m.setOpacity(faded ? 0.35 : 1); const el = m.getElement(); if (el) el.classList.toggle('faded', faded); }
  }

  // Legend for the rank tiers, with a pause control for the pulsing top-10 rings.
  let paused = (() => { try { return JSON.parse(localStorage.getItem('ipm.paused')) === true; } catch { return false; } })();
  const Legend = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd() {
      const d = L.DomUtil.create('div', 'map-legend');
      const sw = t => `<i style="background:${TIERS[t].color};box-shadow:0 0 0 ${t === 1 ? 2 : 1.5}px ${TIERS[t].stroke}${t === 1 ? '' : ',0 0 0 2.5px rgba(0,0,0,.12)'}"></i>`;
      // Collapsed by default on phones, where it would cover much of the map.
      const small = matchMedia('(max-width: 760px)').matches;
      if (small) d.classList.add('collapsed');
      d.innerHTML = `
        <button type="button" class="lg-toggle" aria-expanded="${!small}">Map key</button>
        <div class="lg-body">
        <div class="lg-safety"><span class="lg-top"><span class="core">1</span></span><span class="lg-shape"><span class="lg-top stretch"><span class="core">1</span></span></span><span class="lg-tl"></span></div>
        <div class="lg-safety">${sw(1)}<span class="lg-tl"></span></div>
        <div class="lg-safety">${sw(2)}<span class="lg-tl"></span></div>
        <div class="lg-safety">${sw(3)}<span class="lg-tl"></span></div>
        <div class="lg-safety"><i style="background:#fff;box-shadow:inset 0 0 0 3px #7a0c10"></i>Dark ring: 2 or more people died here</div>
        ${[0, 1, 2].map(t => `<div class="lg-traffic"><b class="lg-tline" style="background:${TIERS[t].color};height:${7 - t}px"></b>${['Top 10', '11–25', '26–50'][t]}</div>`).join('')}
        <div class="lg-traffic"><b class="lg-tline" style="background:#8a94a6;height:2px"></b>Others</div>
        <div><b class="lg-line"></b>Seattle city limits (area covered)</div>
        <div class="lg-proj"><b class="lg-pline"></b>SDOT project: planned or in design</div>
        <div class="lg-proj"><b class="lg-pline done"></b>SDOT project: completed</div>
        <div><b class="lg-ppt"></b>Head-start walk signal planned</div>
        ${reduceMotion ? '<div class="lg-note">Animation is off: your device is set to reduce motion.</div>'
          : `<button type="button" class="pausebtn" aria-pressed="${paused}">${paused ? 'Play' : 'Pause'} animation</button>`}
        </div>`;
      d.querySelector('.lg-toggle').onclick = e => {
        const c = d.classList.toggle('collapsed'); e.currentTarget.setAttribute('aria-expanded', !c);
      };
      L.DomEvent.disableClickPropagation(d);
      const pb = d.querySelector('.pausebtn'); if (pb) pb.onclick = e => {
        paused = !paused; document.body.classList.toggle('paused', paused);
        e.target.textContent = `${paused ? 'Play' : 'Pause'} animation`; e.target.setAttribute('aria-pressed', paused);
        try { localStorage.setItem('ipm.paused', JSON.stringify(paused)); } catch { /* ignore */ }
      };
      return d;
    }
  });
  const legendCtl = new Legend().addTo(map);
  // Tier labels: by rank in the list shown (circles = intersections, bars = stretches).
  const legendTiers = () => {
    const ksi = mode === 'ksi', c = legendCtl.getContainer();
    const l = ['Top 10', '11–25', '26–50', '51+'];
    c.querySelectorAll('.lg-tl').forEach((e, i) => { e.textContent = l[i]; });

  };
  map.on('dragstart', () => {
    if (!matchMedia('(max-width: 760px)').matches) return;
    const d = legendCtl.getContainer(); d.classList.add('collapsed'); d.querySelector('.lg-toggle').setAttribute('aria-expanded', 'false');
  });
  document.body.classList.toggle('paused', paused);

  function currentRows() {
    const n = +document.getElementById('topN').value;
    const type = document.getElementById('addrFilter').value;
    const ongoing = document.getElementById('onlyOngoing').checked;
    const noPlan = document.getElementById('noPlan').checked;
    const dist = +document.getElementById('distFilter').value || 0;
    // the citywide summary card steps aside while a district's list is shown, so the list starts near the top
    { const cs = document.getElementById('citySummary'); if (cs) cs.hidden = !!dist; }
    distCard(dist);
    const inDist = p => !dist || p.council_district === dist || p.council_district2 === dist;   // on the line: in both
    const keep = p => inDist(p) && (!type || p.addr_type === type || (type === 'B' && p.addr_type === 'A'))
        && (!ongoing || p.ksi_years >= 3) && (!noPlan || !((p.proj_ids && p.proj_ids.length) || p.lpi_status === 'Planned' || p.ntor_status === 'Planned'));
    // With a district or one kind picked, places are ranked again within that list (#1, #2, ...), with the citywide rank
    // beside each. The data file carries each kind's top 200 citywide and each district's top 50 of each kind.
    D.priorities.forEach(p => { p.dr = null; });
    const isType = p => !type || p.addr_type === type || (type === 'B' && p.addr_type === 'A');
    const again = !!(dist || type);
    let pool = D.priorities.filter(p => p.rank != null && inDist(p) && isType(p)).sort((a, b) => a.rank - b.rank);
    if (again) pool = pool.slice(0, dist ? 50 : 200).map((p, i) => { p.dr = i + 1; return p; });
    else pool = pool.filter(p => p.rank <= 200);
    const rows = pool.filter(keep).slice(0, n);
    // Spots where 2+ people died are never left off, even when their predicted-harm rank is low.
    const inRows = new Set(rows.map(p => p.rank_ksi));
    const extra = D.priorities.filter(p => p.killed >= 2 && !inRows.has(p.rank_ksi) && keep(p))
      .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.rank_ksi - b.rank_ksi);
    return { rows, extra };
  }
  const EXTRA_STYLE = { radius: 7, color: '#7a0c10', weight: 3, fillColor: '#fff', fillOpacity: 0.95 };

  function render() {
    const { rows, extra } = currentRows();
    const maxScore = Math.max(...rows.map(r => r.score), 1);

    layer.clearLayers(); markers = {}; legendTiers();
    extra.forEach(p => {
      const m = L.circleMarker([p.lat, p.lon], EXTRA_STYLE);
      m.bindTooltip(`${p.rank ? pRank(p) + ' · ' : ''}${esc(p.name)}: ${p.killed} people killed`, { direction: 'top', offset: [0, -4] })
        .on('click', () => pickSpot(p, true, null));
      m._p = p; m.addTo(layer); markers[p.rank_ksi] = m;
    });
    // Draw lower-ranked circles first so higher ranks sit on top; the numbered markers stack by zIndexOffset, so they're
    // added in rank order (their order on the page is the keyboard's Tab order: #1 first).
    [...rows.filter(p => pTier(p) !== 0).reverse(), ...rows.filter(p => pTier(p) === 0)].forEach(p => {
      const t = TIERS[pTier(p)];
      // numbered: circles for intersections, rounded bars for stretches (the two lists share numbers)
      const m = pTier(p) === 0
        ? L.marker([p.lat, p.lon], {
            zIndexOffset: 1000 - p.rank, riseOnHover: true, keyboard: true, title: `${pRank(p)} ${p.name}`, alt: `${pRank(p)} ${p.name}`,
            icon: L.divIcon({
              className: 'top-mark' + (p.addr_type !== 'I' ? ' stretch' : ''), iconSize: [40, 40], iconAnchor: [20, 20],
              html: `<span class="pulse" style="animation-delay:-${(p.rank * 0.37).toFixed(2)}s"></span>
                     <span class="core">${shownN(p)}</span>`
            })
          })
        : L.circleMarker([p.lat, p.lon], {
            radius: 5 + 9 * Math.sqrt(Math.max(0, p.score) / maxScore), color: t.stroke, weight: t.weight,
            fillColor: t.color, fillOpacity: 0.85
          });
      m.bindTooltip(`${pRank(p)} ${esc(p.name)}`, { direction: 'top', offset: [0, pTier(p) === 0 ? -14 : -4] })
        .on('click', () => pickSpot(p, true, m.getElement && m.getElement()));
      // Keyboard and screen readers: a numbered marker is a button named with its rank, kind and place, and Enter or
      // Space opens it. The smaller circles aren't Tab stops (the list reaches the same places, in order).
      const a11y = () => {
        const el = m.getElement && m.getElement(); if (!el) return;
        if (pTier(p) === 0) {
          el.setAttribute('aria-label', `${pRank(p)}: ${niceName(p.location || p.name)}`);
          const core = el.querySelector('.core'); if (core) core.setAttribute('aria-hidden', 'true');
        } else { el.setAttribute('tabindex', '-1'); el.setAttribute('aria-hidden', 'true'); el.setAttribute('focusable', 'false'); }
      };
      if (pTier(p) === 0) m.on('keypress', e => {
        const k = e.originalEvent && e.originalEvent.key;
        if (k === 'Enter' || k === ' ') { e.originalEvent.preventDefault(); pickSpot(p, true, m.getElement()); }
      });
      m.on('add', () => setTimeout(a11y));
      m._p = p; m.addTo(layer); markers[p.rank_ksi] = m; a11y();
    });

    const list = document.getElementById('list');
    const card = (p, isExtra, i) => {
      const chips = reasons(p).slice(0, 3);
      const outside = isExtra && p.dr == null && D.priorities.some(q => q.dr != null);   // an extra outside a district or kind list
      const rk = p.rank != null && !outside ? `#${fmt(shownN(p))}` : '—';
      const kind = p.addr_type === 'I' ? 'Intersection' : 'Stretch';
      // in a district or kind list, an added place outside it (a repeated-deaths extra) has only its citywide rank: say so
      const city = p.dr || (outside && p.rank != null) ? `#${fmt(p.rank)} citywide` : '';
      // movement since last month (recommended ranking, citywide list only); shown under the points, spoken in full
      const mv = mode === 'ksi' && p.rank != null && !p.dr ? (p.rank_month_ago ? p.rank_month_ago - p.rank : null) : 0;
      const move = mv == null ? '<span class="mv new"><span aria-hidden="true">new</span><span class="sr-only">, new in the list this month</span></span>'
        : mv >= 1 ? `<span class="mv up" title="Up ${mv} in the ranking since last month"><span aria-hidden="true">▲${mv}</span><span class="sr-only">, up ${mv} since last month</span></span>`
        : mv <= -1 ? `<span class="mv down" title="Down ${-mv} in the ranking since last month"><span aria-hidden="true">▼${-mv}</span><span class="sr-only">, down ${-mv} since last month</span></span>` : '';
      return `
      <li data-id="${p.rank_ksi}" class="${isExtra ? 'extra' : (pTier(p) === 0 ? 'top10 ' : '') + 't' + pTier(p)}" style="--i:${Math.min(i || 0, 15)}">
        <button type="button" class="card" aria-labelledby="c${p.rank_ksi}r c${p.rank_ksi}n c${p.rank_ksi}s" aria-describedby="c${p.rank_ksi}d">
          <span class="row1"><span class="rank" id="c${p.rank_ksi}r">${rk}</span><span class="loc" id="c${p.rank_ksi}n">${esc(p.name)}${p.area || city || kind ? `<span class="hood">${esc([kind, p.area, city].filter(Boolean).join(' · '))}</span>` : ''}</span>
            <span class="score" id="c${p.rank_ksi}s">${p.score != null ? scoreText(p) : ''}${move}</span></span>
          <span id="c${p.rank_ksi}d"><span class="chips">${chips.map(r => `<span class="chip ${r.cls}">${esc(r.text)}</span>`).join('')}</span>
          ${sdotRow(p)}</span>
        </button>
      </li>`;
    };
    list.innerHTML = (rows.length ? rows.map((p, i) => card(p, false, i)).join('') : '<li class="empty">No spots match these filters.</li>') +
      (extra.length ? `<li class="extra-head" role="presentation"><b>Repeated deaths</b>: 2 or more people died at each of these
          spots. They rank lower because they have few other crashes, but they're always listed.</li>` +
        extra.map(p => card(p, true)).join('') : '');
    list.querySelectorAll('li[data-id]').forEach(li => {
      const p = byId.get(+li.dataset.id);
      const btn = li.querySelector('button');
      btn.addEventListener('click', () => pickSpot(p, true, btn));
      // Hovering or focusing a card lifts and highlights its marker, so overlapping markers can be found.
      const on = () => highlight(p, true), off = () => highlight(p, false);
      li.addEventListener('mouseenter', on); li.addEventListener('mouseleave', off);
      btn.addEventListener('focus', on); btn.addEventListener('blur', off);
    });
    if (current) markCurrent();
  }

  const isExtraMarker = m => m.options && m.options.fillColor === EXTRA_STYLE.fillColor && m.options.radius === EXTRA_STYLE.radius;
  function highlight(p, on) {
    const m = markers[p.rank_ksi]; if (!m) return;
    const base = isExtraMarker(m) ? EXTRA_STYLE : TIERS[pTier(p)];
    if (m.setStyle) { m.setStyle({ weight: on ? 4 : (base.weight || EXTRA_STYLE.weight), color: on ? '#1d2430' : (base.stroke || base.color) }); if (on) m.bringToFront(); }
    else { m.setZIndexOffset(on ? 6000 : (current && current.rank_ksi === p.rank_ksi ? 5000 : 1000 - p.rank)); const el = m.getElement(); if (el) el.classList.toggle('hl', on); }
    if (on) m.openTooltip(); else m.closeTooltip();
  }

  // ---------- drill-down ----------
  const SEV = {  // ordinal blue ramp, validated (light end clears 2:1)
    F: { label: 'Fatal', color: '#0d366b' },
    S: { label: 'Serious injury', color: '#1c5cab' },
    I: { label: 'Injury', color: '#3987e5' },
    P: { label: 'Property damage', color: '#86b6ef' },
    U: { label: 'Unknown', color: '#c3c2b7' }
  };
  const REQ_COLOR = '#1baf7a';       // aqua: requests (shape = square, never color alone)
  const focus = L.layerGroup().addTo(map);
  let crashFilter = 'all', reqFilter = '', showAllCrashes = false, showAllReqs = false, current = null, opener = null,
    progReturn = null;   // a place opened from the "Is it getting fixed?" tab: closing it goes back there

  // ---------- panel layout: expand, resize, collapsible sections (remembered) ----------
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem('ipm.' + k)); return v ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('ipm.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
  };
  // Detail sections open fully for each new spot, except the score math (at the bottom, folded). Folding a section
  // lasts while you stay on that spot; it isn't remembered for the next one.
  const DEFAULT_COLLAPSED = { math: true };
  let collapsed = { ...DEFAULT_COLLAPSED }, collapsedFor = null;
  try { localStorage.removeItem('ipm.collapsed'); } catch { /* ignore */ }
  const widths = store.get('widths', { normal: 440, expanded: null });
  let expanded = store.get('expanded', false);
  let renderGraphs = () => {};
  // Redraw the graphs to fit when the detail panel is resized or widened.
  if (window.ResizeObserver) new ResizeObserver(() => renderGraphs()).observe(document.getElementById('detail'));
  const detailEl = document.getElementById('detail');
  // A phone or tablet with a share sheet (desktop browsers that have one keep "Copy link").
  const canShare = () => !!navigator.share && matchMedia('(pointer: coarse)').matches;
  const spotOpen = () => !detailEl.hidden && !detailEl.classList.contains('home');
  let ready = false;   // set at the end of start-up; the overview isn't drawn before then
  const refreshHome = () => { if (ready && !spotOpen() && !isNarrow()) { if (placeG && detailEl.classList.contains('place')) showPlace(placeG); else renderHome(); } };
  const pickSpot = (p, fly, from) => (spotOpen() && current && current.rank_ksi === p.rank_ksi ? closeDetail(true) : select(p, fly, from));
  const pickLine = (t, fly) => (spotOpen() && tSel === t ? closeDetail(true) : selectTraffic(t, fly));
  // The part of the map not under the floating list.
  const mapW = () => (document.getElementById('map').offsetWidth || window.innerWidth) - leftPad();
  const maxW = () => Math.max(340, mapW() - 90);
  const defaultExpanded = () => Math.max(800, Math.round(mapW() * 0.66));

  // Left list panel: widen (half the screen) or drag to resize. With both panels expanded they meet in the middle.
  const mainEl = document.querySelector('main'), panelEl = document.getElementById('panel');
  let leftExpanded = store.get('leftExpanded', false);
  const leftWidths = store.get('leftWidths', { normal: 400, expanded: null });
  const clampLeft = w => Math.min(Math.max(300, w), mainEl.offsetWidth - 200);
  function applyPanel() {
    if (isNarrow()) { panelEl.style.width = ''; return; }
    let w = leftExpanded ? (leftWidths.expanded || Math.round(mainEl.offsetWidth / 2)) : leftWidths.normal;
    panelEl.style.width = clampLeft(w) + 'px';
    mainEl.style.setProperty('--panel-w', leftPad() + 'px');
    const b = document.getElementById('expandPanel');
    b.textContent = leftExpanded ? '‹' : '›';
    b.title = leftExpanded ? 'Narrow the list' : 'Widen the list';
    b.setAttribute('aria-label', b.title); b.setAttribute('aria-pressed', String(leftExpanded));
    map.invalidateSize();
  }
  function toggleLeft() {
    leftExpanded = !leftExpanded; store.set('leftExpanded', leftExpanded);
    applyPanel(); applyLayout();
  }

  // A sheet (budget, "Is it getting fixed?") sits between the list and the details. When that leaves it too narrow to read,
  // it covers the details panel too.
  function sheetFit() {
    mainEl.classList.toggle('sheet-over', !isNarrow() && mainEl.clientWidth - panelEl.offsetWidth - (detailEl.hidden ? 0 : detailEl.offsetWidth) < 680);
  }
  function applyLayout() {
    if (isNarrow()) { detailEl.style.width = ''; detailEl.classList.remove('expanded', 'split'); mainEl.style.setProperty('--detail-w', '0px'); return; }
    // Both expanded: the detail panel fills everything right of the list (the two meet in the middle).
    const split = expanded && leftExpanded;
    detailEl.classList.toggle('split', split);
    mainEl.classList.toggle('split', split && !detailEl.hidden);   // both edge tabs on one line: offset them
    const w = split ? mapW() - 16 : expanded ? (widths.expanded || defaultExpanded()) : widths.normal;
    detailEl.style.width = (split ? w : Math.min(Math.max(340, w), maxW())) + 'px';
    detailEl.classList.toggle('expanded', expanded);
    mainEl.style.setProperty('--detail-w', (detailEl.hidden ? 0 : detailEl.offsetWidth) + 'px');
    sheetFit();
    const b = document.getElementById('expandDetail');
    // Same control as the list's edge tab: the arrow points the way the edge will move.
    b.textContent = expanded ? '›' : '‹';
    b.title = expanded ? 'Narrow the details (E)' : 'Widen the details (E)';
    b.setAttribute('aria-label', expanded ? 'Narrow the details' : 'Widen the details');
    b.setAttribute('aria-pressed', String(expanded));
  }
  function toggleExpand() {
    expanded = !expanded; store.set('expanded', expanded); applyLayout();
    if (current && current.location) { select(current, false, null, true); flyVisible([current.lat, current.lon], map.getZoom()); }
  }
  document.getElementById('expandDetail').onclick = toggleExpand;
  document.getElementById('expandPanel').onclick = toggleLeft;
  window.addEventListener('resize', () => {
    applyPanel(); applyLayout();
    // Crossing the phone/desktop width: the overview lives only on desktop.
    if (!spotOpen()) { if (isNarrow()) { detailEl.hidden = true; detailEl.classList.remove('home', 'place'); } else if (detailEl.hidden) refreshHome(); }
  });
  applyPanel();
  applyLayout();

  (function leftResizer() {
    const h = document.getElementById('panelHandle');
    let startX = 0, startW = 0;
    h.addEventListener('pointerdown', e => {
      startX = e.clientX; startW = panelEl.offsetWidth; h.setPointerCapture(e.pointerId);
      document.body.classList.add('resizing');
    });
    h.addEventListener('pointermove', e => {
      if (!h.hasPointerCapture(e.pointerId)) return;
      panelEl.style.width = clampLeft(startW + (e.clientX - startX)) + 'px';
      mainEl.style.setProperty('--panel-w', leftPad() + 'px');
      applyLayout();
    });
    h.addEventListener('pointerup', e => {
      h.releasePointerCapture(e.pointerId); document.body.classList.remove('resizing');
      leftWidths[leftExpanded ? 'expanded' : 'normal'] = panelEl.offsetWidth; store.set('leftWidths', leftWidths);
      applyPanel(); applyLayout();
    });
  })();

  // ---------- Phone: the list and the details are bottom sheets over a full-screen map ----------
  // Three heights: "peek" (just the title bar, the map almost whole), half the screen, and the whole of it. Grab the title
  // bar and slide; a flick carries on in its direction. The bar's handle is a button too (tap: up a step; at the top, back
  // to half), for anyone who can't drag. Moves are transforms only, so they stay smooth on slow phones.
  // Details opened from the list replace it in place ("‹ List"); opened from the map they rise to half over it ("×"),
  // leaving the map live so nearby crash spots can still be tapped.
  const sheetEase = 'transform .32s cubic-bezier(.22,.9,.24,1)';
  const S = {
    list: { el: panelEl, bar: panelEl.querySelector('.ptop'), body: document.getElementById('panelBody'), snap: 'half', anim: 0 },
    detail: { el: detailEl, bar: detailEl.querySelector('.dtop'), body: document.getElementById('detailBody'), snap: 'half', anim: 0 },
  };
  let cover = 0;              // how much of the map the top sheet hides (px), for centring and fitting the map
  let detailFrom = 'map';     // where the open details came from: 'map', 'list' or 'progress'
  let lastTap = { where: 'map', t: 0 };
  const fullH = () => mainEl.clientHeight;
  const snapH = (s, snap) => snap === 'full' ? fullH() : snap === 'peek' ? s.bar.offsetHeight : Math.round(fullH() / 2);
  const visH = s => Math.max(0, mainEl.getBoundingClientRect().bottom - s.el.getBoundingClientRect().top);
  const detailUp = () => !detailEl.hidden;
  function setCover(px) { cover = px; mainEl.style.setProperty('--cover', Math.round(px) + 'px'); }
  function grabLabel(s) {
    const g = s.bar.querySelector('.grab'), what = s === S.list ? 'list' : 'details';
    g.setAttribute('aria-label', s.snap === 'peek' ? `Show more of the ${what}` : s.snap === 'half' ? `Show the ${what} full screen` : `Show less of the ${what}`);
  }
  // A sheet is always the full height of the map area and is only ever slid (a transform: no page layout while it moves,
  // which is what makes slides stutter on iPhones). The part below the screen is matched by a spacer at the end of its
  // content, so the last item can still be scrolled into view.
  function rest(s, h) {
    const H = fullH();
    s.el.style.transition = 'none'; s.el.style.height = H + 'px'; s.el.style.transform = `translateY(${Math.round(H - h)}px)`;
    s.body.style.setProperty('--below', Math.max(0, Math.round(H - h)) + 'px');
    s.body.inert = s.snap === 'peek';
    moving(false);
  }
  // While a sheet or the map moves, the pulsing markers pause (less for the phone to draw each frame).
  const moving = on => mainEl.classList.toggle('moving', on);
  // Slide a sheet's top edge from its current place to height `to`; done() runs once it's there (unless interrupted).
  function moveSheet(s, to, done, from) {
    const tok = ++s.anim, H = fullH(), el = s.el;
    if (from == null) from = visH(s);
    if (reduceMotion || Math.abs(from - to) < 2) { rest(s, to); if (done) done(); return; }
    moving(true);
    if (el.style.height !== H + 'px') { el.style.transition = 'none'; el.style.height = H + 'px'; }
    el.style.transition = 'none'; el.style.transform = `translateY(${H - from}px)`;
    void el.offsetHeight;
    el.style.transition = sheetEase; el.style.transform = `translateY(${H - to}px)`;
    let over = false;
    const fin = () => { if (over || tok !== s.anim) return; over = true; el.removeEventListener('transitionend', onEnd); rest(s, to); if (done) done(); };
    const onEnd = e => { if (e.target === el && e.propertyName === 'transform') fin(); };
    el.addEventListener('transitionend', onEnd); setTimeout(fin, 420);
  }
  function setSnap(s, snap, opts = {}) {
    s.snap = snap; grabLabel(s);
    const to = snapH(s, snap);
    if (s === S.detail || !detailUp()) setCover(to);
    // Details opened from the list stand in for it: the list takes the same height, ready for "‹ List".
    if (s === S.detail && detailFrom !== 'map') { S.list.snap = snap; grabLabel(S.list); rest(S.list, snapH(S.list, S.list.snap)); }
    if (opts.instant) { s.anim++; rest(s, to); } else moveSheet(s, to, opts.done, opts.from);
  }
  function cycle(s) { setSnap(s, s.snap === 'peek' ? 'half' : s.snap === 'half' ? 'full' : 'half'); }

  function sheetDrag(s) {
    let id = null, y0 = 0, h0 = 0, h = 0, dragging = false, samples = [], raf = 0, swallow = false;
    const paint = () => { raf = 0; const H = fullH(); s.el.style.transform = `translateY(${H - h}px)`; if (s === S.detail || !detailUp()) setCover(h); };
    s.bar.addEventListener('pointerdown', e => {
      if (!isNarrow() || e.button > 0 || e.target.closest('button:not(.grab), a, input, select')) return;
      id = e.pointerId; y0 = e.clientY; h0 = visH(s); dragging = false; samples = [[e.timeStamp, e.clientY]];
      try { s.bar.setPointerCapture(id); } catch (err) { /* capture is a nicety; dragging still works */ }
    });
    s.bar.addEventListener('pointermove', e => {
      if (e.pointerId !== id) return;
      const dy = e.clientY - y0;
      if (!dragging) {
        if (Math.abs(dy) < 6) return;
        dragging = true; s.anim++;               // a grab stops a slide where it is
        const H = fullH();
        s.el.style.transition = 'none'; if (s.el.style.height !== H + 'px') s.el.style.height = H + 'px';
        s.el.style.transform = `translateY(${H - h0}px)`;
        s.body.inert = false; mainEl.classList.add('sheet-drag'); moving(true);
      }
      const peek = snapH(s, 'peek'), H = fullH();
      let nh = h0 - dy;
      if (nh < peek) nh = peek - Math.min(40, (peek - nh) * 0.3);   // resists below the title bar, never closes
      h = Math.min(H, nh);
      samples.push([e.timeStamp, e.clientY]); while (samples.length > 2 && e.timeStamp - samples[0][0] > 90) samples.shift();
      if (!raf) raf = requestAnimationFrame(paint);
    });
    const end = e => {
      if (e.pointerId !== id) return;
      id = null;
      if (!dragging) return;
      dragging = false; swallow = true; setTimeout(() => (swallow = false), 0);
      if (raf) { cancelAnimationFrame(raf); paint(); }
      mainEl.classList.remove('sheet-drag');
      const [t0, ya] = samples[0], [t1, yb] = samples[samples.length - 1];
      const v = t1 > t0 ? (ya - yb) / (t1 - t0) : 0;   // px/ms, up is positive
      const aim = h + v * 200;
      const snap = ['peek', 'half', 'full'].reduce((a, b) => Math.abs(snapH(s, b) - aim) < Math.abs(snapH(s, a) - aim) ? b : a);
      setSnap(s, snap, { from: h });
    };
    s.bar.addEventListener('pointerup', end); s.bar.addEventListener('pointercancel', end);
    // the click that ends a drag isn't a tap
    s.bar.addEventListener('click', e => { if (swallow) { swallow = false; e.preventDefault(); e.stopPropagation(); } }, true);
    s.bar.querySelector('.grab').addEventListener('click', () => { if (isNarrow()) cycle(s); });
  }
  sheetDrag(S.list); sheetDrag(S.detail);

  // Where the last tap was: a place picked in the list opens differently from one picked on the map.
  document.addEventListener('click', e => {
    const t = e.target;
    lastTap = { where: t.closest('#panel') ? 'list' : t.closest('#progressSheet') ? 'progress' : t.closest('#detail') ? 'detail' : 'map', t: Date.now() };
  }, true);
  document.querySelectorAll('.intro-report').forEach(a => a.addEventListener('click', e => { e.preventDefault(); document.getElementById('reportHead').click(); }));
  const backBtn = document.getElementById('backDetail');
  // back to the list: the search box no longer holds the place that was open
  backBtn.onclick = () => { closeDetail(true); const s = document.getElementById('search'); if (s) s.value = ''; };

  // The details just opened (or changed place). Called before the map moves, so `cover` is already the new height.
  function phoneDetailShown(wasHidden) {
    if (!isNarrow()) return;
    const d = S.detail, leaving = detailEl.classList.contains('leaving');
    if (wasHidden || leaving) {
      const tap = Date.now() - lastTap.t < 2000 ? lastTap.where : 'map';
      detailFrom = tap === 'list' || tap === 'progress' ? tap : 'map';
      const from = leaving ? visH(d) : 0;
      detailEl.classList.remove('leaving', 'fade-out', 'push-in', 'from-list', 'from-progress');
      if (detailFrom !== 'map') detailEl.classList.add('from-' + detailFrom);
      backBtn.textContent = detailFrom === 'progress' ? '‹ Getting fixed?' : '‹ List';
      backBtn.setAttribute('aria-label', detailFrom === 'progress' ? 'Back to Is it getting fixed?' : 'Back to the list');
      const under = () => { if (detailUp() && !detailEl.classList.contains('leaving')) panelEl.classList.add('under'); };
      if (detailFrom === 'map') {
        setSnap(d, 'half', { from, done: under });
      } else {
        // in place of the list (or the "getting fixed" page, full screen), sliding in from the side
        setSnap(d, detailFrom === 'progress' ? 'full' : S.list.snap === 'peek' ? 'half' : S.list.snap, { instant: true });
        if (reduceMotion) under();
        else { void detailEl.offsetWidth; detailEl.classList.add('push-in'); setTimeout(() => { detailEl.classList.remove('push-in'); under(); }, 260); }
      }
    } else if (d.snap === 'peek') setSnap(d, 'half');
    else setCover(snapH(d, d.snap));
    d.body.scrollTop = 0;
  }
  // The details were closed: hand the screen back to the list.
  function phoneDetailHidden() {
    if (!isNarrow()) return;
    const d = S.detail;
    panelEl.classList.remove('under');
    rest(S.list, snapH(S.list, S.list.snap)); setCover(snapH(S.list, S.list.snap));
    const clear = () => { detailEl.classList.remove('leaving', 'fade-out', 'push-in'); detailEl.style.height = ''; detailEl.style.transform = ''; };
    if (reduceMotion) { d.anim++; clear(); return; }
    detailEl.classList.add('leaving');   // keeps it drawn (though hidden) while it goes
    if (detailFrom === 'map') moveSheet(d, 0, clear, visH(d));
    else { const tok = ++d.anim; detailEl.classList.add('fade-out'); setTimeout(() => { if (tok === d.anim) clear(); }, 220); }
    // Guard: if the slide is interrupted (or the phone freezes timers mid-way), a closed sheet still never stays drawn.
    setTimeout(() => { if (detailEl.hidden && detailEl.classList.contains('leaving')) clear(); }, 700);
  }
  // Safety net: whatever hides the details, the list comes back.
  new MutationObserver(() => { if (detailEl.hidden && !detailEl.classList.contains('leaving')) panelEl.classList.remove('under'); })
    .observe(detailEl, { attributes: true, attributeFilter: ['hidden'] });

  function applySheets() {
    if (!isNarrow()) {
      for (const s of Object.values(S)) { s.anim++; s.el.style.height = ''; s.el.style.transform = ''; s.el.style.transition = ''; s.body.inert = false; s.body.style.removeProperty('--below'); }
      moving(false);
      panelEl.classList.remove('under'); detailEl.classList.remove('leaving', 'fade-out', 'push-in', 'from-list', 'from-progress');
      setCover(0); return;
    }
    // Stop any slide in flight (it would finish at a height worked out for the old screen size), then set both sheets.
    S.list.anim++; S.detail.anim++;
    if (!detailUp()) {
      panelEl.classList.remove('under');
      detailEl.classList.remove('leaving', 'fade-out', 'push-in'); detailEl.style.height = ''; detailEl.style.transform = '';
    }
    rest(S.list, snapH(S.list, S.list.snap)); grabLabel(S.list); grabLabel(S.detail);
    if (detailUp()) rest(S.detail, snapH(S.detail, S.detail.snap));
    setCover(snapH(detailUp() ? S.detail : S.list, (detailUp() ? S.detail : S.list).snap));
  }
  map.on('movestart', () => isNarrow() && moving(true)); map.on('moveend', () => moving(false));
  window.addEventListener('resize', applySheets);
  // Phones freeze a page's timers while another app is in front; coming back mid-slide, put the sheets right.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') applySheets(); });
  window.addEventListener('pageshow', applySheets);
  applySheets();
  // Typing in a sheet (search): it rises to full screen, so the phone's keyboard can't squeeze the box out of sight.
  document.addEventListener('focusin', e => {
    if (!isNarrow() || !e.target.matches('input:not([type=checkbox]):not([type=radio]), textarea')) return;
    const s = e.target.closest('#detail') ? S.detail : e.target.closest('#panel') ? S.list : null;
    if (s && s.snap !== 'full') setSnap(s, 'full');
  });
  // The map area itself never scrolls (the sheets do); undo any scroll a browser makes to show a focused element.
  mainEl.addEventListener('scroll', () => { if (mainEl.scrollTop || mainEl.scrollLeft) { mainEl.scrollTop = 0; mainEl.scrollLeft = 0; } });

  // Phone: the views and the report button live in a menu under the header ("Crashes ▾"), to leave the screen to the
  // map and the list. Choosing a view closes it; so do Esc and a tap anywhere else.
  const headerEl = document.querySelector('header'), menuBtn = document.getElementById('viewMenuBtn');
  function setMenu(open, focusBack) {
    headerEl.classList.toggle('menu-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    if (open) (document.querySelector('nav [role=tab].active') || document.querySelector('nav [role=tab]')).focus();
    else if (focusBack) menuBtn.focus();
  }
  menuBtn.onclick = () => setMenu(!headerEl.classList.contains('menu-open'));
  document.getElementById('reportHead').addEventListener('click', () => setMenu(false));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && headerEl.classList.contains('menu-open')) { e.stopImmediatePropagation(); setMenu(false, true); }
  }, true);
  document.addEventListener('pointerdown', e => { if (headerEl.classList.contains('menu-open') && !headerEl.contains(e.target)) setMenu(false); });

  (function resizer() {
    const h = document.getElementById('resizeHandle');
    let startX = 0, startW = 0;
    h.addEventListener('pointerdown', e => {
      startX = e.clientX; startW = detailEl.offsetWidth; h.setPointerCapture(e.pointerId);
      document.body.classList.add('resizing');
    });
    h.addEventListener('pointermove', e => {
      if (!h.hasPointerCapture(e.pointerId)) return;
      detailEl.style.width = Math.min(Math.max(340, startW + (startX - e.clientX)), maxW()) + 'px';
      mainEl.style.setProperty('--detail-w', detailEl.offsetWidth + 'px');
      sheetFit();
    });
    h.addEventListener('pointerup', e => {
      h.releasePointerCapture(e.pointerId); document.body.classList.remove('resizing');
      widths[expanded ? 'expanded' : 'normal'] = detailEl.offsetWidth; store.set('widths', widths);
    });
  })();

  // Keyboard shortcuts: never with Ctrl/Alt/Cmd held, never while typing.
  //   H (show all) works on the map, the panel or the page body; E (expand) only inside the panel; Esc closes.
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const inDetail = detailEl.contains(e.target);
    const inMap = document.getElementById('map').contains(e.target);
    if ((e.key === 'h' || e.key === 'H') && (inMap || inDetail)) { showAll(); return; }
    if (!spotOpen()) {
      if (e.key === 'Escape' && placeG && (inMap || inDetail) && detailEl.classList.contains('place')) {
        const pm = pinMarkerOf(placeG); if (pm) deselectPin(placeG, pm); else hidePlace(placeG);
      }
      return;
    }
    if (e.key === 'Escape') closeDetail(true);
    else if ((e.key === 'e' || e.key === 'E') && inDetail && !isNarrow()) toggleExpand();
  });

  const tipEl = document.createElement('div');
  tipEl.className = 'tip'; tipEl.hidden = true; tipEl.setAttribute('aria-hidden', 'true'); document.body.appendChild(tipEl);
  document.addEventListener('mousemove', e => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { tipEl.hidden = true; return; }
    tipEl.innerHTML = t.dataset.tip; tipEl.hidden = false;
    const x = Math.min(e.clientX + 14, window.innerWidth - tipEl.offsetWidth - 8);
    tipEl.style.left = x + 'px'; tipEl.style.top = (e.clientY + 14) + 'px';
  });

  // Charts that count every report on file say so when that's a different number from the ranked years' count.
  const fileNote = (det, p) => det && det.crashes && det.crashes.length !== p.crashes
    ? `<div class="note">Counts all ${fmt(det.crashes.length)} crash reports on file here; the ranking uses the ${fmt(p.crashes)} from ${windowTxt()}.</div>` : '';
  // When crashes happen: 3-hour blocks through the day, from the time in each police report.
  function todChart(crashes) {
    const known = crashes.filter(c => c.h != null);
    if (!known.length) return '<div class="note">These police reports don\'t include a time.</div>';
    const start = ['12am', '3am', '6am', '9am', '12pm', '3pm', '6pm', '9pm'];
    const range = ['midnight–3am', '3–6am', '6–9am', '9am–noon', 'noon–3pm', '3–6pm', '6–9pm', '9pm–midnight'];
    const bins = start.map((l, i) => ({ l, r: range[i], n: known.filter(c => Math.floor(c.h / 3) === i).length }));
    const max = Math.max(1, ...bins.map(b => b.n)), H = 90;
    const top = bins.reduce((a, b) => (b.n > a.n ? b : a));
    const weekend = crashes.filter(c => c.w >= 6).length, unknown = crashes.length - known.length;
    return `
      <div class="cols tod" style="height:${H + 34}px" role="img" aria-label="Crashes by time of day. ${esc(bins.map(b => `${b.r}: ${b.n}`).join('; '))}">
        ${bins.map(b => `<div class="col" data-tip="${esc(`<b>${b.r}</b><br>${plural(b.n, 'crash', 'crashes')}`)}">
          <span class="cap">${b.n || ''}</span>
          <div class="stack">${b.n ? `<div class="seg" style="height:${Math.round(H * b.n / max)}px;background:${SEV.P.color};border-radius:4px 4px 0 0"></div>` : ''}</div>
          <span class="yr">${b.l}</span></div>`).join('')}
      </div>
      <div class="note">${known.length >= 5 ? `Most often ${top.r} (${top.n} of ${known.length}). ` : ''}${weekend} of ${crashes.length} on a weekend.
        Each bar is 3 hours, from the time in the police report${unknown ? `; ${unknown} ${unknown === 1 ? 'report has' : 'reports have'} no time` : ''}.</div>`;
  }

  // Where this place ranked on 1 January of each year (on the 5 years of crashes before it), and now.
  // The rank strip counts crashes only (repair requests aren't available for past years), so "Now" is today's rank by crashes
  // alone. A year whose 5 crash years mostly overlap today's is left out (it would repeat "Now").
  function rankHistory(p) {
    const got = new Map((p.rank_years || []).map(([y, r]) => [y, r]));
    const wy = +meta.window_from.slice(0, 4);
    const ys = [...got.keys()].filter(y => y - 5 < wy).sort();
    const now = p.rank_noboost ?? p.rank_ksi;
    const yy = y => "'" + String(y).slice(2);
    const cells = ys.map(y => ({ l: `${yy(y - 5)}–${yy(y - 1)}`, sr: `Ranked on crashes from ${y - 5} to ${y - 1}`, r: got.get(y) }))
      .concat([{ l: 'Now', sr: `Now, on crashes from ${monthYear(meta.window_from)} to ${monthYear(meta.window_to)}`, r: now }]);
    const cls = r => r == null ? 'none' : 't' + tierK(r) + (r > 200 ? ' low' : '');
    const in50 = cells.filter(c => c.r && c.r <= 50).length;
    const fixes = placeFixes(p).filter(f => f.k !== 'Bus lane');
    const recent = fixes.filter(f => +f.d.slice(0, 4) >= ys[0] - 1).sort((a, b) => a.d.localeCompare(b.d));
    const m = p.rank_month_ago, mv = m && p.rank_ksi ? m - p.rank_ksi : 0;   // same basis as the list card (last month's rank includes repair reports), in either mode
    return `<div class="legend rh-legend" aria-hidden="true">${[['t0', 'Top 10'], ['t1', '11–25'], ['t2', '26–50'], ['t3', '51+']].map(([c, l]) =>
        `<span><i class="rh-${c}"></i>${l}</span>`).join('')}</div>
      <ol class="rank-hist" style="--n:${cells.length}" aria-label="Rank over the years, by 5-year periods of crashes">
        ${cells.map(c => `<li class="${cls(c.r)}" data-tip="${esc(`<b>${c.sr}</b><br>${c.r ? 'Ranked ' + rankTxt(c.r) : 'No crashes'}`)}">
          <span class="sr-only">${esc(c.sr)}: ${c.r ? 'ranked ' + rankTxt(c.r) : 'no crashes'}.</span>
          <b aria-hidden="true">${c.r ? rankTxt(c.r, false) : '–'}</b><span aria-hidden="true">${c.l}</span></li>`).join('')}
      </ol>
      <div class="note">${in50 ? `Among the top 50 in ${in50} of these ${cells.length} periods. ` : ''}${m
        ? (mv === 0 ? 'Same overall rank as a month ago. ' : `Overall rank ${mv > 0 ? 'up' : 'down'} ${plural(Math.abs(mv), 'place', 'places')} since last month (was ${rankTxt(m)}). `) : ''}
        ${recent.length ? 'Fixes: ' + recent.map(f => `${esc(f.k)} (${fixDate(f.d)})`).join(', ') + '. ' : ''}
        Each period is ranked the same way as today, on its own 5 years of crashes. "–": no crashes in those years.</div>`;
  }

  // Dated work at a place, the same kinds "Is it getting fixed?" counts (pipeline/history.sql, place_fixes), plus bus lanes
  // (shown on the crash chart, never counted as a safety fix).
  function placeFixes(p) {
    const f = [];
    if (p.lpi_status === 'Existing' && p.lpi_installed) f.push({ d: p.lpi_installed, k: 'Head-start walk signal' });
    if (p.ntor_status === 'Existing' && p.ntor_installed) f.push({ d: p.ntor_installed, k: 'No turn on red' });
    if (p.lt_protected && p.lt_installed) f.push({ d: p.lt_installed, k: 'Protected left turn' });
    if (p.addr_type === 'I' && p.signal_installed && p.signal_installed >= '1990-01-01') f.push({ d: p.signal_installed, k: 'Traffic signal installed or rebuilt' });
    (p.fixes || []).filter(x => x.d && x.s === 'Built').forEach(x => f.push({ d: x.d, k: x.k }));
    return f;
  }
  function yearChart(crashes) {
    const y0 = +meta.collisions_from.slice(0, 4), y1 = +meta.collisions_to.slice(0, 4);
    const years = []; for (let y = y0; y <= y1; y++) years.push(y);
    const rows = years.map(y => {
      const c = crashes.filter(x => +x.d.slice(0, 4) === y);
      const severe = c.filter(x => x.s === 'F' || x.s === 'S').length;
      return { y, severe, other: c.length - severe, total: c.length };
    });
    const max = Math.max(1, ...rows.map(r => r.total)), H = 90;
    const summary = rows.map(r => `${r.y}: ${plural(r.total, 'crash', 'crashes')}, ${r.severe} fatal or serious`).join('; ');
    return `
      <div class="legend"><span><i style="background:${SEV.S.color}"></i>Fatal or serious</span>
        <span><i style="background:${SEV.P.color}"></i>Other crashes</span></div>
      <div class="cols" style="height:${H + 34}px" role="img" aria-label="Crashes by year. ${esc(summary)}">
        ${rows.map(r => {
          const hs = Math.round(H * r.severe / max), ho = Math.round(H * r.other / max);
          const gap = hs && ho ? 2 : 0;
          const tip = `<b>${r.y}</b><br>${r.total} crashes<br>${r.severe} fatal or serious`;
          return `<div class="col" data-tip="${esc(tip)}">
            <span class="cap">${r.total || ''}${r.severe ? `<b class="capsev">${r.severe}</b>` : ''}</span>
            <div class="stack">
              ${ho ? `<div class="seg" style="height:${ho}px;background:${SEV.P.color};border-radius:4px 4px 0 0"></div>` : ''}
              ${gap ? '<div style="height:2px"></div>' : ''}
              ${hs ? `<div class="seg" style="height:${hs}px;background:${SEV.S.color};border-radius:${ho ? '0' : '4px 4px 0 0'}"></div>` : ''}
            </div>
            <span class="yr">'${String(r.y).slice(2)}</span>
          </div>`;
        }).join('')}
      </div>
      <div class="note">Top number: all crashes; dark number: fatal or serious. Scored: ${monthYear(meta.window_from)}–${monthYear(meta.window_to)}.
        Later crashes are shown but not scored yet, because police reports arrive months late
        (${y1} is incomplete). ${y0} starts in ${monthYear(meta.collisions_from)}.</div>`;
  }

  // Crashes and repair reports every six months, on one shared timeline, with SDOT's fixes drawn as
  // vertical lines through both panels. Two panels, not two y-axes: the counts have different scales.
  function timeChart(det, p, width) {
    const start = meta.window_from.slice(0, 7);               // first full month of the scoring window
    const mIdx = d => (+d.slice(0, 4) - +start.slice(0, 4)) * 12 + (+d.slice(5, 7) - +start.slice(5, 7));
    const complete = mIdx(meta.window_to) + 1;               // months with complete crash reports
    const n = Math.ceil((Math.max(mIdx(meta.collisions_to), mIdx((D.fetchedAt || meta.collisions_to).slice(0, 10))) + 1) / 6);
    const per = Array.from({ length: n }, (_, i) => {
      const m0 = new Date(+start.slice(0, 4), +start.slice(5, 7) - 1 + 6 * i, 1), m1 = new Date(m0.getFullYear(), m0.getMonth() + 5, 1);
      const name = m0.toLocaleDateString('en-US', { month: 'short' }) + '–' + m1.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      return { i, name, crashes: 0, severe: 0, reports: 0, done: 6 * (i + 1) <= complete, jan: m0.getMonth() === 0, year: m0.getFullYear() };
    });
    const bucket = d => { const k = Math.floor(mIdx(d) / 6); return k >= 0 && k < n ? per[k] : null; };
    det.crashes.forEach(c => { const b = bucket(c.d); if (b) { b.crashes++; if (c.s === 'F' || c.s === 'S') b.severe++; } });
    det.requests.forEach(r => { const b = bucket(r.d); if (b) b.reports++; });

    const fixes = placeFixes(p).map(f => ({ d: f.d, label: f.k }));
    const inRange = fixes.filter(x => mIdx(x.d) >= 0).sort((a, b) => a.d.localeCompare(b.d));
    const before = fixes.filter(x => mIdx(x.d) < 0);

    const W = Math.max(240, Math.round(width)), L = 34, R = 14, top = 22 + 16 * inRange.length;
    const H1 = 110, H2 = 80, gap = 34, xb = top + H1 + gap + H2;
    const X = m => L + (W - L - R) * m / (6 * n), mid = i => X(6 * i + 3);
    const nice = v => v <= 4 ? 4 : v <= 6 ? 6 : v <= 10 ? 10 : Math.ceil(v / 5) * 5;
    const maxC = nice(Math.max(...per.map(b => b.crashes))), maxR = nice(Math.max(...per.map(b => b.reports)));
    const Y1 = v => top + H1 - H1 * v / maxC, Y2 = v => top + H1 + gap + H2 - H2 * v / maxR;
    // solid line through complete periods, dashed into the incomplete ones
    const line = (key, Y, color) => {
      const pts = per.map(b => [mid(b.i), Y(b[key])]), last = per.filter(b => b.done).length;
      const d = a => a.map((q, j) => (j ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
      return '<path d="' + d(pts.slice(0, last)) + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round"/>' +
        (last < n ? '<path d="' + d(pts.slice(Math.max(0, last - 1))) + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-dasharray="4 4"/>' : '');
    };
    const dots = (key, Y, color) => per.map(b => '<circle cx="' + mid(b.i) + '" cy="' + Y(b[key]) + '" r="4" fill="' + (b.done ? color : '#fff') +
      '" stroke="' + (b.done ? '#fff' : color) + '" stroke-width="2"/>').join('');
    const squares = per.map(b => '<rect x="' + (mid(b.i) - 4) + '" y="' + (Y2(b.reports) - 4) + '" width="8" height="8" rx="1.5" fill="' +
      (b.done ? REQ_COLOR : '#fff') + '" stroke="' + (b.done ? '#fff' : REQ_COLOR) + '" stroke-width="2"/>').join('');
    const axis = (y0, h, max) => [0, max / 2, max].map(v => { const y = y0 + h - h * v / max;
      return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" stroke="' + (v ? '#eceae4' : '#c3c2b7') + '"/>' +
        '<text x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end" class="tc-ax">' + v + '</text>'; }).join('');
    const years = per.filter(b => b.jan).map(b => '<line x1="' + X(6 * b.i) + '" x2="' + X(6 * b.i) + '" y1="' + top + '" y2="' + xb + '" stroke="#e4e2db"/>' +
      '<text x="' + (X(6 * b.i) + 3) + '" y="' + (xb + 14) + '" class="tc-ax">' + b.year + '</text>').join('');
    const fixLines = inRange.map((x, j) => { const fx = X(mIdx(x.d) + (+x.d.slice(8, 10) - 1) / 30), ly = 12 + 16 * j, tw = 7 * (x.label.length + 11), tx = Math.max(2, Math.min(fx + 5, W - 4 - tw));
      return '<line x1="' + fx + '" x2="' + fx + '" y1="' + (ly + 3) + '" y2="' + xb + '" stroke="#1d2430" stroke-width="2" stroke-dasharray="6 4"/>' +
        '<text x="' + tx + '" y="' + ly + '" class="tc-fix">' + esc(x.label) + ', ' + fixDate(x.d) + '</text>'; }).join('');
    const hits = per.map(b => '<rect class="tc-hit" x="' + X(6 * b.i) + '" y="' + top + '" width="' + (X(6) - X(0)) + '" height="' + (xb - top) + '" data-tip="' + esc(
      '<b>' + b.name + '</b>' + (b.done ? '' : ' (incomplete)') + '<br>' + plural(b.crashes, 'crash', 'crashes') + ', ' + b.severe + ' killed or seriously hurt someone<br>' + plural(b.reports, 'repair report')) + '"/>').join('');
    const summary = 'Crashes and repair reports every six months. ' + per.map(b => b.name + ': ' + plural(b.crashes, 'crash', 'crashes') + ', ' + b.severe + ' killed or seriously hurt someone, ' + plural(b.reports, 'repair report')).join('; ') +
      (inRange.length ? '. ' + inRange.map(x => x.label + ' installed ' + fixDate(x.d)).join('; ') : '');
    const svg = '<svg class="tchart" width="' + W + '" height="' + (xb + 22) + '" viewBox="0 0 ' + W + ' ' + (xb + 22) + '" role="img" aria-label="' + esc(summary) + '">' +
      years + axis(top, H1, maxC) + axis(top + H1 + gap, H2, maxR) +
      '<text x="' + L + '" y="' + (top - 6) + '" class="tc-t">Crashes</text>' +
      '<text x="' + L + '" y="' + (top + H1 + gap - 8) + '" class="tc-t">Repair reports within ' + ft(weight('request_radius_m')) + ' ft</text>' +
      line('crashes', Y1, SEV.I.color) + line('severe', Y1, SEV.F.color) + line('reports', Y2, REQ_COLOR) +
      dots('crashes', Y1, SEV.I.color) + dots('severe', Y1, SEV.F.color) + squares + fixLines + hits + '</svg>';

    // Before/after for the first fix in range, using complete crash data only.
    let ba = '';
    const fx = inRange[0];
    if (fx) {
      const endC = meta.window_to, yrs = (a, b) => Math.max(0, (new Date(b) - new Date(a)) / 3.15576e10);
      const inC = (a, b) => det.crashes.filter(c => c.d >= a && c.d < b && c.d <= endC);
      const b0 = inC(meta.window_from, fx.d), a0 = inC(fx.d, '9999'), yb = yrs(meta.window_from, fx.d), ya = yrs(fx.d, endC);
      const rate = (arr, y) => y >= 0.5 ? (arr.length / y).toFixed(1) : null;
      const sev = arr => arr.filter(c => c.s === 'F' || c.s === 'S').length;
      const what = fx.label.toLowerCase();
      if ((p.before_after || []).some(b => b.k.toLowerCase() === what)) ba = '<p class="tc-ba">For equal periods before and after the ' + esc(what) + ', see "Before and after" under What SDOT has done or plans here.</p>';
      else if (rate(b0, yb) && rate(a0, ya)) ba = '<p class="tc-ba">Within the scored years (' + windowTxt() + '). <b>Before the ' + esc(what) + ':</b> ' + rate(b0, yb) + ' crashes of all kinds a year (' + sev(b0) + ' fatal or serious in ' + yb.toFixed(1) + ' years). ' +
        '<b>After:</b> ' + rate(a0, ya) + ' a year (' + sev(a0) + ' fatal or serious in ' + ya.toFixed(1) + ' years). ' +
        (ya < 2 ? "That's under 2 years, too short to tell a real change from normal ups and downs." : 'Crash counts swing from year to year, so treat a small change as a hint, not proof.') + '</p>';
      else ba = '<p class="tc-ba">Not enough time on one side of the ' + esc(what) + ' to compare before and after.</p>';
    }
    return '<div class="legend"><span><i style="background:' + SEV.I.color + '"></i>All crashes</span>' +
      '<span><i style="background:' + SEV.F.color + '"></i>Fatal or serious</span>' +
      '<span><i class="sq" style="background:' + REQ_COLOR + '"></i>Repair reports</span>' +
      (inRange.length ? `<span><i class="dash"></i>${inRange.every(x => x.label === 'Bus lane') ? 'SDOT change' : 'SDOT fix'}</span>` : '') + '</div>' +
      '<div class="tc-wrap">' + svg + '</div>' + ba +
      '<div class="note">Every 6 months. Hollow points and dashed lines: not complete yet, because police reports arrive months late. ' +
      (!fixes.length ? "No dated SDOT fixes here, so there's no fix line (repaving, sidewalks and redesigns aren't linked yet). " : '') +
      before.map(x => esc(x.label) + ' installed ' + fixDate(x.d) + ', before this chart starts. ').join('') +
      'Repair reports count every repair type nearby. More people use Find It Fix It each year, so a rise can mean more reporting, not a worse street.</div>';
  }

  function hbars(items, color, unit) {
    if (!items.length) return '';
    const max = Math.max(...items.map(i => i.n));
    return `<div class="hbars">${items.map(i => `
      <div class="hbar" data-tip="${esc(`<b>${esc(i.label)}</b><br>${i.n} ${unit}`)}">
        <div class="hlabel">${esc(i.label)}</div>
        <div class="htrack"><div class="hfill" style="width:${Math.max(2, 100 * i.n / max)}%;background:${color}"></div><span>${i.n}</span></div>
      </div>`).join('')}</div>`;
  }

  function volumeText(p) {
    if (!p.volume) return '<span class="muted">no SDOT count</span>';
    const what = p.addr_type === 'I' && p.volume_streets > 1 ? `vehicles entering / weekday (${p.volume_streets === 2 ? 'both' : 'all ' + p.volume_streets} streets' counts added together)` : 'vehicles / weekday';
    const src = p.volume_estimated ? 'includes an SDOT estimate, not a count' : `SDOT count from ${p.volume_year}${p.volume_streets > 1 ? ' or later' : ''}`;
    return `${fmt(p.volume)} ${what} <span class="muted">(${src})</span>`;
  }

  // Street context from SDOT's street network, traffic counts and Vision Zero layers.
  function crosswalkText(p) {
    if (!p.crosswalks) return p.addr_type === 'I' ? 'none' : 'none on this block';
    const ctl = { SIGNAL: 'traffic signal', STOPSIGN: 'stop sign', 'RFB-BCN': 'flashing beacon', 'FLSH-BCN': 'flashing light' };
    const bits = [];
    if (p.crosswalks_midblock) bits.push(`${p.crosswalks_midblock} mid-block`);
    if (p.crosswalk_school) bits.push('school crosswalk');
    const c = (p.crosswalk_controls || []).map(k => ctl[k]).filter(Boolean);
    if (c.length) bits.push('with ' + c.join(', '));
    return `${p.crosswalks}${bits.length ? ` <span class="muted">(${bits.join('; ')})</span>` : ''}`;
  }

  // Crashes in equal periods before and after something SDOT built here, next to the citywide change.
  function beforeAfter(p) {
    const L = p.before_after || [];
    if (!L.length) return '';
    const what = { ped: 'crashes involving people walking', turnped: 'people walking hit by turning drivers', bike: 'crashes involving people biking', left: 'left-turn crashes', all: 'crashes' };
    const span = days => { const mo = Math.round(days / 30.44); return mo >= 12 && mo % 12 === 0 ? plural(mo / 12, 'year', 'years') : plural(mo, 'month', 'months'); };
    const city = (b, a) => { if (!b) return ''; const ch = Math.round(100 * (a / b - 1));
      return ch === 0 ? 'stayed about the same' : `went ${ch < 0 ? 'down' : 'up'} ${Math.abs(ch)}%`; };
    return `<h4 class="proj-h">Before and after</h4>
      <ul class="ba-list">${L.map(x => `<li><b>${esc(x.k)}</b> (${fixDate(x.d, x.yo)}): ${what[x.m]} here, ${span(x.days)} before:
        <b>${x.b}</b>; ${span(x.days)} after: <b>${x.a}</b>.${x.pb != null ? ` (And ${x.pb} in the ${span(x.days)} before that.)` : ''}${x.other ? ' Another dated fix went in here around the same years, so their effects are mixed.' : ''}
        <span class="muted">Citywide, the same kind of crash ${city(x.cb, x.ca)} over the same periods.</span></li>`).join('')}</ul>
      <div class="note">Counts this small can swing a lot from one period to the next, and fixes often go in right after a bad
        stretch, so some drop afterwards is expected either way. This shows what happened, not whether the fix caused it.
        Older crashes (from 2011) come from the same SDOT data; the month the work happened is left out (the whole year, when SDOT gives only the year).</div>`;
  }

  function streetInfo(p) {
    const pci = p.pavement_min;
    const pciLabel = pci == null ? 'not rated' : `${pci}/100 (${pci >= 70 ? 'good' : pci >= 40 ? 'fair' : 'poor'})`;
    const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    return `<table class="kv">
      ${row('Street type', esc(p.street_type || '—') + (p.state_route || p.state_hwy ? ` · <b>${esc(p.state_route || p.state_hwy)}</b>` : ''))}
      ${p.block_ft ? row('Block length', `${fmt(p.block_ft)} ft <span class="muted">(typical block ${fmt(meta.median_block_ft)} ft; longer blocks collect more crashes)</span>`) : ''}
      ${row('Speed limit', p.speed_limit ? p.speed_limit + ' mph <span class="muted">(at a corner, the higher of the streets’ limits)</span>' : '—')}
      ${row('Traffic', volumeText(p))}
      ${row('Pavement', pciLabel + (pci != null ? ' <span class="muted">(worst block here)</span>' : ''))}
      ${p.crosswalks != null ? row('Marked crosswalks', crosswalkText(p)) : ''}
      ${p.addr_type === 'I' && p.crosswalks != null ? row('Curb ramps', p.curb_ramps
          ? `${p.curb_ramps}${p.curb_ramps_poor ? `, <b>${p.curb_ramps_poor} rated poor</b>` : ', none rated poor'}` : 'none in SDOT data') : ''}
      ${p.crosswalks != null ? row('Bike facility', p.bike_facilities && p.bike_facilities.length ? esc(p.bike_facilities.join(', ')) : 'none') : ''}
      ${p.school ? row('Nearby school', `${esc(schoolName(p.school))} <span class="muted">(about ${fmt(Math.round(p.school_ft / 10) * 10)} ft)</span>`) : ''}
    </table>
    ${p.crosswalks != null ? `<div class="note">Crosswalks, curb ramps and bike facilities from SDOT's street asset data; nearby schools (within 1,000 ft) from the City's public school list.</div>` : ''}
    ${p.state_route || p.state_hwy || p.structure ? `<div class="note">${p.state_route
        ? `WSDOT owns and runs this part of ${esc(p.state_route)}${p.state_bridge ? ` (its bridge listed as “${esc(p.state_bridge)}”)` : ''}, from WSDOT's state route, access control and bridge data.`
        : p.state_hwy ? `This is ${esc(p.state_hwy)}, a state highway on a city street. In a city this size the City runs such streets (signals, crossings, lanes; state law, RCW 47.24), so SDOT is the agency to ask, and the site counts it as a city street.`
        : 'This is a bridge, ramp or tunnel (SDOT\'s or WSDOT\'s; WSDOT\'s state bridge list doesn\'t include it).'}</div>` : ''}`;
  }

  // What SDOT has already done or flagged here.
  function treatments(p) {
    const items = [];
    if (p.sdot_hin) items.push(`On SDOT's <b>High Injury Network</b> (${esc(p.sdot_hin)} priority).`);
    // SDOT keeps separate lists (signalized and unsignalized corners, mid-block, pedestrian, bicycle): say which.
    const hclType = { Signalized: 'signalized intersections', 'Non-Signalized': 'intersections without a signal', 'Mid-Block': 'mid-block', Pedestrian: 'pedestrian', Bicycle: 'bicycle' };
    if (p.sdot_hcl_years && p.sdot_hcl_years.length) items.push(`On SDOT's <b>High Collision Locations</b> list${(p.sdot_hcl_types || []).length
      ? ` (${p.sdot_hcl_types.map(t => hclType[t] || esc(t)).join(', ')})` : ''} in ${esc(p.sdot_hcl_years.join(', '))}.`);
    if (p.lpi_status === 'Existing') items.push(`<b>Head-start walk signal</b> (Leading Pedestrian Interval: the walk light comes on a few seconds before cars get a green) since ${p.lpi_installed ? monthYear(p.lpi_installed) : 'an unknown date'}.`);
    else if (p.lpi_status === 'Planned') items.push(`Head-start walk signal <b>planned</b>${plannedFor(p.lpi_planned)}.`);
    else if (p.lpi_status === 'Not Feasible') items.push(`Head-start walk signal judged <b>not feasible</b> by SDOT.`);
    const dirWord = { N: 'north', S: 'south', E: 'east', W: 'west', NE: 'northeast', NW: 'northwest', SE: 'southeast', SW: 'southwest',
      NB: 'south', SB: 'north', EB: 'west', WB: 'east' };   // an approach is named for where drivers come from
    const appr = /^all( legs)?$/i.test((p.ntor_approaches || '').trim()) ? ' (every direction)' : p.ntor_approaches ? (/^[NSEW]{1,2}B?([ ,&/]+(and )?[NSEW]{1,2}B?)*$/i.test(p.ntor_approaches.trim())
      ? ` (for drivers coming from the ${p.ntor_approaches.trim().split(/[ ,&/]+(?:and )?/i).map(x => dirWord[x.toUpperCase()]).reduce((s, x, i, a) => s + (i ? (i === a.length - 1 ? ' and ' : ', ') : '') + x, '')})`
      : ` (${esc(p.ntor_approaches)} ${/[,&/]| and /.test(p.ntor_approaches) ? 'approaches' : 'approach'})`) : '';
    if (p.ntor_status === 'Existing') items.push(`<b>No turn on red</b>${appr} since ${p.ntor_installed ? fixDate(p.ntor_installed) : 'an unknown date'}.`);
    else if (p.ntor_status === 'Planned') items.push(`No turn on red <b>planned</b>${plannedFor(p.ntor_planned)}.`);
    else if (p.ntor_status === 'Not Feasible') items.push(`No turn on red judged <b>not feasible</b> by SDOT.`);
    if (p.lt_protected) items.push(`Protected left-turn signal${p.lt_installed ? ' since ' + p.lt_installed.slice(0, 4) : ''}.`);
    if (p.signalized && p.ped_audio) items.push('Accessible (audible) pedestrian signals.');
    (p.fixes || []).forEach(f => {
      if (f.s !== 'Built') items.push(`${esc(f.k)} <b>${esc(f.s.toLowerCase())}</b>.`);
      else items.push(`<b>${esc(f.k)}</b>${f.n > 1 ? ` (${f.n})` : ''}${f.d ? (f.u ? ` (one section dated ${fixDate(f.d)}; SDOT gives no date for the rest)` : ' since ' + fixDate(f.d)) : ''}.`);
    });
    if (p.addr_type === 'I' && !p.signalized) items.push('No traffic signal in SDOT\'s signal data.');
    else if (p.signalized && p.signal_installed && +p.signal_installed.slice(0, 4) >= 1990)
      items.push(`<b>Traffic signal</b> installed or last rebuilt in ${p.signal_installed.slice(0, 4)} (SDOT signal data).`);
    const still = stillDangerous(p);
    // Planned and recent projects from SDOT's published project maps (the planned walk signal is already listed above).
    const projs = projectsAt(p).filter(j => j.kind !== 'lpi'), lpiPlanned = projectsAt(p).some(j => j.kind === 'lpi');
    const kinds = [...new Set(projs.map(j => j.kind))];
    return `${still ? `<p class="callout">${esc(still.long)}</p>` : ''}
      ${items.length ? `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>` : '<div class="note">Nothing recorded in the SDOT layers this site reads.</div>'}
      ${beforeAfter(p)}
      <h4 class="proj-h">SDOT projects published nearby</h4>
      ${projs.length ? `<ul class="proj-list">${projs.map(j => `<li>${projHtml(j)}</li>`).join('')}</ul>
        <div class="note">From ${kinds.map(k => esc(PROJ_SRC[k]())).join(' and ')}. "Nearby" means within about
          ${p.addr_type === 'I' ? '100 ft' : '40 ft of the block'}. A project nearby isn't necessarily aimed at these crashes; check what it is.</div>`
      : lpiPlanned ? `<div class="note">Besides the planned head-start walk signal above, nothing else on SDOT's published
          project maps (new sidewalks, neighborhood safety projects). SDOT may have other plans here, such as paving or corridor
          projects, that aren't in the map layers this site reads.</div>`
      : `<div class="note">None on SDOT's published project maps (new sidewalks, neighborhood safety projects, head-start walk
          signals). SDOT may have other plans here, such as paving or corridor projects, that aren't in the map layers this site reads.</div>`}
      ${projToggleBtn()}
      ${(p.cip || []).length ? `<h4 class="proj-h">In SDOT's capital budget</h4>
        <ul class="proj-list">${p.cip.map(c => `<li><b>${esc(c.t)}</b> <span class="muted">· ${esc(c.c)}</span> — money budgeted ${c.y0 === c.y1 ? 'in ' + c.y0 : `${c.y0}–${c.y1}`}.</li>`).join('')}</ul>
        <div class="note">Matched by the street named in the project's title, in the City's adopted budget. The budget doesn't say
          which blocks a project covers, so it may or may not reach this spot, and it isn't counted as a fix here.</div>` : ''}
      <div class="note">From SDOT signal, Vision Zero, traffic-calming, bike-lane, bus-lane and project-map data, and the City's capital
        budget. Repaving isn't linked: SDOT doesn't publish a current map of it.</div>`;
  }

  function countBy(arr, f) {
    const m = new Map(); arr.forEach(x => { const k = f(x); m.set(k, (m.get(k) || 0) + 1); });
    return [...m].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n || String(a.label).localeCompare(String(b.label)));
  }

  function crashTable(crashes) {
    const filters = { all: () => true, severe: c => c.s === 'F' || c.s === 'S', injury: c => c.s === 'I',
                      ped: c => c.pd > 0 || c.cy > 0, speeding: c => c.sp };
    const list = crashes.filter(filters[crashFilter]);
    const all = showAllCrashes || expanded;
    const shown = all ? list : list.slice(0, 20);
    const btn = (k, label, n) => `<button type="button" class="fbtn ${crashFilter === k ? 'on' : ''}" aria-pressed="${crashFilter === k}" data-cf="${k}">${label} <small>${n}</small></button>`;
    return `
      <p class="note">Every report on file here (${fmt(crashes.length)}), including recent ones not scored yet, so these counts can differ a little from the ones above.</p>
      <div class="fbar" role="group" aria-label="Filter crashes">
        ${btn('all', 'All', crashes.length)}${btn('severe', 'Killed or seriously hurt', crashes.filter(filters.severe).length)}
        ${btn('injury', 'Injury', crashes.filter(filters.injury).length)}${btn('ped', 'Walking or biking', crashes.filter(filters.ped).length)}
        ${btn('speeding', 'Speed-related', crashes.filter(filters.speeding).length)}
      </div>
      <table class="dtable"><thead><tr><th>Date</th><th>Severity</th><th>What happened</th></tr></thead><tbody>
      ${shown.map(c => {
        const who = [c.pd ? `${c.pd} pedestrian${c.pd > 1 ? 's' : ''}` : '', c.cy ? `${c.cy} cyclist${c.cy > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ');
        const hurt = [c.fat ? `${c.fat} killed` : '', c.ser ? `${c.ser} seriously injured` : '', c.inj ? `${c.inj} injured` : ''].filter(Boolean).join(', ');
        const cond = [c.rd, c.lt, c.wx].filter(v => v && !/^(unknown|other)$/i.test(v)).join(' · ');
        return `<tr>
          <td class="nowrap">${c.d}${c.n ? `<div class="sub2">${c.d < meta.window_from ? 'before the scored years' : 'not scored yet'}</div>` : ''}</td>
          <td class="nowrap"><i class="sev" style="background:${SEV[c.s].color}"></i>${SEV[c.s].label}</td>
          <td>${esc(c.t ? crashType(c.t) : 'Type not recorded')}${c.sp ? ' <span class="flag">speeding</span>' : ''}
            ${who ? `<div class="sub2">Involved ${esc(who)}</div>` : ''}
            ${hurt ? `<div class="sub2">${esc(hurt)}</div>` : ''}
            ${cond ? `<div class="sub2 muted">${esc(cond)}</div>` : ''}</td></tr>`;
      }).join('') || '<tr><td colspan="3" class="muted">None</td></tr>'}
      </tbody></table>
      ${list.length > 20 && !expanded ? `<button type="button" class="linkbtn" data-more="crashes">${showAllCrashes ? 'Show fewer' : `Show all ${list.length}`}</button>` : ''}`;
  }

  function reqTable(reqs) {
    const list = reqs.filter(r => !reqFilter || r.t === reqFilter);
    const shown = showAllReqs || expanded ? list : list.slice(0, 20);
    const types = countBy(reqs, r => r.t);
    return `
      <div class="fbar"><select id="reqType" aria-label="Filter repair requests by type"><option value="">All types (${reqs.length})</option>
        ${types.map(t => `<option value="${esc(t.label)}" ${t.label === reqFilter ? 'selected' : ''}>${esc(t.label)} (${t.n})</option>`).join('')}
      </select></div>
      <table class="dtable"><thead><tr><th>Date</th><th>Request</th><th>Status</th></tr></thead><tbody>
      ${shown.map(r => `<tr>
          <td class="nowrap">${r.d}</td>
          <td>${esc(r.t)}<div class="sub2 muted">${esc(r.a || '')} · ${ft(r.m)} ft away</div></td>
          <td>${esc(r.st || '')}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">None</td></tr>'}
      </tbody></table>
      ${list.length > 20 && !expanded ? `<button type="button" class="linkbtn" data-more="reqs">${showAllReqs ? 'Show fewer' : `Show all ${list.length}`}</button>` : ''}
      <div class="note">City status is unreliable: most requests stay "Reported" even after a fix.</div>`;
  }

  // Center a point in the part of the map not covered by the detail panel.
  function flyVisible(latlng, zoom) {
    let pt = map.project(latlng, zoom);
    if (!detailEl.hidden && !isNarrow()) pt = pt.add([(detailEl.offsetWidth || 440) / 2, 0]);
    if (!isNarrow()) pt = pt.subtract([leftPad() / 2, 0]);
    // phone: centre it in the map above the sheet (at most half the screen, so it's in view when the sheet comes down)
    else pt = pt.add([0, Math.min(cover, fullH() / 2) / 2]);
    const c = map.unproject(pt, zoom);
    if (reduceMotion) map.setView(c, zoom, { animate: false }); else map.flyTo(c, zoom, { duration: 0.6 });
  }

  map.createPane('sel'); map.getPane('sel').style.zIndex = 640;   // above markers (600), below tooltips (650)
  function drawFocus(p, det) {
    focus.clearLayers();
    // The search area, made obvious: shaded, dashed, and labelled with its size on the map itself.
    const rm = weight('request_radius_m');
    L.circle([p.lat, p.lon], { radius: rm, color: '#1d2430', weight: 2, dashArray: '6 5', fillColor: REQ_COLOR, fillOpacity: 0.08, interactive: false }).addTo(focus);
    L.marker([p.lat + rm / 111320, p.lon], { keyboard: false, interactive: false,
      icon: L.divIcon({ className: 'radius-label', iconSize: null, html: `<span>Find It, Fix It repair requests within ${ft(rm)} ft</span>` }) }).addTo(focus);
    const groups = new Map();
    (det ? det.requests : []).filter(r => !reqFilter || r.t === reqFilter).forEach(r => {
      const k = r.lat + ',' + r.lon;
      (groups.get(k) || groups.set(k, []).get(k)).push(r);
    });
    groups.forEach(rs => {
      const n = rs.length, size = n > 1 ? 18 : 12;
      const lines = countBy(rs, r => r.t).map(t => `${esc(t.label)}: ${t.n}`).join('<br>');
      // Not keyboard-focusable: the request table is the accessible version of this layer.
      L.marker([rs[0].lat, rs[0].lon], {
        keyboard: false,
        icon: L.divIcon({ className: 'reqmark', iconSize: [size, size],
          html: `<span style="background:${REQ_COLOR};width:${size - 2}px;height:${size - 2}px">${n > 1 ? n : ''}</span>` })
      }).bindTooltip(`<b>${n} request${n > 1 ? 's' : ''} here</b><br>${lines}<br><span style="color:#c8c6bf">${esc(rs[0].a || '')}</span>`).addTo(focus);
    });
    Object.entries(markers).forEach(([id, m]) => dim(m, +id !== p.rank_ksi));
    const sel = markers[p.rank_ksi];
    if (sel && sel.bringToFront) sel.bringToFront();
    if (sel && sel.setZIndexOffset) sel.setZIndexOffset(5000);   // top-10 markers share the request markers' layer
    // The picked spot drawn again above the request squares, so it can always be clicked to zoom back out.
    // (A ranked dot is redrawn as itself; a spot not drawn in this view gets a white ring.)
    if (!sel || sel.getRadius) {
      L.circleMarker([p.lat, p.lon], sel ? { ...sel.options, pane: 'sel' }
        : { pane: 'sel', radius: 9, color: '#1d2430', weight: 3, fillColor: '#fff', fillOpacity: 0.9 })
        .bindTooltip(`${esc(p.name)}: click again to zoom back out`, { direction: 'top', offset: [0, -6] })
        .on('click', () => pickSpot(p, true, null)).addTo(focus);
    }
  }

  function clearFocus() {
    focus.clearLayers();
    Object.values(markers).forEach(m => dim(m, false));
    Object.values(markers).sort((a, b) => (b._p.rank ?? 1e9) - (a._p.rank ?? 1e9)).forEach(m => {
      if (m.bringToFront) m.bringToFront(); else m.setZIndexOffset(1000 - m._p.rank);
    });
    current = null; markCurrent();
  }

  function markCurrent() {
    document.querySelectorAll('#list li[data-id]').forEach(li => {
      const on = !!current && +li.dataset.id === current.rank_ksi;
      li.classList.toggle('selected', on);
      const b = li.querySelector('button'); if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
  }

  // One plain-language summary someone could quote.
  function verdict(p) {
    const parts = [];
    let s = `${plural(p.crashes, 'crash', 'crashes')} from ${monthYear(meta.window_from)} to ${monthYear(meta.window_to)}`;
    // crashes and people are different counts (one crash can hurt several people): say both
    const ppl = (p.killed || 0) + (p.seriously_injured || 0);
    const who = [p.killed ? `${p.killed} killed` : '', p.seriously_injured ? `${p.seriously_injured} seriously injured` : ''].filter(Boolean).join(', ');
    s += !p.ksi ? '; none killed or seriously hurt anyone'
      : `; ${p.crashes === 1 ? 'it' : p.ksi === p.crashes ? `all ${p.ksi}` : `${p.ksi} of them`} `
        + (!ppl ? 'killed or seriously hurt someone'
          : p.killed && p.seriously_injured ? `killed or seriously hurt ${plural(ppl, 'person', 'people')} (${who})`
          : `${p.killed ? 'killed' : 'seriously injured'} ${plural(ppl, 'person', 'people')}`);
    parts.push(s + '.');
    const inv = (n, verb) => `${n} involved ${n === 1 ? 'a person' : 'people'} ${verb}`;
    const pb = [p.ped_crashes ? inv(p.ped_crashes, 'walking') : '', p.bike_crashes ? inv(p.bike_crashes, 'biking') : ''].filter(Boolean);
    if (pb.length) parts.push(pb.join(' and ') + '.');
    const st = [p.speed_limit ? `${p.speed_limit} mph` : '', (p.street_type || '').toLowerCase(), p.volume ? `${fmt(p.volume)} vehicles a weekday` : ''].filter(Boolean);
    if (st.length) parts.push(st.join(', ').replace(/^./, c => c.toUpperCase()) + '.');
    const rk = p.rank_ksi;
    const line2 = `Ranks <b>#${fmt(rk)}</b> of ${fmt(kindCount(rk))} places with crashes (${topShare(rk)})` +
      (p.rank_risk ? `, and #${fmt(p.rank_risk)} of the ${fmt(D.priorities.filter(q => q.rank_risk).length)} places with a traffic count and enough crashes to rate, once you account for how busy it is` : '') + '.';
    const why = p.killed >= 2 && rk > 50
      ? `<p class="callout">${p.fatal >= 2 ? `${p.killed} people died here, in ${p.fatal} crashes.` : `One crash here killed ${p.killed} people.`} It ranks ${rankTxt(rk)} because the ranking estimates where people are most
          likely to be hurt next, and this spot has few other crashes (${p.crashes} in total), which gives the ranking little history to tell whether the
          danger here will continue, so it leans on what's typical for similar streets.${p.fatal >= 2 ? ' That may understate it: repeated deaths can mean traffic moves at deadly speeds.' : ''} It's always added to the lists
          so it isn't overlooked.</p>` : '';
    const w = workSummary(p);
    return `<p class="verdict">${esc(parts.join(' '))}</p><p class="verdict2">${line2}</p>
      <p class="workline w-${w.cls}"><b>SDOT work:</b> ${esc(w.text)}.</p>${why}`;
  }

  // One plain sentence on what drives the rank, from the same parts as "How this score is calculated" below.
  function whyRank(p) {
    if (mode !== 'ksi' || p.rank_ksi == null || p.expected_harm == null || p.crashes < 5) return '';
    const other = p.harm - p.ksi_harm, fs = p.expected_harm - other;          // harm from other crashes; blended fatal/serious part
    const own = p.ksi_harm, typ = p.crashes * p.ref_ksi_harm_per_crash, w = p.eb_weight;
    const parts = [other >= fs
      ? `most of the score comes from its ${plural(p.crashes, 'crash', 'crashes')} of all kinds, each counted by how badly people were hurt`
      : p.ksi ? `most of the score comes from its ${plural(p.ksi, 'crash', 'crashes')} that killed or seriously hurt someone`
      : `none of its crashes killed or seriously hurt anyone; most of the score is the risk of that which is typical for ${groupName(p.ref_group)} with ${plural(p.crashes, 'crash', 'crashes')}`];
    if (p.ksi && w < 0.9 && Math.abs(own - typ) > 0.2 * Math.max(own, typ, 1))
      parts.push(`crashes that kill or seriously hurt are rare, so the score is ${Math.round(100 * w)}% this place's own record and
        ${100 - Math.round(100 * w)}% what's typical for ${groupName(p.ref_group)} (the more crashes a place has, the more its own record
        counts), which puts it ${own > typ ? 'below' : 'above'} its own record alone`);
    if (p.request_boost >= 0.05) parts.push(`repair reports nearby raise it ${Math.round(100 * p.request_boost)}%`);
    return `<p class="note why-rank"><b>Why ${rankTxt(p.rank_ksi)} citywide:</b> ${parts.join('; ')}. <a href="#" class="why-more">How it's calculated</a></p>`;
  }
  function mathBox(p) {
    const k = weight('ksi_prior_crashes');
    const ksiLine = `
      <p><b>Expected harm ${fmt(Math.round(p.expected_harm))}</b> =
        other-crash harm ${fmt(Math.round(p.harm - p.ksi_harm))}
        + fatal/serious harm, blended: ${Math.round(100 * p.eb_weight)}% this spot's own record (${fmt(Math.round(p.ksi_harm))})
        and ${100 - Math.round(100 * p.eb_weight)}% the typical rate for ${esc(groupName(p.ref_group))} applied to its ${p.crashes} crashes
        (${(p.crashes * p.ref_ksi_harm_per_crash).toFixed(0)})${p.unknown_sev ? ` + ${p.unknown_sev} crash${p.unknown_sev === 1 ? '' : 'es'} with unknown severity × the typical other-crash harm ${(+p.ref_other_harm_per_known || 0).toFixed(1)}` : ''}.</p>
      <p class="note">Own-record weight = crashes ÷ (crashes + ${k}). Raw crash harm before blending: ${fmt(Math.round(p.harm))}.</p>
      ${weight('request_boost_max') > 0 ? `<p><b>Score ${fmt(Math.round(p.score_ksi))}</b> = expected harm × repair boost ${(1 + p.request_boost).toFixed(2)}
        <span class="muted">(${plural(p.scored_requests, 'safety-related request')} since ${monthYear(meta.requests_scored_from)})</span>.
        ${p.request_boost >= 0.005 ? `Without the boost it would rank ${rankTxt(p.rank_noboost)}.` : ''}</p>`
        : `<p><b>Score ${fmt(Math.round(p.score_ksi))}</b> = expected harm. Repair requests nearby are listed on this page but don't change the score.</p>`}`;
    const riskLine = p.score_risk != null
      ? `<p><b>Risk ${p.score_risk.toFixed(1)} per million vehicles</b> = expected harm ${fmt(Math.round(p.expected_harm))} ÷
          (${fmt(Math.max(p.volume, weight('risk_vol_floor')))} vehicles a weekday × 365 × 5 years ÷ 1 million).</p>`
      : `<p class="note">Not ranked for risk: ${p.volume ? `fewer than ${weight('risk_min_crashes')} crashes` : 'no SDOT traffic count'}.</p>`;
    const ranks = `<p class="note">Ranks: ${rankTxt(p.rank_ksi)} most likely to hurt people · ${p.rank_risk ? '#' + p.rank_risk : 'unranked'} for how busy it is.</p>`;
    return (mode === 'risk' ? riskLine + ksiLine : ksiLine + riskLine) + ranks;
  }
  const groupName = g => {
    const [a, s] = g.split(' / ');
    return `${a === 'I' ? 'intersections' : 'blocks'} on ${{ principal: 'major streets (principal arterials)', minor: 'main streets (minor arterials)', collector: 'collector streets', state: 'state routes and freeways', local: 'neighborhood streets' }[s] || s}`;
  };

  // The map view from before a spot was opened, so closing it zooms back out to where you were.
  let viewBefore = null;
  const rememberView = () => { if (!spotOpen() && !viewBefore) viewBefore = { c: map.getCenter(), z: map.getZoom() }; };
  function select(p, fly, from, keepFocus) {
    // The crash list and requests come from the place's map-area file: show the short summary while it loads.
    if (!D.details[p.location] && p.cell) {
      if (moreCache.has(p.cell)) ingestCell(moreCache.get(p.cell));
      else {
        const tok = ++liteToken, f = from === undefined ? opener : from;
        const s = { name: p.location, lat: p.lat, lon: p.lon, rank: p.rank_ksi, crashes: p.crashes, ksi: p.ksi, pb: p.pb_crashes,
                    type: p.addr_type, hood: p.neighborhood || '', area: p.area || '', cell: p.cell };
        selectBrief(s, 'loading', !fly);
        loadCell(p.cell).then(d => {
          ingestCell(d);
          if (tok === liteToken && current && current.rank_ksi === p.rank_ksi) select(p, false, f, keepFocus);   // the summary already moved the map
        }, () => { if (tok === liteToken && current && current.rank_ksi === p.rank_ksi) selectBrief(s, 'failed', true); });
        return;
      }
    }
    rememberView();
    liteToken++;   // a pending area-file load for an earlier pick must not replace this one
    if (!current || current.rank_ksi !== p.rank_ksi) { crashFilter = 'all'; reqFilter = ''; showAllCrashes = showAllReqs = false; }
    if (from !== undefined && !keepFocus) opener = from;
    if (from !== undefined && !keepFocus && from !== document.getElementById('tabbtn-progress')) progReturn = null;
    current = p;
    if (location.hash !== '#p=' + keyOf(p.location)) history.pushState({ sfPlace: 1, prev: location.hash }, '', '#p=' + keyOf(p.location));
    markCurrent();
    const li = document.querySelector(`#list li[data-id="${p.rank_ksi}"]`);
    // (desktop only: on a phone the list is either hidden under the details or already showing the card; scrolling it
    // there moved the search box out of reach once the details closed)
    if (li && !fly && !isNarrow()) li.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });

    const det = (D.details && D.details[p.location]) || { crashes: [], requests: [] };
    const kind = { I: 'Intersection', B: 'Stretch between intersections', A: 'Alley' }[p.addr_type] || 'Location';
    const sv = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat},${p.lon}`;
    const types = countBy(det.crashes.filter(c => c.t), c => crashType(c.t)).slice(0, 6);
    const untyped = det.crashes.filter(c => !c.t).length;
    const R = ft(weight('request_radius_m'));
    if (collapsedFor !== p.location) { collapsed = { ...DEFAULT_COLLAPSED }; collapsedFor = p.location; }
    const sec = (id, title, html) =>
      `<section class="dsec dsec-${id} ${collapsed[id] ? 'collapsed' : ''}" data-sec="${id}">
         <h3><button type="button" class="dsec-h" aria-expanded="${!collapsed[id]}" aria-controls="sec-${id}">${title}</button></h3>
         <div class="dsec-b" id="sec-${id}">${html}</div></section>`;
    const chips = reasons(p).filter(r => !(r.cls === 'conf' && p.crashes < 5));   // the note under the summary says it
    // With a district picked, the title uses the same number as the list (#2 in District 2) and gives the citywide rank too.
    const dSel = document.getElementById('distFilter'), tSel2 = document.getElementById('addrFilter');
    const inDist = p.dr && ((dSel && dSel.value) || (tSel2 && tSel2.value));
    const listName = [tSel2 && tSel2.value ? (tSel2.value === 'I' ? 'of intersections' : 'of stretches') : '',
      dSel && dSel.value ? 'in ' + dSel.selectedOptions[0].text : ''].filter(Boolean).join(' ');
    docTitle(p.name);
    document.getElementById('detailTitle').innerHTML = inDist
      ? `<span class="drank" title="${esc(`#${p.dr} ${listName}`)}">#${fmt(p.dr)}</span> ${esc(p.name)}` +
        `<small class="dcity">${esc(listName)} · ${mode === 'risk' && p.rank != null ? '#' + fmt(p.rank) : rankTxt(p.rank_ksi)} citywide</small>`
      : `<span class="drank" title="${esc(mode === 'risk' && p.rank != null ? 'Rank once you account for how busy it is' : rankTxt(p.rank_ksi))}">${mode === 'risk' && p.rank != null ? '#' + fmt(p.rank) : rankTxt(p.rank_ksi, false)}</span> ${esc(p.name)}`;
    document.getElementById('detailBody').innerHTML = `
      <div class="dhead">
        ${p.neighborhood ? `<div class="where">${esc(p.neighborhood)}${p.area && p.area !== p.neighborhood ? ` <span class="muted">· ${esc(p.area)}</span>` : ''}</div>` : ''}
        <div class="note">${kind} · <a href="${sv}" target="_blank" rel="noopener">Street View ↗</a> ·
          <button type="button" class="linkbtn" id="copyLink">${canShare() ? 'Share' : 'Copy link'}</button> · ${copyLoc(p.name)}</div>
        ${verdict(p)}
        ${p.crashes < 5 ? `<p class="note few">With only ${plural(p.crashes, 'crash', 'crashes')} here, this is a record of what happened,
          too few to show a pattern.</p>` : ''}
        <div class="stat-grid">
          <div class="stat"><b>${p.crashes}</b><span>crashes</span></div>
          <div class="stat"><b>${(p.killed ?? 0) + (p.seriously_injured ?? 0)}</b><span>people killed or seriously hurt</span></div>
          <div class="stat"><b>${p.pb_crashes ?? p.ped_crashes + p.bike_crashes}</b><span>with people walking or biking</span></div>
          <div class="stat"><b>${p.requests}</b><span>repair requests nearby</span></div>
        </div>
        ${p.ksi > (p.killed ?? 0) + (p.seriously_injured ?? 0) ? `<p class="note">SDOT's data codes ${plural(p.ksi, 'crash', 'crashes')} here as fatal
          or serious but lists ${(p.killed ?? 0) + (p.seriously_injured ?? 0) || 'no'} ${(p.killed ?? 0) + (p.seriously_injured ?? 0) === 1 ? 'person' : 'people'} killed or seriously hurt in them: some police reports give
          the severity without counting the people. Each such crash had at least one person killed or seriously hurt.</p>` : ''}
        ${whyRank(p)}
        <div class="chips dchips">${chips.map(r => `<span class="chip ${r.cls}">${esc(r.text)}</span>`).join('')}</div>
        ${reportBox(p.name)}
        ${civicBox(p.council_district ? { d: p.council_district, member: p.council_member, url: p.council_url, d2: p.council_district2 } : councilAt(p.lat, p.lon),
                   { q: p.rse_quintile, y: p.rse_year })}
      </div>
      <div id="graphs" class="graphs"></div>
      <div class="dcols">
        <div class="dcol">
          ${sec('done', 'What SDOT has done or plans here', treatments(p))}
          ${sec('street', 'The street', streetInfo(p))}
          ${sec('traffic', 'Traffic here', trafficHere(p))}
          ${sidewalksHere(p) ? sec('walk', 'Sidewalks here', sidewalksHere(p)) : ''}
          ${sec('types', 'What kind of crashes', `
            ${hbars(types, '#2a78d6', 'crashes')}
            ${fileNote(det, p)}
            ${untyped ? `<div class="note">${untyped} crash${untyped > 1 ? 'es have' : ' has'} no type recorded.</div>` : ''}
            <ul class="tight">
              <li>Wet/icy road: ${p.wet_crashes} of ${p.road_known} with known conditions (${pct(p.wet_crashes, p.road_known)}%; city ${Math.round(100 * meta.city_wet_share)}%)</li>
              <li>Dark: ${p.dark_crashes} of ${p.light_known} (${pct(p.dark_crashes, p.light_known)}%; city ${Math.round(100 * meta.city_dark_share)}%) · streetlights off/none: ${p.unlit_crashes}</li>
            </ul>`)}
          ${sec('reqtypes', `Repair requests within ${R} ft`, `
            <div class="legend"><span><i class="sq" style="background:${REQ_COLOR}"></i>Request location (on map)</span>
              <span><i class="ring"></i>Dashed circle: ${R} ft search area</span></div>
            ${hbars(countBy(det.requests, r => r.t), REQ_COLOR, 'requests') || '<div class="note">None in Find It Fix It data.</div>'}`)}
        </div>
        <div class="dcol">
          ${sec('crashes', 'Every crash', `
            <div class="legend">${['F', 'S', 'I', 'P'].map(k => `<span><i style="background:${SEV[k].color}"></i>${SEV[k].label}</span>`).join('')}</div>
            <div id="crashTable">${crashTable(det.crashes)}</div>`)}
          ${sec('reqs', 'Every repair request', `<div id="reqTable">${reqTable(det.requests)}</div>`)}
          ${sec('math', 'How this score is calculated', mathBox(p))}
        </div>
      </div>`;
    const wasHidden = detailEl.hidden;
    detailEl.hidden = false; detailEl.classList.remove('home', 'place');
    phoneDetailShown(wasHidden);
    applyLayout();
    if (fly) flyVisible([p.lat, p.lon], 17);
    drawFocus(p, det);
    renderGraphs = () => {
      const g = document.getElementById('graphs'); if (!g || g.hidden) return;
      const w = g.clientWidth; if (Math.abs(w - (g._w || 0)) < 8 && g.innerHTML) return; g._w = w;
      g.innerHTML = '<div class="gcol"><h3 class="gh">Crashes and repair reports over time</h3>' + timeChart(det, p, Math.min(w - 34, 760)) + '</div>' +
        '<div class="gcol"><h3 class="gh">Crashes by year</h3>' + yearChart(det.crashes) + '</div>' +
        '<div class="gcol"><h3 class="gh">Time of day</h3>' + todChart(det.crashes) + fileNote(det, p) + '</div>' +
        (p.rank_years ? '<div class="gcol"><h3 class="gh">Rank over the years</h3>' + rankHistory(p) + '</div>' : '');
    };
    renderGraphs();
    if (!keepFocus) { document.getElementById('detailBody').scrollTop = 0; document.getElementById('detailTitle').focus({ preventScroll: true }); }

    const body = document.getElementById('detailBody');
    body.onclick = e => {
      const h = e.target.closest('.dsec-h');
      if (h) {
        const s = h.closest('.dsec'), id = s.dataset.sec;
        collapsed[id] = !collapsed[id];
        s.classList.toggle('collapsed', collapsed[id]); h.setAttribute('aria-expanded', String(!collapsed[id]));
        return;
      }
      // "How it's calculated": open that section and bring it into view
      if (e.target.closest('.why-more')) {
        e.preventDefault();
        const s = body.querySelector('.dsec-math'), h = s && s.querySelector('.dsec-h'); if (!s) return;
        collapsed.math = false; s.classList.remove('collapsed'); h.setAttribute('aria-expanded', 'true');
        s.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); h.focus({ preventScroll: true });
        return;
      }
      const tb = e.target.closest('[data-traffic]');
      if (tb) {
        const st = T.stretches.find(x => x.id === +tb.dataset.traffic); if (!st) return;
        showTab(document.getElementById('tabbtn-traffic')); tmodeEl.value = 'bus'; renderTraffic(); selectTraffic(st);
        return;
      }
      if (e.target.id === 'copyLink') {
        const url = location.href;
        if (canShare()) {
          const h = document.getElementById('detailTitle').cloneNode(true); h.querySelectorAll('.dcity, .drank').forEach(x => x.remove());
          const v = document.querySelector('#detailBody .verdict');
          navigator.share({ title: h.textContent.trim() + ' · Streets First', text: v ? v.textContent.replace(/\s+/g, ' ').trim().slice(0, 240) : '', url }).catch(() => {});
          return;
        }
        const done = () => { e.target.textContent = 'Link copied'; announce('Link copied'); setTimeout(() => (e.target.textContent = 'Copy link'), 1800); };
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('Copy this link:', url));
        else prompt('Copy this link:', url);
        return;
      }
      // (the tables are rebuilt, so focus goes back to the same control, and the result is announced)
      const refocus = sel => { const n = body.querySelector(sel); if (n) n.focus(); };
      const cf = e.target.closest('[data-cf]');
      if (cf) { crashFilter = cf.dataset.cf; showAllCrashes = false; document.getElementById('crashTable').innerHTML = crashTable(det.crashes);
        refocus(`[data-cf="${crashFilter}"]`); announce(`${body.querySelectorAll('#crashTable tbody tr').length} crashes shown`); return; }
      const more = e.target.closest('[data-more]');
      if (more && more.dataset.more === 'crashes') { showAllCrashes = !showAllCrashes; document.getElementById('crashTable').innerHTML = crashTable(det.crashes);
        refocus('[data-more="crashes"]'); announce(`${body.querySelectorAll('#crashTable tbody tr').length} crashes shown`); return; }
      if (more && more.dataset.more === 'reqs') { showAllReqs = !showAllReqs; document.getElementById('reqTable').innerHTML = reqTable(det.requests);
        refocus('[data-more="reqs"]'); return; }
    };
    body.onchange = e => {
      if (e.target.id === 'reqType') { reqFilter = e.target.value; showAllReqs = false;
        document.getElementById('reqTable').innerHTML = reqTable(det.requests); drawFocus(p, det); const s = body.querySelector('#reqType'); if (s) s.focus(); }
    };
  }

  // ---------- every other place: full details from its map area's file (data/more/<cell>.js), loaded on first use ----------
  // Script tags rather than fetch, so the site also works opened straight from disk.
  const moreCache = new Map(), moreWait = new Map(), moreTries = new Map();
  // Each area file says which build it belongs to. One from a newer build (the site was updated while this page was open)
  // could describe places differently, so it isn't used; the page asks for a reload instead.
  let staleShown = false;
  const staleCells = new Set();   // areas whose file came from a newer build: the place asks for a reload, not a retry
  window.SITE_MORE = (o, v) => {
    if (v && D.version && v !== D.version) {
      staleCells.add(o.cell);
      if (!staleShown) { staleShown = true; toast('The data was just updated. Reload the page to see the newest version.'); }
      return;
    }
    moreCache.set(o.cell, o.data);
  };
  function loadCell(cell) {
    if (moreCache.has(cell)) return Promise.resolve(moreCache.get(cell));
    if (!moreWait.has(cell)) moreWait.set(cell, new Promise((res, rej) => {
      const sc = document.createElement('script');
      // the fingerprint, so a new build is fetched fresh; after a failed try, a try number too, so the browser doesn't wait
      // behind the earlier request that hung
      const n = moreTries.get(cell) || 0;
      sc.src = `data/more/${cell}.js?v=${D.version || ''}${n ? '&try=' + n : ''}`;
      // A request that hangs (a weak signal) gives up after 15 s, so opening the place again starts a fresh one.
      const done = () => { clearTimeout(t); moreWait.delete(cell); sc.remove(); };
      const t = setTimeout(() => { done(); moreTries.set(cell, n + 1); rej(new Error('timeout')); }, 15000);
      sc.onload = () => { done(); moreCache.has(cell) ? res(moreCache.get(cell)) : rej(new Error(staleCells.has(cell) ? 'stale' : 'empty')); };
      sc.onerror = () => { done(); moreTries.set(cell, n + 1); rej(new Error('failed')); };
      document.head.appendChild(sc);
    }));
    return moreWait.get(cell);
  }
  const zipObj = (keys, vals) => Object.fromEntries(keys.map((k, j) => [k, vals[j]]));
  async function fullSpot(s) {
    const have = byId.get(s.rank); if (have) return have;
    if (!s.cell) return null;
    const d = await loadCell(s.cell);
    const lc = d.c.indexOf('location'), i = d.r.findIndex(r => r[lc] === s.name);   // by name: ranks can change between builds
    if (i < 0) return null;
    const p = zipObj(d.c, d.r[i]);
    p.rank_ksi = p.rank; p.name = niceName(p.location); p.more = true;
    p.rank = { ksi: p.rank_ksi, risk: p.rank_risk }[mode] ?? null;
    p.score = { ksi: p.score_ksi, risk: p.score_risk }[mode] ?? null;
    ingestCell(d);
    byId.set(p.rank_ksi, p);
    return p;
  }
  // Unpack an area file's crash lists and requests (once), keyed by place.
  function ingestCell(d) {
    if (d.done) return;
    d.done = true;
    const li = d.c.indexOf('location');
    d.r.forEach((row, i) => {
      if (D.details[row[li]]) return;
      D.details[row[li]] = {
        crashes: d.k[i].map(a => zipObj(d.kc, a)),
        requests: d.l[i].map(([qi, m]) => ({ ...zipObj(d.qc, d.q[qi]), m }))
      };
    });
  }
  // Places outside the ranked lists: show the short summary right away, then the full panel once its area's file loads.
  let liteToken = 0;
  function selectLite(s) {
    const tok = ++liteToken, from = opener;
    const cached = byId.get(s.rank) || (s.cell && moreCache.has(s.cell));
    if (!cached) selectBrief(s, 'loading');
    fullSpot(s).then(p => {
      if (tok !== liteToken) return;
      if (!cached && (!current || current.rank_ksi !== s.rank)) return;   // something else was picked while loading
      if (p) select(p, !!cached, from); else selectBrief(s, 'failed');   // the summary already moved the map
    }, () => { if (tok === liteToken && current && current.rank_ksi === s.rank) selectBrief(s, 'failed'); });
  }
  // A short summary from the search index: while the full details load, or if they can't be loaded.
  function selectBrief(s, state, noFly) {
    rememberView();
    current = { rank_ksi: s.rank, rank: null, lat: s.lat, lon: s.lon };
    if (!opener) opener = document.getElementById('search');
    if (location.hash !== '#p=' + keyOf(s.name)) history.pushState({ sfPlace: 1, prev: location.hash }, '', '#p=' + keyOf(s.name));
    markCurrent();
    document.getElementById('detailTitle').innerHTML = `<span class="drank" title="${esc(rankTxt(s.rank))}">${rankTxt(s.rank, false)}</span> ${esc(niceName(s.name))}`;
    docTitle(niceName(s.name));
    document.getElementById('detailBody').innerHTML = `
      <div class="dhead">
        ${s.hood ? `<div class="where">${esc(s.hood)}${s.area && s.area !== s.hood ? ` <span class="muted">· ${esc(s.area)}</span>` : ''}</div>` : ''}
        <div class="note">${{ I: 'Intersection', B: 'Stretch between intersections', A: 'Alley' }[s.type] || 'Location'} ·
          <a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${s.lat},${s.lon}" target="_blank" rel="noopener">Street View ↗</a> · ${copyLoc(niceName(s.name))}</div>
        ${reportBox(niceName(s.name))}
        <p class="verdict">${plural(s.crashes, 'crash', 'crashes')} from ${monthYear(meta.window_from)} to ${monthYear(meta.window_to)}${s.ksi ? `; ${s.ksi} killed or seriously injured someone` : ''}${s.pb ? `; ${s.pb} involved people walking or biking` : ''}.</p>
        <p class="verdict2">Ranks <b>#${fmt(s.rank)}</b> of ${fmt(kindCount(s.rank))} places with crashes (${topShare(s.rank)}).</p>
        <p class="note">${state !== 'failed' ? 'Loading the full crash and request details…'
          : staleCells.has(s.cell) ? 'This site was just updated, so this place’s details come from a newer version. <button type="button" class="linkbtn brief-reload">Reload the page</button>'
          : 'The full crash and request details for this place couldn’t be loaded. Check your connection. <button type="button" class="linkbtn brief-retry">Try again</button>'}</p>
      </div>`;
    { const b = document.querySelector('#detailBody .brief-retry'); if (b) b.onclick = () => selectLite(s); }
    { const b = document.querySelector('#detailBody .brief-reload'); if (b) b.onclick = () => location.reload(); }
    const wasHidden = detailEl.hidden;
    detailEl.hidden = false; detailEl.classList.remove('home', 'place'); phoneDetailShown(wasHidden); applyLayout();
    if (!noFly) flyVisible([s.lat, s.lon], 17);
    focus.clearLayers();
    L.circleMarker([s.lat, s.lon], { radius: 9, color: '#1d2430', weight: 3, fillColor: '#fff', fillOpacity: 0.9, interactive: false }).addTo(focus);
    Object.values(markers).forEach(m => dim(m, true));
    document.getElementById('detailTitle').focus({ preventScroll: true });
  }

  const BASE_TITLE = document.title;
  let placeTitle = '';
  const docTitle = t => { if (t) placeTitle = t; const sh = openSheet(), suf = ' · Streets First Seattle';
    document.title = t ? t + suf : sh ? sh.querySelector('h2').textContent.trim() + suf : spotOpen() && placeTitle ? placeTitle + suf : BASE_TITLE; };
  let skipHash = false;   // the next hashchange is our own history.back(): nothing to do
  function closeDetail(restoreFocus) {
    mainEl.classList.remove('split'); clearFocus();
    const wasLine = tSel; tSel = null;
    if (isNarrow()) { detailEl.hidden = true; detailEl.classList.remove('home', 'place'); applyLayout(); phoneDetailHidden(); }
    else if (placeG) showPlace(placeG, true); else renderHome();
    tSel = wasLine;
    const right = isNarrow() ? 30 : detailEl.offsetWidth + 30;
    if (viewBefore) { if (reduceMotion) map.setView(viewBefore.c, viewBefore.z, { animate: false }); else map.flyTo(viewBefore.c, viewBefore.z, { duration: 0.6 }); }
    else { const g = trafficOn ? tLayer : layer; if (g.getLayers().length) (reduceMotion ? map.fitBounds : map.flyToBounds).call(map, g.getBounds(), { paddingTopLeft: [leftPad() + 30, 30], paddingBottomRight: [right, isNarrow() ? cover + 20 : 30], maxZoom: 15 }); }
    viewBefore = null;
    if (tSel) { tSel = null; tLines.forEach(line => line.setStyle(lineStyle(line._t, false)));
      document.querySelectorAll('.tlist li.selected').forEach(li => { li.classList.remove('selected'); const b = li.querySelector('button'); if (b) b.removeAttribute('aria-current'); }); }
    // undo the entry this place added (when returning to "Is it getting fixed?", the hashchange that follows is ignored,
    // or it would close the sheet again)
    if (location.hash && history.state && history.state.sfPlace && !history.state.prev) { if (restoreFocus && progReturn) skipHash = true; history.back(); }
    else history.replaceState(null, '', location.pathname + location.search);
    liteToken++; docTitle(null);
    if (restoreFocus && progReturn) { const n = progReturn; progReturn = null; opener = null; homeFocus = null; returnToProgress(n); return; }
    const hc = homeFocus != null && document.querySelector(`#detailBody [data-home="${homeFocus}"]`); homeFocus = null;
    // Focus goes back without scrolling: on a phone, scrolling the list to the card hid the search box (and on some
    // phones scrolled the whole map area, leaving a blank strip).
    if (restoreFocus && opener && document.contains(opener)) opener.focus({ preventScroll: true });
    else if (restoreFocus && hc) hc.focus({ preventScroll: true });
    else if (restoreFocus) document.getElementById('list').querySelector('button')?.focus({ preventScroll: true });
    opener = null;
  }
  document.getElementById('closeDetail').onclick = () => closeDetail(true);
  // picking a district (or going back to all of Seattle) frames its places
  document.getElementById('distFilter').addEventListener('change', () => setTimeout(showAll, 0));
  // The district picked goes in the address (?d=2), so a link to the list, or to a place opened from it, keeps it.
  const distToUrl = () => {
    const d = document.getElementById('distFilter').value, u = new URLSearchParams(location.search);
    if (d) u.set('d', d); else u.delete('d');
    const qs = u.toString();
    history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  };
  document.getElementById('distFilter').addEventListener('change', distToUrl);
  ['topN', 'addrFilter', 'distFilter', 'onlyOngoing', 'noPlan'].forEach(id => (document.getElementById(id).onchange = () => {
    render(); refreshHome();
    if (spotOpen() && current && current.location) select(current, false, null, true);   // its number in the list may have changed
  }));

  function weight(k) { const w = meta.weights.find(x => x.k === k); return w ? w.v : '?'; }

  // ---------- search: every scored location ----------
  let searchIdx = [], stKnown = null;   // stKnown: every street name in the list, built on first use
  const toSearchRow = r => ({ name: r[0], lat: +r[1], lon: +r[2], rank: +r[3], crashes: +r[4], ksi: +r[5], pb: +r[6], type: r[7], hood: r[8] || '', area: r[9] || '', cell: r[10] || '', ends: r[11] ? r[11].split(',').map(Number) : null });
  // A short, stable key for a place's name (two 32-bit FNV-1a hashes), for links that survive rank changes.
  function keyOf(name) {
    let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < name.length; i++) { const c = name.charCodeAt(i); a = Math.imul(a ^ c, 16777619) >>> 0; b = Math.imul(b ^ c, 2246822519) >>> 0; }
    return a.toString(36) + b.toString(36).slice(0, 4);
  }
  let keyMap = null;
  const keyIdx = () => keyMap || (keyMap = new Map(searchIdx.map(s => [keyOf(s.name), s])));
  const normQ = t => t.toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ');
  // Search keys for 11,887 places take a moment to build, so they're made in small batches after the page is up (or all at
  // once on the first search, whichever comes first) instead of holding up the first screen.
  let keysAt = 0;
  const keyBatch = n => { for (const end = Math.min(searchIdx.length, keysAt + n); keysAt < end; keysAt++) {
    const s = searchIdx[keysAt]; s.nkey = ' ' + normQ(niceName(s.name)) + ' '; s.key = s.nkey + ' ' + normQ(s.hood + ' ' + s.area); } };
  const ensureKeys = () => keyBatch(Infinity);
  function idleKeys() { if (keysAt >= searchIdx.length) return; keyBatch(800);
    (window.requestIdleCallback || (f => setTimeout(f, 30)))(idleKeys); }
  const setSearch = rows => { searchIdx = (rows || []).map(toSearchRow); keyMap = null; stKnown = null; keysAt = 0; idleKeys(); };
  const sInput = document.getElementById('search'), sList = document.getElementById('searchResults');
  let sHits = [], sActive = -1;
  const sStatus = document.getElementById('searchStatus');
  const say = t => announce(t);
  const closeList = () => { sList.hidden = true; sInput.setAttribute('aria-expanded', 'false'); sInput.removeAttribute('aria-activedescendant'); };
  // ---------- address suggestions while typing ("1913n 120th st" -> 1913 N 120th St) ----------
  // From King County's address points (fetched weekly with the rest of the data): the street list comes with data-late.js,
  // each street's house numbers in a small file (data/addr/<n>.js) loaded the first time someone types that street.
  // Nothing typed leaves the page for this; only "Find this address" asks Esri's service.
  let addrStreets = [];                         // [{ name, toks, shard, zip }]
  const addrShards = new Map(), addrWait = new Map();
  window.SITE_ADDR = (o, tag) => {
    if (tag !== D.version) { const w = addrWait.get(o.s); addrWait.delete(o.s); if (w) w.rej(new Error('stale')); return; }
    const m = new Map(o.streets.map(x => [x.s, x.a])); addrShards.set(o.s, m);
    const w = addrWait.get(o.s); addrWait.delete(o.s); if (w) w.res(m);
  };
  const loadAddr = s => addrShards.has(s) ? Promise.resolve(addrShards.get(s)) : (addrWait.get(s) || {}).p || (() => {
    const w = {}; w.p = new Promise((res, rej) => { w.res = res; w.rej = rej; }); addrWait.set(s, w);
    const sc = document.createElement('script');
    sc.src = `data/addr/${s}.js?v=${D.version || ''}`;
    const done = () => sc.remove();
    sc.onload = done; sc.onerror = () => { done(); addrWait.delete(s); w.rej(new Error('failed')); };
    document.head.appendChild(sc);
    return w.p;
  })();
  const ADDR_WORD = { avenue: 'ave', av: 'ave', street: 'st', boulevard: 'blvd', place: 'pl', drive: 'dr', road: 'rd', court: 'ct',
    lane: 'ln', terrace: 'ter', parkway: 'pkwy', north: 'n', south: 's', east: 'e', west: 'w', northeast: 'ne', northwest: 'nw',
    southeast: 'se', southwest: 'sw', mlk: 'martin luther king jr', 'm.l.k.': 'martin luther king jr' };
  // "1913n 120th st seattle wa 98133" -> { num: '1913', words: ['n', '120th', 'st'], zip: '98133' }; null if it doesn't start with a number
  function parseAddr(text) {
    const m = text.toLowerCase().replace(/[,#.]/g, ' ').match(/^\s*(\d+)[a-z]?(?:(ne|nw|se|sw|[nsew])(?=\s))?\s+(.+)$/);
    if (!m) return null;
    const zip = (m[3].match(/\b(98\d{3})\b/) || [])[1] || null;
    const words = ((m[2] ? m[2] + ' ' : '') + m[3]).split(/\s+/).filter(Boolean).map(w => ADDR_WORD[w] || w).join(' ').split(' ')
      .filter(w => !/^(seattle|wa|washington|usa|us|98\d{3})$/.test(w));
    return words.length ? { num: m[1], words, zip } : null;
  }
  // Streets whose words start with what was typed (all of it), best first: more exact words, then the typed ZIP.
  function addrStreetHits(words, zip) {
    const out = [];
    for (const s of addrStreets) {
      let exact = 0;
      if (!words.every(w => s.toks.some(t => t === w ? (exact++, true) : t.startsWith(w)))) continue;
      out.push({ s, sc: exact * 10 + (zip && s.zip === zip ? 5 : 0) - s.toks.length });
    }
    return out.sort((a, b) => b.sc - a.sc).slice(0, 6).map(x => x.s);
  }
  // Suggestions for the typed text from the files already here; asks for the missing ones and searches again when they arrive.
  function addrSuggest(text) {
    const q = parseAddr(text); if (!q || !addrStreets.length) return [];
    const streets = addrStreetHits(q.words, q.zip), out = [], missing = [];
    for (const s of streets) {
      const m = addrShards.get(s.shard); if (!m) { missing.push(s.shard); continue; }
      const a = m.get(s.id) || [], pt = i => ({ addrPick: true, label: `${a[i]} ${s.name}`, zip: s.zip, lat: 47 + a[i + 1] / 1e5, lon: -122 + a[i + 2] / 1e5 });
      let any = false, best = -1;
      for (let i = 0; i < a.length; i += 3) {
        const n = String(a[i]);
        if (n.startsWith(q.num)) { out.push({ ...pt(i), exact: n === q.num ? 2 : 1 }); any = true; }
        else if (best < 0 || Math.abs(a[i] - +q.num) < Math.abs(a[best] - +q.num)) best = i;
      }
      // The number isn't in the county's list (4500 Rainier Ave S isn't): the nearest listed number on that street, if close.
      if (!any && best >= 0 && q.num.length >= 3 && Math.abs(a[best] - +q.num) <= 100) out.push({ ...pt(best), exact: 0, near: true });
    }
    if (missing.length) Promise.all([...new Set(missing)].map(loadAddr)).then(() => {
      if (document.activeElement === sInput && sInput.value === text) runSearch();
    }, () => {});
    const found = out.some(x => !x.near);   // nearest-number guesses only when no street has the number
    return out.filter(x => !found || !x.near).sort((a, b) => b.exact - a.exact || a.label.length - b.label.length).slice(0, 5);
  }
  const setAddrStreets = rows => { addrStreets = (rows || []).map(([name, shard, zip], id) => ({ id, name, toks: name.toLowerCase().split(' '), shard: +shard, zip })); };

  // Public schools, searchable by name ("Rainier Beach High"): picking one pins it like an address, with crashes nearby.
  const schoolLabel = (n, t) => { n = n.replace(/\s+-\s+interim$/i, '').trim();
    if (/\b(elementary|middle|high|school|k-8|academy)$/i.test(n)) return n;
    if (/k-8/i.test(n)) return n;
    return n + ({ 'Elementary': ' Elementary', 'Option Elementary': ' Elementary',
    'Middle School': ' Middle School', 'High School': ' High School', 'Option High School': ' High School', 'K-8': ' K-8' }[t] || ' School'); };
  let schoolIdx = null;
  const schools = () => schoolIdx || (schoolIdx = (CTX.schools || []).filter(s => s[0]).map(([n, la, lo, t]) => {
    const label = schoolLabel(n === n.toUpperCase() ? schoolName(n) : n, t) + (/\s+-\s+interim$/i.test(n) ? ' (interim site)' : '');   // a few names come in capitals only
    // "eaglestaff", "bf day": also matched with spaces and punctuation left out
    return { school: true, label, lat: +la, lon: +lo, key: ' ' + normQ(label + ' school') + ' ', compact: label.toLowerCase().replace(/[^a-z0-9]/g, '') };
  }));
  function runSearch() {
    if (!lateOK) {
      if (!sInput.value.trim()) { sList.hidden = true; return; }
      sHits = [];
      return lateReady.then(L => (L.failed ? searchMsg('Search couldn’t load. Reload the page to try again.') : null)),
        searchMsg('Search is still loading…');
    }
    ensureKeys();
    // "12th and Jackson", "45th & Roosevelt", "MLK at Othello": the joining word isn't part of either street's name, and
    // a corner typed that way puts intersections first. Common spellings match SDOT's (MLK = M L King, Avenue = Ave).
    const raw = sInput.value.toLowerCase().trim();
    const corner = /(^|\s)(and|at)(\s|$)|[&@\/]/.test(raw);
    const q = normQ(raw).replace(/\b(mlk|martin luther king)\b/g, 'm l king').replace(/\bavenue\b/g, 'ave')
      .replace(/\bstreet\b/g, 'st').replace(/\bboulevard\b/g, 'blvd').replace(/\bplace\b/g, 'pl')
      .replace(/(^|\s)(and|at)(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
    if (q.length < 2) { sList.hidden = true; sInput.setAttribute('aria-expanded', 'false'); return; }
    const words = q.split(' ');
    // Index is in rank order. Places whose street names hold every word come before neighborhood-only matches.
    const all = searchIdx.filter(s => words.every(w => s.key.includes(w)));
    const inName = s => words.every(w => s.nkey.includes(' ' + w));
    const named = all.filter(inName), first = corner ? named.filter(s => s.type === 'I') : [];
    // Schools: first when the words say school, otherwise after places named for a street (before neighborhood-only matches).
    const qc = raw.replace(/[^a-z0-9]/g, '').replace(/(elementary|middle|high|school)+$/, '');
    const sch = corner ? [] : schools().filter(s => words.every(w => s.key.includes(' ' + w)) || (qc.length >= 4 && s.compact.includes(qc))).slice(0, 3);
    const schFirst = /\b(school|elementary|middle|high|k-?8)\b/.test(raw);
    sHits = (schFirst ? sch : []).concat(first, named.filter(s => !first.includes(s)), schFirst ? [] : sch, all.filter(s => !inName(s))).slice(0, 8);
    const nPlaces = sHits.filter(s => !s.school && !s.addrPick && !s.addr).length, nSchools = sHits.filter(s => s.school).length;
    // Text can also be pinned as an address: offered when it has a number in it or matches no scored place.
    const addr = { addr: true, text: sInput.value.trim() };
    // Addresses from the county's list go first; "Find this address" (Esri) stays as the fallback at the end.
    const sugg = corner ? [] : addrSuggest(sInput.value);
    if (sugg.length) { sHits = sugg.concat(sHits).slice(0, 8); sHits.push(addr); }
    // A house number ("4500 Rainier Ave S") puts the address first; "12th and Jackson" is a corner, not an address.
    // (also "1913n 120th st", a direction typed against the number)
    if (sugg.length) { /* already placed */ } else if (/^\d+(?:ne|nw|se|sw|[nsew])?\s/i.test(addr.text) && !corner) sHits.unshift(addr); else if (/\d/.test(addr.text) || !nPlaces) sHits.push(addr);
    sActive = -1; sInput.removeAttribute('aria-activedescendant');
    const nSugg = sugg.length;
    say(nPlaces || nSchools || nSugg ? [nSugg && plural(nSugg, 'address', 'addresses'), nPlaces && `${nPlaces === 8 ? '8 or more' : nPlaces} matching places`, nSchools && plural(nSchools, 'school')].filter(Boolean).join(', ')
      : 'No matching crash location. You can pin it as an address.');
    sList.innerHTML = sHits.map((s, i) => s.addrPick
      ? `<li role="option" id="sr-${i}" data-i="${i}" class="addr-pick"><span>📍 ${esc(s.label)}</span><small>Seattle ${esc(s.zip || '')} · ${s.near ? 'nearest listed address' : 'address'}</small></li>`
      : s.school
      ? `<li role="option" id="sr-${i}" data-i="${i}" class="school-opt"><span>🏫 ${esc(s.label)}</span><small>Public school · crashes within a quarter mile</small></li>`
      : s.addr
      ? `<li role="option" id="sr-${i}" data-i="${i}" class="addr-opt"><span>📍 Find this address on the map: <b>${esc(s.text)}</b><small class="pin-privacy">Looked up with Esri’s address search (or OpenStreetMap’s, if Esri can’t find it). You can then add it to your pins, which are saved only on this device.</small></span></li>`
      : `<li role="option" id="sr-${i}" data-i="${i}">
        <span>${esc(niceName(s.name))}${s.area ? `<small class="hood">${esc(s.area)}</small>` : ''}</span><small>${rankTxt(s.rank)} · ${plural(s.crashes, 'crash', 'crashes')}</small></li>`).join('') +
      (!nPlaces && !nSchools && !nSugg ? `<li class="none">No crash location with that name.${sHits.some(x => x.addr) ? ' Use the address option above to see crashes nearby.' : ' Only places with a reported crash are scored.'}</li>` : '');
    sList.hidden = false; sInput.setAttribute('aria-expanded', 'true');
  }
  function pick(i) {
    const s = sHits[i]; if (!s) return;
    if (s.addr) { closeList(); pinAddress(s.text); return; }
    if (s.addrPick) { closeList(); sInput.value = s.label; showAddress({ lat: s.lat, lon: s.lon, label: `${s.label}, Seattle, WA ${s.zip || ''}`.trim() }); return; }
    if (s.school) { closeList(); sInput.value = s.label; lateReady.then(() => showAddress({ lat: s.lat, lon: s.lon, label: s.label, school: true })); return; }
    closeList(); sInput.value = niceName(s.name);
    const p = byId.get(s.rank);
    if (p) select(p, true, sInput); else selectLite(s);
  }
  sInput.addEventListener('input', runSearch);
  // typed while the page was still loading: search it now that it's ready (only if the box still has focus)
  if (sInput.value.trim() && document.activeElement === sInput) runSearch();
  sInput.addEventListener('keydown', e => {
    if (sList.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sActive = Math.max(0, Math.min(sHits.length - 1, sActive + (e.key === 'ArrowDown' ? 1 : -1)));
      sList.querySelectorAll('li').forEach((li, i) => { li.classList.toggle('active', i === sActive); li.setAttribute('aria-selected', i === sActive); });
      sInput.setAttribute('aria-activedescendant', 'sr-' + sActive);
    } else if (e.key === 'Escape') closeList();
  });
  // Enter, and a phone keyboard's Search/Go key, submit the form (phone keyboards often send no plain Enter key mid-word).
  document.getElementById('searchForm').addEventListener('submit', e => {
    e.preventDefault();
    if (!sInput.value.trim()) return;
    if (sList.hidden || !sHits.length) runSearch();
    if (sHits.length) pick(sActive < 0 ? 0 : sActive);
  });
  // On a phone, bring the search box to the top of the sheet so the results show above the keyboard.
  sInput.addEventListener('focus', () => {
    if (!isNarrow()) return;
    const body = document.getElementById('panelBody'), box = sInput.closest('.searchbox');
    requestAnimationFrame(() => { body.scrollTop += box.getBoundingClientRect().top - body.getBoundingClientRect().top - 8; });
  });
  sList.addEventListener('mousedown', e => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); pick(+li.dataset.i); } });
  sInput.addEventListener('blur', () => setTimeout(closeList, 150));

  // ---------- address pin: a personal reference point (home, work, a kid's school) ----------
  // The typed address goes to Esri's geocoder (OpenStreetMap's if Esri fails) only when someone asks to pin it.
  const SEA = { w: -122.46, s: 47.48, e: -122.22, n: 47.74 };
  const inSeattle = (lat, lon) => lat > SEA.s && lat < SEA.n && lon > SEA.w && lon < SEA.e;
  map.createPane('pin'); map.getPane('pin').style.zIndex = 660;
  const pinLayer = L.layerGroup().addTo(map);
  // Each lookup gives up after 8 s. If both lookups fail to connect, the answer is { offline: true }, not "not found".
  const timed = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(8000) } : {});
  async function geocode(text) {
    const q = encodeURIComponent(/seattle/i.test(text) ? text : text + ', Seattle, WA');
    let failed = 0;
    try {
      const r = await fetch('https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates' +
        `?SingleLine=${q}&f=json&maxLocations=1&searchExtent=${SEA.w},${SEA.s},${SEA.e},${SEA.n}`, timed()).then(x => x.json());
      const c = r.candidates && r.candidates[0];
      if (c && c.score >= 80) return { lat: c.location.y, lon: c.location.x, label: c.address };
    } catch { failed++; }
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=jsonv2&limit=1` +
        `&viewbox=${SEA.w},${SEA.n},${SEA.e},${SEA.s}&bounded=1`, timed()).then(x => x.json());
      if (r[0]) return { lat: +r[0].lat, lon: +r[0].lon, label: r[0].display_name.split(', ').slice(0, 3).join(', ') };
    } catch { failed++; }
    return failed === 2 || navigator.onLine === false ? { offline: true } : null;
  }
  // Did the lookup keep the street that was typed? (NE 50th St and 50th Ave NE are different streets; a geocoder can swap
  // them.) Every typed street word, in one spelling, has to be in the address it found.
  const streetWords = t => t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
    .map(w => ({ avenue: 'ave', av: 'ave', street: 'st', boulevard: 'blvd', place: 'pl', drive: 'dr', road: 'rd', way: 'way',
      north: 'n', south: 's', east: 'e', west: 'w', northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw' })[w] || w)
    .filter(w => !/^(seattle|wa|washington|usa|united|states|\d{5})$/.test(w));
  const streetChanged = (typed, found) => {
    const t = streetWords(typed.replace(/\s+(#|apt\b|unit\b|ste\b|suite\b)[^,]*/i, '').replace(/^\s*\d+(?:(ne|nw|se|sw|[nsew])|[a-z])?\s+/i, (m, dir) => (dir ? dir + ' ' : ''))), f = new Set(streetWords(found));
    return /^\s*\d/.test(typed) && t.length > 0 && t.some(w => !f.has(w));
  };
  function searchMsg(html) { sList.innerHTML = `<li class="none">${html}</li>`; sList.hidden = false; sInput.setAttribute('aria-expanded', 'true'); say(sList.textContent); }
  let geoToken = 0;
  async function pinAddress(text) {
    if (!text) return;
    const tok = ++geoToken;
    searchMsg('Finding that address…');
    const g = await geocode(text);
    if (tok !== geoToken) return;   // a newer lookup has started
    if (g && g.offline) return searchMsg('Address search needs a connection. Check your signal and try again.');
    if (!g) return searchMsg(`Couldn't find “${esc(text)}”. Try a street address like “600 4th Ave”.`);
    if (!inSeattle(g.lat, g.lon)) return searchMsg(`“${esc(g.label)}” is outside Seattle. This map covers Seattle only.`);
    await lateReady;   // the nearby counts need the search data
    if (streetChanged(text, g.label)) g.note = `You typed “${text}”. The map's address search found this instead; check it's the place you meant.`;
    closeList();
    showAddress(g);
  }
  // Nearest street address for a spot picked on the map (same Esri service as the search). Falls back to coordinates.
  async function reverseGeocode(lat, lon) {
    try {
      const r = await fetch('https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode' +
        `?location=${lon.toFixed(5)},${lat.toFixed(5)}&f=json&featureTypes=PointAddress,StreetAddress,StreetInt`).then(x => x.json());
      const a = r.address; if (a && (a.Match_addr || a.Address)) return a.Match_addr || a.Address;
    } catch { /* offline or blocked */ }
    return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }
  // Everything within a quarter mile (402 m): crash totals plus the highest-ranked places.
  function nearbySpots(lat, lon) {
    const k = Math.cos(lat * Math.PI / 180) * 111320;
    const near = searchIdx.map(x => ({ x, m: Math.hypot((x.lon - lon) * k, (x.lat - lat) * 111320) })).filter(n => n.m <= 402);
    const sum = f => near.reduce((t, n) => t + n.x[f], 0);
    return { crashes: sum('crashes'), ksi: sum('ksi'), pb: sum('pb'), places: near.length,
      worst: near.slice().sort((a, b) => a.x.rank - b.x.rank).slice(0, 4), all: near.slice().sort((a, b) => a.x.rank - b.x.rank) };
  }
  // "What about my street?": the nearest stretch and the nearest corner on the address's own street, within 800 ft.
  // The street comes from the address ("4500 Rainier Ave S, Seattle" -> Rainier Ave S); spellings are made to match
  // SDOT's ("M L KING JR WAY S", "WY"). Only for a street that has any place in the list, so a spelling that doesn't
  // match never reads as "no crashes on your street". Spots without a house number (map picks, schools) get none.
  // SDOT's split roadways (M L KING JR ER WAY S, BEACON WR AVE S) and its mid-name direction letters (S GENESEE S ST,
  // QUEEN ANNE W AVE N) are dropped, so they match the street as addressed.
  const stKey = s => streetWords(s.replace(/martin luther king/i, 'm l king')).map(w => (w === 'wy' ? 'way' : w))
    .filter((w, i, a) => !/^(er|wr|nr|sr|cr)$/.test(w) && !(i > 0 && i < a.length - 1 && /^[nsew]$/.test(w))).sort().join(' ');
  function addrStreet(label) {
    if (!label) return null;
    let parts = label.split(',').map(s => s.trim());
    if (/^\d+[a-z]?$/i.test(parts[0]) && parts[1]) parts = [parts[0] + ' ' + parts[1]];   // OpenStreetMap: "4500, Rainier Avenue South"
    const m = parts[0].match(/^\d+[a-z]?(?:-\d+)?\s+(.+)$/i);
    if (!m) return null;
    const name = m[1].replace(/\s+(#|apt\b|unit\b|ste\b|suite\b).*$/i, '').trim();
    return name ? { name, key: stKey(name) } : null;
  }
  const placeSts = x => x.sts || (x.sts = (x.name.includes(' BETWEEN ') ? [x.name.split(' BETWEEN ')[0]] : x.name.split(' AND ')).map(stKey));
  // metres from an address to a place: to the street line for a long stretch (its ends are in x.ends), else to its point
  function placeDist(x, g, k) {
    const px = (g.lon - x.lon) * k, py = (g.lat - x.lat) * 111320;
    if (!x.ends) return Math.hypot(px, py);
    const [ax, ay, bx, by] = x.ends, dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }
  function onMyStreet(g) {
    if (g.school || g.picked) return null;   // a map pick's "nearest address" can be on another street
    const st = addrStreet(g.label); if (!st) return null;
    if (!stKnown && searchIdx.length) { stKnown = new Set(); searchIdx.forEach(x => placeSts(x).forEach(k => stKnown.add(k))); }
    if (!stKnown || !stKnown.has(st.key)) return null;
    const k = Math.cos(g.lat * Math.PI / 180) * 111320;
    let block = null, corner = null, top = null;
    for (const x of searchIdx) {
      if (Math.abs(x.lat - g.lat) > 0.006 || Math.abs(x.lon - g.lon) > 0.008) continue;
      const m = placeDist(x, g, k);
      if (m > 244 || !placeSts(x).includes(st.key)) continue;
      if (!top || x.rank < top.x.rank) top = { x, m };
      if (x.type === 'I') { if (!corner || m < corner.m) corner = { x, m }; }
      else if (!block || m < block.m) block = { x, m };
    }
    const list = [block, corner].filter(Boolean);
    if (top && !list.some(n => n.x === top.x)) list.push({ ...top, worst: true });
    return { name: st.name, list };
  }
  const small = () => matchMedia('(max-width: 760px)').matches;
  const distText = m => (m < 160 ? `${Math.round(m * 3.28084 / 10) * 10} ft` : `${(m / 1609.34).toFixed(1)} mi`);
  // Several pins, each { id, lat, lon, label (the address), name? (a nickname like "Home") }. Kept only in this
  // browser (localStorage); the site sends nothing about them, though the map images for the area shown come from Esri.
  const PIN_KEY = 'ipm.pins', MAX_PINS = 20;
  const pinMarkers = new Map();
  let pendingRename = null;
  let pins = (() => {
    try { const a = JSON.parse(localStorage.getItem(PIN_KEY)); if (Array.isArray(a)) return a.filter(g => g && inSeattle(g.lat, g.lon)).map(g => ({ ...g, id: +g.id || Date.now() + Math.random() })); } catch { /* none */ }
    try { const g = JSON.parse(localStorage.getItem('ipm.pin')); if (g && inSeattle(g.lat, g.lon)) return [{ ...g, id: 1 }]; } catch { /* none */ }
    return [];
  })();
  function savePins() {
    try { localStorage.setItem(PIN_KEY, JSON.stringify(pins)); localStorage.removeItem('ipm.pin'); } catch { /* storage unavailable */ }
    renderPinList(); refreshHome();
  }
  const pinTitle = g => g.name || g.label;
  const samePin = g => pins.find(p => Math.abs(p.lat - g.lat) < 0.0002 && Math.abs(p.lon - g.lon) < 0.0002);
  function addPin(g, stay) {
    // The same spot again just opens the pin that's already there.
    const same = samePin(g);
    if (same) { openPin(same, !stay); return; }
    if (pins.length >= MAX_PINS) { toast(`You have ${MAX_PINS} pins, the most this site keeps. Remove one in “My pins” to add another.`); return; }
    const p = { id: Date.now(), lat: g.lat, lon: g.lon, label: g.label, ...(g.picked ? { picked: true } : {}) };
    pins.push(p); savePins(); drawPin(p);
    if (stay) { openPin(p, false); say(`Pin added: ${p.label}. It's in “My pins”.`); } else openPin(p, true, true);
  }
  // A searched address is shown (with its own marker) but only saved if you choose "Add to my pins".
  let previewMarker = null;
  function clearPreview() { if (previewMarker) { previewMarker.closePopup(); pinLayer.removeLayer(previewMarker); previewMarker = null; } }
  // ---------- around an address or pin: every place with crashes within a quarter mile ----------
  // On the map: a dashed quarter-mile circle and a small grey dot for each place with crashes that isn't already drawn
  // (only the ranked list is drawn by default). On desktop the right panel shows the summary. Cleared when the pop-up closes.
  const nearLayer = L.layerGroup().addTo(map);
  let placeG = null;
  const openNear = x => {
    if (spotOpen() && current && current.rank_ksi === x.rank) { closeDetail(true); return; }   // second click: back out
    const p = byId.get(x.rank); if (p) select(p, true, null); else selectLite(x);
  };
  // Pins: a click zooms in and shows the pin; a second click (or Esc) deselects it and zooms back to where you were.
  let pinView = null;
  const pinMarkerOf = g => (g.preview ? previewMarker : pinMarkers.get(g.id));
  function selectPin(g, m) { flyToMarker(m, g); }
  function deselectPin(g, m) {
    const back = pinView;
    m.closePopup(); hidePlace(g); pinView = null;
    if (back) { if (reduceMotion) map.setView(back.c, back.z, { animate: false }); else map.flyTo(back.c, back.z, { duration: 0.6 }); }
  }
  function drawNearby(g, nb) {
    nearLayer.clearLayers();
    L.circle([g.lat, g.lon], { radius: 402, color: '#2f55c7', weight: 1.5, dashArray: '5 6', fillColor: '#2f55c7', fillOpacity: 0.04, interactive: false }).addTo(nearLayer);
    if (view) return;   // the line views have their own map
    nb.all.forEach(({ x }) => {
      if (markers[x.rank]) return;
      L.circleMarker([x.lat, x.lon], { radius: 5, color: '#fff', weight: 1.5, fillColor: '#6b7586', fillOpacity: 0.9 })
        .bindTooltip(`${rankTxt(x.rank)} · ${esc(niceName(x.name))}: ${plural(x.crashes, 'crash', 'crashes')}`, { direction: 'top', offset: [0, -4] })
        .on('click', () => openNear(x)).addTo(nearLayer);
    });
  }
  function showPlace(g, force) {
    const nb = nearbySpots(g.lat, g.lon);
    placeG = g; drawNearby(g, nb);
    if (isNarrow() || (spotOpen() && !force)) return;
    detailEl.hidden = false; detailEl.classList.add('home', 'place'); applyLayout();
    renderGraphs = () => {};
    document.getElementById('detailTitle').textContent = '📍 ' + pinTitle(g) + (g.preview ? ' (not saved yet)' : '');
    const body = document.getElementById('detailBody'), list = nb.all.slice(0, 10), mine = onMyStreet(g);
    const card = (n, attr) => `<li><button type="button" class="home-card" ${attr}>
            <span class="hc-rank" style="background:${TIERS[tierK(n.x.rank)].color}" title="${rankTxt(n.x.rank)}">${rankTxt(n.x.rank, false)}</span>
            <span class="hc-main"><span class="hc-name">${esc(niceName(n.x.name))}</span>
              <span class="hc-sub">${plural(n.x.crashes, 'crash', 'crashes')}${n.x.ksi ? ` · ${n.x.ksi} killed or seriously hurt someone` : ''}</span></span>
            <span class="hc-val">${distText(n.m)}</span></button></li>`;
    body.innerHTML = `<div class="home-wrap">
      <div class="pin-head place-head">${g.name ? `<div class="pin-addr">${esc(g.label)}</div>` : ''}${g.picked ? `<div class="pin-addr">Spot picked on the map${g.name ? '' : ' · nearest address'}</div>` : ''}</div>
      ${g.note ? `<p class="pin-warn">${esc(g.note)}</p>` : ''}
      <div class="place-acts">${pinActions(g)}</div>
      <p class="home-lead">Within a quarter mile${g.name ? '' : ` of ${esc(g.label)}`} (about a 5-minute walk),
        from police crash reports ${monthYear(meta.window_from)} to ${monthYear(meta.window_to)}.
        ${(sch => sch ? `Nearest public school: <b>${esc(schoolName(sch.name))}</b> (about ${distText(sch.m)}).` : '')(schoolNear(g.lat, g.lon))}</p>
      <div class="stat-grid home-stats">${stat(fmt(nb.crashes), 'crashes')}${stat(fmt(nb.ksi), 'of them killed or seriously hurt someone')}${stat(fmt(nb.pb), 'involved people walking or biking')}</div>
      ${mine ? `<section class="hsec hsec-mine"><h3>On ${esc(mine.name)}</h3>
        ${mine.list.length ? `<ol class="home-top">${mine.list.map((n, i) => card(n, `data-mine="${i}"`)).join('')}</ol>
          <p class="note">The closest stretch and corner of this street with reported crashes within 800 feet${mine.list.some(n => n.worst) ? ', and the highest-ranked one' : ''}.</p>`
          : `<p class="note">No crashes reported on ${esc(mine.name)} within 800 feet of this address in these years.</p>`}</section>` : ''}
      <section class="hsec hsec-top"><h3>Places with crashes nearby</h3>
        ${list.length ? `<ol class="home-top">${list.map((n, i) => card(n, `data-near="${i}"`)).join('')}</ol>
          <div class="note">Ranked out of ${fmt(N)} places with crashes. ${nb.all.length > 10 ? `${nb.all.length - 10} more places nearby aren't listed here;
            ` : ''}Places outside the ranked list are on the map as small grey dots.</div>`
          : '<p class="note">No crashes reported within a quarter mile in these years.</p>'}</section>
      ${reportBox(g.label)}
      ${civicBox(councilAt(g.lat, g.lon))}
    </div>`;
    body.scrollTop = 0; body.onchange = null;
    body.onclick = e => {
      const n = e.target.closest('[data-near]'); if (n) openNear(list[+n.dataset.near].x);
      const o = e.target.closest('[data-mine]'); if (o) openNear(mine.list[+o.dataset.mine].x);
    };
    const m = g.preview ? previewMarker : pinMarkers.get(g.id);
    if (m) wirePin(body, g, m);
  }
  function hidePlace(g) {
    if (!placeG || placeG.id !== g.id) return;
    placeG = null; nearLayer.clearLayers();
    if (detailEl.classList.contains('place')) refreshHome();
  }

  // Focus a button in a marker's pop-up once it's open (after the map has moved there).
  function focusPop(m, sel) {
    if (!m) return;
    const f = () => { const el = small() ? m.getPopup() && m.getPopup().getElement() : detailEl; const b = el && el.querySelector(sel); if (b) b.focus({ preventScroll: true }); };
    if (m.isPopupOpen()) f(); else m.once(small() ? 'popupopen' : 'panelopen', () => setTimeout(f, 0));
  }
  function showAddress(g) {
    // On a phone the list sheet would cover the pin: drop it to its smallest height and put the keyboard away first.
    if (isNarrow()) { sInput.blur(); setSnap(S.list, 'peek', { instant: true }); }
    const same = samePin(g);
    if (same) { clearPreview(); openPin(same, true); return; }
    clearPreview();
    const pv = { ...g, id: 'preview', preview: true };
    const m = drawPin(pv);
    const nb = nearbySpots(g.lat, g.lon);
    say(`Found ${g.label}. ${nb.crashes ? plural(nb.crashes, 'crash', 'crashes') + ' within a quarter mile.' : 'No crashes within a quarter mile.'} Choose Add to my pins to keep it.`);
    flyToMarker(m, pv);
    focusPop(m, '.pin-add');
  }
  // Right-click (long-press on a phone) anywhere on the map: add a pin there.
  map.on('contextmenu', e => {
    const ll = e.latlng;
    if (!inSeattle(ll.lat, ll.lng)) { L.popup({ closeButton: false }).setLatLng(ll).setContent('This map covers Seattle only.').openOn(map); return; }
    const pop = L.popup({ className: 'ctx-pop', closeButton: false, offset: [0, -4] }).setLatLng(ll)
      .setContent('<button type="button" class="ctx-add">📍 Add pin here</button><small class="pin-privacy">Esri’s address search finds the nearest address.</small>').openOn(map);
    const b = pop.getElement().querySelector('.ctx-add');
    b.focus();
    b.onclick = async () => {
      b.disabled = true; b.textContent = 'Finding the nearest address…';
      const label = await reverseGeocode(ll.lat, ll.lng);
      map.closePopup(pop);
      addPin({ lat: ll.lat, lon: ll.lng, label, picked: true }, true);
    };
  });
  function removePin(g) {
    const m = pinMarkers.get(g.id); if (m) { m.closePopup(); pinLayer.removeLayer(m); }
    pinMarkers.delete(g.id); pins = pins.filter(p => p.id !== g.id); savePins();
    say(`Pin removed: ${pinTitle(g)}.`);
    const pb = document.querySelector('.pinlist-btn');
    if (pins.length && pb) pb.focus(); else sInput.focus();
  }
  function openPin(g, fly, isNew) {
    const m = pinMarkers.get(g.id) || drawPin(g);
    if (!fly) { m.openPopup(); return m; }
    const nb = nearbySpots(g.lat, g.lon);
    say(`${isNew ? 'Address pinned' : 'Pin'}: ${pinTitle(g)}. ${nb.crashes ? plural(nb.crashes, 'crash', 'crashes') + ' within a quarter mile.' : 'No crashes within a quarter mile.'}`);
    return flyToMarker(m, g);
  }
  function flyToMarker(m, g) {
    if (!pinView) pinView = viewBefore || { c: map.getCenter(), z: map.getZoom() };
    if (spotOpen()) closeDetail(false);
    const go = () => { m.openPopup(); };
    // On phones the map is short: put the pin low in the part of the map the sheet doesn't cover, so its pop-up
    // fits above it.
    let c = L.latLng(g.lat, g.lon);
    if (small()) { const h = map.getSize().y, pinY = 0.8 * (h - cover); c = map.unproject(map.project(c, 16).add([0, h / 2 - pinY]), 16); }
    else if (!detailEl.hidden) c = map.unproject(map.project(c, 16).add([detailEl.offsetWidth / 2, 0]), 16);
    if (reduceMotion) { map.setView(c, 16, { animate: false }); go(); }
    else { map.once('moveend', go); map.flyTo(c, 16, { duration: 0.8 }); }
    return m;
  }
  function drawPin(g) {
    const old = !g.preview && pinMarkers.get(g.id); if (old) pinLayer.removeLayer(old);
    const nb = nearbySpots(g.lat, g.lon), mine = onMyStreet(g);
    // g.name is an optional nickname ("Home", "Maya's school"); g.label stays the real address for copying and reporting.
    const title = pinTitle(g);
    const html = `<div class="pin-pop"><div class="pin-head"><div class="pin-title">📍 ${esc(title)}</div>${g.name ? `<div class="pin-addr">${esc(g.label)}</div>` : ''}${g.picked ? `<div class="pin-addr">Spot picked on the map${g.name ? '' : ' · nearest address'}</div>` : ''}${g.preview ? '<div class="pin-addr">Not saved yet</div>' : ''}</div>
      ${g.note ? `<p class="pin-warn">${esc(g.note)}</p>` : ''}
      <div class="pin-near">${nb.crashes
        ? `<p>Within a quarter mile (about a 5-minute walk), ${monthYear(meta.window_from)} to ${monthYear(meta.window_to)}: <b>${plural(nb.crashes, 'crash', 'crashes')}</b>${nb.ksi ? `; <b>${nb.ksi} of them killed or seriously hurt someone</b>` : '; none killed or seriously hurt anyone'}${nb.pb ? `; ${nb.pb} involved someone walking or biking` : ''}.</p>
          ${mine ? `<div class="pin-mine"><b>On ${esc(mine.name)}</b>${mine.list.length ? `<ul>${mine.list.map(n => `<li><button type="button" class="linkbtn" data-open="${n.x.rank}">${rankTxt(n.x.rank)} · ${esc(niceName(n.x.name))}</button>
            <span class="muted">${n.worst ? 'highest-ranked on this street nearby · ' : ''}${plural(n.x.crashes, 'crash', 'crashes')}${n.x.ksi ? `, ${n.x.ksi} serious` : ''} · ${distText(n.m)}</span></li>`).join('')}</ul>` : ': no crashes reported within 800 feet.'}</div>` : ''}
          ${(c => c ? `<p class="pin-civic">Council member: <b>${esc(c.member || '—')}</b> (District ${c.d}) · <a href="#progress=d${c.d}">Is it getting fixed in District ${c.d}?</a></p>` : '')(councilAt(g.lat, g.lon))}
          ${(sch => sch && !g.school ? `<p>Nearest public school: <b>${esc(schoolName(sch.name))}</b> (about ${distText(sch.m)}).</p>` : '')(schoolNear(g.lat, g.lon))}
          Highest-ranked places nearby (out of ${fmt(N)}):<ul>${nb.worst.map(n => `<li><button type="button" class="linkbtn" data-open="${n.x.rank}">${rankTxt(n.x.rank)} · ${esc(niceName(n.x.name))}</button>
            <span class="muted">${plural(n.x.crashes, 'crash', 'crashes')}${n.x.ksi ? `, ${n.x.ksi} serious` : ''} · ${distText(n.m)}</span></li>`).join('')}</ul>`
        : 'No reported crashes within a quarter mile in the last five years.'}</div>
      <details class="pin-res" data-loc="${esc(g.label)}"><summary>Report a problem here</summary>${resourceList()}</details>
      ${pinActions(g)}</div>`;
    const m = L.marker([g.lat, g.lon], {
      pane: 'pin', keyboard: true, title: title, alt: (g.preview ? 'Found address (not saved): ' : 'Your pin: ') + (g.name ? `${g.name}, ${g.label}` : g.label),
      icon: L.divIcon({ className: 'addr-pin' + (g.preview ? ' preview' : ''), iconSize: [30, 42], iconAnchor: [15, 40], popupAnchor: [0, -36], html: '<span></span>' })
    }).bindPopup(html, { maxWidth: small() ? Math.min(320, map.getSize().x - 120) : 320, minWidth: small() ? Math.min(240, map.getSize().x - 120) : 50,   // room for the map buttons, the edge and the pop-up frame
      maxHeight: small() ? Math.max(150, Math.round(0.8 * (map.getSize().y - cover)) - 80) : 420,
      autoPanPaddingTopLeft: small() ? [62, 64] : [12, 12], autoPanPaddingBottomRight: [12, 12] }).addTo(pinLayer);
    if (g.preview) previewMarker = m; else pinMarkers.set(g.id, m);
    // Desktop: no pop-up over the map (it hid the crash dots around the pin); the pin's summary and buttons go in
    // the right panel. Clicking the pin again deselects it. Phones keep the pop-up. Decided per call, so resizing works.
    const P = L.Marker.prototype, inPanel = () => !small() && !!placeG && placeG.id === g.id && detailEl.classList.contains('place');
    m.openPopup = ll => {
      if (small()) return P.openPopup.call(m, ll);
      if (spotOpen()) { mainEl.classList.remove('split'); clearFocus(); viewBefore = null; history.replaceState(null, '', location.pathname + location.search); }
      showPlace(g, true); m.fire('panelopen');
      return m;
    };
    m.closePopup = () => { if (!small()) hidePlace(g); return P.closePopup.call(m); };
    m.isPopupOpen = () => (small() ? P.isPopupOpen.call(m) : inPanel());
    const toggle = () => (m.isPopupOpen() ? deselectPin(g, m) : selectPin(g, m));
    m.off('click', m._openPopup, m).off('keypress', m._onKeyPress, m);
    m.on('click', e => { L.DomEvent.stop(e); toggle(); });
    m.on('keypress', e => { if (e.originalEvent.key === 'Enter') toggle(); });
    m.on('popupclose', () => {
      hidePlace(g);
      // closing with × leaves focus nowhere: put it back on the pin
      setTimeout(() => { const a = document.activeElement; if ((!a || a === document.body) && m.getElement && m.getElement()) m.getElement().focus({ preventScroll: true }); }, 0);
    });
    m.on('popupopen', e => {     // popups stop clicks from bubbling, so wire their buttons here
      const pe = e.popup.getElement(); if (pe) { pe.setAttribute('role', 'dialog'); pe.setAttribute('aria-label', pinTitle(g)); }
      showPlace(g);
      wirePin(e.popup.getElement(), g, m);
    });
    return m;
  }
  // The pin's buttons, in its phone pop-up or in the desktop panel.
  function pinActions(g) {
    return g.preview
      ? `<div class="pin-actions"><button type="button" class="report-btn pin-add">📍 Add to my pins</button>
          <button type="button" class="linkbtn pin-copy">${g.school ? 'Copy name' : 'Copy address'}</button>
          <button type="button" class="linkbtn pin-dismiss">Clear</button></div>`
      : `<div class="pin-actions"><button type="button" class="linkbtn pin-copy">${g.school ? 'Copy name' : 'Copy address'}</button>
          <button type="button" class="linkbtn pin-rename">Rename</button>
          <button type="button" class="linkbtn pin-remove">Remove pin</button></div>`;
  }
  function wirePin(el, g, m) {
    {
      el.querySelectorAll('[data-open]').forEach(b => (b.onclick = () => {
        const id = +b.dataset.open, p = byId.get(id), lite = searchIdx.find(x => x.rank === id);
        m.closePopup(); showTab(document.getElementById('tabbtn-priorities'));
        if (p) select(p, true, null); else if (lite) selectLite(lite);
      }));
      el.querySelector('.pin-copy').onclick = ev => {
        const b = ev.target; const done = () => { b.textContent = g.school ? 'Name copied' : 'Address copied'; say(b.textContent); setTimeout(() => (b.textContent = g.school ? 'Copy name' : 'Copy address'), 1800); };
        if (navigator.clipboard) navigator.clipboard.writeText(g.label).then(done, () => prompt('Copy this address:', g.label)); else prompt('Copy this address:', g.label);
      };
      el.querySelectorAll('.pin-res .res-link').forEach(l => (l.onclick = () => navigator.clipboard &&
        navigator.clipboard.writeText(g.label).then(() => toast('Address copied: ' + g.label + '. Paste it into the form.'), () => {})));
      if (g.preview) {
        el.querySelector('.pin-add').onclick = () => {
          const k = { lat: g.lat, lon: g.lon, label: g.label }; clearPreview(); addPin(k, true);
          const p = samePin(k); if (p) focusPop(pinMarkers.get(p.id), '.pin-copy');
        };
        el.querySelector('.pin-dismiss').onclick = () => { clearPreview(); say('Cleared.'); sInput.focus(); };
        return;
      }
      el.querySelector('.pin-remove').onclick = () => removePin(g);
      el.querySelector('.pin-rename').onclick = () => startRename(el, g);
      if (pendingRename === g.id) { pendingRename = null; startRename(el, g); }
    }
  }
  function startRename(el, g) {
    const head = el.querySelector('.pin-head');
    head.innerHTML = `<form class="pin-rename-form"><label for="pinName">Name this pin</label>
      <input id="pinName" type="text" maxlength="40" autocomplete="off" placeholder="e.g. Home, Work, School">
      <div class="pin-rename-btns"><button type="submit" class="pin-save">Save</button>
      <button type="button" class="linkbtn pin-cancel">Cancel</button></div>
      <small class="pin-privacy">Leave it empty to show the address. Saved only on this device.</small></form>`;
    const inp = head.querySelector('input'); inp.value = g.name || '';
    inp.focus(); inp.select();
    const reopen = () => { const m = drawPin(g); m.openPopup(); focusPop(m, '.pin-rename'); };
    head.querySelector('form').onsubmit = ev => {
      ev.preventDefault();
      const v = inp.value.trim().replace(/\s+/g, ' ').slice(0, 40);
      if (v) g.name = v; else delete g.name;
      savePins(); reopen();
      say(v ? `Pin renamed to ${v}.` : 'Pin name cleared. It shows the address.');
    };
    head.querySelector('.pin-cancel').onclick = reopen;
    inp.onkeydown = ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); reopen(); } };
  }

  // "My pins": a small map button (only once there's a pin) that opens a short list to go to, rename or remove pins.
  let pinBox = null;
  const PinList = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      pinBox = L.DomUtil.create('div', 'leaflet-bar pinlist');
      pinBox.innerHTML = `<button type="button" class="pinlist-btn" aria-expanded="false" aria-controls="pinlistPanel"></button>
        <div class="pinlist-panel" id="pinlistPanel" hidden></div>`;
      L.DomEvent.disableClickPropagation(pinBox); L.DomEvent.disableScrollPropagation(pinBox);
      const btn = pinBox.querySelector('.pinlist-btn'), panel = pinBox.querySelector('.pinlist-panel');
      const setOpen = open => { panel.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
      btn.onclick = () => setOpen(panel.hidden);
      panel.addEventListener('click', e => {
        const row = e.target.closest('[data-pin]'); if (!row) return;
        const g = pins.find(p => p.id === +row.dataset.pin); if (!g) return;
        const act = e.target.closest('[data-act]') && e.target.closest('[data-act]').dataset.act;
        if (act === 'remove') { removePin(g); if (!pins.length) setOpen(false); return; }
        setOpen(false);
        if (act === 'rename') pendingRename = g.id;
        openPin(g, true);
        if (act !== 'rename') focusPop(pinMarkers.get(g.id), '.pin-copy');
      });
      pinBox.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) { setOpen(false); btn.focus(); } });
      document.addEventListener('click', e => { if (!pinBox.contains(e.target)) setOpen(false); });
      return pinBox;
    }
  });
  new PinList().addTo(map);
  function renderPinList() {
    if (!pinBox) return;
    pinBox.hidden = !pins.length;
    pinBox.querySelector('.pinlist-btn').innerHTML = `<span aria-hidden="true">📍</span> My pins <small>${pins.length}</small>`;
    pinBox.querySelector('.pinlist-btn').title = 'Your pins: go to, rename or remove';
    pinBox.querySelector('.pinlist-panel').innerHTML = `<ul>${pins.map(g => `<li data-pin="${g.id}">
        <button type="button" class="linkbtn pinlist-go" title="Go to this pin"><b>${esc(pinTitle(g))}</b>${g.name ? `<small>${esc(g.label)}</small>` : ''}</button>
        <span class="pinlist-acts"><button type="button" class="linkbtn" data-act="rename" aria-label="Rename ${esc(pinTitle(g))}">Rename</button>
        <button type="button" class="linkbtn pinlist-x" data-act="remove" aria-label="Remove ${esc(pinTitle(g))}" title="Remove">✕</button></span></li>`).join('')}</ul>
      <p class="pinlist-note">Saved only in this browser. Search an address to add another (up to ${MAX_PINS}).</p>`;
  }
  pins.forEach(drawPin);
  savePins();   // also moves a pin saved by the older single-pin version to the new list

  // ---------- tabs ----------
  const tabs =[...document.querySelectorAll('nav [role=tab]')];
  // The budget has no locations, so it slides up over the map as a sheet. On desktop the list and the details panel
  // stay put beside it; on a phone it covers everything below the header. The list underneath keeps the last tab.
  const sheets = [...document.querySelectorAll('.sheet')];
  let lastTab = tabs[0], unwidened = null;
  const openSheet = () => sheets.find(x => x.classList.contains('open'));
  function setTabState(b) {
    tabs.forEach(x => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; });
    // phone menu: show the chosen view on its button, and close it
    document.getElementById('viewMenuLabel').textContent = (b.querySelector('.tab-short') || b).textContent;
    document.querySelector('header').classList.remove('menu-open');
    document.getElementById('viewMenuBtn').setAttribute('aria-expanded', 'false');
  }
  const scrollSheetTo = t => { const body = t && t.closest('.bs-body'); if (!body) return;
    body.scrollTop += t.getBoundingClientRect().top - body.getBoundingClientRect().top - 8; };
  function showSheet(el) {
    const cur = openSheet();
    if (cur === el) return;
    if (!cur && !isNarrow() && (leftExpanded || expanded)) {
      // A widened list or details panel would squeeze the sheet to nothing: narrow them while it's open, restore after.
      unwidened = { left: leftExpanded, right: expanded };
      leftExpanded = expanded = false; applyPanel(); applyLayout();
      if (current && current.location) select(current, false, null, true);
    }
    if (cur) { cur.classList.remove('open'); cur.hidden = true; }   // sheet to sheet: swap without sliding
    el.hidden = false;
    if (!cur) void el.offsetWidth;   // first one: start the slide from below
    el.classList.add('open'); el.querySelector('.bs-body').scrollTop = 0;
    document.body.classList.add('sheet-open');
    if (isNarrow()) [panelEl, detailEl, document.getElementById('map')].forEach(x => (x.inert = true));
    el.querySelector('h2').focus({ preventScroll: true });
    const h = SHEET_HASH[el.dataset.tab];
    if (h && !location.hash.startsWith(h)) history.replaceState(history.state, '', location.pathname + location.search + h);
    docTitle(null);
  }
  const SHEET_HASH = { progress: '#progress', spending: '#budget', about: '#method' };
  function hideSheets() {
    const cur = openSheet();
    if (!cur) return;
    cur.classList.remove('open'); document.body.classList.remove('sheet-open');
    if (Object.values(SHEET_HASH).some(h => location.hash.startsWith(h))) history.replaceState(history.state, '', location.pathname + location.search);
    docTitle(null);
    [panelEl, detailEl, document.getElementById('map')].forEach(x => (x.inert = false));
    setTimeout(() => { if (!cur.classList.contains('open')) cur.hidden = true; }, reduceMotion ? 0 : 360);
    if (unwidened) {
      leftExpanded = unwidened.left; expanded = unwidened.right; unwidened = null; applyPanel(); applyLayout();
      if (current && current.location) select(current, false, null, true);
    }
  }
  // The list's title bar says what the list shows right now. It stays put while the list scrolls, so it still says
  // what you're looking at after the settings above the list have scrolled away.
  function panelBanner() {
    const el = id => document.getElementById(id);
    const tab = (document.querySelector('#panel .tab.active') || {}).id;
    let t;
    if (tab === 'tab-traffic' || tab === 'tab-walk') {
      const tr = tab === 'tab-traffic', m = el(tr ? 'tmode' : 'smode').value;
      const n = el(tr ? 'tlist' : 'slist').querySelectorAll(':scope > li').length;
      t = 'Top ' + n + ' ' + (tr ? (m === 'bus' ? 'slow bus streets' : 'busiest streets') : (m === 'missing' ? 'missing sidewalks' : 'sidewalks in poor condition'));
    } else {
      const n = el('list').querySelectorAll('li[data-id]:not(.extra)').length, top = +el('topN').value;
      const ids = [...el('list').querySelectorAll('li[data-id]:not(.extra)')].map(li => +li.dataset.id);
      const parts = [n ? (n < top ? n + (n === 1 ? ' place' : ' places') : 'Top ' + n) : 'No places match', el('mode').selectedOptions[0].text];
      if (el('distFilter').value) parts.push(el('distFilter').selectedOptions[0].text);
      if (el('addrFilter').value) parts.push(el('addrFilter').selectedOptions[0].text);
      [['onlyOngoing', 'Repeat serious crashes'], ['noPlan', 'No published SDOT project']]
        .forEach(([id, l]) => el(id).checked && parts.push(l));
      t = parts.join(' · ');
    }
    // A changed list is announced to screen readers (a filter can take it from 50 places to none), once it settles.
    if (t !== el('panelTitle').textContent && panelBanner.ready) {
      clearTimeout(panelBanner.timer);
      panelBanner.timer = setTimeout(() => { el('listStatus').textContent = 'List: ' + el('panelTitle').textContent; }, 400);
    }
    el('panelTitle').textContent = t;
    el('panelSearch').hidden = tab !== 'tab-priorities';
  }
  setTimeout(() => (panelBanner.ready = true), 1500);   // not on first load
  // Every redraw of a list updates the title, whatever caused it.
  ['list', 'tlist', 'slist'].forEach(id => new MutationObserver(panelBanner).observe(document.getElementById(id), { childList: true }));
  panelBanner();
  document.getElementById('panelSearch').onclick = () => {
    document.getElementById('panelBody').scrollTop = 0;
    document.getElementById('search').focus({ preventScroll: true });
  };
  function showTab(b) {
    setTabState(b);
    if (isNarrow() && b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const sh = sheets.find(x => x.dataset.tab === b.dataset.tab);
    if (sh) { if (sh.dataset.tab === 'progress') progressSync(); showSheet(sh); return; }
    hideSheets(); lastTab = b;
    document.querySelectorAll('#panel .tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
    panelBanner();
    setLineView(b.dataset.tab === 'traffic' ? 'traffic' : b.dataset.tab === 'walk' ? 'walk' : null);
  }
  const focusTab = () => { if (lastTab.offsetParent) lastTab.focus(); else { const m = document.getElementById('viewMenuBtn'); if (m) m.focus(); } };
  sheets.forEach(sh => (sh.querySelector('.bs-close').onclick = () => { showTab(lastTab); focusTab(); }));
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !openSheet() || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    e.stopPropagation(); showTab(lastTab); focusTab();
  }, true);
  // Budget tab -> the crash map with SDOT's mapped projects switched on.
  document.addEventListener('click', e => {
    if (!e.target.closest || !e.target.closest('.proj-show')) return;
    showTab(document.getElementById('tabbtn-priorities')); setProjects(true);
    say('Showing SDOT\'s mapped projects as purple lines next to the crash hot spots.');
  });
  // Phone: fade the right edge of the tab row only while more tabs are hidden off to the right.
  (function navFade() {
    const nav = document.querySelector('header nav');
    const upd = () => nav.classList.toggle('more-right', nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 2);
    nav.addEventListener('scroll', upd, { passive: true }); window.addEventListener('resize', upd); upd();
  })();
  tabs.forEach((b, i) => {
    b.addEventListener('click', () => {
      showTab(b);
      // phone: the menu folds away with the tab in it, so focus goes to the list's title (not lost to the page)
      if (isNarrow() && !sheets.some(x => x.dataset.tab === b.dataset.tab) && !b.offsetParent) {
        const t = document.getElementById('panelTitle'); t.tabIndex = -1; t.focus({ preventScroll: true }); }
    });
    b.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; n.focus();
    });
  });

  // ---------- Traffic view: where buses lose time, and the busiest streets ----------
  // Shown on its own tab, with its own map lines. It doesn't change the safety ranking; each street lists the
  // safety spots along it, so people can see where the two overlap.
  const T = D.traffic || { stretches: [], segments: [] };
  const tLayer = L.featureGroup();
  let trafficOn = false, tSel = null, tLines = new Map();
  const hourName = h => `${h % 12 || 12} ${h % 24 < 12 ? 'am' : 'pm'}`;
  // a long plateau (as slow from 7 am to 6 pm) is said as a span, not as the one hour that is a few seconds slower
  const hourSpan = s => (s.hr0 != null && s.hr1 > s.hr0 ? `from ${hourName(s.hr0)} to ${hourName(s.hr1 + 1)}` : `at ${hourName(s.hr)}`);
  const longDate = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const stopShort = s => s.replace(/ - Bay \w+$/, '').replace(/\s+/g, ' ').trim();
  // "Pine St & 9th Ave" + "Pine St & 4th Ave" -> "Pine St: 9th Ave to 4th Ave"
  function stretchName(s) {
    const a = stopShort(s.from), b = stopShort(s.to);
    const A = a.split(' & '), B = b.split(' & ');
    // a route that turns off and back (path over twice the straight-line distance) isn't "on" the street both stops share
    const p0 = s.pts && s.pts[0], p1 = s.pts && s.pts[s.pts.length - 1];
    const crow = p0 && p1 ? Math.hypot(p1[0] - p0[0], (p1[1] - p0[1]) * Math.cos(p0[0] * Math.PI / 180)) * 69.1 : 0;
    if (s.mi && crow && s.mi > 2 * crow) return `${a} to ${b} (the route turns)`;
    const common = A.length === 2 && B.length === 2 && A.find(x => B.includes(x));
    if (!common) return `${a} to ${b}`;
    const other = (P, c) => P[0] === c ? P[1] : P[0];
    return `${common}: ${other(A, common)} to ${other(B, common)}`;
  }
  // Real counts only: a value repeated at a later date is SDOT re-publishing the same count, so it's dropped. So are
  // counts that are implausible next to the street's other counts (a fall to under a fifth, e.g. 7,199 to 90, or a
  // five-fold jump): those are almost always a partial or misfiled count, not a real change.
  const cleanHist = h => {
    const out = [];
    for (const x of h || []) {
      const prev = out[out.length - 1];
      if (prev && x.v === prev.v) continue;
      if (prev && (x.v < prev.v / 5 || x.v > prev.v * 5)) continue;
      out.push(x);
    }
    return out;
  };
  // Trends skip pandemic-era counts (2020-2021) at either end: traffic was unusually low then.
  const pandemic = y => y === 2020 || y === 2021;
  function trendText(h) {
    h = cleanHist(h).filter(x => !pandemic(x.y));
    if (h.length < 2 || h[h.length - 1].y - h[0].y < 4) return null;
    const a = h[0], b = h[h.length - 1], c = Math.round(100 * (b.v - a.v) / a.v);
    return Math.abs(c) < 5 ? `About the same as ${a.y}` : `${c > 0 ? 'Up' : 'Down'} ${Math.abs(c)}% since ${a.y}`;
  }
  // Distance in meters from a point to a polyline [[lat, lon], ...] (flat-earth, fine at city scale).
  // Bus stretches are one line; count segments can be several pieces. Treat both as a list of lines.
  const lines = pts => (Array.isArray(pts[0][0]) ? pts : [pts]);
  const flatPts = pts => lines(pts).flat();
  function distToLine(lat, lon, multi) {
    return Math.min(...lines(multi).map(pts => distToLine1(lat, lon, pts)));
  }
  function distToLine1(lat, lon, pts) {
    const k = Math.cos(lat * Math.PI / 180) * 111320, m = 111320;
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const ax = (pts[i - 1][1] - lon) * k, ay = (pts[i - 1][0] - lat) * m, bx = (pts[i][1] - lon) * k, by = (pts[i][0] - lat) * m;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
    return best;
  }
  const safetyAlong = pts => D.priorities
    .filter(p => p.rank_ksi != null && p.rank_ksi <= 200 && distToLine(p.lat, p.lon, pts) <= 25)
    .sort((a, b) => a.rank_ksi - b.rank_ksi);

  const TMODES = {
    bus: {
      hint: `Stretches of bus route where the timetable gives buses the most extra time per mile, compared with the quickest
        hours (usually late night or early morning), added up over every weekday bus. Ranked by bus time lost per mile, so short, badly jammed stretches rank high. From King County Metro's published weekday timetable${T.weekday ? ' (the schedule for ' + longDate(T.weekday) + ', a typical weekday)' : ''}.`,
      items: () => T.stretches.filter(s => s.rank).sort((a, b) => a.rank - b.rank),
      rank: s => s.rank, name: stretchName,
      sub: s => `Routes ${s.routes.slice(0, 8).join(', ')}${s.routes.length > 8 ? '…' : ''}`,
      score: s => `${Math.round(s.lpm / 60)} h <small>a day, per mile</small>`,
      chips: s => [
        { cls: 'serious', text: `+${(s.peak - s.base).toFixed(1)} min a bus ${hourSpan(s)} (${Math.round(100 * s.slower)}% slower)` },
        { cls: 'ped', text: `${fmt(s.trips)} buses a weekday` },
        { cls: 'state', text: `Buses lose ${(s.lost / 60).toFixed(1)} hours a day here` }],
      note: `Metro sets each trip's scheduled time from how long buses really take at that hour, so busy-hour times include
         traffic and extra time for people getting on and off. It's measured between Metro's timed stops (usually ½ to 1½ miles
         apart; a few blocks downtown), so the slowdown could be anywhere along the stretch. Stretches under a quarter mile are
         left out (the timetable is in whole minutes). Inside Seattle only.`,
      detail: s => `
      <div class="dhead">
        <div class="where">${esc(TMODES.bus.sub(s))} · ${copyLoc(stretchName(s))}</div>
        <p class="verdict">${hourSpan(s).replace(/^./, c => c.toUpperCase())} on a weekday, Metro gives buses <b>${s.peak} minutes</b> for this
          ${s.mi}-mile stretch, compared with ${s.base} minutes in the quickest (usually late-night) hours: <b>${Math.round(100 * s.slower)}% slower</b>.
          ${fmt(s.trips)} buses run it each weekday; together they lose about <b>${(s.lost / 60).toFixed(1)} hours a day</b> here.</p>
        <div class="stat-grid">
          ${stat(s.base + ' min', 'quickest hours (late night)')}${stat(s.peak + ' min', hourSpan(s))}
          ${stat(fmt(s.trips), 'buses a weekday')}${stat((s.lost / 60).toFixed(1) + ' h', 'bus time lost a day')}
        </div>
      </div>
      ${reportBox(stretchName(s))}
      <h3>Safety spots along this stretch</h3>${safetyList(safetyAlong(s.pts))}
      <h3>About this measure</h3>
      <div class="note">From ${esc(stopShort(s.from))} to ${esc(stopShort(s.to))}. Metro sets scheduled times from how long buses really take
        at each hour, so busy-hour times include traffic and extra boarding time. The slowdown could be anywhere along the
        stretch. Weekday timetable in effect on ${T.weekday ? longDate(T.weekday) : 'a weekday'}.</div>`
    },
    busy: {
      hint: 'Streets with the most vehicles on an average weekday, from SDOT traffic counts. Bridge and ramp counts are ' +
        'often one direction only (marked). Busy isn\'t the same as slow or dangerous.',
      items: () => T.segments.slice().sort((a, b) => a.id - b.id),
      rank: s => s.id, name: s => niceName(s.street),
      sub: s => (s.hood ? s.hood + ' · ' : '') + (s.est || !s.yr ? `SDOT estimate${s.yr ? ' from ' + s.yr : ''}, not a measured count` : `SDOT count from ${s.yr}`),
      score: s => `${fmt(Math.round(s.awdt / 1000))}k <small>a day</small>`,
      chips: s => [{ cls: 'ped', text: `${fmt(s.awdt)} vehicles a weekday` }]
        .concat(trendText(s.hist) ? [{ cls: 'state', text: trendText(s.hist) }] : []),
      note: `Counts are weekday averages from SDOT's yearly traffic counts. Many streets are counted every few years, so a count can
         be several years old; trends use real counts only and skip 2020–2021 (pandemic traffic).`,
      detail: s => `
      <div class="dhead">
        <div class="where">${esc(TMODES.busy.sub(s))} · ${copyLoc(niceName(s.street))}</div>
        <p class="verdict"><b>${fmt(s.awdt)} vehicles</b> on an average weekday${s.est ? ' (an SDOT estimate, not a count)' : ''}.
          ${trendText(s.hist) ? esc(trendText(s.hist)) + ' (real counts only).' : ''}</p>
      </div>
      ${trafficHistChart(s.hist) ? `<h3>Traffic counts over the years</h3>${trafficHistChart(s.hist)}
        <div class="note">Each dot is a real SDOT count. Streets are recounted every few years.</div>` : ''}
      ${reportBox(niceName(s.street))}
      <h3>Safety spots along this street</h3>${safetyList(safetyAlong(s.pts))}`
    }
  };

  // ---------- Sidewalks view: SDOT's missing-sidewalk priorities, and sidewalks rated poor ----------
  const SW = D.sidewalks || { missing: [], poor: [], counts: {} };
  if (SW.counts.poor_assessed_median) document.getElementById('walkNote').querySelector('b').textContent =
    `Condition ratings come from past inspections, typically around ${SW.counts.poor_assessed_median}`;
  const ftText = ft => (ft >= 1320 ? `${(ft / 5280).toFixed(1)} mi` : `${fmt(Math.round(ft / 10) * 10)} ft`);
  const blockName = b => niceName(b.replace(/ BETWEEN /, ' between ').replace(/ AND /, ' and '));
  const swProj = new Map((PJ.missing_blocks || []).map(x => [x.b, projById.get(x.p)]));
  // SDOT's points for each reason a block needs a sidewalk, each shown out of the most SDOT gave any block.
  const swMax = k => ((SW.counts || {}).max || {})[k];
  const outOf = (v, k) => `${v ?? 0}${swMax(k) ? ` (top: ${swMax(k)})` : ''}`;
  const swBar = (label, k, s, help) => { const v = s[k] ?? 0, m = swMax(k) || 1;
    return `<div class="pg-bar"><span class="pg-bar-l">${label}${help ? ` <small class="muted">(${help})</small>` : ''}</span>
      <span class="pg-bar-t" aria-hidden="true"><span class="pg-bar-f w" style="width:${(100 * v / m).toFixed(1)}%"></span></span>
      <span class="pg-bar-v">${outOf(v, k)}</span></div>`; };
  const SMODES = {
    missing: {
      hint: `Blocks with no sidewalk, in SDOT's own order of priority. SDOT scores each missing block for safety, equity, schools,
        transit, parks and nearby homes and shops, and sorts them into Tier 1 (build first) to Tier 5.
        ${fmt(SW.counts.tier1_blocks || 0)} of ${fmt(SW.counts.missing_blocks || 0)} blocks with a missing sidewalk are Tier 1.`,
      items: () => SW.missing, rank: s => s.id, name: s => blockName(s.name),
      sub: s => [s.hood, s.art && s.art !== 'Not Designated' ? s.art : 'Neighborhood street'].filter(Boolean).join(' · '),
      score: s => `Tier ${s.tier} <small>need score ${outOf(s.score, 'score')}</small>`,
      chips: s => [
        { cls: 'serious', text: s.sides === 2 ? 'No sidewalk on either side' : 'No sidewalk on one side' },
        ...(s.safety ? [{ cls: 'fatal', text: `safety points ${outOf(s.safety, 'safety')}` }] : []),
        ...(s.school ? [{ cls: 'ped', text: 'near a school' }] : []),
        ...(s.transit ? [{ cls: 'state', text: 'near transit' }] : []),
        ...(swProj.get(s.id) ? [{ cls: 'proj', text: `SDOT project: ${projStage(swProj.get(s.id))}` }] : [])],
      note: `From the Pedestrian Element of the Seattle Transportation Plan. Scores and tiers are SDOT's; this site only puts
        them on a map with the crash ranking. Within a tier, blocks are ordered by SDOT's score, then length.
        "SDOT project" tags come from ${PROJ_SRC.sidewalk()}, matched where SDOT's project line runs along the block (or its block name matches); ${fmt((PJ.missing_blocks || []).length)}
        blocks on this list have one.`,
      detail: s => `
      <div class="dhead">
        <div class="where">${esc(SMODES.missing.sub(s))} · ${copyLoc(blockName(s.name))}</div>
        <p class="verdict"><b>${s.sides === 2 ? 'No sidewalk on either side' : 'No sidewalk on one side'}</b> of this
          ${ftText(s.ft)} block. SDOT puts building one in <b>Tier ${s.tier}</b> of 5 (Tier 1 = build first). Its need score
          is <b>${s.score ?? 0}</b>${swMax('score') ? `; the highest any block got is ${swMax('score')}` : ''}.</p>
        ${swProj.get(s.id) ? `<p class="proj-callout">${swProj.get(s.id).stage === 'done'
          ? `SDOT's project map lists a new sidewalk on this block as <b>${esc(projStage(swProj.get(s.id)))}</b>, so it may no
             longer be missing. The missing-sidewalk list comes from an older SDOT plan layer.`
          : `SDOT has a new sidewalk project on this block: <b>${esc(projStage(swProj.get(s.id)))}</b>.`}
          <span class="muted">From ${esc(PROJ_SRC.sidewalk())}: SDOT's project line runs along this block.</span></p>` : ''}
        <h3>Why SDOT says it's needed</h3>
        <p class="note">SDOT gives each block points for each reason it needs a sidewalk; more points, more need. Next to each,
          the most SDOT gave any block. The need score also counts parks and nearby homes and shops, not shown here.</p>
        ${swBar('Safety', 'safety', s, 'crashes and speeds')}${swBar('Equity', 'equity', s, 'neighborhoods the City\'s equity index puts first')}
        ${swBar('Schools', 'school', s, 'near a school')}${swBar('Transit', 'transit', s, 'near bus or rail')}
      </div>
      ${reportBox(blockName(s.name))}
      <h3>Safety spots along this block</h3>${safetyList(safetyAlong(s.pts))}
      <h3>About this measure</h3>
      <div class="note">SDOT's Seattle Transportation Plan scores every block missing a sidewalk; higher scores mean more need
        (crashes and speeds, equity, schools, transit, parks, homes and shops nearby). The parts shown are SDOT's; the total
        includes a few smaller ones.</div>`
    },
    poor: {
      hint: `Blocks with the most sidewalk that SDOT rated poor or very poor (heaved, cracked or broken), from SDOT's sidewalk
        inventory: ${SW.counts.poor_miles ?? '?'} miles on ${fmt(SW.counts.poor_blocks || 0)} blocks. Most of these ratings are from
        ${SW.counts.poor_assessed_median || 'past'} surveys, so some may have been fixed since.`,
      items: () => SW.poor, rank: s => s.id, name: s => blockName(s.name),
      sub: s => [s.hood, s.y1 ? `rated ${s.y0 === s.y1 ? s.y1 : s.y0 + '–' + s.y1}` : ''].filter(Boolean).join(' · '),
      score: s => `${ftText(s.vp + s.p)} <small>poor or worse</small>`,
      chips: s => [
        ...(s.vp ? [{ cls: 'fatal', text: `${ftText(s.vp)} very poor` }] : []),
        ...(s.p ? [{ cls: 'serious', text: `${ftText(s.p)} poor` }] : [])],
      note: `From SDOT's sidewalk inventory. Ratings come from SDOT surveys (most poor ratings are from ${SW.counts.poor_assessed_median || 'past years'});
        a block can be fixed after it was rated. Ranked by length, so long blocks rank high. In Seattle, the owner of the
        adjacent property is often responsible for sidewalk repair; this site doesn't show owners.`,
      detail: s => `
      <div class="dhead">
        <div class="where">${esc(SMODES.poor.sub(s))} · ${copyLoc(blockName(s.name))}</div>
        <p class="verdict"><b>${ftText(s.vp + s.p)}</b> of sidewalk on this block rated poor or very poor by SDOT
          (${s.y0 === s.y1 ? 'in ' + s.y1 : s.y0 + ' to ' + s.y1}).</p>
        <div class="stat-grid">${stat(ftText(s.vp), 'very poor')}${stat(ftText(s.p), 'poor')}</div>
      </div>
      ${reportBox(blockName(s.name))}
      <h3>Safety spots along this block</h3>${safetyList(safetyAlong(s.pts))}`
    }
  };
  const stat = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
  const tmodeEl = document.getElementById('tmode'), ttopEl = document.getElementById('ttopN');
  const VIEWS = {
    traffic: { modes: TMODES, modeEl: tmodeEl, topEl: ttopEl, list: 'tlist', hint: 'tHint', note: 'tNote' },
    walk: { modes: SMODES, modeEl: document.getElementById('smode'), topEl: document.getElementById('stopN'), list: 'slist', hint: 'sHint', note: 'sNote' }
  };
  let view = null;
  const V = () => VIEWS[view || 'traffic'];
  const curMode = () => V().modes[V().modeEl.value];
  const tKey = s => V().modeEl.value + ':' + s.id;
  const lineStyle = (t, on) => ({ color: TIERS[t].color, weight: (t === 0 ? 7 : t === 1 ? 6 : t === 2 ? 5 : 4) + (on ? 3 : 0), opacity: 0.95, lineCap: 'round' });

  function renderTraffic() {
    const M = curMode(), all = M.items(), n = +V().topEl.value, rows = all.slice(0, n);
    document.getElementById(V().hint).innerHTML = M.hint;
    tLayer.clearLayers(); tLines = new Map();
    // the rest of the network, faint, for context
    all.slice(n).forEach(s => L.polyline(s.pts, { color: '#8a94a6', weight: 2, opacity: 0.45, interactive: false }).addTo(tLayer));
    [...rows].reverse().forEach(s => {
      const t = tier(M.rank(s));
      const casing = L.polyline(s.pts, { color: '#fff', weight: lineStyle(t).weight + 4, opacity: 0.9, interactive: false }).addTo(tLayer);
      const line = L.polyline(s.pts, lineStyle(t, tSel === s)).addTo(tLayer)
        .bindTooltip(`#${M.rank(s)} ${esc(M.name(s))}`, { sticky: true })
        .on('click', () => pickLine(s, true));
      line._casing = casing; line._t = t; tLines.set(tKey(s), line);
    });
    document.getElementById(V().list).innerHTML = rows.map((s, i) => {
      const r = M.rank(s), t = tier(r);
      return `<li data-k="${tKey(s)}" class="${r <= 10 ? 'top10 ' : ''}t${t}${tSel === s ? ' selected' : ''}" style="--i:${Math.min(i, 15)}">
        <button type="button" class="card">
          <span class="row1"><span class="rank">#${r}</span><span class="loc">${esc(M.name(s))}<span class="hood">${esc(M.sub(s))}</span></span>
            <span class="score">${M.score(s)}</span></span>
          <span class="chips">${M.chips(s).map(c => `<span class="chip ${c.cls}">${esc(c.text)}</span>`).join('')}</span>
        </button></li>`;
    }).join('');
    const byKey = new Map(rows.map(s => [tKey(s), s]));
    document.querySelectorAll('#' + V().list + ' li').forEach(li => {
      const s = byKey.get(li.dataset.k), line = tLines.get(li.dataset.k);
      li.querySelector('button').onclick = () => pickLine(s, true);
      const hl = on => { if (line) { line.setStyle(lineStyle(line._t, on || tSel === s)); if (on) line.bringToFront(); } };
      li.onmouseenter = () => hl(true); li.onmouseleave = () => hl(false);
    });
    document.getElementById(V().note).innerHTML = M.note;
  }

  function trafficHistChart(hist) {
    const h = cleanHist(hist);
    if (h.length < 2) return '';
    const W = 300, H = 90, L0 = 44, R = 10, y0 = Math.min(...h.map(x => x.y)), y1 = Math.max(...h.map(x => x.y));
    const max = Math.max(...h.map(x => x.v)) * 1.1;
    const X = y => L0 + (W - L0 - R) * (y1 === y0 ? 0.5 : (y - y0) / (y1 - y0)), Y = v => 8 + (H - 26) * (1 - v / max);
    return `<svg class="tchart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img"
        aria-label="${esc('Traffic counts: ' + h.map(x => `${x.y}: ${fmt(x.v)}`).join(', '))}">
      <line x1="${L0}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}" stroke="#c3c2b7"/>
      <text x="${L0 - 6}" y="${Y(max / 1.1) + 4}" text-anchor="end" class="tc-ax">${fmt(Math.round(max / 1.1 / 1000))}k</text>
      <text x="${L0 - 6}" y="${Y(0) + 4}" text-anchor="end" class="tc-ax">0</text>
      <path d="${h.map((x, i) => (i ? 'L' : 'M') + X(x.y) + ' ' + Y(x.v)).join(' ')}" fill="none" stroke="#2f55c7" stroke-width="2"/>
      ${h.map(x => `<circle cx="${X(x.y)}" cy="${Y(x.v)}" r="4" fill="#2f55c7" stroke="#fff" stroke-width="2" data-tip="${esc(`<b>${x.y} count</b><br>${fmt(x.v)} vehicles a weekday`)}"/>`).join('')}
      ${(() => {      // year labels: always the first and last; others only where they don't touch a neighbor
        const n = h.length, endX = X(h[n - 1].y);
        let prev = -99;
        return h.map((x, i) => {
          const lx = X(x.y), isEnd = i === n - 1;
          if (!isEnd && i > 0 && (lx - prev < 34 || endX - lx < 34)) return '';
          prev = lx;
          const anchor = isEnd && n > 1 ? 'end' : i === 0 ? 'start' : 'middle';
          return `<text x="${anchor === 'end' ? Math.min(W - 2, lx + 12) : anchor === 'start' ? Math.max(2, lx - 12) : lx}" y="${H - 4}" text-anchor="${anchor}" class="tc-ax">${x.y}</text>`;
        }).join('');
      })()}
    </svg>`;
  }

  const safetyList = list => list.length
    ? `<ul class="tight">${list.slice(0, 8).map(p => `<li><button type="button" class="linkbtn" data-open="${p.rank_ksi}">${rankTxt(p.rank_ksi)} · ${esc(p.name)}</button>
        <span class="muted">· ${plural((p.killed ?? 0) + (p.seriously_injured ?? 0), 'person', 'people')} killed or seriously hurt</span></li>`).join('')}</ul>
       ${list.length > 8 ? `<div class="note">and ${list.length - 8} more in the safety top 200.</div>` : ''}`
    : '<div class="note">None of the safety top 200 are along here.</div>';

  function selectTraffic(s, fly) {
    rememberView();
    const M = curMode();
    tSel = s; current = null;
    tLines.forEach((line, k) => line.setStyle(lineStyle(line._t, k === tKey(s))));
    document.querySelectorAll('#' + V().list + ' li').forEach(li => { const on = li.dataset.k === tKey(s), b = li.querySelector('button');
      li.classList.toggle('selected', on); if (b) { if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); } });
    const ae = document.activeElement; if (ae && ae.closest && ae.closest('#' + V().list)) opener = ae;
    document.getElementById('detailTitle').innerHTML = `<span class="drank">#${M.rank(s)}</span> ${esc(M.name(s))}`;
    docTitle(M.name(s));
    document.getElementById('detailBody').innerHTML = M.detail(s);
    const wasHidden = detailEl.hidden;
    detailEl.hidden = false; detailEl.classList.remove('home', 'place');
    phoneDetailShown(wasHidden);
    applyLayout();
    const b = L.latLngBounds(flatPts(s.pts));
    if (fly !== false) flyBounds(b, { paddingTopLeft: [leftPad() + 40, 40], paddingBottomRight: [!isNarrow() ? detailEl.offsetWidth + 40 : 40, isNarrow() ? cover + 30 : 40], maxZoom: 16 });
    document.getElementById('detailBody').scrollTop = 0;
    document.getElementById('detailBody').onclick = e => {
      const o = e.target.closest('[data-open]'); if (!o) return;
      const p = byId.get(+o.dataset.open); if (!p) return;
      showTab(document.getElementById('tabbtn-priorities')); select(p, true, null);
    };
    document.getElementById('detailBody').onchange = null;
    setTimeout(() => document.getElementById('detailTitle').focus({ preventScroll: true }), isNarrow() ? 50 : 0);
  }
  Object.values(VIEWS).forEach(v => { v.modeEl.onchange = v.topEl.onchange = () => { if (tSel) closeDetail(false); renderTraffic(); refreshHome(); }; });

  // "Sidewalks here" on a safety spot: SDOT's missing-sidewalk tier and sidewalk rated poor, right at the spot.
  function sidewalksHere(p) {
    const out = [];
    if (p.sw_missing_tier) out.push(`<p><b>Part of this spot has no sidewalk.</b> SDOT puts building one in <b>Tier ${p.sw_missing_tier}</b>
      of 5 (Tier 1 = build first).</p>`);
    if (p.sw_poor_ft) out.push(`<p><b>${ftText(p.sw_poor_ft)}</b> of sidewalk ${p.addr_type === 'I' ? 'on the blocks that meet here' : 'on this block'} rated poor or very poor by SDOT${p.sw_poor_assessed ? ` (rated ${p.sw_poor_assessed}; may have been fixed since)` : ''}.</p>`);
    if (!out.length) return '';
    return out.join('') + '<div class="note">From SDOT\'s Seattle Transportation Plan and sidewalk inventory. Shown for context; not part of the safety score.</div>';
  }

  // "Traffic here" on a safety spot: buses, the bus stretch through it, and real traffic counts over the years.
  function trafficHere(p) {
    const out = [];
    const st = p.bus_stretch_id && T.stretches.find(x => x.id === p.bus_stretch_id);
    if (p.bus_trips) out.push(`<p><b>${fmt(p.bus_trips)} buses</b> a weekday${p.bus_routes && p.bus_routes.length ? ` <span class="muted">(routes ${esc(p.bus_routes.slice(0, 10).join(', '))}${p.bus_routes.length > 10 ? '…' : ''})</span>` : ''}.</p>`);
    if (st) out.push(`<p>On the bus route section through here (${esc(stretchName(st))}), buses are <b>${Math.round(100 * st.slower)}% slower
        ${hourSpan(st)}</b>: ${st.base} minutes in the quickest (usually late-night) hours, ${st.peak} at its slowest.
        <button type="button" class="linkbtn" data-traffic="${st.id}">See this bus stretch on the map</button></p>`);
    const by = {};
    (p.vol_history || []).forEach(x => (by[x.s] = by[x.s] || []).push({ y: x.y, v: x.v }));
    Object.entries(by).forEach(([street, h]) => {
      const chart = trafficHistChart(h), tr = trendText(h);
      if (chart) out.push(`<div class="th-street"><b>${esc(niceName(street))}</b>${tr ? ` <span class="muted">· ${esc(tr)}</span>` : ''}${chart}</div>`);
    });
    if (!out.length) return '<div class="note">No bus or traffic-count data here.</div>';
    return out.join('') + '<div class="note">Counts are real SDOT weekday counts (streets are recounted every few years). ' +
      'Bus times come from King County Metro\'s timetable. Shown for context; not part of the safety score.</div>';
  }

  // Switch the map between the safety spots and a line view ('traffic', 'walk'), or back (null).
  function setLineView(name) {
    if (name === view) return;
    const was = view; view = name; trafficOn = !!name;
    document.body.classList.toggle('traffic-view', !!name);
    document.body.classList.toggle('walk-view', name === 'walk');
    if (spotOpen()) closeDetail(false);
    tSel = null;
    if (name) { if (!was) { map.removeLayer(layer); clearFocus(); tLayer.addTo(map); } renderTraffic(); }
    else { map.removeLayer(tLayer); layer.addTo(map); }
    refreshHome();
  }

  // Fix kinds whose latest date in SDOT's data is more than two years before the scored years end: newer ones may be undated.
  function staleFixDates() {
    const end = +String(meta.window_to).slice(0, 4);
    const old = (meta.fix_last || []).filter(f => f.d && f.k !== 'Bus lane' && +String(f.d).slice(0, 4) < end - 2);
    if (!old.length) return '';
    const items = old.map(f => `after ${String(f.d).slice(0, 4)} for ${f.k.toLowerCase()}s`);
    return ` SDOT's data has no dates ${items.length > 1 ? items.slice(0, -1).join(', ') + ' or ' + items[items.length - 1] : items[0]}, so newer ones may not be counted.`;
  }
  // ---------- capital budget tab ----------
  function budgetInit() {
    const years = [...new Set(D.budget.map(b => b.year))].sort();
    const thisYear = new Date().getFullYear();
    const expand = s => s.replace(/^MC-TR-C\d+ -\s+/, '').replace(/^TRC\d+ - /, '')
      .replace(/\bPMP\b/, 'Pedestrian Master Plan').replace(/\bBMP\b/, 'Bicycle Master Plan')
      .replace(/\bCWF\b/, 'Central Waterfront').replace(/\bAWMC\b/, 'Alaskan Way Main Corridor')
      .replace(/\bST3\b/, 'ST3').replace(/\bREET\b/, 'REET (real estate excise tax)').replace(/\bEW\b/, 'East-West');
    // Budget programs whose projects SDOT also publishes on a map. Matched by name only (the two are the same program
    // name in both places); SDOT publishes no link between a budget line and a mapped project, and no per-project cost.
    function mappedPrograms() {
      const line = re => { const ys = {}; D.budget.filter(b => re.test(b.project)).forEach(b => (ys[b.year] = (ys[b.year] || 0) + b.amount)); return ys; };
      const progs = [
        { name: 'New sidewalks', budget: 'PMP – New Sidewalk Program (MC-TR-C058)', ys: line(/MC-TR-C058\b/),
          mapped: `${fmt(PJ.counts.sidewalk_design || 0)} projects moving into design, ${fmt(PJ.counts.sidewalk_done || 0)} completed`, src: PROJ_SRC.sidewalk() },
        { name: 'Neighborhood safety projects', budget: 'Neighborhood-Initiated Safety Partnership Program (MC-TR-C154)', ys: line(/MC-TR-C154\b/),
          mapped: `${fmt(PJ.counts.safety_planned || 0)} planned, ${fmt(PJ.counts.safety_done || 0)} completed`, src: PROJ_SRC.safety() }
      ];
      return `<h3>Where SDOT maps the work</h3>
        <p class="note">For two programs, SDOT also publishes a map of the projects. The budget pays for each program as a whole;
          the City doesn't publish how that money is split among the mapped projects, so this site shows no cost for any single
          project. The two are matched by program name only.</p>
        <div class="tablewrap"><table><tr><th scope="col">Program</th><th scope="col">On SDOT's map</th>
          ${years.filter(y => y >= thisYear).map(y => `<th scope="col" class="${y > thisYear ? 'planned' : ''}">${y}${y > thisYear ? '*' : '†'}</th>`).join('')}</tr>
          ${progs.map(g => `<tr><td><b>${esc(g.name)}</b><br><small class="muted">Budget line: ${esc(g.budget)}</small></td>
            <td>${esc(g.mapped)}<br><small class="muted">${esc(g.src)}</small></td>
            ${years.filter(y => y >= thisYear).map(y => `<td class="${y > thisYear ? 'planned' : ''}">${g.ys[y] ? money(g.ys[y]) : '–'}</td>`).join('')}</tr>`).join('')}
        </table></div>
        <p class="note">Also on the map: ${fmt(PJ.counts.lpi_planned || 0)} head-start walk signals SDOT lists as planned (no
          single budget line is named for them). Repaving, bridges and large corridor projects have budget lines but no current
          public map, so they can't be shown.</p>
        <p><button type="button" class="report-btn proj-show">See SDOT's mapped projects next to the crash hot spots</button></p>`;
    }
    const byProg = {};
    D.budget.forEach(b => {
      const g = (byProg[b.program] ||= { total: {}, projects: {} });
      g.total[b.year] = (g.total[b.year] || 0) + b.amount;
      const pr = (g.projects[b.project] ||= {});
      pr[b.year] = (pr[b.year] || 0) + b.amount;
    });
    const head = `<tr><th scope="col">Program</th>${years.map(y => `<th scope="col" class="${y > thisYear ? 'planned' : ''}">${y}${y > thisYear ? '*' : y === thisYear ? '†' : ''}</th>`).join('')}</tr>`;
    const cells = obj => years.map(y => `<td class="${y > thisYear ? 'planned' : ''}">${obj[y] ? money(obj[y]) : '–'}</td>`).join('');
    const grand = {};
    let html = '';
    Object.entries(byProg).sort((a, b) => sum(b[1].total) - sum(a[1].total)).forEach(([prog, g]) => {
      years.forEach(y => (grand[y] = (grand[y] || 0) + (g.total[y] || 0)));
      const rows = Object.entries(g.projects).sort((a, b) => sum(b[1]) - sum(a[1]))
        .map(([name, ys]) => `<tr><td>${name === "(blank)" ? "<i>Lines with no project named</i>" : esc(expand(name))}</td>${cells(ys)}</tr>`).join('');
      html += `<details><summary>${esc(prog)}: ${money(sum(g.total))} <span class="muted">(${years[0]}–${years[years.length - 1]}, budgeted and planned)</span></summary>
        <p class="note">${progSummary(g)}</p>
        <div class="tablewrap"><table>${head}${rows}<tr class="total"><td>Program total</td>${cells(g.total)}</tr></table></div></details>`;
    });
    document.getElementById('budget').innerHTML = `
      <p class="note">SDOT's <b>capital budget</b> by program, from the City of Seattle Capital Budget dataset. These are
        <b>budgeted</b> amounts, net of mid-year cuts (some lines are negative), <b>not money actually spent</b>.
        The city's budget data has no location field, so these amounts can't be placed on the map; see "Where SDOT maps
        the work" below for the projects SDOT does map.</p>
      <div class="tablewrap"><table>${head}<tr class="total"><td class="nowrap">All SDOT capital</td>${cells(grand)}</tr></table></div>
      <p class="note">† current year's budget. * planned future years. Click a program for its projects.</p>
      ${mappedPrograms()}
      ${html}
      <p class="note">Abbreviations: ST3 = Sound Transit 3; BUD = a budget-level entry in the city's data. Projects are matched
        across years by their city project number and shown under their newest name.</p>
      ${(meta.levy_funds || []).length ? `<p class="note">Voter-approved levy money in this data: ${meta.levy_funds.map(f =>
        `${esc(f.fund)} (${f.from === f.to ? f.from : f.from + '–' + f.to})`).join(', ')}. A year when one levy winds down and the
        next starts can look lower or higher than its neighbors.</p>` : ''}`;
    function sum(o) { return Object.values(o).reduce((a, b) => a + b, 0); }
    // "12 projects; the largest over these years: A, B and C" (from the budget data itself)
    function progSummary(g) {
      const named = Object.entries(g.projects).filter(([n]) => n !== '(blank)');
      const top = named.filter(([, ys]) => sum(ys) > 0).sort((a, b) => sum(b[1]) - sum(a[1])).slice(0, 3).map(([n]) => esc(expand(n)));
      if (!named.length) return '';
      const list = top.length > 1 ? top.slice(0, -1).join(', ') + ' and ' + top[top.length - 1] : top[0] || '';
      return `${fmt(named.length)} project${named.length === 1 ? '' : 's'}${top.length && named.length > 1 ? `; the largest over these years: ${list}` : ''}.`;
    }
  }

  // ---------- about tab ----------
  function renderAbout() {
    const g = weight('fatal_growth'), k = weight('ksi'), A = weight('ksi_prior_crashes');
    const bmax = weight('request_boost_max'), bhalf = weight('request_boost_half');
    const ex = byId.get(1);
    const scored = meta.request_weights.filter(r => r.w > 0), unscored = meta.request_weights.filter(r => r.w <= 0);
    const example = ex ? `
      <div class="example">
        <h3>Example: #1 ${esc(ex.name)}</h3>
        <ol class="steps">
          <li><b>Crash harm ${fmt(Math.round(ex.harm))}.</b> ${ex.crashes} crashes; each scores by how badly people were hurt.</li>
          <li><b>Expected harm ${fmt(Math.round(ex.expected_harm))}.</b> The fatal/serious part is blended with what's typical for
            ${esc(groupName(ex.ref_group))}, so a handful of crashes doesn't swing the estimate too far.</li>
          ${bmax > 0 ? `<li><b>Score ${fmt(Math.round(ex.score_ksi))}.</b> × ${(1 + ex.request_boost).toFixed(2)} for nearby safety-related repair requests.</li>` : ''}
        </ol>
      </div>` : '';
    const ksi = `
      <h3>"Most likely to hurt people" ranking, in full</h3>
      <ol>
        <li><b>Crash harm.</b> Points per crash: killed or seriously injured ${k}, other injury ${weight('injury')},
          property damage only ${weight('pdo')}, × ${weight('ped_bike_mult')} when someone walking or biking was involved and someone was hurt.
          Fatal and serious count alike because whether a serious crash turns fatal often depends on things beyond the street
          itself, like the person's age, the vehicle, or how quickly help arrives. ${meta.unknown_from && meta.unknown_recent && meta.unknown_recent.share
          ? `Since ${monthYear(meta.unknown_from)} about 1 in ${Math.round(1 / meta.unknown_recent.share)} reports has no severity`
          : 'Some reports have no severity'}; those
          aren't treated as harmless: each gets the typical non-fatal/serious harm for similar streets.</li>
        <li><b>Repeated deaths compound.</b> The 1st fatal crash at a spot counts ${k}, the 2nd ${(k * g).toFixed(1)},
          the 3rd ${(k * g * g).toFixed(1)} (each × ${g} the last). This extra weight then goes through step 3 like all fatal/serious
          harm: at a spot with few crashes, most of it is replaced by the typical rate. That's why places where 2 or more people
          died are also listed separately, whatever their rank.</li>
        <li><b>Expected harm.</b> With only a few crashes, a spot's record can make it look much more or much less dangerous than it really is. So its fatal/serious harm is blended
          with the typical rate for similar spots (same kind of location and street class), weighted by its crash count:
          own record × crashes ÷ (crashes + ${A}) + typical rate × ${A} ÷ (crashes + ${A}). A spot with 5 crashes leans ${Math.round(100 * A / (5 + A))}% on the typical
          rate; one with 60 leans ${Math.round(100 * 60 / (60 + A))}% on its own record. Every crash, even a fender-bender,
          is evidence of how much conflict happens there. (This is similar to methods traffic engineers use, applied only to the share of crashes that kill or seriously hurt.)</li>
        ${bmax > 0 ? `<li><b>Repair boost.</b> Safety-related requests (${scored.map(r => esc(r.type)).join(', ')}) within
          ${ft(weight('request_radius_m'))} ft since ${monthYear(meta.requests_scored_from)} raise the score by up to
          +${Math.round(100 * bmax)}% (half that at ${bhalf} request points). Duplicate reports of the same thing in the same
          month count once. ${unscored.map(r => esc(r.type)).join(', ')} requests are shown but not scored: they aren't
          clearly tied to crashes, or weren't collected for the whole period.</li>`
        : `<li><b>Repair requests don't change the score.</b> Requests to the City within ${ft(weight('request_radius_m'))} ft are listed on each
          place's page, but how often people report a problem depends on who lives and travels there as much as on how dangerous
          the street is, so the ranking uses crashes only.</li>`}
      </ol>`;
    const risk = `
      <h3>Most dangerous for how busy it is</h3>
      <p>Expected harm per million vehicles over the five years: vehicles entering an intersection (the streets' weekday counts
        added together) or using a block, × 365 × 5. Weekday counts overstate weekends a little. Blocks and intersections share one
        list, but a long block carries its traffic farther, so long blocks can look riskier than they are. This surfaces places that are dangerous <i>for how busy they are</i>. Only spots with an SDOT
        count and at least ${weight('risk_min_crashes')} crashes are ranked; volumes under ${fmt(weight('risk_vol_floor'))}
        count as ${fmt(weight('risk_vol_floor'))}. SDOT's counts range from ${meta.count_years ? meta.count_years.from + ' to ' + meta.count_years.to : 'several years'} and some are estimates; each
        spot shows which it uses.</p>
      <p class="note">Why isn't this the default? Total harm counts every person hurt. A busy street with many injuries
        affects more people than a quiet one with a high rate.</p>`;
    const V = (meta.validation || []).reduce((o, a) => (o[a.method] = a, o), {});
    const vname = { expected: 'This site (one list for intersections and stretches)', expected_split: 'Intersections and stretches ranked apart, alternating', old_reliability: 'Previous version of this site', crash_count: 'Most crashes',
                    raw_harm: 'Crash harm, no blending', ksi_count: 'Most fatal/serious crashes' };
    const dayBefore = d => new Date(new Date(d + 'T12:00:00') - 864e5).toISOString().slice(0, 10);
    const span = (x, y) => `${monthYear(x)}–${monthYear(y)}`;
    const two = !!meta.test2_from;
    const ex2 = V.expected || {}, cc = V.crash_count || {}, one = V.expected_split || {};
    const validation = `
      <h3>Does it predict anything?</h3>
      <p>The test: rank spots using only earlier years, then count the fatal and serious crashes that happened afterwards at
        each method's top 50 and top 200. It's run on two splits of the years; they overlap in part, so they aren't fully independent checks.</p>
      <ul class="tight">
        <li><b>Test 1:</b> ranked on ${span(meta.window_from, dayBefore(meta.test_from))}, counted ${span(meta.test_from, meta.window_to)}
          (${fmt(meta.test_ksi_total)} fatal or serious crashes citywide).</li>
        ${two ? `<li><b>Test 2:</b> ranked on ${span(meta.window_from, dayBefore(meta.test2_from))}, counted ${span(meta.test2_from, meta.test2_to)}
          (${fmt(meta.test2_ksi_total)} citywide).</li>` : ''}
      </ul>
      <table class="vtable"><thead>
        <tr><th scope="col" rowspan="2">Method</th><th scope="colgroup" colspan="2">Test 1</th>${two ? '<th scope="colgroup" colspan="2">Test 2</th>' : ''}</tr>
        <tr><th scope="col">Top 50</th><th scope="col">Top 200</th>${two ? '<th scope="col">Top 50</th><th scope="col">Top 200</th>' : ''}</tr></thead><tbody>
        ${(meta.validation || []).map(v => `<tr class="${v.method === 'expected' ? 'total' : ''}"><td>${vname[v.method] || v.method}</td><td>${v.k50}</td><td>${v.k200}</td>${two ? `<td>${v.b50}</td><td>${v.b200}</td>` : ''}</tr>`).join('')}
      </tbody></table>
      <p class="note">${(() => {
          // How often counting fatal/serious crashes alone caught the fewest, from the table.
          const cols = two ? ['k50', 'k200', 'b50', 'b200'] : ['k50', 'k200'], vs = meta.validation || [];
          const low = cols.filter(c => V.ksi_count && V.ksi_count[c] === Math.min(...vs.map(v => v[c]))).length;
          return V.ksi_count ? `Ranking on fatal/serious crashes alone caught the fewest in ${low === cols.length ? 'every column' : `${low} of the ${cols.length} columns`}: they're rare enough that a place's count swings a lot from year to year, so past counts alone say little about what comes next. ` : '';
        })()}
        ${(() => {
          // Said from the numbers in the table, whichever way they fall.
          const pairs = [['top 50', [ex2.k50, two && ex2.b50], [cc.k50, two && cc.b50]], ['top 200', [ex2.k200, two && ex2.b200], [cc.k200, two && cc.b200]]];
          const both = a => a.filter(x => x !== false && x != null).map(fmt).join(' and ');
          const verdict = (a, b) => { const d = a.filter(x => x !== false && x != null).map((x, i) => x - b[i]);
            // the two lists share most of their places, so only gaps over a tenth (and over 2) are called more or fewer
            const small = d.some((x, i) => Math.abs(x) <= Math.max(2, 0.1 * b[i]));
            return small ? 'about the same number' : d.every(x => x > 0) ? 'more' : d.every(x => x < 0) ? 'fewer' : 'about the same number'; };
          return 'Against simply counting crashes, this site\'s ranking caught ' + pairs.map(([n, a, b]) =>
            `${verdict(a, b)} in the ${n} (${both(a)}, against ${both(b)})`).join(', and ') +
            `. The differences are a few crashes out of ${fmt(meta.test_ksi_total)}${two ? ' and ' + fmt(meta.test2_ksi_total) : ''}, and Test 1 was also used to choose the method, so read the ranking as a guide that does about as well as counting crashes, not a precise forecast.` +
            (meta.unknown_from && meta.unknown_recent && meta.unknown_recent.n ? ` Test 1's later years include ${fmt(meta.unknown_recent.n)} crash reports from ${monthYear(meta.unknown_from)} on that don't list a severity.` : '');
        })()}</p>
      ${V.expected_split && V.expected ? `<p class="note">Intersections and stretches are ranked together in one list, so the top of the list
        is whichever places are most likely to hurt people. Ranking them apart and alternating (the way SDOT lists its High Collision
        Locations, and this site's rule until November 2026) caught ${one.k50}${two ? ' and ' + one.b50 : ''} in the top 50, against
        ${ex2.k50}${two ? ' and ' + ex2.b50 : ''} for one list, and ${one.k200}${two ? ' and ' + one.b200 : ''} in the top 200, against
        ${ex2.k200}${two ? ' and ' + ex2.b200 : ''}. Use "Show" to see intersections or stretches on their own, ranked again within that kind.</p>` : ''}
      <p class="note">Test 1 was also used to choose the method, so it flatters it a little${two ? '; Test 2 was added afterwards as a check' : ''}. Spots that rank high after a bad few years usually improve somewhat on their own (regression to
        the mean): the blending evens out the fatal/serious share where numbers are small, but not the crash count itself.</p>`;
    const ag = (meta.sdot_agreement || []).reduce((o, a) => (o[a.mode] = a, o), {});
    const agRow = (m, label) => ag[m] ? `<tr><td>${label}</td><td>${ag[m].on_hin}</td><td>${ag[m].on_hin_high}</td><td>${ag[m].sdot_hcl_recent}</td></tr>` : '';
    const agreement = `
      <h3>Consistency with SDOT's lists</h3>
      <p>SDOT's High Injury Network and High Collision Locations come from overlapping crash data, so this is a
        consistency check, not independent proof. Top 50 of each ranking:</p>
      <table class="vtable"><thead><tr><th scope="col"></th><th scope="col">High Injury Network</th><th scope="col">of those "High"</th><th scope="col">High Collision list ${meta.window_from.slice(0, 4)}+</th></tr></thead><tbody>
        ${agRow('ksi', 'Most likely to hurt people')}${agRow('risk', 'Most dangerous for how busy it is')}
        ${agRow('baseline_crash_count', 'Baseline: 50 spots with most crashes')}
      </tbody></table>
      <p class="note">For scale: ${Math.round(100 * meta.busy_share_on_hin)}% of the ${fmt(meta.busy_locations)} spots with 10+ crashes are on the High Injury Network.</p>`;
    document.getElementById('about').innerHTML = `
      <h3>About this site</h3>
      <p>Streets First is an independent project. It isn't made by or for the City of Seattle or SDOT, which haven't reviewed or endorsed it, and it uses only the
        City's public data, downloaded and rebuilt automatically every Monday. All the code and every calculation are public on
        <a href="https://github.com/tai2541/streetsfirst" target="_blank" rel="noopener">GitHub</a> for anyone to read and check (other use needs permission).</p>
      <p><b>See a mistake?</b> <a href="https://github.com/tai2541/streetsfirst/issues/new" target="_blank" rel="noopener">Report it on GitHub</a>
        (a free account is needed). Corrections that come from the City's own data are fixed in the next rebuild.</p>
      <p class="note">Totals here can differ from SDOT's Vision Zero reports: SDOT's official figures count people, from crash data
        WSDOT has checked, which is final about a year later. This site counts police reports in SDOT's open collision data
        for the five years shown, leaves out freeway crashes, and places each crash at the intersection or block SDOT assigns it to.
        The most recent months may still be filling in as reports arrive.</p>
      <p class="note"><b>Privacy.</b> No accounts, cookies or analytics. The map images come from Esri, which sees the area you're viewing.
        A typed address is looked up with Esri's address search (OpenStreetMap's if Esri can't find it); picking an address from the
        suggestions list doesn't send it anywhere. Pins are kept only in this browser, so anyone using it can see them. The site is hosted
        on GitHub Pages. Accessibility and Safe Routes to School repair requests are shown by hundred block, not house number.</p>
      <h3>What this ranks</h3>
      <p>Every Seattle intersection and every stretch of street between intersections with a police-reported crash from ${monthYear(meta.window_from)} to
        ${monthYear(meta.window_to)} (${fmt(meta.collisions_scored)} SDOT collision reports), ranked by how likely people are to keep
        getting killed or seriously hurt there.</p>
      ${example}
      ${mode === 'risk' ? risk + ksi : ksi + risk}
      ${validation}
      ${agreement}
      <h3>Street details and SDOT actions</h3>
      <p class="note">From SDOT's street network, traffic counts, signal inventory and Vision Zero layers: street type, speed
        limit (the place's own street; the higher of the two at a corner), pavement condition (0–100, labelled good 70+, fair 40–69, poor under 40 by this
        site, not SDOT), head-start walk signals and protected left turns. Shown for context; not part of the score.
        ${stateRoutes() ? `Places WSDOT runs (${stateRoutes()}: freeways, ramps, the tunnel and state bridges, from WSDOT's own data) are marked and counted apart. A state highway on a city street, like Aurora Ave N or Lake City Way, is run by the City and counted as a city street.` : ''}</p>
      <p class="note"><b>Crash patterns with a known fix</b> (blue dashed tags): left-turn crashes at a signal with no protected
        left-turn arrow; people walking hit by turning drivers where there's no head-start walk signal (only left turns count where
        no turn on red is in place); many angle crashes at a signal (backplates and signal timing) or at a corner with no signal;
        and, along a stretch, crashes with people walking away from the corners or many left-turn crashes, all according to SDOT's
        signal and Vision Zero data. They put a pattern next to a common fix; whether that
        fix suits the place is an engineering call.</p>
      <p class="note">Encampment, parking, graffiti and similar report types are left out on purpose. This map is about
        fixing infrastructure, not policing.</p>
      <h3>The Slow buses &amp; busy streets tab</h3>
      <p>Shown next to the safety ranking so you can compare them, but it doesn't change the safety score.</p>
      <ul>
        <li><b>Where buses lose the most time</b>: from King County Metro's timetable for a typical weekday. Metro schedules each
          trip from how long buses really take at that hour, so for each stretch between Metro's timed stops (usually ½ to 1½ miles apart; a few blocks downtown)
          each hour's time is compared with the quickest hours, usually late night or before 6 am. Ranked by the extra bus time per mile,
          added up over every weekday bus. Busy hours include extra boarding time, not only traffic. These are scheduled times, not
          measured ones: Metro sets them from past trips, so they can lag behind recent changes. Short stretches downtown rank high
          partly because a minute of schedule rounding is a big share of a short trip.</li>
        <li><b>Busiest streets</b>: SDOT's weekday traffic counts. Many streets are only counted every few years, and some numbers
          are SDOT estimates; both are labeled. Trends use real counts only: SDOT's yearly layers repeat old counts for streets that
          weren't recounted, so those repeats are left out.</li>
        <li>Each street lists the safety spots along it, and each safety spot shows its buses, bus slowdown and traffic counts.</li>
      </ul>
      <h3>The Missing &amp; broken sidewalks tab</h3>
      <ul>
        <li><b>Missing sidewalks SDOT ranks first</b>: SDOT's own priorities from the Seattle Transportation Plan. SDOT scores each
          block without a sidewalk (safety, equity, schools, transit, parks, homes and shops nearby) and sorts them into Tier 1 to 5.
          This site doesn't change SDOT's order; it puts it on the map next to the crash ranking.</li>
        <li><b>Sidewalks in poor condition</b>: blocks with the most sidewalk SDOT rated poor or very poor in its inventory. Many
          ratings are several years old, so some may have been fixed. Who owns the adjacent property isn't shown.</li>
        <li>Each block lists the safety spots along it, and each safety spot shows any missing or poor sidewalk right there.</li>
      </ul>
      <h3>SDOT's planned projects</h3>
      <ul>
        <li>Only what SDOT publishes on a map with a location: its <b>New Sidewalks</b> project map (blocks moving into design,
          and recently completed ones), its <b>Neighborhood-Initiated Safety Partnership Program</b> map (crossings, traffic
          calming, curb ramps and more, planned or completed), and the <b>head-start walk signals</b> it lists as planned. Stage
          names ("moving into design", "planned for 2027") are SDOT's; a year for a project in design is SDOT's target.</li>
        <li>A project counts as "nearby" a crash spot within about 100 ft of an intersection or 40 ft of anywhere along a block. Nearby doesn't
          mean it was designed for those crashes: pavement art at a school and a new crossing look the same to a map, so each
          project is listed with what it is.</li>
        <li>"No SDOT project published nearby" means none on these maps. SDOT may still have plans there, such as repaving,
          signal work or corridor projects, that it doesn't publish on a current public map. SDOT's older bike-project map is
          left out because it has no dates or status.</li>
        <li>The City's budget data has no locations, and these maps have no costs or budget numbers. Two budget programs share a
          name with a project map (New Sidewalk Program; Neighborhood-Initiated Safety Partnership Program), so the budget tab
          shows them side by side, but no dollar amount is ever given for a single project.</li>
        <li>None of this changes the crash ranking.</li>
      </ul>
      <h3>Driver behavior</h3>
      <p class="note">Crashes involving speeding stay in the score. Repeated speeding at one spot usually points to road design
        (wide, straight streets invite speed), so it's flagged as context ("speed-related: 8 of 30") rather than excluded.</p>
      <h3>Known limits</h3>
      <ul>
        <li>The latest 3 months of crashes aren't scored: police reports arrive late, so those months look safer than they were.
          Citywide totals at the top include the ${fmt(meta.city_ksi_unlocated || 0)} fatal or serious reports that have no location.</li>
        <li>${fmt(meta.dropped_no_location)} crash reports (${meta.dropped_fatal} fatal, ${meta.dropped_ksi} fatal or serious) have no location and can't be placed.</li>
        <li>${fmt(meta.unknown_severity)} scored crash reports have unknown severity${meta.unknown_from && meta.unknown_recent && meta.unknown_severity
          ? ` (${fmt(meta.unknown_recent.n)} of them since ${monthYear(meta.unknown_from)}, when SDOT's data began leaving it blank much more often)` : ''}.
          They get the typical harm of a non-fatal crash on similar streets.</li>
        <li>Scores count crashes, not people: a crash that hurt three people counts once, at its worst injury. The death and
          injury numbers shown for each place count people.</li>
        <li>Only police-reported crashes. Minor crashes, and falls by people biking with no vehicle involved, often go unreported.</li>
        <li>Freeway mainlines (I-5, I-90, SR 520), handled by the State Patrol, are mostly not in SDOT's data.</li>
        <li>Severity is the officer's judgment at the scene; a later death may not be added. "Speed-related" is what the officer
          noted (${fmt(meta.city_speeding || 0)} of ${fmt(meta.collisions_scored)} crashes).</li>
        <li>Only places with a reported crash are scored. A street can be dangerous before anyone is hurt (wide, fast, no crossings).</li>
        <li>SDOT names each side of a divided street separately (for example both sides of Martin Luther King Jr Way S); those
          are merged into one place when they're within about 200 ft. Probable duplicate reports are counted once.</li>
        <li>Longer blocks collect more crashes. Each block shows its length; the score isn't adjusted because doing so made
          predictions worse in the test above.</li>
        <li>Requests are counted within ${ft(weight('request_radius_m'))} ft of a point, which covers more of an intersection than of a long block.</li>
        <li>Traffic counts cover arterials only, and some are old or estimated.</li>
        <li>Find It Fix It status is unreliable (most requests stay "Reported"), so open and fixed requests count the same.</li>
      </ul>`;
  }
  renderAbout();

  // If nobody has refreshed the data for a while, say so plainly at the top.
  // ---------- "Is it getting fixed?": the worst places of past years now, what changed since last month, need vs work ----------
  // Everything here is worked out again from the crash records at each build (see pipeline/history.sql), so it needs no
  // stored history. Links: #progress, #progress=2018 (a year), #progress=d2 (a council district).

  function openPlaceByName(name) {
    const s = searchIdx.find(x => x.name === name);
    if (!s) return false;
    const tabBtn = document.getElementById('tabbtn-progress');
    showTab(document.getElementById('tabbtn-priorities'));
    const p = byId.get(s.rank);
    if (p) select(p, true, tabBtn); else { opener = tabBtn; selectLite(s); }
    progReturn = name;
    return true;
  }
  function returnToProgress(name) {
    const b = document.getElementById('tabbtn-progress');
    showTab(b);
    const btn = [...document.querySelectorAll('#progress .prog-open')].find(x => x.dataset.loc === name);
    (btn || b).focus();
    if (btn) { const body = btn.closest('.bs-body'), r = btn.getBoundingClientRect(), br = body.getBoundingClientRect();
      body.scrollTop += r.top - br.top - br.height / 2; }
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.prog-open');
    if (b) openPlaceByName(b.dataset.loc);
  });
  const throughMonth = d => { const t = new Date(d + 'T12:00:00'); t.setDate(0); return t.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); };
  const placeBtn = loc => searchIdx.some(x => x.name === loc)
    ? `<button type="button" class="linkbtn prog-open" data-loc="${esc(loc)}">${esc(niceName(loc))}</button>`
    : esc(niceName(loc));
  let progressLink = () => false;
  let progressSync = () => {};   // set by progressInit: opens the district picked on the list

  // The kinds of work counted as a fix on this tab (pipeline/history.sql, place_fixes). Keep the two in step.
  // The state highways among the places on the map, from the data (e.g. "SR 99, SR 509").
  function stateRoutes() {
    const s = new Set(D.priorities.map(p => p.state_route).filter(Boolean));
    const sr = [...s].filter(x => /^SR \d+$/.test(x)).sort((a, b) => a.slice(3) - b.slice(3));
    const all = sr.concat([...s].filter(x => /^I-\d+$/.test(x)).sort());
    return all.length > 1 ? all.slice(0, -1).join(', ') + ' and ' + all[all.length - 1] : all.join('');
  }
  const FIX_KINDS = 'head-start walk signals, no turn on red, protected left turns, new or rebuilt signals, traffic circles, protected bike lanes, new sidewalks, neighborhood safety projects';
  function progressInit() {
    const P = D.progress, el = document.getElementById('progress');
    if (!P || !el) return;
    const M = P.month, C = P.cmp;
    const y0 = d => +d.slice(0, 4), yEnd = d => +d.slice(0, 4) - 1;            // [d0, d1) as calendar years
    const span = (a, b) => y0(a) === yEnd(b) ? String(y0(a)) : `${y0(a)}–${yEnd(b)}`;
    const cmpSpan = span(C.d0, C.d1), cmpEnd = yEnd(C.d1);
    // Change between two counts: a percentage only when both are big enough for one to mean something.
    const change = (a, b) => {
      if (a >= 30 && b >= 30) { const c = Math.round(100 * (b / a - 1)); return c === 0 ? 'about the same' : `${c < 0 ? 'down' : 'up'} ${Math.abs(c)}%`; }
      const d = b - a; return d === 0 ? 'same' : `${Math.abs(d)} ${d < 0 ? 'fewer' : 'more'}`;
    };
    const fixedBy = x => x.g === 'then' || x.g === 'between';
    const showAll = {};
    const more = (key, arr, n, render) => {
      const shown = showAll[key] ? arr : arr.slice(0, n);
      return shown.map(render).join('') + (arr.length > n
        ? `<li class="pg-more"><button type="button" class="linkbtn" data-more="${key}" aria-expanded="${!!showAll[key]}">${showAll[key] ? 'Show fewer' : `Show all ${arr.length}`}</button></li>` : '');
    };
    const csv = (name, rows) => {
      const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const url = URL.createObjectURL(new Blob([rows.map(r => r.map(q).join(',')).join('\n')], { type: 'text/csv' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const linkBtn = h => `<button type="button" class="linkbtn pg-link" data-link="${h}">Copy link to this</button>`;
    const tableWrap = (label, html) => `<div class="tablewrap" tabindex="0" role="region" aria-label="${esc(label)}">${html}</div>`;

    // ---- 1. the worst places of a past year, now
    const years = P.years;
    let pick = years.some(y => y.yr === 2018) ? 2018 : (years[0] || {}).yr, onlyNone = false;
    function thenPart() {
      const Y = years.find(y => y.yr === pick);
      if (!Y) return '';
      const L = Y.places, then = span(Y.d0, Y.d1);
      const groups = [
        { key: 'fixed', label: `Got a fix before ${y0(C.d0)}`, a: L.filter(fixedBy) },
        { key: 'during', label: `First fix during ${cmpSpan}`, a: L.filter(x => x.g === 'during') },
        { key: 'none', label: `No fix by ${cmpEnd + 1} in SDOT's published data`, a: L.filter(x => x.g === 'none') }
      ];
      const sum = (a, k) => a.reduce((s, x) => s + (x[k] || 0), 0);
      const still = L.filter(x => x.now && x.now <= 50).length;
      const G = Object.fromEntries(groups.map(g => [g.key, g]));
      const row = (label, n, a, b, cls = '') => `<tr class="${cls}"><th scope="row">${label}</th><td>${n}</td><td>${fmt(a)}</td><td>${fmt(b)}</td><td class="nowrap">${change(a, b)}</td></tr>`;
      const shown = onlyNone ? G.none.a : L;
      const fixCell = x => (x.fx || []).length
        ? x.fx.map(f => `<span class="${f.y > cmpEnd ? 'muted' : ''}">${esc(f.k)} (${f.y}${f.y > cmpEnd ? ', after these years' : ''})</span>`).join('<br>')
        : '<span aria-label="none">—</span>';
      const sentence = () => {
        const f = G.fixed, n = G.none;
        const part = g => `${g.a.length === 1 ? 'the 1 place' : `the ${g.a.length} places`} ${g === f ? `fixed before ${y0(C.d0)}` : `with no fix before ${cmpEnd + 1}${(s => s ? ` (${s} of them run by WSDOT)` : '')(g.a.filter(x => x.state).length)}`}
          had ${fmt(sum(g.a, 'ksi'))} crashes where someone was killed or seriously hurt in ${then} and ${fmt(sum(g.a, 'ksi_cmp'))} in ${cmpSpan}`;
        // The fixes counted are mostly intersection treatments, so the groups also differ in kind of place: said from the data.
        const st = g => g.a.filter(x => x.t !== 'I').length, stAll = st(f) + st(G.during) + st(n);
        const kinds = stAll && st(n) > st(f) + st(G.during)
          ? ` Of the ${stAll} stretches of street in this list, ${st(n) === stAll ? 'all' : st(n)} are in “no fix”: the fixes counted here (${FIX_KINDS}) are mostly made at intersections, so these groups differ in the kind of place as well as in fixes, and this doesn't show what a fix does.` : '';
        return f.a.length && n.a.length ? `In short: ${part(f)}; ${part(n)}. Citywide, these crashes went ${change(Y.ksi_city, C.ksi_city)}.${kinds}` : '';
      };
      return `<section class="pg-sec" id="pg-then">
        <h3>Did the worst places get fixed?</h3>
        <label class="pg-pick">The 50 places that ranked worst in
          <select id="pgYear">${years.map(y => `<option value="${y.yr}" ${y.yr === pick ? 'selected' : ''}>${y.yr}</option>`).join('')}</select></label>
        <p class="lead">Ranked on crashes from ${then}, by how likely each place was to keep hurting people (all crashes count, not
          only the worst ones). Compared here with ${cmpSpan}, the most recent full years with complete reports.</p>
        <div class="stat-grid pg-stats">
          <div class="stat"><b>${G.fixed.a.length}</b><span>got a fix before ${y0(C.d0)}</span></div>
          <div class="stat"><b>${G.during.a.length}</b><span>got their first fix in ${cmpSpan}</span></div>
          <div class="stat"><b>${G.none.a.length}</b><span>had no fix before ${cmpEnd + 1} in SDOT's published data</span></div>
          <div class="stat"><b>${still}</b><span>are in today's top 50 (ranked on crashes alone, without repair reports)</span></div>
        </div>
        ${(() => {
          const isI = x => x.t === 'I', all = [...G.fixed.a, ...G.during.a, ...G.none.a];
          const by = k => { const f = x => k === 'I' ? isI(x) : !isI(x);
            return { n: all.filter(f).length, fixed: [...G.fixed.a, ...G.during.a].filter(f).length, none: G.none.a.filter(f).length }; };
          const I = by('I'), S = by('S');
          return `<p class="pg-kinds"><b>Intersections:</b> ${I.fixed} of ${I.n} got a fix, ${I.none} with none recorded.
            <b>Stretches:</b> ${S.fixed} of ${S.n} got one, ${S.none} with none recorded${S.n && S.none > S.n / 2
              ? `; the fix types counted here (${FIX_KINDS}) are mostly intersection work` : ''}.</p>`;
        })()}
        <p class="pg-short">${sentence()}</p>
        ${tableWrap(`Crashes where someone was killed or seriously hurt, ${then} and ${cmpSpan}`, `<table class="pg-table">
          <caption class="sr-only">Crashes where someone was killed or seriously hurt at the worst 50 places of ${pick}, by when they were fixed</caption>
          <tr><th scope="col"><span class="sr-only">Group</span></th><th scope="col">Places</th><th scope="col">${then}</th><th scope="col">${cmpSpan}</th><th scope="col">Change</th></tr>
          ${groups.filter(g => g.a.length).map(g => row(g.label, g.a.length, sum(g.a, 'ksi'), sum(g.a, 'ksi_cmp'))).join('')}
          ${Y.ref && Y.ref.n ? row(`For comparison: places ranked 51–150 in ${pick}`, Y.ref.n, Y.ref.ksi, Y.ref.ksi_cmp, 'ref') : ''}
          ${row('Citywide', '', Y.ksi_city, C.ksi_city, 'total')}
        </table>`)}
        <p class="note">Counts are crashes where someone was killed or seriously hurt (not people), at places with a known location.
          Places at the top of a list usually have fewer crashes later even with no changes, so compare the groups with each other
          and with the places ranked 51–150, not with their own past. Small numbers can swing a lot. Citywide, these crashes went
          ${change(Y.ksi_city, C.ksi_city)} while all crashes went ${change(Y.crashes_city, C.crashes_city)}; SDOT's data doesn't say
          how much of that is a real rise and how much is a change in how injuries are recorded.</p>
        <div class="pg-tools">
          <label class="tag"><input type="checkbox" id="pgNone" ${onlyNone ? 'checked' : ''}>Only places with no fix before ${cmpEnd + 1}</label>
          <button type="button" class="linkbtn" id="pgCsv">Download this list (CSV)</button> · ${linkBtn('progress=' + pick)}
        </div>
        ${tableWrap(`The worst 50 places of ${pick}`, `<table class="pg-table pg-places">
          <caption class="sr-only">The 50 places ranked worst in ${pick}, their fixes since, and how they're doing now</caption>
          <tr><th scope="col">Rank in ${pick}</th><th scope="col">Place</th><th scope="col">All crashes ${then}</th>
            <th scope="col">Killed or seriously hurt<br><span class="muted">${then} → ${cmpSpan}</span></th>
            <th scope="col">Fixes since ${y0(Y.d0)}</th><th scope="col">Rank today (crashes alone)</th></tr>
          ${more('places', shown, 10, x => `<tr><td>${rankTxt(x.r)}</td><th scope="row">${placeBtn(x.loc)}${x.d ? `<br><small class="muted">District ${x.d}</small>` : ''}${x.state
              ? `<br><small class="pg-state">${esc(x.state)}: run by WSDOT</small>` : ''}</th>
            <td>${x.c}</td><td>${x.ksi} → ${x.ksi_cmp}</td><td>${fixCell(x)}</td>
            <td>${x.now ? rankTxt(x.now) : '<span class="muted">no crashes</span>'}</td></tr>`).replace(/<li class="pg-more">([\s\S]*?)<\/li>/, '<tr class="pg-more"><td colspan="6">$1</td></tr>')}
        </table>`)}
        <p class="note">"Fix" means something SDOT publishes with a date: head-start walk signals (the walk light turns on a few seconds
          before the green), no turn on red, protected left-turn arrows, new traffic signals, traffic circles, protected bike lanes, and finished new
          sidewalk and neighborhood safety projects. "—": none of these in SDOT's published data. Repaving, signal timing, signs, paint,
          speed humps (no install dates) and bus lanes aren't counted, so a place can have had work that doesn't show here.${staleFixDates()}</p>
      </section>`;
    }

    // ---- 2. since last month
    function monthPart() {
      const ins = M.moves.filter(m => m.in50 === 'in'), outs = M.moves.filter(m => m.in50 === 'out');
      const dk = m => m.was - m.now;
      const up = M.moves.filter(m => !m.in50 && m.was && dk(m) >= 5), down = M.moves.filter(m => !m.in50 && m.was && -dk(m) >= 5);
      const arrow = m => !m.was ? 'new' : dk(m) > 0 ? `▲${dk(m)}` : `▼${-dk(m)}`;
      const row = m => `<li><span class="pg-l1"><span class="pg-rk">${rankTxt(m.now)}</span> ${placeBtn(m.loc)}</span>
        <span class="pg-l2">${m.was ? `${arrow(m)}: was ${rankTxt(m.was, false)} a month ago` : 'not ranked a month ago'}</span></li>`;
      const group = (title, arr, empty) => `<div class="pg-group"><h4>${title}</h4>${arr.length
        ? `<ul class="pg-list">${arr.map(row).join('')}</ul>` : `<p class="note">${empty}</p>`}</div>`;
      const T = M.recent_ksi_total || {};
      const rkTxt = r => r.rank && r.rank <= 500 ? ` · ranked ${rankTxt(r.rank)}` : '';
      return `<section class="pg-sec" id="pg-month">
        <h3>Since last month</h3>
        <p class="lead">The ranking now covers crashes through <b>${throughMonth(M.d_now)}</b>. A month ago it went through
          ${throughMonth(M.d_before)}: each month the newest month of crash reports is added and the oldest drops off.</p>
        <div class="pg-grid">
          ${group('New in the top 50', ins, 'No changes.')}
          ${group('Left the top 50', outs, 'No changes.')}
          ${group('Moved up 5 or more places', up, 'None.')}
          ${group('Moved down 5 or more places', down, 'None.')}
        </div>
        <h4>Newest crash reports, not in the ranking yet</h4>
        <p>From ${monthYear(T.from)} to ${monthYear(T.to)}, police reports so far list <b>${plural(T.f || 0, 'crash', 'crashes')}
          where someone died</b> and <b>${plural(T.s || 0, 'crash', 'crashes')} where someone was seriously hurt</b>, at
          ${plural(M.recent_ksi.length, 'place', 'places')}. Reports arrive months late, so these join the ranking later.</p>
        <ul class="pg-list">${more('recent', M.recent_ksi, 8, r => `<li><span class="pg-l1">${placeBtn(r.loc)}</span><span class="pg-l2">${[
            r.f ? plural(r.f, 'crash where someone died', 'crashes where someone died') : '',
            r.s ? plural(r.s, 'crash where someone was seriously hurt', 'crashes where someone was seriously hurt') : ''].filter(Boolean).join(', ')}${rkTxt(r)}</span></li>`)}</ul>
        <h4>Fixes SDOT recorded in the last 12 months</h4>
        ${M.recent_fixes.length ? `<p class="note">${plural(M.recent_fixes.length, 'dated fix', 'dated fixes')} at places with crashes, newest first.</p>
          <ul class="pg-list">${more('fixes', M.recent_fixes, 8, f => `<li><span class="pg-l1">${placeBtn(f.loc)}</span><span class="pg-l2">${esc(f.k)}, ${fixDate(f.d)}${rkTxt(f)}</span></li>`)}</ul>`
          : `<p class="note">None in SDOT's published data.</p>`}
      </section>`;
    }

    // ---- 3. where serious crashes are vs where SDOT's published work is
    let dim = 'district', open = null, openFromList = null;
    const RSE_ORDER = ['Highest Equity Priority', 'Second Highest', 'Middle', 'Second Lowest', 'Lowest', 'none'];
    const member = g => { const c = (CTX.council || []).find(x => String(x.d) === g); return c && c.member ? esc(c.member) : ''; };
    const gName = (g, short) => g === 'none' ? (dim === 'district' ? 'No district (city-limit streets)' : 'No tract (city-limit streets)')
      : dim === 'district' ? `District ${g}` : g === 'Highest Equity Priority' ? 'Highest priority' : g;
    function needPart() {
      const rows = P.need.filter(r => r.dim === dim);
      rows.sort(dim === 'rse' ? (a, b) => RSE_ORDER.indexOf(a.g) - RSE_ORDER.indexOf(b.g)
                              : (a, b) => (a.g === 'none') - (b.g === 'none') || +a.g - +b.g);
      const tot = k => rows.reduce((s, r) => s + (r[k] || 0), 0);
      const T = { ksi: tot('ksi'), lpi: tot('lpi'), other: tot('other'), proj: tot('proj_planned') };
      const pc = (v, t) => (t ? Math.round(100 * v / t) : 0) + `% <small class="pg-n">(${fmt(v || 0)})</small>`;   // share, with the count
      const sel = rows.find(r => r.g === open);
      const status = x => { const q = D.priorities.find(r => r.location === x.loc); return esc((q ? workSummary(q).text
        : x.fixed ? 'Work since ' + P.since_d : x.planned ? 'Planned or budgeted' : 'No dated work since ' + P.since_d + ' or planned project in the layers this site reads')
        + (x.state ? `. ${x.state}: run by WSDOT` : '')
        + (x.line ? `. On the line with District ${x.line} (the boundary runs down the street; counted here)` : '')
        + (x.k === 0 ? '. No one killed or seriously hurt here in these years: ranked on its other crashes' : '')); };
      const openList = () => `<div class="pg-open" id="pgOpen"><h4>${esc(gName(sel.g))}: places in the citywide top 50 ${dim === 'district' ? linkBtn('progress=d' + sel.g) : ''}</h4>
          ${(sel.list || []).length ? `<ul class="pg-list">${sel.list.map(x => `<li><span class="pg-l1"><span class="pg-rk">${rankTxt(x.r)}<small> citywide</small></span> ${placeBtn(x.loc)}</span>
            <span class="pg-l2">${x.k ? `<b>${plural(x.k, 'crash', 'crashes')} that killed or seriously hurt someone.</b> ` : ''}${status(x)}</span></li>`).join('')}</ul>` : '<p class="note">None of today\'s top 50 are here.</p>'}</div>`;
      // On a phone the wide table needs sideways scrolling, so each group is a card instead: a bar for each share (all on
      // one scale, so a district's share of serious crashes can be set against its share of fixes), then its top-50 counts.
      const cards = () => {
        const share = (v, t) => (t ? 100 * (v || 0) / t : 0);
        const max = Math.max(1, ...rows.flatMap(r => [share(r.ksi, T.ksi), share(r.lpi, T.lpi), share(r.other, T.other), share(r.proj_planned, T.proj)]));
        const bar = (label, v, t, cls) => `<div class="pg-bar"><span class="pg-bar-l">${label}</span>
            <span class="pg-bar-t" aria-hidden="true"><span class="pg-bar-f ${cls}" style="width:${(100 * share(v, t) / max).toFixed(1)}%"></span></span>
            <span class="pg-bar-v">${pc(v, t)}</span></div>`;
        return `<ul class="pg-cards">${rows.map(r => `<li class="pg-card${r.g === open ? ' on' : ''}">
            <button type="button" class="pg-grp pg-card-h" data-grp="${esc(r.g)}" aria-expanded="${r.g === open}">
              <span class="pg-card-n">${esc(gName(r.g))}</span>${dim === 'district' && member(r.g) ? `<small class="muted">${member(r.g)}</small>` : ''}
              <span class="pg-card-go">${r.g === open ? 'Hide places' : 'Show places'}</span></button>
            ${bar('Crashes that killed or seriously hurt someone', r.ksi, T.ksi, 'k')}
            ${bar('Head-start walk signals', r.lpi, T.lpi, 'w')}
            ${bar('Other fixes', r.other, T.other, 'w')}
            ${bar('Planned sidewalks, walk signals, no turn on red and safety projects', r.proj_planned, T.proj, 'w')}
            <p class="pg-card-foot">Citywide top 50: <b>${r.top50}</b>${r.top50 ? ` · run by WSDOT: ${r.top50_state || 0} · no work since ${esc(P.since_d)} or planned<a href="#pgNoneNote" class="fn" aria-label="About this count">*</a>: ${r.top50_nothing}${r.top50_ends ? ` (${r.top50_ends} with work only at the corners at their ends)` : ''}` : ''}</p>
            ${r.g === open ? openList() : ''}</li>`).join('')}</ul>`;
      };
      const narrow = isNarrow();
      return `<section class="pg-sec" id="pg-need">
        <h3>Where serious crashes happen, and where SDOT's work is</h3>
        <div class="pg-dim" role="group" aria-label="Group by">
          <button type="button" class="seg-btn ${dim === 'district' ? 'on' : ''}" data-dim="district" aria-pressed="${dim === 'district'}">By council district</button>
          <button type="button" class="seg-btn ${dim === 'rse' ? 'on' : ''}" data-dim="rse" aria-pressed="${dim === 'rse'}">By the City's equity index</button>
        </div>
        <p class="note">Each ${narrow ? 'bar' : 'column'} is that group's share of the city total. ${dim === 'rse' ? `The City's Race and Social Equity Index sorts
          census tracts into five levels; "highest priority" is where the City says investment is needed most. ` : ''}Pick a ${dim === 'district' ? 'district' : 'group'} to list its top-50 places.</p>
        ${narrow ? cards() : tableWrap(dim === 'district' ? 'By council district' : 'By equity index', `<table class="pg-table pg-need">
          <caption class="sr-only">Share of crashes where someone was killed or seriously hurt, fixes and planned projects, ${dim === 'district' ? 'by council district' : 'by equity index'}</caption>
          <tr><th scope="col"><span class="sr-only">${dim === 'district' ? 'District' : 'Equity level'}</span></th><th scope="col">Crashes that killed or seriously hurt someone</th>
            <th scope="col">Head-start walk signals</th><th scope="col">Other fixes</th><th scope="col">Planned sidewalks, walk signals, no turn on red and neighborhood safety projects</th>
            <th scope="col">Places in the citywide top 50</th><th scope="col">…run by WSDOT</th><th scope="col">…no work since ${esc(P.since_d)} or planned<a href="#pgNoneNote" class="fn" aria-label="About this count">*</a></th></tr>
          ${rows.map(r => `<tr class="${r.g === open ? 'on' : ''}"><th scope="row"><button type="button" class="linkbtn pg-grp" data-grp="${esc(r.g)}" aria-expanded="${r.g === open}">${esc(gName(r.g))}</button>${dim === 'district' && member(r.g) ? `<br><small class="muted">${member(r.g)}</small>` : ''}</th>
            <td>${pc(r.ksi, T.ksi)}</td><td>${pc(r.lpi, T.lpi)}</td><td>${pc(r.other, T.other)}</td><td>${pc(r.proj_planned, T.proj)}</td>
            <td>${r.top50}</td><td>${r.top50_state || 0}</td><td>${r.top50_nothing}${r.top50_ends ? ` <small class="pg-n">(${r.top50_ends} at corners only)</small>` : ''}</td></tr>`).join('')}
        </table>`)}
        ${sel && !narrow ? openList() : ''}
        <p class="note" id="pgNoneNote">* No work since ${P.since_d} or planned: no dated safety fix or bus lane since ${P.since_d}, when these crash counts start (older work isn't counted, though each place's page shows it; for a stretch of street, a fix at the corners at its ends isn't counted, since it doesn't reach crashes along the block, but the count of those is given), no planned SDOT project, head-start walk signal or no turn on red nearby, and no budget project named for the street, in the layers this site reads (the same test as each place's own page). Places WSDOT runs (freeways, ramps, state bridges) are counted in their own column; state highways on city streets, which the City runs, count as city streets. The fix types counted (${FIX_KINDS}) are mostly intersection work, so stretches of street rarely have one.</p>
        <p class="note">Crashes: ${monthYear(P.window.d0)}–${throughMonth(P.window.d1)}. Fixes: dated fixes since January ${P.since} at places with
          crashes, counted once per place they reach (one long bike lane can reach many places); head-start walk signals are shown on their own because SDOT has added hundreds of them${(() => {
            const d = P.need.filter(r => r.dim === 'district'), t = d.reduce((s, r) => s + (r.lpi || 0), 0), top = d.slice().sort((a, b) => b.lpi - a.lpi)[0];
            return t && top ? `, ${Math.round(100 * top.lpi / t)}% of them in District ${esc(top.g)}` : ''; })()}.
          Planned: SDOT's published project maps (new sidewalks, neighborhood safety projects, planned head-start walk signals) and planned no turn on red signs. Large corridor
          and capital projects aren't in these maps, so this column is not a measure of money or investment by district.
          The City's budget data doesn't say where money is spent, so this counts fixes and projects, not dollars, and a large project
          counts the same as a small one.</p>
      </section>`;
    }

    // ---- 4. is it working? each kind of fix, the crashes it targets before and after, next to the city's change
    function workingPart() {
      const W = P.working; if (!W || !(W.kinds || []).length) return '';
      const what = { ped: 'crashes involving someone walking', turnped: 'people walking hit by turning drivers', bike: 'crashes involving someone on a bike', left: 'left-turn crashes', all: 'crashes of any kind' };
      const pc = (b, a) => b ? Math.round(100 * (a / b - 1)) : null;
      const chg = c => c == null ? '' : c === 0 ? 'no change' : `${c < 0 ? 'down' : 'up'} ${Math.abs(c)}%`;
      const kindRow = w => {
        const here = pc(w.b, w.a), city = pc(w.cb, w.ca), early = w.e_n >= 10 && w.eb > 0;
        // Could chance alone give a gap this size against the city? (rate ratio, Poisson counts; the city's are large)
        const chance = (b, a, cb, ca) => !(a > 0 && b > 0 && cb > 0 && ca > 0) || Math.abs(Math.log((a / b) / (ca / cb))) < 1.96 * Math.sqrt(1 / a + 1 / b);
        const ch = early ? chance(w.eb, w.ea, w.ecb, w.eca) : chance(w.b, w.a, w.cb, w.ca);
        // One plain result, by the rule in the lead. A kind from only a few projects (e.g. bus lanes: most of the places on
        // one corridor) can't be judged: neighbouring blocks of one project aren't independent, so no verdict or chance test.
        const rr = (b, a, cb, ca) => (b > 0 && cb > 0 && ca > 0) ? (a / b) / (ca / cb) : null;
        const vs = [rr(w.b, w.a, w.cb, w.ca), early ? rr(w.eb, w.ea, w.ecb, w.eca) : null].filter(x => x != null);
        const few = w.n_dates && w.n_dates < 5;
        // the chance test treats each place as separate, but blocks done in one project rise and fall together: with fewer
        // than 30 separate install dates, no claim either way about chance
        const clustered = w.n_dates && w.n_dates < 30;
        const how = (x, both) => clustered ? `${x}${both}; with only ${w.n_dates} separate install dates, chance can't be ruled out` : null;
        const result = few ? `only ${plural(w.n_dates, 'project date')}, so this mostly shows one or two projects; too few to tell`
          : !vs.length ? ''
          : vs.every(x => x < 1) ? how('fewer than the city', vs.length > 1 ? ' both ways' : '') || (ch ? `fewer than the city${vs.length > 1 ? ' both ways' : ''}, but the gap is small enough to be chance`
                                       : `fewer than the city${vs.length > 1 ? ' both ways' : ''}, by more than chance: it looks like it helped`)
          : vs.every(x => x >= 1) ? how('no better than the city', vs.length > 1 ? ' either way' : '') || (ch ? `no better than the city${vs.length > 1 ? ' either way' : ''}, but the gap could be chance`
                                        : `worse than the city${vs.length > 1 ? ' both ways' : ''}, by more than chance`)
          : 'mixed: better than the city one way, not the other';
        return `<li><span class="pg-l1"><b>${esc(w.k)}</b> · ${plural(w.n_places || w.n, 'place')}${w.n_dates && w.n_dates < 20 ? `, ${plural(w.n_dates, 'install date')}` : ''}</span>
          <span class="pg-l2">${clustered && result ? `<b>Result:</b> ${result}.<br>` : ''}${(what[w.m] || 'targeted crashes').replace(/^./, c => c.toUpperCase())}: ${fmt(w.b)} before, ${fmt(w.a)} after${clustered ? '' : ` (${chg(here)}). Citywide over the same days: ${chg(city)}`}.
          ${early ? `<br><span class="pg-yard">Against an earlier period of the same length${w.e_n < w.n ? ` (the ${fmt(w.e_n)} with crash data back that far)` : ''}:
            ${fmt(w.eb)} then, ${fmt(w.ea)} after${clustered ? '' : ` (${chg(pc(w.eb, w.ea))}); citywide ${chg(pc(w.ecb, w.eca))}`}.</span>` : ''}
          ${result && !clustered ? `<br><b>Result:</b> ${result}.` : ''}
          ${w.k === 'Bus lane' ? ` <i>Bus lanes are transit projects, not aimed at one kind of crash, so all crashes are counted.</i>` : ''}
          ${w.k === 'Protected bike lane' ? ` <i>A bike lane can bring more people biking, so more bike crashes can come with more riders; nothing here counts riders.</i>` : ''}
          ${w.n_all > w.n ? `<br><span class="muted">Not counted: ${fmt(w.n_all - w.n)} more where another dated fix went in at the same place over these years.</span>` : ''}</span></li>`;
      };
      const thin = new Set(W.kinds.filter(w => w.n_dates && w.n_dates < 30).map(w => w.k));
      const byK = {}; (W.places || []).filter(x => !thin.has(x.k)).forEach(x => (byK[x.k] = byK[x.k] || []).push(x));
      const placeRow = x => `<li><span class="pg-l1">${x.rank ? `<span class="pg-rk">${rankTxt(x.rank)}</span> ` : ''}${placeBtn(x.loc)}</span>
        <span class="pg-l2">${esc(x.k.toLowerCase())} ${fixDate(x.d, x.yo)}: ${what[x.m] || 'targeted crashes'} ${fmt(x.b)} before, ${fmt(x.a)} after
        (${Math.round(x.days / 30.4)} months each)${x.pb != null ? `; ${fmt(x.pb)} in the ${Math.round(x.days / 30.4)} months before that` : ''}</span></li>`;
      return `<section class="pg-sec" id="pg-working">
        <h3>Is it working?</h3>
        <p class="lead">For each fix SDOT's records date, the crashes that fix is meant to reduce, counted for the same length of time
          before and after (one to three years each, skipping the first month after it went in, or the whole year when SDOT gives only the year, as for most bike lanes). Next to it, how the same kind of
          crash changed across the whole city over the same days. The "before" years can be high just because that got the place
          picked, so each fix is also set against an earlier period of the same length, before that. A fix looks like it helped when
          its places did better than the city both ways, by more than chance. Places where another dated fix went in over these years
          are left out, since the two can't be told apart.</p>
        <ul class="pg-list pg-working">${W.kinds.filter(w => w.n && (w.b || w.a)).map(kindRow).join('')}</ul>
        <p class="note">${(() => { const h = W.kinds.reduce((s, w) => s + (w.p_had || 0), 0), f = W.kinds.reduce((s, w) => s + (w.p_fewer || 0), 0);
            return h ? `Crash counts at one place go up and down a lot on their own: of the ${fmt(h)} fixes whose place had any of these
            crashes in the earlier period, ${fmt(f)} (${Math.round(100 * f / h)}%) had fewer in the next equal period, before the fix went in.
            So whether one place went down after a fix says little; the totals, next to the city, say more. ` : ''; })()}Fixes
          tend to go where crashes have been high, and places like that often see fewer crashes afterwards anyway,
          so a drop here doesn't prove a fix worked, and a few crashes either way can be chance. All crashes in police reports count here, not only the worst ones.</p>
        ${Object.keys(byK).length ? `<h4>Increases to look into (small numbers, often chance): places where the targeted crashes didn't go down</h4>
          <p class="note">At least 2 before and 2 after the fix, and no fewer after, with two years or more on each side and no other dated fix there over these years (bus lanes aren't listed). Listed for each kind of fix, biggest increase first. Crashes on short
            blocks can be recorded on the block next door, so check neighbouring blocks too.</p>
          ${Object.entries(byK).map(([k, arr]) => `<div class="pg-group"><h4>${esc(k)}</h4>
            <ul class="pg-list">${more('w-' + k, arr, 5, placeRow)}</ul></div>`).join('')}` : ''}
      </section>`;
    }

    function draw(focusSel) {
      const asOf = D.fetchedAt ? new Date(D.fetchedAt.replace(' ', 'T')) : null;
      el.innerHTML = `<p class="note">${asOf && !isNaN(asOf) ? `Data as of <b>${asOf.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</b>. ` : ''}Worked
        out from SDOT's crash reports since 2013 and SDOT's published records of what it built, recalculated every week. Pick a place to see it on the map.</p>`
        + `<nav class="pg-jump" aria-label="Sections"><span>Jump to:</span> <button type="button" class="linkbtn" data-jump="pg-need">Districts</button>
            <button type="button" class="linkbtn" data-jump="pg-month">Since last month</button> <button type="button" class="linkbtn" data-jump="pg-working">Is it working?</button></nav>`
        + thenPart() + monthPart() + needPart() + workingPart();
      el.querySelectorAll('[data-jump]').forEach(b => (b.onclick = () => { const t = el.querySelector('#' + b.dataset.jump);
        scrollSheetTo(t); const h = t && t.querySelector('h3'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } }));
      const y = el.querySelector('#pgYear');
      if (y) y.onchange = () => { pick = +y.value; showAll.places = false; draw('#pgYear'); announceThen(); };
      const n = el.querySelector('#pgNone');
      if (n) n.onchange = () => { onlyNone = n.checked; draw('#pgNone'); announceThen(); };
      el.querySelectorAll('[data-dim]').forEach(b => (b.onclick = () => { dim = b.dataset.dim; open = null; draw(`[data-dim="${dim}"]`); }));
      el.querySelectorAll('.pg-grp').forEach(b => (b.onclick = () => { open = open === b.dataset.grp ? null : b.dataset.grp; draw(`.pg-grp[data-grp="${CSS.escape(b.dataset.grp)}"]`);
        if (open) say(`${gName(open)}: ${(P.need.find(r => r.dim === dim && r.g === open).list || []).length} top-50 places listed below.`); }));
      el.querySelectorAll('[data-more]').forEach(b => (b.onclick = () => { showAll[b.dataset.more] = !showAll[b.dataset.more]; draw(`[data-more="${b.dataset.more}"]`); }));
      el.querySelectorAll('.pg-link').forEach(b => (b.onclick = () => {
        const url = location.href.split('#')[0] + '#' + b.dataset.link;
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Link copied'), () => prompt('Copy this link:', url));
      }));
      const c = el.querySelector('#pgCsv');
      if (c) c.onclick = () => {
        const Y = years.find(v => v.yr === pick), then = span(Y.d0, Y.d1);
        const asOf = D.fetchedAt ? D.fetchedAt.slice(0, 10) : '';
        csv(`seattle-worst-50-${pick}.csv`, [[`Streets First (Seattle), from SDOT's police-reported crash data and SDOT's published records; data as of ${asOf}`],
          [`Ranked on crashes from ${then}; compared with ${cmpSpan}. Intersections and stretches are ranked together in one list.`],
          [`Rank in ${pick} (crashes only)`, 'Type', 'Place', 'Council district', `All crashes ${then}`, `Killed or seriously hurt crashes ${then}`,
          `Killed or seriously hurt crashes ${cmpSpan}`, 'Fix group', 'Fixes (year)', 'Rank today (crashes only)', 'Run by WSDOT', 'Link'],
          ...Y.places.map(x => [x.r, typeWord(x.t), niceName(x.loc), x.d || '', x.c, x.ksi, x.ksi_cmp,
            fixedBy(x) ? `Fixed before ${y0(C.d0)}` : x.g === 'none' ? `No fix before ${cmpEnd + 1} in SDOT's published data` : `First fix in ${cmpSpan}`,
            (x.fx || []).map(f => `${f.k} (${f.y}${f.y > cmpEnd ? ', after the comparison years' : ''})`).join('; '),
            x.now || '', x.state || '', location.origin + location.pathname + '#p=' + keyOf(x.loc)])]);
      };
      if (focusSel) { const f = el.querySelector(focusSel); if (f) f.focus(); }
    }
    function announceThen() {
      const Y = years.find(v => v.yr === pick); if (!Y) return;
      const L = onlyNone ? Y.places.filter(x => x.g === 'none') : Y.places;
      say(`${pick}: ${Y.places.filter(fixedBy).length} of 50 got a fix before ${y0(C.d0)}. Showing ${L.length} places.`);
    }
    draw();
    matchMedia('(max-width: 760px)').addEventListener('change', () => {
      const a = document.activeElement, ds = (a && el.contains(a) && a.dataset) || {};
      draw(ds.grp ? `.pg-grp[data-grp="${CSS.escape(ds.grp)}"]` : ds.dim ? `[data-dim="${ds.dim}"]` : null);
      scrollSheetTo(el.querySelector(isNarrow() ? '.pg-card.on' : '.pg-need tr.on'));
    });
    // Opening the tab with a district picked on the list shows that district's row open (once per pick, so closing it sticks).
    progressSync = () => {
      const d = String(+document.getElementById('distFilter').value || '');
      if (d && d !== openFromList && P.need.some(r => r.dim === 'district' && r.g === d)) { openFromList = d; dim = 'district'; open = d; draw(); }
      if (!d) openFromList = null;
    };
    // #progress, #progress=2018, #progress=d2
    progressLink = h => {
      const m = h.match(/^#progress(?:=(?:(\d{4})|d(\d+)))?$/);
      if (!m) return false;
      if (m[1] && years.some(y => y.yr === +m[1])) pick = +m[1];
      if (m[2]) { dim = 'district'; open = m[2]; }
      openFromList = String(+document.getElementById('distFilter').value || '') || null;   // so progressSync leaves the link's choice alone
      draw();
      showTab(document.getElementById('tabbtn-progress'));
      const card = m[2] && isNarrow() ? el.querySelector('.pg-card.on') : null;
      const target = card || (m[2] ? el.querySelector('#pg-need') : m[1] ? el.querySelector('#pg-then') : null);
      if (card) setTimeout(() => { const h = card.querySelector('.pg-card-h'); if (h) h.focus({ preventScroll: true }); }, 450);
      // Scroll the sheet only (scrollIntoView would also scroll the page and push the header off screen).
      if (target) setTimeout(() => scrollSheetTo(target), 400);
      return true;
    };
  }

  (function staleNotice() {
    const fetched = D.fetchedAt && new Date(D.fetchedAt.replace(' ', 'T'));
    if (!fetched || isNaN(fetched)) return;
    const days = Math.floor((Date.now() - fetched) / 864e5);
    if (days < 14) return;
    const age = days < 60 ? `${days} days` : `${Math.round(days / 30.4)} months`;
    const el = document.createElement('p');
    el.className = 'stale'; el.setAttribute('role', 'status');
    el.innerHTML = `<b>Data last updated ${fetched.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</b> (${age} ago).
      Newer crashes, repair reports and SDOT fixes aren't included yet.`;
    document.getElementById('tab-priorities').prepend(el);
  })();

  // Citywide summary at the top of the list: what's at stake, in people. Numbers count up once on load.
  (function citySummary() {
    const el = document.getElementById('citySummary'); if (!el || meta.city_killed == null) return;
    const ksiAll = meta.city_ksi_crashes + (meta.city_ksi_unlocated || 0);
    const oneIn = Math.round(ksiAll / meta.top50_ksi);
    const pbShare = meta.city_ped_bike_ksi ? Math.round(100 * meta.city_ped_bike_ksi / meta.city_ksi_crashes) : null;
    el.innerHTML = `
      <div class="cs-head">Seattle city streets, ${monthYear(meta.window_from)} – ${monthYear(meta.window_to)}</div>
      <div class="cs-nums">
        <div><b data-n="${meta.city_killed}">${fmt(meta.city_killed)}</b><span>people killed</span></div>
        <div><b data-n="${meta.city_serious}">${fmt(meta.city_serious)}</b><span>seriously injured</span></div>
      </div>
      <div class="cs-foot"><b class="cs-hi">About 1 in ${oneIn}</b> of the crashes that killed or seriously hurt someone
        (${fmt(meta.top50_ksi)} of ${fmt(ksiAll)}) happened at just <b class="cs-hi">${meta.top50_intersections != null ? `${meta.top50_intersections} intersections and ${50 - meta.top50_intersections} stretches of street` : '50 places'}</b>${meta.top50_stretch_miles ? ` (the stretches add up to about ${meta.top50_stretch_miles} miles)` : ''}, out of
        ${fmt(meta.locations_scored)} places with crashes. Those are the top of the "Most likely to hurt people" ranking, picked using these same crashes.${pbShare ? `
        Of the ${fmt(meta.city_ksi_crashes)} with a known location, <b class="cs-hi">${pbShare}%</b> involved someone walking or biking.` : ''}</div>
      ${meta.forward_top50_ksi ? `<div class="cs-note">Predicting is harder: ranked on the first ${yrsBetween(meta.window_from, meta.test_from)} years, the top 50 had
        ${fmt(meta.forward_top50_ksi)} of the next ${yrsBetween(meta.test_from, meta.window_to)} years' ${fmt(meta.test_ksi_total)} fatal or serious crashes
        (${Math.round(100 * meta.forward_top50_ksi / meta.test_ksi_total)}%). From police reports in SDOT's data; freeways are mostly not in it.</div>` : ''}`;
    if (reduceMotion) return;
    el.querySelectorAll('b[data-n]').forEach(b => {
      const to = +b.dataset.n, pct = b.hasAttribute('data-pct'), t0 = performance.now(), dur = 1100;
      const step = t => { const k = Math.min(1, (t - t0) / dur), v = to * (1 - Math.pow(1 - k, 3));
        b.textContent = pct ? v.toFixed(1) + '%' : fmt(Math.round(v)); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
      setTimeout(() => (b.textContent = pct ? to.toFixed(1) + '%' : fmt(to)), dur + 300);   // always land on the true value
    });
  })();

  // With a district picked, a card for it in place of the city's: its share of the city's crashes that killed or seriously
  // hurt someone, its places in the citywide top 50, and its share of the City's recent fixes. Same numbers as the district
  // table on "Is it getting fixed?" (they arrive with data-late.js; until then the card waits).
  function distCard(dist) {
    const el = document.getElementById('distSummary'); if (!el) return;
    const P = D.progress, rows = P && P.need ? P.need.filter(r => r.dim === 'district') : [];
    const r = rows.find(x => x.g === String(dist));
    if (!dist || !r) { el.hidden = true; return; }
    const tot = k => rows.reduce((t, x) => t + (x[k] || 0), 0), pct = (a, b) => (b ? Math.round(100 * a / b) : 0);
    const c = (CTX.council || []).find(x => String(x.d) === r.g);
    el.innerHTML = `<div class="cs-head">District ${esc(r.g)}${c && c.member ? ' · Councilmember ' + esc(c.member) : ''} · ${windowTxt()}</div>
      <div class="cs-nums">
        <div><b>${fmt(r.ksi)}</b><span>crashes that killed or seriously hurt someone (${pct(r.ksi, tot('ksi'))}% of the city's)${r.killed != null ? `: ${plural(r.killed, 'person', 'people')} killed, ${fmt(r.hurt)} seriously injured` : ''}</span></div>
        <div><b>${fmt(r.top50)}</b><span>of the citywide top 50 places${r.top50_state ? `: ${r.top50_state} run by WSDOT, ${r.top50 - r.top50_state} on city streets` : ''}</span></div>
        ${r.top50 ? `<div><b>${fmt(r.top50_nothing)}</b><span>of the ${r.top50_state ? `${r.top50 - r.top50_state} on city streets` : 'citywide top 50 here'} with no counted safety fix since ${esc(P.since_d)} or planned work*${r.top50_ends ? ` (${r.top50_ends} with work only at the corners at their ends)` : ''}</span></div>` : ''}
      </div>
      <div class="cs-foot">Of the fixes SDOT dated since January ${esc(P.since)} at places with crashes, ${pct(r.lpi, tot('lpi'))}% of head-start walk signals and
        ${pct(r.other, tot('other'))}% of other fixes are in this district. *In the SDOT layers this site reads; planned work includes a budget line named for the street.
        ${D.fetchedAt ? `Data as of ${new Date(D.fetchedAt.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.` : ''} <a href="#progress=d${esc(r.g)}">Compare districts</a></div>`;
    el.hidden = false;
  }
  document.getElementById('listCsv').onclick = () => {
    const { rows, extra } = currentRows(), all = [...rows, ...extra];
    const dist = +document.getElementById('distFilter').value || 0, sel = id => document.getElementById(id);
    const what = [dist ? `District ${dist}` : 'All Seattle', sel('addrFilter').selectedOptions[0] && sel('addrFilter').value ? sel('addrFilter').selectedOptions[0].text : '',
      sel('onlyOngoing').checked ? 'only repeat serious crashes' : '',
      sel('noPlan').checked ? 'only with no published SDOT project' : ''].filter(Boolean).join(', ');
    const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [[`Streets First (Seattle), from SDOT's police-reported crash data and SDOT's published records; data as of ${(D.fetchedAt || '').slice(0, 10)}`],
      [`Crashes ${windowTxt()}. List: ${what}.`],
      ['Rank in this list', 'Citywide rank', 'Type', 'Place', 'Council district', 'Neighborhood', 'All crashes', 'Crashes that killed or seriously hurt someone',
       'People killed', 'People seriously injured', 'Run by WSDOT', 'SDOT work recorded or planned', 'Link'],
      ...all.map(p => [p.dr ?? (rows.includes(p) ? p.rank : ''), p.rank ?? '', p.addr_type === 'I' ? 'Intersection' : 'Stretch', p.name, p.council_district || '',
        p.area || '', p.crashes, p.ksi, p.killed, p.seriously_injured, p.state_route || '', workSummary(p).text,
        location.origin + location.pathname + '#p=' + keyOf(p.location)])];
    const url = URL.createObjectURL(new Blob([lines.map(r => r.map(q).join(',')).join('\n')], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `streets-first-seattle${dist ? '-district-' + dist : ''}.csv` });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  // A shared link's district (?d=2), when it's one of the choices.
  { const d = new URLSearchParams(location.search).get('d'), sel = document.getElementById('distFilter');
    if (d && [...sel.options].some(o => o.value === d)) sel.value = d;
    else if (d) { const u = new URLSearchParams(location.search); u.delete('d'); history.replaceState(null, '', location.pathname + (u.toString() ? '?' + u : '') + location.hash); } }
  render();

  // Shareable links: #p=<key> opens a place by a key made from its name, so the link keeps working when ranks change.
  // Older links (#loc=12, the spot ranked #12) still work. #progress... opens the "Is it getting fixed?" tab.
  // A link copied from a chat or article can carry trailing punctuation or extra bits: the key is read up to the first
  // character that can't be in one. The top places are in the first data file, so most links open before the rest loads.
  // A link that matches nothing (once everything has loaded) says so, and is taken out of the address.
  function linkNote(msg) {
    let n = document.getElementById('linkNote');
    if (!msg) { if (n) n.remove(); return; }
    if (!n) { n = document.createElement('div'); n.id = 'linkNote'; n.className = 'link-note'; n.setAttribute('role', 'status');
      document.getElementById('tab-priorities').prepend(n); }
    n.innerHTML = `<p>${msg} <button type="button" class="linkbtn">OK</button></p>`;
    n.querySelector('button').onclick = () => n.remove();
    say(n.textContent.replace(/ OK$/, ''));
  }
  function openFromHash() {
    const h = location.hash;
    if (progressLink(h)) return true;
    if (/^#budget/i.test(h)) { showTab(document.getElementById('tabbtn-spending')); return true; }
    if (/^#method/i.test(h)) { showTab(document.getElementById('tabbtn-about')); return true; }
    const k = h.match(/^#p=([a-z0-9]+)/i);
    if (k) {
      const key = k[1].toLowerCase();
      const p0 = D.priorities.find(q => keyOf(q.location) === key);
      if (p0) { select(p0, true, null); viewBefore = null; return true; }
      const s = keyIdx().get(key);
      if (!s) {
        if (lateOK) { linkNote('That link\'s place isn\'t in this week\'s data (crashes older than 5 years drop off, and SDOT sometimes renames places). Search for it below.');
          history.replaceState(null, '', location.pathname + location.search); }
        return false;
      }
      const p = byId.get(s.rank);
      if (p) select(p, true, null); else selectLite(s);
      viewBefore = null; return true;
    }
    const m = h.match(/^#(?:loc=)?(\d+)/);
    if (!m) {
      if (h && h !== '#selftest' && lateOK) { linkNote('That link didn\'t match anything on this site, so here is the overview.'); history.replaceState(null, '', location.pathname + location.search); }
      return false;
    }
    const id = +m[1];
    const old = () => linkNote(`This older link pointed at a rank, not a place: this is today's #${fmt(id)}. Ranks change every month.`);
    const p = byId.get(id);
    if (p) { select(p, true, null); viewBefore = null; old(); return true; }
    const s = searchIdx.find(x => x.rank === id);
    if (s) { selectLite(s); viewBefore = null; old(); return true; }
    if (lateOK) { linkNote(`That link pointed at #${fmt(id)}, which isn't in this week's list.`); history.replaceState(null, '', location.pathname + location.search); }
    return false;
  }
  // Back and Forward: open the place in the address, or close it when the address has none.
  // Back/Forward across a district change: the list follows the district in the address.
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href^="#progress"]');
    if (a && a.getAttribute('href') === location.hash) { e.preventDefault(); progressLink(location.hash); }
  });
  window.addEventListener('popstate', () => {
    const d = new URLSearchParams(location.search).get('d') || '', sel = document.getElementById('distFilter');
    if ([...sel.options].some(o => o.value === d) && sel.value !== d) { sel.value = d; render(); refreshHome(); }
  });
  window.addEventListener('hashchange', () => {
    if (skipHash) { skipHash = false; return; }
    if (!location.hash && spotOpen()) closeDetail(false);
    else if (!location.hash && openSheet() && lastTab) showTab(lastTab);   // Back from a sheet's link closes the sheet
    else openFromHash();
  });
  // ---------- desktop overview: the details panel never closes; with nothing picked it shows where to start ----------
  let homeFocus = null;   // the overview card a spot was opened from, to return focus to it
  function renderHome() {
    if (isNarrow()) { detailEl.hidden = true; detailEl.classList.remove('home', 'place'); return; }
    detailEl.classList.add('home'); detailEl.classList.remove('place'); detailEl.hidden = false;
    applyLayout();
    const titleEl = document.getElementById('detailTitle'), body = document.getElementById('detailBody');
    renderGraphs = () => {};
    const card = (it, i) => `<li><button type="button" class="home-card" data-home="${i}">
        <span class="hc-rank" style="background:${TIERS[it.t].color}"${it.title ? ` title="${esc(it.title)}"` : ''}>${it.rk}</span>
        <span class="hc-main"><span class="hc-name">${esc(it.name)}</span><span class="hc-sub">${esc(it.sub)}</span></span>
        <span class="hc-val">${it.val}</span></button></li>`;
    let items, title, lead, middle = '';
    if (!view) {
      const top = currentRows().rows, n = top.length;
      title = 'Crash hot spots';
      lead = 'Nothing picked yet. Click a dot on the map or a place in the list, or search an address, to see why it ranks.';
      items = top.slice(0, 3).map(p => ({
        rk: pRank(p, false), t: pTier(p), title: pRank(p), name: p.name, sub: [typeWord(p.addr_type).replace(/^./, c => c.toUpperCase()), p.area, plural(p.crashes, 'crash', 'crashes')].filter(Boolean).join(' · '),
        val: `<b>${(p.killed ?? 0) + (p.seriously_injured ?? 0)}</b>killed or seriously hurt`, open: () => select(p, true, null) }));
      if (!n) middle = '<p class="note">No spots match these filters. Turn a filter off to see more.</p>';
      const arterial = top.filter(p => /arterial/i.test(p.street_type || '')).length;
      const hin = top.filter(p => p.sdot_hin).length, died = top.filter(p => p.killed > 0).length;
      // A spot on the line between two areas ("Beacon Hill / Central Area") counts in both.
      const ac = {};
      top.forEach(p => (p.area || '').split(' / ').filter(Boolean).forEach(a => (ac[a] = (ac[a] || 0) + 1)));
      const areas = Object.entries(ac).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6);
      const max = areas.length ? areas[0][1] : 1;
      if (n) middle = `
        <section class="hsec hsec-common"><h3>What the top ${n} on this list have in common</h3>
          <div class="stat-grid home-stats">
            ${stat(`${arterial} of ${n}`, 'on main streets (arterials)')}
            ${stat(`${hin} of ${n}`, "on SDOT's High Injury Network")}
            ${stat(`${died} of ${n}`, 'where someone was killed')}
          </div>
          <div class="note">SDOT's High Injury Network is also drawn from crash history, so this mostly shows the two agree.
            Arterials are the main streets that carry most traffic.</div></section>
        <section class="hsec hsec-where"><h3>Where they are</h3>
          <div class="hbars" role="list">${areas.map(([a, c]) => `<div class="hbar" role="listitem" data-tip="${esc(`<b>${esc(a)}</b><br>${c} of the top ${n} spots`)}">
            <span class="hb-l">${esc(a)}</span><span class="hb-t" aria-hidden="true"><i style="width:${(100 * c / max).toFixed(1)}%"></i></span>
            <span class="hb-v">${c}<span class="sr-only"> spots</span></span></div>`).join('')}</div>
          <div class="note">A spot on the line between two areas counts in both.</div></section>`;
    } else {
      const M = curMode();
      title = view === 'traffic' ? 'Slow buses & busy streets' : 'Missing & broken sidewalks';
      lead = 'Nothing picked yet. Click a line on the map or a street in the list to see the details.';
      items = M.items().slice(0, 3).map(t => ({ rk: '#' + M.rank(t), t: tier(M.rank(t)), name: M.name(t), sub: M.sub(t), val: M.score(t), open: () => selectTraffic(t, true) }));
    }
    const pinsHtml = pins.length ? `<section class="hsec hsec-pins"><h3>Your pins</h3><ul class="home-pins">${pins.map(g => {
        const nb = nearbySpots(g.lat, g.lon);
        return `<li><button type="button" class="home-pin" data-pin="${g.id}"><span class="hp-name">📍 ${esc(pinTitle(g))}</span>
          <span class="hp-sub">${nb.crashes ? `${plural(nb.crashes, 'crash', 'crashes')} within a quarter mile` : 'No crashes within a quarter mile'}</span></button></li>`;
      }).join('')}</ul></section>` : '';
    titleEl.textContent = title;
    body.innerHTML = `<div class="home-wrap">
      <p class="home-lead">${lead}</p>
      <section class="hsec hsec-top"><h3>Top 3 on this list</h3><ol class="home-top">${items.map(card).join('')}</ol></section>
      ${middle}
      ${pinsHtml}
      <section class="hsec hsec-tips"><h3>Try this</h3><ul class="home-tips">
        <li><b>Right-click (or long-press) the map</b> to pin a place you care about, like home or a school. Pins stay on this device.</li>
        <li>${projToggleBtn()} (purple lines, from SDOT's published project maps).</li>
        <li>Click a place a second time to zoom back out, or use <b>Zoom out</b> at the top right of the map.</li>
        ${view ? '' : '<li>The <b>Slow buses</b> and <b>Sidewalks</b> tabs show other problems on the same streets.</li>'}
      </ul></section></div>`;
    body.scrollTop = 0;
    body.onchange = null;
    body.onclick = e => {
      const h = e.target.closest('[data-home]'); if (h) { items[+h.dataset.home].open(); homeFocus = +h.dataset.home; return; }
      const pb = e.target.closest('[data-pin]'); if (pb) { const g = pins.find(x => String(x.id) === pb.dataset.pin); if (g) openPin(g, true); }
    };
  }

  // ---------- self-test (index.html#selftest): used by pipeline/check.ps1 before publishing ----------
  // Checks the page draws, a ranked spot opens with its crash list (from its area file), a place outside the ranked list
  // opens in full, and the address lookup data is present. The result goes in the page title for a headless browser.
  async function selfTest() {
    const fails = [], wait = async (ok, ms = 8000) => { for (let t = 0; t < ms && !ok(); t += 100) await new Promise(r => setTimeout(r, 100)); return ok(); };
    const check = (ok, what) => { if (!ok) fails.push(what); };
    try {
      const L0 = await lateReady; check(!L0.failed, 'data-late.js did not load');
      await wait(() => searchIdx.length > 0);
      check(N > 1000, `only ${N} places scored`);
      check(D.priorities.length >= 200, `only ${D.priorities.length} ranked spots`);
      check(searchIdx.length === N, `search index has ${searchIdx.length} of ${N} places`);
      check(document.querySelectorAll('#list li[data-id]').length >= 10, 'ranked list did not draw');
      check(document.querySelectorAll('.leaflet-interactive').length >= 10, 'map markers did not draw');
      check((CTX.council || []).length >= 1, 'no council districts');
      select(byId.get(1), false, null);
      check(await wait(() => document.querySelectorAll('#crashTable tr').length > 1), '#1 did not show its crash list');
      check(!!document.querySelector('#detailBody .dsec-street'), '#1 has no street section');
      check(await wait(() => document.querySelectorAll('.rank-hist li').length >= 5), '#1 has no rank-over-the-years chart');
      // "Is it getting fixed?": four sections (worst places of a past year, since last month, the need table, is it working?)
      check(document.querySelectorAll('#progress .pg-sec').length === 4, 'progress view did not draw');
      check(document.querySelectorAll('#pg-working .pg-working li').length >= 1, 'is it working? section has no fix kinds');
      check(document.querySelectorAll('#progress .pg-places tr').length >= 11, 'progress: past worst-50 table is short');
      check(document.querySelectorAll('#progress .pg-need tr, #progress .pg-card').length >= 8, 'progress: district table is short');
      check(keyIdx().size === searchIdx.length, 'place link keys are not unique');
      check(schools().length >= 70 && schools().every(s => s.label && isFinite(s.lat)), 'school search list is short or broken');
      check(D.priorities.filter(p => p.rank_month_ago).length >= 150, 'few places have last month\'s rank');
      const far = searchIdx[searchIdx.length - 1];
      selectLite(far);
      check(await wait(() => current && current.rank_ksi === far.rank && document.querySelectorAll('#crashTable tr').length > 1),
        `#${far.rank} (outside the ranked list) did not open in full`);
      closeDetail(false);
    } catch (e) { fails.push('error: ' + e.message); }
    document.title = fails.length ? 'SELFTEST FAIL: ' + fails.join('; ') : 'SELFTEST PASS';
  }

  ready = true;
  // The second data file: search, the two pages that need it, saved pins' nearby counts, and a shared link that was waiting.
  lateReady.then(L => {
    if (L.failed) {
      const msg = L.stale ? 'The site was just updated.' : 'This part of the site couldn’t load.';
      sInput.placeholder = L.stale ? 'The site was just updated: reload the page.' : 'Search couldn’t load. Reload the page to try again.';
      ['progress', 'budget'].forEach(id => { const e = document.getElementById(id);
        if (e) e.innerHTML = `<p class="note">${msg} <button type="button" class="linkbtn reload-btn">Reload the page</button></p>`;
          const b = e && e.querySelector('.reload-btn'); if (b) b.onclick = () => location.reload(); });
      if (document.activeElement === sInput && sInput.value.trim()) runSearch();
      return;
    }
    lateOK = true;
    D.search = L.search; D.progress = L.progress; D.budget = L.budget;
    setSearch(L.search); setAddrStreets(L.addrStreets);
    budgetInit(); progressInit(); distCard(+document.getElementById('distFilter').value || 0);
    // saved pins were drawn before the nearby counts were here: draw them again, keeping an open pop-up open
    const openId = [...pinMarkers].find(([, m]) => m.isPopupOpen && m.isPopupOpen()), wasOpen = openId && openId[0];
    pins.forEach(drawPin);
    if (wasOpen != null && pinMarkers.get(wasOpen)) pinMarkers.get(wasOpen).openPopup();
    if (sInput.value.trim() && document.activeElement === sInput) runSearch();
    if (location.hash && location.hash !== '#selftest' && !spotOpen() && openFromHash()) return;
    refreshHome();
  });
  if (location.hash === '#selftest') { history.replaceState(null, '', location.pathname + location.search); selfTest(); }
  else if (!openFromHash()) {
    refreshHome();
    if (layer.getLayers().length) map.fitBounds(layer.getBounds(), { paddingTopLeft: [leftPad() + 30, 30], paddingBottomRight: [isNarrow() ? 30 : detailEl.offsetWidth + 30, isNarrow() ? cover + 20 : 30], maxZoom: 15 });
  }
})();
