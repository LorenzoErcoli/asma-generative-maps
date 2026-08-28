/* =====================================================================
   Genera assets/pedine-A4.pdf da pedine.html.

   La scheda vive come pagina HTML perche' si costruisce dalle tabelle vere
   (js/pedine.js) e quindi non puo' andare fuori sincrono col programma. Ma
   un PDF serve lo stesso: e' il file che si manda a qualcuno, si porta in
   copisteria o si stampa senza aprire il progetto.

   Percio' il PDF e' un PRODOTTO, non una sorgente: si rifa da qui ogni
   volta che cambia un abbinamento fra pedina e luogo.

   USO
       npm run pedine-pdf

   Usa Chrome o Edge in modalita' headless — uno dei due c'e' su
   praticamente ogni computer. Se non li trova lo dice, e resta comunque la
   strada manuale: aprire pedine.html e stampare scegliendo "Salva come PDF".
   ===================================================================== */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SORGENTE = join(ROOT, 'pedine.html');
const USCITA = join(ROOT, 'assets', 'pedine-A4.pdf');

// Percorsi tipici, in ordine di preferenza. Su macOS e Linux si prova anche
// il PATH, dove i browser installati da pacchetto mettono un collegamento.
const CANDIDATI = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  win32: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'],
};

function trovaBrowser() {
  for (const p of CANDIDATI[process.platform] || []) if (existsSync(p)) return p;
  // ultimo tentativo: un eseguibile nel PATH
  for (const nome of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']) {
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [nome], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim().split(/\r?\n/)[0];
  }
  return null;
}

const browser = trovaBrowser();
if (!browser) {
  console.error('\nNon ho trovato Chrome ne Edge, che servono per creare il PDF.');
  console.error('Puoi farlo a mano in dieci secondi:');
  console.error('  1. apri  pedine.html  nel browser (o http://localhost:8123/pedine.html)');
  console.error('  2. Stampa, e come destinazione scegli "Salva come PDF"');
  console.error(`  3. salvalo in  ${USCITA}\n`);
  process.exit(1);
}
console.log(`Browser usato: ${browser}`);

// file:// invece del server: la scheda carica i suoi script con percorsi
// relativi, che da file:// funzionano — cosi' non serve avere niente acceso.
const r = spawnSync(browser, [
  '--headless', '--disable-gpu', '--no-pdf-header-footer',
  `--print-to-pdf=${USCITA}`,
  '--virtual-time-budget=15000',
  pathToFileURL(SORGENTE).href,
], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });

if (!existsSync(USCITA)) {
  console.error('\nIl PDF non e stato creato.');
  if (r.stderr) console.error(r.stderr.trim().split('\n').slice(-4).join('\n'));
  process.exit(1);
}
const kb = (statSync(USCITA).size / 1024).toFixed(0);
console.log(`Creato: ${USCITA}  (${kb} KB)`);
console.log('Ricordati di rifarlo se cambia un abbinamento fra pedina e luogo.');
