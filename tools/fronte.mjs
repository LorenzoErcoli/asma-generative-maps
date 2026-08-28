/* =====================================================================
   Rigenera assets/fronte.jpg dal PDF, su qualunque macchina.

   Il lavoro vero lo fa render-fronte.py (serve una libreria che sappia
   rasterizzare un PDF, e in Node non ce n'e' una senza dipendenze). Questo
   file esiste solo per trovarci l'interprete giusto: "npm run fronte"
   lanciava `python`, che su Windows c'e' e su macOS NO — li' esiste solo
   `python3`, e il comando moriva con "sh: python: command not found"
   proprio a chi stava per ristampare il fronte.

   Si provano in ordine python3, py -3 (il launcher di Windows) e python,
   scartando chi risponde Python 2. Se non c'e' nessun interprete, o se
   mancano le librerie, si dice cosa installare con il comando esatto per
   QUELL'interprete, invece di lasciare l'errore grezzo di sh.
   ===================================================================== */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'tools', 'render-fronte.py');

// gli argomenti passati a npm arrivano qui: `npm run fronte -- --dpi 200`
const args = process.argv.slice(2);

const candidati = [
  { cmd: 'python3', pre: [] },
  { cmd: 'py', pre: ['-3'] },      // il launcher di Windows, quando python3 non e' nel PATH
  { cmd: 'python', pre: [] },      // ultima spiaggia: su macOS spesso e' Python 2, o non c'e'
];

function versione(candidato) {
  const r = spawnSync(candidato.cmd, [...candidato.pre, '--version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  const testo = `${r.stdout || ''}${r.stderr || ''}`.trim();
  const m = testo.match(/Python (\d+)\.(\d+)/);
  return m && Number(m[1]) >= 3 ? { ...candidato, testo, major: Number(m[1]) } : null;
}

const python = candidati.map(versione).find(Boolean);
if (!python) {
  console.error(`
Per rigenerare il fronte serve Python 3, e su questa macchina non lo trovo.

  macOS    brew install python
           (oppure l'installer da python.org)
  Windows  installer da python.org, spuntando "Add python.exe to PATH"
  Linux    sudo apt install python3 python3-pip

Il PDF resta comunque quello buono: assets/fronte.pdf. Questo comando serve
solo a rifare l'immagine che finisce in stampa (assets/fronte.jpg).
`.trim());
  process.exit(1);
}

const run = spawnSync(python.cmd, [...python.pre, SCRIPT, ...args], { stdio: 'inherit' });
if (run.status !== 0) {
  console.error(`\nFallito con ${python.testo}. Se la libreria manca, e' questo il comando:`);
  console.error(`  ${[python.cmd, ...python.pre].join(' ')} -m pip install pymupdf`);
}
process.exit(run.status ?? 1);
