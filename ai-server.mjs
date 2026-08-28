import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT=fileURLToPath(new URL('.',import.meta.url));
// Da dove viene ogni valore: serve a dire in chiaro quale file ha vinto
// quando qualcosa non torna, invece di lasciare indovinare.
const ENV_ORIGINE={};
function loadEnvFile(fileName,sovrascrivi){
  const file=resolve(ROOT,fileName);
  if(!existsSync(file))return;
  for(const rawLine of readFileSync(file,'utf8').split(/\r?\n/)){
    const line=rawLine.trim();
    if(!line||line.startsWith('#'))continue;
    const separator=line.indexOf('=');
    if(separator<1)continue;
    const name=line.slice(0,separator).trim();
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))continue;
    let value=line.slice(separator+1).trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
    const vuoto=process.env[name]==null||process.env[name]==='';
    // Chi e' arrivato dall'ambiente del terminale comanda sempre: e' una
    // scelta esplicita di chi lancia il comando, piu' forte di un file.
    if(vuoto||(sovrascrivi&&ENV_ORIGINE[name])){
      process.env[name]=value;
      ENV_ORIGINE[name]=fileName;
    }else if(vuoto===false&&!ENV_ORIGINE[name]){
      ENV_ORIGINE[name]='ambiente del terminale';
    }
  }
}
// .env.local DOPO .env e con diritto di sovrascrivere: e' la convenzione
// ovunque, ed e' quello che promette il README ("scrivi la chiave in
// .env.local"). Prima .env veniva letto per primo e vinceva, quindi un
// .env rimasto col segnaposto di .env.example copriva in silenzio la
// chiave vera messa in .env.local, e il server diceva soltanto "chiave non
// configurata" — con la chiave lì, nel file giusto, sotto gli occhi.
function caricaEnv(){
  loadEnvFile('.env',false);
  loadEnvFile('.env.local',true);
}
caricaEnv();
// I file vengono letti all'avvio, e questo e' il secondo inciampo classico:
// si incolla la chiave nel file col server gia' acceso, non cambia niente,
// e sembra che la chiave non venga accettata. Quando manca si rileggono i
// file prima di rispondere "non c'e'": costa due letture di poche righe e
// solo nel caso in cui qualcosa e' gia' storto.
function ricaricaEnvSeServe(){
  const prima=process.env.OPENAI_API_KEY;
  for(const nome of ['OPENAI_API_KEY','OPENAI_VISION_MODEL'])delete ENV_ORIGINE[nome];
  process.env.OPENAI_API_KEY='';
  caricaEnv();
  if(!process.env.OPENAI_API_KEY&&prima)process.env.OPENAI_API_KEY=prima;
  return process.env.OPENAI_API_KEY;
}
const PORT=Number(process.env.PORT||8765);
const HTTPS_PORT=Number(process.env.HTTPS_PORT||8766);
const MODEL=process.env.OPENAI_VISION_MODEL||'gpt-5.6-terra';
const MAX_BODY=16*1024*1024;
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.pdf':'application/pdf','.cer':'application/pkix-cert'};
const COLORS=['rosso','arancione','giallo','verde','grigio','blu','viola','magenta','sconosciuto'];
const SHAPES=['quadrato','cerchio','triangolo','croce','pentagono','sconosciuta'];

function json(res,status,payload){
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify(payload));
}

async function readJson(req){
  const chunks=[];
  let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>MAX_BODY)throw Object.assign(new Error('Immagine troppo grande.'),{status:413});
    chunks.push(chunk);
  }
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}
  catch{throw Object.assign(new Error('JSON non valido.'),{status:400})}
}

function assertImage(image){
  if(typeof image!=='string'||!/^data:image\/(?:png|jpeg|webp);base64,/i.test(image)){
    throw Object.assign(new Error('Immagine mancante o non valida.'),{status:400});
  }
}

function pointSchema(){
  return {
    type:'object',additionalProperties:false,
    properties:{x:{type:'number',minimum:0,maximum:1000},y:{type:'number',minimum:0,maximum:1000}},
    required:['x','y']
  };
}

function requestSpec(mode,image,tokens=[]){
  if(mode==='corners')return {
    prompt:[
      'Individua la scacchiera 8x8 nell immagine.',
      'Restituisci i quattro angoli del bordo interno dell area giocabile, cioe il perimetro esatto degli 8x8 quadrati.',
      'Ignora bordo esterno, tablet, pulsanti, testi e marker colorati agli angoli.',
      'Le coordinate sono normalizzate da 0 a 1000 rispetto all intera immagine.',
      'Se il bordo e prospettico segui la prospettiva reale. confidence indica quanto il bordo e chiaramente visibile.'
    ].join(' '),
    schema:{
      type:'object',additionalProperties:false,
      properties:{top_left:pointSchema(),top_right:pointSchema(),bottom_right:pointSchema(),bottom_left:pointSchema(),confidence:{type:'number',minimum:0,maximum:1}},
      required:['top_left','top_right','bottom_right','bottom_left','confidence']
    },
    name:'asma_board_corners',image
  };
  return {
    prompt:[
      'La prima immagine e la scacchiera completa gia rettificata 8x8. Le immagini successive sono ritagli ingranditi delle pedine rilevate localmente e sono precedute dal loro numero slot e dalla cella.',
      'Le righe e colonne sono numerate da 0 a 7 a partire dall alto a sinistra.',
      'Elenca soltanto le celle che contengono una pedina circolare colorata.',
      'Per ogni ritaglio restituisci sempre una classificazione tokens con lo stesso slot.',
      'Un ritaglio e un candidato incerto: puo contenere una vera pedina oppure soltanto legno, una casella, una venatura, un riflesso o una linea. Non dare per scontato che la pedina esista.',
      'Nel campo present indica se nel ritaglio esiste davvero una pedina circolare colorata. presence_confidence misura la sicurezza di questa decisione, sia quando present e true sia quando e false.',
      'Se present e false usa sconosciuto e sconosciuta per colore e forma. Se present e true, per forma e colore dai priorita al ritaglio.',
      'Ogni pedina ha un colore dominante nell anello esterno e una forma bianca centrale.',
      'I valori di calibrazione colore sono stati misurati dalla stessa telecamera e con la stessa luce: sono il riferimento primario per il colore.',
      'Quando un colore locale e indicato come calibrated, non contraddirlo soltanto per impressione visiva; segnala un colore diverso solo con evidenza visiva molto forte.',
      `Colori ammessi: ${COLORS.slice(0,-1).join(', ')}.`,
      `Forme ammesse: ${SHAPES.slice(0,-1).join(', ')}.`,
      'La croce ha quattro bracci e puo essere ruotata. Le pedine possono essere decentrate e ruotate.',
      'Non confondere venature, caselle chiare o scure, linee della griglia e riflessi con pedine.',
      'Usa sconosciuto o sconosciuta quando colore o forma non sono leggibili; non inventare una pedina.'
    ].join(' '),
    schema:{
      type:'object',additionalProperties:false,
      properties:{
        cells:{type:'array',maxItems:64,items:{
          type:'object',additionalProperties:false,
          properties:{row:{type:'integer',minimum:0,maximum:7},column:{type:'integer',minimum:0,maximum:7},color:{type:'string',enum:COLORS},shape:{type:'string',enum:SHAPES},presence_confidence:{type:'number',minimum:0,maximum:1},color_confidence:{type:'number',minimum:0,maximum:1},shape_confidence:{type:'number',minimum:0,maximum:1}},
          required:['row','column','color','shape','presence_confidence','color_confidence','shape_confidence']
        }},
        tokens:{type:'array',maxItems:64,items:{
          type:'object',additionalProperties:false,
          properties:{slot:{type:'integer',minimum:0,maximum:63},present:{type:'boolean'},presence_confidence:{type:'number',minimum:0,maximum:1},color:{type:'string',enum:COLORS},shape:{type:'string',enum:SHAPES},color_confidence:{type:'number',minimum:0,maximum:1},shape_confidence:{type:'number',minimum:0,maximum:1}},
          required:['slot','present','presence_confidence','color','shape','color_confidence','shape_confidence']
        }}
      },required:['cells','tokens']
    },
    name:'asma_board_scan',image,tokens
  };
}

function outputText(response){
  if(typeof response.output_text==='string')return response.output_text;
  for(const item of response.output||[])for(const part of item.content||[]){
    if(part.type==='output_text'&&typeof part.text==='string')return part.text;
  }
  return '';
}

function proxyHint(){
  const raw=process.env.HTTPS_PROXY||process.env.ALL_PROXY||process.env.HTTP_PROXY;
  if(!raw)return '';
  try{
    const url=new URL(raw);
    if((url.hostname==='127.0.0.1'||url.hostname==='localhost')&&url.port==='9'){
      return ' Il processo ha ereditato il proxy locale bloccante 127.0.0.1:9, che taglia fuori la rete: la camera funziona, la rilettura AI no. Riavvia "npm run scanner" da un terminale nuovo, aperto fuori dall editor.';
    }
    return ` Proxy attivo: ${url.protocol}//${url.hostname}${url.port?`:${url.port}`:''}.`;
  }catch{return ' Controlla le variabili HTTP_PROXY e HTTPS_PROXY del processo.'}
}

// Perche' la chiave e' stata rifiutata: "non configurata" da solo mandava a
// cercare nel posto sbagliato: sul Mac la chiave c'era, nel file giusto, ma
// era coperta da un .env rimasto col segnaposto.
let KEY_ORIGINE=null;
function diagnosiChiave(){
  const grezza=String(process.env.OPENAI_API_KEY||'').trim();
  const da=ENV_ORIGINE.OPENAI_API_KEY||(grezza?'ambiente del terminale':null);
  const dove=da?` (valore letto da ${da})`:'';
  if(!grezza)return 'OPENAI_API_KEY non trovata: scrivila in .env.local, alla riga OPENAI_API_KEY=sk-...';
  if(/^sk-inserisci/i.test(grezza))
    return `OPENAI_API_KEY e ancora il segnaposto di esempio${dove}: sostituiscilo con la chiave vera.`;
  if(!/^sk-[A-Za-z0-9_.-]{20,}$/.test(grezza.replace(/^Bearer\s+/i,'').replace(/^["']|["']$/g,'')))
    return `OPENAI_API_KEY non ha la forma di una chiave${dove}: deve iniziare con sk- e non contenere spazi, virgolette o "Bearer".`;
  return `OPENAI_API_KEY non utilizzabile${dove}.`;
}
function normalizedApiKey(riletto){
  let key=String(process.env.OPENAI_API_KEY||'').trim();
  // niente chiave utilizzabile: prima di arrendersi, rileggi i file — puo'
  // essere stata incollata dopo l'avvio.
  if((!key||/^sk-inserisci/i.test(key))&&!riletto){
    ricaricaEnvSeServe();
    return normalizedApiKey(true);
  }
  key=key.replace(/^Bearer\s+/i,'').trim();
  if((key.startsWith('"')&&key.endsWith('"'))||(key.startsWith("'")&&key.endsWith("'")))key=key.slice(1,-1);
  key=key.replace(/[\s\u200B-\u200D\u2060\uFEFF]/g,'');
  if(!key)return null;
  // Il segnaposto di .env.example ha la forma di una chiave vera e passava
  // il controllo qui sotto: il server annunciava "AI attiva" e poi ogni
  // chiamata falliva contro OpenAI. Vale come chiave assente.
  if(/^sk-inserisci/i.test(key))return null;
  KEY_ORIGINE=ENV_ORIGINE.OPENAI_API_KEY||'ambiente del terminale';
  if(!/^sk-[A-Za-z0-9_.-]{20,}$/.test(key)){
    throw Object.assign(new Error('Formato chiave API non valido. Incolla soltanto la chiave che inizia con sk-, senza Bearer, virgolette o comandi PowerShell.'),{status:503});
  }
  return key;
}

async function callVision(mode,image,tokens=[],calibration=[]){
  const apiKey=normalizedApiKey();
  if(!apiKey)throw Object.assign(new Error(diagnosiChiave()),{status:503});
  const spec=requestSpec(mode,image,tokens);
  const content=mode==='corners'?
    [{type:'input_text',text:spec.prompt},{type:'input_image',image_url:spec.image,detail:'original'}]:
    [{type:'input_text',text:spec.prompt},{type:'input_text',text:'Immagine principale: scacchiera completa.'},{type:'input_image',image_url:spec.image,detail:'original'}];
  if(mode!=='corners'&&calibration.length){
    content.push({type:'input_text',text:`Calibrazione RGB acquisita dalla camera: ${JSON.stringify(calibration)}.`});
  }
  for(const token of tokens){
    content.push({type:'input_text',text:`Ritaglio slot ${token.slot}: cella riga ${token.row}, colonna ${token.column}; il rilevatore locale lo considera ${token.possible?'un possibile candidato appena sotto soglia':'una possibile pedina'}; colore locale ${token.localColor||'sconosciuto'}, confidenza ${token.localColorConfidence??0}, distanza dal campione ${token.localColorDistance??'n/d'}, margine dal secondo colore ${token.localColorMargin??'n/d'}, calibrated ${!!token.localColorCalibrated}, RGB osservato ${JSON.stringify(token.observedColor||null)}.`});
    content.push({type:'input_image',image_url:token.image,detail:'original'});
  }
  let response;
  try{
    response=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{'authorization':`Bearer ${apiKey}`,'content-type':'application/json'},
      body:JSON.stringify({
        model:MODEL,
        store:false,
        input:[{role:'user',content}],
        text:{format:{type:'json_schema',name:spec.name,strict:true,schema:spec.schema}}
      })
    });
  }catch(error){
    const cause=error?.cause;
    const detail=[cause?.code,cause?.message].filter(Boolean).join(' / ');
    throw Object.assign(new Error(`Connessione a api.openai.com fallita${detail?`: ${detail}`:''}.${proxyHint()}`),{status:502});
  }
  const payload=await response.json().catch(()=>({}));
  if(!response.ok){
    const message=payload?.error?.message||`OpenAI API: HTTP ${response.status}`;
    throw Object.assign(new Error(message),{status:502});
  }
  const text=outputText(payload);
  if(!text)throw Object.assign(new Error('La risposta AI non contiene dati leggibili.'),{status:502});
  try{return JSON.parse(text)}
  catch{throw Object.assign(new Error('La risposta AI non rispetta il formato previsto.'),{status:502})}
}

// Questo server ascolta su 0.0.0.0 — deve, perche' l'iPad lo raggiunge dalla
// rete locale. Percio' NON puo' servire "qualunque file sotto la cartella":
// qui accanto vivono .env.local con la chiave OpenAI, la password del
// certificato e la chiave privata del server, e prima di questo elenco
// erano tutti scaricabili da chiunque fosse sulla stessa Wi-Fi. Verificato:
// GET /.env.local rispondeva 200 con la chiave in chiaro.
// Vale la stessa regola di serve.js: si elenca cosa si serve, uno per uno.
const ALLOW_ROOTS=['css','js','assets','vendor'];
const ALLOW_FILES=['/index.html','/scanner.html','/ipad-board.html','/icon-lab.html','/pedine.html'];
// unica eccezione dentro certs/: la CA e' pubblica per definizione ed e' il
// file che l'iPad deve poter scaricare. La chiave privata e la password che
// le stanno accanto restano fuori.
const ALLOW_EXACT=['/certs/asma-local-ca.cer'];
function isAllowed(pathname){
  if(ALLOW_FILES.includes(pathname)||ALLOW_EXACT.includes(pathname))return true;
  return ALLOW_ROOTS.includes(pathname.split('/')[1]);
}

async function serveStatic(req,res){
  const url=new URL(req.url,'http://localhost');
  let pathname=decodeURIComponent(url.pathname);
  if(pathname==='/')pathname='/scanner.html';
  if(!isAllowed(pathname))return json(res,404,{error:'File non trovato.'});
  const file=resolve(ROOT,`.${pathname}`);
  if(file!==ROOT&&!file.startsWith(ROOT.endsWith(sep)?ROOT:ROOT+sep))return json(res,403,{error:'Percorso non consentito.'});
  try{
    const info=await stat(file);
    if(!info.isFile())throw new Error('not file');
    const body=await readFile(file);
    res.writeHead(200,{'content-type':MIME[extname(file).toLowerCase()]||'application/octet-stream'});
    res.end(body);
  }catch{json(res,404,{error:'File non trovato.'})}
}

async function handleRequest(req,res){
  try{
    if(req.method==='GET'&&req.url==='/api/ai/status'){
      let available=false,error=null;
      try{available=!!normalizedApiKey()}catch(cause){error=cause.message}
      if(!available&&!error)error=diagnosiChiave();
      return json(res,200,{available,model:MODEL,error,source:available?KEY_ORIGINE:null});
    }
    if(req.method==='POST'&&req.url==='/api/vision-scan'){
      const body=await readJson(req);
      assertImage(body.image);
      const mode=body.mode==='corners'?'corners':'board';
      const tokens=mode==='board'&&Array.isArray(body.tokens)?body.tokens.slice(0,64):[];
      const calibration=mode==='board'&&Array.isArray(body.calibration)?body.calibration.slice(0,8):[];
      for(const token of tokens)assertImage(token.image);
      return json(res,200,{mode,model:MODEL,result:await callVision(mode,body.image,tokens,calibration)});
    }
    if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Metodo non consentito.'});
    return serveStatic(req,res);
  }catch(error){json(res,error.status||500,{error:error.message||String(error)})}
}

function localAddresses(protocol,port){
  const addresses=[];
  for(const entries of Object.values(networkInterfaces()))for(const item of entries||[]){
    if(item.family==='IPv4'&&!item.internal)addresses.push(`${protocol}://${item.address}:${port}`);
  }
  return addresses;
}

function requestHostname(req){
  try{return new URL(`http://${req.headers.host||'localhost'}`).hostname}
  catch{return 'localhost'}
}

async function loadTls(){
  try{
    const [pfx,passphrase]=await Promise.all([
      readFile(resolve(ROOT,'certs','asma-local.pfx')),
      readFile(resolve(ROOT,'certs','asma-local.pass'),'utf8')
    ]);
    return {pfx,passphrase:passphrase.trim()};
  }catch{return null}
}

const tls=await loadTls();
const httpServer=createHttpServer((req,res)=>{
  const certificateDownload=req.url?.startsWith('/certs/asma-local-ca.cer');
  if(tls&&!certificateDownload){
    res.writeHead(307,{location:`https://${requestHostname(req)}:${HTTPS_PORT}${req.url||'/'}`,'cache-control':'no-store'});
    return res.end();
  }
  return handleRequest(req,res);
});

// stesso motivo del generatore: una porta occupata non deve presentarsi
// come uno stack trace.
function spiegaPorta(nome,porta){
  return err=>{
    console.error('');
    if(err.code==='EADDRINUSE'){
      console.error(`La porta ${porta} (${nome}) e gia occupata: probabilmente lo scanner e gia avviato altrove.`);
      console.error('Chiudi l altra finestra e riprova, oppure cambia PORT / HTTPS_PORT in .env.local.');
    }else{
      console.error(`Lo scanner non e riuscito a partire su ${porta}:`,err.message);
    }
    console.error('');
    process.exit(1);
  };
}
httpServer.on('error',spiegaPorta('HTTP',PORT));
httpServer.listen(PORT,'0.0.0.0',()=>{
  console.log(`ASMA scanner: http://localhost:${PORT}/scanner.html`);
  for(const address of localAddresses('http',PORT))console.log(`Certificato iPad: ${address}/certs/asma-local-ca.cer`);
  let aiReady=false;
  try{aiReady=!!normalizedApiKey()}catch{}
  console.log(aiReady?`AI attiva (${MODEL}, chiave da ${KEY_ORIGINE||'.env.local'}).`:`AI disattiva: ${diagnosiChiave()}`);
  const hint=proxyHint();
  if(hint)console.warn(`Attenzione:${hint}`);
});

if(tls){
  const httpsServer=createHttpsServer(tls,handleRequest);
  httpsServer.on('error',spiegaPorta('HTTPS',HTTPS_PORT));
  httpsServer.listen(HTTPS_PORT,'0.0.0.0',()=>{
    console.log(`ASMA scanner HTTPS: https://localhost:${HTTPS_PORT}/scanner.html`);
    for(const address of localAddresses('https',HTTPS_PORT))console.log(`iPad HTTPS: ${address}/scanner.html`);
  });
}else{
  console.warn('HTTPS non configurato: dall iPad la camera non parte (serve un contesto sicuro).');
  console.warn('Da questo computer funziona lo stesso su http://localhost.');
  console.warn('Per abilitare l iPad:  npm run setup-https');
}
