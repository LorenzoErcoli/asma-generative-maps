const http = require('http');
const fs = require('fs');
const path = require('path');
const root = __dirname;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.svg':'image/svg+xml' };
const port = process.env.PORT || 8123;
// server locale di sviluppo per il solo generatore di mappe: serve SOLO la
// pagina e le cartelle css/js dell'app, mai l'intera cartella del progetto.
// Qui accanto vivono anche certificati, chiavi e un server AI di un altro
// strumento (scanner/iPad) — un server statico "qualunque file sotto root"
// li esporrebbe per errore non appena in ascolto.
const ALLOW_ROOTS = ['css', 'js'];
function isAllowed(relPath){
  if (relPath === '/index.html' || relPath === '/') return true;
  const top = relPath.split('/')[1];
  return ALLOW_ROOTS.includes(top);
}
http.createServer((req,res)=>{
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
