/* =====================================================================
   Crea lo zip da consegnare a qualcun altro.

       npm run pacchetto

   Usa "git archive", che impacchetta SOLO i file tracciati: chiave OpenAI,
   .env.local e i certificati — tutti ignorati da Git — restano fuori da
   soli, senza doversene ricordare. Conserva anche il permesso di
   esecuzione di "Avvia ASMA.command", che uno zip fatto a mano su Windows
   perderebbe, lasciando il doppio clic inerte sul Mac.
   ===================================================================== */
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const USCITA = join(ROOT, 'ASMA.zip');

const r = spawnSync('git', ['archive', '--format=zip', '-9', '--prefix=ASMA/', '-o', USCITA, 'HEAD'],
  { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
if (r.status !== 0) {
  console.error('\ngit archive non e riuscito. Serve Git, e almeno un commit.');
  process.exit(1);
}
console.log(`\nPacchetto pronto: ${USCITA}  (${(statSync(USCITA).size / 1024 / 1024).toFixed(1)} MB)`);
console.log('Contiene solo cio che e committato: niente chiavi, niente certificati.');
console.log('Su Mac: scompattare e fare doppio clic su "Avvia ASMA.command".');
console.log('La prima volta serve clic destro > Apri, per via di Gatekeeper.');
