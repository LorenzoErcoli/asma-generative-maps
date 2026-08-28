/* =====================================================================
   Certificato HTTPS locale — Windows, macOS e Linux.

   Serve SOLO per usare la camera da un iPad o da un telefono: il browser
   concede l'accesso alla fotocamera unicamente in "contesto sicuro", cioe'
   su https:// oppure su http://localhost. Sulla stessa macchina localhost
   basta e questo script non serve; da un altro dispositivo l'indirizzo e'
   http://192.168.x.x, che non e' contesto sicuro, e allora serve HTTPS.

   Produce in certs/ i file che ai-server.mjs cerca, in DUE formati diversi
   a seconda della strada:

     macOS e Linux, con openssl
       asma-local-key.pem   chiave del server
       asma-local-cert.pem  certificato del server piu' la CA
     Windows, con New-SelfSignedCertificate
       asma-local.pfx       chiave + certificato (PKCS#12)
       asma-local.pass      password del .pfx
     sempre
       asma-local-ca.cer    la CA da installare sull'iPad (DER)

   Perche' due formati: su macOS l'openssl di sistema e' LibreSSL, che
   esporta i .pfx con cifratura vecchia. Node 24 (OpenSSL 3) li rifiuta con
   "Unsupported PKCS12 PFX data" e lo scanner moriva all'avvio. Il PEM non
   ha quel problema. Su Windows il .pfx nativo funziona e resta com'e'.
   ===================================================================== */
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, rmSync, readFileSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces, tmpdir, hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createSecureContext } from 'node:tls';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const CERT_DIR = join(ROOT, 'certs');
const PFX = join(CERT_DIR, 'asma-local.pfx');
const PASS = join(CERT_DIR, 'asma-local.pass');
const CA = join(CERT_DIR, 'asma-local-ca.cer');
// La strada openssl produce PEM, non PKCS#12: vedi il commento sotto, dove
// viene scritto. Su Windows resta il .pfx di New-SelfSignedCertificate.
const KEY_PEM = join(CERT_DIR, 'asma-local-key.pem');
const CERT_PEM = join(CERT_DIR, 'asma-local-cert.pem');

const force = process.argv.includes('--force');
// --openssl forza la strada openssl anche su Windows: serve a provarla da qui
// (Git for Windows include openssl) ed e' utile a chi su Windows preferisce
// non passare da PowerShell.
const forceOpenssl = process.argv.includes('--openssl');

const giaPronto = existsSync(CA) && ((existsSync(KEY_PEM) && existsSync(CERT_PEM)) || (existsSync(PFX) && existsSync(PASS)));
if (!force && giaPronto) {
  console.log('Certificato HTTPS locale gia presente. Usa --force per rigenerarlo.');
  process.exit(0);
}

// Gli indirizzi IPv4 della macchina sulla rete locale: vanno nel SAN del
// certificato, altrimenti l'iPad che apre https://192.168.x.x lo rifiuta
// anche con la CA installata.
function localIPv4() {
  const out = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const e of entries || []) {
      const four = e.family === 'IPv4' || e.family === 4;
      if (four && !e.internal && !e.address.startsWith('169.254.')) out.push(e.address);
    }
  }
  return [...new Set(out)];
}

// Controllo finale, uguale su tutte le piattaforme: il .pfx deve essere
// davvero apribile da Node con quella password. Senza, il server parte, non
// trova un TLS valido e resta in HTTP senza dire perche' — con l'iPad che
// continua a non vedere la camera e nessun indizio sul motivo.
function verificaEsci() {
  try {
    const materiale = existsSync(KEY_PEM) && existsSync(CERT_PEM)
      ? { key: readFileSync(KEY_PEM), cert: readFileSync(CERT_PEM) }
      : { pfx: readFileSync(PFX), passphrase: readFileSync(PASS, 'utf8').trim() };
    createSecureContext(materiale);
    console.log('Verifica: il certificato si apre correttamente da Node.');
    process.exit(0);
  } catch (e) {
    console.error('');
    console.error('Il certificato e stato creato ma Node non riesce ad aprirlo:', e.message);
    process.exit(1);
  }
}

// openssl scrive su stderr sia gli errori sia i puntini di avanzamento della
// generazione delle chiavi: si tiene tutto da parte e lo si mostra solo se
// qualcosa va storto, altrimenti l'output utile sparisce nel rumore.
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    throw new Error(`${cmd} è uscito con codice ${r.status}`);
  }
  return r;
}

/* ---------------- Windows: la strada gia' collaudata ---------------- */
if (process.platform === 'win32' && !forceOpenssl) {
  const ps1 = join(ROOT, 'setup-https.ps1');
  // powershell.exe c'e' su ogni Windows; pwsh solo se installato a parte.
  const shell = spawnSync('powershell.exe', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'],
    { encoding: 'utf8' }).status === 0 ? 'powershell.exe' : 'pwsh';
  run(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, ...(force ? ['-Force'] : [])], { stdio: 'inherit' });
  verificaEsci();
}

/* ---------------- macOS e Linux: openssl ---------------- */
const probe = spawnSync('openssl', ['version'], { encoding: 'utf8' });
if (probe.status !== 0) {
  console.error('\nServe openssl e non risulta installato.');
  console.error('  macOS : arriva con il sistema; se manca,  brew install openssl');
  console.error('  Linux : sudo apt install openssl   (o l\'equivalente della tua distribuzione)\n');
  process.exit(1);
}
console.log(`openssl trovato: ${probe.stdout.trim()}`);

const addresses = localIPv4();
if (!addresses.length) {
  console.error('Nessun indirizzo IPv4 locale trovato: sei connesso a una rete?');
  process.exit(1);
}
// Preferisco un indirizzo di rete domestica come CN, per leggibilita'.
const primary = addresses.find(a => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)) || addresses[0];

mkdirSync(CERT_DIR, { recursive: true });
const work = join(tmpdir(), `asma-certs-${randomBytes(6).toString('hex')}`);
mkdirSync(work, { recursive: true });
const w = name => join(work, name);

// Un file di configurazione invece dei flag -addext: -addext non esiste su
// LibreSSL, che e' l'openssl di serie su macOS. Cosi' la stessa ricetta
// funziona su OpenSSL 1.1, OpenSSL 3 e LibreSSL.
const san = ['DNS.1 = localhost', `DNS.2 = ${hostname()}`]
  .concat(addresses.map((a, i) => `IP.${i + 1} = ${a}`)).join('\n');

writeFileSync(w('ca.cnf'), `
[req]
distinguished_name = dn
prompt = no
x509_extensions = ext
[dn]
CN = ASMA Local Camera CA
[ext]
basicConstraints = critical, CA:TRUE, pathlen:1
keyUsage = critical, keyCertSign, cRLSign, digitalSignature
subjectKeyIdentifier = hash
`);

writeFileSync(w('leaf.cnf'), `
[req]
distinguished_name = dn
prompt = no
req_extensions = ext
[dn]
CN = ${primary}
[ext]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt
[alt]
${san}
`);

try {
  console.log(`Genero il certificato per: ${addresses.join(', ')}`);
  // CA autofirmata, 5 anni
  run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1825',
    '-keyout', w('ca.key'), '-out', w('ca.pem'), '-config', w('ca.cnf')]);

  // certificato del server, 2 anni, firmato dalla CA
  run('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-sha256',
    '-keyout', w('leaf.key'), '-out', w('leaf.csr'), '-config', w('leaf.cnf')]);
  run('openssl', ['x509', '-req', '-in', w('leaf.csr'), '-CA', w('ca.pem'), '-CAkey', w('ca.key'),
    '-CAcreateserial', '-out', w('leaf.pem'), '-days', '730', '-sha256',
    '-extfile', w('leaf.cnf'), '-extensions', 'ext']);

  // PEM, non PKCS#12. Su macOS l'openssl di sistema e' LibreSSL, che esporta
  // i .pfx con cifratura vecchia (RC2/3DES); Node 24 usa OpenSSL 3, che
  // quella cifratura la rifiuta, e lo scanner moriva all'avvio con
  // "Unsupported PKCS12 PFX data". Il PEM non ha niente da cifrare e da
  // negoziare: chiave e certificato in chiaro dentro certs/, che e' gia'
  // escluso da Git e non lascia mai questo computer.
  copyFileSync(w('leaf.key'), KEY_PEM);
  writeFileSync(CERT_PEM, readFileSync(w('leaf.pem'), 'utf8') + readFileSync(w('ca.pem'), 'utf8'));
  // via un eventuale .pfx di un tentativo precedente: se restasse, e il PEM
  // sparisse, si tornerebbe a caricare proprio il file che non funziona.
  for (const vecchio of [PFX, PASS]) if (existsSync(vecchio)) rmSync(vecchio);

  // la CA in DER: e' il formato che iOS si aspetta da un file .cer
  run('openssl', ['x509', '-in', w('ca.pem'), '-outform', 'DER', '-out', CA]);

  console.log(`\nFatto. Certificato valido per: ${addresses.join(', ')}`);
  console.log(`CA da installare sull'iPad: ${CA}`);
  console.log('Sull\'iPad: apri http://<ip-del-computer>:8765/certs/asma-local-ca.cer,');
  console.log('poi Impostazioni > Generali > Info > Certificati attendibili e attiva "ASMA Local Camera CA".');
} finally {
  rmSync(work, { recursive: true, force: true });
}

verificaEsci();
