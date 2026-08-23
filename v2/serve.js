const http = require('http');
const fs = require('fs');
const path = require('path');
const root = __dirname;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.svg':'image/svg+xml' };
const port = process.env.PORT || 8123;
http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err,data)=>{
    if (err) { res.writeHead(404); return res.end('not found: '+p); }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, ()=>console.log('v2 dev server on http://localhost:'+port));
