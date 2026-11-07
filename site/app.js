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

  // ---------- ranking mode ----------
  // 'ksi' (recommended): fatal = serious injury, compounding for repeated fatal crashes, reliability factor,
  //                      repair requests as a capped boost.  'fatal' (v1): fatal crashes weighted far higher.
  let mode = (() => { try { return JSON.parse(localStorage.getItem('ipm.mode')) || 'ksi'; } catch { return 'ksi'; } })();
  D.priorities.forEach(p => { p.rank_ksi = p.rank; });
  function applyMode() {
    D.priorities.forEach(p => {
      p.rank = mode === 'ksi' ? p.rank_ksi : p.rank_fatal;
      p.score = mode === 'ksi' ? p.score_ksi : p.score_fatal;
    });
    D.priorities.sort((a, b) => a.rank - b.rank);
  }
  applyMode();
  const modeSel = document.getElementById('mode');
  modeSel.value = mode;
  modeSel.onchange = () => {
    mode = modeSel.value;
    try { localStorage.setItem('ipm.mode', JSON.stringify(mode)); } catch { /* ignore */ }
    applyMode(); document.getElementById('closeDetail').click(); render(); renderAbout();
  };

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
    if (p.speeding_crashes >= 2 && pct(p.speeding_crashes, p.crashes) >= 15)
      out.push({ cls: 'cond', text: `speeding in ${p.speeding_crashes} of ${p.crashes}` });
    if (p.requests) out.push({ cls: '', text: `${p.requests} nearby repair requests` });
    if (p.confidence !== 'high')
      out.push({ cls: 'conf', text: `${p.confidence} confidence: only ${p.crashes} crash${p.crashes > 1 ? 'es' : ''}` });
    return out;
  }

  // ---------- map ----------
  // zoomSnap 0.25 lets "show all" fit the city tightly instead of jumping a whole zoom level out.
  const map = L.map('map', { zoomControl: true, zoomSnap: 0.25 }).setView([47.61, -122.33], 12);
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
  const layer = L.featureGroup().addTo(map);

  // "Show all" control under the zoom buttons: zoom back out to every ranked spot on screen.
  function showAll() {
    if (!layer.getLayers().length) return;
    const d = document.getElementById('detail');
    const right = !d.hidden && window.innerWidth > 760 ? d.offsetWidth + 30 : 30;
    map.flyToBounds(layer.getBounds(), { paddingTopLeft: [30, 30], paddingBottomRight: [right, 30], maxZoom: 15, duration: 0.6 });
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
  const color = r => (r <= 10 ? '#b3141b' : r <= 25 ? '#e0561f' : r <= 50 ? '#f0a020' : '#7a8597');

  let markers = {}, selected = null;

  // Fade markers that aren't the selected one (works for both circle and top-10 markers).
  function dim(m, faded) {
    if (m.setStyle) m.setStyle({ fillOpacity: faded ? 0.25 : 0.85, opacity: faded ? 0.4 : 1 });
    else { m.setOpacity(faded ? 0.35 : 1); const el = m.getElement(); if (el) el.classList.toggle('faded', faded); }
  }

  // Legend for the rank tiers.
  const Legend = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd() {
      const d = L.DomUtil.create('div', 'map-legend');
      d.innerHTML = `
        <div><span class="lg-top"><span class="core">1</span></span>Top 10</div>
        <div><i style="background:${color(11)}"></i>11–25</div>
        <div><i style="background:${color(26)}"></i>26–50</div>
        <div><i style="background:${color(51)}"></i>51+</div>`;
      L.DomEvent.disableClickPropagation(d);
      return d;
    }
  });
  new Legend().addTo(map);

  function render() {
    const n = +document.getElementById('topN').value;
    const type = document.getElementById('addrFilter').value;
    const rows = D.priorities
      .filter(p => p.rank <= 200)
      .filter(p => !type || (type === 'F' ? p.fatal > 0 : p.addr_type === type)).slice(0, n);
    const maxScore = Math.max(...rows.map(r => r.score), 1);

    layer.clearLayers(); markers = {};
    // Draw lower ranks first so higher ranks sit on top.
    [...rows].reverse().forEach(p => {
      const m = p.rank <= 10
        // Top 10: numbered, glowing marker with a pulsing ring (staggered so they don't flash in sync).
        ? L.marker([p.lat, p.lon], {
            zIndexOffset: 1000 - p.rank, riseOnHover: true, keyboard: true, title: `#${p.rank} ${titleCase(p.location)}`,
            icon: L.divIcon({
              className: 'top-mark', iconSize: [40, 40], iconAnchor: [20, 20],
              html: `<span class="pulse" style="animation-delay:-${(p.rank * 0.37).toFixed(2)}s"></span>
                     <span class="core">${p.rank}</span>`
            })
          })
        : L.circleMarker([p.lat, p.lon], {
            radius: 5 + 9 * Math.sqrt(p.score / maxScore), color: '#fff', weight: 1.5,
            fillColor: color(p.rank), fillOpacity: 0.85
          });
      m.bindTooltip(`#${p.rank} ${esc(titleCase(p.location))}`, { direction: 'top', offset: [0, p.rank <= 10 ? -14 : -4] })
        .on('click', () => select(p));
      m.addTo(layer); markers[p.rank] = m;
    });

    const list = document.getElementById('list');
    list.innerHTML = rows.map(p => `
      <li data-rank="${p.rank}" class="${p.rank <= 10 ? 'top10' : ''}">
        <div class="row1"><span class="rank">#${p.rank}</span><span class="loc">${esc(titleCase(p.location))}</span>
          <span class="score">${p.score}</span></div>
        <div class="chips">${reasons(p).map(r => `<span class="chip ${r.cls}">${esc(r.text)}</span>`).join('')}</div>
      </li>`).join('');
    list.querySelectorAll('li').forEach(li =>
      li.addEventListener('click', () => select(D.priorities.find(p => p.rank === +li.dataset.rank), true)));
  }

  // ---------- drill-down ----------
  const SEV = {  // ordinal blue ramp, validated (light end clears 2:1)
    F: { label: 'Fatal', color: '#0d366b', order: 0 },
    S: { label: 'Serious injury', color: '#1c5cab', order: 1 },
    I: { label: 'Injury', color: '#3987e5', order: 2 },
    P: { label: 'Property damage', color: '#86b6ef', order: 3 },
    U: { label: 'Unknown', color: '#c3c2b7', order: 4 }
  };
  const REQ_COLOR = '#1baf7a';       // aqua: requests (shape = square, never color alone)
  const focus = L.layerGroup().addTo(map);
  let crashFilter = 'all', reqFilter = '', showAllCrashes = false, showAllReqs = false, current = null;

  // ---------- panel layout: expand, resize, collapsible sections (remembered) ----------
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem('ipm.' + k)); return v ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('ipm.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
  };
  const collapsed = store.get('collapsed', {});
  const widths = store.get('widths', { normal: 440, expanded: null });
  let expanded = store.get('expanded', false);
  const detailEl = document.getElementById('detail');
  // Limits are relative to the map area so some map always stays visible beside the panel.
  const mapW = () => document.getElementById('map').offsetWidth || window.innerWidth;
  const maxW = () => Math.max(340, mapW() - 90);
  const defaultExpanded = () => Math.max(800, Math.round(mapW() * 0.66));

  function applyLayout() {
    const w = expanded ? (widths.expanded || defaultExpanded()) : widths.normal;
    detailEl.style.width = Math.min(Math.max(340, w), maxW()) + 'px';
    detailEl.classList.toggle('expanded', expanded);
    const b = document.getElementById('expandDetail');
    b.textContent = expanded ? '⤡' : '⤢';
    b.title = expanded ? 'Shrink (E)' : 'Expand (E)';
  }
  function toggleExpand() {
    expanded = !expanded; store.set('expanded', expanded); applyLayout();
    if (current) { select(current); flyVisible([current.lat, current.lon], map.getZoom()); }
  }
  document.getElementById('expandDetail').onclick = toggleExpand;
  window.addEventListener('resize', applyLayout);
  applyLayout();

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

  document.addEventListener('keydown', e => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'h' || e.key === 'H') { showAll(); return; }
    if (detailEl.hidden) return;
    if (e.key === 'Escape') document.getElementById('closeDetail').click();
    else if (e.key === 'e' || e.key === 'E') toggleExpand();
    else if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('dsec-h')) { e.preventDefault(); e.target.click(); }
  });

  const tipEl = document.createElement('div');
  tipEl.className = 'tip'; tipEl.hidden = true; document.body.appendChild(tipEl);
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
    const partial = meta.collisions_to.slice(5) !== '12-31';
    return `
      <div class="legend"><span><i style="background:${SEV.S.color}"></i>Fatal or serious</span>
        <span><i style="background:${SEV.P.color}"></i>Other crashes</span></div>
      <div class="cols" style="height:${H + 34}px">
        ${rows.map((r, i) => {
          const hs = Math.round(H * r.severe / max), ho = Math.round(H * r.other / max);
          const gap = hs && ho ? 2 : 0;
          const tip = `<b>${r.y}${partial && i === rows.length - 1 ? ' (partial year)' : ''}</b><br>${r.total} crashes<br>${r.severe} fatal or serious`;
          return `<div class="col" data-tip="${esc(tip)}">
            <span class="cap">${r.total || ''}</span>
            <div class="stack">
              ${ho ? `<div class="seg" style="height:${ho}px;background:${SEV.P.color};border-radius:${hs ? '4px 4px 0 0' : '4px 4px 0 0'}"></div>` : ''}
              ${gap ? '<div style="height:2px"></div>' : ''}
              ${hs ? `<div class="seg" style="height:${hs}px;background:${SEV.S.color};border-radius:${ho ? '0' : '4px 4px 0 0'}"></div>` : ''}
            </div>
            <span class="yr">'${String(r.y).slice(2)}${partial && i === rows.length - 1 ? '*' : ''}</span>
          </div>`;
        }).join('')}
      </div>
      ${partial ? `<div class="note">* ${y1} through ${meta.collisions_to}.</div>` : ''}`;
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

  function countBy(arr, f) {
    const m = new Map(); arr.forEach(x => { const k = f(x); m.set(k, (m.get(k) || 0) + 1); });
    return [...m].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);
  }

  function crashTable(crashes) {
    const filters = { all: () => true, severe: c => c.s === 'F' || c.s === 'S', injury: c => c.s === 'I',
                      ped: c => c.pd > 0 || c.cy > 0, speeding: c => c.sp };
    const list = crashes.filter(filters[crashFilter]);
    const all = showAllCrashes || expanded;
    const shown = all ? list : list.slice(0, 20);
    const btn = (k, label, n) => `<button class="fbtn ${crashFilter === k ? 'on' : ''}" data-cf="${k}">${label} <small>${n}</small></button>`;
    return `
      <div class="fbar">
        ${btn('all', 'All', crashes.length)}${btn('severe', 'Fatal/serious', crashes.filter(filters.severe).length)}
        ${btn('injury', 'Injury', crashes.filter(filters.injury).length)}${btn('ped', 'Ped/bike', crashes.filter(filters.ped).length)}
        ${btn('speeding', 'Speeding', crashes.filter(filters.speeding).length)}
      </div>
      <table class="dtable"><thead><tr><th>Date</th><th>Severity</th><th>What happened</th></tr></thead><tbody>
      ${shown.map(c => {
        const who = [c.pd ? `${c.pd} pedestrian${c.pd > 1 ? 's' : ''}` : '', c.cy ? `${c.cy} cyclist${c.cy > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ');
        const hurt = [c.fat ? `${c.fat} killed` : '', c.ser ? `${c.ser} seriously injured` : '', c.inj ? `${c.inj} injured` : ''].filter(Boolean).join(', ');
        const cond = [c.rd, c.lt, c.wx].filter(v => v && !/^unknown$/i.test(v)).join(' · ');
        return `<tr>
          <td class="nowrap">${c.d}</td>
          <td class="nowrap"><i class="sev" style="background:${SEV[c.s].color}"></i>${SEV[c.s].label}</td>
          <td>${esc(c.t || 'Type not recorded')}${c.sp ? ' <span class="flag">speeding</span>' : ''}
            ${who ? `<div class="sub2">Involved ${esc(who)}</div>` : ''}
            ${hurt ? `<div class="sub2">${esc(hurt)}</div>` : ''}
            ${cond ? `<div class="sub2 muted">${esc(cond)}</div>` : ''}</td></tr>`;
      }).join('') || '<tr><td colspan="3" class="muted">None</td></tr>'}
      </tbody></table>
      ${list.length > 20 && !expanded ? `<button class="linkbtn" data-more="crashes">${showAllCrashes ? 'Show fewer' : `Show all ${list.length}`}</button>` : ''}`;
  }

  function reqTable(reqs) {
    const list = reqs.filter(r => !reqFilter || r.t === reqFilter);
    const shown = showAllReqs || expanded ? list : list.slice(0, 20);
    const types = countBy(reqs, r => r.t);
    return `
      <div class="fbar"><select id="reqType"><option value="">All types (${reqs.length})</option>
        ${types.map(t => `<option value="${esc(t.label)}" ${t.label === reqFilter ? 'selected' : ''}>${esc(t.label)} (${t.n})</option>`).join('')}
      </select></div>
      <table class="dtable"><thead><tr><th>Date</th><th>Request</th><th>Status</th></tr></thead><tbody>
      ${shown.map((r, i) => `<tr class="reqrow" data-ri="${reqs.indexOf(r)}">
          <td class="nowrap">${r.d}</td>
          <td>${esc(r.t)}<div class="sub2 muted">${esc(r.a || '')} · ${r.m} m away</div></td>
          <td>${esc(r.st || '')}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">None</td></tr>'}
      </tbody></table>
      ${list.length > 20 && !expanded ? `<button class="linkbtn" data-more="reqs">${showAllReqs ? 'Show fewer' : `Show all ${list.length}`}</button>` : ''}
      <div class="note">City status is unreliable: most requests stay "Reported" even after a fix.</div>`;
  }

  // Center a point in the part of the map not covered by the detail panel.
  function flyVisible(latlng, zoom) {
    const panel = document.getElementById('detail');
    const shift = window.innerWidth > 760 ? (panel.offsetWidth || parseInt(panel.style.width, 10) || 440) / 2 : 0;
    const pt = map.project(latlng, zoom).add([shift, 0]);
    map.flyTo(map.unproject(pt, zoom), zoom, { duration: 0.6 });
  }

  function drawFocus(p, det) {
    focus.clearLayers();
    L.circle([p.lat, p.lon], { radius: weight('request_radius_m'), color: '#52514e', weight: 1, fill: false, interactive: false }).addTo(focus);
    // Many requests share an exact address point: group them so one square shows the count.
    const groups = new Map();
    det.requests.filter(r => !reqFilter || r.t === reqFilter).forEach(r => {
      const k = r.lat + ',' + r.lon;
      (groups.get(k) || groups.set(k, []).get(k)).push(r);
    });
    groups.forEach(rs => {
      const n = rs.length, size = n > 1 ? 18 : 12;
      const lines = countBy(rs, r => r.t).map(t => `${esc(t.label)}: ${t.n}`).join('<br>');
      L.marker([rs[0].lat, rs[0].lon], {
        icon: L.divIcon({ className: 'reqmark', iconSize: [size, size],
          html: `<span style="background:${REQ_COLOR};width:${size - 2}px;height:${size - 2}px">${n > 1 ? n : ''}</span>` })
      }).bindTooltip(`<b>${n} request${n > 1 ? 's' : ''} here</b><br>${lines}<br><span style="color:#898781">${esc(rs[0].a || '')}</span>`).addTo(focus);
    });
    Object.entries(markers).forEach(([rank, m]) => dim(m, +rank !== p.rank));
    const sel = markers[p.rank];
    if (sel && sel.bringToFront) sel.bringToFront();          // circle markers
    if (sel && sel.setZIndexOffset) sel.setZIndexOffset(5000); // top-10 markers
  }

  function clearFocus() {
    focus.clearLayers();
    Object.values(markers).forEach(m => dim(m, false));
    // restore draw order: higher priority on top
    Object.keys(markers).map(Number).sort((a, b) => b - a).forEach(r => {
      const m = markers[r];
      if (m.bringToFront) m.bringToFront(); else m.setZIndexOffset(1000 - r);
    });
    document.querySelectorAll('#list li').forEach(li => li.classList.remove('selected'));
    current = null;
  }

  function select(p, fly) {
    if (!current || current.rank !== p.rank) { crashFilter = 'all'; reqFilter = ''; showAllCrashes = showAllReqs = false; }
    current = p; selected = p.rank;
    if (location.hash !== '#' + p.rank) history.replaceState(null, '', '#' + p.rank);
    document.querySelectorAll('#list li').forEach(li => li.classList.toggle('selected', +li.dataset.rank === p.rank));
    const li = document.querySelector(`#list li[data-rank="${p.rank}"]`);
    if (li && !fly) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (fly) flyVisible([p.lat, p.lon], 18);

    const det = (D.details && D.details[p.location]) || { crashes: [], requests: [] };
    drawFocus(p, det);

    const kind = { I: 'Intersection', B: 'Street block', A: 'Alley' }[p.addr_type] || 'Location';
    const sv = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat},${p.lon}`;
    const types = countBy(det.crashes.filter(c => c.t), c => c.t).slice(0, 6);
    const untyped = det.crashes.filter(c => !c.t).length;
    const sec = (id, title, html) =>
      `<section class="dsec ${collapsed[id] ? 'collapsed' : ''}" data-sec="${id}">
         <h3 class="dsec-h" tabindex="0" role="button" aria-expanded="${!collapsed[id]}">${title}</h3>
         <div class="dsec-b">${html}</div></section>`;
    document.getElementById('detailBody').innerHTML = `
      <div class="dhead">
        <h2>#${p.rank} ${esc(titleCase(p.location))}</h2>
        <div class="note">${kind} · <a href="${sv}" target="_blank" rel="noopener">Street View ↗</a></div>
        <div class="formula">${mode === 'ksi'
          ? `Score <b>${p.score}</b> = crash harm ${p.ksi_points_raw}
             × reliability ${p.reliability.toFixed(2)} <span class="muted">(${p.crashes} crashes, ${p.confidence} confidence)</span>
             × repair boost ${(1 + p.request_boost).toFixed(2)} <span class="muted">(${p.requests} requests)</span>`
          : `Score <b>${p.score}</b> = crash points ${p.crash_points} + repair-request points ${p.request_points} × ${weight('request_mult')}`}
          <span class="muted">· #${mode === 'ksi' ? p.rank_fatal : p.rank_ksi} in the ${mode === 'ksi' ? 'fatal-weighted' : 'recommended'} ranking</span></div>
        <div class="stat-grid">
          <div class="stat"><b>${p.crashes}</b><span>crashes</span></div>
          <div class="stat"><b>${p.fatal + p.serious}</b><span>fatal + serious</span></div>
          <div class="stat"><b>${p.ped_crashes + p.bike_crashes}</b><span>hit ped / bike</span></div>
          <div class="stat"><b>${p.requests}</b><span>repair requests</span></div>
        </div>
      </div>
      <div class="dcols">
        <div class="dcol">
          ${sec('why', 'Why it ranks here', `<ul>${reasons(p).map(r => `<li>${esc(r.text)}</li>`).join('')}</ul>`)}
          ${sec('years', 'Crashes by year', yearChart(det.crashes))}
          ${sec('types', 'What kind of crashes', `
            ${hbars(types, '#2a78d6', 'crashes')}
            ${untyped ? `<div class="note">${untyped} crash${untyped > 1 ? 'es have' : ' has'} no type recorded.</div>` : ''}
            <ul class="tight">
              <li>Wet/icy road: ${p.wet_crashes} of ${p.road_known} recorded (${pct(p.wet_crashes, p.road_known)}%; city ${Math.round(100 * meta.city_wet_share)}%)</li>
              <li>Dark: ${p.dark_crashes} of ${p.light_known} (${pct(p.dark_crashes, p.light_known)}%; city ${Math.round(100 * meta.city_dark_share)}%) · streetlights off/none: ${p.unlit_crashes}</li>
            </ul>`)}
          ${sec('reqtypes', `Repair requests within ${weight('request_radius_m')} m`, `
            <div class="legend"><span><i class="sq" style="background:${REQ_COLOR}"></i>Request location (on map)</span>
              <span><i class="ring"></i>${weight('request_radius_m')} m search area</span></div>
            ${hbars(countBy(det.requests, r => r.t), REQ_COLOR, 'requests') || '<div class="note">None in Find It Fix It data.</div>'}`)}
          ${sec('planned', 'Planned work', `<div class="note">Not linked yet. Seattle's budget data has no locations (see the SDOT spending tab).</div>`)}
        </div>
        <div class="dcol">
          ${sec('crashes', 'Every crash', `
            <div class="legend">${['F', 'S', 'I', 'P'].map(k => `<span><i style="background:${SEV[k].color}"></i>${SEV[k].label}</span>`).join('')}</div>
            <div id="crashTable">${crashTable(det.crashes)}</div>`)}
          ${sec('reqs', 'Every repair request', `<div id="reqTable">${reqTable(det.requests)}</div>`)}
        </div>
      </div>`;
    document.getElementById('detail').hidden = false;

    const body = document.getElementById('detailBody');
    body.onclick = e => {
      const h = e.target.closest('.dsec-h');
      if (h) {
        const s = h.parentElement, id = s.dataset.sec;
        collapsed[id] = !collapsed[id]; store.set('collapsed', collapsed);
        s.classList.toggle('collapsed', collapsed[id]); h.setAttribute('aria-expanded', String(!collapsed[id]));
        return;
      }
      const cf = e.target.closest('[data-cf]');
      if (cf) { crashFilter = cf.dataset.cf; showAllCrashes = false; document.getElementById('crashTable').innerHTML = crashTable(det.crashes); return; }
      const more = e.target.closest('[data-more]');
      if (more && more.dataset.more === 'crashes') { showAllCrashes = !showAllCrashes; document.getElementById('crashTable').innerHTML = crashTable(det.crashes); return; }
      if (more && more.dataset.more === 'reqs') { showAllReqs = !showAllReqs; document.getElementById('reqTable').innerHTML = reqTable(det.requests); return; }
      const row = e.target.closest('.reqrow');
      if (row) { const r = det.requests[+row.dataset.ri]; flyVisible([r.lat, r.lon], 19); }
    };
    body.onchange = e => {
      if (e.target.id === 'reqType') { reqFilter = e.target.value; showAllReqs = false;
        document.getElementById('reqTable').innerHTML = reqTable(det.requests); drawFocus(p, det); }
    };
  }
  document.getElementById('closeDetail').onclick = () => {
    document.getElementById('detail').hidden = true; clearFocus();
    history.replaceState(null, '', location.pathname);
  };
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
  function renderAbout() {
    const g = weight('fatal_growth'), k = weight('ksi'), rk = weight('reliability_k');
    const bmax = weight('request_boost_max'), bhalf = weight('request_boost_half');
    const reqList = `<ul>${meta.request_weights.map(r => `<li>${esc(r.type)}: ${r.w}</li>`).join('')}</ul>`;
    const ksi = `
      <h3>Recommended ranking</h3>
      <p>Built to reward <b>patterns of harm</b> over one-off events.</p>
      <ol>
        <li><b>Crash harm.</b> Points per crash: fatal or serious injury ${k}, injury ${weight('injury')},
          property damage only ${weight('pdo')}, × ${weight('ped_bike_mult')} if a pedestrian or cyclist was involved.
          Fatal and serious are counted alike because whether a crash kills or seriously injures someone depends heavily
          on chance (age, vehicle, ambulance time). Vision Zero programs use the same "KSI" grouping.</li>
        <li><b>Repeated deaths compound.</b> The 1st fatal crash at a spot counts ${k}, the 2nd ${(k * g).toFixed(1)},
          the 3rd ${(k * g * g).toFixed(1)} (each × ${g} the last).</li>
        <li><b>Reliability.</b> Crash harm × crashes ÷ (crashes + ${rk}). A spot with 3 crashes keeps
          ${Math.round(100 * 3 / (3 + rk))}%, one with 30 keeps ${Math.round(100 * 30 / (30 + rk))}%. Confidence:
          low under 5 crashes, medium under 15, high otherwise.</li>
        <li><b>Repair boost.</b> Nearby repair requests raise the score by up to +${Math.round(100 * bmax)}%
          (half of that at ${bhalf} request points). Requests can make a dangerous spot more urgent but can't put a
          spot on the list alone. Some neighborhoods simply file far more requests than others.</li>
      </ol>`;
    const fatal = `
      <h3>Fatal-weighted ranking (v1)</h3>
      <p>Crash points: fatal ${weight('fatal')}, serious injury ${weight('serious')}, injury ${weight('injury')},
        property damage only ${weight('pdo')}, × ${weight('ped_bike_mult')} with a pedestrian or cyclist, plus repair-request
        points × ${weight('request_mult')}.</p>
      <p class="note">Kept for comparison. One fatal crash outweighs 20 injury crashes here, so spots with only a few
        crashes but one or two deaths can rank very high.</p>`;
    document.getElementById('about').innerHTML = `
      <h3>What this ranks</h3>
      <p>Every Seattle intersection and street block with a reported collision since ${meta.collisions_from},
        using SDOT collision records and Find It Fix It repair requests. Switch rankings with the <b>Ranking</b>
        menu on the Priorities tab.</p>
      ${mode === 'ksi' ? ksi + fatal : fatal + ksi}
      <h3>Repair-request weights (by type, within ${weight('request_radius_m')} m)</h3>
      ${reqList}
      <p class="note">Encampment, parking, graffiti and similar report types are left out on purpose. This map is about
        fixing infrastructure, not policing.</p>
      <h3>Driver behavior</h3>
      <p class="note">Crashes involving speeding stay in the score. Repeated speeding at one spot usually points to road design
        (wide, straight streets invite speed), so it's flagged as context ("speeding in 8 of 30") rather than excluded.</p>
      <h3>Known limits</h3>
      <ul>
        <li>Not adjusted for traffic volume yet. Busy streets naturally have more crashes.</li>
        <li>Find It Fix It status is unreliable (most requests stay "Reported"), so open and fixed requests count the same.</li>
        <li>Planned projects aren't linked to locations yet.</li>
      </ul>`;
  }
  renderAbout();

  render();

  // Shareable links: index.html#12 opens location #12.
  function openFromHash() {
    const r = parseInt(location.hash.slice(1), 10);
    const p = r && D.priorities.find(x => x.rank === r);
    if (p) select(p, true);
  }
  window.addEventListener('hashchange', openFromHash);
  if (location.hash.length > 1) openFromHash();
  else map.fitBounds(layer.getBounds(), { padding: [30, 30], maxZoom: 15 });
})();
