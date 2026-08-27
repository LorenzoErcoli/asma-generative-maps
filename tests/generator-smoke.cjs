const { loadGenerator } = require('./harness.cjs');

const api = loadGenerator();
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

// Un fiume e' tale solo se attraversa la scacchiera da bordo a bordo: e'
// la regola su cui si appoggia tutta la generazione a valle (le due sponde,
// i ponti, il taglio del tessuto). Una macchia che tocca UN solo bordo non
// e' un fiume, e' acqua ferma — laghetto se piccola, lago se piu' larga.
assert(api.classWater([[0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3]]) === 'fiume', 'vertical river classification');
assert(api.classWater([[4, 0], [4, 1], [4, 2], [4, 3], [4, 4], [4, 5], [4, 6], [4, 7]]) === 'fiume', 'horizontal river classification');
assert(api.classWater([[1, 3], [2, 3], [3, 3]]) === 'laghetto', 'water touching no edge is not a river');
assert(api.classWater([[3, 3]]) === 'laghetto', 'single cell classification');
assert(api.classWater([[3, 3], [3, 4], [4, 3], [4, 4]]) === 'lago', 'lake classification');
// il mare e' disattivato di proposito in world.js (MARE_ENABLED): finche' e'
// spento una costa si legge come acqua ferma. L'asserzione resta qui e torna
// viva da sola nel momento in cui il flag viene rialzato.
assert(api.classWater([[0, 1], [0, 2], [0, 3], [1, 1], [1, 2], [1, 3]]) === (api.MARE_ENABLED ? 'mare' : 'lago'), 'coast classification');

const axis = api.riverAxis([[0, 1], [1, 2], [2, 2], [2, 3], [3, 3]]);
assert(axis.every((p, i) => !i || Math.hypot(p[0] - axis[i - 1][0], p[1] - axis[i - 1][1]) < 156), 'continuous river axis');

const scenarios = [
  { name: 'landmarks', places: [[2, 2, 'piazza'], [5, 5, 'teatro']] },
  { name: 'river banks', river: true, places: [[2, 1, 'chiesa'], [2, 6, 'mercato'], [4, 2, 'piazza'], [5, 6, 'stazione']] },
  // 'ponte' non e' piu' una pedina (world.js: i ponti li piazza autoBridges):
  // lo scenario che lo chiedeva diventa "due sponde da ricucire da sole".
  { name: 'auto bridge', river: true, places: [[2, 1, 'chiesa'], [3, 6, 'municipio'], [5, 6, 'mercato'], [6, 1, 'teatro']] },
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
  assert(svg.trimEnd().endsWith('</svg>'), `${scenario.name}: truncated SVG`);
  assert(!/NaN|undefined|Infinity/.test(svg), `${scenario.name}: invalid geometry`);
  const diagnostics = api.diagnostics();
  // Invarianti geometrici (computeDiagnostics in tessuto.js): regole che
  // devono valere su ogni carta, qualunque sia la scacchiera di partenza.
  assert(diagnostics.roadWaterViolations === 0, `${scenario.name}: strade che guadano il fiume ${JSON.stringify(diagnostics.roadWaterDetails)}`);
  assert(diagnostics.plazaAccessFailures === 0, `${scenario.name}: piazza con meno di due accessi`);
  assert(diagnostics.plazaBlockViolations === 0, `${scenario.name}: piazza con un isolato costruito dentro`);
  assert(diagnostics.buildingRoadViolations === 0, `${scenario.name}: strada dentro un edificio`);
  assert(diagnostics.railUnbridged === 0, `${scenario.name}: ferrovia che guada il fiume`);
  assert(diagnostics.streets > 0, `${scenario.name}: no streets generated`);
  assert(diagnostics.buildings > 0, `${scenario.name}: no buildings generated`);
  // la rete stradale deve restare connessa: due componenti = un pezzo di
  // citta' irraggiungibile (col fiume in mezzo, il ponte che manca).
  assert(diagnostics.components === 1, `${scenario.name}: disconnected road network (components=${diagnostics.components})`);
  assert(diagnostics.anchorsUnresolved === 0, `${scenario.name}: unresolved anchor`);
  console.log(`${scenario.name}: ${api.status()}`);
}

// Il porto e' l'unica categoria con needsWater: senza acqua accanto la
// pedina va scartata, non deve produrre un porto in mezzo alla pianura.
for (const cat of ['porto']) {
  const grid = api.empty();
  grid[3][3] = { kind: 'place', cat, ord: 1 };
  api.setGrid(grid);
  api.generate();
  assert(/1 pedine ignorate/.test(api.status()), `${cat}: should require nearby water`);
  assert(!/NaN|undefined|Infinity/.test(api.svg()), `${cat}: invalid empty-state SVG`);
}

// Una categoria che non esiste piu' (o che arriva da una scacchiera salvata
// con una tassonomia vecchia) deve essere ignorata come una pedina non
// valida, non far esplodere generate().
{
  const grid = api.empty();
  grid[2][2] = { kind: 'place', cat: 'piazza', ord: 1 };
  grid[3][3] = { kind: 'place', cat: 'ponte', ord: 2 };
  api.setGrid(grid);
  api.generate();
  assert(/1 pedine ignorate/.test(api.status()), 'unknown category: should be ignored');
  assert(api.svg().startsWith('<svg'), 'unknown category: missing SVG');
}

console.log('generator smoke: OK');
