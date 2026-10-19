import {
  MODELS,
  gridSpec,
  specCovers,
  fetchGrid,
  fetchAloft,
  sampleFrom,
  windAtAltitude,
  searchPlace,
  loadStaticMeta,
  staticContains,
  staticGrid,
  ensureStaticHour,
} from './api.js';
import { derive } from './physics.js';
import { GROUPS, PARAMS, SCALES, WIND_MODES, BASEMAPS, LABELS_URL, DEFAULT_VIEW } from './config.js';
import { renderField, legendHTML, barbSVG, fmt } from './render.js';
import { loadPoint, dayChart, skewT, compareTable } from './point.js';

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* armazenamento indisponível */
    }
  },
};

// ---------- Estado (espelhado na URL: #zoom/lat/lon/modelo/camada/vento/hora) ----------
const state = {
  model: 'gfs',
  param: 'toplift',
  wind: 'sfc',
  t: null,
  base: store.get('xcbr.base', 'topo'),
  opacity: store.get('xcbr.opacity', 0.75),
  grid: null,
  derivedCache: new Map(),
  point: null,
  ppTab: 'day',
};

function readHash() {
  const p = location.hash.replace(/^#/, '').split('/');
  if (p.length < 3) return null;
  const [z, lat, lon, model, param, wind, t] = p;
  return {
    zoom: +z,
    lat: +lat,
    lon: +lon,
    model: MODELS[model] ? model : null,
    param: PARAMS[param] ? param : null,
    wind: WIND_MODES.some((w) => w[0] === wind) ? wind : null,
    t: t ?? null,
  };
}

function writeHash() {
  if (!map) return;
  const c = map.getCenter();
  const time = state.grid && state.t != null ? state.grid.times[state.t] : '';
  const h = `#${map.getZoom()}/${c.lat.toFixed(3)}/${c.lng.toFixed(3)}/${state.model}/${state.param}/${state.wind}/${time}`;
  history.replaceState(null, '', h);
}

// ---------- Mapa ----------
const initial = readHash();
if (initial?.model) state.model = initial.model;
if (initial?.param) state.param = initial.param;
if (initial?.wind) state.wind = initial.wind;
let wantedTime = initial?.t || null;

const map = L.map('map', { zoomControl: false, attributionControl: true }).setView(
  initial && Number.isFinite(initial.lat) ? [initial.lat, initial.lon] : [DEFAULT_VIEW.lat, DEFAULT_VIEW.lon],
  initial && Number.isFinite(initial.zoom) ? initial.zoom : DEFAULT_VIEW.zoom,
);
L.control.zoom({ position: 'bottomright' }).addTo(map);
map.attributionControl.addAttribution('Dados: NOAA GFS · <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>');
map.createPane('data').style.zIndex = 350;
map.createPane('labels').style.zIndex = 420;
map.getPane('labels').style.pointerEvents = 'none';
map.createPane('barbs').style.zIndex = 430;

let baseLayer = null;
function setBase(id) {
  state.base = BASEMAPS[id] ? id : 'topo';
  store.set('xcbr.base', state.base);
  if (baseLayer) map.removeLayer(baseLayer);
  const b = BASEMAPS[state.base];
  baseLayer = L.tileLayer(b.url, b.opts).addTo(map);
  if (b.labels) labelsLayer.addTo(map);
  else labelsLayer.remove();
  document.querySelectorAll('.basemaps button').forEach((el) => el.classList.toggle('active', el.dataset.id === state.base));
}
const labelsLayer = L.tileLayer(LABELS_URL, { pane: 'labels', maxZoom: 18 });

let overlay = null;
const barbLayer = L.layerGroup([], { pane: 'barbs' }).addTo(map);
let clickMarker = null;

// ---------- Status ----------
let statusTimer;
function status(msg, kind = 'info', ms = 0) {
  const el = $('#status');
  clearTimeout(statusTimer);
  if (!msg) {
    el.className = 'status';
    el.textContent = '';
    return;
  }
  el.className = `status show ${kind}`;
  el.textContent = msg;
  if (ms) statusTimer = setTimeout(() => status(''), ms);
}

// ---------- Grade ----------
// Economia de cota: uma busca por vez, só quando a área sai da grade carregada
// ou quando aproximar o mapa permite uma grade mais fina.
let loadSeq = 0;
let inflight = false;
let pending = false;
let retryTimer = null;
async function ensureGrid(force = false) {
  // GFS dentro da região do robô: arquivos estáticos, resolução nativa, sem cota
  const meta = state.model === 'gfs' ? await loadStaticMeta('gfs') : null;
  const c = map.getCenter();
  if (meta && staticContains(meta, c.lat, c.lng)) {
    if (state.grid?.static !== meta) {
      loadSeq++;
      clearTimeout(retryTimer);
      state.grid = staticGrid(meta);
      state.derivedCache.clear();
      pickTime();
      buildTimeGrid();
      status('');
      redraw();
    }
    return;
  }
  if (inflight) {
    pending = true;
    return;
  }
  const b = map.getBounds().pad(0.15);
  const bounds = { south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast() };
  const spec = gridSpec(state.model, bounds);
  const same = state.grid && state.grid.spec.model === state.model;
  if (!force && same && !state.grid.static && specCovers(state.grid.spec, bounds) && spec.step >= state.grid.spec.step - 1e-9) return;
  if (same && state.grid.spec.key === spec.key) return;
  clearTimeout(retryTimer);
  const seq = ++loadSeq;
  inflight = true;
  status(`Carregando ${MODELS[state.model].label}…`, 'info');
  try {
    const grid = await fetchGrid(spec);
    if (seq === loadSeq) {
      state.grid = grid;
      state.derivedCache.clear();
      pickTime();
      buildTimeGrid();
      status('');
      redraw();
    }
  } catch (e) {
    if (seq === loadSeq) {
      if (e.minutely) retryCountdown(60);
      else status(e.message || 'Falha ao carregar dados.', 'error');
    }
  } finally {
    inflight = false;
    if (pending) {
      pending = false;
      ensureGrid();
    }
  }
}

// Limite por minuto: espera e tenta de novo sozinho
function retryCountdown(sec) {
  clearTimeout(retryTimer);
  if (sec <= 0) {
    ensureGrid(true);
    return;
  }
  status(`Muitas requisições em pouco tempo. Tentando de novo em ${sec} s…`, 'error');
  retryTimer = setTimeout(() => retryCountdown(sec - 1), 1000);
}

function pickTime() {
  const times = state.grid.times;
  const cur = state.t != null && state.prevTimes ? state.prevTimes[state.t] : wantedTime;
  let idx = cur ? times.indexOf(cur) : -1;
  if (idx < 0) {
    const now = new Date();
    const local = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let h = local.getHours();
    if (h > 17) {
      local.setDate(local.getDate() + 1);
      h = 13;
    } else if (h < 9) h = 13;
    idx = times.indexOf(`${day(local)}T${String(h).padStart(2, '0')}:00`);
    if (idx < 0) idx = Math.min(13, times.length - 1);
  }
  state.t = idx;
  state.prevTimes = times;
  wantedTime = null;
}

function derivedAt(t) {
  if (state.derivedCache.has(t)) return state.derivedCache.get(t);
  const g = state.grid;
  if (g.static && !g.ready.has(t)) return g.pts.map(() => null); // horário ainda carregando
  const arr = g.pts.map((p) => derive(sampleFrom(p.h, p.elev, t, state.model, g.levels)));
  state.derivedCache.set(t, arr);
  return arr;
}

// ---------- Desenho ----------
async function redraw() {
  writeHash();
  renderLegend();
  const g = state.grid;
  const t = state.t;
  if (!g || t == null) return;
  if (g.static) {
    if (!g.loaded.has(t)) status('Carregando horário…', 'info');
    try {
      await ensureStaticHour(g, t);
    } catch (e) {
      status(e.message, 'error', 6000);
      return;
    }
    if (g !== state.grid || t !== state.t) return;
    status('');
    // Adianta os próximos horários (animação e navegação rápidas)
    for (const k of [t + 1, t + 2]) if (k < g.times.length) ensureStaticHour(g, k).catch(() => {});
  }
  const d = derivedAt(state.t);
  const param = PARAMS[state.param];
  const scale = SCALES[param.scale];
  const values = d.map((x) => (x ? x[state.param] : null));
  const img = renderField(state.grid.spec, values, scale);
  if (overlay) map.removeLayer(overlay);
  overlay = L.imageOverlay(img.url, img.bounds, { pane: 'data', opacity: state.opacity, interactive: false }).addTo(map);
  drawBarbs(d);
  highlightTime();
  if (state.point) renderPointPanel();
}

let barbSeq = 0;
async function drawBarbs(d) {
  const seq = ++barbSeq;
  barbLayer.clearLayers();
  if (state.wind === 'none' || !state.grid) return;
  const g = state.grid;
  const { spec } = g;
  const alt = Number(state.wind);
  if (alt) {
    try {
      await fetchAloft(g);
    } catch (e) {
      status(e.message, 'error', 6000);
    }
    if (g !== state.grid || seq !== barbSeq) return;
  }
  const p0 = map.latLngToContainerPoint([spec.lat0, spec.lon0]);
  const p1 = map.latLngToContainerPoint([spec.lat0 + spec.step, spec.lon0 + spec.step]);
  const px = Math.max(1, Math.min(Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y)));
  const stride = Math.max(1, Math.ceil(46 / px));
  const view = map.getBounds().pad(0.05);
  for (let i = 0; i < spec.ny; i += stride)
    for (let j = 0; j < spec.nx; j += stride) {
      const k = i * spec.nx + j;
      const lat = spec.lat0 + i * spec.step;
      const lon = spec.lon0 + j * spec.step;
      if (!view.contains([lat, lon])) continue;
      let w = null;
      const pt = g.pts[k];
      if (state.wind === 'sfc') {
        const ws = pt.h.wind_speed_10m?.[state.t];
        const wd = pt.h.wind_direction_10m?.[state.t];
        if (ws != null && wd != null) w = { ws, wd };
      } else if (state.wind === 'top') {
        const x = d[k];
        if (x && x.windtop != null) w = { ws: x.windtop, wd: x.windtopdir };
      } else if (alt) {
        if (alt < pt.elev) continue;
        w = windAtAltitude(pt.h, g.aloft?.[k], state.t, alt);
      }
      if (!w) continue;
      const icon = L.divIcon({ className: 'barb', html: barbSVG(w.ws, w.wd), iconSize: [44, 44], iconAnchor: [22, 22] });
      L.marker([lat, lon], { icon, pane: 'barbs', interactive: false, keyboard: false }).addTo(barbLayer);
    }
}

// "2026-10-19T12:00Z" → "19/10 09h" (horário de Brasília)
function runLabel(iso) {
  const d = new Date(new Date(iso).getTime() - 3 * 3600e3);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}h`;
}

function renderLegend() {
  const p = PARAMS[state.param];
  const windLabel = WIND_MODES.find((w) => w[0] === state.wind)?.[1];
  $('#legend').innerHTML =
    legendHTML(p, SCALES[p.scale]) +
    `<div class="legend-foot">${MODELS[state.model].label} ${MODELS[state.model].res}${state.grid?.static ? ` · rodada ${runLabel(state.grid.static.run)}` : state.grid && state.grid.spec.step > MODELS[state.model].step * 1.01 ? ' · grade reduzida (aproxime o mapa)' : ''}${state.wind !== 'none' ? `<br>Vento: ${windLabel} (km/h)` : ''}</div>`;
}

// ---------- Grade de horários ----------
const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTH = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function buildTimeGrid() {
  const times = state.grid.times;
  const days = new Map();
  times.forEach((t, i) => {
    const d = t.slice(0, 10);
    if (!days.has(d)) days.set(d, Array(24).fill(null));
    days.get(d)[+t.slice(11, 13)] = i;
  });
  let html = '';
  for (const [d, hrs] of days) {
    const dt = new Date(`${d}T12:00:00`);
    html += `<tr><th>${WEEK[dt.getDay()]}, ${dt.getDate()} ${MONTH[dt.getMonth()]}</th>${hrs
      .map((i, h) => (i == null ? `<td class="off">${String(h).padStart(2, '0')}</td>` : `<td data-t="${i}" class="${h >= 9 && h <= 17 ? 'day' : ''}">${String(h).padStart(2, '0')}</td>`))
      .join('')}</tr>`;
  }
  $('#timegrid').innerHTML = html;
  highlightTime();
}

function highlightTime() {
  document.querySelectorAll('#timegrid td.sel').forEach((el) => el.classList.remove('sel'));
  const el = document.querySelector(`#timegrid td[data-t="${state.t}"]`);
  if (!el) return;
  el.classList.add('sel');
  // Mantém a hora escolhida visível quando a grade não cabe na tela (celular)
  const wrap = el.closest('.timegrid-wrap');
  const left = el.offsetLeft - wrap.clientWidth / 2;
  if (el.offsetLeft < wrap.scrollLeft + 90 || el.offsetLeft > wrap.scrollLeft + wrap.clientWidth - 30) wrap.scrollLeft = Math.max(0, left);
}

$('#timegrid').addEventListener('click', (e) => {
  const td = e.target.closest('td[data-t]');
  if (!td) return;
  state.t = +td.dataset.t;
  redraw();
});

$('#timeToggle').addEventListener('click', () => {
  const box = $('#timebox');
  box.classList.toggle('collapsed');
  $('#timeToggle').textContent = box.classList.contains('collapsed') ? '▾' : '▴';
});

// ---------- Modelos ----------
function buildModels() {
  $('#models').innerHTML = Object.entries(MODELS)
    .map(([id, m]) => `<button data-m="${id}" class="${id === state.model ? 'active' : ''}">${m.label}<small>${m.res}</small></button>`)
    .join('');
}
$('#models').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-m]');
  if (!b || b.dataset.m === state.model) return;
  state.model = b.dataset.m;
  buildModels();
  ensureGrid(true);
});

// ---------- Barra lateral ----------
function buildSidebar() {
  $('#basemaps').innerHTML = Object.entries(BASEMAPS)
    .map(([id, b]) => `<button data-id="${id}" class="${id === state.base ? 'active' : ''}">${b.label}</button>`)
    .join('');
  $('#paramList').innerHTML = GROUPS.map(
    (g) =>
      `<h3>${g.title}</h3><ul>${g.items
        .map((i) => `<li><button data-p="${i.id}" class="${i.id === state.param ? 'active' : ''}">${i.label}</button></li>`)
        .join('')}</ul>`,
  ).join('');
}

$('#basemaps').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-id]');
  if (b) setBase(b.dataset.id);
});

$('#paramList').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-p]');
  if (!b) return;
  state.param = b.dataset.p;
  document.querySelectorAll('#paramList button').forEach((el) => el.classList.toggle('active', el === b));
  redraw();
  if (window.innerWidth < 700) toggleSidebar(false);
});

$('#layerInfoBtn').addEventListener('click', () => {
  const p = PARAMS[state.param];
  $('#infoTitle').textContent = p.label;
  $('#infoText').textContent = p.desc;
  $('#infoDlg').showModal();
});

function toggleSidebar(open) {
  const sb = $('#sidebar');
  const want = open ?? !sb.classList.contains('open');
  sb.classList.toggle('open', want);
  document.body.classList.toggle('sb-closed', !want);
  setTimeout(() => map.invalidateSize(), 250);
}
$('#sbToggle').addEventListener('click', () => toggleSidebar());
$('#mobileMenu').addEventListener('click', () => toggleSidebar(true));

document.querySelectorAll('.sb-tabs .tab').forEach((t) =>
  t.addEventListener('click', () => {
    document.querySelectorAll('.sb-tabs .tab').forEach((x) => x.classList.toggle('active', x === t));
    document.querySelectorAll('.tabpane').forEach((x) => x.classList.toggle('active', x.id === `tab-${t.dataset.tab}`));
    if (t.dataset.tab === 'favs') renderFavs();
  }),
);

// ---------- Busca ----------
let searchTimer;
$('#searchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 3) {
    $('#searchResults').innerHTML = '';
    return;
  }
  searchTimer = setTimeout(async () => {
    try {
      const res = await searchPlace(q);
      $('#searchResults').innerHTML = res
        .map(
          (r) =>
            `<li><button type="button" data-lat="${r.latitude}" data-lon="${r.longitude}">${escapeHTML(r.name)}<small>${escapeHTML([r.admin1, r.country].filter(Boolean).join(', '))}</small></button></li>`,
        )
        .join('');
    } catch {
      $('#searchResults').innerHTML = '';
    }
  }, 350);
});
$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  $('#searchResults button')?.click();
});
$('#searchResults').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-lat]');
  if (!b) return;
  map.setView([+b.dataset.lat, +b.dataset.lon], 10);
  $('#searchResults').innerHTML = '';
  $('#searchInput').value = '';
  if (window.innerWidth < 700) toggleSidebar(false);
});

function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// ---------- Vento, animação, opacidade ----------
$('#windSel').innerHTML = WIND_MODES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
$('#windSel').value = state.wind;
$('#windSel').addEventListener('change', (e) => {
  state.wind = e.target.value;
  writeHash();
  renderLegend();
  if (state.grid) drawBarbs(derivedAt(state.t));
});

$('#opacity').value = state.opacity;
$('#opacity').addEventListener('input', (e) => {
  state.opacity = +e.target.value;
  store.set('xcbr.opacity', state.opacity);
  if (overlay) overlay.setOpacity(state.opacity);
});

let playTimer = null;
$('#playBtn').addEventListener('click', () => {
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
    $('#playBtn').textContent = '▶';
    return;
  }
  $('#playBtn').textContent = '❚❚';
  playTimer = setInterval(() => {
    if (!state.grid) return;
    const times = state.grid.times;
    const day = times[state.t].slice(0, 10);
    let next = state.t + 1;
    // Anima o período diurno (8h–18h) do dia selecionado
    if (next >= times.length || times[next].slice(0, 10) !== day || +times[next].slice(11, 13) > 18) next = times.findIndex((t) => t.startsWith(day) && +t.slice(11, 13) >= 8);
    state.t = next;
    redraw();
  }, 900);
});

// ---------- Favoritos ----------
function renderFavs() {
  const favs = store.get('xcbr.favs', []);
  $('#favList').innerHTML = favs.length
    ? favs
        .map((f, i) => `<li><button class="fav-go" data-i="${i}">${escapeHTML(f.name)}<small>${escapeHTML(PARAMS[f.param]?.label ?? '')} · ${escapeHTML(MODELS[f.model]?.label ?? '')}</small></button><button class="fav-del" data-i="${i}" aria-label="Remover">✕</button></li>`)
        .join('')
    : '<li class="muted small">Nenhum favorito ainda.</li>';
}
$('#favList').addEventListener('click', (e) => {
  const favs = store.get('xcbr.favs', []);
  const go = e.target.closest('.fav-go');
  const del = e.target.closest('.fav-del');
  if (del) {
    favs.splice(+del.dataset.i, 1);
    store.set('xcbr.favs', favs);
    renderFavs();
  } else if (go) {
    const f = favs[+go.dataset.i];
    state.param = f.param;
    state.wind = f.wind;
    $('#windSel').value = f.wind;
    buildSidebar();
    if (f.model !== state.model) {
      state.model = f.model;
      buildModels();
    }
    map.setView([f.lat, f.lon], f.zoom);
    ensureGrid(true);
  }
});
$('#saveBtn').addEventListener('click', () => {
  const name = prompt('Nome para este favorito (ex.: Rampa de Castelo):');
  if (!name) return;
  const c = map.getCenter();
  const favs = store.get('xcbr.favs', []);
  favs.push({ name: name.slice(0, 60), lat: c.lat, lon: c.lng, zoom: map.getZoom(), model: state.model, param: state.param, wind: state.wind });
  store.set('xcbr.favs', favs);
  status('Favorito salvo.', 'ok', 2500);
});

// ---------- Painel do ponto ----------
map.on('click', async (e) => {
  const { lat, lng } = e.latlng;
  if (clickMarker) map.removeLayer(clickMarker);
  clickMarker = L.circleMarker([lat, lng], { radius: 7, color: '#111', weight: 2, fillColor: '#fff', fillOpacity: 0.9 }).addTo(map);
  state.point = { lat, lon: lng, data: null, loading: true };
  showPointPanel();
  renderPointPanel();
  try {
    const data = await loadPoint(lat, lng);
    if (state.point?.lat !== lat) return;
    state.point.data = data;
  } catch (err) {
    if (state.point) state.point.error = err.message;
  }
  if (state.point?.lat === lat) {
    state.point.loading = false;
    renderPointPanel();
  }
});

function showPointPanel() {
  $('#pointPanel').hidden = false;
  document.body.classList.add('pp-open');
}
$('#ppClose').addEventListener('click', () => {
  $('#pointPanel').hidden = true;
  document.body.classList.remove('pp-open');
  state.point = null;
  if (clickMarker) map.removeLayer(clickMarker);
});
document.querySelectorAll('.pptab').forEach((b) =>
  b.addEventListener('click', () => {
    state.ppTab = b.dataset.pp;
    document.querySelectorAll('.pptab').forEach((x) => x.classList.toggle('active', x === b));
    renderPointPanel();
  }),
);

function renderPointPanel() {
  const pt = state.point;
  if (!pt) return;
  $('#ppTitle').textContent = `${pt.lat.toFixed(3)}, ${pt.lon.toFixed(3)}`;
  const body = $('#ppBody');
  if (pt.loading) {
    $('#ppSub').textContent = '';
    body.innerHTML = '<p class="muted">Carregando previsão do ponto…</p>';
    return;
  }
  if (pt.error || !pt.data) {
    body.innerHTML = `<p class="error">${escapeHTML(pt.error || 'Falha ao carregar.')}</p>`;
    return;
  }
  let model = state.model;
  let note = '';
  if (!pt.data[model] || pt.data[model].error) {
    const other = Object.keys(MODELS).find((m) => pt.data[m] && !pt.data[m].error);
    if (!other) {
      body.innerHTML = `<p class="error">${escapeHTML(pt.data[model]?.error || 'Sem dados para este ponto.')}</p>`;
      return;
    }
    note = `<p class="error small">${MODELS[model].label} indisponível agora (${escapeHTML(pt.data[model]?.error || 'falha')}). Mostrando ${MODELS[other].label}.</p>`;
    model = other;
  }
  const p = pt.data[model];
  const time = state.grid?.times[state.t] ?? p.times[0];
  let t = p.times.indexOf(time);
  if (t < 0) t = 0;
  const dayKey = p.times[t].slice(0, 10);
  const dayIdx = p.times.map((x, i) => (x.startsWith(dayKey) ? i : -1)).filter((i) => i >= 0);
  const dt = new Date(`${dayKey}T12:00:00`);
  const dLabel = `${WEEK[dt.getDay()]}, ${dt.getDate()} ${MONTH[dt.getMonth()]}`;
  $('#ppSub').textContent = `Altitude do terreno (modelo de relevo): ${Math.round(p.elev)} m · ${MODELS[model].label} · ${dLabel}`;
  const d = p.derived[t];
  const summary = d
    ? `<div class="kpis">
        <div><b>${fmt(d.toplift)} m</b><span>Teto útil às ${p.times[t].slice(11, 16)}</span></div>
        <div><b>${fmt(d.climb, { digits: 1 })} m/s</b><span>Subida estimada</span></div>
        <div><b>${d.windtop != null ? Math.round(d.windtop) : '—'} km/h</b><span>Vento no teto</span></div>
        <div><b>${d.cubase ? `${fmt(d.cubase)} m` : 'sem cúmulos'}</b><span>Base das nuvens</span></div>
      </div>`
    : '';
  if (state.ppTab === 'day') body.innerHTML = note + summary + dayChart(p, dayIdx);
  else if (state.ppTab === 'skewt') body.innerHTML = `${note}<p class="muted small">${MODELS[model].label}, ${dLabel} às ${p.times[t].slice(11, 16)}. Troque a hora na grade de horários.</p>${skewT(p, t)}`;
  else body.innerHTML = `<p class="muted small">${dLabel} às ${p.times[t].slice(11, 16)}</p>${compareTable(pt.data, t)}`;
}

// ---------- Inicialização ----------
buildSidebar();
buildModels();
setBase(state.base);
renderLegend();
if (window.innerWidth < 700) toggleSidebar(false);

let moveTimer;
map.on('moveend', () => {
  writeHash();
  clearTimeout(moveTimer);
  moveTimer = setTimeout(() => {
    ensureGrid();
    if (state.grid) drawBarbs(derivedAt(state.t));
  }, 500);
});
ensureGrid(true);
