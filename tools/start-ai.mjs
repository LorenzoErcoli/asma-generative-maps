/* =====================================================================
   Avvia lo scanner (camera + eventuale revisione AI) — Windows, macOS, Linux.

   Sostituisce start-ai.ps1, che restava legato a PowerShell. Fa tre cose
   prima di passare la mano ad ai-server.mjs:
     1. avvisa se il terminale ha ereditato un proxy che blocca tutto;
     2. prepara .env.local dal modello, se manca;
     3. prova a generare il certificato HTTPS, se non c'e'.

   Differenza voluta rispetto a start-ai.ps1: qui NIENTE e' fatale. Quello
   script si fermava se mancava la chiave OpenAI, ma lo scanner funziona
   benissimo senza AI — la chiave serve solo alla rilettura assistita. Un
   avviso e si prosegue: chi riceve il progetto deve poterlo vedere girare
   prima di procurarsi una chiave a pagamento.
   ===================================================================== */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, copyFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const line = () => console.log('-'.repeat(64));

/* 1. proxy bloccante ------------------------------------------------- */
// 127.0.0.1:9 e' il "discard port": alcune configurazioni aziendali lo
// impostano come proxy per tagliare fuori la rete. Ereditato dal terminale,
// impedisce le chiamate all'AI senza dire perche'.
const blocked = [process.env.HTTPS_PROXY, process.env.ALL_PROXY, process.env.HTTP_PROXY]
  .find(v => v && /^https?:\/\/(127\.0\.0\.1|localhost):9\/?$/.test(v));
if (blocked) {
  line();
  console.warn(`Questo terminale ha un proxy che blocca tutto: ${blocked}`);
  console.warn('Lo scanner funziona lo stesso; la revisione AI no.');
  console.warn('Per toglierlo, apri un terminale nuovo senza quella variabile.');
  line();
}

/* 2. .env.local ------------------------------------------------------ */
const envLocal = join(ROOT, '.env.local');
if (!existsSync(envLocal)) {
  copyFileSync(join(ROOT, '.env.example'), envLocal);
  console.log('Creato .env.local dal modello .env.example (e escluso da Git).');
}
// Il segnaposto di .env.example ("sk-inserisci-qui-la-chiave") ha la forma di
// una chiave vera: senza escluderlo il controllo passa e si annuncia un'AI
// che non potra' mai rispondere.
const keyLine = readFileSync(envLocal, 'utf8').match(/^\s*OPENAI_API_KEY\s*=\s*(\S+)\s*$/m);
const hasKey = !!keyLine && /^sk-[A-Za-z0-9_.-]{20,}$/.test(keyLine[1]) && !/^sk-inserisci/i.test(keyLine[1]);
if (!hasKey) {
  console.log('');
  console.log('Nessuna chiave OpenAI configurata: la rilettura AI resta spenta.');
  console.log('Tutto il resto — camera, riconoscimento pedine, invio alla mappa — funziona.');
  console.log(`Per accenderla, scrivi  OPENAI_API_KEY=sk-...  dentro  ${envLocal}`);
  console.log('');
}

/* 3. certificato HTTPS ----------------------------------------------- */
// Serve solo per usare la camera da iPad o telefono. Se non si riesce a
// generarlo (manca openssl, manca PowerShell...) non e' un motivo per non
// partire: da questo stesso computer http://localhost e' gia' un contesto
// sicuro e la camera funziona.
if (!existsSync(join(ROOT, 'certs', 'asma-local.pfx'))) {
  console.log('Certificato HTTPS assente, provo a generarlo (serve solo per iPad/telefono)...');
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'setup-https.mjs')], { stdio: 'inherit' });
  if (r.status !== 0) {
    line();
    console.warn('Non sono riuscito a generare il certificato: si prosegue in HTTP.');
    console.warn('Dallo stesso computer la camera funziona comunque su http://localhost.');
    console.warn('Per usarla da un iPad, risolvi prima:  npm run setup-https');
    line();
  }
}

/* 4. via -------------------------------------------------------------- */
const child = spawn(process.execPath, [join(ROOT, 'ai-server.mjs')], { stdio: 'inherit' });
child.on('exit', code => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
