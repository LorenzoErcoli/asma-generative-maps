"use strict";
/* =====================================================================
   RENDER — layer SVG. La città vera e propria (strade/edifici/piazze/
   ponti/ferrovia dentro il tessuto) è disegnata dalle funzioni tessuto*,
   che riusano la stessa logica del prototipo. Tutto il resto (campagna,
   quartieri, tipografia, cornice) riusa quasi verbatim index.html: sono
   indipendenti dal motore che genera il tessuto, quindi non serve
   riscriverli.
   ===================================================================== */

/* ---------------- città: strade, edifici, piazze/giardini, ponti ---------------- */
// stessa classificazione visiva del prototipo: un corso e' fatto di isolati
// allineati in fila (majorRoute, da classifyMajorRoutes), o un taglio di
// profondita' 0-1, o semplicemente lungo. Il fiancheggiamento della
// ferrovia (sidetrack) resta sempre locale anche se lungo quanto il binario.
function streetRank(c){
  const len=dist(c.pts[0],c.pts[1]);
  if(c.rank==='sidetrack')return 'via';
  if(c.rank==='bridgehead'||c.majorRoute||c.depth<=1||len>190)return 'corso';
  if(c.depth>=6&&len<48)return 'vicolo';
  return 'via';
}
function tessutoStreetsLayer(out,P){
  let s='<g stroke-linecap="round" fill="none">';
  for(const c of out.streets){
    if(c.phase==='lot')continue;
    const rank=streetRank(c);
    const w=rank==='corso'?5.4:rank==='vicolo'?1.5:2.7;
    const col=rank==='corso'?P.major:rank==='vicolo'?P.builtLn:P.street;
    s+=`<path d="M${F1(c.pts[0][0])} ${F1(c.pts[0][1])} L${F1(c.pts[1][0])} ${F1(c.pts[1][1])}" stroke="${col}" stroke-width="${w}"/>`;
  }
  return s+'</g>';
}
function tessutoQuaysLayer(out,P){
  let s=`<g stroke="${P.builtLn}" stroke-width="1.5" stroke-dasharray="1 3" fill="none">`;
  for(const q of out.quays)s+=`<path d="${dPoly(q,false)}"/>`;
  return s+'</g>';
}
function tessutoBuildingsLayer(out,P){
  let s='<g stroke-linejoin="round">';
  for(const b of out.buildings){
    // footprintParts non implica piu' per forza un landmark vero: anche un
    // palazzo comune puo' avere una pianta piu' articolata (vedi i palazzi
    // complessi sparsi), col colore normale invece che quello del landmark.
    if(b.footprintParts){
      const fill=b.landmark?(LANDMARK_FILL[b.landmark.cat]||P.built):P.built;
      const stroke=b.landmark?P.ink:P.builtLn;
      for(const part of b.footprintParts){
        const d=part.hole? dPoly(part.poly,true)+' '+dPoly(part.hole,true) : dPoly(part.poly,true);
        s+=`<path d="${d}" fill="${fill}" fill-rule="evenodd" stroke="${stroke}" stroke-width="${b.landmark?1:.5}"/>`;
      }
    }else if(b.A>=MIN_BUILDING_DRAW){
      const rect=rectFootprint(b.poly,.84);
      if(polyArea(rect)>=b.A*RECT_ACCEPT){
        s+=`<path d="${dPoly(rect,true)}" fill="${P.built}" stroke="${P.builtLn}" stroke-width=".5"/>`;
      }else{
        const yard=scalePoly(b.poly,b.c,.88);
        s+=`<path d="${dPoly(yard,true)}" fill="${P.void}" stroke="${P.builtLn}" stroke-width=".5" stroke-dasharray="2 2"/>`;
      }
    }
  }
  return s+'</g>';
}
// tinta unita per le piazze: un reticolo di pavimentazione a quella scala
// si leggeva come un errore (un puntinato grigio), non come una piazza. Un
// colore pieno, a meta' tra il rosa dei palazzi e il crema della carta, si
// distingue subito sia dal costruito sia dal terreno libero.
function mixHex(a,b,t){
  const pa=parseInt(a.slice(1),16), pb=parseInt(b.slice(1),16);
  const ar=(pa>>16)&255, ag=(pa>>8)&255, ab=pa&255;
  const br=(pb>>16)&255, bg=(pb>>8)&255, bb=pb&255;
  const mix=(x,y)=>Math.round(x+(y-x)*t);
  return '#'+[mix(ar,br),mix(ag,bg),mix(ab,bb)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
const PIAZZA_FILL=P=>mixHex(P.built,P.paper,.55);
function tessutoReservedLayer(out,P){
  let s='';
  for(const r of out.reserved){
    const fill=r.type==='piazza'?PIAZZA_FILL(P):r.type==='giardino'||r.type==='verde'||r.type==='collina'?P.green
      :r.type==='fontana'?P.water:'url(#ceme)';
    const stroke=r.type==='piazza'?P.ink:r.type==='fontana'?P.waterLn:r.type==='cimitero'?P.greenDk:P.greenDk;
    s+=`<path d="${dPoly(r.shapePoly||r.poly,true)}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`;
  }
  return s;
}
// una collina in citta' e' terreno, non un prato piatto: un paio di curve
// di livello (copie concentriche ristrette verso il centro, stesso
// linguaggio grafico di reliefLayer per collina/montagna in campagna) bastano
// a leggerla come rilievo vero senza inventare un motore di ombreggiatura.
function collinaContourLayer(out,P){
  let s='';
  for(const r of out.reserved){
    if(r.type!=='collina')continue;
    const poly=r.shapePoly||r.poly, c=centroid(poly);
    for(const k of [.68,.4]){
      const ring=scalePoly(poly,c,k);
      s+=`<path d="${dPoly(ring,true)}" fill="none" stroke="${P.greenDk}" stroke-width="1" opacity=".5"/>`;
    }
  }
  return s;
}
// un giardino vuoto e verde non si legge come "curato": un vialetto che lo
// attraversa o una piccola fontana al centro bastano a suggerire che
// qualcuno ci passeggia davvero, non solo un ritaglio di prato.
function gardenDetailsLayer(out,P){
  let s='';
  for(const r of out.reserved){
    if(r.type!=='giardino')continue;
    const poly=r.shapePoly||r.poly;
    const ext=orientedExtent(poly);
    if(RND()<.55){
      const steps=12,pts=[],phase=rr(0,Math.PI*2);
      for(let i=0;i<=steps;i++){
        const t=i/steps, along=(t-.5)*ext.maxA*1.7;
        const wob=Math.sin(t*Math.PI*2.4+phase)*ext.maxN*.32;
        pts.push(addv(ext.c,ext.dirVec,along,ext.nVec,wob));
      }
      const clipped=pts.filter(p=>inPoly(p,poly));
      if(clipped.length>=2)
        s+=`<path d="${dPoly(clipped,false)}" fill="none" stroke="${P.builtLn}" stroke-width="1.3" stroke-dasharray="1 2.6" opacity=".75"/>`;
    }else{
      const r2=Math.min(ext.maxA,ext.maxN)*.22,steps=8,pts=[];
      for(let i=0;i<steps;i++){const t=i/steps*Math.PI*2;pts.push(addv(ext.c,ext.dirVec,Math.cos(t)*r2,ext.nVec,Math.sin(t)*r2))}
      s+=`<path d="${dPoly(pts,true)}" fill="${P.water}" stroke="${P.waterLn}" stroke-width="1"/>`;
    }
  }
  return s;
}
function tessutoBridgesLayer(bridges,P){
  let s='';
  for(const b of bridges){
    s+=`<line x1="${F1(b.deckA[0])}" y1="${F1(b.deckA[1])}" x2="${F1(b.deckB[0])}" y2="${F1(b.deckB[1])}" stroke="${P.ink}" stroke-width="9" stroke-linecap="butt"/>`;
    s+=`<line x1="${F1(b.deckA[0])}" y1="${F1(b.deckA[1])}" x2="${F1(b.deckB[0])}" y2="${F1(b.deckB[1])}" stroke="${P.major}" stroke-width="6" stroke-linecap="butt"/>`;
  }
  return s;
}
function tessutoRailLayer(rail,river,P){
  if(!rail)return '';
  let s='<g fill="'+P.builtLn+'">';
  for(const[a,b]of rail.segments){
    const dx=b[0]-a[0],dy=b[1]-a[1],L=Math.hypot(dx,dy)||1,nx=-dy/L*RAIL_HW,ny=dx/L*RAIL_HW;
    const ribbon=[[a[0]-nx,a[1]-ny],[b[0]-nx,b[1]-ny],[b[0]+nx,b[1]+ny],[a[0]+nx,a[1]+ny]];
    s+=`<path d="${dPoly(ribbon,true)}"/>`;
  }
  s+='</g>';
  s+=`<g stroke="${P.rail}" stroke-width="1.1" fill="none" stroke-dasharray=".8 4.5">`;
  for(const seg of rail.segments)
    s+=`<path d="M${F1(seg[0][0])} ${F1(seg[0][1])} L${F1(seg[1][0])} ${F1(seg[1][1])}"/>`;
  s+='</g>';
  s+=`<g stroke="${P.rail}" stroke-width=".8">`;
  for(const[a,b]of rail.segments){
    const dx=b[0]-a[0],dy=b[1]-a[1],L=Math.hypot(dx,dy)||1,ux=dx/L,uy=dy/L,nx=-uy,ny=ux;
    const n=Math.max(1,Math.floor(L/16));
    for(let k=1;k<n;k++){const t=k/n,x=a[0]+dx*t,y=a[1]+dy*t;
      s+=`<line x1="${F1(x-nx*2.2)}" y1="${F1(y-ny*2.2)}" x2="${F1(x+nx*2.2)}" y2="${F1(y+ny*2.2)}"/>`;}
  }
  s+='</g>';
  if(river)for(const[a,b]of rail.segments){
    const cross=segCrossesRiver(a,b,river);
    if(!cross)continue;
    const dx=b[0]-a[0],dy=b[1]-a[1],L=Math.hypot(dx,dy)||1,ux=dx/L,uy=dy/L;
    const hwLocal=riverAt(river,cross).hw;
    const p0=[cross[0]-ux*hwLocal*1.15,cross[1]-uy*hwLocal*1.15], p1=[cross[0]+ux*hwLocal*1.15,cross[1]+uy*hwLocal*1.15];
    s+=`<line x1="${F1(p0[0])}" y1="${F1(p0[1])}" x2="${F1(p1[0])}" y2="${F1(p1[1])}" stroke="${P.ink}" stroke-width="5" stroke-linecap="butt"/>`;
    s+=`<line x1="${F1(p0[0])}" y1="${F1(p0[1])}" x2="${F1(p1[0])}" y2="${F1(p1[1])}" stroke="${P.rail}" stroke-width="1.1" stroke-dasharray=".8 4.5"/>`;
  }
  return s;
}
function tessutoLabelsLayer(out,P){
  let s=`<g font-size="10" fill="${P.ink}" text-anchor="middle" paint-order="stroke" stroke="${P.paper}" stroke-width="3">`;
  for(const r of out.reserved)if(r.name){
    const cx=r.poly.reduce((s2,p)=>s2+p[0],0)/r.poly.length, cy=r.poly.reduce((s2,p)=>s2+p[1],0)/r.poly.length;
    s+=`<text x="${F1(cx)}" y="${F1(cy+3)}">${esc(r.name)}</text>`;
  }
  return s+'</g>';
}

/* ---------------- tipografia stradale (arterie del tessuto) ----------------
   costruisce un elenco "chains"-like a partire da out.streets, con la
   stessa logica di scelta nomi/textPath del monolite originale. */
function tessutoStreetChains(out){
  const chains=out.streets.filter(c=>c.phase!=='lot');
  let i=0;
  for(const c of chains){
    const rank=streetRank(c);
    const big=rank==='corso';
    const L=dist(c.pts[0],c.pts[1]);
    if(!(big?L>90:(L>140&&RND()<.42)))continue;
    c.name=streetName(big);
    c.pid='t'+(i++);
    c._rank=rank;
  }
  return chains;
}
function tessutoDefs(chains){
  let d='';
  for(const c of chains){
    if(!c.pid)continue;
    const pts=(c.pts[0][0]<=c.pts[1][0])?c.pts:c.pts.slice().reverse();
    d+=`<path id="${c.pid}" d="${dPoly(pts,0)}" fill="none"/>`;
  }
  return d;
}
function tessutoStreetNames(chains,P){
  let s=`<g fill="${P.ink}">`;
  for(const c of chains){
    if(!c.pid)continue;
    const big=c._rank==='corso';
    s+=`<text font-size="${big?7.6:5.2}" fill="${P.ink}" opacity="${big?.7:.48}" ${big?'font-style="italic" letter-spacing=".4"':''}>
      <textPath href="#${c.pid}" startOffset="30%">${esc(c.name)}</textPath></text>`;
  }
  return s+'</g>';
}

/* ---------------- tessuto lungofiume -----------------
   il taglio della ricorsione contro il fiume usa una retta locale; dove la
   riva vera curva di piu' di quella retta, resta uno spiazzo vuoto (mai
   diventato edificio ne' cortile — nessun poligono lo copre affatto).
   Anziche' rifare il taglio (rischioso: vedi cronologia — un tentativo con
   la polilinea vera ha peggiorato le cose, il taglio in sequenza si
   comporta come un inviluppo convesso su un fiume che non lo e'), si
   ricopre lo spiazzo DOPO — non con una pavimentazione decorativa, ma con
   vere casette e qualche piazzetta, una fila affacciata sull'acqua come
   in una citta' vera. E' un rimedio sicuro per costruzione: si disegna
   SOTTO gli edifici e le strade veri, quindi dove esistono gia' li
   ricoprono loro — la fila si vede solo esattamente dove prima non c'era
   nulla, e non puo' mai sovrapporsi a un vero incrocio o palazzo. */
// test geometrici minimi per verificare che una casetta candidata non
// sconfini in nulla: senza questo, le forme finivano piazzate a caso,
// una sopra l'altra o dentro un palazzo vero — l'esatto contrario di un
// tessuto urbano vero, dove ogni edificio ha il suo spazio.
function segIntersect(p1,p2,p3,p4){
  const d1=(p4[0]-p3[0])*(p1[1]-p3[1])-(p4[1]-p3[1])*(p1[0]-p3[0]);
  const d2=(p4[0]-p3[0])*(p2[1]-p3[1])-(p4[1]-p3[1])*(p2[0]-p3[0]);
  const d3=(p2[0]-p1[0])*(p3[1]-p1[1])-(p2[1]-p1[1])*(p3[0]-p1[0]);
  const d4=(p2[0]-p1[0])*(p4[1]-p1[1])-(p2[1]-p1[1])*(p4[0]-p1[0]);
  return((d1>0&&d2<0)||(d1<0&&d2>0))&&((d3>0&&d4<0)||(d3<0&&d4>0));
}
function polysOverlap(a,b){
  for(const p of a)if(inPoly(p,b))return true;
  for(const p of b)if(inPoly(p,a))return true;
  for(let i=0;i<a.length;i++){
    const a1=a[i],a2=a[(i+1)%a.length];
    for(let j=0;j<b.length;j++)
      if(segIntersect(a1,a2,b[j],b[(j+1)%b.length]))return true;
  }
  return false;
}
// palazzi dalle forme piu' curiose (L, cortile, croce) quando c'e' spazio
// per starci — stesso principio dei landmark veri (landmarkFootprint), solo
// scelte a caso invece che dalla categoria della pedina. "outer" e' sempre
// il rettangolo pieno d'ingombro: usato solo per il test di spazio libero,
// mai per il disegno.
function localToWorld(c,tv,nv,pts){return pts.map(([a,n])=>addv(c,tv,a,nv,n))}
function fancyRiverShape(c,tv,nv){
  const roll=RND();
  if(roll<.4){
    const A=rr(12,17),N=rr(9,13);
    return{parts:[{poly:rectAt(c,tv,nv,A,N),hole:null}],outer:rectAt(c,tv,nv,A,N)};
  }
  if(roll<.65){
    const A=rr(13,18),N=rr(11,15),a2=rr(6,9),n2=rr(6,9);
    const poly=localToWorld(c,tv,nv,[[-A,-N],[A,-N],[A,N-n2],[A-a2,N-n2],[A-a2,N],[-A,N]]);
    return{parts:[{poly,hole:null}],outer:rectAt(c,tv,nv,A,N)};
  }
  if(roll<.85){
    const A=rr(14,19),N=rr(12,16);
    const outer=rectAt(c,tv,nv,A,N), inner=rectAt(c,tv,nv,A*.5,N*.5);
    return{parts:[{poly:outer,hole:inner}],outer};
  }
  const A=rr(13,17),N=rr(11,14);
  return{parts:[{poly:rectAt(c,tv,nv,A,N*.4),hole:null},{poly:rectAt(c,tv,nv,A*.4,N),hole:null}],outer:rectAt(c,tv,nv,A,N)};
}
function riverbankRowShapes(river,out){
  const shapes=[],placed=[];
  // controllo di spazio libero vero, ma con piu' tentativi in cascata: prima
  // una forma grande e curiosa, poi (se non ci sta) una casetta semplice
  // piu' piccola, solo alla fine si arrende — la fila tornava piena di buchi
  // anche dove c'era spazio poco oltre, perche' al primo affondo bloccato
  // (un edificio vero che sporge un po' verso il fiume) si passava oltre
  // senza riprovare piu' piccolo o piu' vicino/lontano dal fiume.
  const spaceFree=(poly,c)=>{
    for(const b of out.buildings){if(dist(b.c,c)>75)continue;if(polysOverlap(poly,b.poly))return false}
    for(const rz of out.reserved){const rp=rz.shapePoly||rz.poly,rc=centroid(rp);if(dist(rc,c)>75)continue;if(polysOverlap(poly,rp))return false}
    for(const s of out.streets){if(s.phase==='lot')continue;const mid=[(s.pts[0][0]+s.pts[1][0])/2,(s.pts[0][1]+s.pts[1][1])/2];if(dist(mid,c)>42)continue;if(distSeg(c,s.pts[0],s.pts[1])<7)return false}
    for(const pl of placed){if(dist(pl.c,c)>58)continue;if(polysOverlap(poly,pl.outer))return false}
    return true;
  };
  const tryPlace=(c,tv,nv,preferPiazzetta)=>{
    const ri=riverAt(river,c);
    if(Math.abs(ri.side)<=ri.hw)return null;
    if(preferPiazzetta){
      const poly=rectAt(c,tv,nv,rr(11,15),rr(9,12));
      return spaceFree(poly,c)?{parts:[{poly,hole:null}],outer:poly,kind:'piazzetta'}:null;
    }
    const fancy=fancyRiverShape(c,tv,nv);
    if(spaceFree(fancy.outer,c))return{...fancy,kind:'house'};
    const small=rectAt(c,tv,nv,rr(8,12),rr(6,9));
    if(spaceFree(small,c))return{parts:[{poly:small,hole:null}],outer:small,kind:'house'};
    return null;
  };
  for(const side of[-1,1]){
    let lastPt=null;
    for(let i=0;i<river.pts.length;i++){
      const p=river.pts[i];
      if(lastPt&&dist(p,lastPt)<rr(16,21))continue;
      lastPt=p;
      const lo=Math.max(0,i-3), hi=Math.min(river.pts.length-1,i+3);
      const a=river.pts[lo], b=river.pts[hi];
      const tv=norm([b[0]-a[0],b[1]-a[1]]);
      const nv=[-tv[1]*side,tv[0]*side];
      const hw=river.hw[i];
      for(let attempt=0;attempt<5;attempt++){
        const depth=hw+8+attempt*15+rr(0,7);
        const c=[p[0]+nv[0]*depth,p[1]+nv[1]*depth];
        const preferPiazzetta=attempt===0&&RND()<.09;
        const placedShape=tryPlace(c,tv,nv,preferPiazzetta);
        if(!placedShape)continue;
        placed.push({outer:placedShape.outer,c});
        shapes.push(placedShape);
        break;
      }
    }
  }
  return shapes;
}
function riverbankFillLayer(river,P,out){
  if(!river)return '';
  let s='';
  for(const sh of riverbankRowShapes(river,out)){
    const fill=sh.kind==='piazzetta'?PIAZZA_FILL(P):P.built;
    const stroke=sh.kind==='piazzetta'?P.ink:P.builtLn;
    for(const part of sh.parts){
      const d=part.hole?dPoly(part.poly,true)+' '+dPoly(part.hole,true):dPoly(part.poly,true);
      s+=`<path d="${d}" fill="${fill}" fill-rule="evenodd" stroke="${stroke}" stroke-width=".5"/>`;
    }
  }
  return s;
}

/* ---------------- acqua, rilievi, campagna (riusati da index.html) ---------------- */
function waterLayer(loops,rivers,waterComps,docks){
  let s='';
  const waters=loops.concat(rivers.map(rv=>rv.poly));
  for(const poly of waters)s+=`<path d="${dPoly(poly,1)}" fill="url(#onde)" stroke="none"/>`;
  for(const poly of waters)s+=`<path d="${dPoly(poly,1)}" fill="none" stroke-width="1.5"/>`;
  for(const rv of rivers.filter(r=>r.tributary)){
    const p=rv.pts[rv.pts.length-1],r=(rv.hw[rv.hw.length-1]||9)+3;
    s+=`<circle cx="${F1(p[0])}" cy="${F1(p[1])}" r="${F1(r)}" fill="url(#onde)"/>`;
  }
  for(const l of loops)s+=`<path d="${dPoly(l,1)}" fill="none" stroke-width=".8" opacity=".45" stroke-dasharray="1 3" transform="translate(0,2)"/>`;
  for(const d of docks){
    for(const [a,b] of d.piers)
      s+=`<path d="M${F1(a[0])} ${F1(a[1])} L${F1(b[0])} ${F1(b[1])}" stroke-width="2.2" opacity=".7" stroke-linecap="round"/>`;
  }
  return s;
}
function reliefLayer(terr,P){
  let s='';
  for(const cl of comps(terr.hill)){
    for(const [r,c] of cl){
      const x=W(c+.5),y=W(r+.5);
      s+=`<path d="${dPoly(blob(x,y,CELL*.56).poly,1)}" fill="${P.green}" opacity=".3" stroke="none"/>`;
    }
    for(const [r,c] of cl){
      const x=W(c+.5),y=W(r+.5);
      for(let k=-1;k<=1;k++)
        s+=`<path d="M${F1(x-30)} ${F1(y+k*15+6)} q14 -11 28 0 q10 -8 22 2" fill="none" stroke="${P.greenDk}" stroke-width="1" opacity=".65"/>`;
    }
  }
  for(const cl of comps(terr.mountain)){
    for(const [r,c] of cl){
      const x=W(c+.5),y=W(r+.5);
      s+=`<path d="${dPoly(blob(x,y,CELL*.6).poly,1)}" fill="${P.ink}" opacity=".06" stroke="none"/>`;
    }
    for(const [r,c] of cl){
      const x=W(c+.5),y=W(r+.5);
      for(let k=0;k<3;k++){
        const ox=rr(-28,28),oy=rr(-16,16),w=rr(17,27),h=rr(15,25);
        const ax=x+ox, ay=y+oy;
        s+=`<path d="M${F1(ax-w)} ${F1(ay+h*.5)} L${F1(ax)} ${F1(ay-h)} L${F1(ax+w)} ${F1(ay+h*.5)} Z"
              fill="${P.land}" stroke="${P.ink}" stroke-width="1.1"/>`;
        for(let t=.2;t<.9;t+=.22)
          s+=`<path d="M${F1(ax+w*t*.1)} ${F1(ay-h+ (h*1.5)*t)} L${F1(ax+w*t)} ${F1(ay+h*.5)}"
                stroke="${P.ink}" stroke-width=".55" opacity=".45" fill="none"/>`;
      }
    }
  }
  return s;
}
function countryside(villages,country,fields,farms,P){
  let s='';
  s+=`<g stroke="${P.greenDk}" stroke-width=".6" fill="none" opacity=".17">`;
  for(const f of fields)s+=`<path d="${dPoly(f,0)}"/>`;
  s+='</g>';
  for(const pts of country)
    s+=`<path d="${dPoly(pts,0)}" fill="none" stroke="${P.street}" stroke-width="2.2" opacity=".9"/>`;
  for(const f of farms){
    s+=`<g transform="rotate(${F1(f.a)} ${F1(f.x)} ${F1(f.y)})">
      <rect x="${F1(f.x-7)}" y="${F1(f.y-5)}" width="14" height="10" fill="${P.built}" stroke="${P.builtLn}" stroke-width=".7"/>
      <rect x="${F1(f.x+8)}" y="${F1(f.y-2)}" width="6" height="6" fill="${P.built}" stroke="${P.builtLn}" stroke-width=".6"/></g>`;
  }
  for(const v of villages){
    for(const [a,b] of v.st){
      s+=`<path d="M${F1(a[0])} ${F1(a[1])} L${F1(b[0])} ${F1(b[1])}" stroke="${P.builtLn}" stroke-width="4" opacity=".3" fill="none"/>`;
      s+=`<path d="M${F1(a[0])} ${F1(a[1])} L${F1(b[0])} ${F1(b[1])}" stroke="${P.street}" stroke-width="2.4" fill="none"/>`;
    }
    for(const b of v.bld)
      s+=`<rect x="${F1(b.x)}" y="${F1(b.y)}" width="${F1(b.w)}" height="${F1(b.h)}" fill="${P.built}"
            stroke="${P.builtLn}" stroke-width=".5" transform="rotate(${F1(b.r)} ${F1(b.x)} ${F1(b.y)})"/>`;
    if(v.church)
      s+=`<g stroke="${P.ink}" fill="none" stroke-width="1"><path d="M${F1(v.x)} ${F1(v.y-12)} v-6 M${F1(v.x-2)} ${F1(v.y-15)} h4"/>
        <rect x="${F1(v.x-3)}" y="${F1(v.y-12)}" width="6" height="8" fill="${P.paper}"/></g>`;
  }
  return s;
}
function fillersLayer(F,P){
  let s='';
  for(const f of F){
    if(f.kind==='H'){
      s+=`<rect x="${F1(f.x-6)}" y="${F1(f.y-6)}" width="12" height="12" rx="2" fill="${P.red}" opacity=".85"/>`;
      s+=`<text x="${F1(f.x)}" y="${F1(f.y+4)}" font-size="9" text-anchor="middle" fill="#fff" font-weight="700">H</text>`;
    }else if(f.kind==='stadio'){
      s+=`<ellipse cx="${F1(f.x)}" cy="${F1(f.y)}" rx="17" ry="11" fill="${P.green}" stroke="${P.greenDk}" stroke-width="1.2"/>`;
      s+=`<ellipse cx="${F1(f.x)}" cy="${F1(f.y)}" rx="10" ry="5.5" fill="none" stroke="${P.greenDk}" stroke-width=".8"/>`;
    }else{
      s+=`<rect x="${F1(f.x-8)}" y="${F1(f.y-6)}" width="16" height="12" fill="${P.builtLn}" opacity=".7"/>`;
    }
  }
  return s;
}

/* ---------------- landmark, icone, tipografia varia ---------------- */
const ICON={
 church:'<path d="M0 -11 v5 M-2.5 -8.5 h5"/><path d="M-6 8 v-9 l6 -5 l6 5 v9 Z"/>',
 grave:'<path d="M-5 8 v-9 a5 5 0 0 1 10 0 v9 Z"/><path d="M0 -4 v6 M-3 -1 h6"/>',
 obelisk:'<path d="M-3 8 L-1.5 -8 L1.5 -8 L3 8 Z"/>',
 townhall:'<path d="M-8 8 h16 M-7 8 v-7 M0 8 v-7 M7 8 v-7"/><path d="M-9 1 L0 -8 L9 1 Z"/>',
 square:'<rect x="-8" y="-8" width="16" height="16" rx="2"/><circle cx="0" cy="0" r="2.2"/>',
 tower:'<path d="M-4 8 v-14 h8 v14 Z"/><path d="M-4 -6 h2 v-2 h2 v2 h2"/>',
 market:'<path d="M-9 -2 h18 l-2 -5 h-14 Z"/><path d="M-7 -2 v10 M7 -2 v10 M-7 8 h14"/>',
 station:'<rect x="-8" y="-6" width="16" height="12" rx="2"/><path d="M-8 9 h16"/>',
 anchor:'<circle cx="0" cy="-7" r="2.5"/><path d="M0 -4 v11 M-6 3 a6 6 0 0 0 12 0 M-4 0 h8"/>',
 book:'<path d="M0 -6 v13 M-9 -6 q4.5 -2 9 0 q4.5 -2 9 0 v13 q-4.5 -2 -9 0 q-4.5 -2 -9 0 Z"/>',
 theatre:'<path d="M-8 -5 a8 9 0 0 0 8 12 a8 9 0 0 0 8 -12 Z"/><path d="M-3 3 q3 3 6 0"/>',
 tree:'<path d="M0 8 v-6"/><circle cx="0" cy="-3" r="6"/>',
 fountain:'<path d="M-8 8 h16 M-6 8 v-3 h12 v3 M0 5 v-6"/><path d="M0 -6 q-4 2 -4 5 M0 -6 q4 2 4 5"/>',
 mug:'<path d="M-5 -5 h8 v11 h-8 Z M3 -3 h4 v6 h-4"/>',
 hammer:'<path d="M-6 -6 h8 v4 h-8 Z"/><path d="M-2 -2 L4 8"/>',
 note:'<circle cx="-3" cy="7" r="3"/><path d="M0 7 v-13 l7 2 v3"/>',
 star:'<path d="M0 -9 L2.6 -2.8 L9 -2.8 L3.8 1.4 L5.9 8 L0 3.9 L-5.9 8 L-3.8 1.4 L-9 -2.8 L-2.6 -2.8 Z"/>',
};
function landmarksLayer(places,P){
  let s='';
  for(const p of places){
    if(p.cat==='piazza'&&p.plazaMarker){
      s+=`<circle cx="${F1(p.plazaMarker[0])}" cy="${F1(p.plazaMarker[1])}" r="8" fill="${P.paper}" stroke="${P.redDk}" stroke-width="1.3"/>`;
      s+=`<text x="${F1(p.plazaMarker[0])}" y="${F1(p.plazaMarker[1]+3)}" font-size="10" text-anchor="middle" fill="${P.redDk}" font-weight="700">${p.ord}</text>`;
      continue;
    }
    const[ax,ay]=p.iconAnchor||[p.x,p.y];
    const w=17,h=15;
    s+=`<g transform="translate(${F1(ax)},${F1(ay)})">
      <rect x="${F1(-w/2)}" y="${F1(-h/2)}" width="${F1(w)}" height="${F1(h)}" rx="1.5" fill="${P.red}" stroke="${P.redDk}" stroke-width="1.1"/>
      <rect x="${F1(-w/2+2.5)}" y="${F1(-h/2+2.5)}" width="${F1(w-5)}" height="${F1(h-5)}" fill="none" stroke="${P.paper}" stroke-width=".7" opacity=".5"/>
     </g>`;
    s+=`<g transform="translate(${F1(ax)},${F1(ay)}) scale(.58)" stroke="${P.paper}" fill="none" stroke-width="2">${p.jolly?ICON.star:ICON[CAT[p.cat].icon]}</g>`;
    s+=`<circle cx="${F1(ax+12)}" cy="${F1(ay-11)}" r="8" fill="${P.paper}" stroke="${P.redDk}" stroke-width="1.3"/>`;
    s+=`<text x="${F1(ax+12)}" y="${F1(ay-8)}" font-size="10" text-anchor="middle" fill="${P.redDk}" font-weight="700">${p.ord}</text>`;
  }
  return s;
}
function waterNames(waterComps,rivers,P){
  let s='';
  rivers.forEach((rv,k)=>{
    s+=`<text font-size="13" fill="${P.waterLn}" font-style="italic" letter-spacing="3">
      <textPath href="#riv${k}" startOffset="40%">${esc(rv.cp?rv.cp.label:'Fiume')}</textPath></text>`;
  });
  for(const cp of waterComps){
    if(cp.cls==='fiume')continue;
    const nm=cp.cls==='mare'?cp.label.toUpperCase():cp.label;
    s+=`<text x="${F1(cp.cx)}" y="${F1(cp.cy)}" font-size="${cp.cls==='mare'?15:11}" fill="${P.waterLn}"
      text-anchor="middle" font-style="italic" letter-spacing="${cp.cls==='mare'?4:1}">${esc(nm)}</text>`;
  }
  return s;
}
function districtNames(D,P){
  let s='';
  for(const d of D){
    s+=`<text x="${F1(d.cx)}" y="${F1(d.cy+16)}" font-size="46" text-anchor="middle" fill="${P.ink}" opacity=".13" font-weight="700">${d.num}</text>`;
    s+=`<text x="${F1(d.cx)}" y="${F1(d.cy+34)}" font-size="10" text-anchor="middle" fill="${P.ink}" opacity=".5" font-style="italic">${esc(d.name)}</text>`;
  }
  return s;
}
function suburbNames(S,P){
  let s='';
  for(const b of S)
    s+=`<text x="${F1(b.x)}" y="${F1(b.y-(b.r||30)-10)}" font-size="11" text-anchor="middle" fill="${P.sub}" letter-spacing="2.2">${esc(b.name)}</text>`;
  return s;
}
function landmarkNames(places,P){
  let s='';
  for(const p of places){
    // piazza/giardino/cimitero sono ancore del tessuto: il nome e' gia'
    // scritto sul vero lotto ritagliato da tessutoLabelsLayer (out.reserved).
    // Ripeterlo qui, vicino alla pedina originale, duplicava ogni nome.
    if(ANCHOR_CATS.has(p.cat))continue;
    const[ax,ay]=p.iconAnchor||[p.x,p.y];
    s+=`<text x="${F1(ax)}" y="${F1(ay+23)}" font-size="10" text-anchor="middle" fill="${P.redDk}"
      font-weight="600" stroke="${P.paper}" stroke-width="2.6" paint-order="stroke">${esc(p.name)}</text>`;
  }
  return s;
}

/* ---------------- defs, cornice, scala, bussola, colonna laterale ---------------- */
function defs(P,cityChains,rivers,cityPoly){
  let d=`<defs>
   <clipPath id="cityClip"><path d="${dPoly(cityPoly,true)}"/></clipPath>
   <pattern id="ceme" width="7" height="7" patternUnits="userSpaceOnUse">
     <rect width="7" height="7" fill="${P.green}"/>
     <path d="M3.5 1 v5 M1.5 3 h4" stroke="${P.greenDk}" stroke-width=".6"/></pattern>
   <pattern id="onde" width="16" height="12" patternUnits="userSpaceOnUse">
     <rect width="16" height="12" fill="${P.water}"/>
     <path d="M0 6 Q4 3 8 6 T16 6" fill="none" stroke="${P.waterLn}" stroke-width=".55" opacity=".55"/></pattern>
   <filter id="paper"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" result="n"/>
     <feColorMatrix in="n" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .045 0"/></filter>`;
  d+=tessutoDefs(cityChains);
  rivers.forEach((rv,k)=>{ d+=`<path id="riv${k}" d="${dPoly(rv.pts,0)}" fill="none"/>` });
  return d+'</defs>';
}
function frame(P){
  return `<rect x="10" y="10" width="${MAPW-20}" height="${SVGH-20}" fill="none" stroke="${P.frame}" stroke-width="3"/>
   <rect x="16" y="16" width="${MAPW-32}" height="${SVGH-32}" fill="none" stroke="${P.frame}" stroke-width="1"/>
   <rect width="${SVGW}" height="${SVGH}" filter="url(#paper)" opacity=".5" pointer-events="none"/>`;
}
function scaleBar(P){
  const px=1000/METERS_PER_CELL*CELL;
  const x=40,y=SVGH-42;
  let s=`<g stroke="${P.ink}" fill="${P.ink}">`;
  for(let i=0;i<4;i++)
    s+=`<rect x="${F1(x+i*px/4)}" y="${y}" width="${F1(px/4)}" height="6" fill="${i%2?P.paper:P.ink}" stroke="${P.ink}" stroke-width=".8"/>`;
  s+=`<text x="${F1(x+px+8)}" y="${y+7}" font-size="10" fill="${P.ink}">1000 m</text></g>`;
  return s;
}
function compass(x,y,P){
  return `<g transform="translate(${x},${y})" stroke="${P.ink}" fill="${P.ink}">
    <circle r="20" fill="${P.paper}" fill-opacity=".7" stroke-width="1"/><circle r="14" fill="none" stroke-width=".6"/>
    <path d="M0 -18 L4 0 L0 5 L-4 0 Z"/><path d="M0 18 L4 0 L-4 0 Z" fill="none" stroke-width=".8"/>
    <text x="0" y="-22" font-size="9" text-anchor="middle">N</text></g>`;
}
const clip=(s,n)=>{s=String(s);return s.length>n?s.slice(0,n-1)+'…':s};
function sidebar(places,waterComps,terr,ch,P,districts,mapNum){
  const X=MAPW+26;let y=64;let s='';
  s+=`<rect x="${MAPW}" y="0" width="${SIDE}" height="${SVGH}" fill="${P.paper}"/>`;
  s+=`<line x1="${MAPW}" y1="0" x2="${MAPW}" y2="${SVGH}" stroke="${P.frame}" stroke-width="1"/>`;
  s+=`<text x="${X}" y="${y}" font-size="30" fill="${P.ink}" font-weight="900">MAPPA N. ${mapNum}</text>`;y+=20;
  s+=`<text x="${X}" y="${y}" font-size="10" fill="${P.ink}" opacity=".65" letter-spacing="3">CARTA DI VIAGGIO · ${ch.toUpperCase()}</text>`;y+=18;
  s+=`<line x1="${X}" y1="${y}" x2="${SVGW-26}" y2="${y}" stroke="${P.frame}" stroke-width=".8"/>`;y+=24;
  s+=`<text x="${X}" y="${y}" font-size="15" fill="${P.ink}" font-style="italic">Luoghi importanti</text>`;y+=20;
  for(const p of places){
    if(y>SVGH-150)break;
    s+=`<circle cx="${X+7}" cy="${y-3}" r="8" fill="none" stroke="${P.redDk}" stroke-width="1.2"/>`;
    s+=`<text x="${X+7}" y="${y}" font-size="9.5" text-anchor="middle" fill="${P.redDk}" font-weight="700">${p.ord}</text>`;
    s+=`<text x="${X+22}" y="${y-1}" font-size="12" fill="${P.ink}">${esc(clip(p.name,30))}</text>`;
    const m=p.jolly?p.label:microFor(p.cat,ch);
    s+=`<text x="${X+22}" y="${y+11}" font-size="9" fill="${P.ink}" opacity=".65" font-style="italic">${esc(clip(m,44))}</text>`;
    y+=27;
  }
  y=SVGH-120;
  s+=`<line x1="${X}" y1="${y-16}" x2="${SVGW-26}" y2="${y-16}" stroke="${P.frame}" stroke-width=".8"/>`;
  s+=`<text x="${X}" y="${y}" font-size="12" fill="${P.ink}" font-style="italic">Legenda</text>`;y+=17;
  const L=[[P.red,'monumento'],[P.built,'costruito'],[P.green,'verde'],[P.water,'acqua'],[P.rail,'ferrovia']];
  let lx=X;
  for(const [col,txt] of L){
    s+=`<rect x="${lx}" y="${y-8}" width="10" height="10" fill="${col}" stroke="${P.ink}" stroke-width=".5"/>`;
    s+=`<text x="${lx+14}" y="${y}" font-size="9.5" fill="${P.ink}" opacity=".8">${txt}</text>`;
    lx+=txt.length*5.6+30;
    if(lx>SVGW-100){lx=X;y+=16}
  }
  y+=22;
  const kinds=[...new Set(waterComps.map(c=>c.cls))];
  if(terr.mountain.length)kinds.push('montagna');
  if(terr.hill.length)kinds.push('collina');
  s+=`<text x="${X}" y="${y}" font-size="9.5" fill="${P.ink}" opacity=".6" font-style="italic">Morfologia: ${kinds.length?kinds.join(' · '):'pianura'} — ${districts.length} quartieri</text>`;
  return s;
}
