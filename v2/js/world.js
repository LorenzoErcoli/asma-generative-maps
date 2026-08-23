"use strict";
/* =====================================================================
   MONDO — tutto cio' che sta FUORI dal motore del tessuto: scala della
   carta, tassonomia delle pedine, campo acqua/campo urbano, quartieri,
   periferia (borghi, campi, cascinali) e le strade di campagna che li
   collegano. Il tessuto della citta' vera e propria (streets/buildings)
   e' generato da tessuto.js, non da questo file.
   ===================================================================== */

/* ---------------- scala della carta ---------------- */
const N=8, CELL=110, PAD=110;
const MAPW=N*CELL+PAD*2;
const SIDE=380;
const SVGW=MAPW+SIDE, SVGH=MAPW;
const STEP=10;
const GW=Math.ceil(MAPW/STEP), GH=GW;
const THR=0.44;      // soglia campo urbano
const WTHR=0.50;     // soglia campo acqua
const METERS_PER_CELL=400;
const W=(gx)=>PAD+gx*CELL;
const toBoard=(x)=>(x-PAD)/CELL;

/* ---------------- tassonomia ----------------
   'ponte' e 'porta' non esistono piu' come pedine: il fiume divide sempre
   la citta' in due meta' indipendenti e i ponti li piazza l'algoritmo
   (vedi tessuto.js/autoBridges) — vedi la cronologia del prototipo per il
   perche' (bug della "retta grigia" e citta' spaccate in due). */
const CATS=[
 {id:'chiesa',name:'Chiesa',group:'sacro',icon:'church'},
 {id:'cimitero',name:'Cimitero',group:'sacro',icon:'grave'},
 {id:'monumento',name:'Monumento',group:'sacro',icon:'obelisk'},
 {id:'municipio',name:'Municipio',group:'civico',icon:'townhall',civic:2},
 {id:'piazza',name:'Piazza',group:'civico',icon:'square',civic:2},
 {id:'torre',name:'Torre',group:'civico',icon:'tower'},
 {id:'mercato',name:'Mercato',group:'scambio',icon:'market',civic:1.5},
 {id:'stazione',name:'Stazione',group:'scambio',icon:'station'},
 {id:'porto',name:'Porto',group:'scambio',icon:'anchor',needsWater:true},
 {id:'biblioteca',name:'Biblioteca',group:'cultura',icon:'book'},
 {id:'teatro',name:'Teatro',group:'cultura',icon:'theatre'},
 {id:'giardino',name:'Giardino',group:'verde',icon:'tree'},
 {id:'fontana',name:'Fontana',group:'verde',icon:'fountain'},
 {id:'osteria',name:'Osteria',group:'quotid',icon:'mug'},
 {id:'bottega',name:'Bottega',group:'quotid',icon:'hammer'},
 {id:'locale',name:'Locale',group:'notte',icon:'note'},
];
const CAT=Object.fromEntries(CATS.map(c=>[c.id,c]));
const GROUP_NAME={sacro:'Sacro',civico:'del Palazzo',scambio:'dei Mercanti',
  cultura:'delle Arti',verde:'dei Giardini',quotid:'Vecchio',notte:'della Notte'};
const TERRAINS={water:{name:'Acqua',color:'#3b6f86'},mountain:{name:'Montagna',color:'#7a5a3a'},hill:{name:'Collina',color:'#6f8a4a'}};
const NJOLLY=5;
const ANCHOR_CATS=new Set(['piazza','giardino','cimitero']);

/* ---------------- palette ---------------- */
const PAL={
 classico:{land:'#e9e3d2',built:'#e8c3ad',builtLn:'#c9967a',street:'#fdfaf4',major:'#fff8e8',
   water:'#a8c8dc',waterLn:'#6f9ab5',green:'#bcd3a0',greenDk:'#8fae76',ink:'#4a3f30',
   red:'#c0392b',redDk:'#8c2b21',rail:'#3a332a',frame:'#6b5a44',paper:'#f2ecdb',sub:'#8d8574'},
 culturale:{land:'#e7e5da',built:'#dcc9c9',builtLn:'#b79c9c',street:'#fdfbf7',major:'#fff6f2',
   water:'#a9b9cf',waterLn:'#6d84a4',green:'#b6c8ab',greenDk:'#86a07c',ink:'#3c3948',
   red:'#8e4a6b',redDk:'#6a3450',rail:'#332f3a',frame:'#5f5a6b',paper:'#efece2',sub:'#87849a'},
 festaiolo:{land:'#f0e6cd',built:'#f0c39a',builtLn:'#d09a6a',street:'#fffaf0',major:'#fff2dc',
   water:'#b7cbbd',waterLn:'#7d9c88',green:'#c9d497',greenDk:'#9fae66',ink:'#4c3327',
   red:'#d1452f',redDk:'#9c2f1f',rail:'#3d2f26',frame:'#8a4c34',paper:'#f6ead2',sub:'#a3856a'},
 rilassante:{land:'#e6ead9',built:'#dfd9bd',builtLn:'#b6b08f',street:'#fdfdf6',major:'#fbfbea',
   water:'#aacfcb',waterLn:'#6f9f99',green:'#bcd7a3',greenDk:'#87a86f',ink:'#3f4a3d',
   red:'#a0603c',redDk:'#7a462a',rail:'#3a4238',frame:'#6f7d63',paper:'#eef1e2',sub:'#8b9880'},
 avventura:{land:'#e4d7b6',built:'#dfc194',builtLn:'#b8935f',street:'#fbf5e6',major:'#fff2d5',
   water:'#9dbcb8',waterLn:'#5f8580',green:'#b3c07f',greenDk:'#84934f',ink:'#3c2e1d',
   red:'#a8542a',redDk:'#7c3b1c',rail:'#332a1d',frame:'#6d5738',paper:'#ecdfc0',sub:'#8f7c58'},
};

/* ---------------- terreno: componenti connesse (8-direzioni) ---------------- */
const NB8=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
function comps(cells){
  const set=new Set(cells.map(([r,c])=>r*N+c)), seen=new Set(), out=[];
  for(const k of set){
    if(seen.has(k))continue;
    const q=[k];seen.add(k);const grp=[];
    while(q.length){
      const cur=q.pop(), r=(cur/N)|0, c=cur%N;grp.push([r,c]);
      for(const [dr,dc] of NB8){
        const nr=r+dr,nc=c+dc,nk=nr*N+nc;
        if(nr>=0&&nr<N&&nc>=0&&nc<N&&set.has(nk)&&!seen.has(nk)){seen.add(nk);q.push(nk)}
      }
    }
    out.push(grp);
  }
  return out;
}
function classWater(cells){
  if(cells.length===1)return 'laghetto';
  const rs=cells.map(c=>c[0]),cs=cells.map(c=>c[1]);
  const sr=Math.max(...rs)-Math.min(...rs), sc=Math.max(...cs)-Math.min(...cs);
  const tT=rs.includes(0),tB=rs.includes(N-1),tL=cs.includes(0),tR=cs.includes(N-1);
  if((tT&&tB)||(tL&&tR))return 'fiume';
  const edgeRuns=[
    {n:cells.filter(([r])=>r===0).length,along:sc,deep:sr},
    {n:cells.filter(([r])=>r===N-1).length,along:sc,deep:sr},
    {n:cells.filter(([,c])=>c===0).length,along:sr,deep:sc},
    {n:cells.filter(([,c])=>c===N-1).length,along:sr,deep:sc},
  ];
  if(edgeRuns.some(e=>e.n>=2&&e.along>=Math.max(1,e.deep*1.25)))return 'mare';
  const mr=rs.reduce((a,v)=>a+v,0)/cells.length, mc=cs.reduce((a,v)=>a+v,0)/cells.length;
  let srr=0,scc=0,src=0;
  for(const [r,c] of cells){const dr=r-mr,dc=c-mc;srr+=dr*dr;scc+=dc*dc;src+=dr*dc}
  const tr=srr+scc, disc=Math.sqrt((srr-scc)**2+4*src*src);
  const major=(tr+disc)/2, minor=(tr-disc)/2;
  const elongation=Math.sqrt((major+.15)/(minor+.15));
  return elongation>=1.75?'fiume':'lago';
}

/* ---------------- centro urbano, MST, campo urbanita' ---------------- */
function mstEdges(P){
  if(P.length<2)return [];
  const inT=[0],rest=P.map((_,i)=>i).slice(1),E=[];
  while(rest.length){
    let best=null;
    for(const a of inT)for(const b of rest){
      const w=dist([P[a].x,P[a].y],[P[b].x,P[b].y]);
      if(!best||w<best.w)best={a,b,w};
    }
    E.push([best.a,best.b]);inT.push(best.b);rest.splice(rest.indexOf(best.b),1);
  }
  return E;
}
function urbanCentre(places){
  const anchors=places.filter(p=>(CAT[p.cat]?.civic||0)>1);
  const candidates=anchors.length?anchors:places;
  let seed=candidates[0],best=Infinity;
  for(const p of candidates){
    const score=places.reduce((s,q)=>s+dist([p.x,p.y],[q.x,q.y])*(CAT[q.cat]?.civic||1),0);
    if(score<best){best=score;seed=p}
  }
  const near=places.filter(p=>dist([p.x,p.y],[seed.x,seed.y])<2.7*CELL);
  const sw=near.reduce((s,p)=>s+(CAT[p.cat]?.civic||1),0)||1;
  return [near.reduce((s,p)=>s+p.x*(CAT[p.cat]?.civic||1),0)/sw,
          near.reduce((s,p)=>s+p.y*(CAT[p.cat]?.civic||1),0)/sw];
}
function urbanField(places,mst,terr,rivers,centre){
  const s=GW+1, F=new Float32Array(s*s);
  const sig=.86*CELL, sigC=.46*CELL;
  const cx=centre[0],cy=centre[1];
  const mtn=terr.mountain.map(([r,c])=>[W(c+.5),W(r+.5)]);
  const hll=terr.hill.map(([r,c])=>[W(c+.5),W(r+.5)]);
  for(let j=0;j<=GH;j++)for(let i=0;i<=GW;i++){
    const [x,y]=warp(i*STEP,j*STEP,13);
    let v=0;
    for(const p of places){
      const d=Math.hypot(x-p.x,y-p.y);
      v+=Math.exp(-(d*d)/(2*sig*sig))*(p.jolly?.9:1);
    }
    for(const [a,b] of mst){
      const d=distSeg([x,y],[places[a].x,places[a].y],[places[b].x,places[b].y]);
      const span=dist([places[a].x,places[a].y],[places[b].x,places[b].y]);
      const amp=.10+.48*clamp((3*CELL-span)/(1.7*CELL),0,1);
      v+=amp*Math.exp(-(d*d)/(2*sigC*sigC));
    }
    const dc=Math.hypot(x-cx,y-cy);
    v+=.38*Math.exp(-(dc*dc)/(2*(1.35*CELL)**2));
    let riverPull=0;
    for(const rv of (rivers||[])){
      let dm=Infinity;const P=rv.pts;
      for(let k=0;k<P.length-1;k+=2){
        if(Math.abs(P[k][0]-x)>260&&Math.abs(P[k][1]-y)>260)continue;
        const d=distSeg([x,y],P[k],P[k+1]);
        if(d<dm)dm=d;
      }
      if(dm<300){
        const pull=(rv.tributary?.14:.28)*Math.exp(-((dm-44)**2)/(2*70*70))*Math.exp(-(dc*dc)/(2*(2.4*CELL)**2));
        riverPull=Math.max(riverPull,pull);
      }
    }
    v+=riverPull;
    let m=1;
    for(const q of mtn){const d=Math.hypot(x-q[0],y-q[1]);m*=1-.85*Math.exp(-(d*d)/(2*(.62*CELL)**2))}
    for(const q of hll){const d=Math.hypot(x-q[0],y-q[1]);m*=1-.32*Math.exp(-(d*d)/(2*(.6*CELL)**2))}
    const bx=i*STEP, by=j*STEP;
    const bd=Math.min(bx,MAPW-bx,by,MAPW-by);
    F[j*s+i]=v*m*clamp((bd-26)/64,0,1);
  }
  return F;
}

/* ---------------- campo acqua (fiumi sinuosi, laghi, mare) ---------------- */
function riverAxis(cells){
  const key=([r,c])=>r*N+c, byKey=new Map(cells.map((p,i)=>[key(p),i]));
  let best={d:-1,path:[0]};
  for(let start=0;start<cells.length;start++){
    const d=Array(cells.length).fill(Infinity),prev=Array(cells.length).fill(-1),done=new Set();
    d[start]=0;
    while(done.size<cells.length){
      let u=-1,bd=Infinity;
      for(let i=0;i<cells.length;i++)if(!done.has(i)&&d[i]<bd){u=i;bd=d[i]}
      if(u<0)break;
      done.add(u);
      const [r,c]=cells[u];
      for(const [dr,dc] of NB8){
        const v=byKey.get((r+dr)*N+c+dc);if(v==null||done.has(v))continue;
        const nd=d[u]+Math.hypot(dr,dc);
        if(nd<d[v]){d[v]=nd;prev[v]=u}
      }
    }
    for(let end=0;end<cells.length;end++)if(d[end]>best.d&&d[end]<Infinity){
      const path=[];for(let u=end;u>=0;u=prev[u]){path.push(u);if(u===start)break}
      best={d:d[end],path:path.reverse()};
    }
  }
  return best.path.map(i=>[W(cells[i][1]+.5),W(cells[i][0]+.5)]);
}
function extendRiverPoint(p,q){
  const dx=p[0]-q[0],dy=p[1]-q[1],L=Math.hypot(dx,dy)||1,ux=dx/L,uy=dy/L;
  const ts=[];
  if(ux>0)ts.push((MAPW+24-p[0])/ux);else if(ux<0)ts.push((-24-p[0])/ux);
  if(uy>0)ts.push((MAPW+24-p[1])/uy);else if(uy<0)ts.push((-24-p[1])/uy);
  const t=Math.min(...ts.filter(v=>v>0));
  return [p[0]+ux*t,p[1]+uy*t];
}
function extendRiverToFrame(path){
  if(path.length<2)return path;
  return [extendRiverPoint(path[0],path[1]),...path,extendRiverPoint(path[path.length-1],path[path.length-2])];
}
function waterField(waterComps,places){
  const s=GW+1, WFa=new Float32Array(s*s), WLa=new Float32Array(s*s);
  const src=[];
  const rivers=[];
  const riverCps=waterComps.filter(cp=>cp.cls==='fiume'&&cp.cells.length>=2);
  const borderCount=cp=>cp.cells.filter(([r,c])=>r===0||r===N-1||c===0||c===N-1).length;
  riverCps.sort((a,b)=>(b.cells.length+borderCount(b)*3)-(a.cells.length+borderCount(a)*3));
  const rawAxes=[];
  for(let ri=0;ri<riverCps.length;ri++){
      const cp=riverCps[ri],cells=cp.cells;
      let path=riverAxis(cells),tributary=false;
      const rs=cells.map(p=>p[0]),cs=cells.map(p=>p[1]);
      const explicit=((rs.includes(0)&&rs.includes(N-1))||(cs.includes(0)&&cs.includes(N-1)));
      if(ri===0||explicit){
        path=extendRiverToFrame(path);
      }else{
        let join=null;
        for(const end of [0,path.length-1])for(const axis of rawAxes)for(const q of axis){
          const d=dist(path[end],q);if(!join||d<join.d)join={end,q,d};
        }
        if(join&&join.d<5*CELL){
          if(join.end===0)path.reverse();
          path=[extendRiverPoint(path[0],path[1]),...path,join.q];
          tributary=true;
        }else path=extendRiverToFrame(path);
      }
      rawAxes.push(path);
      const sm=chaikinOpen(path,3);
      const even=[];
      for(let i=0;i<sm.length-1;i++){
        const p=sm[i],q=sm[i+1],L=dist(p,q);
        for(let d=0;d<L;d+=5){const t=d/L;even.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t])}
      }
      even.push(sm[sm.length-1]);
      const mea=[];
      for(let i=0;i<even.length;i++){
        const p=even[Math.max(0,i-1)],q=even[Math.min(even.length-1,i+1)];
        const dx=q[0]-p[0],dy=q[1]-p[1],L=Math.hypot(dx,dy)||1;
        const off=(i===0||i===even.length-1)?0:(tributary?11:19)*fbm(i*.022,7.3,2);
        mea.push([even[i][0]-dy/L*off, even[i][1]+dx/L*off]);
      }
      const axis=chaikinOpen(mea,1);
      rivers.push({pts:axis, cp, cls:'fiume',tributary});
  }
  for(const cp of waterComps){
    const cls=cp.cls,cells=cp.cells;
    if(cls==='fiume'&&cells.length>=2)continue;
    const sig=(cls==='laghetto')?.30*CELL:(cls==='lago')?.46*CELL:.50*CELL;
    for(const [r,c] of cells)src.push({x:W(c+.5),y:W(r+.5),sig,amp:1});
    if(cls==='mare'){
      for(const [r,c] of cells){
        const o=[];
        if(r===0)o.push([0,-1]); if(r===N-1)o.push([0,1]);
        if(c===0)o.push([-1,0]); if(c===N-1)o.push([1,0]);
        for(const [dx,dy] of o)for(let k=1;k<=6;k++)
          src.push({x:W(c+.5+dx*k),y:W(r+.5+dy*k),sig:sig*1.4,amp:1});
      }
    }
  }
  const island=null;
  const HW=12;
  for(const rv of rivers){
    rv.hw=rv.pts.map((p,i)=>{
      let h=(rv.tributary?8.5:HW)*(1+.26*fbm(i*.016,4.7,2));
      return h;
    });
    const L=[],R=[];
    for(let i=0;i<rv.pts.length;i++){
      const p0=rv.pts[Math.max(0,i-1)],p1=rv.pts[Math.min(rv.pts.length-1,i+1)];
      const dx=p1[0]-p0[0],dy=p1[1]-p0[1],l=Math.hypot(dx,dy)||1;
      const nx=-dy/l,ny=dx/l;
      const jl=1+.10*fbm(i*.09,21.3,2), jr=1+.10*fbm(i*.09,55.7,2);
      L.push([rv.pts[i][0]+nx*rv.hw[i]*jl, rv.pts[i][1]+ny*rv.hw[i]*jl]);
      R.push([rv.pts[i][0]-nx*rv.hw[i]*jr, rv.pts[i][1]-ny*rv.hw[i]*jr]);
    }
    rv.left=L; rv.right=R;
    rv.poly=L.concat(R.slice().reverse());
  }
  for(let j=0;j<=GH;j++)for(let i=0;i<=GW;i++){
    const [lx,ly]=warp(i*STEP,j*STEP,22);
    const [x,y]  =warp(i*STEP,j*STEP,8);
    let v=0;
    for(const q of src){
      const dx=lx-q.x,dy=ly-q.y,d2=dx*dx+dy*dy;
      if(d2>(4*q.sig)**2)continue;
      v+=q.amp*Math.exp(-d2/(2*q.sig*q.sig));
    }
    WLa[j*s+i]=v;
    const ux=i*STEP, uy=j*STEP;
    for(const rv of rivers){
      let dm=Infinity,bi=0;const P=rv.pts;
      for(let k=0;k<P.length-1;k++){
        if(Math.abs(P[k][0]-ux)>90&&Math.abs(P[k][1]-uy)>90)continue;
        const d=distSeg([ux,uy],P[k],P[k+1]);
        if(d<dm){dm=d;bi=k}
      }
      const hw=rv.hw[bi];
      if(dm<hw+6)v=Math.max(v, clamp((hw+6-dm)/8,0,1.1));
    }
    WFa[j*s+i]=v;
  }
  return {WF:WFa,WL:WLa,rivers,island};
}
function snapPlacesToLand(places,WF){
  const dry=(x,y)=>x>22&&x<MAPW-22&&y>22&&y<MAPW-22&&fieldAt(WF,x,y)<WTHR-.08;
  const shore=(x,y)=>{
    if(!dry(x,y))return false;
    for(let a=0;a<Math.PI*2;a+=Math.PI/8)
      if(fieldAt(WF,x+Math.cos(a)*18,y+Math.sin(a)*18)>WTHR)return true;
    return false;
  };
  for(const p of places){
    const valid=p.cat==='porto'?shore:dry;
    if(valid(p.x,p.y))continue;
    let best=null;
    for(let rad=6;rad<=1.15*CELL&&!best;rad+=6){
      for(let a=0;a<Math.PI*2;a+=Math.PI/18){
        const x=p.x+Math.cos(a)*rad,y=p.y+Math.sin(a)*rad;
        if(valid(x,y)){best=[x,y];break}
      }
    }
    if(best){p.x=best[0];p.y=best[1];p.gx=toBoard(p.x);p.gy=toBoard(p.y)}
  }
}
function nearWaterCell(p,waterCells,maxDist=1.8){
  return waterCells.some(([r,c])=>Math.hypot(r-p.r,c-p.c)<=maxDist);
}

/* ---------------- quartieri ---------------- */
function makeDistricts(places,F,centre){
  const n=clamp(Math.round(places.length/2),3,7);
  const seeds=[places[0]];
  while(seeds.length<n&&seeds.length<places.length){
    let best=null;
    for(const p of places){
      const d=Math.min(...seeds.map(s=>dist([s.x,s.y],[p.x,p.y])));
      if(!best||d>best.d)best={p,d};
    }
    seeds.push(best.p);
  }
  let sxx=0,sxy=0,syy=0;
  for(const p of places){const dx=p.x-centre[0],dy=p.y-centre[1];sxx+=dx*dx;sxy+=dx*dy;syy+=dy*dy}
  const baseTheta=.5*Math.atan2(2*sxy,sxx-syy);
  const D=seeds.map((s,i)=>{
    const radial=Math.atan2(s.y-centre[1],s.x-centre[0]);
    const theta=baseTheta+Math.sin(radial*2)*.11;
    return {i,x:s.x,y:s.y,theta,spacing:rr(25,34),
      name:'Quartiere '+(GROUP_NAME[CAT[s.cat]?.group]||word()),num:i+1,sx:0,sy:0,n:0};
  });
  for(let y=0;y<MAPW;y+=12)for(let x=0;x<MAPW;x+=12){
    if(fieldAt(F,x,y)<=THR)continue;
    const d=nearestD(D,x,y);d.sx+=x;d.sy+=y;d.n++;
  }
  for(const d of D){if(d.n){d.cx=d.sx/d.n;d.cy=d.sy/d.n}else{d.cx=d.x;d.cy=d.y}}
  return D.filter(d=>d.n>40);
}
function nearestD(D,x,y){
  if(!D.length)return {x,y,theta:0,cx:x,cy:y,num:0,name:''};
  let b=D[0],bd=Infinity;
  for(const d of D){const q=(d.x-x)**2+(d.y-y)**2;if(q<bd){bd=q;b=d}}
  return b;
}

/* ---------------- infrastrutture puntuali ---------------- */
function waterRunsOnPath(pts,WF){
  const dense=densify(pts,4),runs=[];let run=[];
  for(let i=0;i<dense.length;i++){
    const p=dense[i],wet=fieldAt(WF,p[0],p[1])>WTHR-.04;
    if(wet){if(!run.length&&i)run.push(dense[i-1]);run.push(p)}
    else if(run.length){run.push(p);if(polyLen(run)>8)runs.push(run);run=[]}
  }
  if(run.length&&polyLen(run)>8)runs.push(run);
  return runs;
}
function makeDock(p,WF){
  let best=null;
  for(let a=0;a<Math.PI*2;a+=.2)for(let d=20;d<1.6*CELL;d+=10){
    const x=p.x+Math.cos(a)*d,y=p.y+Math.sin(a)*d;
    if(fieldAt(WF,x,y)>WTHR){if(!best||d<best.d)best={a,d,x,y};break}
  }
  if(!best)return null;
  const piers=[];
  for(let k=-1;k<=1;k++){
    const a=best.a+k*.22;
    piers.push([[p.x+Math.cos(a)*(best.d-4),p.y+Math.sin(a)*(best.d-4)],
                [p.x+Math.cos(a)*(best.d+24),p.y+Math.sin(a)*(best.d+24)]]);
  }
  return {p,piers};
}

/* ---------------- periferia: borghi, campi, cascinali ---------------- */
function makeVillages(subs){
  return subs.map(s=>{
    const r=rr(20,34), a0=rr(0,Math.PI);
    const st=[[[s.x-Math.cos(a0)*r*1.6, s.y-Math.sin(a0)*r*1.6],
               [s.x+Math.cos(a0)*r*1.6, s.y+Math.sin(a0)*r*1.6]]];
    if(RND()<.6){const a1=a0+Math.PI/2+rr(-.4,.4);
      st.push([[s.x-Math.cos(a1)*r, s.y-Math.sin(a1)*r],[s.x+Math.cos(a1)*r, s.y+Math.sin(a1)*r]]);}
    const bld=[];
    for(let k=0;k<16;k++){
      const t=rr(-1,1), off=(RND()<.5?1:-1)*rr(5,13);
      const x=s.x+Math.cos(a0)*r*1.4*t - Math.sin(a0)*off;
      const y=s.y+Math.sin(a0)*r*1.4*t + Math.cos(a0)*off;
      bld.push({x,y,w:rr(4,8),h:rr(3.5,6.5),r:a0*180/Math.PI+rr(-14,14)});
    }
    return {...s, r, st, bld, church:RND()<.7};
  });
}
function makeFields(F,WF,villages){
  const out=[];
  const free=(x,y)=> x>16&&x<MAPW-16&&y>16&&y<MAPW-16
    && fieldAt(F,x,y)<THR*.5 && fieldAt(WF,x,y)<WTHR
    && !villages.some(v=>dist([v.x,v.y],[x,y])<v.r+12);
  for(let k=0;k<40;k++){
    const cx=rr(30,MAPW-30), cy=rr(30,MAPW-30);
    if(!free(cx,cy))continue;
    const R=rr(55,115), th=rr(0,Math.PI), sp=rr(9,15);
    const ux=Math.cos(th),uy=Math.sin(th),vx=-uy,vy=ux;
    for(let t=-R;t<=R;t+=sp){
      let run=[];
      for(let s2=-R;s2<=R;s2+=6){
        const x=cx+vx*t+ux*s2, y=cy+vy*t+uy*s2;
        if(Math.hypot(x-cx,y-cy)<R && free(x,y))run.push([x,y]);
        else{ if(run.length>3)out.push(run); run=[] }
      }
      if(run.length>3)out.push(run);
    }
  }
  return out;
}
function makeFarms(F,WF,villages){
  const out=[];
  for(let k=0;k<200&&out.length<14;k++){
    const x=rr(40,MAPW-40), y=rr(40,MAPW-40);
    if(fieldAt(F,x,y)>THR*.5||fieldAt(WF,x,y)>WTHR)continue;
    if(villages.some(v=>dist([v.x,v.y],[x,y])<v.r+40))continue;
    if(out.some(o=>dist([o.x,o.y],[x,y])<80))continue;
    out.push({x,y,a:rr(-25,25)});
  }
  return out;
}
function makeSuburbs(F,centre,WF){
  const S=[];
  for(let k=0;k<400&&S.length<11;k++){
    const x=rr(50,MAPW-50), y=rr(50,MAPW-50);
    if(fieldAt(F,x,y)>THR*.32||fieldAt(WF,x,y)>WTHR-.08)continue;
    if(dist([x,y],centre)<3.2*CELL)continue;
    if(S.some(s=>dist([s.x,s.y],[x,y])<150))continue;
    S.push({x,y,name:suburbName()});
  }
  return S;
}
function suburbName(){
  const s=RND();
  if(s<.3)return (word()+'-'+word()).toUpperCase();
  if(s<.55)return (pick(NB.pre)+' '+word()).toUpperCase();
  return word().toUpperCase();
}
function makeFillers(F,inWater,places){
  const out=[],kinds=['H','H','H','stadio','scuola','scuola','H'];
  for(let k=0;k<160&&out.length<9;k++){
    const x=rr(110,MAPW-110), y=rr(110,MAPW-110);
    if(fieldAt(F,x,y)<THR+.25||inWater(x,y))continue;
    if(places.some(p=>dist([p.x,p.y],[x,y])<80))continue;
    if(out.some(o=>dist([o.x,o.y],[x,y])<130))continue;
    out.push({x,y,kind:pick(kinds)});
  }
  return out;
}

/* ---------------- strade di campagna (verso i borghi) ---------------- */
function routeRoadCore(a,b,F,WF,bridges,terr,used){
  const RS=18, cols=Math.floor(MAPW/RS)+1, rows=cols, total=cols*rows;
  const point=i=>[(i%cols)*RS,((i/cols)|0)*RS];
  const bridgeAt=(x,y)=>(bridges||[]).some(br=>distSeg([x,y],br.a,br.b)<23);
  const passable=(x,y)=>x>=18&&x<=MAPW-18&&y>=18&&y<=MAPW-18
    &&(fieldAt(WF,x,y)<WTHR-.03||bridgeAt(x,y));
  const nearestNode=p=>{
    const ci=clamp(Math.round(p[0]/RS),1,cols-2),cj=clamp(Math.round(p[1]/RS),1,rows-2);
    let best=null;
    for(let rad=0;rad<=4&&!best;rad++)for(let dj=-rad;dj<=rad;dj++)for(let di=-rad;di<=rad;di++){
      const i=ci+di,j=cj+dj;if(i<1||i>=cols-1||j<1||j>=rows-1)continue;
      const q=[i*RS,j*RS];if(passable(q[0],q[1]))best=j*cols+i;
    }
    return best;
  };
  const start=nearestNode(a),goal=nearestNode(b);if(start==null||goal==null)return null;
  const mountains=(terr.mountain||[]).map(([r,c])=>[W(c+.5),W(r+.5)]);
  const g=new Float64Array(total);g.fill(Infinity);
  const prev=new Int32Array(total);prev.fill(-1);
  const closed=new Uint8Array(total),heap=[];
  const push=(id,f)=>{
    let i=heap.length;heap.push({id,f});
    while(i){const p=(i-1)>>1;if(heap[p].f<=f)break;heap[i]=heap[p];i=p;heap[i]={id,f}}
  };
  const pop=()=>{
    const root=heap[0],last=heap.pop();if(heap.length){
      heap[0]=last;let i=0;
      while(true){let l=i*2+1,r=l+1,m=i;if(l<heap.length&&heap[l].f<heap[m].f)m=l;if(r<heap.length&&heap[r].f<heap[m].f)m=r;if(m===i)break;[heap[i],heap[m]]=[heap[m],heap[i]];i=m}
    }return root;
  };
  const gp=point(goal);g[start]=0;push(start,0);
  const dirs=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
  while(heap.length){
    const cur=pop(),u=cur.id;if(closed[u])continue;closed[u]=1;if(u===goal)break;
    const ui=u%cols,uj=(u/cols)|0;
    for(const [di,dj] of dirs){
      const ni=ui+di,nj=uj+dj;if(ni<1||ni>=cols-1||nj<1||nj>=rows-1)continue;
      const v=nj*cols+ni,[x,y]=point(v);if(!passable(x,y)||closed[v])continue;
      const from=point(u);
      if(!densify([from,[x,y]],2).every(p=>passable(p[0],p[1])))continue;
      if(di&&dj){
        const p1=point(uj*cols+ni),p2=point(nj*cols+ui);
        if(!passable(p1[0],p1[1])||!passable(p2[0],p2[1]))continue;
      }
      let cost=Math.hypot(di,dj);
      const urban=fieldAt(F,x,y);cost*=1+clamp((THR-urban)*3,0,2.2);
      for(const m of mountains){const d=dist([x,y],m);if(d<CELL*.8)cost+=5*(1-d/(CELL*.8))}
      if(used.has(v))cost*=.42;
      const ng=g[u]+cost;if(ng>=g[v])continue;
      g[v]=ng;prev[v]=u;push(v,ng+dist([x,y],gp)/RS);
    }
  }
  if(prev[goal]<0&&start!==goal)return null;
  const ids=[];for(let u=goal;u>=0;u=prev[u]){ids.push(u);if(u===start)break}
  ids.reverse();ids.forEach(i=>used.add(i));
  let pts=ids.map(point);
  const clear=(p,q)=>densify([p,q],2).every(z=>passable(z[0],z[1]));
  const simple=[];
  for(let i=0;i<pts.length;){
    simple.push(pts[i]);let j=pts.length-1;while(j>i+1&&!clear(pts[i],pts[j]))j--;i=j;
    if(i===pts.length-1)break;
  }
  if(!clear(a,simple[0])||!clear(simple[simple.length-1],b))return null;
  simple[0]=a;simple[simple.length-1]=b;
  if(!densify(simple,.75).every(p=>passable(p[0],p[1])))return null;
  return simple;
}
function routeRoad(a,b,F,WF,bridges,terr,used){
  const search=(start,end,available,depth)=>{
    const dry=routeRoadCore(start,end,F,WF,[],terr,new Set(used));
    if(dry)return dry;
    if(depth<=0)return null;
    let best=null;
    const candidates=available.slice().sort((x,y)=>
      Math.min(dist(start,x.a),dist(start,x.b))-Math.min(dist(start,y.a),dist(start,y.b)));
    for(const br of candidates){
      const rest=available.filter(x=>x!==br);
      for(const [A,B] of [[br.a,br.b],[br.b,br.a]]){
        const left=routeRoadCore(start,A,F,WF,[],terr,new Set(used));
        if(!left)continue;
        const tail=search(B,end,rest,depth-1);if(!tail)continue;
        const pts=left.concat([A,B],tail.slice(1)),L=polyLen(pts);
        if(!best||L<best.L)best={pts,L};
      }
    }
    return best?best.pts:null;
  };
  return search(a,b,(bridges||[]).slice(),Math.min(4,(bridges||[]).length));
}
function directRoad(a,b,WF,bridges,terr){
  const L=dist(a,b);if(L<20)return [a,b];
  const dx=(b[0]-a[0])/L,dy=(b[1]-a[1])/L,nx=-dy,ny=dx;
  const bend=Math.sin((a[0]+a[1]*3+b[0]*5+b[1]*7)*.017)*Math.min(22,L*.055);
  const mid=[(a[0]+b[0])/2+nx*bend,(a[1]+b[1])/2+ny*bend];
  const mountains=(terr.mountain||[]).map(([r,c])=>[W(c+.5),W(r+.5)]);
  const bridgeAt=p=>(bridges||[]).some(br=>distSeg(p,br.a,br.b)<7);
  const clear=densify([a,mid,b],.75).every(p=>
    p[0]>=18&&p[0]<=MAPW-18&&p[1]>=18&&p[1]<=MAPW-18
    &&(fieldAt(WF,p[0],p[1])<WTHR-.03||bridgeAt(p))
    &&!mountains.some(m=>dist(p,m)<CELL*.42));
  return clear?[a,mid,b]:null;
}

/* ---------------- macchie organiche (rilievi) ---------------- */
function blob(x,y,r){
  const pts=[],n=16;
  for(let i=0;i<n;i++){
    const a=i/n*Math.PI*2, rad=r*rr(.78,1.22);
    pts.push([x+Math.cos(a)*rad, y+Math.sin(a)*rad]);
  }
  return {x,y,r,poly:chaikin(pts,2)};
}
