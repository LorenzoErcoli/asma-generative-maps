"use strict";
/* =====================================================================
   UI — console laterale, scacchiera 8x8, pennelli, regia.
   ===================================================================== */
const $=id=>document.getElementById(id);
function el(t,c,h){const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e}

let grid=empty(), order=0, tool={type:'place',cat:'chiesa'}, jollyText=Array(NJOLLY).fill('');
function empty(){return Array.from({length:N},()=>Array(N).fill(null))}
let lastSVG='',mapDirty=false,lastDiagnostics=null,lastMapNum=0;
const EXTERNAL_GRID_CHANNEL='asma-grid-v1';
const MARKER_COLOR={rosso:'#ff0d19',arancione:'#ff6600',giallo:'#ffe600',verde:'#19a64a',grigio:'#7d8f98',blu:'#0040ff',viola:'#7549c7',magenta:'#d940a9'};
const MARKER_SHAPES=['quadrato','cerchio','triangolo','croce','pentagono'];
// il "Codice delle Pedine": un colore = un tema, una forma = un richiamo
// all'oggetto reale. Fonte unica sia per l'associazione automatica dei
// marker (MARKER_TO_PLACE, derivata sotto) sia per la legenda a schermo
// (renderLegend) — un solo posto da aggiornare se cambia un abbinamento.
// Le forme senza un vero luogo dietro (es. arancione-croce = "Tribunale",
// non ancora una categoria) restano segnate come 'open': in legenda si
// leggono come posto libero, e uno scanner che le vede produce ancora un
// marker "da associare", non un errore.
const MARKER_LEGEND=[
  {color:'viola',theme:'Sacro',entries:[
    {shape:'croce',cat:'chiesa',note:'la croce sul campanile'},
    {shape:'quadrato',cat:'cimitero',note:'il recinto murato'},
    {shape:'triangolo',cat:'monumento',note:"il profilo di un obelisco"},
    {shape:'cerchio',cat:'chiesa',sub:'Santuario',note:'la rotonda sacra'},
    {shape:'pentagono',cat:'chiesa',sub:'Convento',note:'la dimora silenziosa'},
  ]},
  {color:'arancione',theme:'del Palazzo',entries:[
    {shape:'quadrato',cat:'piazza',note:'lo spiazzo cittadino'},
    {shape:'pentagono',cat:'municipio',note:'la casa della città'},
    {shape:'cerchio',cat:'torre',note:"torre rotonda, l'orologio civico"},
    {shape:'triangolo',open:'Guarnigione — la vedetta'},
    {shape:'croce',open:'Tribunale — il crocevia della giustizia'},
  ]},
  {color:'giallo',theme:'dei Mercanti',entries:[
    {shape:'quadrato',cat:'mercato',note:'i banchi a scacchiera'},
    {shape:'croce',cat:'stazione',note:'il passaggio a livello'},
    {shape:'triangolo',cat:'porto',note:'la vela di una barca'},
    {shape:'cerchio',open:'Faro — il fascio di luce'},
    {shape:'pentagono',open:'Dogana — il casello di confine'},
  ]},
  {color:'magenta',theme:'delle Arti',entries:[
    {shape:'quadrato',cat:'biblioteca',note:'un libro aperto'},
    {shape:'triangolo',cat:'cinema',note:'la luce del proiettore'},
    {shape:'pentagono',cat:'teatro',note:'il sipario è la sua porta'},
    {shape:'cerchio',cat:'fontana',note:'la vasca rotonda'},
    {shape:'croce',cat:'giardino',note:'un fiore a quattro petali'},
  ]},
  {color:'rosso',theme:'del Popolo',entries:[
    {shape:'quadrato',cat:'bottega',note:'la vetrina del negozio'},
    {shape:'cerchio',cat:'osteria',note:"il boccale visto dall'alto"},
    {shape:'triangolo',cat:'locale',note:'il calice da cocktail'},
    {shape:'croce',open:'Farmacia — la croce verde'},
    {shape:'pentagono',open:'Locanda — l\'ultima stanza libera'},
  ]},
];
const MARKER_TO_PLACE={};
for(const group of MARKER_LEGEND)for(const e of group.entries)
  if(e.cat)MARKER_TO_PLACE[`${group.color}-${e.shape}`]={cat:e.cat,sub:e.sub};
// grigio è il jolly: le 5 forme diventano semplicemente J1..J5, senza un
// significato fisso — è il giocatore a scriverne uno nel pannello.
const JOLLY_MARKER_SHAPES=MARKER_SHAPES;
// stesse sagome usate dallo scanner per riconoscere le pedine (scanner.html,
// MARKER_SHAPES): riusarle qui vuol dire che la legenda mostra esattamente
// la forma che la camera cerca davvero, non un'icona diversa reinventata.
const SHAPE_SVG_PATH={
  quadrato:'M28 28h44v44H28z',
  cerchio:'M50 25a25 25 0 1 0 0 50 25 25 0 1 0 0-50z',
  triangolo:'M50 24 78 72H22z',
  croce:'M36 28h28v22h22v28H64v22H36V78H14V50h22z',
  pentagono:'M25 34h50v28L50 82 25 62z',
};
function shapeSvg(shape,filled){
  const fill=filled?'currentColor':'none', stroke=filled?'none':'currentColor';
  return `<svg viewBox="0 0 100 100" width="24" height="24"><path d="${SHAPE_SVG_PATH[shape]}" fill="${fill}" stroke="${stroke}" stroke-width="5"/></svg>`;
}
function renderLegend(){
  const host=$('legendBody');if(!host)return;
  let html=`<div class="legend-terrain">
    <div class="legend-terrain-row"><b>Blu</b> — Acqua. Fiume, lago o mare: lo decide da sola la continuità dell'acqua una volta piazzata, qualunque forma.</div>
    <div class="legend-terrain-row"><b>Verde</b> — Terreno. 1 pezzo isolato = giardino, 2 adiacenti = parco cittadino, un agglomerato (3+) = collina dentro la città o montagna se tocca il bordo della scacchiera.</div>
    <div class="legend-terrain-row"><b>Grigio</b> — Jolly. Le 5 forme sono semplicemente J1..J5: un desiderio libero, scritto da te nel pannello "Personalizza le pedine".</div>
  </div>`;
  for(const group of MARKER_LEGEND){
    html+=`<div class="legend-group">
      <div class="legend-group-head"><span class="legend-dot" style="background:${MARKER_COLOR[group.color]}"></span><b>${cap(group.color)}</b> — ${group.theme}</div>
      <div class="legend-shapes" style="color:${MARKER_COLOR[group.color]}">`;
    for(const e of group.entries){
      const filled=!!e.cat;
      const name=filled?(CAT[e.cat]?CAT[e.cat].name:e.cat)+(e.sub?' · '+e.sub:''):e.open.split(' — ')[0];
      const note=filled?e.note:e.open.split(' — ')[1];
      html+=`<div class="legend-shape ${filled?'':'open'}">${shapeSvg(e.shape,filled)}
        <div><div class="legend-shape-name">${name}</div><div class="legend-shape-note">${note}</div></div></div>`;
    }
    html+='</div></div>';
  }
  host.innerHTML=html;
}
$('btnLegend').onclick=()=>{renderLegend();$('legendModal').showModal()};
$('legendClose').onclick=()=>$('legendModal').close();
$('legendModal').addEventListener('click',e=>{if(e.target===$('legendModal'))$('legendModal').close()});

function buildConsole(){
  const tt=$('terrainTools');
  for(const [k,v] of Object.entries(TERRAINS)){
    if(k==='green')continue; // niente pennello: solo lo scanner lo produce
    const t=el('div','tool',`<span class="swatch" style="background:${v.color}"></span>${v.name}`);
    t.dataset.tool='terrain';t.dataset.k=k;tt.appendChild(t);
  }
  const sel=$('catSelect');
  for(const c of CATS){const o=el('option');o.value=c.id;o.textContent='Pedina luogo · '+c.name;sel.appendChild(o)}
  sel.onchange=()=>{tool={type:'place',cat:sel.value};setActive(null);sel.style.outline='2px solid var(--accent)'};
  const jt=$('jollyTools');
  for(let i=0;i<NJOLLY;i++){
    const t=el('div','tool',`<span class="swatch" style="background:#5a4a2a"></span>J${i+1}`);
    t.dataset.tool='jolly';t.dataset.j=i;jt.appendChild(t);
  }
  const jl=$('jollyLabels');
  for(let i=0;i<NJOLLY;i++){
    const row=el('div','jolly-row');row.appendChild(el('span','tag',`J${i+1}`));
    const inp=el('input');inp.type='text';inp.placeholder='es. musica dal vivo…';
    inp.oninput=()=>{jollyText[i]=inp.value;scheduleGen()};
    row.appendChild(inp);jl.appendChild(row);
  }
  document.querySelectorAll('.tool').forEach(t=>{
    t.onclick=()=>{
      const k=t.dataset.tool;
      if(k==='terrain')tool={type:'terrain',k:t.dataset.k};
      else if(k==='jolly')tool={type:'jolly',j:+t.dataset.j};
      else tool={type:'erase'};
      setActive(t);$('catSelect').style.outline='none';
    };
  });
}
function setActive(n){document.querySelectorAll('.tool').forEach(t=>t.classList.remove('active'));if(n)n.classList.add('active')}

const gridEl=$('grid');let painting=false, activePointerId=null;
const canPaintContinuously=()=>tool.type==='terrain'||tool.type==='erase';
function buildGrid(){
  gridEl.innerHTML='';
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){
    const cell=el('div','cell'+((r+c)%2?' dark':''));
    cell.onpointerdown=e=>{
      e.preventDefault();
      activePointerId=e.pointerId;
      painting=canPaintContinuously();
      if(cell.setPointerCapture)cell.setPointerCapture(e.pointerId);
      apply(r,c);
    };
    cell.onpointerenter=()=>{if(painting)apply(r,c)};
    gridEl.appendChild(cell);
  }
}
document.onpointerup=document.onpointercancel=()=>{painting=false;activePointerId=null};

function orderedPawns(){
  const out=[];
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){
    const v=grid[r][c];
    if(v&&(v.kind==='place'||v.kind==='jolly'))out.push(v);
  }
  return out.sort((a,b)=>(a.ord||0)-(b.ord||0));
}
function renumberOrder(){
  const pawns=orderedPawns();
  pawns.forEach((v,i)=>v.ord=i+1);
  order=pawns.length;
}
function nextOrder(){
  order=Math.max(order,...orderedPawns().map(v=>v.ord||0));
  return ++order;
}
function apply(r,c){
  const cur=grid[r][c];
  let shouldRenumber=false;
  if(tool.type==='erase'){
    shouldRenumber=!!(cur&&(cur.kind==='place'||cur.kind==='jolly'));
    grid[r][c]=null;
  }
  else if(tool.type==='terrain')grid[r][c]={kind:'terrain',terrain:tool.k};
  else if(tool.type==='place'){
    const remove=cur&&cur.kind==='place'&&cur.cat===tool.cat;
    shouldRenumber=remove||!!(cur&&(cur.kind==='place'||cur.kind==='jolly'));
    grid[r][c]=remove?null:{kind:'place',cat:tool.cat,ord:nextOrder()};
  }
  else if(tool.type==='jolly'){
    const remove=cur&&cur.kind==='jolly'&&cur.j===tool.j;
    shouldRenumber=remove||!!(cur&&(cur.kind==='place'||cur.kind==='jolly'));
    grid[r][c]=remove?null:{kind:'jolly',j:tool.j,ord:nextOrder()};
  }
  if(shouldRenumber)renumberOrder();
  drawGrid();scheduleGen();
}
function drawGrid(){
  const cells=gridEl.children;
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){
    const cell=cells[r*N+c];cell.innerHTML='';
    const v=grid[r][c];if(!v)continue;
    if(v.kind==='terrain'){const t=el('div','terr');t.style.background=TERRAINS[v.terrain].color;cell.appendChild(t)}
    else if(v.kind==='marker'){
      const parts=String(v.marker||'').split('-'),shape=parts.pop(),color=parts.join('-');
      const p=el('div','marker-pip');p.style.background=MARKER_COLOR[color]||'#666';
      p.title=v.marker||'Pedina non associata';
      if(MARKER_SHAPES.includes(shape))p.appendChild(el('span','marker-shape '+shape));
      cell.appendChild(p);
    }else{
      const p=el('div','pip');
      p.style.background=v.kind==='jolly'?'#5a4a2a':'#2c2c2c';
      p.textContent=v.kind==='jolly'?'★':GLYPH[CAT[v.cat].icon];
      p.title=v.kind==='jolly'?'Jolly '+(v.j+1):CAT[v.cat].name;
      cell.appendChild(p);cell.appendChild(el('div','ord',v.ord));
    }
  }
  renderCustomPanel();
}
const GLYPH={church:'⛪',grave:'✝',obelisk:'▲',townhall:'⌂',square:'◇',tower:'♜',market:'☰',station:'≡',
  anchor:'⚓',book:'▤',theatre:'◑',projector:'▶',tree:'♣',fountain:'♒',mug:'♨',hammer:'⚒',note:'♪'};

// pannello "gestione pedine": una riga per ogni pedina piazzata di una
// categoria generica (oggi solo Luogo religioso, CUSTOM_TYPES in world.js)
// con un menu di sottotipi preimpostati + "Altro…" per un nome libero.
// Il default (prima opzione) riproduce esattamente il vecchio comportamento
// fisso, quindi non cambia nulla per chi non tocca il pannello.
function renderCustomPanel(){
  const host=$('customPlaces');if(!host)return;
  const rows=[];
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){
    const v=grid[r][c];
    if(v&&v.kind==='place'&&CUSTOM_TYPES[v.cat]){
      const cfg=CUSTOM_TYPES[v.cat];
      if(!v.sub)v.sub=cfg.options[0];
      rows.push({v,cfg});
    }
  }
  rows.sort((a,b)=>(a.v.ord||0)-(b.v.ord||0));
  host.innerHTML='';
  if(!rows.length){host.appendChild(el('div','hint','Nessun luogo religioso sulla scacchiera.'));return}
  for(const {v,cfg} of rows){
    const row=el('div','jolly-row');
    row.appendChild(el('span','tag',String(v.ord||'·')));
    const sel=el('select');
    for(const opt of cfg.options){const o=el('option');o.value=opt;o.textContent=opt;sel.appendChild(o)}
    const altro=el('option');altro.value='__altro';altro.textContent='Altro…';sel.appendChild(altro);
    const txt=el('input');txt.type='text';txt.placeholder='nome libero…';
    const isCustom=!cfg.options.includes(v.sub);
    sel.value=isCustom?'__altro':v.sub;
    txt.style.display=isCustom?'':'none';
    if(isCustom)txt.value=v.sub;
    sel.onchange=()=>{
      if(sel.value==='__altro'){txt.style.display='';txt.value='';txt.focus();v.sub=txt.value||cfg.options[0]}
      else{txt.style.display='none';v.sub=sel.value}
      scheduleGen();
    };
    txt.oninput=()=>{v.sub=txt.value||cfg.options[0];scheduleGen()};
    row.appendChild(sel);row.appendChild(txt);
    host.appendChild(row);
  }
}

function setMap(svg,status){
  lastSVG=svg;
  mapDirty=false;
  $('mapHost').innerHTML=svg;
  if(status)setStatus(status);
}
const setStatus=t=>$('status').textContent=t;
const unassignedMarkerCount=()=>grid.flat().filter(value=>value?.kind==='marker').length;
const scheduleGen=()=>{
  mapDirty=true;
  const markers=unassignedMarkerCount();
  setStatus(markers?`${markers} marker ancora da associare agli oggetti.`:'Configurazione aggiornata · la carta è pronta da rivelare.');
};
function activeJollySignature(){
  const used=new Set();
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){
    const v=grid[r][c];
    if(v&&v.kind==='jolly')used.add(v.j);
  }
  return [...used].sort((a,b)=>a-b).map(i=>i+':'+jollyText[i]).join('|');
}
function resetJollyInputs(){
  jollyText=Array(NJOLLY).fill('');
  document.querySelectorAll('#jollyLabels input').forEach(inp=>inp.value='');
}
function resetBoard(){
  grid=empty();order=0;painting=false;activePointerId=null;
  resetJollyInputs();
  drawGrid();generate();
}

function normalizeExternalCell(value){
  if(!value||typeof value!=='object')return null;
  if(value.kind==='terrain'&&TERRAINS[value.terrain])return {kind:'terrain',terrain:value.terrain};
  if(value.kind==='place'&&CAT[value.cat])return {kind:'place',cat:value.cat,ord:Number(value.ord)||0,sub:typeof value.sub==='string'?value.sub:undefined};
  if(value.kind==='place'&&typeof value.cat==='string'){
    const marker=value.cat, mapped=MARKER_TO_PLACE[marker];
    if(mapped)return {kind:'place',cat:mapped.cat,ord:Number(value.ord)||0,sub:mapped.sub};
    const shape=marker.split('-').pop(), color=marker.slice(0,marker.length-shape.length-1);
    if(color==='grigio'){
      const j=JOLLY_MARKER_SHAPES.indexOf(shape);
      if(j>=0)return {kind:'jolly',j,ord:Number(value.ord)||0};
    }
    // blu = acqua: qualunque forma. Fiume, lago o mare non si sceglie qui —
    // lo decide da sola la continuita' dell'acqua sulla scacchiera una volta
    // piazzata (classWater in world.js), esattamente come un fiume disegnato
    // a mano col pennello.
    if(color==='blu'&&MARKER_SHAPES.includes(shape))return {kind:'terrain',terrain:'water'};
    // verde = terreno "grezzo": qualunque forma. Giardino, parco, collina o
    // montagna non si scelgono qui — li decide l'agglomerato di celle verdi
    // una volta piazzate (vedi main.js), esattamente come per l'acqua sopra.
    if(color==='verde'&&MARKER_SHAPES.includes(shape))return {kind:'terrain',terrain:'green'};
    return {kind:'marker',marker};
  }
  if(value.kind==='jolly'&&Number.isInteger(Number(value.j)))return {kind:'jolly',j:Math.max(0,Math.min(NJOLLY-1,Number(value.j))),ord:Number(value.ord)||0};
  return null;
}
let lastExternalGridTime=0;
function applyExternalGrid(payload){
  if(!payload||!Array.isArray(payload.grid)||payload.grid.length!==N)return false;
  const time=Number(payload.time)||Date.now();
  if(time<=lastExternalGridTime)return false;
  const next=payload.grid.map(row=>Array.isArray(row)&&row.length===N?row.map(normalizeExternalCell):null);
  if(next.some(row=>!row))return false;
  lastExternalGridTime=time;grid=next;renumberOrder();drawGrid();mapDirty=true;
  const markers=grid.flat().filter(value=>value?.kind==='marker').length;
  const mapped=grid.flat().filter(value=>value?.kind==='place'||value?.kind==='terrain'||value?.kind==='jolly').length;
  setStatus(`Camera: ${markers+mapped} elementi acquisiti${markers?`, ${markers} marker da associare agli oggetti`:''}.`);
  return true;
}
const scannerFrame=$('scannerFrame');
const scannerCommand=command=>scannerFrame.contentWindow?.postMessage({type:'asma-scanner-command',command},location.origin);
function openScannerCalibration(){
  document.body.classList.add('scanner-calibration-open');
  requestAnimationFrame(()=>scannerCommand('open-calibration'));
}
function closeScannerCalibration(){
  document.body.classList.remove('scanner-calibration-open');
  scannerCommand('close-calibration');
}
$('btnCamera').onclick=openScannerCalibration;
$('btnOpenCalibration').onclick=openScannerCalibration;
$('btnStartCamera').onclick=()=>scannerCommand('start');
$('btnTrackBoard').onclick=()=>scannerCommand('track');
$('btnManualBoard').onclick=()=>scannerCommand('manual');
$('btnReadBoard').onclick=()=>scannerCommand('scan');
scannerFrame.addEventListener('load',()=>scannerCommand('status'));
window.addEventListener('message',event=>{
  if(event.origin!==location.origin)return;
  if(event.data?.type==='asma-scanner-grid')applyExternalGrid(event.data.payload);
  if(event.data?.type==='asma-scanner-status')$('cameraStatus').textContent=event.data.status||'';
  if(event.data?.type==='asma-scanner-calibration'&&!event.data.open)document.body.classList.remove('scanner-calibration-open');
});
try{
  const externalGridChannel=new BroadcastChannel(EXTERNAL_GRID_CHANNEL);
  externalGridChannel.onmessage=event=>applyExternalGrid(event.data);
}catch(e){}

$('btnGen').onclick=()=>{
  const markers=unassignedMarkerCount();
  if(markers){setStatus(`Associa prima i ${markers} marker riconosciuti agli oggetti.`);return}
  setStatus('Il cartografo consulta l\'atlante…');setTimeout(generate,260);
};
$('btnClear').onclick=resetBoard;
$('btnPrint').onclick=()=>window.print();
$('btnExport').onclick=()=>{
  if(mapDirty||!lastSVG)generate();
  const b=new Blob([lastSVG],{type:'image/svg+xml'});
  const a=document.createElement('a');
  const url=URL.createObjectURL(b);
  a.href=url;a.download='carta-immaginaria.svg';a.click();
  setTimeout(()=>URL.revokeObjectURL&&URL.revokeObjectURL(url),0);
};
$('character').onchange=generate;
$('btnDemo').onclick=demo;

function demo(){
  grid=empty();order=0;resetJollyInputs();
  const put=(r,c,v)=>grid[r][c]=v;
  // fiume che attraversa da bordo a bordo (diagonale = 8-connessione) + rilievi a ovest
  [[0,2],[1,2],[2,3],[3,3],[4,4],[5,4],[6,5],[7,5]].forEach(([r,c])=>put(r,c,{kind:'terrain',terrain:'water'}));
  [[6,0],[7,0],[7,1]].forEach(([r,c])=>put(r,c,{kind:'terrain',terrain:'mountain'}));
  [[0,0],[0,1]].forEach(([r,c])=>put(r,c,{kind:'terrain',terrain:'hill'}));
  const P=[[3,4,'piazza'],[2,4,'municipio'],[4,2,'chiesa'],[2,2,'porto'],[5,2,'mercato'],
           [1,5,'teatro'],[6,3,'giardino'],[5,6,'locale'],[6,6,'stazione'],[3,1,'biblioteca'],
           [0,6,'stazione'],[1,1,'cimitero']];
  for(const [r,c,cat] of P)put(r,c,{kind:'place',cat,ord:++order});
  put(5,5,{kind:'jolly',j:0,ord:++order});jollyText[0]='giostra dei sogni';
  const inp=document.querySelectorAll('#jollyLabels input')[0];if(inp)inp.value=jollyText[0];
  drawGrid();generate();
}

buildConsole();buildGrid();
$('catSelect').style.outline='2px solid var(--accent)';
demo();
