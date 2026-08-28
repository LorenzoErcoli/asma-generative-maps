/* =====================================================================
   Dice in chiaro perche' la rilettura AI non parte.

       npm run diagnosi

   Nasce da un caso reale: sul Mac il messaggio era "OPENAI_API_KEY non
   configurata", la chiave c'era, nel file giusto, e non si capiva. Erano
   due trappole sovrapposte — un .env rimasto col segnaposto che copriva
   .env.local, e i file letti una sola volta all'avvio. Entrambe sono
   state corrette, ma il modo per VEDERE cosa sta succedendo mancava.

   Non stampa mai la chiave: solo le prime e le ultime lettere.
   ===================================================================== */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const ok = t => `  [ok]  ${t}`;
const ko = t => `  [!!]  ${t}`;
const info = t => `        ${t}`;

console.log('\n=== Chiave OpenAI ===\n');

function leggiChiave(file) {
  const p = join(ROOT, file);
  if (!existsSync(p)) return null;
  const m = readFileSync(p, 'utf8').match(/^\s*OPENAI_API_KEY\s*=\s*(.+?)\s*$/m);
  return m ? m[1].replace(/^["']|["']$/g, '') : '';
}
const maschera = k => k.length < 14 ? '(troppo corta)' : `${k.slice(0, 10)}…${k.slice(-4)}  (${k.length} caratteri)`;
const valida = k => /^sk-[A-Za-z0-9_.-]{20,}$/.test(k.replace(/^Bearer\s+/i, '')) && !/^sk-inserisci/i.test(k);

// .env.local vince su .env: e' la precedenza che usa ai-server.mjs.
let effettiva = null, origine = null;
for (const file of ['.env', '.env.local']) {
  const k = leggiChiave(file);
  if (k === null) { console.log(info(`${file} — non esiste`)); continue; }
  if (k === '') { console.log(info(`${file} — c'e', ma senza riga OPENAI_API_KEY`)); continue; }
  const buona = valida(k);
  console.log((buona ? ok : ko)(`${file} — ${/^sk-inserisci/i.test(k) ? 'e ancora il SEGNAPOSTO di esempio' : maschera(k)}`));
  effettiva = k; origine = file;   // l'ultimo letto vince, come nel server
}
if (process.env.OPENAI_API_KEY) {
  console.log(info(`(nel terminale c'e' anche OPENAI_API_KEY: ${maschera(process.env.OPENAI_API_KEY)})`));
}
console.log('');
if (!effettiva) console.log(ko('Nessuna chiave. Scrivila in .env.local:  OPENAI_API_KEY=sk-...'));
else if (!valida(effettiva)) console.log(ko(`La chiave che vince viene da ${origine} e non e utilizzabile. Correggila li.`));
else console.log(ok(`Il server userebbe la chiave di ${origine}.`));

console.log('\n=== Server ===\n');

const PORT_SCANNER = Number(process.env.SCANNER_PORT || 8765);
const PORT_CARTE = Number(process.env.PORT || 8123);

function chiedi(porta, percorso) {
  return new Promise(r => {
    const req = httpGet({ host: '127.0.0.1', port: porta, path: percorso, timeout: 2500 }, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => r({ status: res.statusCode, body: b.slice(0, 300) }));
    });
    req.on('error', e => r({ errore: e.code }));
    req.on('timeout', () => { req.destroy(); r({ errore: 'TIMEOUT' }); });
  });
}

// Con HTTPS configurato, l'HTTP rimanda subito a https:// e non si vede mai
// la risposta vera. Se il certificato c'e', si chiede direttamente li' —
// e' quello lo stato che interessa leggere.
const PORT_HTTPS = Number(process.env.HTTPS_PORT || 8766);
function chiediHttps(percorso) {
  const cer = join(ROOT, 'certs', 'asma-local-ca.cer');
  if (!existsSync(cer)) return Promise.resolve(null);
  const pem = spawnSync('openssl', ['x509', '-inform', 'DER', '-in', cer]);
  const ca = pem.status === 0 ? pem.stdout : undefined;
  return new Promise(r => {
    const req = httpsGet({ host: 'localhost', port: PORT_HTTPS, path: percorso, ca,
      servername: 'localhost', rejectUnauthorized: !!ca, timeout: 2500 }, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => r({ status: res.statusCode, body: b.slice(0, 300) }));
    });
    req.on('error', e => r({ errore: e.code }));
    req.on('timeout', () => { req.destroy(); r({ errore: 'TIMEOUT' }); });
  });
}

const scanner = await chiedi(PORT_SCANNER, '/api/ai/status');
if (scanner.errore === 'ECONNREFUSED') {
  console.log(ko(`Scanner spento sulla porta ${PORT_SCANNER}. Avvialo:  npm run scanner`));
} else if (scanner.errore) {
  console.log(ko(`Scanner sulla porta ${PORT_SCANNER}: ${scanner.errore}`));
} else if (scanner.status === 307) {
  console.log(ok(`Scanner acceso sulla porta ${PORT_SCANNER} (rimanda a HTTPS, e corretto).`));
  const sicuro = await chiediHttps('/api/ai/status');
  if (sicuro && sicuro.body) console.log(ok(`Stato AI (HTTPS ${PORT_HTTPS}): ${sicuro.body}`));
  else if (sicuro && sicuro.errore) console.log(ko(`HTTPS sulla porta ${PORT_HTTPS}: ${sicuro.errore}`));
} else {
  console.log(ok(`Scanner acceso sulla porta ${PORT_SCANNER} — /api/ai/status: ${scanner.body}`));
}

const carte = await chiedi(PORT_CARTE, '/api/ai/status');
if (carte.errore === 'ECONNREFUSED') console.log(info(`Generatore spento sulla porta ${PORT_CARTE} (serve solo per la console).`));
else if (carte.errore) console.log(ko(`Generatore sulla porta ${PORT_CARTE}: ${carte.errore}`));
else if (carte.status === 502) console.log(ko(`Il generatore c'e ma non raggiunge lo scanner: ${carte.body}`));
else if (carte.status === 307) console.log(ok('Il generatore inoltra allo scanner (che rimanda a HTTPS, e corretto).'));
else console.log(ok(`Il generatore inoltra allo scanner — risposta: ${carte.body}`));

const ip = Object.values(networkInterfaces()).flat()
  .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
console.log('\n=== Indirizzi ===\n');
console.log(info(`Console:  http://localhost:${PORT_CARTE}`));
console.log(info(`Scanner:  http://localhost:${PORT_SCANNER}/scanner.html`));
for (const a of ip) console.log(info(`Da altri dispositivi: http://${a}:${PORT_SCANNER}/scanner.html`));
console.log('');
