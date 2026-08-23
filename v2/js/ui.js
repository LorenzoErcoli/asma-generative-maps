"use strict";
/* =====================================================================
   UI — console laterale, scacchiera 8x8, pennelli, regia.
   ===================================================================== */
const $=id=>document.getElementById(id);
function el(t,c,h){const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e}

let grid=empty(), order=0, tool={type:'place',cat:'chiesa'}, jollyText=Array(NJOLLY).fill('');
function empty(){return Array.from({length:N},()=>Array(N).fill(null))}
let lastSVG='',mapDirty=false,lastDiagnostics=null;

function buildConsole(){
  const tt=$('terrainTools');
  for(const [k,v] of Object.entries(TERRAINS)){
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
    else{
      const p=el('div','pip');
      p.style.background=v.kind==='jolly'?'#5a4a2a':'#2c2c2c';
      p.textContent=v.kind==='jolly'?'★':GLYPH[CAT[v.cat].icon];
      p.title=v.kind==='jolly'?'Jolly '+(v.j+1):CAT[v.cat].name;
      cell.appendChild(p);cell.appendChild(el('div','ord',v.ord));
    }
  }
}
const GLYPH={church:'⛪',grave:'✝',obelisk:'▲',townhall:'⌂',square:'◇',tower:'♜',market:'☰',station:'≡',
  anchor:'⚓',book:'▤',theatre:'◑',tree:'♣',fountain:'♒',mug:'♨',hammer:'⚒',note:'♪'};

function setMap(svg,status){
  lastSVG=svg;
  mapDirty=false;
  $('mapHost').innerHTML=svg;
  if(status)setStatus(status);
}
const setStatus=t=>$('status').textContent=t;
const scheduleGen=()=>{
  mapDirty=true;
  setStatus('Configurazione aggiornata · la carta è pronta da rivelare.');
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

$('btnGen').onclick=()=>{setStatus('Il cartografo consulta l\'atlante…');setTimeout(generate,260)};
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
