const http = require('http');
const fs = require('fs');
const path = require('path');
const root = __dirname;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.pdf':'application/pdf', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png' };
const port = process.env.PORT || 8123;
// server locale di sviluppo per il solo generatore di mappe: serve SOLO la
// pagina e le cartelle css/js dell'app, mai l'intera cartella del progetto.
// Qui accanto vivono anche certificati, chiavi e un server AI di un altro
// strumento (scanner/iPad) — un server statico "qualunque file sotto root"
// li esporrebbe per errore non appena in ascolto.
const ALLOW_ROOTS = ['css', 'js', 'assets', 'vendor'];
// scanner.html gira nell'iframe della console con lo stesso URL relativo
// usato quando lo si apre direttamente dal server AI (porta diversa): le sue
// chiamate a /api/vision-scan finiscono percio' qui invece che su
// ai-server.mjs, e senza questo inoltro tornerebbero sempre 404. La porta
// e' la stessa che legge ai-server.mjs da .env.local (di norma 8765).
function readAiPort(){
  const envLocal = path.join(root, '.env.local');
  if (fs.existsSync(envLocal)) {
    const m = fs.readFileSync(envLocal, 'utf8').match(/^\s*PORT\s*=\s*(\d+)\s*$/m);
    if (m) return Number(m[1]);
  }
  return 8765;
}
const AI_PORT = process.env.AI_PORT ? Number(process.env.AI_PORT) : readAiPort();
// scanner.html gira dentro l'iframe di index.html (#scannerFrame) e si porta
// dietro vendor/opencv.js: senza questi due la console si apre lo stesso ma la
// parte camera resta un 404. Restano elencati uno per uno, non aperti per
// estensione: qui accanto vivono anche certificati, chiavi e il server AI.
const ALLOW_FILES = ['/index.html', '/scanner.html'];
function isAllowed(relPath){
  if (relPath === '/') return true;
  if (ALLOW_FILES.includes(relPath)) return true;
  const top = relPath.split('/')[1];
  return ALLOW_ROOTS.includes(top);
}
http.createServer((req,res)=>{
  if (req.url.startsWith('/api/')) {
    const proxyReq = http.request({ host:'127.0.0.1', port:AI_PORT, path:req.url, method:req.method, headers:req.headers }, proxyRes=>{
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', err=>{
      res.writeHead(502, {'Content-Type':'text/plain'});
      res.end('server AI non raggiungibile su :'+AI_PORT+' ('+err.code+'). Deve girare come processo separato — vedi ai-server.mjs / npm run scanner.');
    });
    req.pipe(proxyReq);
    return;
  }
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  if (!isAllowed(p)) { res.writeHead(404); return res.end('not found'); }
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err,data)=>{
    if (err) { res.writeHead(404); return res.end('not found: '+p); }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, ()=>console.log('generatore mappe: dev server su http://localhost:'+port));
