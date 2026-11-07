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
      .replace(/\bWy\b/g, 'Way')
      .replace(/\bM L King Jr (?:[A-Z][a-z] )?(?:([NS]) )?Way\b/g,                    // SDOT spells it several ways
        (m, d) => 'Martin Luther King Jr Way' + (d ? ' (' + d + ')' : ''));
    t = t.replace(/ Between /, ' between ');
    if (/ between /.test(t)) t = t.replace(/ And /, ' and '); else t = t.replace(/ And /g, ' & ');
    return t;
  }
  const crashType = t => t.replace(/\s*--\s*/g, ', ');

  // ---------- ranking modes ----------
  const MODES = {
    ksi: { label: 'Most likely to hurt people', hint: 'Where people are most likely to keep getting killed or seriously hurt, based on 5 years of crashes. Start here.', unit: 'pts' },
    risk: { label: 'Risk for its traffic', hint: 'Dangerous for how busy it is: the same harm per vehicle. Often quieter streets.', unit: 'per 10k vehicles' }
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

  const scoreText = p => (mode === 'risk' ? `${Math.round(p.score)} <small>per 10k vehicles</small>` : `${fmt(Math.round(p.score))} <small>pts</small>`);
  const topShare = rank => { const s = (100 * rank) / N; return s < 1 ? `top ${Math.max(0.1, Math.ceil(s * 10) / 10)}%` : `top ${Math.ceil(s)}%`; };

  // ---------- reasons: plain-language chips, most important first ----------
  function reasons(p) {
    const out = [];
    if (p.fatal) out.push({ cls: 'fatal', text: `${plural(p.fatal, 'death')}` });
    if (p.serious) out.push({ cls: 'serious', text: `${p.serious} seriously injured` });
    const pb = [p.ped_crashes ? `${p.ped_crashes} with pedestrians` : '', p.bike_crashes ? `${p.bike_crashes} with cyclists` : ''].filter(Boolean);
    if (pb.length) out.push({ cls: 'ped', text: pb.join(', ') });
    const still = stillDangerous(p);
    if (still) out.push({ cls: 'still', text: still.short });
    if (p.ksi_years >= 3) out.push({ cls: 'still', text: `killed or seriously hurt in ${p.ksi_years} different years` });
    if (p.injury) out.push({ cls: '', text: `${p.injury} injury crashes` });
    const wet = pct(p.wet_crashes, p.road_known), cityWet = Math.round(100 * meta.city_wet_share);
    if (p.road_known >= 5 && wet >= cityWet + 15) out.push({ cls: 'cond', text: `${wet}% on wet roads (city ${cityWet}%)` });
    const dark = pct(p.dark_crashes, p.light_known), cityDark = Math.round(100 * meta.city_dark_share);
    if (p.light_known >= 5 && dark >= cityDark + 15) out.push({ cls: 'cond', text: `${dark}% in the dark (city ${cityDark}%)` });
    if (p.unlit_crashes) out.push({ cls: 'cond', text: `${p.unlit_crashes} with streetlights off/none` });
    if (p.speeding_crashes >= 2 && pct(p.speeding_crashes, p.crashes) >= 15)
      out.push({ cls: 'cond', text: `speeding in ${p.speeding_crashes} of ${p.crashes}` });
    if (p.state_route) out.push({ cls: 'state', text: `${p.state_route}: state highway` });
    if (p.confidence !== 'high')
      out.push({ cls: 'conf', text: `${p.confidence} confidence: ${plural(p.crashes, 'crash', 'crashes')}` });
    return out;
  }

  // Already treated or listed by SDOT, and still hurting people.
  function stillDangerous(p) {
    if (p.lpi_status === 'Existing' && p.ped_after_lpi >= 2) {
      const y = p.lpi_installed ? p.lpi_installed.slice(0, 4) : '';
      return { short: `${p.ped_after_lpi} pedestrian crashes after ${y} signal fix`,
        long: `SDOT gave pedestrians a head-start walk signal here in ${y || 'an unknown year'}; ${p.ped_after_lpi} crashes involving pedestrians have happened since. The standard low-cost fix hasn't been enough.` };
    }
    const first = p.sdot_hcl_years && p.sdot_hcl_years[0];
    if (first && first <= +meta.window_from.slice(0, 4) && p.ksi_after_hcl >= 2)
      return { short: `SDOT-listed since ${first}, still ${p.ksi_after_hcl} killed or seriously hurt`,
        long: `SDOT first put this on its High Collision Locations list in ${first}. Since then (in the scored years) ${p.ksi_after_hcl} crashes have killed or seriously injured someone.` };
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
      d.innerHTML = `
        <div><span class="lg-top"><span class="core">1</span></span>Top 10</div>
        <div>${sw(1)}11–25</div>
        <div>${sw(2)}26–50</div>
        <div>${sw(3)}51+</div>
        <div><i style="background:#fff;box-shadow:inset 0 0 0 3px #7a0c10"></i>Repeated deaths</div>
        <div><b class="lg-line"></b>Seattle city limits (area covered)</div>
        <button type="button" class="pausebtn" aria-pressed="${paused}">${paused ? 'Play' : 'Pause'} animation</button>`;
      L.DomEvent.disableClickPropagation(d);
      d.querySelector('.pausebtn').onclick = e => {
        paused = !paused; document.body.classList.toggle('paused', paused);
        e.target.textContent = `${paused ? 'Play' : 'Pause'} animation`; e.target.setAttribute('aria-pressed', paused);
        try { localStorage.setItem('ipm.paused', JSON.stringify(paused)); } catch { /* ignore */ }
      };
      return d;
    }
  });
  new Legend().addTo(map);
  document.body.classList.toggle('paused', paused);

  function currentRows() {
    const n = +document.getElementById('topN').value;
    const type = document.getElementById('addrFilter').value;
    const onlyFatal = document.getElementById('onlyFatal').checked;
    const ongoing = document.getElementById('onlyOngoing').checked;
    const keep = p => (!type || p.addr_type === type || (type === 'B' && p.addr_type === 'A'))
        && (!onlyFatal || p.fatal > 0) && (!ongoing || p.ksi_years >= 3);
    const rows = D.priorities.filter(p => p.rank != null && p.rank <= 200).filter(keep).slice(0, n);
    // Spots where 2+ people died are never left off, even when their predicted-harm rank is low.
    const inRows = new Set(rows.map(p => p.rank_ksi));
    const extra = D.priorities.filter(p => p.fatal >= 2 && !inRows.has(p.rank_ksi) && keep(p))
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
      m.bindTooltip(`${p.rank ? '#' + fmt(p.rank) + ' ' : ''}${esc(p.name)}: ${p.fatal} deaths`, { direction: 'top', offset: [0, -4] })
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
        <button type="button" class="card" aria-label="${rk} ${esc(p.name)}${isExtra ? ', ' + p.fatal + ' deaths' : ''}">
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
    const w = leftExpanded ? (leftWidths.expanded || Math.round(mainEl.offsetWidth / 2)) : leftWidths.normal;
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
    sheetBtn.textContent = full ? '⌄' : '⌃';
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
    if ((e.key === 'h' || e.key === 'H') && (inMap || inDetail || e.target === document.body)) { showAll(); return; }
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
    const n = Math.ceil((Math.max(mIdx(meta.collisions_to), mIdx(new Date().toISOString().slice(0, 10))) + 1) / 6);
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
      (!fixes.length ? "No signal fixes recorded here in SDOT data, so there's no fix line (repaving, sidewalks and redesigns aren't linked yet). " : '') +
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
    if (p.addr_type === 'I' && !p.signalized) items.push('No traffic signal in SDOT\'s signal data.');
    const still = stillDangerous(p);
    return `${still ? `<p class="callout">${esc(still.long)}</p>` : ''}
      ${items.length ? `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>` : '<div class="note">Nothing recorded in the SDOT layers this site reads.</div>'}
      <div class="note">From SDOT signal and Vision Zero data. Repaving, sidewalk and other projects aren't linked yet.</div>`;
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
        ${btn('speeding', 'Speeding', crashes.filter(filters.speeding).length)}
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
      (p.fatal ? ` (${plural(p.fatal, 'death')})` : '') : '; none killed or seriously injured anyone';
    parts.push(s + '.');
    const pb = [p.ped_crashes ? `${p.ped_crashes} involved people walking` : '', p.bike_crashes ? `${p.bike_crashes} people biking` : ''].filter(Boolean);
    if (pb.length) parts.push(pb.join(' and ') + '.');
    const st = [p.speed_limit ? `${p.speed_limit} mph` : '', (p.street_type || '').toLowerCase(), p.volume ? `${fmt(p.volume)} vehicles a weekday` : ''].filter(Boolean);
    if (st.length) parts.push(st.join(', ').replace(/^./, c => c.toUpperCase()) + '.');
    const rk = p.rank_ksi;
    const line2 = `Ranks <b>#${rk}</b> of ${fmt(N)} crash locations (${topShare(rk)})` +
      (p.rank_risk ? `, #${p.rank_risk} for its traffic` : '') + '.';
    const why = p.fatal >= 2 && rk > 50
      ? `<p class="callout">${p.fatal} people died here. It ranks #${fmt(rk)} because the ranking estimates where people are most
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
        (${(p.crashes * p.ref_ksi_harm_per_crash).toFixed(0)}).</p>
      <p class="note">Own-record weight = crashes ÷ (crashes + ${k}). Raw crash harm before blending: ${fmt(Math.round(p.harm))}.</p>
      <p><b>Score ${fmt(Math.round(p.score_ksi))}</b> = expected harm × repair boost ${(1 + p.request_boost).toFixed(2)}
        <span class="muted">(${plural(p.scored_requests, 'safety-related request')} since ${monthYear(meta.requests_scored_from)})</span>.
        Without the boost it would rank #${p.rank_noboost}.</p>`;
    const riskLine = p.score_risk != null
      ? `<p><b>Risk ${Math.round(p.score_risk)}</b> = expected harm ${fmt(Math.round(p.expected_harm))} ÷
          (${fmt(Math.max(p.volume, weight('risk_vol_floor')))} vehicles ÷ 10,000).</p>`
      : `<p class="note">Not ranked for risk: ${p.volume ? `fewer than ${weight('risk_min_crashes')} crashes` : 'no SDOT traffic count'}.</p>`;
    const ranks = `<p class="note">Ranks: #${p.rank_ksi} most likely to hurt people · ${p.rank_risk ? '#' + p.rank_risk : 'unranked'} for its traffic.</p>`;
    return (mode === 'risk' ? riskLine + ksiLine : ksiLine + riskLine) + ranks;
  }
  const groupName = g => {
    const [a, s] = g.split(' / ');
    return `${a === 'I' ? 'intersections' : 'blocks'} on ${{ principal: 'principal arterials', minor: 'minor arterials', collector: 'collector arterials', state: 'state routes and freeways', local: 'neighborhood streets' }[s] || s}`;
  };

  function select(p, fly, from, keepFocus) {
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
          <button type="button" class="linkbtn" id="copyLink">Copy link</button> ·
          <a href="https://www.seattle.gov/customer-service-bureau/find-it-fix-it-mobile-app" target="_blank" rel="noopener">Report a problem ↗</a></div>
        ${verdict(p)}
        <div class="stat-grid">
          <div class="stat"><b>${p.crashes}</b><span>crashes</span></div>
          <div class="stat"><b>${p.ksi}</b><span>killed or seriously hurt</span></div>
          <div class="stat"><b>${p.ped_crashes + p.bike_crashes}</b><span>with people walking or biking</span></div>
          <div class="stat"><b>${p.requests}</b><span>repair requests nearby</span></div>
        </div>
        <div class="chips dchips">${chips.map(r => `<span class="chip ${r.cls}">${esc(r.text)}</span>`).join('')}</div>
      </div>
      <div id="graphs" class="graphs"></div>
      <div class="dcols">
        <div class="dcol">
          ${sec('done', 'What SDOT has done here', treatments(p))}
          ${sec('street', 'The street', streetInfo(p))}
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
    current = { rank_ksi: s.rank, rank: null, lat: s.lat, lon: s.lon };
    opener = document.getElementById('search');
    history.replaceState(null, '', '#loc=' + s.rank);
    markCurrent();
    document.getElementById('detailTitle').innerHTML = `<span class="drank">#${s.rank}</span> ${esc(niceName(s.name))}`;
    document.getElementById('detailBody').innerHTML = `
      <div class="dhead">
        ${s.hood ? `<div class="where">${esc(s.hood)}${s.area && s.area !== s.hood ? ` <span class="muted">· ${esc(s.area)}</span>` : ''}</div>` : ''}
        <div class="note">${{ I: 'Intersection', B: 'Street block', A: 'Alley' }[s.type] || 'Location'} ·
          <a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${s.lat},${s.lon}" target="_blank" rel="noopener">Street View ↗</a> ·
          <a href="https://www.seattle.gov/customer-service-bureau/find-it-fix-it-mobile-app" target="_blank" rel="noopener">Report a problem ↗</a></div>
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
  searchIdx.forEach(s => (s.key = (niceName(s.name) + ' ' + s.hood + ' ' + s.area).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ')));
  const sInput = document.getElementById('search'), sList = document.getElementById('searchResults');
  let sHits = [], sActive = -1;
  function runSearch() {
    const q = sInput.value.toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (q.length < 2) { sList.hidden = true; sInput.setAttribute('aria-expanded', 'false'); return; }
    const words = q.split(' ');
    sHits = searchIdx.filter(s => words.every(w => s.key.includes(w))).slice(0, 8);   // index is in rank order
    sActive = -1;
    sList.innerHTML = sHits.length ? sHits.map((s, i) => `<li role="option" id="sr-${i}" data-i="${i}">
        <span>${esc(niceName(s.name))}${s.area ? `<small class="hood">${esc(s.area)}</small>` : ''}</span><small>#${fmt(s.rank)} · ${plural(s.crashes, 'crash', 'crashes')}</small></li>`).join('')
      : '<li class="none">No crash location matches. Only places with a reported crash are scored.</li>';
    sList.hidden = false; sInput.setAttribute('aria-expanded', 'true');
  }
  function pick(i) {
    const s = sHits[i]; if (!s) return;
    sList.hidden = true; sInput.setAttribute('aria-expanded', 'false'); sInput.value = niceName(s.name);
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
    else if (e.key === 'Escape') { sList.hidden = true; sInput.setAttribute('aria-expanded', 'false'); }
  });
  sList.addEventListener('mousedown', e => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); pick(+li.dataset.i); } });
  sInput.addEventListener('blur', () => setTimeout(() => { sList.hidden = true; sInput.setAttribute('aria-expanded', 'false'); }, 150));

  // ---------- tabs ----------
  const tabs = [...document.querySelectorAll('nav [role=tab]')];
  function showTab(b) {
    tabs.forEach(x => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; });
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
    const budget = b.dataset.tab === 'spending';
    document.body.classList.toggle('budget-view', budget);
    document.getElementById('mapNote').hidden = !budget;
  }
  tabs.forEach((b, i) => {
    b.addEventListener('click', () => showTab(b));
    b.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; showTab(n); n.focus();
    });
  });

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
      <p class="note">Abbreviations: ST3 = Sound Transit 3; BUD = a budget-level entry in the city's data.</p>`;
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
          time). Vision Zero programs use the same "KSI" grouping. Crashes with unknown severity (mostly recent reports
          still being processed) score 0.</li>
        <li><b>Repeated deaths compound.</b> The 1st fatal crash at a spot counts ${k}, the 2nd ${(k * g).toFixed(1)},
          the 3rd ${(k * g * g).toFixed(1)} (each × ${g} the last).</li>
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
      <p>Expected harm divided by traffic: vehicles entering an intersection (the streets' weekday counts added together)
        or using a block. This surfaces places that are dangerous <i>for how busy they are</i>. Only spots with an SDOT
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
        Blending them with crash counts does best. That's why the method is what it is.</p>`;
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
      <p>Every Seattle intersection and street block with a reported crash from ${monthYear(meta.window_from)} to
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
        Aurora Ave N (SR 99) and Lake City Way NE (SR 522) are state highways: WSDOT shares responsibility.</p>
      <p class="note">Encampment, parking, graffiti and similar report types are left out on purpose. This map is about
        fixing infrastructure, not policing.</p>
      <h3>Driver behavior</h3>
      <p class="note">Crashes involving speeding stay in the score. Repeated speeding at one spot usually points to road design
        (wide, straight streets invite speed), so it's flagged as context ("speeding in 8 of 30") rather than excluded.</p>
      <h3>Known limits</h3>
      <ul>
        <li>The latest 3 months of crashes aren't scored: police reports arrive late, so those months look safer than they were.</li>
        <li>${fmt(meta.dropped_no_location)} crash reports (${meta.dropped_fatal} fatal, ${meta.dropped_ksi} fatal or serious) have no location and can't be placed.</li>
        <li>${fmt(meta.unknown_severity)} scored crash reports have unknown severity and add no harm.</li>
        <li>Counts are of crashes, not people: a crash that hurt three people counts once, at its worst injury.</li>
        <li>Longer blocks collect more crashes. Each block shows its length; the score isn't adjusted because doing so made
          predictions worse in the test above.</li>
        <li>Requests are counted within ${ft(weight('request_radius_m'))} ft of a point, which covers more of an intersection than of a long block.</li>
        <li>Traffic counts cover arterials only, and some are old or estimated.</li>
        <li>Find It Fix It status is unreliable (most requests stay "Reported"), so open and fixed requests count the same.</li>
        <li>Planned projects aren't linked to locations yet.</li>
      </ul>`;
  }
  renderAbout();

  // Citywide summary at the top of the list: what's at stake, in people. Numbers count up once on load.
  (function citySummary() {
    const el = document.getElementById('citySummary'); if (!el || meta.city_killed == null) return;
    const oneIn = Math.round(meta.city_ksi_crashes / meta.top50_ksi);
    el.innerHTML = `
      <div class="cs-head">Seattle streets, ${monthYear(meta.window_from)} – ${monthYear(meta.window_to)}</div>
      <div class="cs-nums">
        <div><b data-n="${meta.city_killed}">${fmt(meta.city_killed)}</b><span>people killed</span></div>
        <div><b data-n="${meta.city_serious}">${fmt(meta.city_serious)}</b><span>seriously injured</span></div>
      </div>
      <div class="cs-foot"><b class="cs-hi">About 1 in ${oneIn}</b> of the crashes that killed or seriously hurt someone
        (${fmt(meta.top50_ksi)} of ${fmt(meta.city_ksi_crashes)}) happened at just <b class="cs-hi">50 spots</b>, out of
        ${fmt(meta.locations_scored)} places with crashes. Those 50 are the top of this list.</div>`;
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
