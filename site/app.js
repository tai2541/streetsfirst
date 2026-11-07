/* Seattle Infrastructure Priority Map: front end. Data comes from window.SITE_DATA (data/data.js). */
(function () {
  const D = window.SITE_DATA;
  const meta = D.meta;
  const fmt = n => Number(n).toLocaleString('en-US');
  const money = n => (n < 0 ? '−' : '') + '$' + (Math.abs(n) >= 1e8 ? Math.round(Math.abs(n) / 1e6) + 'M' : Math.abs(n) >= 1e6 ? (Math.abs(n) / 1e6).toFixed(1) + 'M' : fmt(Math.round(Math.abs(n))));
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : (many || one + 's')}`;
  const ft = m => Math.round(m * 3.28084 / 10) * 10;        // meters -> feet, rounded to 10
  const monthYear = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // SDOT location text -> readable name: "M L KING JR WR WAY S AND S ALASKA ST" -> "Martin Luther King Jr Way S & S Alaska St"
  function niceName(s) {
    let t = s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase())
      .replace(/\b(Ne|Nw|Se|Sw|N|S|E|W)\b/g, m => m.toUpperCase())
      .replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase())
      .replace(/\bWy\b/g, 'Way').replace(/\bBr\b/g, 'Bridge')
      .replace(/\b(Eb|Wb|Nb|Sb)\b/g, m => '(' + { Eb: 'eastbound', Wb: 'westbound', Nb: 'northbound', Sb: 'southbound' }[m] + ')')
      .replace(/\bM L King Jr (?:[A-Z][a-z] )?(?:([NS]) )?Way\b/g,                    // SDOT spells it several ways
        (m, d) => 'Martin Luther King Jr Way' + (d ? ' (' + d + ')' : ''));
    t = t.replace(/ Between /, ' between ');
    if (/ between /.test(t)) t = t.replace(/ And /, ' and '); else t = t.replace(/ And /g, ' & ');
    return t;
  }
  const crashType = t => t.replace(/\s*--\s*/g, ', ');
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
  const toast = msg => {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
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
    ksi: { label: 'Most likely to hurt people', hint: 'Where crashes are most likely to keep killing or seriously injuring people, estimated from 5 years of crashes. Start here.', unit: 'pts' },
    risk: { label: 'Risk for its traffic', hint: 'Dangerous for how busy it is: expected harm per million vehicles passing through. Often quieter streets.', unit: 'per million vehicles' }
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
    `at ${fmt(N)} locations, plus Find It Fix It repair requests. Data fetched ${D.fetchedAt || 'unknown'}.`;

  const scoreText = p => (mode === 'risk' ? `${p.score.toFixed(1)} <small>per million vehicles</small>` : `${fmt(Math.round(p.score))} <small>pts</small>`);
  const topShare = rank => { const s = (100 * rank) / N; return s < 1 ? `top ${Math.max(0.1, Math.ceil(s * 10) / 10)}%` : `top ${Math.ceil(s)}%`; };

  // ---------- reasons: plain-language chips, most important first ----------
  function reasons(p) {
    const out = [];
    if (p.killed) out.push({ cls: 'fatal', text: `${p.killed} ${p.killed === 1 ? 'person' : 'people'} killed` });
    if (p.seriously_injured) out.push({ cls: 'serious', text: `${p.seriously_injured} seriously injured` });
    const pb = [p.ped_crashes ? `${p.ped_crashes} with pedestrians` : '', p.bike_crashes ? `${p.bike_crashes} with cyclists` : ''].filter(Boolean);
    if (pb.length) out.push({ cls: 'ped', text: pb.join(', ') });
    const still = stillDangerous(p);
    if (still) out.push({ cls: 'still', text: still.short });
    patterns(p).forEach(t => out.push({ cls: 'fixable', text: t }));
    if (p.ksi_years >= 3) out.push({ cls: 'still', text: `killed or seriously hurt in ${p.ksi_years} different years` });
    if (p.injury) out.push({ cls: '', text: `${p.injury} injury crashes` });
    const wet = pct(p.wet_crashes, p.road_known), cityWet = Math.round(100 * meta.city_wet_share);
    if (p.road_known >= 5 && wet >= cityWet + 15) out.push({ cls: 'cond', text: `${wet}% on wet roads (city ${cityWet}%)` });
    const dark = pct(p.dark_crashes, p.light_known), cityDark = Math.round(100 * meta.city_dark_share);
    if (p.light_known >= 5 && dark >= cityDark + 15) out.push({ cls: 'cond', text: `${dark}% in the dark (city ${cityDark}%)` });
    if (p.unlit_crashes) out.push({ cls: 'cond', text: `${p.unlit_crashes} with streetlights off/none` });
    if (p.speeding_crashes >= 2 && pct(p.speeding_crashes, p.crashes) >= 15)
      out.push({ cls: 'cond', text: `speed-related: ${p.speeding_crashes} of ${p.crashes}` });
    if (p.state_route) out.push({ cls: 'state', text: `${p.state_route}: state highway` });
    if (p.confidence !== 'high')
      out.push({ cls: 'conf', text: `only ${plural(p.crashes, 'crash', 'crashes')}, so less certain` });
    return out;
  }

  // Crash patterns that match a well-known fix this spot doesn't have yet (from SDOT's signal and Vision Zero data).
  // Stated as facts side by side; whether the fix fits is for engineers to judge.
  function patterns(p) {
    const out = [];
    if (p.addr_type !== 'I') return out;
    if (p.signalized && p.lt_protected === false && p.left_turn_crashes >= 3)
      out.push(`${p.left_turn_crashes} left-turn crashes; no protected left-turn arrow in SDOT signal data`);
    if (p.signalized && p.lpi_status !== 'Existing' && p.ped_turn_crashes >= 2)
      out.push(`${p.ped_turn_crashes} people walking hit by turning drivers; no head-start walk signal (SDOT data)`);
    if (!p.signalized && p.angle_crashes >= 5)
      out.push(`${p.angle_crashes} angle crashes; no traffic signal in SDOT's inventory`);
    return out;
  }

  // Already treated or listed by SDOT, and still hurting people.
  function stillDangerous(p) {
    if (p.lpi_status === 'Existing' && p.ped_after_lpi >= 2) {
      const y = p.lpi_installed ? p.lpi_installed.slice(0, 4) : '';
      const from = p.lpi_installed && p.lpi_installed > meta.window_from ? monthYear(p.lpi_installed) : monthYear(meta.window_from);
      return { short: `${p.ped_after_lpi} pedestrian crashes since ${from} (head-start signal ${y})`,
        long: `SDOT added a head-start walk signal here in ${y || 'an unknown year'}. From ${from} to ${monthYear(meta.window_to)},
          ${p.ped_after_lpi} crashes involving pedestrians were reported (${p.ped_turn_after_lpi || 0} with a turning vehicle, the kind
          this signal targets). Crash data from before the signal isn't loaded, so this doesn't show whether it helped, only that
          pedestrians are still being hit here.` };
    }
    const first = p.sdot_hcl_years && p.sdot_hcl_years[0];
    if (first && first <= +meta.window_from.slice(0, 4) && p.ksi_after_hcl >= 2)
      return { short: `On SDOT's High Collision list since ${first}; ${p.ksi_after_hcl} fatal/serious crashes since`,
        long: `SDOT first put this on its High Collision Locations list in ${first}. Since then (in the scored years) ${p.ksi_after_hcl} crashes have killed or seriously injured someone. Being listed doesn't mean it was redesigned.` };
    return null;
  }

  // SDOT list membership as a compact row (instead of a chip on nearly every card).
  function sdotRow(p) {
    const parts = [];
    if (p.sdot_hin) parts.push(`High Injury Network: ${p.sdot_hin}`);
    if (p.sdot_hcl_years && p.sdot_hcl_years.length) parts.push(`High Collision list ${p.sdot_hcl_years.slice(-1)[0]}`);
    return parts.length ? `<div class="sdotrow"><span class="sdot-mark" aria-hidden="true">SDOT</span> ${parts.join(' · ')}</div>` : '';
  }

  // ---------- map ----------
  const map = L.map('map', { zoomControl: true, zoomSnap: 0.25 }).setView([47.61, -122.33], 12);
  const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  const esriAttr = 'Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors · Data: City of Seattle';
  const tile = (path, opts = {}) => L.tileLayer(esri + path + '/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 16, attribution: esriAttr, ...opts });
  const baseLayers = {
    'Light gray': L.layerGroup([tile('Canvas/World_Light_Gray_Base'), tile('Canvas/World_Light_Gray_Reference')]),
    'Streets': tile('World_Street_Map', { maxNativeZoom: 19 }),
    'Satellite': L.layerGroup([
      tile('World_Imagery', { maxNativeZoom: 19, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics · Data: City of Seattle' }),
      tile('Reference/World_Transportation', { maxNativeZoom: 19 })
    ])
  };
  baseLayers['Light gray'].addTo(map);
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
  L.control.layers(baseLayers, { 'Neighborhood names': hoodLabels }, { position: 'topleft' }).addTo(map);
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

  const flyBounds = (b, opts) => (reduceMotion ? map.fitBounds(b, opts) : map.flyToBounds(b, { ...opts, duration: 0.6 }));
  function showAll() {
    if (!layer.getLayers().length) return;
    const right = !detailEl.hidden && !isNarrow() ? detailEl.offsetWidth + 30 : 30;
    const bottom = !detailEl.hidden && isNarrow() ? detailEl.offsetHeight + 20 : 30;
    flyBounds(layer.getBounds(), { paddingTopLeft: [30, 30], paddingBottomRight: [right, bottom], maxZoom: 15 });
  }
  const ShowAll = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const box = L.DomUtil.create('div', 'leaflet-bar');
      const a = L.DomUtil.create('a', 'showall-btn', box);
      a.href = '#'; a.title = 'Show all ranked spots (H)'; a.setAttribute('role', 'button');
      a.setAttribute('aria-label', 'Show all ranked spots');
      a.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
      L.DomEvent.on(a, 'click', e => { L.DomEvent.preventDefault(e); L.DomEvent.stopPropagation(e); showAll(); });
      return box;
    }
  });
  new ShowAll().addTo(map);
  // Tiers differ by color AND outline, so they don't rely on hue alone.
  const tier = r => (r <= 10 ? 0 : r <= 25 ? 1 : r <= 50 ? 2 : 3);
  const TIERS = [
    { color: '#b3141b' },
    { color: '#e0561f', stroke: '#6b1f04', weight: 2.5 },
    { color: '#f0a020', stroke: '#fff', weight: 1.5 },
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
        <div class="lg-safety"><span class="lg-top"><span class="core">1</span></span>Top 10</div>
        <div class="lg-safety">${sw(1)}11–25</div>
        <div class="lg-safety">${sw(2)}26–50</div>
        <div class="lg-safety">${sw(3)}51+</div>
        <div class="lg-safety"><i style="background:#fff;box-shadow:inset 0 0 0 3px #7a0c10"></i>Repeated deaths</div>
        ${[0, 1, 2].map(t => `<div class="lg-traffic"><b class="lg-tline" style="background:${TIERS[t].color};height:${7 - t}px"></b>${['Top 10', '11–25', '26–50'][t]}</div>`).join('')}
        <div class="lg-traffic"><b class="lg-tline" style="background:#8a94a6;height:2px"></b>Others</div>
        <div><b class="lg-line"></b>Seattle city limits (area covered)</div>
        <button type="button" class="pausebtn" aria-pressed="${paused}">${paused ? 'Play' : 'Pause'} animation</button>
        </div>`;
      d.querySelector('.lg-toggle').onclick = e => {
        const c = d.classList.toggle('collapsed'); e.currentTarget.setAttribute('aria-expanded', !c);
      };
      L.DomEvent.disableClickPropagation(d);
      d.querySelector('.pausebtn').onclick = e => {
        paused = !paused; document.body.classList.toggle('paused', paused);
        e.target.textContent = `${paused ? 'Play' : 'Pause'} animation`; e.target.setAttribute('aria-pressed', paused);
        try { localStorage.setItem('ipm.paused', JSON.stringify(paused)); } catch { /* ignore */ }
      };
      return d;
    }
  });
  const legendCtl = new Legend().addTo(map);
  map.on('dragstart', () => {
    if (!matchMedia('(max-width: 760px)').matches) return;
    const d = legendCtl.getContainer(); d.classList.add('collapsed'); d.querySelector('.lg-toggle').setAttribute('aria-expanded', 'false');
  });
  document.body.classList.toggle('paused', paused);

  function currentRows() {
    const n = +document.getElementById('topN').value;
    const type = document.getElementById('addrFilter').value;
    const onlyFatal = document.getElementById('onlyFatal').checked;
    const ongoing = document.getElementById('onlyOngoing').checked;
    const keep = p => (!type || p.addr_type === type || (type === 'B' && p.addr_type === 'A'))
        && (!onlyFatal || p.killed > 0) && (!ongoing || p.ksi_years >= 3);
    const rows = D.priorities.filter(p => p.rank != null && p.rank <= 200).filter(keep).slice(0, n);
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

    layer.clearLayers(); markers = {};
    extra.forEach(p => {
      const m = L.circleMarker([p.lat, p.lon], EXTRA_STYLE);
      m.bindTooltip(`${p.rank ? '#' + fmt(p.rank) + ' ' : ''}${esc(p.name)}: ${p.killed} people killed`, { direction: 'top', offset: [0, -4] })
        .on('click', () => select(p, false, null));
      m._p = p; m.addTo(layer); markers[p.rank_ksi] = m;
    });
    // Draw lower ranks first so higher ranks sit on top.
    [...rows].reverse().forEach(p => {
      const t = TIERS[tier(p.rank)];
      const m = p.rank <= 10
        ? L.marker([p.lat, p.lon], {
            zIndexOffset: 1000 - p.rank, riseOnHover: true, keyboard: true, title: `#${p.rank} ${p.name}`, alt: `#${p.rank} ${p.name}`,
            icon: L.divIcon({
              className: 'top-mark', iconSize: [40, 40], iconAnchor: [20, 20],
              html: `<span class="pulse" style="animation-delay:-${(p.rank * 0.37).toFixed(2)}s"></span>
                     <span class="core">${p.rank}</span>`
            })
          })
        : L.circleMarker([p.lat, p.lon], {
            radius: 5 + 9 * Math.sqrt(Math.max(0, p.score) / maxScore), color: t.stroke, weight: t.weight,
            fillColor: t.color, fillOpacity: 0.85
          });
      m.bindTooltip(`#${p.rank} ${esc(p.name)}`, { direction: 'top', offset: [0, p.rank <= 10 ? -14 : -4] })
        .on('click', () => select(p, false, m.getElement && m.getElement()));
      m._p = p; m.addTo(layer); markers[p.rank_ksi] = m;
    });

    const list = document.getElementById('list');
    const card = (p, isExtra, i) => {
      const chips = reasons(p).slice(0, 3);
      const rk = p.rank != null ? '#' + fmt(p.rank) : '—';
      return `
      <li data-id="${p.rank_ksi}" class="${isExtra ? 'extra' : (p.rank <= 10 ? 'top10 ' : '') + 't' + tier(p.rank)}" style="--i:${Math.min(i || 0, 15)}">
        <button type="button" class="card">
          <span class="row1"><span class="rank">${rk}</span><span class="loc">${esc(p.name)}${p.area ? `<span class="hood">${esc(p.area)}</span>` : ''}</span>
            <span class="score">${p.score != null ? scoreText(p) : ''}</span></span>
          <span class="chips">${chips.map(r => `<span class="chip ${r.cls}">${esc(r.text)}</span>`).join('')}</span>
          ${sdotRow(p)}
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
      btn.addEventListener('click', () => select(p, true, btn));
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
    const base = isExtraMarker(m) ? EXTRA_STYLE : TIERS[tier(p.rank)];
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
  let crashFilter = 'all', reqFilter = '', showAllCrashes = false, showAllReqs = false, current = null, opener = null;

  // ---------- panel layout: expand, resize, collapsible sections (remembered) ----------
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem('ipm.' + k)); return v ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('ipm.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
  };
  const collapsed = store.get('collapsed', { math: true });
  const widths = store.get('widths', { normal: 440, expanded: null });
  let expanded = store.get('expanded', false);
  let renderGraphs = () => {};
  // Redraw the graphs to fit when the detail panel is resized or widened.
  if (window.ResizeObserver) new ResizeObserver(() => renderGraphs()).observe(document.getElementById('detail'));
  const detailEl = document.getElementById('detail');
  const mapW = () => document.getElementById('map').offsetWidth || window.innerWidth;
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
    // The budget table needs room for its year columns, and the map has nothing to show then: widen while it's open.
    if (document.body.classList.contains('budget-view')) w = Math.max(w, Math.min(780, Math.round(mainEl.offsetWidth * 0.62)));
    panelEl.style.width = clampLeft(w) + 'px';
    mainEl.style.setProperty('--panel-w', panelEl.offsetWidth + 'px');
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

  function applyLayout() {
    if (isNarrow()) { detailEl.style.width = ''; detailEl.classList.remove('expanded', 'split'); return; }
    // Both expanded: the detail panel fills everything right of the list (the two meet in the middle).
    const split = expanded && leftExpanded;
    detailEl.classList.toggle('split', split);
    mainEl.classList.toggle('split', split && !detailEl.hidden);   // both edge tabs on one line: offset them
    const w = split ? mapW() : expanded ? (widths.expanded || defaultExpanded()) : widths.normal;
    detailEl.style.width = (split ? w : Math.min(Math.max(340, w), maxW())) + 'px';
    detailEl.classList.toggle('expanded', expanded);
    const b = document.getElementById('expandDetail');
    // Same control as the list's edge tab: the arrow points the way the edge will move.
    b.textContent = expanded ? '›' : '‹';
    b.title = expanded ? 'Narrow the details (E)' : 'Widen the details (E)';
    b.setAttribute('aria-label', expanded ? 'Narrow the details' : 'Widen the details');
    b.setAttribute('aria-pressed', String(expanded));
  }
  function toggleExpand() {
    expanded = !expanded; store.set('expanded', expanded); applyLayout();
    if (current) { select(current, false, null, true); flyVisible([current.lat, current.lon], map.getZoom()); }
  }
  document.getElementById('expandDetail').onclick = toggleExpand;
  document.getElementById('expandPanel').onclick = toggleLeft;
  window.addEventListener('resize', () => { applyPanel(); applyLayout(); });
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
      mainEl.style.setProperty('--panel-w', panelEl.offsetWidth + 'px');
      applyLayout();
    });
    h.addEventListener('pointerup', e => {
      h.releasePointerCapture(e.pointerId); document.body.classList.remove('resizing');
      leftWidths[leftExpanded ? 'expanded' : 'normal'] = panelEl.offsetWidth; store.set('leftWidths', leftWidths);
      applyPanel(); applyLayout();
    });
  })();

  // Phone: the panel is a bottom sheet with a short "peek" height and a full height.
  const sheetBtn = document.getElementById('sheetDetail');
  function setSheet(full) {
    detailEl.classList.toggle('full', full);
    sheetBtn.textContent = full ? 'Less' : 'More';
    sheetBtn.title = full ? 'Show less' : 'Show more';
    sheetBtn.setAttribute('aria-label', full ? 'Show less' : 'Show more');
    sheetBtn.setAttribute('aria-expanded', String(full));
  }
  sheetBtn.onclick = () => setSheet(!detailEl.classList.contains('full'));

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
    if (detailEl.hidden) return;
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

    const fixes = [];
    if (p.lpi_status === 'Existing' && p.lpi_installed) fixes.push({ d: p.lpi_installed, label: 'Head-start walk signal' });
    if (p.lt_protected && p.lt_installed) fixes.push({ d: p.lt_installed, label: 'Protected left turn' });
    (p.fixes || []).filter(f => f.d && f.s === 'Built').forEach(f => fixes.push({ d: f.d, label: f.k }));
    const inRange = fixes.filter(x => mIdx(x.d) >= 0).sort((a, b) => a.d.localeCompare(b.d));
    const before = fixes.filter(x => mIdx(x.d) < 0);

    const W = Math.max(300, Math.round(width)), L = 34, R = 14, top = 22 + 16 * inRange.length;
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
        '<text x="' + tx + '" y="' + ly + '" class="tc-fix">' + esc(x.label) + ', ' + monthYear(x.d) + '</text>'; }).join('');
    const hits = per.map(b => '<rect class="tc-hit" x="' + X(6 * b.i) + '" y="' + top + '" width="' + (X(6) - X(0)) + '" height="' + (xb - top) + '" data-tip="' + esc(
      '<b>' + b.name + '</b>' + (b.done ? '' : ' (incomplete)') + '<br>' + plural(b.crashes, 'crash', 'crashes') + ', ' + b.severe + ' fatal or serious<br>' + plural(b.reports, 'repair report')) + '"/>').join('');
    const summary = 'Crashes and repair reports every six months. ' + per.map(b => b.name + ': ' + b.crashes + ' crashes, ' + b.severe + ' fatal or serious, ' + b.reports + ' repair reports').join('; ') +
      (inRange.length ? '. ' + inRange.map(x => x.label + ' installed ' + monthYear(x.d)).join('; ') : '');
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
      if (rate(b0, yb) && rate(a0, ya)) ba = '<p class="tc-ba"><b>Before the ' + esc(what) + ':</b> ' + rate(b0, yb) + ' crashes a year (' + sev(b0) + ' fatal or serious in ' + yb.toFixed(1) + ' years). ' +
        '<b>After:</b> ' + rate(a0, ya) + ' a year (' + sev(a0) + ' fatal or serious in ' + ya.toFixed(1) + ' years). ' +
        (ya < 2 ? "That's under 2 years, so a change could easily be luck." : 'Crash counts swing from year to year, so treat a small change as a hint, not proof.') + '</p>';
      else ba = '<p class="tc-ba">Not enough time on one side of the ' + esc(what) + ' to compare before and after.</p>';
    }
    return '<div class="legend"><span><i style="background:' + SEV.I.color + '"></i>All crashes</span>' +
      '<span><i style="background:' + SEV.F.color + '"></i>Fatal or serious</span>' +
      '<span><i class="sq" style="background:' + REQ_COLOR + '"></i>Repair reports</span>' +
      (inRange.length ? '<span><i class="dash"></i>SDOT fix</span>' : '') + '</div>' +
      '<div class="tc-wrap">' + svg + '</div>' + ba +
      '<div class="note">Every 6 months. Hollow points and dashed lines: not complete yet, because police reports arrive months late. ' +
      (!fixes.length ? "No dated SDOT fixes here, so there's no fix line (repaving, sidewalks and redesigns aren't linked yet). " : '') +
      before.map(x => esc(x.label) + ' installed ' + monthYear(x.d) + ', before this chart starts. ').join('') +
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
    const what = p.addr_type === 'I' && p.volume_streets > 1 ? `vehicles entering / weekday (${p.volume_streets} streets added)` : 'vehicles / weekday';
    const src = p.volume_estimated ? 'includes an SDOT estimate, not a count' : `SDOT count from ${p.volume_year}${p.volume_streets > 1 ? ' or later' : ''}`;
    return `${fmt(p.volume)} ${what} <span class="muted">(${src})</span>`;
  }

  // Street context from SDOT's street network, traffic counts and Vision Zero layers.
  function streetInfo(p) {
    const pci = p.pavement_min;
    const pciLabel = pci == null ? 'not rated' : `${pci}/100 (${pci >= 70 ? 'good' : pci >= 40 ? 'fair' : 'poor'})`;
    const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    return `<table class="kv">
      ${row('Street type', esc(p.street_type || '—') + (p.state_route ? ` · <b>${esc(p.state_route)}</b>` : ''))}
      ${p.block_ft ? row('Block length', `${fmt(p.block_ft)} ft <span class="muted">(typical block ${fmt(meta.median_block_ft)} ft; longer blocks collect more crashes)</span>`) : ''}
      ${row('Speed limit', p.speed_limit ? p.speed_limit + ' mph <span class="muted">(highest nearby)</span>' : '—')}
      ${row('Traffic', volumeText(p))}
      ${row('Pavement', pciLabel + (pci != null ? ' <span class="muted">(worst block here)</span>' : ''))}
    </table>
    ${p.state_route || p.structure ? `<div class="note">${p.state_route ? `${esc(p.state_route)} is a state highway: WSDOT shares responsibility with the city.` : ''}
      ${p.structure ? 'This is a bridge, ramp or tunnel, which may be owned by WSDOT.' : ''}</div>` : ''}`;
  }

  // What SDOT has already done or flagged here.
  function treatments(p) {
    const items = [];
    if (p.sdot_hin) items.push(`On SDOT's <b>High Injury Network</b> (${esc(p.sdot_hin)} priority).`);
    if (p.sdot_hcl_years && p.sdot_hcl_years.length) items.push(`On SDOT's <b>High Collision Locations</b> list in ${p.sdot_hcl_years.join(', ')}.`);
    if (p.lpi_status === 'Existing') items.push(`<b>Head-start walk signal</b> (Leading Pedestrian Interval) since ${p.lpi_installed ? monthYear(p.lpi_installed) : 'an unknown date'}.`);
    else if (p.lpi_status === 'Planned') items.push(`Head-start walk signal <b>planned</b>${p.lpi_planned ? ' for ' + p.lpi_planned : ''}.`);
    else if (p.lpi_status === 'Not Feasible') items.push(`Head-start walk signal judged <b>not feasible</b> by SDOT.`);
    if (p.lt_protected) items.push(`Protected left-turn signal${p.lt_installed ? ' since ' + p.lt_installed.slice(0, 4) : ''}.`);
    if (p.signalized && p.ped_audio) items.push('Accessible (audible) pedestrian signals.');
    (p.fixes || []).forEach(f => {
      if (f.s !== 'Built') items.push(`${esc(f.k)} <b>${f.s.toLowerCase()}</b>.`);
      else items.push(`<b>${esc(f.k)}</b>${f.n > 1 ? ` (${f.n})` : ''}${f.d ? ' since ' + monthYear(f.d) : ''}.`);
    });
    if (p.addr_type === 'I' && !p.signalized) items.push('No traffic signal in SDOT\'s signal data.');
    const still = stillDangerous(p);
    return `${still ? `<p class="callout">${esc(still.long)}</p>` : ''}
      ${items.length ? `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>` : '<div class="note">Nothing recorded in the SDOT layers this site reads.</div>'}
      <div class="note">From SDOT signal, Vision Zero, traffic-calming, bike-lane and bus-lane data. Repaving, sidewalks and street redesigns aren't linked yet.</div>`;
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
      <div class="fbar" role="group" aria-label="Filter crashes">
        ${btn('all', 'All', crashes.length)}${btn('severe', 'Fatal/serious', crashes.filter(filters.severe).length)}
        ${btn('injury', 'Injury', crashes.filter(filters.injury).length)}${btn('ped', 'Ped/bike', crashes.filter(filters.ped).length)}
        ${btn('speeding', 'Speed-related', crashes.filter(filters.speeding).length)}
      </div>
      <table class="dtable"><thead><tr><th>Date</th><th>Severity</th><th>What happened</th></tr></thead><tbody>
      ${shown.map(c => {
        const who = [c.pd ? `${c.pd} pedestrian${c.pd > 1 ? 's' : ''}` : '', c.cy ? `${c.cy} cyclist${c.cy > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ');
        const hurt = [c.fat ? `${c.fat} killed` : '', c.ser ? `${c.ser} seriously injured` : '', c.inj ? `${c.inj} injured` : ''].filter(Boolean).join(', ');
        const cond = [c.rd, c.lt, c.wx].filter(v => v && !/^(unknown|other)$/i.test(v)).join(' · ');
        return `<tr>
          <td class="nowrap">${c.d}${c.n ? '<div class="sub2">not scored yet</div>' : ''}</td>
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
          <td class="nowrap"><button type="button" class="linkbtn rowbtn" data-ri="${reqs.indexOf(r)}" aria-label="Show ${esc(r.t)} from ${r.d} on the map">${r.d}</button></td>
          <td>${esc(r.t)}<div class="sub2 muted">${esc(r.a || '')} · ${ft(r.m)} ft away</div></td>
          <td>${esc(r.st || '')}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">None</td></tr>'}
      </tbody></table>
      ${list.length > 20 && !expanded ? `<button type="button" class="linkbtn" data-more="reqs">${showAllReqs ? 'Show fewer' : `Show all ${list.length}`}</button>` : ''}
      <div class="note">City status is unreliable: most requests stay "Reported" even after a fix. Click a date to see it on the map.</div>`;
  }

  // Center a point in the part of the map not covered by the detail panel.
  function flyVisible(latlng, zoom) {
    let pt = map.project(latlng, zoom);
    if (!detailEl.hidden && !isNarrow()) pt = pt.add([(detailEl.offsetWidth || 440) / 2, 0]);
    // (phone: the sheet covers the list below the map, not the map, so no shift)
    const c = map.unproject(pt, zoom);
    if (reduceMotion) map.setView(c, zoom, { animate: false }); else map.flyTo(c, zoom, { duration: 0.6 });
  }

  function drawFocus(p, det) {
    focus.clearLayers();
    // The search area, made obvious: shaded, dashed, and labelled with its size on the map itself.
    const rm = weight('request_radius_m');
    L.circle([p.lat, p.lon], { radius: rm, color: '#1d2430', weight: 2, dashArray: '6 5', fillColor: REQ_COLOR, fillOpacity: 0.08, interactive: false }).addTo(focus);
    L.marker([p.lat + rm / 111320, p.lon], { keyboard: false, interactive: false,
      icon: L.divIcon({ className: 'radius-label', iconSize: null, html: `<span>Requests counted within ${ft(rm)} ft</span>` }) }).addTo(focus);
    if (!markers[p.rank_ksi])  // spot not on the map in this view (found by search, or hidden by filters)
      L.circleMarker([p.lat, p.lon], { radius: 9, color: '#1d2430', weight: 3, fillColor: '#fff', fillOpacity: 0.9, interactive: false }).addTo(focus);
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
    if (sel && sel.setZIndexOffset) sel.setZIndexOffset(5000);
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
    s += p.ksi ? `; ${p.ksi === 1 ? '1 killed or seriously injured someone' : `${p.ksi} killed or seriously injured someone`}` +
      (p.killed ? ` (${p.killed} ${p.killed === 1 ? 'person' : 'people'} killed)` : '') : '; none killed or seriously injured anyone';
    parts.push(s + '.');
    const who = (n, verb) => `${n} involved ${n === 1 ? 'a person' : 'people'} ${verb}`;
    const pb = [p.ped_crashes ? who(p.ped_crashes, 'walking') : '', p.bike_crashes ? who(p.bike_crashes, 'biking') : ''].filter(Boolean);
    if (pb.length) parts.push(pb.join(' and ') + '.');
    const st = [p.speed_limit ? `${p.speed_limit} mph` : '', (p.street_type || '').toLowerCase(), p.volume ? `${fmt(p.volume)} vehicles a weekday` : ''].filter(Boolean);
    if (st.length) parts.push(st.join(', ').replace(/^./, c => c.toUpperCase()) + '.');
    const rk = p.rank_ksi;
    const line2 = `Ranks <b>#${rk}</b> of ${fmt(N)} crash locations (${topShare(rk)})` +
      (p.rank_risk ? `, and #${p.rank_risk} once you account for how busy it is` : '') + '.';
    const why = p.killed >= 2 && rk > 50
      ? `<p class="callout">${p.killed} people died here. It ranks #${fmt(rk)} because the ranking estimates where people are most
          likely to be hurt next, and this spot has few other crashes (${p.crashes} in total), so the model treats much of its
          record as chance. That may understate it: repeated deaths can mean traffic moves at deadly speeds. It's always listed
          so it isn't overlooked.</p>` : '';
    return `<p class="verdict">${esc(parts.join(' '))}</p><p class="verdict2">${line2}</p>${why}`;
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
      <p><b>Score ${fmt(Math.round(p.score_ksi))}</b> = expected harm × repair boost ${(1 + p.request_boost).toFixed(2)}
        <span class="muted">(${plural(p.scored_requests, 'safety-related request')} since ${monthYear(meta.requests_scored_from)})</span>.
        Without the boost it would rank #${p.rank_noboost}.</p>`;
    const riskLine = p.score_risk != null
      ? `<p><b>Risk ${p.score_risk.toFixed(1)} per million vehicles</b> = expected harm ${fmt(Math.round(p.expected_harm))} ÷
          (${fmt(Math.max(p.volume, weight('risk_vol_floor')))} vehicles a weekday × 365 × 5 years ÷ 1 million).</p>`
      : `<p class="note">Not ranked for risk: ${p.volume ? `fewer than ${weight('risk_min_crashes')} crashes` : 'no SDOT traffic count'}.</p>`;
    const ranks = `<p class="note">Ranks: #${p.rank_ksi} most likely to hurt people · ${p.rank_risk ? '#' + p.rank_risk : 'unranked'} for how busy it is.</p>`;
    return (mode === 'risk' ? riskLine + ksiLine : ksiLine + riskLine) + ranks;
  }
  const groupName = g => {
    const [a, s] = g.split(' / ');
    return `${a === 'I' ? 'intersections' : 'blocks'} on ${{ principal: 'principal arterials', minor: 'minor arterials', collector: 'collector arterials', state: 'state routes and freeways', local: 'neighborhood streets' }[s] || s}`;
  };

  // The map view from before a spot was opened, so closing it zooms back out to where you were.
  let viewBefore = null;
  const rememberView = () => { if (detailEl.hidden && !viewBefore) viewBefore = { c: map.getCenter(), z: map.getZoom() }; };
  function select(p, fly, from, keepFocus) {
    rememberView();
    if (!current || current.rank_ksi !== p.rank_ksi) { crashFilter = 'all'; reqFilter = ''; showAllCrashes = showAllReqs = false; }
    if (from !== undefined && !keepFocus) opener = from;
    current = p;
    if (location.hash !== '#loc=' + p.rank_ksi) history.replaceState(null, '', '#loc=' + p.rank_ksi);
    markCurrent();
    const li = document.querySelector(`#list li[data-id="${p.rank_ksi}"]`);
    if (li && !fly) li.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });

    const det = (D.details && D.details[p.location]) || { crashes: [], requests: [] };
    const kind = { I: 'Intersection', B: 'Street block', A: 'Alley' }[p.addr_type] || 'Location';
    const sv = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat},${p.lon}`;
    const types = countBy(det.crashes.filter(c => c.t), c => crashType(c.t)).slice(0, 6);
    const untyped = det.crashes.filter(c => !c.t).length;
    const R = ft(weight('request_radius_m'));
    const sec = (id, title, html) =>
      `<section class="dsec ${collapsed[id] ? 'collapsed' : ''}" data-sec="${id}">
         <h3><button type="button" class="dsec-h" aria-expanded="${!collapsed[id]}" aria-controls="sec-${id}">${title}</button></h3>
         <div class="dsec-b" id="sec-${id}">${html}</div></section>`;
    const chips = reasons(p);
    document.getElementById('detailTitle').innerHTML = `<span class="drank">#${p.rank ?? p.rank_ksi}</span> ${esc(p.name)}`;
    document.getElementById('detailBody').innerHTML = `
      <div class="dhead">
        ${p.neighborhood ? `<div class="where">${esc(p.neighborhood)}${p.area && p.area !== p.neighborhood ? ` <span class="muted">· ${esc(p.area)}</span>` : ''}</div>` : ''}
        <div class="note">${kind} · <a href="${sv}" target="_blank" rel="noopener">Street View ↗</a> ·
          <button type="button" class="linkbtn" id="copyLink">Copy link</button> · ${copyLoc(p.name)}</div>
        ${verdict(p)}
        <div class="stat-grid">
          <div class="stat"><b>${p.crashes}</b><span>crashes</span></div>
          <div class="stat"><b>${(p.killed ?? 0) + (p.seriously_injured ?? 0)}</b><span>people killed or seriously hurt</span></div>
          <div class="stat"><b>${p.pb_crashes ?? p.ped_crashes + p.bike_crashes}</b><span>with people walking or biking</span></div>
          <div class="stat"><b>${p.requests}</b><span>repair requests nearby</span></div>
        </div>
        <div class="chips dchips">${chips.map(r => `<span class="chip ${r.cls}">${esc(r.text)}</span>`).join('')}</div>
        ${reportBox(p.name)}
      </div>
      <div id="graphs" class="graphs"></div>
      <div class="dcols">
        <div class="dcol">
          ${sec('done', 'What SDOT has done here', treatments(p))}
          ${sec('street', 'The street', streetInfo(p))}
          ${sec('traffic', 'Traffic here', trafficHere(p))}
          ${sidewalksHere(p) ? sec('walk', 'Sidewalks here', sidewalksHere(p)) : ''}
          ${sec('types', 'What kind of crashes', `
            ${hbars(types, '#2a78d6', 'crashes')}
            ${untyped ? `<div class="note">${untyped} crash${untyped > 1 ? 'es have' : ' has'} no type recorded.</div>` : ''}
            <ul class="tight">
              <li>Wet/icy road: ${p.wet_crashes} of ${p.road_known} with known conditions (${pct(p.wet_crashes, p.road_known)}%; city ${Math.round(100 * meta.city_wet_share)}%)</li>
              <li>Dark: ${p.dark_crashes} of ${p.light_known} (${pct(p.dark_crashes, p.light_known)}%; city ${Math.round(100 * meta.city_dark_share)}%) · streetlights off/none: ${p.unlit_crashes}</li>
            </ul>`)}
          ${sec('reqtypes', `Repair requests within ${R} ft`, `
            <div class="legend"><span><i class="sq" style="background:${REQ_COLOR}"></i>Request location (on map)</span>
              <span><i class="ring"></i>Dashed circle: ${R} ft search area</span></div>
            ${hbars(countBy(det.requests, r => r.t), REQ_COLOR, 'requests') || '<div class="note">None in Find It Fix It data.</div>'}`)}
          ${sec('math', 'How this score is calculated', mathBox(p))}
        </div>
        <div class="dcol">
          ${sec('crashes', 'Every crash', `
            <div class="legend">${['F', 'S', 'I', 'P'].map(k => `<span><i style="background:${SEV[k].color}"></i>${SEV[k].label}</span>`).join('')}</div>
            <div id="crashTable">${crashTable(det.crashes)}</div>`)}
          ${sec('reqs', 'Every repair request', `<div id="reqTable">${reqTable(det.requests)}</div>`)}
        </div>
      </div>`;
    const wasHidden = detailEl.hidden;
    detailEl.hidden = false;
    if (wasHidden) setSheet(false);
    applyLayout();
    if (fly) flyVisible([p.lat, p.lon], 17);
    drawFocus(p, det);
    renderGraphs = () => {
      const g = document.getElementById('graphs'); if (!g || g.hidden) return;
      const w = g.clientWidth; if (Math.abs(w - (g._w || 0)) < 8 && g.innerHTML) return; g._w = w;
      g.innerHTML = '<div class="gcol"><h3 class="gh">Crashes and repair reports over time</h3>' + timeChart(det, p, Math.min(w - 34, 760)) + '</div>' +
        '<div class="gcol"><h3 class="gh">Crashes by year</h3>' + yearChart(det.crashes) + '</div>';
    };
    renderGraphs();
    if (!keepFocus) { document.getElementById('detailBody').scrollTop = 0; document.getElementById('detailTitle').focus({ preventScroll: true }); }

    const body = document.getElementById('detailBody');
    body.onclick = e => {
      const h = e.target.closest('.dsec-h');
      if (h) {
        const s = h.closest('.dsec'), id = s.dataset.sec;
        collapsed[id] = !collapsed[id]; store.set('collapsed', collapsed);
        s.classList.toggle('collapsed', collapsed[id]); h.setAttribute('aria-expanded', String(!collapsed[id]));
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
        const done = () => { e.target.textContent = 'Link copied'; setTimeout(() => (e.target.textContent = 'Copy link'), 1800); };
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('Copy this link:', url));
        else prompt('Copy this link:', url);
        return;
      }
      const cf = e.target.closest('[data-cf]');
      if (cf) { crashFilter = cf.dataset.cf; showAllCrashes = false; document.getElementById('crashTable').innerHTML = crashTable(det.crashes); return; }
      const more = e.target.closest('[data-more]');
      if (more && more.dataset.more === 'crashes') { showAllCrashes = !showAllCrashes; document.getElementById('crashTable').innerHTML = crashTable(det.crashes); return; }
      if (more && more.dataset.more === 'reqs') { showAllReqs = !showAllReqs; document.getElementById('reqTable').innerHTML = reqTable(det.requests); return; }
      const row = e.target.closest('[data-ri]');
      if (row) { const r = det.requests[+row.dataset.ri]; flyVisible([r.lat, r.lon], 19); }
    };
    body.onchange = e => {
      if (e.target.id === 'reqType') { reqFilter = e.target.value; showAllReqs = false;
        document.getElementById('reqTable').innerHTML = reqTable(det.requests); drawFocus(p, det); }
    };
  }

  // Locations outside the exported top lists (found by search): a short summary, no crash list.
  function selectLite(s) {
    rememberView();
    current = { rank_ksi: s.rank, rank: null, lat: s.lat, lon: s.lon };
    opener = document.getElementById('search');
    history.replaceState(null, '', '#loc=' + s.rank);
    markCurrent();
    document.getElementById('detailTitle').innerHTML = `<span class="drank">#${s.rank}</span> ${esc(niceName(s.name))}`;
    document.getElementById('detailBody').innerHTML = `
      <div class="dhead">
        ${s.hood ? `<div class="where">${esc(s.hood)}${s.area && s.area !== s.hood ? ` <span class="muted">· ${esc(s.area)}</span>` : ''}</div>` : ''}
        <div class="note">${{ I: 'Intersection', B: 'Street block', A: 'Alley' }[s.type] || 'Location'} ·
          <a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${s.lat},${s.lon}" target="_blank" rel="noopener">Street View ↗</a> · ${copyLoc(niceName(s.name))}</div>
        ${reportBox(niceName(s.name))}
        <p class="verdict">${plural(s.crashes, 'crash', 'crashes')} from ${monthYear(meta.window_from)} to ${monthYear(meta.window_to)}${s.ksi ? `; ${s.ksi} killed or seriously injured someone` : ''}${s.pb ? `; ${s.pb} involved people walking or biking` : ''}.</p>
        <p class="verdict2">Ranks <b>#${fmt(s.rank)}</b> of ${fmt(N)} crash locations (${topShare(s.rank)}).</p>
        <p class="note">Full crash and request details are included for the top-ranked spots only.
          This spot is outside them, so it isn't in the ranked list.</p>
      </div>`;
    const wasHidden = detailEl.hidden;
    detailEl.hidden = false; if (wasHidden) setSheet(false); applyLayout();
    flyVisible([s.lat, s.lon], 17);
    focus.clearLayers();
    L.circleMarker([s.lat, s.lon], { radius: 9, color: '#1d2430', weight: 3, fillColor: '#fff', fillOpacity: 0.9, interactive: false }).addTo(focus);
    Object.values(markers).forEach(m => dim(m, true));
    document.getElementById('detailTitle').focus({ preventScroll: true });
  }

  function closeDetail(restoreFocus) {
    detailEl.hidden = true; mainEl.classList.remove('split'); clearFocus();
    applyLayout();
    if (viewBefore) { if (reduceMotion) map.setView(viewBefore.c, viewBefore.z, { animate: false }); else map.flyTo(viewBefore.c, viewBefore.z, { duration: 0.6 }); }
    else { const g = trafficOn ? tLayer : layer; if (g.getLayers().length) (reduceMotion ? map.fitBounds : map.flyToBounds).call(map, g.getBounds(), { padding: [30, 30], maxZoom: 15 }); }
    viewBefore = null;
    if (tSel) { tSel = null; tLines.forEach(line => line.setStyle(lineStyle(line._t, false))); document.querySelectorAll('.tlist li.selected').forEach(li => li.classList.remove('selected')); }
    history.replaceState(null, '', location.pathname + location.search);
    if (restoreFocus && opener && document.contains(opener)) opener.focus();
    else if (restoreFocus) document.getElementById('list').querySelector('button')?.focus();
    opener = null;
  }
  document.getElementById('closeDetail').onclick = () => closeDetail(true);
  ['topN', 'addrFilter', 'onlyFatal', 'onlyOngoing'].forEach(id => (document.getElementById(id).onchange = render));

  function weight(k) { const w = meta.weights.find(x => x.k === k); return w ? w.v : '?'; }

  // ---------- search: every scored location ----------
  const searchIdx = (D.search || []).map(r => ({ name: r[0], lat: +r[1], lon: +r[2], rank: +r[3], crashes: +r[4], ksi: +r[5], pb: +r[6], type: r[7], hood: r[8] || '', area: r[9] || '' }));
  const normQ = t => t.toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ');
  searchIdx.forEach(s => { s.nkey = ' ' + normQ(niceName(s.name)) + ' '; s.key = s.nkey + ' ' + normQ(s.hood + ' ' + s.area); });
  const sInput = document.getElementById('search'), sList = document.getElementById('searchResults');
  let sHits = [], sActive = -1;
  const sStatus = document.getElementById('searchStatus');
  const say = t => { sStatus.textContent = ''; setTimeout(() => (sStatus.textContent = t), 50); };
  const closeList = () => { sList.hidden = true; sInput.setAttribute('aria-expanded', 'false'); sInput.removeAttribute('aria-activedescendant'); };
  function runSearch() {
    const q = sInput.value.toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (q.length < 2) { sList.hidden = true; sInput.setAttribute('aria-expanded', 'false'); return; }
    const words = q.split(' ');
    // Index is in rank order. Places whose street names hold every word come before neighborhood-only matches.
    const all = searchIdx.filter(s => words.every(w => s.key.includes(w)));
    const inName = s => words.every(w => s.nkey.includes(' ' + w));
    sHits = all.filter(inName).concat(all.filter(s => !inName(s))).slice(0, 8);
    const nPlaces = sHits.length;
    // Text can also be pinned as an address: offered when it has a number in it or matches no scored place.
    const addr = { addr: true, text: sInput.value.trim() };
    if (/^\d/.test(addr.text)) sHits.unshift(addr); else if (/\d/.test(addr.text) || !nPlaces) sHits.push(addr);
    sActive = -1; sInput.removeAttribute('aria-activedescendant');
    say(nPlaces ? `${nPlaces === 8 ? '8 or more' : nPlaces} matching places` : 'No matching crash location. You can pin it as an address.');
    sList.innerHTML = sHits.map((s, i) => s.addr
      ? `<li role="option" id="sr-${i}" data-i="${i}" class="addr-opt"><span>📍 Pin this address on the map: <b>${esc(s.text)}</b><small class="pin-privacy">Looked up with Esri’s address search. The pin is saved only on this device.</small></span></li>`
      : `<li role="option" id="sr-${i}" data-i="${i}">
        <span>${esc(niceName(s.name))}${s.area ? `<small class="hood">${esc(s.area)}</small>` : ''}</span><small>#${fmt(s.rank)} · ${plural(s.crashes, 'crash', 'crashes')}</small></li>`).join('') +
      (!nPlaces ? '<li class="none">No crash location matches. Only places with a reported crash are scored.</li>' : '');
    sList.hidden = false; sInput.setAttribute('aria-expanded', 'true');
  }
  function pick(i) {
    const s = sHits[i]; if (!s) return;
    if (s.addr) { closeList(); pinAddress(s.text); return; }
    closeList(); sInput.value = niceName(s.name);
    const p = byId.get(s.rank);
    if (p) select(p, true, sInput); else selectLite(s);
  }
  sInput.addEventListener('input', runSearch);
  sInput.addEventListener('keydown', e => {
    if (sList.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sActive = Math.max(0, Math.min(sHits.length - 1, sActive + (e.key === 'ArrowDown' ? 1 : -1)));
      sList.querySelectorAll('li').forEach((li, i) => li.classList.toggle('active', i === sActive));
      sInput.setAttribute('aria-activedescendant', 'sr-' + sActive);
    } else if (e.key === 'Enter') { e.preventDefault(); pick(sActive < 0 ? 0 : sActive); }
    else if (e.key === 'Escape') closeList();
  });
  sList.addEventListener('mousedown', e => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); pick(+li.dataset.i); } });
  sInput.addEventListener('blur', () => setTimeout(closeList, 150));

  // ---------- address pin: a personal reference point (home, work, a kid's school) ----------
  // The typed address goes to Esri's geocoder (OpenStreetMap's if Esri fails) only when someone asks to pin it.
  const SEA = { w: -122.46, s: 47.48, e: -122.22, n: 47.74 };
  const inSeattle = (lat, lon) => lat > SEA.s && lat < SEA.n && lon > SEA.w && lon < SEA.e;
  map.createPane('pin'); map.getPane('pin').style.zIndex = 660;
  const pinLayer = L.layerGroup().addTo(map);
  async function geocode(text) {
    const q = encodeURIComponent(/seattle/i.test(text) ? text : text + ', Seattle, WA');
    try {
      const r = await fetch('https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates' +
        `?SingleLine=${q}&f=json&maxLocations=1&searchExtent=${SEA.w},${SEA.s},${SEA.e},${SEA.n}`).then(x => x.json());
      const c = r.candidates && r.candidates[0];
      if (c && c.score >= 80) return { lat: c.location.y, lon: c.location.x, label: c.address };
    } catch { /* try the next one */ }
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=jsonv2&limit=1` +
        `&viewbox=${SEA.w},${SEA.n},${SEA.e},${SEA.s}&bounded=1`).then(x => x.json());
      if (r[0]) return { lat: +r[0].lat, lon: +r[0].lon, label: r[0].display_name.split(', ').slice(0, 3).join(', ') };
    } catch { /* not found */ }
    return null;
  }
  function searchMsg(html) { sList.innerHTML = `<li class="none">${html}</li>`; sList.hidden = false; sInput.setAttribute('aria-expanded', 'true'); say(sList.textContent); }
  async function pinAddress(text) {
    if (!text) return;
    searchMsg('Finding that address…');
    const g = await geocode(text);
    if (!g) return searchMsg(`Couldn't find “${esc(text)}”. Try a street address like “600 4th Ave”.`);
    if (!inSeattle(g.lat, g.lon)) return searchMsg(`“${esc(g.label)}” is outside Seattle. This map covers Seattle only.`);
    closeList();
    setPin(g, true);
  }
  // Everything within a quarter mile (402 m): crash totals plus the highest-ranked places.
  function nearbySpots(lat, lon) {
    const k = Math.cos(lat * Math.PI / 180) * 111320;
    const near = searchIdx.map(x => ({ x, m: Math.hypot((x.lon - lon) * k, (x.lat - lat) * 111320) })).filter(n => n.m <= 402);
    const sum = f => near.reduce((t, n) => t + n.x[f], 0);
    return { crashes: sum('crashes'), ksi: sum('ksi'), pb: sum('pb'), places: near.length,
      worst: near.slice().sort((a, b) => a.x.rank - b.x.rank).slice(0, 4) };
  }
  const small = () => matchMedia('(max-width: 760px)').matches;
  const distText = m => (m < 160 ? `${Math.round(m * 3.28084 / 10) * 10} ft` : `${(m / 1609.34).toFixed(1)} mi`);
  function setPin(g, fly) {
    pinLayer.clearLayers();
    try { localStorage.setItem('ipm.pin', JSON.stringify(g)); } catch { /* storage unavailable */ }
    const nb = nearbySpots(g.lat, g.lon);
    // g.name is an optional nickname ("Home", "Maya's school"); g.label stays the real address for copying and reporting.
    const title = g.name || g.label;
    const html = `<div class="pin-pop"><div class="pin-head"><div class="pin-title">📍 ${esc(title)}</div>${g.name ? `<div class="pin-addr">${esc(g.label)}</div>` : ''}</div>
      <div class="pin-near">${nb.crashes
        ? `<p>Within a quarter mile, ${monthYear(meta.window_from)} to ${monthYear(meta.window_to)}: <b>${plural(nb.crashes, 'crash', 'crashes')}</b>${nb.ksi ? `, <b>${nb.ksi} killed or seriously hurt someone</b>` : ', none killed or seriously hurt anyone'}${nb.pb ? `, ${nb.pb} with people walking or biking` : ''}.</p>
          Highest-ranked places nearby:<ul>${nb.worst.map(n => `<li><button type="button" class="linkbtn" data-open="${n.x.rank}">#${fmt(n.x.rank)} ${esc(niceName(n.x.name))}</button>
            <span class="muted">${distText(n.m)}</span></li>`).join('')}</ul>`
        : 'No reported crashes within a quarter mile in the last five years.'}</div>
      <details class="pin-res" data-loc="${esc(g.label)}"><summary>Report a problem here</summary>${resourceList()}</details>
      <div class="pin-actions"><button type="button" class="linkbtn pin-copy">Copy address</button>
        <button type="button" class="linkbtn pin-rename">Rename</button>
        <button type="button" class="linkbtn pin-remove">Remove pin</button></div></div>`;
    const m = L.marker([g.lat, g.lon], {
      pane: 'pin', keyboard: true, title: title, alt: 'Your pin: ' + (g.name ? `${g.name}, ${g.label}` : g.label),
      icon: L.divIcon({ className: 'addr-pin', iconSize: [30, 42], iconAnchor: [15, 40], popupAnchor: [0, -36], html: '<span></span>' })
    }).bindPopup(html, { maxWidth: 320, maxHeight: small() ? 150 : 420, autoPanPaddingTopLeft: [12, 12], autoPanPaddingBottomRight: [12, 12] }).addTo(pinLayer);
    m.on('popupopen', e => {     // popups stop clicks from bubbling, so wire their buttons here
      const el = e.popup.getElement();
      el.querySelectorAll('[data-open]').forEach(b => (b.onclick = () => {
        const id = +b.dataset.open, p = byId.get(id), lite = searchIdx.find(x => x.rank === id);
        m.closePopup(); showTab(document.getElementById('tabbtn-priorities'));
        if (p) select(p, true, null); else if (lite) selectLite(lite);
      }));
      el.querySelector('.pin-copy').onclick = ev => {
        const b = ev.target; const done = () => { b.textContent = 'Address copied'; setTimeout(() => (b.textContent = 'Copy address'), 1800); };
        if (navigator.clipboard) navigator.clipboard.writeText(g.label).then(done, () => prompt('Copy this address:', g.label)); else prompt('Copy this address:', g.label);
      };
      el.querySelectorAll('.res-link').forEach(l => (l.onclick = () => navigator.clipboard &&
        navigator.clipboard.writeText(g.label).then(() => toast('Address copied: ' + g.label + '. Paste it into the form.'), () => {})));
      el.querySelector('.pin-remove').onclick = () => { pinLayer.clearLayers(); try { localStorage.removeItem('ipm.pin'); } catch { /* ignore */ } };
      el.querySelector('.pin-rename').onclick = () => {
        const head = el.querySelector('.pin-head');
        head.innerHTML = `<form class="pin-rename-form"><label for="pinName">Name this pin</label>
          <input id="pinName" type="text" maxlength="40" autocomplete="off" placeholder="e.g. Home, Work, School">
          <div class="pin-rename-btns"><button type="submit" class="pin-save">Save</button>
          <button type="button" class="linkbtn pin-cancel">Cancel</button></div>
          <small class="pin-privacy">Leave it empty to show the address. Saved only on this device.</small></form>`;
        const inp = head.querySelector('input'); inp.value = g.name || '';
        inp.focus(); inp.select();
        const reopen = () => setPin(g, false).openPopup();
        head.querySelector('form').onsubmit = ev => {
          ev.preventDefault();
          const v = inp.value.trim().replace(/\s+/g, ' ').slice(0, 40);
          if (v) g.name = v; else delete g.name;
          reopen();
          say(v ? `Pin renamed to ${v}.` : 'Pin name cleared. It shows the address.');
        };
        head.querySelector('.pin-cancel').onclick = reopen;
        inp.onkeydown = ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); reopen(); } };
      };
    });
    if (fly) {
      say(`Address pinned: ${g.label}. ${nb.crashes ? plural(nb.crashes, 'crash', 'crashes') + ' within a quarter mile.' : 'No crashes within a quarter mile.'}`);
      if (!detailEl.hidden) closeDetail(false);
      const go = () => { m.openPopup(); };
      // On phones the map is short: put the pin low so its pop-up fits above it.
      let c = L.latLng(g.lat, g.lon);
      if (small()) c = map.unproject(map.project(c, 16).subtract([0, map.getSize().y * 0.38]), 16);
      if (reduceMotion) { map.setView(c, 16, { animate: false }); go(); }
      else { map.once('moveend', go); map.flyTo(c, 16, { duration: 0.8 }); }
    }
    return m;
  }
  try { const g = JSON.parse(localStorage.getItem('ipm.pin')); if (g && inSeattle(g.lat, g.lon)) setPin(g, false); } catch { /* none saved */ }

  // ---------- tabs ----------
  const tabs =[...document.querySelectorAll('nav [role=tab]')];
  function showTab(b) {
    tabs.forEach(x => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; });
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
    const budget = b.dataset.tab === 'spending';
    document.body.classList.toggle('budget-view', budget);
    document.getElementById('mapNote').hidden = !budget;
    applyPanel();
    setLineView(b.dataset.tab === 'traffic' ? 'traffic' : b.dataset.tab === 'walk' ? 'walk' : null);
  }
  tabs.forEach((b, i) => {
    b.addEventListener('click', () => showTab(b));
    b.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; showTab(n); n.focus();
    });
  });

  // ---------- Traffic view: where buses lose time, and the busiest streets ----------
  // Shown on its own tab, with its own map lines. It doesn't change the safety ranking; each street lists the
  // safety spots along it, so people can see where the two overlap.
  const T = D.traffic || { stretches: [], segments: [] };
  const tLayer = L.featureGroup();
  let trafficOn = false, tSel = null, tLines = new Map();
  const hourName = h => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;
  const longDate = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const stopShort = s => s.replace(/ - Bay \w+$/, '').replace(/\s+/g, ' ').trim();
  // "Pine St & 9th Ave" + "Pine St & 4th Ave" -> "Pine St: 9th Ave to 4th Ave"
  function stretchName(s) {
    const a = stopShort(s.from), b = stopShort(s.to);
    const A = a.split(' & '), B = b.split(' & ');
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
    .filter(p => p.rank != null && p.rank <= 200 && distToLine(p.lat, p.lon, pts) <= 25)
    .sort((a, b) => a.rank - b.rank);

  const TMODES = {
    bus: {
      hint: `Stretches of bus route where the timetable gives buses the most extra time per mile, compared with the quickest
        hours (usually late night or early morning), added up over every weekday bus. Ranked by bus time lost per mile, so short, badly jammed stretches rank high. From King County Metro's current weekday timetable${T.weekday ? ' (the schedule in effect on ' + longDate(T.weekday) + ')' : ''}.`,
      items: () => T.stretches.filter(s => s.rank).sort((a, b) => a.rank - b.rank),
      rank: s => s.rank, name: stretchName,
      sub: s => `Routes ${s.routes.slice(0, 8).join(', ')}${s.routes.length > 8 ? '…' : ''}`,
      score: s => `${Math.round(s.lpm / 60)} h <small>lost per mile</small>`,
      chips: s => [
        { cls: 'serious', text: `+${(s.peak - s.base).toFixed(1)} min a bus at ${hourName(s.hr)} (${Math.round(100 * s.slower)}% slower)` },
        { cls: 'ped', text: `${fmt(s.trips)} buses a weekday` },
        { cls: 'state', text: `Buses lose ${(s.lost / 60).toFixed(1)} hours a day here` }],
      note: `Metro sets each trip's scheduled time from how long buses really take at that hour, so busy-hour times include
         traffic and extra time for people getting on and off. It's measured between Metro's timed stops (usually ½ to 1½ miles
         apart; a few blocks downtown), so the slowdown could be anywhere along the stretch. Stretches under a quarter mile are
         left out (the timetable is in whole minutes). Inside Seattle only.`,
      detail: s => `
      <div class="dhead">
        <div class="where">${esc(TMODES.bus.sub(s))} · ${copyLoc(stretchName(s))}</div>
        <p class="verdict">At ${hourName(s.hr)} on a weekday, Metro gives buses <b>${s.peak} minutes</b> for this
          ${s.mi}-mile stretch, compared with ${s.base} minutes in the quickest (late-night) hours: <b>${Math.round(100 * s.slower)}% slower</b>.
          ${fmt(s.trips)} buses run it each weekday; together they lose about <b>${(s.lost / 60).toFixed(1)} hours a day</b> here.</p>
        <div class="stat-grid">
          ${stat(s.base + ' min', 'quickest hours (late night)')}${stat(s.peak + ' min', 'at ' + hourName(s.hr))}
          ${stat(fmt(s.trips), 'buses a weekday')}${stat((s.lost / 60).toFixed(1) + ' h', 'bus time lost a day')}
        </div>
      </div>
      ${reportBox(stretchName(s))}
      <h3>Safety spots along this stretch</h3>${safetyList(safetyAlong(s.pts))}
      <h3>About this measure</h3>
      <div class="note">From ${stopShort(s.from)} to ${stopShort(s.to)}. Metro sets scheduled times from how long buses really take
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
  const SMODES = {
    missing: {
      hint: `Blocks with no sidewalk, in SDOT's own order of priority. SDOT scores each missing block for safety, equity, schools,
        transit, parks and nearby homes and shops, and sorts them into Tier 1 (build first) to Tier 5.
        ${fmt(SW.counts.tier1_blocks || 0)} of ${fmt(SW.counts.missing_blocks || 0)} blocks with a missing sidewalk are Tier 1.`,
      items: () => SW.missing, rank: s => s.id, name: s => blockName(s.name),
      sub: s => [s.hood, s.art && s.art !== 'Not Designated' ? s.art : 'Neighborhood street'].filter(Boolean).join(' · '),
      score: s => `Tier ${s.tier} <small>SDOT score ${s.score}</small>`,
      chips: s => [
        { cls: 'serious', text: s.sides === 2 ? 'No sidewalk on either side' : 'No sidewalk on one side' },
        ...(s.safety ? [{ cls: 'fatal', text: `SDOT safety score ${s.safety}` }] : []),
        ...(s.school ? [{ cls: 'ped', text: 'near a school' }] : []),
        ...(s.transit ? [{ cls: 'state', text: 'near transit' }] : [])],
      note: `From the Pedestrian Element of the Seattle Transportation Plan. Scores and tiers are SDOT's; this site only puts
        them on a map with the crash ranking. Within a tier, blocks are ordered by SDOT's score, then length.`,
      detail: s => `
      <div class="dhead">
        <div class="where">${esc(SMODES.missing.sub(s))} · ${copyLoc(blockName(s.name))}</div>
        <p class="verdict"><b>${s.sides === 2 ? 'No sidewalk on either side' : 'No sidewalk on one side'}</b> of this
          ${ftText(s.ft)} block. SDOT puts building one in <b>Tier ${s.tier}</b> of 5 (Tier 1 = build first), with a score of
          ${s.score}.</p>
        <div class="stat-grid">
          ${stat(s.safety ?? 0, 'safety score')}${stat(s.equity ?? 0, 'equity score')}
          ${stat(s.school ?? 0, 'school score')}${stat(s.transit ?? 0, 'transit score')}
        </div>
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
        .on('click', () => selectTraffic(s));
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
      li.querySelector('button').onclick = () => selectTraffic(s, true);
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
    ? `<ul class="tight">${list.slice(0, 8).map(p => `<li><button type="button" class="linkbtn" data-open="${p.rank_ksi}">#${p.rank} ${esc(p.name)}</button>
        <span class="muted">· ${plural((p.killed ?? 0) + (p.seriously_injured ?? 0), 'person', 'people')} killed or seriously hurt</span></li>`).join('')}</ul>
       ${list.length > 8 ? `<div class="note">and ${list.length - 8} more in the safety top 200.</div>` : ''}`
    : '<div class="note">None of the safety top 200 are along here.</div>';

  function selectTraffic(s, fly) {
    rememberView();
    const M = curMode();
    tSel = s; current = null;
    tLines.forEach((line, k) => line.setStyle(lineStyle(line._t, k === tKey(s))));
    document.querySelectorAll('#' + V().list + ' li').forEach(li => li.classList.toggle('selected', li.dataset.k === tKey(s)));
    document.getElementById('detailTitle').innerHTML = `<span class="drank">#${M.rank(s)}</span> ${esc(M.name(s))}`;
    document.getElementById('detailBody').innerHTML = M.detail(s);
    const wasHidden = detailEl.hidden;
    detailEl.hidden = false;
    if (wasHidden) setSheet(false);
    applyLayout();
    const b = L.latLngBounds(flatPts(s.pts));
    if (fly !== false) flyBounds(b, { paddingTopLeft: [40, 40], paddingBottomRight: [!isNarrow() ? detailEl.offsetWidth + 40 : 40, 40], maxZoom: 16 });
    document.getElementById('detailBody').scrollTop = 0;
    document.getElementById('detailBody').onclick = e => {
      const o = e.target.closest('[data-open]'); if (!o) return;
      const p = byId.get(+o.dataset.open); if (!p) return;
      showTab(document.getElementById('tabbtn-priorities')); select(p, true, null);
    };
    document.getElementById('detailBody').onchange = null;
  }
  Object.values(VIEWS).forEach(v => { v.modeEl.onchange = v.topEl.onchange = () => { if (tSel) closeDetail(false); renderTraffic(); }; });

  // "Sidewalks here" on a safety spot: SDOT's missing-sidewalk tier and sidewalk rated poor, right at the spot.
  function sidewalksHere(p) {
    const out = [];
    if (p.sw_missing_tier) out.push(`<p><b>Part of this spot has no sidewalk.</b> SDOT puts building one in <b>Tier ${p.sw_missing_tier}</b>
      of 5 (Tier 1 = build first).</p>`);
    if (p.sw_poor_ft) out.push(`<p><b>${ftText(p.sw_poor_ft)}</b> of sidewalk here rated poor or very poor by SDOT${p.sw_poor_assessed ? ` (rated ${p.sw_poor_assessed}; may have been fixed since)` : ''}.</p>`);
    if (!out.length) return '';
    return out.join('') + '<div class="note">From SDOT\'s Seattle Transportation Plan and sidewalk inventory. Shown for context; not part of the safety score.</div>';
  }

  // "Traffic here" on a safety spot: buses, the bus stretch through it, and real traffic counts over the years.
  function trafficHere(p) {
    const out = [];
    const st = p.bus_stretch_id && T.stretches.find(x => x.id === p.bus_stretch_id);
    if (p.bus_trips) out.push(`<p><b>${fmt(p.bus_trips)} buses</b> a weekday${p.bus_routes && p.bus_routes.length ? ` <span class="muted">(routes ${esc(p.bus_routes.slice(0, 10).join(', '))}${p.bus_routes.length > 10 ? '…' : ''})</span>` : ''}.</p>`);
    if (st) out.push(`<p>On the bus stretch through here (${esc(stretchName(st))}), buses are <b>${Math.round(100 * st.slower)}% slower at
        ${hourName(st.hr)}</b>: ${st.base} minutes in the quickest (late-night) hours, ${st.peak} at its slowest.
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
    if (!detailEl.hidden) closeDetail(false);
    tSel = null;
    if (name) { if (!was) { map.removeLayer(layer); clearFocus(); tLayer.addTo(map); } renderTraffic(); }
    else { map.removeLayer(tLayer); layer.addTo(map); }
  }

  // ---------- capital budget tab ----------
  (function budget() {
    const years = [...new Set(D.budget.map(b => b.year))].sort();
    const thisYear = new Date().getFullYear();
    const ABOUT = {
      'Major Maintenance/Replacement': 'Keeping what exists working: arterial repaving, bridges and structures, sidewalk repair, signals.',
      'Mobility-Capital': 'Building new: sidewalks, Vision Zero safety projects, protected bike lanes, curb ramps, transit corridors.',
      'Central Waterfront': 'The Alaskan Way and waterfront rebuild.',
      'Major Projects': 'Large one-off projects, such as SR 520 and the Magnolia Bridge.',
      'Capital General Expense': 'Debt payments for past capital work.'
    };
    const expand = s => s.replace(/^MC-TR-C\d+ -\s+/, '').replace(/^TRC\d+ - /, '')
      .replace(/\bPMP\b/, 'Pedestrian Master Plan').replace(/\bBMP\b/, 'Bicycle Master Plan')
      .replace(/\bCWF\b/, 'Central Waterfront').replace(/\bAWMC\b/, 'Alaskan Way Main Corridor')
      .replace(/\bST3\b/, 'ST3').replace(/\bREET\b/, 'REET (real estate excise tax)').replace(/\bEW\b/, 'East-West');
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
        .map(([name, ys]) => `<tr><td>${esc(expand(name))}</td>${cells(ys)}</tr>`).join('');
      html += `<details><summary>${esc(prog)}: ${money(sum(g.total))}</summary>
        <p class="note">${esc(ABOUT[prog] || '')}</p>
        <div class="tablewrap"><table>${head}${rows}<tr class="total"><td>Program total</td>${cells(g.total)}</tr></table></div></details>`;
    });
    document.getElementById('budget').innerHTML = `
      <p class="note">SDOT's <b>capital budget</b> by program, from the City of Seattle Capital Budget dataset. These are
        <b>budgeted</b> amounts, net of mid-year cuts (some lines are negative), <b>not money actually spent</b>.
        The city's budget data has no location field, so it can't be placed on the map yet.</p>
      <div class="tablewrap"><table>${head}<tr class="total"><td class="nowrap">All SDOT capital</td>${cells(grand)}</tr></table></div>
      <p class="note">† current year's budget. * planned future years. Click a program for its projects.</p>
      ${html}
      <p class="note">Abbreviations: ST3 = Sound Transit 3; BUD = a budget-level entry in the city's data. Projects are matched
        across years by their city project number and shown under their newest name.</p>
      ${D.budget.some(b => b.levy) && !D.budget.some(b => b.levy && b.year === 2025) ? `<p class="note">The Transportation Levy voters
        approved in November 2024 shows up in this data from 2026 on; 2025 has no levy money in it, so 2025 may be understated.</p>` : ''}`;
    function sum(o) { return Object.values(o).reduce((a, b) => a + b, 0); }
  })();

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
            ${esc(groupName(ex.ref_group))}, so luck matters less.</li>
          <li><b>Score ${fmt(Math.round(ex.score_ksi))}.</b> × ${(1 + ex.request_boost).toFixed(2)} for nearby safety-related repair requests.</li>
        </ol>
      </div>` : '';
    const ksi = `
      <h3>"Most likely to hurt people" ranking, in full</h3>
      <ol>
        <li><b>Crash harm.</b> Points per crash: killed or seriously injured ${k}, other injury ${weight('injury')},
          property damage only ${weight('pdo')}, × ${weight('ped_bike_mult')} when someone walking or biking was hurt.
          Fatal and serious count alike because whether a crash kills depends heavily on chance (age, vehicle, ambulance
          time). Vision Zero programs use the same "KSI" grouping. Since January 2026 about 1 in 10 reports has no severity; those
          aren't treated as harmless: each gets the typical non-fatal/serious harm for similar streets.</li>
        <li><b>Repeated deaths compound.</b> The 1st fatal crash at a spot counts ${k}, the 2nd ${(k * g).toFixed(1)},
          the 3rd ${(k * g * g).toFixed(1)} (each × ${g} the last). This extra weight then goes through step 3 like all fatal/serious
          harm: at a spot with few crashes, most of it is replaced by the typical rate. That's why places where 2 or more people
          died are also listed separately, whatever their rank.</li>
        <li><b>Expected harm.</b> A spot with few crashes can look deadly or safe by luck. So its fatal/serious harm is blended
          with the typical rate for similar spots (same kind of location and street class), weighted by its crash count:
          own record × crashes ÷ (crashes + ${A}). A spot with 5 crashes leans ${Math.round(100 * A / (5 + A))}% on the typical
          rate; one with 60 leans ${Math.round(100 * 60 / (60 + A))}% on its own record. Every crash, even a fender-bender,
          is evidence of how much conflict happens there. (Statisticians call this empirical Bayes.)</li>
        <li><b>Repair boost.</b> Safety-related requests (${scored.map(r => esc(r.type)).join(', ')}) within
          ${ft(weight('request_radius_m'))} ft since ${monthYear(meta.requests_scored_from)} raise the score by up to
          +${Math.round(100 * bmax)}% (half that at ${bhalf} request points). Duplicate reports of the same thing in the same
          month count once. ${unscored.map(r => esc(r.type)).join(', ')} requests are shown but not scored: they aren't
          clearly tied to crashes, or weren't collected for the whole period.</li>
      </ol>`;
    const risk = `
      <h3>Risk for its traffic</h3>
      <p>Expected harm per million vehicles over the five years: vehicles entering an intersection (the streets' weekday counts
        added together) or using a block, × 365 × 5. Weekday counts overstate weekends a little. Blocks and intersections share one
        list, but a long block carries its traffic farther, so long blocks can look riskier than they are. This surfaces places that are dangerous <i>for how busy they are</i>. Only spots with an SDOT
        count and at least ${weight('risk_min_crashes')} crashes are ranked; volumes under ${fmt(weight('risk_vol_floor'))}
        count as ${fmt(weight('risk_vol_floor'))}. SDOT's counts range from 2013 to 2024 and some are estimates; each
        spot shows which it uses.</p>
      <p class="note">Why isn't this the default? Total harm counts every person hurt. A busy street with many injuries
        affects more people than a quiet one with a high rate.</p>`;
    const V = (meta.validation || []).reduce((o, a) => (o[a.method] = a, o), {});
    const vname = { expected: 'This site (expected harm)', old_reliability: 'Previous version of this site', crash_count: 'Most crashes',
                    raw_harm: 'Crash harm, no blending', ksi_count: 'Most fatal/serious crashes' };
    const validation = `
      <h3>Does it predict anything?</h3>
      <p>The test: rank spots using only ${monthYear(meta.window_from)}–${monthYear(new Date(new Date(meta.test_from + 'T12:00:00') - 864e5).toISOString().slice(0, 10))},
        then count the fatal and serious crashes that happened at each method's top 50 afterwards
        (${monthYear(meta.test_from)}–${monthYear(meta.window_to)}; ${fmt(meta.test_ksi_total)} citywide).</p>
      <table class="vtable"><thead><tr><th scope="col">Method</th><th scope="col">Top 50</th><th scope="col">Top 200</th></tr></thead><tbody>
        ${(meta.validation || []).map(v => `<tr class="${v.method === 'expected' ? 'total' : ''}"><td>${vname[v.method] || v.method}</td><td>${v.k50}</td><td>${v.k200}</td></tr>`).join('')}
      </tbody></table>
      <p class="note">Ranking on fatal/serious crashes alone predicts worst: those are rare enough that luck dominates.
        Blending them with crash counts does best. That's why the method is what it is.</p>
      <p class="note">This test was also used to choose the method, so a fresh test would likely do somewhat worse. The repair-request
        boost isn't included in it. Spots that rank high after a bad stretch usually improve somewhat on their own (regression to
        the mean): the blending corrects the fatal/serious share for luck, but not the crash count itself.</p>`;
    const ag = (meta.sdot_agreement || []).reduce((o, a) => (o[a.mode] = a, o), {});
    const agRow = (m, label) => ag[m] ? `<tr><td>${label}</td><td>${ag[m].on_hin}</td><td>${ag[m].on_hin_high}</td><td>${ag[m].sdot_hcl_recent}</td></tr>` : '';
    const agreement = `
      <h3>Consistency with SDOT's lists</h3>
      <p>SDOT's High Injury Network and High Collision Locations come from overlapping crash data, so this is a
        consistency check, not independent proof. Top 50 of each ranking:</p>
      <table class="vtable"><thead><tr><th scope="col"></th><th scope="col">High Injury Network</th><th scope="col">of those "High"</th><th scope="col">High Collision list ${meta.window_from.slice(0, 4)}+</th></tr></thead><tbody>
        ${agRow('ksi', 'Most likely to hurt people')}${agRow('risk', 'Risk for its traffic')}
        ${agRow('baseline_crash_count', 'Baseline: 50 spots with most crashes')}
      </tbody></table>
      <p class="note">For scale: ${Math.round(100 * meta.busy_share_on_hin)}% of the ${fmt(meta.busy_locations)} spots with 10+ crashes are on the High Injury Network.</p>`;
    document.getElementById('about').innerHTML = `
      <h3>What this ranks</h3>
      <p>Every Seattle intersection and street block with a police-reported crash from ${monthYear(meta.window_from)} to
        ${monthYear(meta.window_to)} (${fmt(meta.collisions_scored)} SDOT collision reports), ranked by how likely people are to keep
        getting killed or seriously hurt there.</p>
      ${example}
      ${mode === 'risk' ? risk + ksi : ksi + risk}
      ${validation}
      ${agreement}
      <h3>Street details and SDOT actions</h3>
      <p class="note">From SDOT's street network, traffic counts, signal inventory and Vision Zero layers: street type, speed
        limit (the highest at the spot), pavement condition (0–100, labelled good 70+, fair 40–69, poor under 40 by this
        site, not SDOT), head-start walk signals and protected left turns. Shown for context; not part of the score.
        Aurora Ave N and the Aurora Bridge (SR 99), Lake City Way NE (SR 522), N/NE 145th St east of Aurora (SR 523) and the 1st Ave S
        Bridge (SR 509) are state highways: WSDOT shares responsibility.</p>
      <p class="note"><b>Crash patterns with a known fix</b> (blue dashed tags): left-turn crashes at a signal with no protected
        left-turn arrow, people walking hit by turning drivers where there's no head-start walk signal, and angle crashes at a corner
        with no signal, all according to SDOT's signal and Vision Zero data. They put a pattern next to a common fix; whether that
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
      <h3>Driver behavior</h3>
      <p class="note">Crashes involving speeding stay in the score. Repeated speeding at one spot usually points to road design
        (wide, straight streets invite speed), so it's flagged as context ("speed-related: 8 of 30") rather than excluded.</p>
      <h3>Known limits</h3>
      <ul>
        <li>The latest 3 months of crashes aren't scored: police reports arrive late, so those months look safer than they were.
          Citywide totals at the top include the ${fmt(meta.city_ksi_unlocated || 0)} fatal or serious reports that have no location.</li>
        <li>${fmt(meta.dropped_no_location)} crash reports (${meta.dropped_fatal} fatal, ${meta.dropped_ksi} fatal or serious) have no location and can't be placed.</li>
        <li>${fmt(meta.unknown_severity)} scored crash reports have unknown severity (almost all since January 2026, when SDOT's
          data began leaving it blank). They get the typical harm of a non-fatal crash on similar streets.</li>
        <li>Scores count crashes, not people: a crash that hurt three people counts once, at its worst injury. The death and
          injury numbers shown for each place count people.</li>
        <li>Only police-reported crashes. Minor crashes, and falls by people biking with no vehicle involved, often go unreported.</li>
        <li>Freeway mainlines (I-5, I-90, SR 520), handled by the State Patrol, are mostly not in SDOT's data.</li>
        <li>Severity is the officer's judgment at the scene; a later death may not be added. "Speed-related" is what the officer
          noted (${fmt(meta.city_speeding || 0)} of ${fmt(meta.collisions_scored)} crashes).</li>
        <li>Only places with a reported crash are scored. A street can be dangerous before anyone is hurt (wide, fast, no crossings).</li>
        <li>SDOT names each side of a divided street separately (for example both sides of Martin Luther King Jr Way S); those
          are merged into one place when they're within about 60 m. Probable duplicate reports are counted once.</li>
        <li>Longer blocks collect more crashes. Each block shows its length; the score isn't adjusted because doing so made
          predictions worse in the test above.</li>
        <li>Requests are counted within ${ft(weight('request_radius_m'))} ft of a point, which covers more of an intersection than of a long block.</li>
        <li>Traffic counts cover arterials only, and some are old or estimated.</li>
        <li>Find It Fix It status is unreliable (most requests stay "Reported"), so open and fixed requests count the same.</li>
        <li>Planned projects aren't linked to locations yet.</li>
      </ul>`;
  }
  renderAbout();

  // If nobody has refreshed the data for a while, say so plainly at the top.
  (function staleNotice() {
    const fetched = D.fetchedAt && new Date(D.fetchedAt.replace(' ', 'T'));
    if (!fetched || isNaN(fetched)) return;
    const days = Math.floor((Date.now() - fetched) / 864e5);
    if (days < 45) return;
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
        (${fmt(meta.top50_ksi)} of ${fmt(ksiAll)}) happened at just <b class="cs-hi">50 spots</b>, out of
        ${fmt(meta.locations_scored)} places with crashes. Those 50 are the top of this list.${pbShare ? ` <b class="cs-hi">${pbShare}%</b> of
        those crashes involved someone walking or biking.` : ''}</div>
      ${meta.forward_top50_ksi ? `<div class="cs-note">Predicting is harder: ranked on the first 3 years, the top 50 had
        ${fmt(meta.forward_top50_ksi)} of the next 2 years' ${fmt(meta.test_ksi_total)} fatal or serious crashes
        (${Math.round(100 * meta.forward_top50_ksi / meta.test_ksi_total)}%). From police reports in SDOT's data; freeways not included.</div>` : ''}`;
    if (reduceMotion) return;
    el.querySelectorAll('b[data-n]').forEach(b => {
      const to = +b.dataset.n, pct = b.hasAttribute('data-pct'), t0 = performance.now(), dur = 1100;
      const step = t => { const k = Math.min(1, (t - t0) / dur), v = to * (1 - Math.pow(1 - k, 3));
        b.textContent = pct ? v.toFixed(1) + '%' : fmt(Math.round(v)); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
      setTimeout(() => (b.textContent = pct ? to.toFixed(1) + '%' : fmt(to)), dur + 300);   // always land on the true value
    });
  })();

  render();

  // Shareable links: index.html#loc=12 opens the spot ranked #12 in the recommended ranking.
  function openFromHash() {
    const m = location.hash.match(/^#(?:loc=)?(\d+)$/);
    if (!m) return false;
    const id = +m[1];
    const p = byId.get(id);
    if (p) { select(p, true, null); return true; }
    const s = searchIdx.find(x => x.rank === id);
    if (s) { selectLite(s); return true; }
    return false;
  }
  window.addEventListener('hashchange', openFromHash);
  if (!openFromHash() && layer.getLayers().length) map.fitBounds(layer.getBounds(), { padding: [30, 30], maxZoom: 15 });
})();
