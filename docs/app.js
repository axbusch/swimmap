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
const GROUPS = {
  alle: { label: 'Alle Einwohner', plural: 'Einwohner', sing: 'Einwohner' },
  kinder: { label: 'Kinder 6–15', plural: 'Kinder (6–15 J.)', sing: 'Kind (6–15 J.)' },
};
// Reihenfolge = Priorität für die Markerfarbe eines Standorts
const CATS = {
  hallenbad: { label: 'Kommunale Hallenbäder', letter: 'H', cssVar: '--cat-hallenbad', def: true },
  freizeit: { label: 'Freizeitbereiche (Wellenbad, Rutschen …)', letter: 'E', cssVar: '--cat-freizeit', def: false },
  freibad: { label: 'Freibäder (nur Mai–Sept.)', letter: 'F', cssVar: '--cat-freibad', def: false },
  andere: { label: 'Bäder anderer Träger', letter: 'A', cssVar: '--cat-andere', def: false },
  geschlossen: { label: 'Derzeit geschlossen (Sanierung/Neubau)', letter: '×', cssVar: '--cat-geschlossen', def: true },
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
  abend_je_10k_ew: {
    label: 'Abends', fmt: v => fmt1(v),
    note: 'Öffentliche Schwimmstunden werktags (Mo–Fr) ab 17 Uhr je 10.000 Einwohner – die Zeiten, die Berufstätige und Schulkinder nach Schule/Arbeit nutzen können.',
  },
  wochenende_je_10k_ew: {
    label: 'Wochenende', fmt: v => fmt1(v),
    note: 'Öffentliche Schwimmstunden an Samstagen und Sonntagen je 10.000 Einwohner.',
  },
  ew_rad15: {
    label: 'Einwohner: Bad ≤ 15 min Rad', fmt: v => fmtPct(v),
    note: 'Anteil der Einwohner (Zensus-Raster), die ein kommunales Hallenbad mit öffentlichen Zeiten in höchstens 15 Minuten mit dem Rad erreichen.',
  },
  kinder_rad15: {
    label: 'Kinder 6–15: Bad ≤ 15 min Rad', fmt: v => fmtPct(v),
    note: 'Anteil der Schulkinder (6–15 Jahre, Zensus 2022), die ein kommunales Hallenbad in höchstens 15 Minuten mit dem Rad erreichen.',
  },
  kinder_fuss15: {
    label: 'Kinder 6–15: Bad ≤ 15 min zu Fuß', fmt: v => fmtPct(v),
    note: 'Anteil der Schulkinder (6–15 Jahre), die ein kommunales Hallenbad in höchstens 15 Minuten zu Fuß erreichen.',
  },
  kinder_oepnv20: {
    label: 'Kinder 6–15: Bad ≤ 20 min ÖPNV', fmt: v => fmtPct(v),
    note: 'Anteil der Schulkinder (6–15 Jahre), die ein kommunales Hallenbad in höchstens 20 Minuten mit Bus und Bahn (Tür-zu-Tür, dienstags 17–19 Uhr) erreichen.',
  },
  ist_je_10k_ew: {
    label: 'Tatsächlich angeboten 2025', fmt: v => fmt1(v), ausfall: true,
    note: 'Öffentliche Schwimmstunden, die 2025 nach Abzug aller Schließtage (Revision, Defekte, Sommer- und Ferienschließungen, Feiertage, kurzfristige Ausfälle) tatsächlich angeboten wurden – als Durchschnitt pro Woche je 10.000 Einwohner, direkt vergleichbar mit „Stunden je 10.000 EW“. Nur für Städte mit recherchierter Schließtage-Chronik.',
  },
  ausfall_anteil: {
    label: 'Ausgefallen 2025 (Anteil)', fmt: v => fmtPct(v), ausfall: true,
    note: 'Anteil der Regelplan-Stunden 2025, die wegen Schließungen ausfielen. Hoher Wert = viel Ausfall. Nur für Städte mit recherchierter Schließtage-Chronik; die Quellenlage ist unterschiedlich gut (siehe Tabelle unten).',
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
const fmtDate = iso => iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)
  ? new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }) : (iso || '');

/* ------------------------------------------------------------------ */
/* Zustand                                                             */
/* ------------------------------------------------------------------ */
const state = {
  city: 'muenster',
  cats: Object.fromEntries(Object.entries(CATS).map(([k, c]) => [k, c.def])),
  mode: 'bike',
  thr: 15,
  layer: 'tt',
  focus: null,      // Standort-ID
  metric: 'stunden_je_10k_ew',
  group: 'alle',     // Bezugsgruppe für Anteile
};
const INDEX = window.SWIMMAP_INDEX;
const CITIES = {};          // geladene Stadtdaten je slug
let C = null;               // aktuelle Stadt
let TT = {}, RIDX = {}, BAD = {}, ST = {};
let map, cellLayer, boundaryLayer, markers = {}, infoCtl;
let comp = null;
let BUCKETS = new Map();

const isSummer = b => b.cat === 'freibad';
const activeBaeder = () => C.baeder.filter(b => state.cats[b.cat]);
// Bäder, die einen Einzugsbereich erzeugen (geschlossene nicht)
const catchBaeder = () => (state.focus
  ? C.baeder.filter(b => b.standort_id === state.focus && b.cat !== 'geschlossen')
  : activeBaeder().filter(b => b.cat !== 'geschlossen'));

/* ------------------------------------------------------------------ */
/* Laden                                                               */
/* ------------------------------------------------------------------ */
// Stadtdaten kommen als <script> (funktioniert auch bei file://)
const pending = {};
window.SWIMMAP_CITY = data => {
  CITIES[data.slug] = data;
  if (pending[data.slug]) { pending[data.slug].forEach(f => f(data)); delete pending[data.slug]; }
};
function loadCity(slug) {
  if (CITIES[slug]) return Promise.resolve(CITIES[slug]);
  return new Promise((resolve, reject) => {
    (pending[slug] = pending[slug] || []).push(resolve);
    if (pending[slug].length > 1) return;
    const s = document.createElement('script');
    s.src = `data/st/${slug}.js`;
    s.onerror = () => reject(new Error(`Daten für ${slug} nicht gefunden`));
    document.head.appendChild(s);
  });
}

async function init() {
  const tab = readHash();
  initMap();
  initControls(tab);
  renderNrw();
  renderMethodik();
  renderInfo();
  await selectCity(state.city, { keepFocus: true });
}

async function selectCity(slug, { keepFocus = false } = {}) {
  const meta = INDEX.staedte.find(s => s.slug === slug && s.karte) || INDEX.staedte.find(s => s.slug === 'muenster');
  document.getElementById('city').value = meta.slug;
  document.getElementById('kpis').innerHTML = '<p class="note">Lade Daten …</p>';
  const data = await loadCity(meta.slug);
  C = data;
  state.city = data.slug;
  if (!keepFocus) state.focus = null;
  BAD = {}; ST = {}; RIDX = {}; TT = {};
  C.baeder.forEach(b => (BAD[b.id] = b));
  C.standorte.forEach(s => (ST[s.id] = s));
  C.raster.standorte.forEach((id, i) => (RIDX[id] = i));
  for (const [mode, arrs] of Object.entries(C.raster.tt)) {
    TT[mode] = arrs.map(b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
  }
  if (!TT[state.mode]) state.mode = 'bike';
  if (state.focus && !ST[state.focus]) state.focus = null;
  buildBuckets();
  // vorhandene Kategorien
  const present = new Set(C.baeder.map(b => b.cat));
  document.querySelectorAll('#cats label').forEach(l => (l.hidden = !present.has(l.dataset.cat)));
  document.querySelectorAll('#cats label').forEach(l => {
    const n = C.baeder.filter(b => b.cat === l.dataset.cat).length;
    l.querySelector('.cnt').textContent = `(${n})`;
  });
  segButtons(document.getElementById('mode'), Object.entries(MODES).map(([k, m]) => [k, m.label, !TT[k]]), 'mode', update);
  setCityChrome();
  drawCity();
  update();
  renderSchliessungen();
  if (state.focus) {
    const s = ST[state.focus];
    map.setView([s.lat, s.lon], 13, { animate: false });
    markers[state.focus].openPopup();
  }
  renderNrw();
}

function setCityChrome() {
  document.getElementById('title').textContent = `Schwimmzeiten in ${C.stadt}`;
  document.title = `Schwimmzeiten ${C.stadt}`;
  document.getElementById('tab-ms').textContent = C.stadt;
  document.getElementById('stand').textContent =
    `Öffentliche Schwimmzeiten, Einzugsbereiche und NRW-Vergleich · Stand ${fmtDate(C.stand)}`;
  const h = document.getElementById('city-note');
  h.innerHTML = C.hinweis
    ? `<details><summary>Hinweise zur Datenlage in ${esc(C.stadt)}</summary><p class="note">${esc(C.hinweis)}</p></details>` : '';
}

/* ------------------------------------------------------------------ */
/* Berechnung                                                          */
/* ------------------------------------------------------------------ */
function compute() {
  const n = C.raster.zellen, thr = state.thr, mode = state.mode;
  // Bezugsgruppe: alle Einwohner oder Schulkinder 6–15 (Zensus-Altersraster)
  const ew = state.group === 'kinder' && C.raster.kinder ? C.raster.kinder : C.raster.ew;
  const ewSum = (state.group === 'kinder' && C.raster.kinder ? C.raster.kinder_summe : C.raster.ew_summe) || 1;
  const cb = catchBaeder().filter(b => TT[mode] && RIDX[b.standort_id] !== undefined);
  // Stunden nur innerhalb einer Saison summieren
  const winterSel = cb.some(b => !isSummer(b));
  const counts = b => (winterSel ? !isSummer(b) : isSummer(b));
  const hoursBySt = {};
  for (const b of cb) hoursBySt[b.standort_id] = (hoursBySt[b.standort_id] || 0) + (counts(b) ? b.kennzahlen.stunden_woche : 0);
  const stIds = Object.keys(hoursBySt);
  const tmin = new Uint8Array(n).fill(255);
  const nearest = new Int16Array(n).fill(-1);
  const hrs = new Float32Array(n);
  for (const sid of stIds) {
    const k = RIDX[sid], arr = TT[mode][k], h = hoursBySt[sid];
    for (let i = 0; i < n; i++) {
      const v = arr[i];
      if (v < tmin[i]) { tmin[i] = v; nearest[i] = k; }
      if (v <= thr) hrs[i] += h;
    }
  }
  const perSt = {};
  for (const s of C.standorte) {
    const arr = TT[mode] && TT[mode][RIDX[s.id]];
    if (!arr) continue;
    let cov = 0;
    for (let i = 0; i < n; i++) if (arr[i] <= thr) cov += ew[i];
    perSt[s.id] = cov / ewSum;
  }
  let popIn = 0, hSum = 0;
  for (let i = 0; i < n; i++) {
    if (tmin[i] <= thr) popIn += ew[i];
    hSum += hrs[i] * ew[i];
  }
  const act = activeBaeder().filter(b => b.cat !== 'geschlossen');
  const actWinter = act.some(b => !isSummer(b));
  const sumB = act.filter(b => (actWinter ? !isSummer(b) : isSummer(b)));
  const hoursTotal = sumB.reduce((s, b) => s + b.kennzahlen.stunden_woche, 0);
  const summerExtra = actWinter ? act.filter(isSummer).reduce((s, b) => s + b.kennzahlen.stunden_woche, 0) : 0;
  comp = {
    tmin, nearest, hrs, perSt,
    share: popIn / ewSum, avgHours: hSum / ewSum,
    hoursTotal, per10k: hoursTotal / C.einwohner * 1e4,
    nActive: sumB.length, season: actWinter ? 'winter' : 'sommer',
    summerExtra, nSummer: act.filter(isSummer).length,
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
  onRemove(m) { this._c.remove(); m.off('moveend zoomend resize', this.redraw, this); },
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
    if (!comp || !C || state.layer === 'none') return;
    const R = C.raster;
    const lat0 = m.getCenter().lat, lon0 = m.getCenter().lng;
    const dlon = DLAT / Math.cos(lat0 * Math.PI / 180);
    const p0 = m.latLngToContainerPoint([lat0, lon0]);
    const p1 = m.latLngToContainerPoint([lat0 + DLAT, lon0 + dlon]);
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
function colorTT(i) { const v = comp.tmin[i]; for (const c of TT_CLASSES) if (v <= c.max) return c.color; return null; }
function colorH(i) { const v = comp.hrs[i]; for (const c of H_CLASSES) if (v >= c.min) return c.color; return null; }

function initMap() {
  map = L.map('map', { zoomControl: true }).setView([51.5, 7.3], 8);
  const basemap = L.tileLayer(
    'https://sgx.geodatenzentrum.de/wmts_basemapde/tile/1.0.0/de_basemapde_web_raster_grau/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png',
    { maxZoom: 18, attribution: '© <a href="https://basemap.de">basemap.de</a> / BKG (CC BY 4.0)' });
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende' });
  basemap.addTo(map);
  map.attributionControl.addAttribution('Bäder: Betreiber/Städte · Bevölkerung: Zensus 2022 · ÖPNV: gtfs.de/DELFI · Wege & Lage: OSM');
  L.control.layers({ 'basemap.de (grau)': basemap, 'OpenStreetMap': osm }, null, { position: 'topright' }).addTo(map);
  cellLayer = new CellLayer();
  cellLayer.addTo(map);

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
    if (state.focus && e.popup._source === markers[state.focus]) setFocus(null);
  });
}

function primaryCat(s, onlyActive) {
  const cats = s.baeder.map(id => BAD[id].cat).filter(c => !onlyActive || state.cats[c]);
  return Object.keys(CATS).find(k => cats.includes(k)) || BAD[s.baeder[0]].cat;
}

function drawCity() {
  Object.values(markers).forEach(m => map.removeLayer(m));
  markers = {};
  if (boundaryLayer) map.removeLayer(boundaryLayer);
  boundaryLayer = L.geoJSON(C.grenze, { interactive: false, style: { color: '#52514e', weight: 1.5, fill: false, dashArray: '4 3' } }).addTo(map);
  // ohne Animation: ein animiertes fitBounds würde durch spätere setView/setZoom abgebrochen
  const bb = boundaryLayer.getBounds();
  map.invalidateSize({ animate: false });
  map.setView(bb.getCenter(), Math.max(10, map.getBoundsZoom(bb, false, L.point(20, 20))), { animate: false });
  for (const s of C.standorte) {
    const mk = L.marker([s.lat, s.lon], { title: s.name, keyboard: true, riseOnHover: true });
    mk.bindPopup(() => standortPopup(s), { maxWidth: 360, maxHeight: Math.max(260, Math.round(map.getSize().y * 0.8)) });
    mk.on('click', () => setFocus(s.id, false));
    markers[s.id] = mk;
  }
}

function syncMarkers() {
  for (const s of C.standorte) {
    const mk = markers[s.id];
    const on = s.baeder.some(id => state.cats[BAD[id].cat]) || state.focus === s.id;
    if (on && !map.hasLayer(mk)) mk.addTo(map);
    if (!on && map.hasLayer(mk)) map.removeLayer(mk);
    const cat = primaryCat(s, true);
    mk.setIcon(L.divIcon({
      className: '',
      html: `<div class="pool-marker${state.focus === s.id ? ' focus' : ''}" style="background:${css(CATS[cat].cssVar)}">${CATS[cat].letter}</div>`,
      iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -10],
    }));
  }
}

function buildBuckets() {
  BUCKETS = new Map();
  const R = C.raster, BK = 0.002;
  for (let i = 0; i < R.zellen; i++) {
    const k = Math.floor(R.lat[i] / BK) + ':' + Math.floor(R.lon[i] / BK);
    let a = BUCKETS.get(k);
    if (!a) BUCKETS.set(k, (a = []));
    a.push(i);
  }
}
function cellAt(lat, lon) {
  const R = C.raster, BK = 0.002;
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
  const i = comp && C ? cellAt(e.latlng.lat, e.latlng.lng) : -1;
  if (i < 0) { box.style.display = 'none'; return; }
  const t = comp.tmin[i], k = comp.nearest[i];
  const name = k >= 0 ? ST[C.raster.standorte[k]].name : '–';
  const tt = t === 255 ? 'über 120 min' : `${t} min ${MODES[state.mode].short}`;
  box.innerHTML =
    `<b>${fmt0(C.raster.ew[i])}</b> Einwohner in dieser 100-m-Zelle${C.raster.kinder ? `, davon ca. ${fmt0(C.raster.kinder[i])} Kinder (6–15)` : ''}<br>` +
    `${state.focus ? 'Zum Bad' : 'Nächstes Bad'}: <b>${esc(name)}</b>, ${tt}<br>` +
    `Erreichbar in ≤ ${state.thr} min: <b>${fmt0(comp.hrs[i])} h</b> öffentl. Schwimmzeit/Woche`;
  box.style.display = 'block';
}

/* ------------------------------------------------------------------ */
/* Wochenplan (SVG) und Popups                                         */
/* ------------------------------------------------------------------ */
function weekSvg(b) {
  const W = 320, L0 = 24, R0 = 6, T0 = 14, ROW = 15, h0 = 6, h1 = 23;
  const x = h => L0 + (Math.min(Math.max(h, h0), h1) - h0) / (h1 - h0) * (W - L0 - R0);
  const H = T0 + ROW * 7 + 2;
  const toH = s => { const [a, c] = s.split(':').map(Number); return a + c / 60; };
  let s = `<svg class="week" viewBox="0 0 ${W} ${H}" role="img" aria-label="Wochenplan ${esc(b.name)}">`;
  for (let h = 6; h <= 21; h += 3) {
    s += `<line class="grid" x1="${x(h)}" x2="${x(h)}" y1="${T0 - 2}" y2="${H - 2}"/>`;
    s += `<text x="${x(h)}" y="9" text-anchor="middle">${h}</text>`;
  }
  TAGE.forEach((t, d) => { s += `<text x="0" y="${T0 + ROW * d + ROW / 2 + 3}">${t}</text>`; });
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

function badSection(b, multi) {
  const k = b.kennzahlen;
  const flaeche = b.wasserflaeche_m2
    ? `${fmt0(b.wasserflaeche_m2)} m² Wasserfläche${b.wasserflaeche_geschaetzt ? ' (geschätzt)' : ''}` : 'Wasserfläche nicht veröffentlicht';
  const warn = b.zeiten_unbekannt ? '<div class="callout">Öffentliche Zeiten derzeit nicht veröffentlicht.</div>'
    : b.zeiten_unsicher ? '<div class="callout">Zeiten aus Drittquelle, nicht vom Betreiber bestätigt.</div>'
    : b.cat === 'geschlossen' ? `<div class="callout">${esc(b.hinweis || 'Derzeit geschlossen.')}</div>` : '';
  const zgList = Object.entries(k.zielgruppen || {});
  const zg = k.stunden_zielgruppe_woche > 0
    ? ` + <span class="zg" title="${esc(zgList.map(([g, h]) => `${g}: ${fmt1(h)} h`).join(' · '))}">${fmt1(k.stunden_zielgruppe_woche)} h Zielgruppen</span>` : '';
  const zgLine = zgList.length
    ? `<div class="note">Zielgruppenzeiten: ${zgList.map(([g, h]) => `${esc(g)} ${fmt1(h)} h`).join(' · ')}</div>` : '';
  const saison = b.saison ? `<div>Saison 2026: ${fmtDate(b.saison.von)} – ${fmtDate(b.saison.bis)}</div>` : '';
  const sommer = b.sommer ? `<div class="note">Sommer: ${esc(b.sommer)}</div>` : '';
  const hinweis = b.hinweis && b.cat !== 'geschlossen' ? `<div class="note">${esc(b.hinweis)}</div>` : '';
  const ein = (b.einschraenkungen || []).length
    ? `<details><summary>Einschränkungen (${b.einschraenkungen.length})</summary><ul>${b.einschraenkungen.map(e => `<li>${esc(e)}</li>`).join('')}</ul></details>` : '';
  const q = b.quelle && b.quelle.url
    ? `<div class="note">Quelle: <a href="${esc(b.quelle.url)}" target="_blank" rel="noopener">${esc(new URL(b.quelle.url).hostname)}</a>, abgerufen ${fmtDate(b.quelle.abgerufen)}</div>` : '';
  return `${multi ? `<h5>${esc(b.name)} <span class="tag">${esc(CATS[b.cat].label.split(' (')[0])}</span></h5>` : ''}
    ${warn}
    <div><b>${fmt1(k.stunden_woche)} h</b> öffentliches Schwimmen pro Woche${zg}</div>
    ${zgLine}
    <div class="note">davon werktags ab 17 Uhr ${fmt1(k.stunden_abend_woche || 0)} h · am Wochenende ${fmt1(k.stunden_wochenende_woche || 0)} h</div>
    <div>${flaeche}${k.m2h_woche ? ` · ${fmt0(k.m2h_woche)} m²·h` : ''}</div>
    ${saison}${b.slots && b.slots.length ? weekSvg(b) : ''}${sommer}${hinweis}${ein}${q}`;
}

function standortPopup(s) {
  const bs = s.baeder.map(id => BAD[id]);
  const b0 = bs[0];
  const head = `<h4>${esc(bs.length > 1 ? s.name : b0.name)}</h4>
    <div class="pm">${esc(CATS[primaryCat(s, false)].label.split(' (')[0])} · ${esc(b0.traeger || '')}${b0.adresse ? '<br>' + esc(b0.adresse) : ''}</div>`;
  return head + bs.map(b => badSection(b, bs.length > 1)).join('<hr>');
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

function initControls(tab) {
  const sel = document.getElementById('city');
  const withMap = INDEX.staedte.filter(s => s.karte).sort((a, b) => a.stadt.localeCompare(b.stadt, 'de'));
  sel.innerHTML = withMap.map(s => `<option value="${s.slug}">${esc(s.stadt)}</option>`).join('');
  sel.addEventListener('change', () => selectCity(sel.value));

  const cats = document.getElementById('cats');
  for (const [k, c] of Object.entries(CATS)) {
    const lab = document.createElement('label');
    lab.dataset.cat = k;
    lab.innerHTML = `<input type="checkbox" ${state.cats[k] ? 'checked' : ''}> <span class="dot" style="background:${css(c.cssVar)}"></span> ${c.label} <span class="note cnt"></span>`;
    lab.querySelector('input').addEventListener('change', e => { state.cats[k] = e.target.checked; update(); });
    cats.appendChild(lab);
  }
  segButtons(document.getElementById('thr'), THRS.map(t => [t, `${t} min`]), 'thr', update);
  segButtons(document.getElementById('layer'), [['tt', 'Reisezeit'], ['hours', 'Erreichbare Stunden'], ['none', 'Aus']], 'layer', update);
  const msel = document.getElementById('metric');
  msel.innerHTML = Object.entries(METRICS).map(([k, m]) => `<option value="${k}" ${k === state.metric ? 'selected' : ''}>${esc(m.label)}</option>`).join('');
  msel.addEventListener('change', () => { state.metric = msel.value; renderNrw(); writeHash(); });
  segButtons(document.getElementById('group'), Object.entries(GROUPS).map(([k, g]) => [k, g.label]), 'group', update);

  const tabs = [...document.querySelectorAll('[role=tab]')];
  tabs.forEach(t => t.addEventListener('click', () => {
    tabs.forEach(o => {
      o.setAttribute('aria-selected', String(o === t));
      document.getElementById(o.getAttribute('aria-controls')).hidden = o !== t;
    });
    if (comp) writeHash();
  }));
  if (tab) document.getElementById('tab-' + tab)?.click();
}

function renderKpis() {
  const m = MODES[state.mode].short;
  const scope = state.focus ? `im Einzugsbereich von ${ST[state.focus].name}` : 'mit einem Bad';
  const saison = comp.season === 'winter' ? 'Winterplan' : 'Freibadsaison';
  const extra = comp.summerExtra > 0
    ? `; dazu ${fmt0(comp.summerExtra)} h in ${comp.nSummer} Freibädern (nur Mai–Sept., nicht addiert)` : '';
  const tiles = [
    [fmt0(comp.hoursTotal) + ' h', `öffentliche Schwimmzeit pro Woche, ${saison} (${comp.nActive} Bäder/Bereiche${extra})`],
    [fmt1(comp.per10k) + ' h', `je 10.000 Einwohner und Woche (${saison})`],
    [fmtPct(comp.share), `der ${GROUPS[state.group].plural} ${scope} in ≤ ${state.thr} min ${m}`],
    [fmt0(comp.avgHours) + ' h', `Ø erreichbare öffentl. Stunden/Woche je ${GROUPS[state.group].sing} (≤ ${state.thr} min ${m})`],
  ];
  const kern = C.kennzahlen_stadt;
  const nurKern = !state.focus && Object.keys(CATS).every(k => state.cats[k] === (k === 'hallenbad' || k === 'geschlossen'));
  const hinweis = kern && !nurKern
    ? `<p class="note kpi-note">Kernkennzahl für den NRW-Vergleich (nur kommunale Hallenbäder): <b>${fmt1(kern.stunden_je_10k_ew)} h</b> je 10.000 Einwohner.</p>` : '';
  document.getElementById('kpis').innerHTML =
    tiles.map(([v, l]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${esc(l)}</div></div>`).join('') + hinweis;
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
  } else { leg.innerHTML = ''; note.textContent = ''; }
}

// Kennzeichnung für öffentliche Zeiten, die höchstens jede zweite Woche stattfinden
function selten(b) {
  const s = (b.slots || []).filter(x => x.art !== 'zielgruppe' && (x.haeufigkeit ?? 1) <= 0.5);
  if (!s.length) return '';
  return s.every(x => x.tag === 'Sa' || x.tag === 'So') ? 'jedes 2. Wochenende' : 'teils nicht jede Woche';
}

function renderPools() {
  const list = document.getElementById('pools');
  const pools = activeBaeder().slice().sort((a, b) => b.kennzahlen.stunden_woche - a.kennzahlen.stunden_woche);
  const max = Math.max(1, ...pools.map(b => b.kennzahlen.stunden_woche));
  list.innerHTML = '';
  for (const b of pools) {
    const k = b.kennzahlen;
    const li = document.createElement('li');
    li.tabIndex = 0;
    li.className = state.focus === b.standort_id ? 'active' : '';
    const badge = b.cat === 'geschlossen' ? '<span class="badge">geschlossen</span>'
      : b.zeiten_unbekannt ? '<span class="badge">Zeiten unbekannt</span>'
      : b.zeiten_unsicher ? '<span class="badge">Zeiten unsicher</span>'
      : selten(b) ? `<span class="badge">${selten(b)}</span>` : '';
    const cov = comp.perSt[b.standort_id];
    li.innerHTML = `
      <span class="dot" style="background:${css(CATS[b.cat].cssVar)}"></span>
      <span class="name">${esc(b.name)}${badge}</span>
      <span class="hval">${fmt1(k.stunden_woche)} h</span>
      <span></span><span class="hbar"><i style="width:${(k.stunden_woche / max) * 100}%"></i></span><span></span>
      <span></span><span class="meta">${b.wasserflaeche_m2 ? fmt0(b.wasserflaeche_m2) + ' m²' : 'Fläche nicht veröffentlicht'}${cov !== undefined && b.cat !== 'geschlossen' ? ` · ${fmtPct(cov)} der ${GROUPS[state.group].plural} in ≤ ${state.thr} min ${MODES[state.mode].short}` : ''}</span>`;
    const go = () => setFocus(state.focus === b.standort_id ? null : b.standort_id, true);
    li.addEventListener('click', go);
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    list.appendChild(li);
  }
  const det = document.getElementById('detail');
  if (state.focus) {
    const s = ST[state.focus];
    det.innerHTML = `<h3>Wochenplan ${esc(s.name)}</h3>` +
      s.baeder.map(id => BAD[id]).map(b => `${s.baeder.length > 1 ? `<h4 class="sub">${esc(b.name)}</h4>` : ''}${b.slots && b.slots.length ? weekSvg(b) : '<p class="note">Keine Zeiten.</p>'}`).join('') +
      `<p><button type="button" id="unfocus">Alle Bäder anzeigen</button></p>`;
    det.querySelector('#unfocus').addEventListener('click', () => setFocus(null));
  } else det.innerHTML = '';
}

/* Wochenraster: wie viele (gewählte) Bäder sind zu welcher Zeit öffentlich offen? */
const WG_H0 = 6, WG_H1 = 23, WG_STEP = 0.5;
const WG_CLASSES = [
  { min: 5, color: '#104281', label: '5+' },
  { min: 4, color: '#1c5cab', label: '4' },
  { min: 3, color: '#2a78d6', label: '3' },
  { min: 2, color: '#5598e7', label: '2' },
  { min: 0.75, color: '#9ec5f4', label: '1' },
  { min: 0.01, color: '#cde2fb', label: 'nicht jede Woche' },
];
function renderWeekGrid() {
  const el = document.getElementById('weekgrid');
  const pools = activeBaeder().filter(b => b.cat !== 'geschlossen' && b.cat !== 'freibad');
  const nb = Math.round((WG_H1 - WG_H0) / WG_STEP);
  const toH = s => { const [a, c] = s.split(':').map(Number); return a + c / 60; };
  const grid = TAGE.map(() => Array.from({ length: nb }, () => ({ v: 0, names: [] })));
  for (const b of pools) {
    for (const s of b.slots || []) {
      if (s.art === 'zielgruppe') continue;
      const d = TAGE.indexOf(s.tag), a = toH(s.von), e = toH(s.bis), f = s.haeufigkeit ?? 1;
      for (let i = 0; i < nb; i++) {
        const t0 = WG_H0 + i * WG_STEP, t1 = t0 + WG_STEP;
        const ov = Math.max(0, Math.min(e, t1) - Math.max(a, t0)) / WG_STEP;
        if (ov >= 0.5) { grid[d][i].v += f; grid[d][i].names.push(b.name); }
      }
    }
  }
  const W = 360, L0 = 24, T0 = 14, ROW = 16, cw = (W - L0 - 2) / nb, H = T0 + ROW * 7 + 2;
  let gapH = 0;
  let s = `<svg class="week" viewBox="0 0 ${W} ${H}" role="img" aria-label="Wochenraster geöffneter Bäder">`;
  for (let h = WG_H0; h <= 21; h += 3) s += `<text x="${L0 + (h - WG_H0) / WG_STEP * cw}" y="9" text-anchor="middle">${h}</text>`;
  TAGE.forEach((t, d) => {
    s += `<text x="0" y="${T0 + ROW * d + ROW / 2 + 3}">${t}</text>`;
    for (let i = 0; i < nb; i++) {
      const c = grid[d][i], t0 = WG_H0 + i * WG_STEP;
      if (c.v === 0 && t0 >= 6 && t0 < 22) gapH += WG_STEP;
      const cls = WG_CLASSES.find(k => c.v >= k.min);
      const hh = String(Math.floor(t0)).padStart(2, '0') + ':' + (t0 % 1 ? '30' : '00');
      const tip = `${t} ${hh}: ${c.v === 0 ? 'kein Bad öffentlich offen' : `${fmt1(c.v).replace(',0', '')} Bad/Bäder offen – ${c.names.join(', ')}`}`;
      s += `<rect x="${L0 + i * cw + 0.5}" y="${T0 + ROW * d + 1}" width="${cw - 1}" height="${ROW - 2}" rx="2" fill="${cls ? cls.color : css('--surface-2')}"><title>${esc(tip)}</title></rect>`;
    }
  });
  s += '</svg>';
  const leg = WG_CLASSES.slice().reverse().map(c => `<span><i style="background:${c.color}"></i>${c.label}</span>`).join('');
  el.innerHTML = s + `<div class="week-legend"><span><i style="background:${css('--surface-2')}"></i>keins</span>${leg}</div>
    <p class="note">${pools.length ? `Zwischen 6 und 22 Uhr hat an <b>${fmt1(gapH)} Stunden pro Woche</b> keines der gewählten Bäder öffentlich geöffnet (von 112 Stunden).` : 'Keine Bäder gewählt.'} Ohne Freibäder und Zielgruppenzeiten.</p>`;
}

/* Schließtage 2024–heute (nur Münster, Chronik aus Pressemitteilungen) */
const SCHL_FARBEN = {
  revision: { cssVar: '--series-1', fb: '#2a78d6' },
  defekt: { cssVar: '--series-2', fb: '#eb6834' },
  sommer: { cssVar: '--series-3', fb: '#1baf7a' },
  ferien: { cssVar: '--series-4', fb: '#eda100' },
  feiertag: { cssVar: '--series-5', fb: '#e87ba4' },
  personal: { cssVar: '--series-7', fb: '#6250d6' },
};
const schlColor = k => css(SCHL_FARBEN[k].cssVar) || SCHL_FARBEN[k].fb;

function renderSchliessungen() {
  const el = document.getElementById('closures');
  const S = C.schliessungen;
  if (!S) { el.innerHTML = ''; return; }
  const kats = Object.keys(S.kategorien);
  const jahre = Object.keys(S.jahre);
  const codeKat = Object.fromEntries(Object.entries(S.codes).map(([k, v]) => [v, k]));
  const sum = S.jahre;
  // Kacheln je Jahr
  const tiles = jahre.map(j => {
    const s = sum[j];
    const aus = s.stunden_plan - s.stunden_ist;
    return `<div class="kpi"><div class="v">${fmt0(aus)} h</div>
      <div class="l">${j}${j === S.zeitraum.bis.slice(0, 4) && !S.zeitraum.bis.endsWith('-12-31') ? ` (bis ${fmtDate(S.zeitraum.bis)})` : ''}: öffentliche Schwimmzeit ausgefallen – ${fmtPct(aus / s.stunden_plan)} der Regelplan-Stunden; ${s.schliesstage} von ${s.plantage} Plantagen geschlossen</div></div>`;
  }).join('');
  // Tabelle mit gestapelten Balken je Bad und Jahr
  const rows = Object.entries(S.baeder).map(([bid, b]) => {
    const cells = jahre.map(j => {
      const y = b.jahre[j];
      if (!y || !y.plantage) return '<td class="note">–</td>';
      const segs = kats.filter(k => y.geschlossen[k]).map(k =>
        `<i style="width:${y.geschlossen[k] / y.plantage * 100}%;background:${schlColor(k)}" title="${esc(S.kategorien[k])}: ${y.geschlossen[k]} Tage"></i>`).join('');
      const tip = `${b.name} ${j}: ${y.schliesstage} von ${y.plantage} Plantagen geschlossen; ${fmt0(y.stunden_ist)} von ${fmt0(y.stunden_plan)} Regelplan-Stunden angeboten`;
      const aus = y.stunden_plan - y.stunden_ist;
      return `<td title="${esc(tip)}"><div class="stack">${segs}</div><span class="note">${y.schliesstage}/${y.plantage} Tage · <b>${fmt0(aus)} h</b> aus</span></td>`;
    }).join('');
    return `<tr><td>${esc(kurzName(b.name))}</td>${cells}</tr>`;
  }).join('');
  const leg = kats.map(k => `<span><i style="background:${schlColor(k)}"></i>${esc(S.kategorien[k])}</span>`).join('');
  // Zeitstrahl: Status jedes Tages je Bad
  const d0 = new Date(S.zeitraum.von + 'T12:00:00'), d1 = new Date(S.zeitraum.bis + 'T12:00:00');
  const nd = Math.round((d1 - d0) / 864e5) + 1;
  const W = 360, L0 = 70, ROW = 14, T0 = 14, H = T0 + ROW * Object.keys(S.baeder).length + 2;
  const xd = i => L0 + i / nd * (W - L0 - 2);
  let svg = `<svg class="week" viewBox="0 0 ${W} ${H}" role="img" aria-label="Zeitstrahl Schließtage">`;
  for (let y = d0.getFullYear(); y <= d1.getFullYear(); y++) {
    for (const m of [0, 6]) {
      const dt = new Date(y, m, 1, 12);
      if (dt < d0 || dt > d1) continue;
      const i = Math.round((dt - d0) / 864e5);
      svg += `<line class="grid" x1="${xd(i)}" x2="${xd(i)}" y1="${T0 - 3}" y2="${H}"/>`;
      svg += `<text x="${xd(i) + 2}" y="9">${m === 0 ? y : 'Jul'}</text>`;
    }
  }
  Object.values(S.baeder).forEach((b, r) => {
    const y = T0 + r * ROW;
    const nm = kurzName(b.name);
    svg += `<text x="0" y="${y + ROW / 2 + 3}">${esc(nm.length > 13 ? nm.slice(0, 12) + '…' : nm)}<title>${esc(b.name)}</title></text>`;
    let i = 0;
    while (i < b.strip.length) {
      const c = b.strip[i];
      let j = i;
      while (j + 1 < b.strip.length && (b.strip[j + 1] === c || b.strip[j + 1] === '.' && c !== '.' && b.strip.slice(j + 1).search(/[^.]/) >= 0 && b.strip[j + 1 + b.strip.slice(j + 1).search(/[^.]/)] === c)) j++;
      if (c !== '.') {
        const fill = c === 'o' ? css('--grid') : schlColor(codeKat[c]);
        const von = new Date(d0.getTime() + i * 864e5), bis = new Date(d0.getTime() + j * 864e5);
        const tip = `${von.toLocaleDateString('de-DE')} – ${bis.toLocaleDateString('de-DE')}: ${c === 'o' ? 'geöffnet' : S.kategorien[codeKat[c]]}`;
        svg += `<rect x="${xd(i)}" y="${y + 2}" width="${Math.max(0.6, xd(j + 1) - xd(i))}" height="${ROW - 4}" fill="${fill}"><title>${esc(tip)}</title></rect>`;
      }
      i = j + 1;
    }
  });
  svg += '</svg>';
  const ohne = (S.ohne_oeffentlichen_betrieb || []).map(o => `<li><b>${esc(BAD[o.bad] ? BAD[o.bad].name : o.bad)}:</b> ${esc(o.grund)}</li>`).join('');
  const ev = S.ereignisse.slice().sort((a, b) => a.von.localeCompare(b.von)).map(e =>
    `<tr><td>${fmtDateShort(e.von)}${e.bis !== e.von ? '–' + fmtDateShort(e.bis) : ''}</td><td>${esc((BAD[e.bad] || {}).name || e.bad)}</td><td><i class="sw" style="background:${schlColor(e.kat)}"></i>${esc(e.grund)}${e.tage ? ` (nur ${e.tage.join('/')})` : ''}</td><td class="note">${quelleHtml(e.quelle)}</td></tr>`).join('');
  const grundRows = kats.map(k => {
    const vals = jahre.map(j => Object.values(S.baeder).reduce((t, b) => t + ((b.jahre[j] || {}).stunden_verloren || {})[k] || 0, 0));
    if (!vals.some(v => v > 0)) return '';
    return `<tr><td><i class="sw" style="background:${schlColor(k)}"></i>${esc(S.kategorien[k])}</td>${vals.map(v => `<td>${v ? fmt0(v) + ' h' : '–'}</td>`).join('')}</tr>`;
  }).join('');
  const sumRow = `<tr class="sum"><td>Summe ausgefallen</td>${jahre.map(j => `<td><b>${fmt0(sum[j].stunden_plan - sum[j].stunden_ist)} h</b></td>`).join('')}</tr>
    <tr><td>tatsächlich angeboten</td>${jahre.map(j => `<td>${fmt0(sum[j].stunden_ist)} h</td>`).join('')}</tr>
    <tr><td>laut Regelplan</td>${jahre.map(j => `<td>${fmt0(sum[j].stunden_plan)} h</td>`).join('')}</tr>`;
  const ms = state.city === 'muenster';
  const j0 = S.zeitraum.von.slice(0, 4), j1 = S.zeitraum.bis.slice(0, 4);
  const namen = Object.values(S.baeder).map(b => kurzName(b.name)).join(', ');
  const regel = ms
    ? `der reguläre Wochenplan des Bades (Winterplan, Stand ${fmtDate(S.zeitraum.bis)}); für das Südbad bis 10.01.2025 ohne Wochenende, eröffnet am 22.04.2024. Je Wochentag zählen die öffentlichen Stunden laut Plan.`
    : `der reguläre Wochenplan des Bades (Winterplan 2026/27, wie in der Karte), übertragen auf ${j0 === j1 ? j0 : j0 + '–' + j1}. Je Wochentag zählen die öffentlichen Stunden laut Plan. Hatte ein Bad damals einen anderen Plan, ist das – soweit bekannt – berücksichtigt.`;
  el.innerHTML = `<h2>Ausgefallene Schwimmzeiten ${j0 === j1 ? j0 : 'seit ' + j0}</h2>
    <p class="note">Öffentliche Schwimmstunden, die laut Regelplan angeboten worden wären, aber wegen Schließungen entfielen – ${esc(namen)}. Quelle: ${ms ? 'Pressemitteilungen der Stadt Münster' : 'Meldungen von Betreiber und Stadt, Lokalpresse, archivierte Betreiberseiten (je Ereignis unten)'}.</p>
    ${S.qualitaet && !ms ? `<p class="note"><b>Datenlage:</b> ${esc(S.qualitaet)}</p>` : ''}
    <div class="kpis">${tiles}</div>
    <h3>Ausgefallene Stunden nach Grund</h3>
    <table class="data"><thead><tr><th>Grund</th>${jahre.map(j => `<th>${j}</th>`).join('')}</tr></thead><tbody>${grundRows}${sumRow}</tbody></table>
    <h3>Je Bad (Schließtage und ausgefallene Stunden)</h3>
    <table class="data closures"><thead><tr><th>Bad</th>${jahre.map(j => `<th>${j}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
    <div class="week-legend">${leg}</div>
    <h3>Zeitstrahl</h3>${svg}
    <div class="week-legend"><span><i style="background:${css('--grid')}"></i>geöffnet</span>${leg}</div>
    ${ohne ? `<p class="note">Nicht im Regelplan und daher nicht gezählt:</p><ul class="note">${ohne}</ul>` : ''}
    <details open><summary>So wird gerechnet</summary>
      <ul class="note">
        <li><b>Regelplan:</b> ${regel}</li>
        <li><b>Schließtag:</b> ein Tag, an dem das Bad laut Regelplan öffentliches Schwimmen hätte, aber für die Öffentlichkeit ganz geschlossen war. Die ausgefallenen Stunden sind die Plan-Stunden dieses Tages.</li>
        <li><b>Teilschließungen</b> (z. B. früher geschlossen wegen Personalversammlung) zählen nur mit den ausgefallenen Stunden, nicht als Schließtag.</li>
        <li><b>Gründe:</b> Revision/Sanierung = geplante Arbeiten; Defekt/Hygiene = ungeplant (z. B. Legionellen, Lüftung) oder verlängerte Arbeiten; Sommerbetrieb = öffentliches Schwimmen entfällt während der Freibadsaison, weil das Personal in den Freibädern eingesetzt wird; Ferienschließung = Bad in den Schulferien geschlossen; Feiertag = geschlossen an Feiertagen, Heiligabend, Silvester und Rosenmontag. Überschneiden sich Gründe, zählt der Tag einmal (Reihenfolge wie oben).</li>
        <li><b>Nicht gegengerechnet</b> sind zusätzliche Schwimmzeiten in den Ferien oder an Feiertagen außerhalb des Regelplans; in den Ferien bieten einzelne Bäder deutlich mehr Stunden an. Die Werte zeigen also den Ausfall gegenüber dem Regelplan, nicht die Bilanz aller Stunden.</li>
        <li>Feiertage ohne angekündigte Öffnung gelten als geschlossen. Kurzfristige Ausfälle, die nicht öffentlich bekannt gegeben wurden, fehlen; die Zahlen sind eher eine Untergrenze.</li>
        ${ms ? '<li>Roxel und Wolbeck hatten von Juni 2022 bis November 2026 gar keine öffentlichen Zeiten im Regelplan und sind deshalb nicht enthalten.</li>' : ''}
        ${(S.offene_punkte || []).length ? `<li><b>Offene Punkte / Annahmen:</b> ${S.offene_punkte.map(esc).join(' · ')}</li>` : ''}
      </ul>
    </details>
    <details><summary>Alle erfassten Schließungen (${S.ereignisse.length})</summary>
      <table class="data events"><thead><tr><th>Zeitraum</th><th>Bad</th><th>Grund</th><th>Quelle</th></tr></thead><tbody>${ev}</tbody></table>
      <p class="note">${esc(S.methodik)} ${esc(S.feiertage_hinweis)}</p></details>`;
}
const kurzName = n => n.replace(/^(Hallenbad|Stadtbad|Schwimmhalle) /, '');
const quelleHtml = q => {
  const m = String(q || '').match(/https?:\/\/[^\s,;)]+/);
  if (!m) return esc(q);
  const rest = q.replace(m[0], '').replace(/^[\s,;–-]+|[\s,;–-]+$/g, '');
  let host = m[0]; try { host = new URL(m[0]).hostname.replace(/^www\./, ''); } catch (e) { /* bleibt */ }
  return `<a href="${esc(m[0])}" target="_blank" rel="noopener">${esc(host)}</a>${rest ? ' – ' + esc(rest) : ''}`;
};
const fmtDateShort = iso => new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });

function setFocus(id, fly) {
  state.focus = id;
  if (id && fly) {
    const s = ST[id];
    map.flyTo([s.lat, s.lon], Math.max(map.getZoom(), 12), { duration: 0.6 });
    setTimeout(() => markers[id].openPopup(), 650);
  }
  update();
}

/* Ansicht in der URL (#city=koeln&mode=pt&thr=20&layer=hours&cats=hallenbad,freibad&focus=…&tab=nrw) */
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get('city')) state.city = p.get('city');
  if (MODES[p.get('mode')]) state.mode = p.get('mode');
  if (THRS.includes(+p.get('thr'))) state.thr = +p.get('thr');
  if (['tt', 'hours', 'none'].includes(p.get('layer'))) state.layer = p.get('layer');
  if (p.has('cats')) {
    const c = p.get('cats').split(',');
    for (const k of Object.keys(CATS)) state.cats[k] = c.includes(k);
  }
  if (p.get('focus')) state.focus = p.get('focus');
  if (METRICS[p.get('metric')]) state.metric = p.get('metric');
  if (GROUPS[p.get('group')]) state.group = p.get('group');
  return p.get('tab');
}
function writeHash() {
  const p = new URLSearchParams();
  p.set('city', state.city);
  p.set('mode', state.mode); p.set('thr', state.thr); p.set('layer', state.layer);
  p.set('cats', Object.keys(CATS).filter(k => state.cats[k]).join(','));
  if (state.focus) p.set('focus', state.focus);
  if (state.metric !== 'stunden_je_10k_ew') p.set('metric', state.metric);
  if (state.group !== 'alle') p.set('group', state.group);
  const tab = document.querySelector('[role=tab][aria-selected=true]');
  if (tab && tab.id !== 'tab-ms') p.set('tab', tab.id.slice(4));
  history.replaceState(null, '', '#' + p.toString());
}

function update() {
  if (!C) return;
  compute();
  writeHash();
  syncMarkers();
  cellLayer.redraw();
  renderKpis();
  renderLegend();
  renderPools();
  renderWeekGrid();
}

/* ------------------------------------------------------------------ */
/* NRW-Vergleich                                                       */
/* ------------------------------------------------------------------ */
function renderNrw() {
  const m = METRICS[state.metric];
  document.getElementById('metric-note').textContent = m.note;
  const all = INDEX.staedte;
  const done = all.filter(s => s.kennzahlen && s.kennzahlen[state.metric] != null)
    .sort((a, b) => b.kennzahlen[state.metric] - a.kennzahlen[state.metric]);
  const noArea = all.filter(s => s.kennzahlen && s.kennzahlen[state.metric] == null);
  const open = all.filter(s => !s.kennzahlen);
  const max = Math.max(...done.map(s => s.kennzahlen[state.metric]), 1);
  const bars = document.getElementById('bars');
  bars.innerHTML = done.map(s => {
    const v = s.kennzahlen[state.metric];
    const tip = `${s.stadt}: ${fmt1(s.kennzahlen.stunden_woche)} h/Woche in ${s.kennzahlen.anzahl_baeder_oeffentlich} Hallenbädern/-bereichen, ${fmt0(s.einwohner)} EW` +
      (s.karte ? ' – Klick öffnet die Karte' : '');
    const cls = [s.slug === state.city ? 'ms' : '', s.slug === 'muenster' ? 'home' : '', s.karte ? 'link' : ''].join(' ');
    return `<div class="barrow ${cls}" data-slug="${s.slug}" title="${esc(tip)}" ${s.karte ? 'tabindex="0" role="button"' : ''}>
      <span class="city">${esc(s.stadt)}</span>
      <span class="track"><span class="fill" style="display:block;width:${(v / max) * 100}%"></span></span>
      <span class="val">${m.fmt(v)}</span></div>`;
  }).join('');
  bars.querySelectorAll('.barrow.link').forEach(el => {
    const go = () => { selectCity(el.dataset.slug); document.getElementById('tab-ms').click(); };
    el.addEventListener('click', go);
    el.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  });
  document.getElementById('missing').innerHTML = m.ausfall ? ausfallInfo(done, noArea) :
    (noArea.length ? `<p class="missing"><b>Wasserflächen nicht veröffentlicht (${noArea.length}):</b> ${noArea.map(s => esc(s.stadt)).join(', ')} – für diese Kennzahl nicht vergleichbar.</p>` : '') +
    (open.length ? `<p class="missing"><b>Noch nicht erfasst (${open.length} von ${all.length}):</b> ${open.map(s => `<span title="${esc(s.hinweis)}">${esc(s.stadt)}</span>`).join(', ')} – Betreiberseiten automatisiert nicht abrufbar.</p>` : '') +
    '<div class="callout">Vergleichbarkeit: Viele Städte nennen durchgehende Öffnungszeiten, in denen Schul- und Vereinsbetrieb parallel läuft. Münster weist diese Zeiten meist als nicht öffentlich aus. Details im Reiter Methodik und je Stadt in der Tabelle (Hinweis per Maus).</div>';
  const dash = (v, f) => (v == null ? '–' : f(v));
  const rows = all.filter(s => s.kennzahlen).sort((a, b) => b.kennzahlen.stunden_je_10k_ew - a.kennzahlen.stunden_je_10k_ew).map(s => {
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

function ausfallInfo(done, ohne) {
  const rows = done.map(s => {
    const a = s.kennzahlen.ausfall, v = a.stunden_verloren;
    const haupt = Object.entries(v).filter(([, h]) => h > 0).sort((x, y) => y[1] - x[1]).slice(0, 2)
      .map(([k, h]) => `${SCHL_NAMEN[k] || k} ${fmt0(h)} h`).join(', ');
    const tip = `${s.stadt} 2025: ${fmt0(a.stunden_ist)} von ${fmt0(a.stunden_plan)} Regelplan-Stunden in ${a.baeder} Bädern angeboten; größte Gründe: ${haupt}. Quellenlage: ${a.qualitaet || '–'}`;
    return `<tr title="${esc(tip)}"><td>${esc(s.stadt)}</td><td>${fmtPct(s.kennzahlen.ausfall_anteil)}</td>
      <td>${fmt1(a.plan_je_10k_ew)} → <b>${fmt1(s.kennzahlen.ist_je_10k_ew)}</b></td>
      <td class="note">${esc((a.qualitaet || '').split(/\s[–-]\s/)[0])}</td></tr>`;
  }).join('');
  return `<h3>Ausfall 2025 im Detail</h3><table class="data"><thead><tr><th>Stadt</th><th>Ausfall</th><th>h/Woche je 10k EW<br>Plan → tatsächlich</th><th>Quellen</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="note">Stunden und größte Ausfallgründe per Mauszeiger; alle Einzelereignisse mit Quelle in der Kartenansicht der Stadt.</p>
    <p class="missing"><b>Nicht erhoben (${ohne.length}):</b> ${ohne.map(s => esc(s.stadt)).join(', ')} – für diese Städte liegt (noch) keine Schließtage-Chronik vor.</p>
    <div class="callout">Ausgefallene Stunden lassen sich nur aus öffentlich gemeldeten Schließungen rekonstruieren. Je nach Stadt melden Betreiber Revisionen und Defekte unterschiedlich vollständig; kurzfristige Ausfälle fehlen oft. Werte sind daher eher Untergrenzen und zwischen Städten nur grob vergleichbar. Grundlage ist jeweils der heutige Regelplan, ggf. korrigiert um bekannte Planänderungen 2025. Zusätzliche Ferienzeiten werden nicht gegengerechnet. Details je Stadt in der Kartenansicht unter „Ausgefallene Schwimmzeiten“.</div>`;
}
const SCHL_NAMEN = { defekt: 'Defekt', revision: 'Revision', ferien: 'Ferien', sommer: 'Sommer', feiertag: 'Feiertage', personal: 'kurzfristig' };

/* ------------------------------------------------------------------ */
/* Methodik                                                            */
/* ------------------------------------------------------------------ */
function renderMethodik() {
  const ms = INDEX.staedte.find(s => s.slug === 'muenster');
  const k = ms.kennzahlen, oe = INDEX.oepnv;
  document.getElementById('methodik').innerHTML = `
  <h2>Was gezählt wird</h2>
  <p>Erfasst sind die <b>Zeiten für allgemeines öffentliches Schwimmen</b>, also Zeiten, in denen jede Person mit Eintrittskarte schwimmen kann. Schul-, Vereins- und Kurszeiten zählen nicht. Grundlage ist der reguläre Wochenplan im Winterhalbjahr 2026/27, Stand ${fmtDate(ms.stand)}. Ferien- und Feiertagsregelungen sind nicht eingerechnet.</p>
  <ul>
    <li><b>Öffentlich:</b> ganzes Bad für alle.</li>
    <li><b>Öffentlich auf Teilfläche:</b> z. B. 2 Bahnen parallel zum Schulschwimmen. Zählt als Stunde, in der Wasserflächen-Kennzahl nur anteilig.</li>
    <li><b>Zielgruppe:</b> z. B. Frauen-, Senioren- oder TIN*-Schwimmzeit. Wird angezeigt, zählt aber nicht zur Kernkennzahl.</li>
    <li>Slots, die nicht jede Woche stattfinden (z. B. im Wochenendwechsel), werden mit ihrer Häufigkeit gewichtet.</li>
    <li>Parallele Kurse in einzelnen Becken während des öffentlichen Betriebs werden nicht abgezogen, sondern beim Bad als Einschränkung genannt.</li>
  </ul>
  <h2>Kennzahlen</h2>
  <ul>
    <li><b>Stunden je 10.000 Einwohner:</b> Summe der öffentlichen Stunden pro Woche aller kommunalen Hallenbäder ÷ Einwohner × 10.000. Münster: ${fmt1(k.stunden_woche)} h ÷ ${fmt0(k.einwohner)} EW → <b>${fmt1(k.stunden_je_10k_ew)}</b>.</li>
    <li><b>Wasserflächen-Stunden je 1.000 Einwohner:</b> Σ (Stunden × Wasserfläche) ÷ Einwohner × 1.000. Ein großes Bad mit vielen Stunden zählt mehr als ein kleines Lehrschwimmbecken. Münster: <b>${fmt0(k.m2h_je_1000_ew)}</b> m²·h.</li>
    <li><b>Wasserfläche je 1.000 Einwohner:</b> reine Infrastruktur-Kennzahl der Bäder mit öffentlichen Zeiten. Münster: <b>${fmt1(k.wasserflaeche_m2_je_1000_ew)}</b> m².</li>
  </ul>
  <ul>
    <li><b>Abends / Wochenende:</b> öffentliche Stunden werktags (Mo–Fr) ab 17 Uhr bzw. an Samstagen und Sonntagen, je 10.000 Einwohner – die Zeiten, die Berufstätige, Schulkinder und Familien tatsächlich nutzen können.</li>
    <li><b>Erreichbarkeit:</b> Anteil der Einwohner bzw. der Schulkinder (6–15 Jahre), die ein kommunales Hallenbad mit öffentlichen Zeiten in höchstens 15 Minuten mit dem Rad, 15 Minuten zu Fuß oder 20 Minuten mit dem ÖPNV erreichen. Kinderzahlen aus dem Zensus-2022-Raster „Alter in infrastrukturellen Altersgruppen“; geheim gehaltene Einzelwerte in schwach besetzten Zellen wurden anteilig geschätzt (ca. 11 % der Kinder).</li>
    <li><b>Wochenraster:</b> Zahl der gewählten Bäder, die je halbe Stunde öffentliches Schwimmen anbieten (Slots, die nicht jede Woche stattfinden, anteilig). Zielgruppenzeiten und Freibäder sind nicht enthalten.</li>
  </ul>
  <p>Für den NRW-Vergleich zählen nur <b>kommunale Hallenbäder</b> (Stadt oder städtische Bäder-/Stadtwerkegesellschaft). Freibäder und Bäder anderer Träger sind nur für Münster erfasst und dort in der Karte zuschaltbar.</p>
  <h3>Regeln für die Vergleichsstädte</h3>
  <ul>
    <li><b>Freizeitbäder:</b> Reine Freizeitbereiche (Wellenbad, Rutschen, Erlebnisbecken) zählen nicht zur Kernkennzahl, sind in der Karte aber zuschaltbar. Sportbecken in Freizeitbädern zählen, wenn sie eigene Zeiten haben oder der Betreiber keine Trennung ausweist.</li>
    <li><b>Getrennt betriebene Hallen</b> eines Standorts (z. B. zwei Schwimmhallen mit eigenen Zeiten) zählen einzeln, haben aber einen gemeinsamen Marker.</li>
    <li><b>Schließungen:</b> Revisionen und vorübergehende Schließungen ändern nichts, gezählt wird der reguläre Plan. Bäder, die wegen Sanierung oder Neubau langfristig (etwa ein Jahr und mehr) geschlossen sind, zählen mit 0 Stunden und erscheinen grau in der Karte.</li>
    <li><b>Teilbelegung:</b> Nennt ein Betreiber, dass nur ein Teil der Bahnen öffentlich ist, wird das als Teilfläche erfasst. Viele Betreiber nennen dagegen durchgehende Öffnungszeiten mit Schul- und Vereinsbetrieb parallel. Deren Stunden sind eher eine Obergrenze. Münster weist Schul- und Vereinszeiten meist als komplett nicht öffentlich aus. Das verschiebt den Vergleich tendenziell zu Ungunsten Münsters.</li>
    <li><b>Wasserflächen</b> veröffentlichen nur einige Betreiber. Fehlen sie bei einem Bad mit öffentlichen Zeiten, wird die Stadt in den Flächen-Kennzahlen nicht gewertet.</li>
    <li><b>Lage der Bäder:</b> Koordinaten aus OpenStreetMap (Nominatim/Overpass), geprüft auf Lage im Stadtgebiet. Einzelne Bäder wurden manuell über die Betreiberadresse verortet.</li>
    <li><b>Offene Städte:</b> Einige Betreiberseiten waren automatisiert nicht abrufbar (Bot-Schutz, nicht erreichbar, dynamisch nachgeladen). Diese Städte sind als „noch nicht erfasst“ markiert, der Grund steht in den Daten.</li>
  </ul>
  <h2>Ausgefallene Schwimmzeiten</h2>
  <p>Für Münster sind alle per Pressemitteilung bekannt gegebenen Schließungen der Hallenbäder seit Januar 2024 erfasst (Revisionen, Defekte, Sommerschließungen, Ferien, Feiertage, kurzfristige Ausfälle). Daraus wird je Tag berechnet, ob ein Bad laut Regelplan öffentlich geöffnet gewesen wäre und ob es tatsächlich geöffnet war. Ausgefallene Stunden = Plan-Stunden an geschlossenen Tagen plus ausgefallene Stunden bei Teilschließungen. Zusätzliche Ferienzeiten werden nicht gegengerechnet.</p>
  <p>Für den <b>NRW-Vergleich</b> wurde dieselbe Chronik für das Jahr <b>2025</b> in ausgewählten, ähnlich großen Städten recherchiert (${INDEX.staedte.filter(s => s.kennzahlen && s.kennzahlen.ausfall).map(s => esc(s.stadt)).join(', ')}): Pressemitteilungen von Stadt und Betreiber, archivierte Betreiberseiten (Wayback Machine) und – wo erreichbar – Lokalpresse. Regelplan ist der heutige Wochenplan; belegte Abweichungen 2025 (z. B. andere Wochentage, ein 2026 geschlossenes Bad) sind als eigene Plan-Periode berücksichtigt. Feiertage zählen als geschlossen, wenn keine Öffnung belegt ist.</p>
  <ul>
    <li><b>Tatsächlich angeboten 2025:</b> angebotene Jahresstunden ÷ 52,14 Wochen ÷ Einwohner × 10.000 – also im Mittel tatsächlich verfügbare Stunden pro Woche, vergleichbar mit „Stunden je 10.000 EW“.</li>
    <li><b>Ausgefallen 2025:</b> ausgefallene ÷ Regelplan-Stunden.</li>
    <li>Die Quellenlage ist unterschiedlich: Wo Betreiber Schließungen nur tagesaktuell auf der Website melden, fehlen kurzfristige Ausfälle (z. B. Gelsenkirchen). Die Werte sind deshalb Untergrenzen; die Einschätzung je Stadt steht in der Tabelle im NRW-Vergleich und in der Kartenansicht.</li>
  </ul>
  <h2>Einzugsbereiche</h2>
  <p>Für jede bewohnte und unbewohnte 100-m-Zelle des Zensus-2022-Gitters im Stadtgebiet wird die Reisezeit zu jedem Bad-Standort berechnet:</p>
  <ul>
    <li><b>Zu Fuß:</b> 4,5 km/h auf dem Fußwegenetz von OpenStreetMap.</li>
    <li><b>Rad:</b> 15 km/h auf dem Radnetz von OpenStreetMap, Einbahnregeln beachtet. Steigungen sind nicht berücksichtigt; in hügeligen Städten (z. B. Remscheid, Siegen, Hagen, Wuppertal) sind die Radzeiten daher eher zu optimistisch.</li>
    <li><b>ÖPNV:</b> Tür-zu-Tür. Fußweg zur Haltestelle (bis 1 km, Luftlinie × 1,3), Fahrplan ${esc(oe.stichtag)} (Dienstag), Umstiege mit bis zu 500 m Fußweg und 1 min Puffer, Fußweg zum Bad. Ausgewertet für eine Ankunft am Bad zwischen 17 und 19 Uhr im 15-Minuten-Takt; gezeigt wird der Median. Ist man zu Fuß schneller, gilt die Fußzeit. Datengrundlage: ${esc(oe.quelle)}, ${fmt0(oe.verbindungen)} Teilfahrten in NRW.</li>
    <li>Gerechnet wird nur innerhalb der jeweiligen Stadtgrenze; Bäder in Nachbarstädten werden nicht berücksichtigt.</li>
  </ul>
  <p><b>Welche Anfahrt ist zumutbar?</b> Eine verbindliche Norm gibt es nicht. Nach Erfahrungswerten der Deutschen Gesellschaft für das Badewesen (DGfdB) nehmen Badegäste in der Stadt für ein Sporthallenbad etwa <b>10–15 Minuten</b> Anfahrt in Kauf, für ein Freibad etwa 20 Minuten und für ein Freizeitbad 20–30 Minuten (zitiert in <a href="https://e-government.hannover-stadt.de/lhhsimwebre.nsf/DS/2152-2013" target="_blank" rel="noopener">Drucksache 2152/2013 der Stadt Hannover</a>). Die Karte bietet deshalb 10, 15, 20 und 30 Minuten an. Voreingestellt sind 15 Minuten.</p>
  <p><b>Bevölkerungsanteile</b> beruhen auf dem Zensus-2022-Gitter. Die Kennzahlen je Einwohner beruhen auf der amtlichen Fortschreibung von IT.NRW zum 31.12.2025.</p>
  <h2>Grenzen der Auswertung</h2>
  <ul>
    <li>Öffnungszeiten sind keine Kapazität: Wie voll ein Bad ist und wie viele Bahnen durch Kurse belegt sind, ist nicht berücksichtigt.</li>
    <li>Münster: Die Wasserfläche des Südbads ist aus Planunterlagen geschätzt (≈ 444 m²). Die Zeiten des Bürgerbads Handorf stammen aus einer Drittquelle, für das Freibad Sudmühle sind keine Zeiten veröffentlicht.</li>
    <li>Im Sommer entfällt das öffentliche Schwimmen in mehreren Hallenbädern. Dann übernehmen die Freibäder. Der Vergleich bezieht sich auf den Winterbetrieb.</li>
  </ul>
  <h2>Daten &amp; Code</h2>
  <p>Rohdaten mit Quellen: <a href="data/nrw.json">nrw.json</a> sowie je Stadt <code>data/st/&lt;stadt&gt;-baeder.json</code> (z. B. <a href="data/st/muenster-baeder.json">Münster</a>). Die Skripte zur Erhebung und Berechnung liegen im <a href="https://github.com/axbusch/swimmap" target="_blank" rel="noopener">Repository</a> (Ordner <code>scripts/</code>); ausführliche Projektbeschreibung und Anleitung zum Nachrechnen in der <a href="https://github.com/axbusch/swimmap#readme" target="_blank" rel="noopener">README</a>.</p>
  <p class="note">Kartengrundlage: basemap.de / BKG (CC BY 4.0) bzw. © OpenStreetMap-Mitwirkende (ODbL). Wegenetz und Lage der Bäder: OpenStreetMap (ODbL). ÖPNV: gtfs.de, DELFI e.V. (CC BY 4.0). Bevölkerung und Altersgruppen: Zensus 2022, Statistische Ämter des Bundes und der Länder (dl-de/by-2-0). Einwohner: IT.NRW (dl-de/by-2-0).</p>`;
}

function renderInfo() {
  const el = document.getElementById('readme');
  el.innerHTML = window.SWIMMAP_README || '<p class="note">README nicht gefunden.</p>';
  el.querySelector('h1')?.remove();  // Titel steht schon in der Kopfzeile
  const toImp = e => {
    e.preventDefault();
    document.getElementById('tab-info').click();
    document.getElementById('impressum').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  document.getElementById('impressum-link').addEventListener('click', toImp);
  document.getElementById('to-impressum').addEventListener('click', toImp);
}

init().catch(err => {
  console.error(err);
  document.getElementById('kpis').innerHTML = `<div class="callout">Daten konnten nicht geladen werden: ${esc(err.message)}</div>`;
});
