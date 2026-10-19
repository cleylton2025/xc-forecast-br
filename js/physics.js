// Cálculos de meteorologia de voo livre.
// Tudo aqui é implementação própria, a partir de fórmulas públicas
// (método da parcela, escala convectiva de Deardorff, RASP/BLIPMAP).

const G = 9.81;
const CP = 1005;
const RD = 287.05;
const LV = 2.501e6;
const EPS = 0.622;
const DRY_LAPSE = 0.0098; // °C por metro

// Limiares de sustentação "útil" (taxa de subida do ar no núcleo da térmica)
export const LIFT_USABLE = 1.14; // m/s (≈ 225 ft/min)
export const LIFT_CONSERVATIVE = 1.5; // m/s
export const GLIDER_SINK = 1.0; // m/s, afundamento típico de um parapente

// Forma vertical da térmica: w(z) = W* · f(z/D), com f(x) ∝ x^(1/3)·(1 − 1,1x)
// (perfil de Allen/RASP), normalizado para o máximo ≈ W* em ~23% da camada.
// É o principal ponto de calibração do modelo.
const liftShape = (x) => (x <= 0 || x >= 1 ? 0 : 2.2 * Math.cbrt(x) * (1 - 1.1 * x));
const SHAPE_XMAX = 0.2273;
export const SHAPE_MAX = liftShape(SHAPE_XMAX);

export const satVap = (tc) => 6.112 * Math.exp((17.67 * tc) / (tc + 243.5)); // hPa
const mixRatio = (tc, p) => {
  const e = satVap(tc);
  return (EPS * e) / Math.max(p - e, 1);
};
export const dewFromRH = (tc, rh) => {
  if (rh == null || tc == null) return null;
  const a = Math.log(Math.max(rh, 1) / 100) + (17.67 * tc) / (tc + 243.5);
  return (243.5 * a) / (17.67 - a);
};
const rhFromDew = (tc, td) => Math.min(100, (100 * satVap(td)) / satVap(tc));

// Gradiente adiabático saturado (°C/m)
function moistLapse(tc, p) {
  const tk = tc + 273.15;
  const rs = mixRatio(tc, p);
  return (G * (1 + (LV * rs) / (RD * tk))) / (CP + (LV * LV * rs * EPS) / (RD * tk * tk));
}

const ok = (v) => v != null && Number.isFinite(v);

// Monta o perfil vertical (do solo para cima) a partir de uma amostra do modelo.
// sample: { elev, T2, Td2, msl, ws10, wd10, levels: [{p, T, z, ws, wd, rh}] }
export function buildProfile(s) {
  const psfc = ok(s.msl) ? s.msl * Math.pow(1 - 2.25577e-5 * s.elev, 5.25588) : 1013 * Math.pow(1 - 2.25577e-5 * s.elev, 5.25588);
  const sfc = {
    z: s.elev,
    p: psfc,
    T: s.T2,
    Td: s.Td2,
    ...uv(s.ws10, s.wd10),
  };
  const lv = s.levels
    .filter((l) => ok(l.T) && ok(l.z) && l.z > s.elev + 20 && l.p < psfc)
    .map((l) => ({
      z: l.z,
      p: l.p,
      T: l.T,
      Td: dewFromRH(l.T, l.rh),
      rh: l.rh,
      ...uv(l.ws, l.wd),
    }))
    .sort((a, b) => a.z - b.z);
  return [sfc, ...lv];
}

// Velocidade (km/h) + direção (de onde vem, graus) → componentes u/v (m/s)
function uv(ws, wd) {
  if (!ok(ws) || !ok(wd)) return { u: null, v: null };
  const ms = ws / 3.6;
  const r = (wd * Math.PI) / 180;
  return { u: -ms * Math.sin(r), v: -ms * Math.cos(r) };
}

export function toSpeedDir(u, v) {
  if (!ok(u) || !ok(v)) return { ws: null, wd: null };
  const ws = Math.hypot(u, v) * 3.6;
  const wd = (Math.atan2(-u, -v) * 180) / Math.PI;
  return { ws, wd: (wd + 360) % 360 };
}

// Interpolação linear de um campo do perfil na altura z (m, nível do mar)
export function interp(profile, z, key) {
  if (z <= profile[0].z) return profile[0][key];
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1];
    const b = profile[i];
    if (z <= b.z) {
      if (!ok(a[key]) || !ok(b[key])) return ok(b[key]) ? b[key] : a[key];
      const f = (z - a.z) / (b.z - a.z);
      return a[key] + f * (b[key] - a[key]);
    }
  }
  return null;
}

// Pressão interpolada em log
function pressureAt(profile, z) {
  if (z <= profile[0].z) return profile[0].p;
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1];
    const b = profile[i];
    if (z <= b.z) {
      const f = (z - a.z) / (b.z - a.z);
      return Math.exp(Math.log(a.p) + f * (Math.log(b.p) - Math.log(a.p)));
    }
  }
  const last = profile[profile.length - 1];
  return last.p * Math.exp(-(z - last.z) / 8000);
}

export function windAt(profile, z) {
  const u = interp(profile, z, 'u');
  const v = interp(profile, z, 'v');
  return toSpeedDir(u, v);
}

// Topo da térmica seca: onde a parcela que sobe do solo (T2 + excesso),
// esfriando 9,8 °C/km, deixa de ser mais quente que o ar ao redor.
export function thermalTop(profile, excess = 0) {
  const s = profile[0];
  const parcel = (z) => s.T + excess - DRY_LAPSE * (z - s.z);
  let prevZ = s.z;
  let prevD = excess;
  for (let i = 1; i < profile.length; i++) {
    const L = profile[i];
    const d = parcel(L.z) - L.T;
    if (d <= 0) {
      if (prevD <= 0) return prevZ;
      return prevZ + ((L.z - prevZ) * prevD) / (prevD - d);
    }
    prevZ = L.z;
    prevD = d;
  }
  return prevZ;
}

// Ascensão da parcela: seca até o NCL, saturada acima. Retorna T da parcela em z.
function parcelAscent(profile, zTarget) {
  const s = profile[0];
  const zlcl = s.z + 125 * Math.max(0, s.T - s.Td);
  if (zTarget <= zlcl) return s.T - DRY_LAPSE * (zTarget - s.z);
  let t = s.T - DRY_LAPSE * (zlcl - s.z);
  const dz = 50;
  for (let z = zlcl; z < zTarget; z += dz) {
    const step = Math.min(dz, zTarget - z);
    t -= moistLapse(t, pressureAt(profile, z)) * step;
  }
  return t;
}

// Topo da nuvem cúmulo: ascensão saturada a partir da base, com mistura
// do ar ambiente (entranhamento), até a parcela ficar mais fria que o ambiente.
// Sem o entranhamento, qualquer CAPE vira nuvem de 10 km, o que superestima muito.
const ENTRAINMENT = 6e-4; // fração por metro
function cumulusTop(profile, zBase) {
  const s = profile[0];
  let t = s.T - DRY_LAPSE * (zBase - s.z);
  const top = profile[profile.length - 1].z;
  const dz = 50;
  for (let z = zBase; z < top; z += dz) {
    const env = interp(profile, z, 'T');
    if (ok(env) && t < env) return z;
    t -= moistLapse(t, pressureAt(profile, z)) * dz;
    if (ok(env)) t -= ENTRAINMENT * dz * (t - env);
  }
  return top;
}

// Escala convectiva de Deardorff: W* = (g/T · H/(ρ·cp) · D)^(1/3)
export function wStar(shf, depth, t2, psfc) {
  if (!ok(shf) || shf <= 0 || depth <= 0) return 0;
  const tk = t2 + 273.15;
  const rho = (psfc * 100) / (RD * tk);
  return Math.cbrt((G / tk) * (shf / (rho * CP)) * depth);
}

// Maior altura (fração da camada) em que a térmica ainda sobe ≥ limiar
function usableFraction(ws, threshold) {
  if (ws * SHAPE_MAX < threshold) return 0;
  let lo = SHAPE_XMAX;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (ws * liftShape(mid) >= threshold) lo = mid;
    else hi = mid;
  }
  return lo;
}

// Classificação do potencial de cross-country (0 a 3)
export const XC_CLASSES = ['Sem condição', 'Fraco', 'Bom possível', 'Bom provável'];

function xcClass(d, s) {
  if (!d.shfOk) return 0;
  if ((s.precip ?? 0) > 0.5) return 0;
  if (d.liftagl < 400 || d.climb < 0.3) return 0;
  let pts = 0;
  pts += d.liftagl >= 1800 ? 3 : d.liftagl >= 1300 ? 2 : d.liftagl >= 800 ? 1 : 0;
  pts += d.climb >= 2.2 ? 3 : d.climb >= 1.5 ? 2 : d.climb >= 0.8 ? 1 : 0;
  const wt = d.windtop ?? 0;
  if (wt > 35) pts -= 2;
  else if (wt > 25) pts -= 1;
  if ((s.cc ?? 0) > 85) pts -= 1;
  if (d.cudepth > 3000) pts -= 1; // risco de cumulonimbus
  if (pts <= 1) return 1;
  if (pts <= 3) return 2;
  return 3;
}

// Calcula todos os parâmetros de voo para uma amostra (um ponto, uma hora).
export function derive(s) {
  const out = {};
  if (!ok(s.T2) || !ok(s.elev)) return null;
  if (!ok(s.Td2)) s.Td2 = s.T2 - 10;
  const prof = buildProfile(s);
  if (prof.length < 3) return null;
  const elev = s.elev;
  const psfc = prof[0].p;

  const bltop = thermalTop(prof, 0);
  const bltopHot = thermalTop(prof, 1);
  const depth = Math.max(0, bltop - elev);
  const shf = ok(s.shf) ? s.shf : null;
  const ws = wStar(shf, depth, s.T2, psfc);

  const zlcl = elev + 125 * Math.max(0, s.T2 - s.Td2);
  const cumulus = ws > 0.5 && zlcl < bltop;

  let toplift = elev + usableFraction(ws, LIFT_USABLE) * depth;
  let conslift = elev + usableFraction(ws, LIFT_CONSERVATIVE) * depth;
  if (cumulus) {
    toplift = Math.min(toplift, zlcl);
    conslift = Math.min(conslift, zlcl);
  }

  // Índice térmico médio (ambiente − parcela) dentro da camada
  let tiSum = 0;
  let tiN = 0;
  const zEnd = Math.max(bltop, elev + 300);
  for (let z = elev + 100; z <= zEnd; z += 100) {
    const env = interp(prof, z, 'T');
    if (!ok(env)) continue;
    tiSum += env - (s.T2 - DRY_LAPSE * (z - elev));
    tiN++;
  }

  // Índice de levantamento próprio (500 hPa)
  const l500 = prof.find((l) => l.p === 500);
  const li = l500 ? l500.T - parcelAscent(prof, l500.z) : null;

  // Vento no topo útil e no solo; cisalhamento na camada
  const wTop = windAt(prof, Math.max(toplift, elev + 100));
  const sfc = prof[0];
  const uTop = interp(prof, Math.max(bltop, elev + 100), 'u');
  const vTop = interp(prof, Math.max(bltop, elev + 100), 'v');
  const shear = ok(uTop) && ok(sfc.u) ? Math.hypot(uTop - sfc.u, vTop - sfc.v) : null;

  // Umidade média na camada limite
  const rhs = [rhFromDew(s.T2, s.Td2)];
  for (const l of prof.slice(1)) if (l.z <= Math.max(bltop, elev + 500) && ok(l.rh)) rhs.push(l.rh);

  out.toplift = toplift;
  out.conslift = conslift;
  out.liftagl = toplift - elev;
  out.bltop = bltop;
  out.topunc = Math.max(0, bltopHot - bltop);
  out.wstar = ws;
  out.climb = Math.max(0, ws * SHAPE_MAX - GLIDER_SINK);
  out.updraft = ws * SHAPE_MAX;
  out.bsratio = shear != null && ws > 0 ? (10 * ws) / Math.max(shear, 1) : 0;
  out.cape = s.cape ?? null;
  out.li = li;
  out.tiavg = tiN ? tiSum / tiN : null;
  out.cubase = cumulus ? zlcl : null;
  out.lcl = zlcl;
  out.cudepth = cumulus ? cumulusTop(prof, zlcl) - zlcl : 0;
  out.cloud = s.cc ?? null;
  out.cloudnohigh = ok(s.ccl) || ok(s.ccm) ? Math.max(s.ccl ?? 0, s.ccm ?? 0) : null;
  out.precip = s.precip ?? null;
  out.pw = s.pw ?? null;
  out.rhbl = rhs.reduce((a, b) => a + b, 0) / rhs.length;
  out.windtop = wTop.ws;
  out.windtopdir = wTop.wd;
  out.t2 = s.T2;
  out.shf = shf;
  out.msl = s.msl ?? null;
  out.elev = elev;
  out.shfOk = ok(shf) && shf > 20;
  out.xcpot = xcClass(out, s);
  out._profile = prof;
  return out;
}

// Ascensão completa (para o Skew-T): lista de {p, T} da parcela
export function parcelPath(profile) {
  const s = profile[0];
  const top = profile[profile.length - 1].z;
  const path = [];
  for (let z = s.z; z <= top; z += 100) path.push({ p: pressureAt(profile, z), T: parcelAscent(profile, z), z });
  return path;
}
