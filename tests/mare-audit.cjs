/* =====================================================================
   Il mare, scenario per scenario: 24 scacchiere che coprono tutti i modi
   in cui una fila di pedine blu puo' diventare una costa, piu' i controlli
   che dicono quando NON deve diventarlo.

     npm run mare                     tutte le carte, SVG + PNG + galleria
     node tests/mare-audit.cjs isola  solo gli scenari con quel testo nel nome
     SENZA_PNG=1 npm run mare         solo SVG, piu' veloce
     MARE_OUTPUT=... npm run mare     dove scrivere (default: cartella temp)

   Ogni scenario dichiara che cosa si aspetta dal classificatore ('mare',
   'fiume', 'lago'): e' li' che si vede se la regola della costa comincia a
   rubare fiumi. I PNG escono da Chrome o Edge in headless, nessuna
   dipendenza da installare — come il resto del progetto.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { loadGenerator, ROOT } = require('./harness.cjs');

const OUT = process.env.MARE_OUTPUT ? path.resolve(process.env.MARE_OUTPUT)
  : path.join(os.tmpdir(), 'asma-mare');
const api = loadGenerator();

// i parametri della costa vivono in js/world.js: si leggono da li' invece
// di ricopiarli, cosi' la didascalia delle carte non mente mai.
const PARAMS = {};
{
  const src = fs.readFileSync(path.join(ROOT, 'js/world.js'), 'utf8');
  for (const k of ['SEA_MIN_RUN', 'SEA_BEACH', 'SEA_WAVE', 'SEA_WAVE_LONG', 'FRANGIA']) {
    const m = src.match(new RegExp('\\b' + k + '=([\\d.]+)'));
    PARAMS[k] = m ? Number(m[1]) : '?';
  }
}

/* ---------------- scenari ---------------- */
function board(water = [], mountains = [], hills = [], places = []) {
  const grid = api.empty();
  for (const [r, c] of water) grid[r][c] = { kind: 'terrain', terrain: 'water' };
  for (const [r, c] of mountains) if (!grid[r][c]) grid[r][c] = { kind: 'terrain', terrain: 'mountain' };
  for (const [r, c] of hills) if (!grid[r][c]) grid[r][c] = { kind: 'terrain', terrain: 'hill' };
  let ord = 0;
  for (const [r, c, cat] of places) {
    if (r < 0 || r > 7 || c < 0 || c > 7) throw new Error(`pedina ${cat} fuori scacchiera: ${r},${c}`);
    if (!grid[r][c]) grid[r][c] = { kind: 'place', cat, ord: ++ord };
  }
  return grid;
}
const riga = r => Array.from({ length: 8 }, (_, c) => [r, c]);
const colonna = c => Array.from({ length: 8 }, (_, r) => [r, c]);

// Sempre le stesse otto pedine, appoggiate vicino alla costa di volta in
// volta: una citta' di mare cresce sul mare, e solo cosi' si vede se il
// tessuto finisce davvero sulla spiaggia invece di fermarsi a meta' foglio.
// (r,c) qui sono relativi all'angolo alto-sinistro del gruppo.
const CITTA = [[0,1,'municipio'],[0,3,'piazza'],[1,2,'mercato'],[1,4,'chiesa'],
               [2,1,'teatro'],[2,4,'giardino'],[3,2,'stazione'],[3,4,'biblioteca']];
const citta = (dr, dc, sostituzioni = {}) =>
  CITTA.map(([r, c, cat]) => [r + dr, c + dc, sostituzioni[cat] || cat]);

const scenari = [
  { nome: 'costa-nord',        atteso: 'mare',  grid: board(riga(0), [], [], citta(1, 2)) },
  { nome: 'costa-est',         atteso: 'mare',  grid: board(colonna(7), [], [], citta(2, 2)) },
  { nome: 'costa-sud',         atteso: 'mare',  grid: board(riga(7), [], [], citta(3, 2)) },
  { nome: 'costa-sud-parziale',atteso: 'mare',  grid: board([[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]], [], [], citta(3, 2)) },
  { nome: 'mare-profondo',     atteso: 'mare',  grid: board([...riga(0), ...riga(1)], [], [], citta(2, 2)) },
  // il porto vuole l'acqua a portata di mano: nearWaterCell in main.js
  // scarta la pedina se dista piu' di 1.8 caselle dal blu.
  { nome: 'costa-ovest-porto', atteso: 'mare',  grid: board(colonna(0), [], [],
      [[2,1,'porto'],[2,3,'piazza'],[3,2,'mercato'],[3,4,'chiesa'],[4,1,'teatro'],[4,4,'giardino'],[5,2,'stazione'],[5,4,'biblioteca']]) },
  { nome: 'citta-lontana',     atteso: 'mare',  grid: board(riga(0), [], [], citta(4, 2)) },
  { nome: 'costa-e-rilievi',   atteso: 'mare',  grid: board(riga(0), [[6,0],[7,0],[7,1]], [[6,7],[7,7]], citta(1, 2)) },
  { nome: 'costa-e-fiume',     atteso: 'mare',  grid: board([...riga(0), [1,3],[2,3],[3,3],[4,3],[5,4],[6,4],[7,4]], [], [],
      [[1,1,'municipio'],[2,1,'piazza'],[3,1,'mercato'],[1,5,'chiesa'],[2,6,'teatro'],[4,6,'giardino'],[5,2,'stazione'],[6,6,'biblioteca']]) },
  // controlli: il mare severo non deve rubare fiumi e laghi
  { nome: 'delta-diagonale',   atteso: 'mare',  grid: board(
      [...riga(0), [1,2],[2,3],[3,3],[4,4],[5,4],[6,5],[7,5]], [], [],
      [[1,0,'municipio'],[2,1,'piazza'],[3,1,'mercato'],[1,5,'chiesa'],[3,6,'teatro'],[5,6,'giardino'],[4,2,'stazione'],[6,7,'biblioteca']]) },
  { nome: 'delta-est',         atteso: 'mare',  grid: board(
      [...colonna(7), [3,6],[3,5],[4,4],[4,3],[4,2],[5,1],[5,0]], [], [],
      [[1,3,'municipio'],[2,4,'piazza'],[1,5,'mercato'],[2,2,'chiesa'],[6,3,'teatro'],[6,5,'giardino'],[5,4,'stazione'],[6,1,'biblioteca']]) },
  // --- coste irregolari: e' qui che si vede se il profilo funziona ---
  { nome: 'due-file',          atteso: 'mare',  grid: board([...riga(0), ...riga(1)], [], [], citta(2, 2)) },
  { nome: 'file-zigrinate',    atteso: 'mare',  grid: board([...riga(0), [1,0],[1,1],[1,4],[1,5],[1,6]], [], [], citta(2, 2)) },
  { nome: 'baia-profonda',     atteso: 'mare',  grid: board([...riga(0), [1,2],[1,3],[1,4],[2,3]], [], [], citta(3, 2)) },
  // --- stress: nessuno mette le pedine in fila perfetta ---
  { nome: 'fila-col-buco',     atteso: 'mare',  grid: board(riga(0).filter(([, c]) => c !== 3), [], [], citta(1, 2)) },
  { nome: 'fila-due-buchi',    atteso: 'mare',  grid: board(riga(0).filter(([, c]) => c !== 2 && c !== 5), [], [], citta(1, 2)) },
  { nome: 'fila-e-sparsi',     atteso: 'mare',  grid: board([...riga(0), [3,1],[5,6],[6,3]], [], [], citta(1, 2)) },
  { nome: 'fila-sbrindellata', atteso: 'mare',  grid: board([[0,0],[0,1],[0,2],[0,3],[0,4],[1,1],[1,4],[1,5],[0,6],[2,5],[3,7]], [], [], citta(3, 1)) },
  { nome: 'due-lati',          atteso: 'mare',  grid: board([...riga(0), ...colonna(0)], [], [], citta(2, 3)) },
  // --- isola: il mare tutto intorno esce dalla lista di coste, senza
  //     una riga di codice dedicata ---
  { nome: 'isola',             atteso: 'mare',  grid: board(
      [...riga(0), ...riga(7), ...colonna(0), ...colonna(7)], [], [], citta(2, 2)) },
  { nome: 'isola-frastagliata',atteso: 'mare',  grid: board(
      [...riga(0), ...riga(7), ...colonna(0), ...colonna(7), [1,1],[1,5],[6,2],[2,6],[6,6]], [], [], citta(2, 2)) },
  // --- controlli: la regola nuova non deve rubare fiumi, laghi, e non
  //     deve promuovere a mare quattro caselle in croce sul bordo ---
  { nome: 'controllo-fiume',   atteso: 'fiume', grid: board(colonna(3), [], [], citta(2, 3)) },
  { nome: 'controllo-lago',    atteso: 'lago',  grid: board([[3,3],[3,4],[4,3],[4,4]], [], [],
      [[2,2,'municipio'],[2,5,'piazza'],[3,2,'mercato'],[3,6,'chiesa'],[5,2,'teatro'],[5,5,'giardino'],[6,3,'stazione'],[4,6,'biblioteca']]) },
  { nome: 'controllo-fila-corta', atteso: 'laghetto', grid: board([[0,1],[0,2],[0,3]], [], [], citta(2, 2)) },
];

/* ---------------- la scacchiera, disegnata accanto alla carta ---------------- */
const marchio = {
  municipio:'M', piazza:'P', mercato:'MR', chiesa:'C', teatro:'T', giardino:'G',
  stazione:'S', porto:'PR', biblioteca:'B', cimitero:'CM', torre:'TR', locale:'L', fontana:'F',
};
const esc = v => String(v).replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;' }[ch]));
function boardSvg(grid, x, y, size = 416) {
  const gap = 3, cell = (size - gap * 9) / 8;
  let out = `<g transform="translate(${x} ${y})"><rect width="${size}" height="${size}" rx="6" fill="#4a3d30"/>`;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const px = gap + c * (cell + gap), py = gap + r * (cell + gap), v = grid[r][c];
    let fill = (r + c) % 2 ? '#c3b088' : '#cdbd97';
    if (v && v.kind === 'terrain') fill = { water:'#3b6f86', mountain:'#7a5a3a', hill:'#6f8a4a' }[v.terrain] || fill;
    out += `<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${cell.toFixed(1)}" height="${cell.toFixed(1)}" rx="2" fill="${fill}"/>`;
    if (v && v.kind === 'place') {
      const cx = px + cell / 2, cy = py + cell / 2, mk = marchio[v.cat] || '?';
      out += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(cell*.32).toFixed(1)}" fill="#211c17" stroke="#f2ecdb" stroke-width="1.2"/>`;
      out += `<text x="${cx.toFixed(1)}" y="${(cy+4).toFixed(1)}" fill="#fff" font-size="${mk.length>1?9:13}" font-family="system-ui,sans-serif" font-weight="700" text-anchor="middle">${esc(mk)}</text>`;
    }
  }
  return out + '</g>';
}
function pagina(svg, grid, titolo, riga2) {
  const m = svg.match(/^<svg[^>]*>([\s\S]*)<\/svg>\s*$/);
  if (!m) throw new Error('SVG della mappa non riconosciuto');
  const W = 1100, panel = 480, b = 416, bx = W + (panel - b) / 2;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W + panel}" height="${W}" viewBox="0 0 ${W + panel} ${W}">
  <rect width="${W + panel}" height="${W}" fill="#1b1611"/>
  <svg x="0" y="0" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}" overflow="hidden">${m[1]}</svg>
  ${boardSvg(grid, bx, 150, b)}
  <text x="${bx}" y="80" fill="#e9ddc6" font-size="26" font-family="system-ui,sans-serif" font-weight="700">${esc(titolo)}</text>
  <text x="${bx}" y="112" fill="#a8977a" font-size="14" font-family="system-ui,sans-serif">${esc(riga2)}</text>
  <text x="${bx}" y="${150 + b + 34}" fill="#a8977a" font-size="13" font-family="system-ui,sans-serif">costa ±${PARAMS.SEA_WAVE_LONG}/${PARAMS.SEA_WAVE}px · spiaggia ${PARAMS.SEA_BEACH}px · frangia ${PARAMS.FRANGIA}px · fila minima ${PARAMS.SEA_MIN_RUN}</text>
</svg>`;
}

/* ---------------- PNG con il browser gia' installato ---------------- */
function trovaBrowser() {
  const candidati = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidati.find(p => fs.existsSync(p)) || null;
}
function png(svgFile, pngFile, w, h, browser) {
  const html = svgFile.replace(/\.svg$/, '.html');
  fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#1b1611}svg{display:block}</style>${fs.readFileSync(svgFile, 'utf8').replace(/^<\?xml[^>]*\?>\s*/, '')}`);
  execFileSync(browser, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${w},${h}`, `--screenshot=${pngFile}`, `file:///${html.replace(/\\/g, '/')}`,
  ], { stdio: 'ignore', timeout: 120000 });
  fs.unlinkSync(html);
}

/* ---------------- via ---------------- */
const filtro = process.argv[2];
const scelti = filtro ? scenari.filter(s => s.nome.includes(filtro)) : scenari;
fs.mkdirSync(OUT, { recursive: true });
const browser = process.env.SENZA_PNG ? null : trovaBrowser();
if (!browser && !process.env.SENZA_PNG) console.log('nessun Chrome/Edge trovato: scrivo solo gli SVG');

const problemi = [];
scelti.forEach(sc => {
  const i = scenari.indexOf(sc); // il numero del file non cambia col filtro
  // che cosa ha deciso il classificatore, prima ancora di generare
  const acqua = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++)
    if (sc.grid[r][c] && sc.grid[r][c].kind === 'terrain' && sc.grid[r][c].terrain === 'water') acqua.push([r, c]);
  // le coste si leggono su tutta l'acqua insieme, come fa main.js: una
  // fila con un buco sono due componenti connesse ma una costa sola.
  const lati = acqua.length ? (api.seaSides(acqua) || []) : [];
  const coste = lati.map(s => s.side);
  const parti = acqua.length ? compsLocali(acqua) : [];
  const classi = [...new Set(parti.map(cells =>
    lati.length && cells.filter(([r, c]) => api.seaCellIn(lati, r, c)).length * 2 >= cells.length
      ? 'mare' : api.classWater(cells)))];

  api.setGrid(sc.grid);
  api.generate();
  const svg = api.svg(), d = api.diagnostics();
  const nome = `${String(i + 1).padStart(2, '0')}-${sc.nome}`;
  const svgFile = path.join(OUT, `${nome}.svg`);
  const forma = coste.length === 4 ? 'isola' : coste.length ? `coste: ${coste.join('+')}` : 'nessuna costa';
  const riga2 = `${classi.join(', ') || 'niente acqua'} · ${forma} · ${d ? d.buildings + ' edifici · ' + d.streets + ' strade' : 'nessuna carta'}`;
  fs.writeFileSync(svgFile, pagina(svg, sc.grid, sc.nome, riga2));
  if (browser) png(svgFile, path.join(OUT, `${nome}.png`), 1580, 1100, browser);

  const ok = classi.includes(sc.atteso);
  if (!ok) problemi.push(`${sc.nome}: atteso "${sc.atteso}", ottenuto "${classi.join(', ')}"`);
  if (d) {
    if (d.components > 1) problemi.push(`${sc.nome}: rete stradale in ${d.components} pezzi`);
    if (d.anchorsUnresolved) problemi.push(`${sc.nome}: ${d.anchorsUnresolved} pedine senza posto`);
    if (d.roadWaterViolations) problemi.push(`${sc.nome}: ${d.roadWaterViolations} strade guadano il fiume`);
    if (d.landmarksBound < d.landmarksTotal) problemi.push(`${sc.nome}: ${d.landmarksTotal - d.landmarksBound} luoghi non agganciati al tessuto`);
    // le pedine scartate o non comparse le racconta gia' la riga di stato
    // del generatore: landmarksTotal non conta le ancore (piazza, giardino,
    // cimitero) e da solo non basta a saperlo.
    const stato = api.status();
    if (/ignorate|non ha trovato posto|non hanno trovato posto/.test(stato))
      problemi.push(`${sc.nome}: ${stato.split(' · ').filter(p => /ignorate|trovato posto/.test(p)).join('; ')}`);
  }
  console.log(`${ok ? '  ok' : ' !! '} ${nome.padEnd(26)} ${riga2}`);
});

// stesse componenti connesse a 8 direzioni di world.js, ma qui fuori: allo
// scenario serve sapere le classi PRIMA di chiamare generate().
function compsLocali(cells) {
  const key = ([r, c]) => r * 8 + c;
  const set = new Set(cells.map(key)), visti = new Set(), out = [];
  const NB = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  for (const k of set) {
    if (visti.has(k)) continue;
    const q = [k], gruppo = []; visti.add(k);
    while (q.length) {
      const cur = q.pop(), r = (cur / 8) | 0, c = cur % 8;
      gruppo.push([r, c]);
      for (const [dr, dc] of NB) {
        const nr = r + dr, nc = c + dc, nk = nr * 8 + nc;
        if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && set.has(nk) && !visti.has(nk)) { visti.add(nk); q.push(nk); }
      }
    }
    out.push(gruppo);
  }
  return out;
}

/* ---------------- la galleria: tutte le carte in una pagina sola ---------------- */
// Ogni carta entra come <img> con l'SVG in data URI, non inline: gli SVG del
// generatore usano tutti gli stessi id (#cityClip, #onde, i tracciati dei
// nomi via) e messi nello stesso documento si ruberebbero i pattern a
// vicenda.
if (!process.env.SENZA_GALLERIA) {
  const carte = fs.readdirSync(OUT).filter(f => f.endsWith('.svg')).sort().map(f => ({
    nome: f.replace(/^\d+-/, '').replace(/\.svg$/, ''),
    uri: 'data:image/svg+xml;base64,' + Buffer.from(
      fs.readFileSync(path.join(OUT, f), 'utf8').replace(/^<\?xml[^>]*\?>\s*/, ''), 'utf8').toString('base64'),
  }));
  const pagina = `<!doctype html><meta charset="utf-8"><title>ASMA — il mare, scenario per scenario</title><style>
  body{margin:0;background:#211c17;color:#e9ddc6;font:16px/1.6 Georgia,serif}
  .wrap{max-width:1240px;margin:0 auto;padding:38px 24px 80px;display:flex;flex-direction:column;gap:30px}
  h1{font:700 42px system-ui,sans-serif;margin:0;letter-spacing:-.5px}
  p.sub{color:#a8977a;max-width:62ch;margin:10px 0 0}
  figure{margin:0;display:flex;flex-direction:column;gap:10px}
  img{display:block;width:100%;height:auto;border:1px solid #4a3d30;border-radius:6px}
  figcaption{font:600 15px system-ui,sans-serif;letter-spacing:.3px}
  code{font-family:ui-monospace,Consolas,monospace;font-size:13px;color:#c98a4b}
  </style><div class="wrap"><h1>Il mare, scenario per scenario</h1>
  <p class="sub">Le stesse carte che controlla <code>npm run mare</code>: ogni scacchiera sta accanto alla carta che ha prodotto.</p>
  ${carte.map((c, i) => `<figure><img src="${c.uri}" alt="carta ${esc(c.nome)}"><figcaption>${String(i + 1).padStart(2, '0')} &middot; ${esc(c.nome)}</figcaption></figure>`).join('')}
  </div>`;
  fs.writeFileSync(path.join(OUT, 'galleria.html'), pagina);
  console.log(`GALLERIA=${path.join(OUT, 'galleria.html')}`);
}

console.log(`\n${scelti.length} carte in ${OUT}`);
if (problemi.length) { console.log('\nda guardare:\n' + problemi.map(p => '  · ' + p).join('\n')); process.exitCode = 1; }
