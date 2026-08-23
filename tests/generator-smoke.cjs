const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const elements = new Map();

class ElementStub {
  constructor(id = '') {
    this.id = id;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.value = id === 'character' ? 'classico' : '';
    this.textContent = '';
    this.className = '';
    this.classList = { add() {}, remove() {} };
    this._html = '';
  }
  appendChild(node) { this.children.push(node); return node; }
  append(node) { this.children.push(node); }
  set innerHTML(value) { this._html = String(value); this.children = []; }
  get innerHTML() { return this._html; }
  querySelectorAll() { return []; }
  setPointerCapture() {}
}

for (const id of [
  'grid', 'terrainTools', 'catSelect', 'placeTools', 'jollyTools',
  'jollyLabels', 'mapHost', 'status', 'btnGen', 'btnClear', 'btnPrint',
  'btnExport', 'btnDemo', 'character',
]) elements.set(id, new ElementStub(id));

const document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, new ElementStub(id));
    return elements.get(id);
  },
  createElement() { return new ElementStub(); },
  querySelectorAll() { return []; },
};

const sandbox = {
  document,
  window: { print() {} },
  console,
  setTimeout(fn) { fn(); return 1; },
  clearTimeout() {},
  Blob: function Blob() {},
  URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} },
  Math,
};

vm.createContext(sandbox);
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/buildConsole\(\);buildGrid\(\);([\s\S]*?)demo\(\);\s*$/, 'buildConsole();buildGrid();$1') + `
  ;globalThis.generatorTestApi = {
    classWater, riverAxis, empty, generate,
    setGrid(value) { grid = value; order = 0; },
    svg() { return lastSVG; },
    diagnostics() { return lastDiagnostics; },
    status() { return document.getElementById('status').textContent; }
  };`;
vm.runInContext(source, sandbox, { timeout: 30000 });

const api = sandbox.generatorTestApi;
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(api.classWater([[0, 1], [0, 2], [0, 3]]) === 'mare', 'coast classification');
assert(api.classWater([[1, 3], [2, 3], [3, 3]]) === 'fiume', 'internal river classification');
assert(api.classWater([[3, 3], [3, 4], [4, 3], [4, 4]]) === 'lago', 'lake classification');

const axis = api.riverAxis([[0, 1], [1, 2], [2, 2], [2, 3], [3, 3]]);
assert(axis.every((p, i) => !i || Math.hypot(p[0] - axis[i - 1][0], p[1] - axis[i - 1][1]) < 156), 'continuous river axis');

const scenarios = [
  { name: 'landmarks', places: [[2, 2, 'piazza'], [5, 5, 'teatro']] },
  { name: 'river banks', river: true, places: [[2, 1, 'chiesa'], [2, 6, 'mercato'], [4, 2, 'piazza'], [5, 6, 'stazione']] },
  { name: 'requested bridge', river: true, places: [[2, 1, 'chiesa'], [3, 3, 'ponte'], [5, 6, 'mercato']] },
];

for (const scenario of scenarios) {
  const grid = api.empty();
  if (scenario.river) {
    for (let r = 0; r < 8; r++) grid[r][3 + (r > 3 ? 1 : 0)] = { kind: 'terrain', terrain: 'water' };
  }
  let ord = 0;
  for (const [r, c, cat] of scenario.places) grid[r][c] = { kind: 'place', cat, ord: ++ord };
  api.setGrid(grid);
  api.generate();
  const svg = api.svg();
  assert(svg.startsWith('<svg'), `${scenario.name}: missing SVG`);
  assert(!/NaN|undefined|Infinity/.test(svg), `${scenario.name}: invalid geometry`);
  const diagnostics = api.diagnostics();
  assert(diagnostics.roadWaterViolations === 0, `${scenario.name}: road crosses water ${JSON.stringify(diagnostics.roadWaterDetails)}`);
  assert(diagnostics.placeAccessFailures === 0, `${scenario.name}: inaccessible landmark`);
  assert(diagnostics.riverDangling === 0, `${scenario.name}: dangling river`);
  assert(diagnostics.railUnbridged === 0, `${scenario.name}: unbridged railway`);
  assert(diagnostics.blockRoadViolations === 0, `${scenario.name}: road crosses buildable block`);
  assert(diagnostics.plazaBlockViolations === 0, `${scenario.name}: plaza occupied by a block`);
  assert(diagnostics.plazaAccessFailures === 0, `${scenario.name}: plaza has fewer than two accesses`);
  console.log(`${scenario.name}: ${api.status()}`);
}

for (const cat of ['porto', 'ponte']) {
  const grid = api.empty();
  grid[3][3] = { kind: 'place', cat, ord: 1 };
  api.setGrid(grid);
  api.generate();
  assert(/1 pedine ignorate/.test(api.status()), `${cat}: should require nearby water`);
  assert(!/NaN|undefined|Infinity/.test(api.svg()), `${cat}: invalid empty-state SVG`);
}

console.log('generator smoke: OK');
