// Acesso aos dados da Open-Meteo (https://open-meteo.com, CC BY 4.0).
// O plano gratuito é para uso não comercial e tem limite diário por IP;
// por isso a grade é enxuta e tudo fica em cache na memória.

const BASE = 'https://api.open-meteo.com/v1/forecast';
const TZ = 'America/Sao_Paulo';
// A Open-Meteo conta 1 "chamada" a cada 10 variáveis por ponto. Com 33 variáveis
// e até 90 pontos, uma carga de área custa ~300 chamadas, metade do limite
// gratuito por minuto (600) e folgada para o limite por hora (5.000).
const MAX_POINTS = 90;

export const MODELS = {
  gfs: { api: 'gfs_seamless', label: 'GFS', res: '25 km', step: 0.25, shfSign: 1 },
  icon: { api: 'icon_global', label: 'ICON', res: '13 km', step: 0.125, shfSign: -1 },
};

const LEVELS = [1000, 950, 900, 850, 800, 700, 600, 500];
const WIND_LEVELS = [950, 850, 700];
const ALOFT_LEVELS = [800, 600, 500, 400, 300];
const POINT_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500, 400, 300, 250];

const SURFACE = [
  'temperature_2m',
  'dew_point_2m',
  'sensible_heat_flux',
  'cape',
  'cloud_cover',
  'cloud_cover_low',
  'cloud_cover_mid',
  'precipitation',
  'pressure_msl',
  'wind_speed_10m',
  'wind_direction_10m',
];

const GRID_VARS = [
  ...SURFACE,
  ...LEVELS.flatMap((p) => [`temperature_${p}hPa`, `geopotential_height_${p}hPa`]),
  ...WIND_LEVELS.flatMap((p) => [`wind_speed_${p}hPa`, `wind_direction_${p}hPa`]),
];

const ALOFT_VARS = [
  ...ALOFT_LEVELS.flatMap((p) => [`wind_speed_${p}hPa`, `wind_direction_${p}hPa`]),
  'geopotential_height_400hPa',
  'geopotential_height_300hPa',
];

const POINT_VARS = [
  ...SURFACE,
  'cloud_cover_high',
  'total_column_integrated_water_vapour',
  ...POINT_LEVELS.flatMap((p) => [
    `temperature_${p}hPa`,
    `geopotential_height_${p}hPa`,
    `wind_speed_${p}hPa`,
    `wind_direction_${p}hPa`,
    `relative_humidity_${p}hPa`,
  ]),
];

const cache = new Map();

async function getJSON(url) {
  const key = url;
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    let lastErr;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(url);
        if (r.status === 429) {
          const body = await r.json().catch(() => ({}));
          const daily = /daily|hourly/i.test(body.reason || '');
          const e = new Error(
            daily
              ? /hourly/i.test(body.reason || '')
                ? 'Limite por hora da Open-Meteo atingido nesta conexão. Tente de novo mais tarde.'
                : 'Limite diário gratuito da Open-Meteo atingido nesta conexão. Volta a funcionar amanhã.'
              : 'Muitas requisições em pouco tempo.',
          );
          e.rateLimit = true;
          e.minutely = !daily;
          throw e;
        }
        if (!r.ok) throw new Error(`Erro ${r.status} ao buscar dados.`);
        return await r.json();
      } catch (e) {
        lastErr = e;
        if (e.rateLimit) break;
        await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
      }
    }
    cache.delete(key);
    throw lastErr;
  })();
  cache.set(key, p);
  return p;
}

function url(model, lats, lons, vars) {
  const q = new URLSearchParams({
    latitude: lats.map((x) => x.toFixed(3)).join(','),
    longitude: lons.map((x) => x.toFixed(3)).join(','),
    hourly: vars.join(','),
    models: MODELS[model].api,
    forecast_days: '7',
    timezone: TZ,
  });
  return `${BASE}?${q}`;
}

// Define a grade para uma área: passo nativo do modelo, engrossado
// se necessário para caber no limite de pontos.
export function gridSpec(model, bounds) {
  let step = MODELS[model].step;
  let s;
  for (;;) {
    const lat0 = Math.floor(bounds.south / step) * step;
    const lon0 = Math.floor(bounds.west / step) * step;
    const ny = Math.floor((bounds.north - lat0) / step) + 2;
    const nx = Math.floor((bounds.east - lon0) / step) + 2;
    s = { model, step, lat0, lon0, nx, ny };
    if (nx * ny <= MAX_POINTS) break;
    step *= 1.5;
  }
  s.key = `${model}|${s.step.toFixed(4)}|${s.lat0.toFixed(3)}|${s.lon0.toFixed(3)}|${s.nx}|${s.ny}`;
  return s;
}

export function specCovers(spec, bounds) {
  if (!spec) return false;
  const north = spec.lat0 + (spec.ny - 1) * spec.step;
  const east = spec.lon0 + (spec.nx - 1) * spec.step;
  return bounds.south >= spec.lat0 && bounds.west >= spec.lon0 && bounds.north <= north && bounds.east <= east;
}

function coords(spec) {
  const lats = [];
  const lons = [];
  for (let i = 0; i < spec.ny; i++)
    for (let j = 0; j < spec.nx; j++) {
      lats.push(spec.lat0 + i * spec.step);
      lons.push(spec.lon0 + j * spec.step);
    }
  return { lats, lons };
}

export async function fetchGrid(spec) {
  const { lats, lons } = coords(spec);
  const data = await getJSON(url(spec.model, lats, lons, GRID_VARS));
  const list = Array.isArray(data) ? data : [data];
  return {
    spec,
    times: list[0].hourly.time,
    pts: list.map((d) => ({ elev: d.elevation, h: d.hourly })),
    aloft: null,
  };
}

export async function fetchAloft(grid) {
  if (grid.aloft) return grid.aloft;
  const { lats, lons } = coords(grid.spec);
  const data = await getJSON(url(grid.spec.model, lats, lons, ALOFT_VARS));
  const list = Array.isArray(data) ? data : [data];
  grid.aloft = list.map((d) => d.hourly);
  return grid.aloft;
}

export async function fetchPoint(model, lat, lon) {
  const data = await getJSON(url(model, [lat], [lon], POINT_VARS));
  return { model, lat, lon, elev: data.elevation, times: data.hourly.time, h: data.hourly };
}

export async function searchPlace(name) {
  const q = new URLSearchParams({ name, count: '6', language: 'pt', format: 'json' });
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${q}`);
  if (!r.ok) throw new Error('Falha na busca.');
  const d = await r.json();
  return d.results || [];
}

// Converte a série horária (h) do índice t numa amostra para physics.derive()
export function sampleFrom(h, elev, t, model, levels = LEVELS) {
  const g = (k) => {
    const a = h[k];
    return a ? a[t] : null;
  };
  const sign = MODELS[model].shfSign;
  const shf = g('sensible_heat_flux');
  const lv = levels.map((p) => ({
    p,
    T: g(`temperature_${p}hPa`),
    z: g(`geopotential_height_${p}hPa`),
    ws: g(`wind_speed_${p}hPa`),
    wd: g(`wind_direction_${p}hPa`),
    rh: g(`relative_humidity_${p}hPa`),
  }));
  return {
    elev,
    T2: g('temperature_2m'),
    Td2: g('dew_point_2m'),
    shf: shf == null ? null : shf * sign,
    cape: g('cape'),
    cc: g('cloud_cover'),
    ccl: g('cloud_cover_low'),
    ccm: g('cloud_cover_mid'),
    cch: g('cloud_cover_high'),
    precip: g('precipitation'),
    msl: g('pressure_msl'),
    pw: g('total_column_integrated_water_vapour'),
    ws10: g('wind_speed_10m'),
    wd10: g('wind_direction_10m'),
    levels: lv,
  };
}

export const POINT_LEVEL_SET = POINT_LEVELS;

// Vento (km/h, direção) numa altitude fixa (m, nível do mar), usando os níveis
// da grade e, se carregados, os níveis altos.
export function windAtAltitude(h, aloft, t, z) {
  const pts = [];
  const add = (src, p) => {
    const zz = src[`geopotential_height_${p}hPa`]?.[t] ?? h[`geopotential_height_${p}hPa`]?.[t];
    const ws = src[`wind_speed_${p}hPa`]?.[t];
    const wd = src[`wind_direction_${p}hPa`]?.[t];
    if (zz != null && ws != null && wd != null) pts.push({ z: zz, ws, wd });
  };
  WIND_LEVELS.forEach((p) => add(h, p));
  if (aloft) ALOFT_LEVELS.forEach((p) => add(aloft, p));
  pts.sort((a, b) => a.z - b.z);
  if (!pts.length || z < pts[0].z - 300 || z > pts[pts.length - 1].z + 300) return null;
  const toUV = (q) => {
    const r = (q.wd * Math.PI) / 180;
    return [-q.ws * Math.sin(r), -q.ws * Math.cos(r)];
  };
  let a = pts[0];
  let b = pts[pts.length - 1];
  for (let i = 1; i < pts.length; i++)
    if (z <= pts[i].z) {
      a = pts[i - 1];
      b = pts[i];
      break;
    }
  const f = b.z === a.z ? 0 : Math.min(1, Math.max(0, (z - a.z) / (b.z - a.z)));
  const [ua, va] = toUV(a);
  const [ub, vb] = toUV(b);
  const u = ua + f * (ub - ua);
  const v = va + f * (vb - va);
  return { ws: Math.hypot(u, v), wd: ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360 };
}

// ---------- Dados pré-processados pelo robô (GitHub Actions, GFS da NOAA) ----------
// Resolução nativa e sem cota: o site lê arquivos estáticos, um por hora.
let staticMeta;
export async function loadStaticMeta(model) {
  if (model !== 'gfs') return null;
  if (staticMeta !== undefined) return staticMeta;
  try {
    const r = await fetch('data/gfs/meta.json', { cache: 'no-cache' });
    staticMeta = r.ok ? await r.json() : null;
  } catch {
    staticMeta = null;
  }
  return staticMeta;
}

export function staticContains(meta, lat, lon) {
  const g = meta.grid;
  return lat >= g.lat0 && lat <= g.lat0 + (g.ny - 1) * g.step && lon >= g.lon0 && lon <= g.lon0 + (g.nx - 1) * g.step;
}

export function staticGrid(meta) {
  const g = meta.grid;
  const pts = meta.elev.map((elev) => ({ elev, h: {} }));
  return {
    spec: { model: 'gfs', step: g.step, lat0: g.lat0, lon0: g.lon0, nx: g.nx, ny: g.ny, key: `static|${meta.run}` },
    times: meta.times,
    pts,
    aloft: pts.map((p) => p.h), // os níveis altos já vêm no mesmo arquivo
    static: meta,
    levels: meta.levels,
    loaded: new Map(),
    ready: new Set(),
  };
}

// Carrega (uma vez) o arquivo de um horário e distribui os valores pelos pontos
export function ensureStaticHour(grid, t) {
  if (grid.loaded.has(t)) return grid.loaded.get(t);
  const n = grid.times.length;
  const p = fetch(`data/gfs/h/${grid.static.files[t]}`)
    .then((r) => {
      if (!r.ok) throw new Error('Falha ao carregar o horário.');
      return r.json();
    })
    .then((d) => {
      for (const [k, arr] of Object.entries(d))
        arr.forEach((v, i) => {
          const h = grid.pts[i].h;
          if (!h[k]) h[k] = new Array(n).fill(null);
          h[k][t] = v;
        });
      grid.ready.add(t);
    });
  grid.loaded.set(t, p);
  p.catch(() => grid.loaded.delete(t));
  return p;
}
