const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const elements = new Map();
class ElementStub {
  constructor(id = '') {
    this.id = id; this.children = []; this.style = {}; this.dataset = {};
    this.value = id === 'character' ? 'classico' : ''; this.textContent = '';
    this.className = ''; this.classList = { add() {}, remove() {} }; this._html = '';
  }
  appendChild(node) { this.children.push(node); return node; }
  append(node) { this.children.push(node); }
  set innerHTML(value) { this._html = String(value); this.children = []; }
  get innerHTML() { return this._html; }
  querySelectorAll() { return []; }
  setPointerCapture() {}
}
for (const id of ['grid', 'terrainTools', 'catSelect', 'placeTools', 'jollyTools', 'jollyLabels',
  'mapHost', 'status', 'btnGen', 'btnClear', 'btnPrint', 'btnExport', 'btnDemo', 'character']) {
  elements.set(id, new ElementStub(id));
}
const document = {
  getElementById(id) { if (!elements.has(id)) elements.set(id, new ElementStub(id)); return elements.get(id); },
  createElement() { return new ElementStub(); }, querySelectorAll() { return []; },
};
const sandbox = { document, window: { print() {} }, console, setTimeout(fn) { fn(); return 1; },
  clearTimeout() {}, Blob: function Blob() {},
  URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} }, Math };
vm.createContext(sandbox);
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/buildConsole\(\);buildGrid\(\);([\s\S]*?)demo\(\);\s*$/, 'buildConsole();buildGrid();$1') + `
  ;globalThis.auditApi = {empty, generate,
    setGrid(value) { grid=value; order=0; }, svg() { return lastSVG; },
    diagnostics() { return lastDiagnostics; }, status() { return document.getElementById('status').textContent; }};`;
vm.runInContext(source, sandbox, { timeout: 30000 });
const api = sandbox.auditApi;

function makeScenario(name, water = [], mountains = [], hills = [], places = []) {
  const grid = api.empty();
  for (const [r, c] of water) grid[r][c] = { kind: 'terrain', terrain: 'water' };
  for (const [r, c] of mountains) if (!grid[r][c]) grid[r][c] = { kind: 'terrain', terrain: 'mountain' };
  for (const [r, c] of hills) if (!grid[r][c]) grid[r][c] = { kind: 'terrain', terrain: 'hill' };
  let ord = 0;
  for (const [r, c, cat] of places) if (!grid[r][c]) grid[r][c] = { kind: 'place', cat, ord: ++ord };
  return { name, grid };
}

const scenarios = [
  makeScenario('Centro compatto', [], [], [], [[2,2,'municipio'],[2,3,'piazza'],[3,2,'mercato'],[3,3,'chiesa'],[4,3,'teatro'],[4,4,'giardino']]),
  makeScenario('Fiume verticale', Array.from({length:8},(_,r)=>[r,3+(r>4?1:0)]), [], [], [[2,1,'municipio'],[2,5,'piazza'],[4,1,'mercato'],[4,6,'teatro'],[5,2,'stazione'],[3,3,'ponte']]),
  makeScenario('Fiume diagonale', Array.from({length:8},(_,r)=>[r,Math.min(7,1+r)]), [], [], [[1,4,'municipio'],[2,5,'piazza'],[4,2,'chiesa'],[5,6,'mercato'],[6,3,'stazione'],[3,4,'ponte']]),
  makeScenario('Costa e porto', [[0,1],[0,2],[0,3],[1,2],[1,3]], [], [[5,1],[5,2]], [[1,1,'porto'],[2,2,'mercato'],[3,3,'piazza'],[4,4,'municipio'],[5,5,'teatro'],[6,4,'stazione']]),
  makeScenario('Lago interno', [[3,3],[3,4],[4,3],[4,4]], [], [], [[1,2,'municipio'],[2,5,'piazza'],[5,2,'mercato'],[6,5,'teatro'],[3,1,'giardino'],[4,6,'stazione']]),
  makeScenario('Due corsi separati', [[0,2],[1,2],[2,2],[5,4],[6,4],[7,5]], [[6,0],[7,0]], [], [[1,1,'municipio'],[2,4,'piazza'],[3,2,'mercato'],[4,5,'teatro'],[5,2,'stazione'],[6,6,'locale']]),
  makeScenario('Affluente', [[0,4],[1,4],[2,4],[3,4],[4,4],[5,4],[6,4],[7,4],[2,0],[2,1],[2,2]], [], [], [[1,5,'municipio'],[3,2,'piazza'],[4,6,'mercato'],[6,2,'teatro'],[5,5,'stazione'],[3,4,'ponte']]),
  makeScenario('Comprensorio sparso', [], [[5,1],[6,1],[6,2]], [[1,5],[1,6]], [[1,1,'municipio'],[1,6,'teatro'],[3,3,'piazza'],[5,5,'mercato'],[6,2,'chiesa'],[6,6,'stazione']]),
  makeScenario('Valle montana', [], [[0,3],[1,3],[2,3],[4,3],[5,3],[6,3],[7,3]], [[3,3]], [[1,1,'municipio'],[2,2,'piazza'],[4,4,'mercato'],[5,5,'teatro'],[6,6,'stazione']]),
  makeScenario('Fiume e rilievi', Array.from({length:8},(_,r)=>[r,4]), [[1,1],[2,1],[6,6],[7,6]], [[3,1],[5,6]], [[1,3,'municipio'],[2,6,'piazza'],[4,2,'mercato'],[5,5,'teatro'],[6,3,'stazione'],[3,4,'ponte']]),
  makeScenario('Citta lineare', [], [], [], [[1,1,'stazione'],[2,2,'mercato'],[3,3,'piazza'],[4,4,'municipio'],[5,5,'teatro'],[6,6,'locale']]),
  makeScenario('Policentrica', [], [], [], [[1,1,'municipio'],[1,2,'piazza'],[2,1,'mercato'],[5,5,'municipio'],[5,6,'piazza'],[6,5,'teatro'],[3,3,'stazione']]),
];

function stressScenario(seed) {
  let state = seed >>> 0;
  const random = () => ((state = Math.imul(state ^ state >>> 15, 1 | state) + 0x6D2B79F5 | 0) >>> 0) / 4294967296;
  const water = [], mountains = [], hills = [], places = [];
  const mode = seed % 5;
  if (mode === 1) {
    let c = 1 + Math.floor(random() * 5);
    for (let r = 0; r < 8; r++) { if (random() < .35) c += random() < .5 ? -1 : 1; c = Math.max(1, Math.min(6, c)); water.push([r, c]); }
  } else if (mode === 2) {
    const start = 1 + Math.floor(random() * 3), length = 3 + Math.floor(random() * 3);
    for (let c = start; c < Math.min(8, start + length); c++) water.push([0, c]);
  } else if (mode === 3) {
    const r = 2 + Math.floor(random() * 3), c = 2 + Math.floor(random() * 3);
    water.push([r,c],[r+1,c],[r,c+1],[r+1,c+1]);
  } else if (mode === 4) {
    for (let r = 0; r < 4; r++) water.push([r, 2]);
    for (let r = 4; r < 8; r++) water.push([r, 5]);
  }
  const occupied = new Set(water.map(([r,c]) => `${r},${c}`));
  for (let i = 0; i < 4; i++) {
    const r = Math.floor(random() * 8), c = Math.floor(random() * 8), key = `${r},${c}`;
    if (!occupied.has(key)) { (i < 2 ? mountains : hills).push([r,c]); occupied.add(key); }
  }
  const cats = ['municipio','piazza','mercato','chiesa','teatro','giardino','locale','biblioteca','stazione'];
  const count = 6 + Math.floor(random() * 4);
  for (let tries = 0; places.length < count && tries < 100; tries++) {
    const r = Math.floor(random() * 8), c = Math.floor(random() * 8), key = `${r},${c}`;
    if (occupied.has(key)) continue;
    places.push([r,c,cats[places.length % cats.length]]); occupied.add(key);
  }
  return makeScenario(`Stress ${seed}`, water, mountains, hills, places);
}
for (let seed = 101; seed <= 112; seed++) scenarios.push(stressScenario(seed));

const filtered = process.env.AUDIT_FILTER
  ? scenarios.filter(scenario => process.env.AUDIT_FILTER.split(',').some(term => scenario.name.includes(term.trim())))
  : scenarios;
const limit = Number.parseInt(process.env.AUDIT_LIMIT || '', 10);
const selected = Number.isFinite(limit) ? filtered.slice(0, Math.max(0, limit)) : filtered;
const results = [], failures = [];
const pairOutputDir = process.env.PAIR_OUTPUT_DIR ? path.resolve(process.env.PAIR_OUTPUT_DIR) : null;
const pairIndexOffset = Number.parseInt(process.env.PAIR_INDEX_OFFSET || '0', 10) || 0;
if (pairOutputDir) fs.mkdirSync(pairOutputDir, { recursive: true });

const escXml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
}[char]));
const pawnMark = {
  municipio: 'M', piazza: 'P', mercato: 'MR', chiesa: 'C', teatro: 'T',
  giardino: 'G', stazione: 'S', ponte: '=', porto: 'PR', porta: 'PT',
  biblioteca: 'B', cimitero: 'CM', torre: 'TR', locale: 'L', fontana: 'F',
};
function boardSvg(grid, x, y, size = 416) {
  const gap = 3, cell = (size - gap * 9) / 8;
  let out = `<g transform="translate(${x} ${y})"><rect width="${size}" height="${size}" rx="6" fill="#4a3d30"/>`;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const px = gap + c * (cell + gap), py = gap + r * (cell + gap), value = grid[r][c];
    let fill = (r + c) % 2 ? '#c3b088' : '#cdbd97';
    if (value?.kind === 'terrain') fill = { water: '#3b6f86', mountain: '#7a5a3a', hill: '#6f8a4a' }[value.terrain] || fill;
    out += `<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${cell.toFixed(1)}" height="${cell.toFixed(1)}" rx="2" fill="${fill}"/>`;
    if (value?.kind === 'place') {
      const cx = px + cell / 2, cy = py + cell / 2, mark = pawnMark[value.cat] || (value.jolly ? 'J' : '?');
      out += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(cell * .32).toFixed(1)}" fill="#211c17" stroke="#f2ecdb" stroke-width="1.2"/>`;
      out += `<text x="${cx.toFixed(1)}" y="${(cy + 4).toFixed(1)}" fill="#fff" font-size="${mark.length > 1 ? 9 : 13}" font-family="system-ui,sans-serif" font-weight="700" text-anchor="middle">${escXml(mark)}</text>`;
      if (value.ord) {
        out += `<circle cx="${(px + cell - 4).toFixed(1)}" cy="${(py + 4).toFixed(1)}" r="8" fill="#c98a4b"/>`;
        out += `<text x="${(px + cell - 4).toFixed(1)}" y="${(py + 7).toFixed(1)}" fill="#211c17" font-size="9" font-family="system-ui,sans-serif" font-weight="700" text-anchor="middle">${value.ord}</text>`;
      }
    }
  }
  return out + '</g>';
}
function mapAndBoardSvg(svg, grid) {
  const match = svg.match(/^<svg[^>]*>([\s\S]*)<\/svg>\s*$/);
  if (!match) throw new Error('SVG della mappa non riconosciuto');
  const mapSize = 1100, panel = 480, board = 416, boardX = mapSize + (panel - board) / 2;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${mapSize + panel}" height="${mapSize}" viewBox="0 0 ${mapSize + panel} ${mapSize}">
    <rect width="${mapSize + panel}" height="${mapSize}" fill="#1b1611"/>
    <svg x="0" y="0" width="${mapSize}" height="${mapSize}" viewBox="0 0 ${mapSize} ${mapSize}" overflow="hidden">${match[1]}</svg>
    ${boardSvg(grid, boardX, (mapSize - board) / 2, board)}
  </svg>`;
}
function fileSlug(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
for (const scenario of selected) {
  api.setGrid(scenario.grid); api.generate();
  const d = api.diagnostics(), svg = api.svg();
  results.push({ name: scenario.name, d, svg, grid: scenario.grid });
  if (pairOutputDir) {
    const index = String(pairIndexOffset + results.length).padStart(2, '0');
    fs.writeFileSync(path.join(pairOutputDir, `${index}-${fileSlug(scenario.name)}.svg`), mapAndBoardSvg(svg, scenario.grid));
  }
  for (const key of ['roadWaterViolations', 'riverDangling', 'railUnbridged',
    'blockRoadViolations', 'plazaBlockViolations', 'plazaAccessFailures']) {
    if (d[key]) failures.push(`${scenario.name}: ${key}=${d[key]}`);
  }
  // Un luogo periferico non deve provocare una strada dedicata. E' un errore
  // soltanto se esisteva una via raggiungibile sulla stessa sponda entro il
  // normale raggio di assestamento ma il generatore non l'ha usata.
  if ((d.placeAccessDetails || []).some(place => place.sameBankDistance != null && place.sameBankDistance <= 190)) {
    failures.push(`${scenario.name}: avoidable placeAccessFailures=${d.placeAccessFailures}`);
  }
  if (d.regionalComponents > Math.max(1, d.urbanComponents * 3)) failures.push(`${scenario.name}: regionalComponents=${d.regionalComponents}, urbanComponents=${d.urbanComponents}`);
  if (d.roadComponents > Math.max(1, d.urbanComponents)) failures.push(`${scenario.name}: roadComponents=${d.roadComponents}, urbanComponents=${d.urbanComponents}`);
  if (d.deadEnds > 3) failures.push(`${scenario.name}: deadEnds=${d.deadEnds}`);
  if (d.streets > 450) failures.push(`${scenario.name}: streets=${d.streets}`);
  console.log(`${scenario.name}: ${JSON.stringify(d)}`);
}

const cards = results.map(({ name, d, svg }) => `<article><h2>${name}</h2><p>${d.streets} strade · ${d.urbanComponents} nuclei · ${d.roadComponents} componenti · ${d.deadEnds} estremita isolate · ${d.railCrossings} ponti ferroviari</p>${svg}</article>`).join('');
const gallery = `<!doctype html><meta charset="utf-8"><title>Audit generatore</title><style>
  *{box-sizing:border-box}body{margin:0;background:#181510;color:#eee;font:14px system-ui;display:grid;grid-template-columns:repeat(${results.length <= 2 ? 1 : 3},1fr);gap:12px;padding:12px}
  article{background:#29231b;padding:8px}h2{font-size:16px;margin:0 0 3px}p{margin:0 0 7px;color:#cfc6b7}svg{display:block;width:100%;height:auto;background:#eee}
  </style>${cards}`;
const output = process.env.AUDIT_OUTPUT
  ? path.resolve(process.env.AUDIT_OUTPUT)
  : path.join(os.tmpdir(), 'asma-map-audit.html');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, gallery);
console.log(`GALLERY=${output}`);
if (pairOutputDir) console.log(`PAIRS=${pairOutputDir}`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
