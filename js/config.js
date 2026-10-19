// Catálogo de camadas e escalas de cor.

const HEIGHT = {
  stops: [
    [0, '#55184d'],
    [300, '#b93b88'],
    [600, '#8f7fac'],
    [900, '#62cbff'],
    [1200, '#0168ff'],
    [1500, '#00345d'],
    [1800, '#036d00'],
    [2100, '#35cd34'],
    [2400, '#9dff64'],
    [2700, '#fefa02'],
    [3000, '#f0a830'],
    [3300, '#d5596a'],
    [3600, '#c0101a'],
  ],
  ticks: [0, 600, 1200, 1800, 2400, 3000, 3600],
};

const AGL = {
  stops: [
    [0, '#cfcfcf'],
    [300, '#8f7fac'],
    [600, '#62cbff'],
    [900, '#0168ff'],
    [1200, '#036d00'],
    [1500, '#35cd34'],
    [1800, '#9dff64'],
    [2100, '#fefa02'],
    [2500, '#f0a830'],
    [3000, '#c0101a'],
  ],
  ticks: [0, 500, 1000, 1500, 2000, 2500, 3000],
};

const CLIMB = {
  stops: [
    [0, '#cfcfcf'],
    [0.5, '#8f7fac'],
    [1, '#62cbff'],
    [1.5, '#0168ff'],
    [2, '#35cd34'],
    [2.5, '#fefa02'],
    [3, '#f0a830'],
    [4, '#c0101a'],
  ],
  ticks: [0, 1, 2, 3, 4],
};

const WIND = {
  stops: [
    [0, '#e8f4ff'],
    [10, '#7fd6a8'],
    [20, '#e6e64c'],
    [30, '#f0a830'],
    [40, '#e0482e'],
    [60, '#8e1a6e'],
  ],
  ticks: [0, 10, 20, 30, 40, 60],
};

const PERCENT = {
  stops: [
    [0, '#2a6fdb'],
    [25, '#7ea8e6'],
    [50, '#c9d4e2'],
    [75, '#e2e2e2'],
    [100, '#ffffff'],
  ],
  ticks: [0, 25, 50, 75, 100],
};

export const SCALES = {
  height: { ...HEIGHT, unit: 'm' },
  agl: { ...AGL, unit: 'm' },
  climb: { ...CLIMB, unit: 'm/s', digits: 1 },
  unc: {
    stops: [
      [0, '#35cd34'],
      [200, '#fefa02'],
      [500, '#f0a830'],
      [1000, '#c0101a'],
    ],
    ticks: [0, 250, 500, 750, 1000],
    unit: 'm',
  },
  bs: {
    stops: [
      [0, '#c0101a'],
      [3, '#f0a830'],
      [5, '#fefa02'],
      [8, '#35cd34'],
      [12, '#036d00'],
    ],
    ticks: [0, 3, 5, 8, 12],
    unit: '',
    digits: 1,
  },
  xc: {
    discrete: true,
    classes: [
      ['#9a9a9a', 'Sem condição'],
      ['#4fc8e0', 'Fraco'],
      ['#f6b73c', 'Bom possível'],
      ['#e0402a', 'Bom provável'],
    ],
    unit: '',
  },
  cape: {
    stops: [
      [0, '#f4f4f4'],
      [250, '#b6e3b6'],
      [500, '#62cbff'],
      [1000, '#fefa02'],
      [2000, '#f0a830'],
      [3000, '#c0101a'],
      [4000, '#8e1a6e'],
    ],
    ticks: [0, 500, 1000, 2000, 3000, 4000],
    unit: 'J/kg',
  },
  li: {
    stops: [
      [-8, '#8e1a6e'],
      [-5, '#c0101a'],
      [-2, '#f0a830'],
      [0, '#fefa02'],
      [3, '#9dff64'],
      [6, '#62cbff'],
      [10, '#0168ff'],
    ],
    ticks: [-8, -4, 0, 4, 8],
    unit: '°C',
    digits: 1,
  },
  ti: {
    stops: [
      [-4, '#c0101a'],
      [-2, '#f0a830'],
      [-1, '#fefa02'],
      [0, '#9dff64'],
      [1, '#62cbff'],
      [3, '#0168ff'],
    ],
    ticks: [-4, -2, 0, 2],
    unit: '°C',
    digits: 1,
  },
  cubase: { ...HEIGHT, unit: 'm' },
  cudepth: {
    stops: [
      [0, '#f4f4f4'],
      [300, '#c9e6ff'],
      [800, '#62cbff'],
      [1500, '#fefa02'],
      [3000, '#f0a830'],
      [6000, '#c0101a'],
    ],
    ticks: [0, 1000, 2000, 3000, 4500, 6000],
    unit: 'm',
  },
  percent: { ...PERCENT, unit: '%' },
  precip: {
    stops: [
      [0, 'rgba(255,255,255,0)'],
      [0.1, '#b6e3ff'],
      [1, '#4fa3e0'],
      [3, '#2a5bd7'],
      [6, '#7b2fbf'],
      [12, '#c0101a'],
    ],
    ticks: [0, 1, 3, 6, 12],
    unit: 'mm/h',
    digits: 1,
  },
  pw: {
    stops: [
      [0, '#f6e7c1'],
      [15, '#c9e6b0'],
      [30, '#62cbff'],
      [45, '#0168ff'],
      [60, '#3a1a8e'],
    ],
    ticks: [0, 15, 30, 45, 60],
    unit: 'mm',
  },
  rh: {
    stops: [
      [0, '#c08a3e'],
      [40, '#f6e7c1'],
      [60, '#c9e6b0'],
      [80, '#62cbff'],
      [100, '#0168ff'],
    ],
    ticks: [0, 20, 40, 60, 80, 100],
    unit: '%',
  },
  wind: { ...WIND, unit: 'km/h' },
  temp: {
    stops: [
      [0, '#3a1a8e'],
      [10, '#0168ff'],
      [18, '#62cbff'],
      [24, '#9dff64'],
      [28, '#fefa02'],
      [32, '#f0a830'],
      [38, '#c0101a'],
    ],
    ticks: [0, 10, 20, 30, 40],
    unit: '°C',
    digits: 1,
  },
  shf: {
    stops: [
      [-50, '#3a1a8e'],
      [0, '#9a9a9a'],
      [50, '#62cbff'],
      [150, '#35cd34'],
      [250, '#fefa02'],
      [350, '#f0a830'],
      [450, '#c0101a'],
    ],
    ticks: [0, 100, 200, 300, 400],
    unit: 'W/m²',
  },
  msl: {
    stops: [
      [1000, '#c0101a'],
      [1008, '#f0a830'],
      [1013, '#f4f4f4'],
      [1018, '#62cbff'],
      [1026, '#0168ff'],
    ],
    ticks: [1000, 1008, 1013, 1018, 1026],
    unit: 'hPa',
  },
};

export const GROUPS = [
  {
    title: 'Térmica / Sustentação',
    items: [
      {
        id: 'toplift',
        label: 'Teto útil de térmica',
        scale: 'height',
        desc: 'Altura (m, acima do nível do mar) até onde a térmica ainda sobe pelo menos 1,14 m/s (225 ft/min). Se houver cúmulos, fica limitada à base da nuvem.',
      },
      {
        id: 'conslift',
        label: 'Teto conservador',
        scale: 'height',
        desc: 'Como o teto útil, mas exigindo 1,5 m/s de subida do ar. Estimativa mais pessimista e mais segura.',
      },
      {
        id: 'liftagl',
        label: 'Sustentação acima do solo',
        scale: 'agl',
        desc: 'Teto útil menos a altitude do terreno: quanto de altura você tem para trabalhar acima do chão.',
      },
      {
        id: 'bltop',
        label: 'Topo da camada limite',
        scale: 'height',
        desc: 'Onde a parcela de ar aquecida no solo, subindo e esfriando 9,8 °C/km, deixa de ser mais quente que o ar ao redor (método da parcela). É o teto teórico das térmicas secas.',
      },
      {
        id: 'topunc',
        label: 'Incerteza do teto térmico',
        scale: 'unc',
        desc: 'Quanto o topo sobe se o solo estiver só 1 °C mais quente que o previsto. Valor alto = camada pouco estável acima do topo, o teto pode variar bastante; valor baixo = inversão firme.',
      },
      {
        id: 'climb',
        label: 'Velocidade de subida (parapente)',
        scale: 'climb',
        desc: 'Subida estimada no miolo da térmica descontando ~1 m/s de afundamento de um parapente.',
      },
      {
        id: 'wstar',
        label: 'Força térmica (W*)',
        scale: 'climb',
        desc: 'Velocidade convectiva de Deardorff, calculada a partir do fluxo de calor do solo e da profundidade da camada. Medida clássica da força das térmicas.',
      },
      {
        id: 'bsratio',
        label: 'Razão empuxo / cisalhamento',
        scale: 'bs',
        desc: 'Força da térmica dividida pelo cisalhamento do vento na camada. Abaixo de ~5 as térmicas tendem a ficar quebradas e difíceis de centrar. Indicador adaptado.',
      },
      {
        id: 'xcpot',
        label: 'Potencial XC',
        scale: 'xc',
        desc: 'Índice que combina altura útil, subida, vento no topo, cobertura de nuvens, chuva e risco de cúmulos profundos. Critérios abertos e calibráveis.',
      },
      {
        id: 'cape',
        label: 'CAPE',
        scale: 'cape',
        desc: 'Energia disponível para convecção (do modelo). Valores altos indicam risco de tempestade e sobredesenvolvimento.',
      },
      {
        id: 'li',
        label: 'Índice de levantamento (LI)',
        scale: 'li',
        desc: 'Temperatura do ambiente menos a da parcela em 500 hPa. Negativo = instável (convecção profunda possível).',
      },
      {
        id: 'tiavg',
        label: 'Índice térmico médio',
        scale: 'ti',
        desc: 'Diferença média entre o ar ambiente e a parcela dentro da camada. Quanto mais negativo, mais instável e melhores as térmicas.',
      },
    ],
  },
  {
    title: 'Nuvens / Tempo',
    items: [
      {
        id: 'cubase',
        label: 'Base dos cúmulos',
        scale: 'cubase',
        desc: 'Nível de condensação (m, nível do mar), mostrado só onde as térmicas alcançam esse nível e formam cúmulos.',
      },
      {
        id: 'cudepth',
        label: 'Espessura dos cúmulos',
        scale: 'cudepth',
        desc: 'Da base ao topo estimado da nuvem. Acima de ~3.000 m: risco de cumulonimbus e sucção de nuvem.',
      },
      { id: 'cloud', label: 'Cobertura de nuvens', scale: 'percent', desc: 'Cobertura total (%) do modelo.' },
      {
        id: 'cloudnohigh',
        label: 'Nuvens sem as altas',
        scale: 'percent',
        desc: 'Maior entre cobertura baixa e média (%). Ignora cirros, que pouco afetam o voo mas sombreiam um pouco.',
      },
      { id: 'precip', label: 'Precipitação', scale: 'precip', desc: 'Chuva prevista na hora (mm).' },
      {
        id: 'pw',
        label: 'Água precipitável',
        scale: 'pw',
        desc: 'Vapor de água na coluna (mm). Disponível no GFS.',
      },
      {
        id: 'rhbl',
        label: 'Umidade na camada limite',
        scale: 'rh',
        desc: 'Umidade relativa média entre o solo e o topo da camada (%). No mapa usa só a umidade junto ao solo; no detalhe do ponto, o perfil completo.',
      },
    ],
  },
  {
    title: 'Vento / Superfície',
    items: [
      {
        id: 'windtop',
        label: 'Vento no teto útil',
        scale: 'wind',
        desc: 'Velocidade do vento (km/h) na altura do teto útil de térmica.',
      },
      { id: 't2', label: 'Temperatura a 2 m', scale: 'temp', desc: 'Temperatura do ar perto do solo (°C).' },
      {
        id: 'shf',
        label: 'Fluxo de calor do solo',
        scale: 'shf',
        desc: 'Calor sensível que o solo transfere ao ar (W/m²). É o "motor" das térmicas.',
      },
      { id: 'msl', label: 'Pressão ao nível do mar', scale: 'msl', desc: 'Pressão reduzida ao nível do mar (hPa).' },
    ],
  },
];

export const PARAMS = Object.fromEntries(GROUPS.flatMap((g) => g.items.map((i) => [i.id, i])));

export const WIND_MODES = [
  ['none', 'Nenhum'],
  ['sfc', 'Superfície'],
  ['top', 'Teto útil'],
  ...[600, 1200, 1800, 2400, 3000, 3600, 4200, 4800, 5400, 6000, 7200, 8400, 9000].map((z) => [String(z), `${z} m`]),
];

export const BASEMAPS = {
  topo: {
    label: 'Topográfico',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    opts: { maxZoom: 17, subdomains: 'abc', attribution: '© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)' },
  },
  relief: {
    label: 'Relevo',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    opts: { maxZoom: 18, attribution: 'Tiles © Esri' },
  },
  light: {
    label: 'Claro',
    url: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
    opts: { maxZoom: 19, subdomains: 'abcd', attribution: '© OpenStreetMap © CARTO' },
  },
  satellite: {
    label: 'Satélite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    opts: { maxZoom: 18, attribution: 'Tiles © Esri' },
  },
};

export const LABELS_URL = 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png';

export const DEFAULT_VIEW = { lat: -20.2, lon: -40.9, zoom: 9 };
