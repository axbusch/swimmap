'use strict';

/* ------------------------------------------------------------------ */
/* Konstanten                                                          */
/* ------------------------------------------------------------------ */
const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MODES = {
  walk: { label: 'Zu Fuß', short: 'zu Fuß' },
  bike: { label: 'Rad', short: 'mit dem Rad' },
  pt: { label: 'ÖPNV', short: 'mit Bus & Bahn' },
};
const THRS = [10, 15, 20, 30];
const CATS = {
  hallenbad: { label: 'Städtische Hallenbäder', letter: 'H', cssVar: '--cat-hallenbad' },
  freibad: { label: 'Städtische Freibäder (nur Mai–Sept.)', letter: 'F', cssVar: '--cat-freibad' },
  andere: { label: 'Bäder anderer Träger', letter: 'A', cssVar: '--cat-andere' },
};
const ART = {
  oeffentlich: { label: 'öffentlich', cssVar: '--slot-oeffentlich' },
  teiloeffentlich: { label: 'öffentlich auf Teilfläche', cssVar: '--slot-teil' },
  zielgruppe: { label: 'nur Zielgruppe', cssVar: '--slot-zielgruppe' },
};
// ordinale Blau-Rampe (Schritte 600 → 250): dunkler = schneller erreichbar
const TT_CLASSES = [
  { max: 10, color: '#184f95', label: '≤ 10 min' },
  { max: 15, color: '#2a78d6', label: '≤ 15 min' },
  { max: 20, color: '#5598e7', label: '≤ 20 min' },
  { max: 30, color: '#86b6ef', label: '≤ 30 min' },
];
const H_CLASSES = [
  { min: 150, color: '#104281', label: '≥ 150 h' },
  { min: 100, color: '#1c5cab', label: '100–150' },
  { min: 60, color: '#2a78d6', label: '60–100' },
  { min: 30, color: '#5598e7', label: '30–60' },
  { min: 0.01, color: '#9ec5f4', label: '< 30 h' },
];
const METRICS = {
  stunden_je_10k_ew: {
    label: 'Stunden je 10.000 EW', fmt: v => fmt1(v),
    note: 'Öffentliche Schwimmstunden pro Woche aller kommunalen Hallenbäder zusammen, je 10.000 Einwohner.',
  },
  m2h_je_1000_ew: {
    label: 'Wasserflächen-Stunden', fmt: v => fmt0(v),
    note: 'Öffentliche Stunden × Wasserfläche (m²·h pro Woche) je 1.000 Einwohner – berücksichtigt, wie groß die Bäder sind.',
  },
  wasserflaeche_m2_je_1000_ew: {
    label: 'Wasserfläche', fmt: v => fmt1(v),
    note: 'Wasserfläche (m²) der Hallenbäder mit öffentlichen Zeiten je 1.000 Einwohner – unabhängig von den Öffnungszeiten.',
  },
};

const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt0 = v => nf0.format(v);
const fmt1 = v => nf1.format(v);
const fmtPct = v => nf0.format(v * 100) + ' %';
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

/* ------------------------------------------------------------------ */
/* Zustand                                                             */
/* ------------------------------------------------------------------ */
const state = {
  cats: { hallenbad: true, freibad: false, andere: false },
  mode: 'bike',
  thr: 15,
  layer: 'tt',
  focus: null,
  metric: 'stunden_je_10k_ew',
};
let MS, R, NRW, TT = {}, IDX = {}, BY_ID = {};
let map, cellLayer, markers = {}, infoCtl;
let comp = null; // aktuelles Rechenergebnis

const catOf = b => (b.kategorie === 'andere' ? 'andere' : b.typ);
const activePools = () => MS.baeder.filter(b => state.cats[catOf(b)]);
const calcPools = () => (state.focus ? [BY_ID[state.focus]] : activePools());

/* ------------------------------------------------------------------ */
/* Laden                                                               */
/* ------------------------------------------------------------------ */
async function load() {
  let ms, raster, nrw, grenze;
  const B = window.SWIMMAP_DATA;
  if (B) {
    // eingebettete Daten (data/bundle.js) – funktioniert auch bei file://
    ({ muenster: ms, raster, nrw, grenze } = B);
  } else {
    const get = p => fetch(p).then(r => { if (!r.ok) throw new Error(p + ': ' + r.status); return r.json(); });
    [ms, raster, nrw, grenze] = await Promise.all([
      get('data/muenster.json'), get('data/raster.json'), get('data/nrw.json'), get('data/grenze.geojson'),
    ]);
  }
  MS = ms; R = raster; NRW = nrw;
  MS.baeder.forEach(b => (BY_ID[b.id] = b));
  R.baeder.forEach((id, i) => (IDX[id] = i));
  for (const [mode, arrs] of Object.entries(R.tt)) {
    TT[mode] = arrs.map(b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
  }
  buildBuckets();
  const tab = readHash();
  initMap(grenze);
  initControls();
  if (tab) document.getElementById('tab-' + tab)?.click();
  renderNrw();
  renderMethodik();
  document.getElementById('stand').textContent =
    `Öffentliche Schwimmzeiten, Einzugsbereiche und NRW-Vergleich · Stand ${fmtDate(MS.stand)}`;
  update();
  if (state.focus) {
    const b = BY_ID[state.focus];
    map.setView([b.lat, b.lon], 13);
    markers[state.focus].openPopup();
  }
}

/* ------------------------------------------------------------------ */
/* Berechnung                                                          */
/* ------------------------------------------------------------------ */
function compute() {
  const n = R.zellen, thr = state.thr, mode = state.mode;
  const pools = calcPools().filter(p => TT[mode] && IDX[p.id] !== undefined);
  const tmin = new Uint8Array(n).fill(255);
  const nearest = new Int16Array(n).fill(-1);
  const hrs = new Float32Array(n);
  const perPool = {};
  const ewSum = R.ew_summe;
  for (const p of MS.baeder) {
    const arr = TT[mode] && TT[mode][IDX[p.id]];
    if (!arr) continue;
    let cov = 0;
    for (let i = 0; i < n; i++) if (arr[i] <= thr) cov += R.ew[i];
    perPool[p.id] = cov / ewSum;
  }
  // Stunden nur innerhalb einer Saison summieren: Hallenbäder (Winterplan) und
  // Freibäder (Mai–Sept.) sind nie gleichzeitig im Betrieb.
  const isSummer = p => p.typ === 'freibad';
  const winterSel = pools.some(p => !isSummer(p));
  const countsHours = p => (winterSel ? !isSummer(p) : isSummer(p));
  for (const p of pools) {
    const arr = TT[mode][IDX[p.id]];
    const h = countsHours(p) ? p.kennzahlen.stunden_woche : 0;
    const k = IDX[p.id];
    for (let i = 0; i < n; i++) {
      const v = arr[i];
      if (v < tmin[i]) { tmin[i] = v; nearest[i] = k; }
      if (v <= thr) hrs[i] += h;
    }
  }
  let popIn = 0, hSum = 0;
  for (let i = 0; i < n; i++) {
    if (tmin[i] <= thr) popIn += R.ew[i];
    hSum += hrs[i] * R.ew[i];
  }
  const act = activePools();
  const actWinter = act.some(p => !isSummer(p));
  const sumPools = act.filter(p => (actWinter ? !isSummer(p) : isSummer(p)));
  const hoursTotal = sumPools.reduce((s, b) => s + b.kennzahlen.stunden_woche, 0);
  const summerExtra = actWinter
    ? act.filter(isSummer).reduce((s, b) => s + b.kennzahlen.stunden_woche, 0) : 0;
  comp = {
    tmin, nearest, hrs, perPool,
    share: popIn / ewSum,
    avgHours: hSum / ewSum,
    hoursTotal,
    per10k: hoursTotal / MS.einwohner * 1e4,
    nActive: sumPools.length,
    season: actWinter ? 'winter' : 'sommer',
    summerExtra,
    nSummer: act.filter(isSummer).length,
  };
}

/* ------------------------------------------------------------------ */
/* Karte                                                               */
/* ------------------------------------------------------------------ */
const DLAT = 100 / 111320;
const CellLayer = L.Layer.extend({
  onAdd(m) {
    this._m = m;
    this._c = L.DomUtil.create('canvas', 'leaflet-zoom-hide');
    this._c.style.pointerEvents = 'none';
    m.getPanes().overlayPane.appendChild(this._c);
    m.on('moveend zoomend resize', this.redraw, this);
    this.redraw();
  },
  onRemove(m) {
    this._c.remove();
    m.off('moveend zoomend resize', this.redraw, this);
  },
  redraw() {
    const m = this._m;
    if (!m) return;
    const size = m.getSize(), c = this._c, dpr = window.devicePixelRatio || 1;
    c.width = size.x * dpr; c.height = size.y * dpr;
    c.style.width = size.x + 'px'; c.style.height = size.y + 'px';
    L.DomUtil.setPosition(c, m.containerPointToLayerPoint([0, 0]));
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    if (!comp || state.layer === 'none') return;
    const lat0 = m.getCenter().lat;
    const dlon = DLAT / Math.cos(lat0 * Math.PI / 180);
    const p0 = m.latLngToContainerPoint([lat0, 7.62]);
    const p1 = m.latLngToContainerPoint([lat0 + DLAT, 7.62 + dlon]);
    // Zellen leicht vergrößern: das EPSG:3035-Gitter ist gegenüber Web-Mercator etwas gedreht
    const pad = Math.max(1, Math.abs(p1.x - p0.x) * 0.12);
    const w = Math.abs(p1.x - p0.x) + pad, h = Math.abs(p1.y - p0.y) + pad;
    const groups = new Map();
    const colorOf = state.layer === 'tt' ? colorTT : colorH;
    for (let i = 0; i < R.zellen; i++) {
      const col = colorOf(i);
      if (!col) continue;
      const p = m.latLngToContainerPoint([R.lat[i], R.lon[i]]);
      if (p.x < -w || p.y < -h || p.x > size.x + w || p.y > size.y + h) continue;
      const key = col + (R.ew[i] > 0 ? '|1' : '|0');
      let g = groups.get(key);
      if (!g) groups.set(key, (g = []));
      g.push(p.x - w / 2, p.y - h / 2);
    }
    // unbewohnte Zellen blasser, bewohnte kräftig – in zwei Durchgängen
    for (const pass of ['|0', '|1']) {
      ctx.globalAlpha = pass === '|1' ? 0.72 : 0.28;
      for (const [key, pts] of groups) {
        if (!key.endsWith(pass)) continue;
        ctx.fillStyle = key.slice(0, -2);
        ctx.beginPath();
        for (let j = 0; j < pts.length; j += 2) ctx.rect(pts[j], pts[j + 1], w, h);
        ctx.fill();
      }
    }
  },
});
function colorTT(i) {
  const v = comp.tmin[i];
  for (const c of TT_CLASSES) if (v <= c.max) return c.color;
  return null;
}
function colorH(i) {
  const v = comp.hrs[i];
  for (const c of H_CLASSES) if (v >= c.min) return c.color;
  return null;
}

function initMap(grenze) {
  map = L.map('map', { zoomControl: true, preferCanvas: false }).setView([51.955, 7.625], 11);
  const basemap = L.tileLayer(
    'https://sgx.geodatenzentrum.de/wmts_basemapde/tile/1.0.0/de_basemapde_web_raster_grau/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png',
    { maxZoom: 18, attribution: '© <a href="https://basemap.de">basemap.de</a> / BKG (CC BY 4.0)' });
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende' });
  basemap.addTo(map);
  map.attributionControl.addAttribution(
    'Bäder: Stadt Münster · Bevölkerung: Zensus 2022 · ÖPNV: gtfs.de/DELFI · Wege: OSM');
  L.control.layers({ 'basemap.de (grau)': basemap, 'OpenStreetMap': osm }, null, { position: 'topright' }).addTo(map);

  const gl = L.geoJSON(grenze, {
    interactive: false,
    style: { color: '#52514e', weight: 1.5, fill: false, dashArray: '4 3' },
  }).addTo(map);
  map.fitBounds(gl.getBounds(), { padding: [10, 10] });
  if (map.getZoom() < 10) map.setZoom(10);

  cellLayer = new CellLayer();
  cellLayer.addTo(map);

  for (const b of MS.baeder) {
    const cat = catOf(b);
    const icon = L.divIcon({
      className: '',
      html: `<div class="pool-marker" data-id="${b.id}" style="background:${css(CATS[cat].cssVar)}">${CATS[cat].letter}</div>`,
      iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -10],
    });
    const mk = L.marker([b.lat, b.lon], { icon, title: b.name, keyboard: true, riseOnHover: true });
    mk.bindPopup(() => poolPopup(b), { maxWidth: 340 });
    mk.on('click', () => setFocus(b.id, false));
    markers[b.id] = mk;
  }

  infoCtl = L.control({ position: 'bottomleft' });
  infoCtl.onAdd = () => {
    const d = L.DomUtil.create('div', 'leaflet-bar cell-tip');
    d.style.cssText = 'background:var(--surface-1);color:var(--text-primary);padding:6px 9px;max-width:260px;display:none';
    return d;
  };
  infoCtl.addTo(map);
  map.on('mousemove', onHover);
  map.on('mouseout', () => (infoCtl.getContainer().style.display = 'none'));
  map.on('popupclose', e => {
    // nur aufheben, wenn das Popup des fokussierten Bades geschlossen wurde
    if (state.focus && e.popup._source === markers[state.focus]) setFocus(null);
  });
}

let BUCKETS = new Map();
const BK = 0.002;
function buildBuckets() {
  for (let i = 0; i < R.zellen; i++) {
    const k = Math.floor(R.lat[i] / BK) + ':' + Math.floor(R.lon[i] / BK);
    let a = BUCKETS.get(k);
    if (!a) BUCKETS.set(k, (a = []));
    a.push(i);
  }
}
function cellAt(lat, lon) {
  const bi = Math.floor(lat / BK), bj = Math.floor(lon / BK);
  let best = -1, bd = Infinity;
  const cl = Math.cos(lat * Math.PI / 180);
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    const a = BUCKETS.get((bi + di) + ':' + (bj + dj));
    if (!a) continue;
    for (const i of a) {
      const d = (R.lat[i] - lat) ** 2 + ((R.lon[i] - lon) * cl) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
  }
  return Math.sqrt(bd) * 111320 < 75 ? best : -1;
}
function onHover(e) {
  const box = infoCtl.getContainer();
  const i = comp ? cellAt(e.latlng.lat, e.latlng.lng) : -1;
  if (i < 0) { box.style.display = 'none'; return; }
  const t = comp.tmin[i], k = comp.nearest[i];
  const name = k >= 0 ? BY_ID[R.baeder[k]].name : '–';
  const tt = t === 255 ? 'über 120 min' : `${t} min ${MODES[state.mode].short}`;
  box.innerHTML =
    `<b>${fmt0(R.ew[i])}</b> Einwohner in dieser 100-m-Zelle<br>` +
    `${state.focus ? 'Zum Bad' : 'Nächstes Bad'}: <b>${esc(name)}</b>, ${tt}<br>` +
    `Erreichbar in ≤ ${state.thr} min: <b>${fmt0(comp.hrs[i])} h</b> öffentl. Schwimmzeit/Woche`;
  box.style.display = 'block';
}

function syncMarkers() {
  for (const b of MS.baeder) {
    const mk = markers[b.id];
    const on = state.cats[catOf(b)] || state.focus === b.id;
    if (on && !map.hasLayer(mk)) mk.addTo(map);
    if (!on && map.hasLayer(mk)) map.removeLayer(mk);
    const el = mk.getElement && mk.getElement();
    if (el) el.firstChild && el.firstChild.classList.toggle('focus', state.focus === b.id);
  }
}

/* ------------------------------------------------------------------ */
/* Wochenplan (SVG)                                                    */
/* ------------------------------------------------------------------ */
function weekSvg(b) {
  const W = 320, L0 = 24, R0 = 6, T0 = 14, ROW = 15, h0 = 6, h1 = 23;
  const x = h => L0 + (h - h0) / (h1 - h0) * (W - L0 - R0);
  const H = T0 + ROW * 7 + 2;
  const toH = s => { const [a, c] = s.split(':').map(Number); return a + c / 60; };
  let s = `<svg class="week" viewBox="0 0 ${W} ${H}" role="img" aria-label="Wochenplan ${esc(b.name)}">`;
  for (let h = 6; h <= 21; h += 3) {
    s += `<line class="grid" x1="${x(h)}" x2="${x(h)}" y1="${T0 - 2}" y2="${H - 2}"/>`;
    s += `<text x="${x(h)}" y="9" text-anchor="middle">${h}</text>`;
  }
  TAGE.forEach((t, d) => {
    s += `<text x="0" y="${T0 + ROW * d + ROW / 2 + 3}">${t}</text>`;
  });
  for (const sl of b.slots || []) {
    const d = TAGE.indexOf(sl.tag);
    const a = toH(sl.von), e = toH(sl.bis);
    const y = T0 + ROW * d + 2, hh = ROW - 4;
    const isZ = sl.art === 'zielgruppe';
    const yy = isZ ? y + hh / 2 : y, hgt = isZ ? hh / 2 : hh;
    const op = (sl.haeufigkeit ?? 1) < 1 ? 0.5 : 1;
    const tip = `${sl.tag} ${sl.von}–${sl.bis} · ${ART[sl.art].label}` +
      ((sl.haeufigkeit ?? 1) < 1 ? ` · nicht jede Woche (Faktor ${fmt1(sl.haeufigkeit)})` : '') +
      (sl.hinweis ? ` · ${sl.hinweis}` : '');
    s += `<rect x="${x(a)}" y="${yy}" width="${Math.max(2, x(e) - x(a) - 1)}" height="${hgt}" rx="3"
      fill="${css(ART[sl.art].cssVar)}" opacity="${op}"><title>${esc(tip)}</title></rect>`;
  }
  s += '</svg>';
  const used = new Set((b.slots || []).map(s => s.art));
  const leg = Object.entries(ART).filter(([k]) => used.has(k))
    .map(([, a]) => `<span><i style="background:${css(a.cssVar)}"></i>${a.label}</span>`).join('');
  const halb = (b.slots || []).some(s => (s.haeufigkeit ?? 1) < 1)
    ? `<span><i style="background:${css('--slot-oeffentlich')};opacity:.5"></i>nicht jede Woche</span>` : '';
  return s + `<div class="week-legend">${leg}${halb}</div>`;
}

function poolPopup(b) {
  const k = b.kennzahlen;
  const cat = CATS[catOf(b)].label.replace(' (nur Mai–Sept.)', '');
  const flaeche = b.wasserflaeche_m2
    ? `${fmt0(b.wasserflaeche_m2)} m² Wasserfläche${b.wasserflaeche_geschaetzt ? ' (geschätzt)' : ''}` : 'Wasserfläche unbekannt';
  const warn = b.zeiten_unbekannt
    ? '<div class="callout">Öffentliche Zeiten derzeit nicht veröffentlicht.</div>'
    : b.zeiten_unsicher ? '<div class="callout">Zeiten aus Drittquelle, nicht vom Betreiber bestätigt.</div>' : '';
  const saison = b.saison ? `<div>Saison 2026: ${fmtDate(b.saison.von) || b.saison.von} – ${fmtDate(b.saison.bis) || b.saison.bis}</div>` : '';
  const sommer = b.sommer ? `<div class="note">Sommer: ${esc(b.sommer)}</div>` : '';
  const ein = (b.einschraenkungen || []).length
    ? `<details><summary>Einschränkungen (${b.einschraenkungen.length})</summary><ul>${b.einschraenkungen.map(e => `<li>${esc(e)}</li>`).join('')}</ul></details>` : '';
  const zg = k.stunden_zielgruppe_woche > 0 ? ` + ${fmt1(k.stunden_zielgruppe_woche)} h Zielgruppen` : '';
  return `<h4>${esc(b.name)}</h4>
    <div class="pm">${esc(cat)} · ${esc(b.traeger)}<br>${esc(b.adresse)}</div>
    ${warn}
    <div><b>${fmt1(k.stunden_woche)} h</b> öffentliches Schwimmen pro Woche${zg}</div>
    <div>${flaeche}${k.m2h_woche ? ` · ${fmt0(k.m2h_woche)} m²·h` : ''}</div>
    ${saison}
    ${b.slots && b.slots.length ? weekSvg(b) : ''}
    ${sommer}${ein}
    <div class="note">Quelle: <a href="${esc(b.quelle.url)}" target="_blank" rel="noopener">${esc(new URL(b.quelle.url).hostname)}</a>, abgerufen ${fmtDate(b.quelle.abgerufen)}</div>`;
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */
function segButtons(el, items, key, onChange) {
  el.innerHTML = '';
  for (const [val, label, disabled] of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.disabled = !!disabled;
    btn.setAttribute('aria-pressed', String(state[key] === val));
    btn.addEventListener('click', () => {
      state[key] = val;
      el.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      onChange();
    });
    el.appendChild(btn);
  }
}

function initControls() {
  const cats = document.getElementById('cats');
  for (const [k, c] of Object.entries(CATS)) {
    const n = MS.baeder.filter(b => catOf(b) === k).length;
    const lab = document.createElement('label');
    lab.innerHTML = `<input type="checkbox" ${state.cats[k] ? 'checked' : ''}> <span class="dot" style="background:${css(c.cssVar)}"></span> ${c.label} <span class="note">(${n})</span>`;
    lab.querySelector('input').addEventListener('change', e => { state.cats[k] = e.target.checked; update(); });
    cats.appendChild(lab);
  }
  segButtons(document.getElementById('mode'),
    Object.entries(MODES).map(([k, m]) => [k, m.label, !TT[k]]), 'mode', update);
  segButtons(document.getElementById('thr'), THRS.map(t => [t, `${t} min`]), 'thr', update);
  segButtons(document.getElementById('layer'),
    [['tt', 'Reisezeit'], ['hours', 'Erreichbare Stunden'], ['none', 'Aus']], 'layer', update);
  segButtons(document.getElementById('metric'),
    Object.entries(METRICS).map(([k, m]) => [k, m.label]), 'metric', () => { renderNrw(); writeHash(); });

  const tabs = [...document.querySelectorAll('[role=tab]')];
  tabs.forEach(t => t.addEventListener('click', () => {
    tabs.forEach(o => {
      o.setAttribute('aria-selected', String(o === t));
      document.getElementById(o.getAttribute('aria-controls')).hidden = o !== t;
    });
    if (comp) writeHash();
  }));
}

function renderKpis() {
  const m = MODES[state.mode].short;
  const scope = state.focus ? `im Einzugsbereich von ${BY_ID[state.focus].name}` : 'mit einem Bad';
  const saison = comp.season === 'winter' ? 'Winterplan' : 'Freibadsaison';
  const extra = comp.summerExtra > 0
    ? `; dazu ${fmt0(comp.summerExtra)} h in ${comp.nSummer} Freibädern (nur Mai–Sept., nicht addiert)` : '';
  const tiles = [
    [fmt0(comp.hoursTotal) + ' h', `öffentliche Schwimmzeit pro Woche, ${saison} (${comp.nActive} Bäder${extra})`],
    [fmt1(comp.per10k) + ' h', `je 10.000 Einwohner und Woche (${saison})`],
    [fmtPct(comp.share), `der Einwohner ${scope} in ≤ ${state.thr} min ${m}`],
    [fmt0(comp.avgHours) + ' h', `Ø erreichbare öffentl. Stunden/Woche je Einwohner (≤ ${state.thr} min ${m})`],
  ];
  document.getElementById('kpis').innerHTML =
    tiles.map(([v, l]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${esc(l)}</div></div>`).join('');
}

function renderLegend() {
  const leg = document.getElementById('legend');
  const note = document.getElementById('layer-note');
  if (state.layer === 'tt') {
    leg.innerHTML = TT_CLASSES.map(c => `<div class="sw"><i style="background:${c.color};opacity:.75"></i>${c.label}</div>`).join('');
    note.textContent = `Reisezeit ${MODES[state.mode].short} zum nächsten ausgewählten Bad (100-m-Raster, unbewohnte Flächen blasser).` +
      (state.mode === 'pt' ? ' ÖPNV: Tür-zu-Tür inkl. Fußwege und Wartezeit, Ankunft dienstags 17–19 Uhr (Median).' : '');
  } else if (state.layer === 'hours') {
    leg.innerHTML = H_CLASSES.slice().reverse().map(c => `<div class="sw"><i style="background:${c.color};opacity:.75"></i>${c.label}</div>`).join('');
    note.textContent = `Summe der öffentlichen Schwimmstunden pro Woche aller Bäder, die in ≤ ${state.thr} min ${MODES[state.mode].short} erreichbar sind.` +
      (comp.summerExtra > 0 ? ' Freibäder sind hier nicht mitgezählt, weil sie nur im Sommer öffnen. Für ihre Stunden die Hallenbäder abwählen.' : '');
  } else {
    leg.innerHTML = '';
    note.textContent = '';
  }
}

function renderPools() {
  const list = document.getElementById('pools');
  const pools = activePools().slice().sort((a, b) => b.kennzahlen.stunden_woche - a.kennzahlen.stunden_woche);
  const max = Math.max(1, ...pools.map(b => b.kennzahlen.stunden_woche));
  list.innerHTML = '';
  for (const b of pools) {
    const k = b.kennzahlen;
    const li = document.createElement('li');
    li.tabIndex = 0;
    li.className = state.focus === b.id ? 'active' : '';
    const badge = b.zeiten_unbekannt ? '<span class="badge">Zeiten unbekannt</span>'
      : b.zeiten_unsicher ? '<span class="badge">Zeiten unsicher</span>'
      : (b.slots || []).some(s => (s.haeufigkeit ?? 1) <= 0.5) ? '<span class="badge">jedes 2. Wochenende</span>' : '';
    const cov = comp.perPool[b.id];
    li.innerHTML = `
      <span class="dot" style="background:${css(CATS[catOf(b)].cssVar)}"></span>
      <span class="name">${esc(b.name)}${badge}</span>
      <span class="hval">${fmt1(k.stunden_woche)} h</span>
      <span></span><span class="hbar"><i style="width:${(k.stunden_woche / max) * 100}%"></i></span><span></span>
      <span></span><span class="meta">${b.wasserflaeche_m2 ? fmt0(b.wasserflaeche_m2) + ' m²' : 'Fläche unbekannt'}${cov !== undefined ? ` · ${fmtPct(cov)} der Einwohner in ≤ ${state.thr} min ${MODES[state.mode].short}` : ''}</span>`;
    const go = () => setFocus(state.focus === b.id ? null : b.id, true);
    li.addEventListener('click', go);
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    list.appendChild(li);
  }
  const det = document.getElementById('detail');
  if (state.focus) {
    const b = BY_ID[state.focus];
    det.innerHTML = `<h3>Wochenplan ${esc(b.name)}</h3>${b.slots && b.slots.length ? weekSvg(b) : '<p class="note">Keine Zeiten veröffentlicht.</p>'}
      <p><button type="button" id="unfocus">Alle Bäder anzeigen</button></p>`;
    det.querySelector('#unfocus').addEventListener('click', () => setFocus(null));
  } else {
    det.innerHTML = '';
  }
}

function setFocus(id, fly) {
  state.focus = id;
  if (id && fly) {
    const b = BY_ID[id];
    map.flyTo([b.lat, b.lon], Math.max(map.getZoom(), 12), { duration: 0.6 });
    setTimeout(() => markers[id].openPopup(), 650);
  }
  update();
}

/* Ansicht in der URL (#mode=pt&thr=20&layer=hours&cats=hallenbad,freibad&focus=ms-mitte&tab=nrw) */
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (MODES[p.get('mode')] && TT[p.get('mode')]) state.mode = p.get('mode');
  if (THRS.includes(+p.get('thr'))) state.thr = +p.get('thr');
  if (['tt', 'hours', 'none'].includes(p.get('layer'))) state.layer = p.get('layer');
  if (p.has('cats')) {
    const c = p.get('cats').split(',');
    for (const k of Object.keys(CATS)) state.cats[k] = c.includes(k);
  }
  if (BY_ID[p.get('focus')]) state.focus = p.get('focus');
  if (METRICS[p.get('metric')]) state.metric = p.get('metric');
  return p.get('tab');
}
function writeHash() {
  const p = new URLSearchParams();
  p.set('mode', state.mode); p.set('thr', state.thr); p.set('layer', state.layer);
  p.set('cats', Object.keys(CATS).filter(k => state.cats[k]).join(','));
  if (state.focus) p.set('focus', state.focus);
  if (state.metric !== 'stunden_je_10k_ew') p.set('metric', state.metric);
  const tab = document.querySelector('[role=tab][aria-selected=true]');
  if (tab && tab.id !== 'tab-ms') p.set('tab', tab.id.slice(4));
  history.replaceState(null, '', '#' + p.toString());
}

function update() {
  compute();
  writeHash();
  syncMarkers();
  cellLayer.redraw();
  renderKpis();
  renderLegend();
  renderPools();
}

/* ------------------------------------------------------------------ */
/* NRW-Vergleich                                                       */
/* ------------------------------------------------------------------ */
function renderNrw() {
  const m = METRICS[state.metric];
  document.getElementById('metric-note').textContent = m.note;
  const done = NRW.staedte.filter(s => s.kennzahlen && s.kennzahlen[state.metric] != null);
  const noArea = NRW.staedte.filter(s => s.kennzahlen && s.kennzahlen[state.metric] == null);
  const open = NRW.staedte.filter(s => !s.kennzahlen);
  done.sort((a, b) => b.kennzahlen[state.metric] - a.kennzahlen[state.metric]);
  const max = Math.max(...done.map(s => s.kennzahlen[state.metric]), 1);
  document.getElementById('bars').innerHTML = done.map(s => {
    const v = s.kennzahlen[state.metric];
    const tip = `${s.stadt}: ${fmt1(s.kennzahlen.stunden_woche)} h/Woche in ${s.kennzahlen.anzahl_baeder_oeffentlich} Hallenbädern, ${fmt0(s.einwohner)} EW`;
    return `<div class="barrow ${s.ags === '05515' ? 'ms' : ''}" title="${esc(tip)}">
      <span class="city">${esc(s.stadt)}</span>
      <span class="track"><span class="fill" style="display:block;width:${(v / max) * 100}%"></span></span>
      <span class="val">${m.fmt(v)}</span></div>`;
  }).join('');
  document.getElementById('missing').innerHTML =
    (noArea.length ? `<p class="missing"><b>Wasserflächen nicht veröffentlicht (${noArea.length}):</b> ${noArea.map(s => esc(s.stadt)).join(', ')} – für diese Kennzahl nicht vergleichbar.</p>` : '') +
    (open.length ? `<p class="missing"><b>Noch nicht erfasst (${open.length} von ${NRW.staedte.length}):</b> ${open.map(s => esc(s.stadt)).join(', ')}</p>` : '');
  const dash = (v, f) => (v == null ? '–' : f(v));
  const rows = NRW.staedte.filter(s => s.kennzahlen)
    .sort((a, b) => b.kennzahlen.stunden_je_10k_ew - a.kennzahlen.stunden_je_10k_ew).map(s => {
      const k = s.kennzahlen;
      const tip = [s.hinweis, ...(k.datenluecken || [])].filter(Boolean).join(' · ');
      return `<tr title="${esc(tip)}"><td>${esc(s.stadt)}</td><td>${fmt0(s.einwohner)}</td><td>${k.anzahl_baeder_oeffentlich}</td><td>${fmt1(k.stunden_woche)}</td>
      <td>${fmt1(k.stunden_je_10k_ew)}</td><td>${dash(k.m2h_je_1000_ew, fmt0)}</td><td>${dash(k.wasserflaeche_m2_je_1000_ew, fmt1)}</td></tr>`;
    }).join('');
  document.getElementById('nrw-table').innerHTML = `<table class="data">
    <thead><tr><th>Stadt</th><th>Einw.</th><th>Bäder</th><th>h/Wo.</th><th>h/10k</th><th>m²·h/1k</th><th>m²/1k</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="note">Quellen je Bad in <a href="data/nrw.json">data/nrw.json</a>.</p>`;
}

/* ------------------------------------------------------------------ */
/* Methodik                                                            */
/* ------------------------------------------------------------------ */
function renderMethodik() {
  const k = MS.kennzahlen_stadt.kern;
  document.getElementById('methodik').innerHTML = `
  <h2>Was gezählt wird</h2>
  <p>Erfasst sind die <b>Zeiten für allgemeines öffentliches Schwimmen</b>, also Zeiten, in denen jede Person mit Eintrittskarte schwimmen kann. Schul-, Vereins- und Kurszeiten zählen nicht. Grundlage ist der reguläre Wochenplan im Winterhalbjahr (${esc(MS.bezug)}), Stand ${fmtDate(MS.stand)}. Ferien- und Feiertagsregelungen sind nicht eingerechnet.</p>
  <ul>
    <li><b>Öffentlich:</b> ganzes Bad für alle.</li>
    <li><b>Öffentlich auf Teilfläche:</b> z. B. 2 Bahnen parallel zum Schulschwimmen. Zählt als Stunde, in der Wasserflächen-Kennzahl nur anteilig.</li>
    <li><b>Zielgruppe:</b> z. B. Frauen- oder TIN*-Schwimmzeit. Wird angezeigt, zählt aber nicht zur Kernkennzahl.</li>
    <li>Slots, die nicht jede Woche stattfinden (z. B. Roxel/Wolbeck im Wochenendwechsel), werden mit ihrer Häufigkeit gewichtet.</li>
    <li>Parallele Kurse in einzelnen Becken während des öffentlichen Betriebs werden nicht abgezogen, sondern beim Bad als Einschränkung genannt.</li>
  </ul>
  <h2>Kennzahlen</h2>
  <ul>
    <li><b>Stunden je 10.000 Einwohner:</b> Summe der öffentlichen Stunden pro Woche aller kommunalen Hallenbäder ÷ Einwohner × 10.000. Münster: ${fmt1(k.stunden_woche)} h ÷ ${fmt0(k.einwohner)} EW → <b>${fmt1(k.stunden_je_10k_ew)}</b>.</li>
    <li><b>Wasserflächen-Stunden je 1.000 Einwohner:</b> Σ (Stunden × Wasserfläche) ÷ Einwohner × 1.000. Ein großes Bad mit vielen Stunden zählt mehr als ein kleines Lehrschwimmbecken. Münster: <b>${fmt0(k.m2h_je_1000_ew)}</b> m²·h.</li>
    <li><b>Wasserfläche je 1.000 Einwohner:</b> reine Infrastruktur-Kennzahl der Bäder mit öffentlichen Zeiten. Münster: <b>${fmt1(k.wasserflaeche_m2_je_1000_ew)}</b> m².</li>
  </ul>
  <p>Für den NRW-Vergleich zählen nur <b>kommunale Hallenbäder</b> (Stadt oder städtische Bäder-/Stadtwerkegesellschaft), weil Freibäder saisonal sind und Bäder anderer Träger sehr unterschiedlich zugänglich sind. Freibäder und andere Träger lassen sich in der Münster-Karte zuschalten.</p>
  <h2>Einzugsbereiche</h2>
  <p>Für jede bewohnte und unbewohnte 100-m-Zelle des Zensus-2022-Gitters im Stadtgebiet wird die Reisezeit zu jedem Bad berechnet:</p>
  <ul>
    <li><b>Zu Fuß:</b> 4,5 km/h auf dem Fußwegenetz von OpenStreetMap.</li>
    <li><b>Rad:</b> 15 km/h auf dem Radnetz von OpenStreetMap, Einbahnregeln beachtet.</li>
    <li><b>ÖPNV:</b> Tür-zu-Tür. Fußweg zur Haltestelle (bis 1 km, Luftlinie × 1,3), Fahrplan ${esc(MS.oepnv.stichtag)} (Dienstag), Umstiege mit bis zu 500 m Fußweg und 1 min Puffer, Fußweg zum Bad. Ausgewertet für eine Ankunft am Bad zwischen 17 und 19 Uhr im 15-Minuten-Takt; gezeigt wird der Median. Ist man zu Fuß schneller, gilt die Fußzeit. Datengrundlage: ${esc(MS.oepnv.quelle)}, ${fmt0(MS.oepnv.verbindungen)} Teilfahrten.</li>
  </ul>
  <p><b>Welche Anfahrt ist zumutbar?</b> Eine verbindliche Norm gibt es nicht. Nach Erfahrungswerten der Deutschen Gesellschaft für das Badewesen (DGfdB) nehmen Badegäste in der Stadt für ein Sporthallenbad etwa <b>10–15 Minuten</b> Anfahrt in Kauf, für ein Freibad etwa 20 Minuten und für ein Freizeitbad 20–30 Minuten (zitiert in <a href="https://e-government.hannover-stadt.de/lhhsimwebre.nsf/DS/2152-2013" target="_blank" rel="noopener">Drucksache 2152/2013 der Stadt Hannover</a>). Die Karte bietet deshalb 10, 15, 20 und 30 Minuten an. Voreingestellt sind 15 Minuten.</p>
  <p><b>Bevölkerungsanteile</b> beruhen auf dem Zensus-2022-Gitter (Summe ${fmt0(R.ew_summe)} Einwohner im Stadtgebiet). Die Kennzahlen je Einwohner beruhen auf der amtlichen Fortschreibung von IT.NRW zum 31.12.2025 (${fmt0(MS.einwohner)} Einwohner).</p>
  <h2>Grenzen der Auswertung</h2>
  <ul>
    <li>Öffnungszeiten sind keine Kapazität: Wie voll ein Bad ist und wie viele Bahnen durch Kurse belegt sind, ist nicht berücksichtigt.</li>
    <li>Die Wasserfläche des Südbads ist aus Planunterlagen geschätzt (≈ 444 m²).</li>
    <li>Die Zeiten des Bürgerbads Handorf stammen aus einer Drittquelle, für das Freibad Sudmühle sind keine Zeiten veröffentlicht.</li>
    <li>Im Sommer entfällt das öffentliche Schwimmen in mehreren Hallenbädern. Dann übernehmen die Freibäder. Der Vergleich bezieht sich auf den Winterbetrieb.</li>
  </ul>
  <h2>Daten &amp; Code</h2>
  <p>Alle Rohdaten mit Quellen: <a href="data/muenster.json">muenster.json</a>, <a href="data/nrw.json">nrw.json</a>. Die Skripte zur Erhebung und Berechnung liegen im Repository (Ordner <code>scripts/</code>).</p>
  <p class="note">Kartengrundlage: basemap.de / BKG (CC BY 4.0) bzw. © OpenStreetMap-Mitwirkende (ODbL). Wegenetz: OpenStreetMap (ODbL). ÖPNV: gtfs.de, DELFI e.V. (CC BY 4.0). Bevölkerung: Zensus 2022, Statistische Ämter des Bundes und der Länder (dl-de/by-2-0). Einwohner: IT.NRW (dl-de/by-2-0).</p>`;
}

load().catch(err => {
  console.error(err);
  document.getElementById('kpis').innerHTML = `<div class="callout">Daten konnten nicht geladen werden: ${esc(err.message)}</div>`;
});
