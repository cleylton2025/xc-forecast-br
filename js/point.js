// Painel de detalhes de um ponto: gráfico do dia, sondagem Skew-T e comparação de modelos.

import { MODELS, fetchPoint, sampleFrom, POINT_LEVEL_SET } from './api.js';
import { derive, parcelPath, XC_CLASSES } from './physics.js';
import { SCALES } from './config.js';
import { cssColor, cellStyle, fmt, barbSVG } from './render.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export async function loadPoint(lat, lon) {
  const res = await Promise.allSettled(Object.keys(MODELS).map((m) => fetchPoint(m, lat, lon)));
  const out = {};
  res.forEach((r, i) => {
    const m = Object.keys(MODELS)[i];
    if (r.status === 'fulfilled') {
      const p = r.value;
      p.derived = p.times.map((_, t) => derive(sampleFrom(p.h, p.elev, t, m, POINT_LEVEL_SET)));
      out[m] = p;
    } else out[m] = { error: r.reason?.message || 'Falha' };
  });
  return out;
}

// ---------- Gráfico do dia ----------
export function dayChart(p, dayTimes) {
  const W = 640;
  const H = 230;
  const L = 46;
  const R = 10;
  const T = 12;
  const B = 26;
  const hours = dayTimes.filter((t) => {
    const h = +p.times[t].slice(11, 13);
    return h >= 6 && h <= 19;
  });
  if (!hours.length) return '';
  const rows = hours.map((t) => ({ t, h: +p.times[t].slice(11, 13), d: p.derived[t] }));
  let zmax = p.elev + 500;
  for (const r of rows) if (r.d) zmax = Math.max(zmax, r.d.bltop, r.d.cubase ?? 0, r.d.toplift);
  zmax = Math.ceil((zmax + 200) / 500) * 500;
  const zmin = Math.max(0, Math.floor((p.elev - 100) / 500) * 500);
  const x = (i) => L + ((W - L - R) * (i + 0.5)) / rows.length;
  const y = (z) => T + (H - T - B) * (1 - (z - zmin) / (zmax - zmin));
  const bw = ((W - L - R) / rows.length) * 0.62;
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Gráfico de teto de térmica ao longo do dia">`;
  for (let z = zmin; z <= zmax; z += 500)
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(z)}" y2="${y(z)}" class="grid"/><text x="${L - 6}" y="${y(z) + 4}" text-anchor="end" class="ax">${z}</text>`;
  svg += `<rect x="${L}" y="${y(p.elev)}" width="${W - L - R}" height="${H - B - y(p.elev)}" class="ground"/>`;
  rows.forEach((r, i) => {
    if (!r.d) return;
    const col = cssColor(SCALES.xc, r.d.xcpot);
    svg += `<rect x="${x(i) - bw / 2}" y="${y(r.d.bltop)}" width="${bw}" height="${Math.max(0, y(p.elev) - y(r.d.bltop))}" class="blbar"/>`;
    svg += `<rect x="${x(i) - bw / 2}" y="${y(r.d.toplift)}" width="${bw}" height="${Math.max(0, y(p.elev) - y(r.d.toplift))}" fill="${col}" opacity="0.9"><title>${r.h}h: teto útil ${Math.round(r.d.toplift)} m, subida ${fmt(r.d.climb, { digits: 1 })} m/s</title></rect>`;
    if (r.d.cubase) {
      const top = Math.min(zmax, r.d.cubase + r.d.cudepth);
      svg += `<rect x="${x(i) - bw / 2 - 2}" y="${y(top)}" width="${bw + 4}" height="${Math.max(2, y(r.d.cubase) - y(top))}" class="cloud"/>`;
    }
    svg += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="ax">${r.h}h</text>`;
  });
  svg += `</svg>`;
  const legend = `<div class="chart-legend"><span><i class="k blbar"></i>Topo da camada</span><span><i class="k" style="background:${cssColor(SCALES.xc, 2)}"></i>Teto útil (cor = potencial XC)</span><span><i class="k cloud"></i>Cúmulos</span><span><i class="k ground"></i>Terreno</span></div>`;

  const table = `<div class="tablewrap"><table class="daytable"><thead><tr><th></th>${rows.map((r) => `<th>${r.h}h</th>`).join('')}</tr></thead><tbody>
    ${trow('Teto útil (m)', rows, (d) => fmt(d.toplift), (d) => cellStyle(SCALES.height, d.toplift))}
    ${trow('Acima do solo (m)', rows, (d) => fmt(d.liftagl))}
    ${trow('Subida (m/s)', rows, (d) => fmt(d.climb, { digits: 1 }), (d) => cellStyle(SCALES.climb, d.climb))}
    ${trow('W* (m/s)', rows, (d) => fmt(d.wstar, { digits: 1 }))}
    ${trow('Base cúmulos (m)', rows, (d) => (d.cubase ? fmt(d.cubase) : '—'))}
    ${trow('Vento no teto', rows, (d) => (d.windtop != null ? `${dirArrow(d.windtopdir)} ${Math.round(d.windtop)}` : '—'), (d) => cellStyle(SCALES.wind, d.windtop))}
    ${trow('Nuvens (%)', rows, (d) => fmt(d.cloud))}
    ${trow('Chuva (mm)', rows, (d) => fmt(d.precip, { digits: 1 }))}
    ${trow('Potencial XC', rows, (d) => ['–', 'F', 'B?', 'B'][d.xcpot], (d) => cellStyle(SCALES.xc, d.xcpot))}
  </tbody></table></div>`;
  return svg + legend + table;
}

function trow(label, rows, f, bg) {
  return `<tr><th>${label}</th>${rows
    .map((r) => (r.d ? `<td${bg ? bg(r.d) : ''}>${f(r.d)}</td>` : '<td>—</td>'))
    .join('')}</tr>`;
}

const dirArrow = (wd) => `<span class="arrow" style="transform:rotate(${(wd + 180) % 360}deg)">↑</span>`;

// ---------- Skew-T ----------
export function skewT(p, t) {
  const d = p.derived[t];
  if (!d) return '<p class="muted">Sem dados para este horário.</p>';
  const prof = d._profile;
  const W = 520;
  const H = 480;
  const L = 40;
  const R = 60;
  const T = 10;
  const B = 28;
  const pTop = 250;
  const pBot = 1050;
  const tMin = -45;
  const tMax = 40;
  const skew = 0.55;
  const yP = (pp) => T + ((H - T - B) * (Math.log(pp) - Math.log(pTop))) / (Math.log(pBot) - Math.log(pTop));
  const xT = (tc, pp) => L + ((W - L - R) * (tc - tMin)) / (tMax - tMin) + skew * (H - B - yP(pp));
  let s = `<svg viewBox="0 0 ${W} ${H}" class="skewt" role="img" aria-label="Diagrama Skew-T">`;
  s += `<defs><clipPath id="sk"><rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/></clipPath></defs><g clip-path="url(#sk)">`;
  for (let tc = -100; tc <= 50; tc += 10)
    s += `<line x1="${xT(tc, pBot)}" y1="${yP(pBot)}" x2="${xT(tc, pTop)}" y2="${yP(pTop)}" class="iso${tc === 0 ? ' zero' : ''}"/>`;
  for (let th = -30; th <= 150; th += 10) {
    let path = '';
    for (let pp = pBot; pp >= pTop; pp -= 25) {
      const tc = (th + 273.15) * Math.pow(pp / 1000, 0.286) - 273.15;
      path += `${path ? 'L' : 'M'}${xT(tc, pp).toFixed(1)},${yP(pp).toFixed(1)}`;
    }
    s += `<path d="${path}" class="dry"/>`;
  }
  const line = (pts, key, cls) => {
    let path = '';
    for (const q of pts) if (q[key] != null) path += `${path ? 'L' : 'M'}${xT(q[key], q.p).toFixed(1)},${yP(q.p).toFixed(1)}`;
    return `<path d="${path}" class="${cls}"/>`;
  };
  s += line(parcelPath(prof), 'T', 'parcel');
  s += line(prof, 'Td', 'dew');
  s += line(prof, 'T', 'temp');
  const pAt = (z) => {
    for (let i = 1; i < prof.length; i++)
      if (z <= prof[i].z) {
        const a = prof[i - 1];
        const b = prof[i];
        const f = (z - a.z) / (b.z - a.z);
        return Math.exp(Math.log(a.p) + f * (Math.log(b.p) - Math.log(a.p)));
      }
    return null;
  };
  const mark = (z, cls, label) => {
    const pp = pAt(z);
    if (!pp) return '';
    return `<line x1="${L}" x2="${W - R}" y1="${yP(pp)}" y2="${yP(pp)}" class="${cls}"/><text x="${L + 4}" y="${yP(pp) - 3}" class="mk">${label} ${Math.round(z)} m</text>`;
  };
  s += mark(d.toplift, 'mk-lift', 'Teto útil');
  if (d.cubase) s += mark(d.cubase, 'mk-cloud', 'Base cúmulos');
  s += `</g>`;
  for (const pp of [1000, 925, 850, 700, 500, 400, 300])
    s += `<text x="${L - 4}" y="${yP(pp) + 4}" text-anchor="end" class="ax">${pp}</text>`;
  for (let tc = -30; tc <= 40; tc += 10) s += `<text x="${xT(tc, pBot)}" y="${H - 10}" text-anchor="middle" class="ax">${tc}°</text>`;
  for (const q of prof) {
    if (q.u == null || q.p < pTop) continue;
    const ws = Math.hypot(q.u, q.v) * 3.6;
    const wd = ((Math.atan2(-q.u, -q.v) * 180) / Math.PI + 360) % 360;
    s += `<g transform="translate(${W - R + 6},${yP(q.p) - 22})">${barbSVG(ws, wd, 44).replace('<svg', '<svg x="0" y="0"')}</g>`;
  }
  s += `</svg>`;
  return `${s}<div class="chart-legend"><span><i class="k" style="background:#d62728"></i>Temperatura</span><span><i class="k" style="background:#2ca02c"></i>Ponto de orvalho</span><span><i class="k dash"></i>Parcela</span></div>`;
}

// ---------- Comparação ----------
export function compareTable(data, t) {
  const rows = [
    ['Teto útil (m)', 'toplift', SCALES.height],
    ['Acima do solo (m)', 'liftagl', SCALES.agl],
    ['Topo da camada (m)', 'bltop', SCALES.height],
    ['Subida (m/s)', 'climb', SCALES.climb],
    ['W* (m/s)', 'wstar', SCALES.climb],
    ['Base cúmulos (m)', 'cubase', SCALES.height],
    ['Espessura cúmulos (m)', 'cudepth', SCALES.cudepth],
    ['Vento no teto (km/h)', 'windtop', SCALES.wind],
    ['Nuvens (%)', 'cloud', SCALES.percent],
    ['Chuva (mm)', 'precip', SCALES.precip],
    ['CAPE (J/kg)', 'cape', SCALES.cape],
    ['Temperatura 2 m (°C)', 't2', SCALES.temp],
    ['Potencial XC', 'xcpot', SCALES.xc],
  ];
  const models = Object.keys(MODELS);
  const head = models.map((m) => `<th>${MODELS[m].label} <small>${MODELS[m].res}</small></th>`).join('');
  const body = rows
    .map(
      ([label, k, sc]) =>
        `<tr><th>${label}</th>${models
          .map((m) => {
            const d = data[m]?.derived?.[t];
            if (!d) return '<td>—</td>';
            const v = k === 'xcpot' ? XC_CLASSES[d.xcpot] : fmt(d[k], sc);
            return `<td${cellStyle(sc, d[k])}>${esc(v)}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('');
  return `<div class="tablewrap"><table class="cmp"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>
  <p class="muted small">Quando os modelos concordam, a previsão é mais confiável. Diferenças grandes = incerteza: voe com margem.</p>`;
}
