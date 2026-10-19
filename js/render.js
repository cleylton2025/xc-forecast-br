// Cores, desenho da camada sobre o mapa, legenda e barbelas de vento.

const hexCache = new Map();
function parseColor(c) {
  if (hexCache.has(c)) return hexCache.get(c);
  let rgba;
  if (c.startsWith('#')) {
    const n = parseInt(c.slice(1), 16);
    rgba = [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  } else {
    const m = c.match(/[\d.]+/g).map(Number);
    rgba = [m[0], m[1], m[2], Math.round((m[3] ?? 1) * 255)];
  }
  hexCache.set(c, rgba);
  return rgba;
}

export function colorAt(scale, v) {
  if (v == null || Number.isNaN(v)) return null;
  if (scale.discrete) {
    const c = scale.classes[Math.max(0, Math.min(scale.classes.length - 1, Math.round(v)))];
    return parseColor(c[0]);
  }
  const s = scale.stops;
  if (v <= s[0][0]) return parseColor(s[0][1]);
  if (v >= s[s.length - 1][0]) return parseColor(s[s.length - 1][1]);
  for (let i = 1; i < s.length; i++) {
    if (v <= s[i][0]) {
      const f = (v - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
      const a = parseColor(s[i - 1][1]);
      const b = parseColor(s[i][1]);
      return [0, 1, 2, 3].map((k) => Math.round(a[k] + f * (b[k] - a[k])));
    }
  }
  return null;
}

// Estilo de célula de tabela com texto legível sobre a cor de fundo
export function cellStyle(scale, v) {
  const c = colorAt(scale, v);
  if (!c || c[3] < 40) return '';
  const lum = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) * (c[3] / 255) + 255 * (1 - c[3] / 255);
  return ` style="background:rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(2)});color:${lum < 140 ? '#fff' : '#1b2430'}"`;
}

export function cssColor(scale, v) {
  const c = colorAt(scale, v);
  return c ? `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(2)})` : 'transparent';
}

const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const invMercY = (y) => (Math.atan(Math.exp(y)) * 360) / Math.PI - 90;

// Desenha o campo (valores na grade) num canvas em projeção de Mercator,
// com interpolação bilinear entre os pontos da grade.
export function renderField(spec, values, scale) {
  const { lat0, lon0, step, nx, ny } = spec;
  const south = lat0 - step / 2;
  const north = lat0 + (ny - 1) * step + step / 2;
  const west = lon0 - step / 2;
  const east = lon0 + (nx - 1) * step + step / 2;
  const W = Math.min(700, Math.max(200, nx * 24));
  const yN = mercY(north);
  const yS = mercY(south);
  const H = Math.round((W * (yN - yS)) / (((east - west) * Math.PI) / 180));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = Math.max(50, H);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(canvas.width, canvas.height);
  const val = (i, j) => values[Math.max(0, Math.min(ny - 1, i)) * nx + Math.max(0, Math.min(nx - 1, j))];

  for (let r = 0; r < canvas.height; r++) {
    const lat = invMercY(yN - ((r + 0.5) / canvas.height) * (yN - yS));
    const fi = (lat - lat0) / step;
    const i0 = Math.floor(fi);
    const di = fi - i0;
    for (let c = 0; c < canvas.width; c++) {
      const lon = west + ((c + 0.5) / canvas.width) * (east - west);
      const fj = (lon - lon0) / step;
      const j0 = Math.floor(fj);
      const dj = fj - j0;
      const q = [val(i0, j0), val(i0, j0 + 1), val(i0 + 1, j0), val(i0 + 1, j0 + 1)];
      const w = [(1 - di) * (1 - dj), (1 - di) * dj, di * (1 - dj), di * dj];
      let sum = 0;
      let wsum = 0;
      for (let k = 0; k < 4; k++)
        if (q[k] != null && !Number.isNaN(q[k])) {
          sum += q[k] * w[k];
          wsum += w[k];
        }
      if (wsum < 0.3) continue;
      const col = colorAt(scale, sum / wsum);
      if (!col) continue;
      const o = (r * canvas.width + c) * 4;
      img.data[o] = col[0];
      img.data[o + 1] = col[1];
      img.data[o + 2] = col[2];
      img.data[o + 3] = col[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return {
    url: canvas.toDataURL('image/png'),
    bounds: [
      [south, west],
      [north, east],
    ],
  };
}

export function fmt(v, scale) {
  if (v == null || Number.isNaN(v)) return '—';
  if (scale?.discrete) return scale.classes[Math.round(v)]?.[1] ?? '—';
  const d = scale?.digits ?? 0;
  return v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function legendHTML(param, scale) {
  if (scale.discrete) {
    return `<div class="legend-title">${param.label}</div>${scale.classes
      .slice()
      .reverse()
      .map(([c, l]) => `<div class="legend-row"><span class="sw" style="background:${c}"></span>${l}</div>`)
      .join('')}`;
  }
  const s = scale.stops;
  const min = s[0][0];
  const max = s[s.length - 1][0];
  const grad = s.map(([v, c]) => `${c} ${(100 - ((v - min) / (max - min)) * 100).toFixed(1)}%`).reverse().join(',');
  const ticks = scale.ticks
    .map((t) => `<span style="top:${(100 - ((t - min) / (max - min)) * 100).toFixed(1)}%">${t.toLocaleString('pt-BR')}</span>`)
    .join('');
  return `<div class="legend-title">${param.label}${scale.unit ? ` (${scale.unit})` : ''}</div>
    <div class="legend-bar"><div class="legend-grad" style="background:linear-gradient(to bottom,${grad})"></div><div class="legend-ticks">${ticks}</div></div>`;
}

// Barbela de vento (padrão meteorológico, em nós) + número em km/h
export function barbSVG(wsKmh, wd, size = 44) {
  const kt = wsKmh / 1.852;
  const c = size / 2;
  let body = '';
  if (kt < 2.5) {
    body = `<circle cx="${c}" cy="${c}" r="4" fill="none" stroke="#111" stroke-width="1.4"/>`;
  } else {
    let rest = Math.round(kt / 5) * 5;
    const len = 18;
    let y = c - len;
    let parts = `<line x1="${c}" y1="${c}" x2="${c}" y2="${y}" />`;
    while (rest >= 50) {
      parts += `<polygon points="${c},${y} ${c + 9},${y + 2} ${c},${y + 5}" fill="#111"/>`;
      y += 6;
      rest -= 50;
    }
    while (rest >= 10) {
      parts += `<line x1="${c}" y1="${y}" x2="${c + 9}" y2="${y - 4}" />`;
      y += 4;
      rest -= 10;
    }
    if (rest >= 5) {
      if (y === c - len) y += 4;
      parts += `<line x1="${c}" y1="${y}" x2="${c + 5}" y2="${y - 2}" />`;
    }
    body = `<g transform="rotate(${wd.toFixed(0)} ${c} ${c})" stroke="#111" stroke-width="1.4">${parts}</g>`;
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}<text x="${c + 4}" y="${c + 13}" font-size="10" font-weight="600" fill="#111" stroke="#fff" stroke-width="2.5" paint-order="stroke">${Math.round(wsKmh)}</text></svg>`;
}
