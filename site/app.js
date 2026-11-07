/* Seattle Infrastructure Priority Map: v1 front end. Data comes from window.SITE_DATA (data/data.js). */
(function () {
  const D = window.SITE_DATA;
  const meta = D.meta;
  const fmt = n => Number(n).toLocaleString('en-US');
  const money = n => '$' + (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : fmt(Math.round(n)));
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  const titleCase = s => s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase())
    .replace(/\b(Ne|Nw|Se|Sw|N|S|E|W)\b/g, m => m.toUpperCase());
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  document.getElementById('subtitle').textContent =
    `${fmt(meta.collisions)} collisions (${meta.collisions_from} to ${meta.collisions_to}) and ` +
    `${fmt(meta.requests)} infrastructure service requests across ${fmt(meta.locations_scored)} locations. ` +
    `Data fetched ${D.fetchedAt || 'unknown'}.`;

  // ---------- reasons: plain-language explanation of each score ----------
  function reasons(p) {
    const out = [];
    if (p.fatal) out.push({ cls: 'fatal', text: `${p.fatal} fatal crash${p.fatal > 1 ? 'es' : ''}` });
    if (p.serious) out.push({ cls: 'serious', text: `${p.serious} serious-injury` });
    if (p.injury) out.push({ cls: '', text: `${p.injury} injury` });
    if (p.ped_crashes) out.push({ cls: 'ped', text: `${p.ped_crashes} hit pedestrians` });
    if (p.bike_crashes) out.push({ cls: 'ped', text: `${p.bike_crashes} hit cyclists` });
    const wet = pct(p.wet_crashes, p.road_known), cityWet = Math.round(100 * meta.city_wet_share);
    if (p.road_known >= 5 && wet >= cityWet + 15) out.push({ cls: 'cond', text: `${wet}% on wet roads (city ${cityWet}%)` });
    const dark = pct(p.dark_crashes, p.light_known), cityDark = Math.round(100 * meta.city_dark_share);
    if (p.light_known >= 5 && dark >= cityDark + 15) out.push({ cls: 'cond', text: `${dark}% in the dark (city ${cityDark}%)` });
    if (p.unlit_crashes) out.push({ cls: 'cond', text: `${p.unlit_crashes} with streetlights off/none` });
    if (p.requests) out.push({ cls: '', text: `${p.requests} nearby repair requests` });
    return out;
  }

  // ---------- map ----------
  const map = L.map('map', { zoomControl: true }).setView([47.61, -122.33], 12);
  // Basemaps that need no API key. (CARTO started requiring a key.)
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
  L.control.layers(baseLayers, null, { position: 'topleft' }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  const color = r => (r <= 10 ? '#b3141b' : r <= 25 ? '#e0561f' : r <= 50 ? '#f0a020' : '#7a8597');

  let markers = {}, selected = null;

  function render() {
    const n = +document.getElementById('topN').value;
    const type = document.getElementById('addrFilter').value;
    const rows = D.priorities.filter(p => !type || p.addr_type === type).slice(0, n);
    const maxScore = Math.max(...rows.map(r => r.score), 1);

    layer.clearLayers(); markers = {};
    rows.forEach(p => {
      const m = L.circleMarker([p.lat, p.lon], {
        radius: 5 + 11 * Math.sqrt(p.score / maxScore), color: '#fff', weight: 1.5,
        fillColor: color(p.rank), fillOpacity: 0.88
      }).bindTooltip(`#${p.rank} ${esc(titleCase(p.location))}`).on('click', () => select(p));
      m.addTo(layer); markers[p.rank] = m;
    });

    const list = document.getElementById('list');
    list.innerHTML = rows.map(p => `
      <li data-rank="${p.rank}">
        <div class="row1"><span class="rank">#${p.rank}</span><span class="loc">${esc(titleCase(p.location))}</span>
          <span class="score">${p.score}</span></div>
        <div class="chips">${reasons(p).map(r => `<span class="chip ${r.cls}">${esc(r.text)}</span>`).join('')}</div>
      </li>`).join('');
    list.querySelectorAll('li').forEach(li =>
      li.addEventListener('click', () => select(D.priorities.find(p => p.rank === +li.dataset.rank), true)));
  }

  function select(p, fly) {
    selected = p.rank;
    document.querySelectorAll('#list li').forEach(li => li.classList.toggle('selected', +li.dataset.rank === p.rank));
    const li = document.querySelector(`#list li[data-rank="${p.rank}"]`);
    if (li && !fly) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (fly) map.flyTo([p.lat, p.lon], 17, { duration: 0.6 });

    const kind = { I: 'Intersection', B: 'Street block', A: 'Alley' }[p.addr_type] || 'Location';
    const reqs = (p.request_types || []).map(r => `<li>${esc(r.type)}: ${r.n}</li>`).join('');
    const sv = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat},${p.lon}`;
    document.getElementById('detailBody').innerHTML = `
      <h2>#${p.rank} ${esc(titleCase(p.location))}</h2>
      <div class="note">${kind} · score ${p.score} = crash points ${p.crash_points} + repair-request points ${p.request_points} × ${weight('request_mult')}</div>
      <div class="stat-grid">
        <div class="stat"><b>${p.crashes}</b><span>crashes</span></div>
        <div class="stat"><b>${p.fatal + p.serious}</b><span>fatal + serious</span></div>
        <div class="stat"><b>${p.ped_crashes + p.bike_crashes}</b><span>ped / bike</span></div>
      </div>
      <h3>Why it ranks here</h3>
      <ul>${reasons(p).map(r => `<li>${esc(r.text)}</li>`).join('')}</ul>
      <h3>Crash conditions</h3>
      <ul>
        <li>Wet/icy road: ${p.wet_crashes} of ${p.road_known} with road condition recorded (${pct(p.wet_crashes, p.road_known)}%; city ${Math.round(100 * meta.city_wet_share)}%)</li>
        <li>Dark: ${p.dark_crashes} of ${p.light_known} (${pct(p.dark_crashes, p.light_known)}%; city ${Math.round(100 * meta.city_dark_share)}%)</li>
        <li>Streetlights off or none: ${p.unlit_crashes}</li>
        <li>Crashes from ${p.first_crash} to ${p.last_crash}</li>
      </ul>
      <h3>Repair requests within ${weight('request_radius_m')} m</h3>
      ${reqs ? `<ul>${reqs}</ul>` : '<div class="note">None in Find It Fix It data.</div>'}
      <h3>Planned work</h3>
      <div class="note">Not linked yet. Seattle's budget data has no locations (see the SDOT spending tab).</div>
      <p><a href="${sv}" target="_blank" rel="noopener">Open Street View here ↗</a></p>`;
    document.getElementById('detail').hidden = false;
  }
  document.getElementById('closeDetail').onclick = () => (document.getElementById('detail').hidden = true);
  document.getElementById('topN').onchange = render;
  document.getElementById('addrFilter').onchange = render;

  function weight(k) { const w = meta.weights.find(x => x.k === k); return w ? w.v : '?'; }

  // ---------- tabs ----------
  document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  }));

  // ---------- spending tab ----------
  (function budget() {
    const years = [...new Set(D.budget.map(b => b.year))].sort();
    const thisYear = new Date().getFullYear();
    const byProg = {};
    D.budget.forEach(b => {
      const g = (byProg[b.program] ||= { total: {}, projects: {} });
      g.total[b.year] = (g.total[b.year] || 0) + b.amount;
      const pr = (g.projects[b.project] ||= {});
      pr[b.year] = (pr[b.year] || 0) + b.amount;
    });
    const head = `<tr><th></th>${years.map(y => `<th class="${y > thisYear ? 'planned' : ''}">${y}${y > thisYear ? '*' : ''}</th>`).join('')}</tr>`;
    const cells = obj => years.map(y => `<td class="${y > thisYear ? 'planned' : ''}">${obj[y] ? money(obj[y]) : '–'}</td>`).join('');
    const grand = {};
    let html = '';
    Object.entries(byProg).sort((a, b) => sum(b[1].total) - sum(a[1].total)).forEach(([prog, g]) => {
      years.forEach(y => (grand[y] = (grand[y] || 0) + (g.total[y] || 0)));
      const rows = Object.entries(g.projects).sort((a, b) => sum(b[1]) - sum(a[1]))
        .map(([name, ys]) => `<tr><td>${esc(name.replace(/^MC-TR-C\d+ - /, ''))}</td>${cells(ys)}</tr>`).join('');
      html += `<details><summary>${esc(prog)}: ${money(sum(g.total))} total</summary>
        <table>${head}${rows}<tr class="total"><td>Program total</td>${cells(g.total)}</tr></table></details>`;
    });
    document.getElementById('budget').innerHTML =
      `<table>${head}<tr class="total"><td>All SDOT capital</td>${cells(grand)}</tr></table>${html}
       <p class="note">* planned (future) years.</p>`;
    function sum(o) { return Object.values(o).reduce((a, b) => a + b, 0); }
  })();

  // ---------- about tab ----------
  document.getElementById('about').innerHTML = `
    <h3>What this ranks</h3>
    <p>Every Seattle intersection and street block with a reported collision since ${meta.collisions_from}, scored by
      how much harm happened there plus nearby infrastructure repair requests from Find It Fix It.</p>
    <h3>Crash points per collision</h3>
    <ul>
      <li>Fatal: ${weight('fatal')}</li><li>Serious injury: ${weight('serious')}</li>
      <li>Injury: ${weight('injury')}</li><li>Property damage only: ${weight('pdo')}</li>
      <li>× ${weight('ped_bike_mult')} if a pedestrian or cyclist was involved</li>
    </ul>
    <h3>Repair-request points</h3>
    <p>Requests within ${weight('request_radius_m')} m, weighted by type, then × ${weight('request_mult')}:</p>
    <ul>${meta.request_weights.map(r => `<li>${esc(r.type)}: ${r.w}</li>`).join('')}</ul>
    <p class="note">Encampment, parking, graffiti and similar report types are left out on purpose. This map is about
      fixing infrastructure, not policing.</p>
    <h3>Known limits (v1)</h3>
    <ul>
      <li>Fatal crashes are rare and partly random. A spot with 2 fatal crashes but few others can rank very high.</li>
      <li>Not adjusted for traffic volume yet. Busy streets naturally have more crashes.</li>
      <li>Find It Fix It status is unreliable (most requests stay "Reported"), so open and fixed requests count the same.</li>
      <li>Planned projects aren't linked to locations yet.</li>
    </ul>`;

  render();
})();
