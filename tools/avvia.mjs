/* =====================================================================
   Avvio "tutto in uno": un doppio clic e il progetto e' in piedi.

   Lo lanciano i due file cliccabili nella cartella principale:
     Avvia ASMA.command   (macOS)
     Avvia ASMA.bat       (Windows)

   Fa in ordine quello che altrimenti andrebbe fatto a mano:
     1. controlla la versione di Node;
     2. crea il certificato HTTPS se manca (serve solo per iPad/telefono);
     3. avvia i due server — il generatore di carte e lo scanner;
     4. apre il browser sul generatore;
     5. resta in ascolto finche' non si chiude la finestra.

   Regola di fondo: nessun passaggio facoltativo puo' impedire l'avvio. Il
   certificato non si genera? Si prosegue in HTTP, che da questo computer
   basta. Manca la chiave AI? Si prosegue senza rilettura assistita. L'unica
   cosa davvero indispensabile e' Node.
   ===================================================================== */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, copyFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const GEN_PORT = Number(process.env.PORT || 8123);
const SCAN_PORT = Number(process.env.SCANNER_PORT || 8765);

const B = s => `\x1b[1m${s}\x1b[0m`;
const rule = () => console.log('='.repeat(62));

rule();
console.log(B('  ASMA — generatore di carte'));
rule();

/* 1. Node abbastanza recente ----------------------------------------- */
const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.error(`\nQuesto progetto richiede Node 18 o superiore; qui c'e' la ${process.versions.node}.`);
  console.error('Scarica la versione LTS da https://nodejs.org e riprova.\n');
  await attendiTasto();
  process.exit(1);
}

/* 2. certificato, se manca ------------------------------------------- */
if (!existsSync(join(ROOT, 'certs', 'asma-local.pfx'))) {
  console.log('\nPreparo il certificato per la camera da iPad (una volta sola)...');
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'setup-https.mjs')],
    { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  if (r.status === 0) {
    console.log('Certificato pronto.');
  } else {
    console.log('Certificato non creato: si prosegue senza.');
    console.log('La camera funziona lo stesso da questo computer; da iPad no.');
  }
}

/* 3. il file della chiave AI ------------------------------------------ */
// Va creato anche se resta vuoto: e' il posto dove va incollata la chiave, e
// se non esiste chi deve metterla non sa dove. Resta fuori da Git.
const envLocal = join(ROOT, '.env.local');
if (!existsSync(envLocal)) copyFileSync(join(ROOT, '.env.example'), envLocal);
const chiaveConfigurata = (() => {
  const m = readFileSync(envLocal, 'utf8').match(/^\s*OPENAI_API_KEY\s*=\s*(\S+)\s*$/m);
  return !!m && /^sk-[A-Za-z0-9_.-]{20,}$/.test(m[1]) && !/^sk-inserisci/i.test(m[1]);
})();

/* 4. i due server ----------------------------------------------------- */
// Sono due processi separati e restano tali: il generatore serve solo la
// pagina delle carte, lo scanner ha bisogno di ascoltare anche sulla rete
// locale per l'iPad. Tenerli distinti significa che se uno cade l'altro
// continua a funzionare.
const processi = [];
function avvia(nome, file, colore) {
  const p = spawn(process.execPath, [join(ROOT, file)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const scrivi = testo => String(testo).split(/\r?\n/).filter(Boolean)
    .forEach(l => console.log(`\x1b[${colore}m${nome}\x1b[0m  ${l}`));
  p.stdout.on('data', scrivi);
  p.stderr.on('data', scrivi);
  p.on('exit', code => { if (code) console.log(`\x1b[${colore}m${nome}\x1b[0m  terminato (codice ${code})`); });
  processi.push(p);
  return p;
}

console.log('');
avvia('carte  ', 'serve.js', '36');
avvia('scanner', 'ai-server.mjs', '35');

/* 5. browser ---------------------------------------------------------- */
const indirizzo = `http://localhost:${GEN_PORT}`;
setTimeout(() => {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [indirizzo]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', indirizzo]]
    : ['xdg-open', [indirizzo]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch { /* si apre a mano */ }

  const lan = Object.values(networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('');
  rule();
  console.log(`  Generatore di carte : ${B(indirizzo)}`);
  console.log(`  Scanner (camera)    : http://localhost:${SCAN_PORT}/scanner.html`);
  if (lan.length) console.log(`  Dall'iPad           : http://${lan[0]}:${SCAN_PORT}/scanner.html`);
  console.log('');
  if (!chiaveConfigurata) {
    console.log('  Rilettura AI: spenta (facoltativa, e a pagamento).');
    console.log(`  La chiave va scritta in: ${envLocal}`);
    console.log('  alla riga  OPENAI_API_KEY=sk-...  poi si riavvia.');
    console.log('');
  }
  console.log('  Se il browser non si apre da solo, copia il primo indirizzo.');
  console.log('  Per fermare tutto: chiudi questa finestra, o premi Ctrl+C.');
  rule();
}, 1200);

/* 6. chiusura pulita --------------------------------------------------- */
let chiuso = false;
function chiudi() {
  if (chiuso) return;
  chiuso = true;
  for (const p of processi) { try { p.kill(); } catch { /* gia' morto */ } }
  process.exit(0);
}
for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, chiudi);

function attendiTasto() {
  // Su un doppio clic la finestra si chiude subito e il messaggio d'errore
  // sparisce prima di poterlo leggere: qui si aspetta un invio.
  return new Promise(r => {
    console.log('Premi Invio per chiudere.');
    process.stdin.resume();
    process.stdin.once('data', () => r());
    setTimeout(r, 60000);
  });
}
