/* =====================================================================
   Harness dei test — carica il generatore fuori dal browser.

   Il codice non sta piu' in un <script> inline dentro index.html: vive in
   js/*.js, caricati come script classici, che condividono un unico scope
   globale. Qui si ricostruisce quella condizione: si leggono i <script src>
   nell'ORDINE in cui index.html li dichiara (cosi' aggiungere o riordinare
   un file non richiede di toccare i test) e si concatenano in un solo
   script eseguito in un contesto vm con un DOM finto.

   L'ultima riga di ui.js fa partire l'app (buildConsole/buildGrid/demo):
   il bootstrap viene tenuto, la chiamata a demo() no — i test scelgono da
   soli la scacchiera da generare.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// gli id che l'app si aspetta di trovare gia' nel documento; gli altri
// nascono su richiesta in getElementById, come farebbe una pagina vera.
const KNOWN_IDS = [
  'grid', 'terrainTools', 'catSelect', 'placeTools', 'jollyTools', 'jollyLabels',
  'customPlaces', 'mapHost', 'status', 'cameraStatus', 'frontNum', 'legendBody',
  'legendModal', 'legendClose', 'scannerFrame', 'character',
  'btnGen', 'btnClear', 'btnPrint', 'btnExport', 'btnDemo', 'btnLegend',
  'btnCamera', 'btnStartCamera', 'btnTrackBoard', 'btnManualBoard',
  'btnReadBoard', 'btnOpenCalibration',
];

class ElementStub {
  constructor(id = '') {
    this.id = id;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.value = id === 'character' ? 'classico' : '';
    this.textContent = '';
    this.className = '';
    this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
    this._html = '';
  }
  appendChild(node) { this.children.push(node); return node; }
  append(node) { this.children.push(node); }
  set innerHTML(value) { this._html = String(value); this.children = []; }
  get innerHTML() { return this._html; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
  getAttribute() { return null; }
  setPointerCapture() {}
  releasePointerCapture() {}
  showModal() {}
  close() {}
  click() {}
  remove() {}
}

// i file js/ nell'ordine dei <script src> di index.html
function scriptFiles() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const files = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
    .map(match => match[1])
    .filter(src => !/^https?:/.test(src));
  if (!files.length) throw new Error('index.html: nessuno <script src> trovato');
  return files;
}

function loadGenerator() {
  const elements = new Map();
  for (const id of KNOWN_IDS) elements.set(id, new ElementStub(id));

  const document = {
    body: new ElementStub('body'),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new ElementStub(id));
      return elements.get(id);
    },
    createElement() { return new ElementStub(); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };

  const sandbox = {
    document,
    window: { print() {}, addEventListener() {} },
    location: { origin: 'http://localhost' },
    console,
    setTimeout(fn) { fn(); return 1; },
    clearTimeout() {},
    requestAnimationFrame(fn) { fn(); return 1; },
    cancelAnimationFrame() {},
    Blob: function Blob() {},
    URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} },
    Math,
    Date,
    // BroadcastChannel resta assente di proposito: ui.js lo apre dentro un
    // try/catch e deve continuare a funzionare dove non esiste.
  };
  sandbox.window.location = sandbox.location;
  vm.createContext(sandbox);

  const source = scriptFiles()
    .map(file => fs.readFileSync(path.join(ROOT, file), 'utf8'))
    .join('\n;\n')
    // ui.js in coda avvia l'app: si tiene il bootstrap, si toglie demo()
    .replace(/buildConsole\(\);buildGrid\(\);([\s\S]*?)demo\(\);\s*$/, 'buildConsole();buildGrid();$1')
    + `
    // aggancio di debug: buildTessuto e' il punto in cui esistono insieme
    // fiume, ponti e tessuto: catturarne l'ultimo giro e' l'unico modo di
    // ispezionare la geometria vera da un test (generate() tiene tutto
    // dentro il proprio scope e restituisce solo l'SVG).
    ;const _buildTessuto = buildTessuto;
    buildTessuto = function(cityPoly, river) {
      const result = _buildTessuto.apply(null, arguments);
      globalThis.__lastTessuto = Object.assign({ cityPoly, river }, result);
      return result;
    };
    ;globalThis.generatorTestApi = {
      classWater, riverAxis, empty, generate, demo,
      MARE_ENABLED, CATS, ICON, MARKER_LEGEND, MARKER_TO_PLACE, nameFor,
      tessuto() { return globalThis.__lastTessuto; },
      setGrid(value) { grid = value; order = 0; },
      svg() { return lastSVG; },
      diagnostics() { return lastDiagnostics; },
      status() { return document.getElementById('status').textContent; }
    };`;
  vm.runInContext(source, sandbox, { timeout: 30000 });

  const api = sandbox.generatorTestApi;
  if (!api) throw new Error('il generatore non ha esposto generatorTestApi');
  return api;
}

module.exports = { loadGenerator, ElementStub, scriptFiles, ROOT };
