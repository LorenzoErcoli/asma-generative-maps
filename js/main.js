"use strict";
/* =====================================================================
   REGIA — orchestra world.js (campagna, campo urbano/acqua, quartieri,
   periferia) e tessuto.js (il motore vettoriale unico che genera strade+
   edifici+piazze+ponti della citta' vera e propria), poi compone l'SVG
   finale con render.js.
   ===================================================================== */
function generate(){
  const ch=$('character').value, P=PAL[ch]||PAL.classico;
  const seed=hashStr(JSON.stringify(grid)+ch+activeJollySignature())||1;
  RND=mulberry32(seed); NSEED=(seed%100000)+1;

  /* --- 1. leggo la scacchiera --- */
  const terr={water:[],mountain:[],hill:[],green:[]};
  const pawns=[];
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){
    const v=grid[r][c];if(!v)continue;
    if(v.kind==='terrain')terr[v.terrain].push([r,c]);
    else if(v.kind==='place')pawns.push({r,c,cat:v.cat,ord:v.ord,jolly:false,sub:v.sub});
    else if(v.kind==='jolly')pawns.push({r,c,cat:'jolly',ord:v.ord,jolly:true,label:jollyText[v.j]||'Desiderio '+(v.j+1)});
  }
  // il verde e' terreno "grezzo" (oggi solo dallo scanner, vedi ui.js): non
  // sceglie da solo cosa diventa, lo decide l'agglomerato di celle una
  // volta piazzate — esattamente come l'acqua decide da sola se e' un
  // fiume. 1 pezzo isolato = giardino, 2 adiacenti = parco cittadino (una
  // pedina "giardino" piu' grande, stesso meccanismo). Un agglomerato di 3+
  // diventa collina se e' dentro la citta' — un vero ostacolo nel tessuto,
  // vedi buildTessuto — o montagna se tocca il bordo della scacchiera,
  // come un pennello Montagna piazzato a mano.
  const hillClusters=[];
  for(const cells of comps(terr.green)){
    const touchesEdge=cells.some(([r,c])=>r===0||r===N-1||c===0||c===N-1);
    if(cells.length>=3){
      if(touchesEdge)terr.mountain.push(...cells);else hillClusters.push(cells);
      continue;
    }
    const cr=cells.reduce((a,[r])=>a+r,0)/cells.length, cc=cells.reduce((a,[,c])=>a+c,0)/cells.length;
    pawns.push({r:cr,c:cc,cat:'giardino',ord:9000+pawns.length,jolly:false,parkTier:cells.length});
  }
  pawns.sort((a,b)=>a.ord-b.ord);

  const waterComps=comps(terr.water).map(cells=>{
    const cls=classWater(cells), proper=word();
    const label=cls==='fiume'?'Fiume '+proper : cls==='lago'?'Lago di '+proper
              : cls==='mare'?'Mare di '+proper : 'Fonte '+proper;
    const cx=cells.reduce((a,[r,c])=>a+W(c+.5),0)/cells.length;
    const cy=cells.reduce((a,[r,c])=>a+W(r+.5),0)/cells.length;
    return {cells,cls,proper,label,cx,cy};
  });
  const hasWater=terr.water.length>0;
  const places=pawns.filter(p=>p.jolly||!CAT[p.cat].needsWater||(hasWater&&nearWaterCell(p,terr.water)));
  const ignored=pawns.length-places.length;
  for(const p of places){
    p.gx=p.c+.5+rr(-.16,.16); p.gy=p.r+.5+rr(-.16,.16);
    p.x=W(p.gx); p.y=W(p.gy);
    p.name=p.jolly?cap(p.label.split(/\s+/).slice(0,3).join(' ')):nameFor(p.cat,p.sub);
  }

  if(!places.length){
    lastDiagnostics=null;
    const msg=ignored?'nessuna pedina valida':'nessuna pedina sulla scacchiera';
    setMap(`<svg xmlns="http://www.w3.org/2000/svg" width="${SVGW}" height="${SVGH}" viewBox="0 0 ${SVGW} ${SVGH}"><rect width="${SVGW}" height="${SVGH}" fill="${P.land}"/><text x="${MAPW/2}" y="${SVGH/2}" text-anchor="middle" font-size="20" fill="${P.ink}" font-style="italic" font-family="Georgia,serif">terra incognita — ${msg}</text></svg>`,ignored?`${ignored} pedine ignorate.`:'Scacchiera vuota.');
    return;
  }

  /* --- 2. la natura prima: l'acqua e' il dato di partenza --- */
  const {WF,WL,rivers}=waterField(waterComps,places);
  snapPlacesToLand(places,WF);
  places.forEach((p,i)=>p.ord=i+1);
  const centre=urbanCentre(places);
  const mst=mstEdges(places);
  const F=urbanField(places,mst,terr,rivers,centre);
  const inWater=(x,y)=>fieldAt(WF,x,y)>WTHR;

  /* --- 3. forma della citta' --- */
  // marching squares + chaikin(3) producono un contorno con MIGLIAIA di
  // vertici (un micro-gradino ogni pochi pixel): visivamente identico a
  // uno semplificato, ma per il tessuto e' un problema vero — ogni lotto
  // sul bordo citta' eredita di peso una manciata di quei micro-vertici
  // come proprio lato, e rectFootprint (che deve stare dentro OGNI lato
  // del lotto) non trova piu' un rettangolo decente: il lotto finisce
  // "cortile" invece che palazzo. Semplificare il contorno UNA VOLTA qui
  // (perdita d'area trascurabile, meno dello 0.1%) risolve alla radice
  // invece di rincorrere il sintomo lotto per lotto.
  let cityLoops=contour(F,THR).map(l=>simplifyLoop(chaikin(l,3),3)).filter(l=>polyArea(l)>18000);
  cityLoops.sort((a,b)=>polyArea(b)-polyArea(a));
  const cityPoly=cityLoops[0]||[];
  if(!cityPoly.length){
    setMap(`<svg xmlns="http://www.w3.org/2000/svg" width="${SVGW}" height="${SVGH}" viewBox="0 0 ${SVGW} ${SVGH}"><rect width="${SVGW}" height="${SVGH}" fill="${P.land}"/><text x="${MAPW/2}" y="${SVGH/2}" text-anchor="middle" font-size="20" fill="${P.ink}" font-style="italic" font-family="Georgia,serif">le pedine sono troppo sparse per formare una città</text></svg>`,'Avvicina le pedine.');
    return;
  }

  /* --- 4. quartieri --- */
  const districts=makeDistricts(places,F,centre);
  const waterLoops=contour(WL,WTHR).map(l=>chaikin(l,2));

  /* --- 5. tessuto: il motore unico genera strade+edifici+piazze+ponti
     in un solo passaggio vettoriale (vedi tessuto.js). Solo il fiume piu'
     rilevante entra nella ricorsione: eventuali affluenti restano comunque
     visibili (waterLayer) ma non tagliano la citta'. */
  const river=rivers.length?rivers[0]:null;
  const railStations=places.filter(p=>p.cat==='stazione');
  const hills=hillClusters.map(cells=>({
    x:cells.reduce((a,[r,c])=>a+W(c+.5),0)/cells.length,
    y:cells.reduce((a,[r,c])=>a+W(r+.5),0)/cells.length,
    n:cells.length,
  }));
  const {out,bridges,rail,diag}=buildTessuto(cityPoly,river,places,railStations,hills);

  // le piazze occupano davvero un pezzo di tessuto (out.reserved): il
  // marcatore d'itinerario si appoggia al bordo di quella forma vera,
  // non al centro della pedina.
  for(const p of places)if(p.cat==='piazza'){
    const r=out.reserved.find(rz=>rz.name===p.name);
    if(r){
      const poly=r.shapePoly||r.poly;
      const cx=poly.reduce((s,q)=>s+q[0],0)/poly.length, cy=poly.reduce((s,q)=>s+q[1],0)/poly.length;
      const{maxA,maxN}=orientedExtent(poly);
      p.plazaMarker=[cx+maxA*.7,cy+maxN*.7];
    }
  }

  /* --- 6. infrastrutture puntuali e periferia --- */
  const docks=places.filter(p=>p.cat==='porto').map(p=>makeDock(p,WF)).filter(Boolean);
  const suburbs=makeSuburbs(F,centre,WF);
  const villages=makeVillages(suburbs);
  // le strade di campagna raggiungono vere testate della rete urbana
  const fringe=[];
  for(const c of out.streets){
    if(c.phase==='lot')continue;
    for(const p of [c.pts[0],c.pts[1]])
      if(fieldAt(F,p[0],p[1])<THR+.08&&fieldAt(WF,p[0],p[1])<WTHR-.04)
        fringe.push({p,rank:streetRank(c)});
  }
  const bridgeAdapter=bridges.map(b=>({a:b.deckA,b:b.deckB}));
  const country=[],countryUsed=new Set(),fringeUse=new Map();
  for(const v of villages){
    let target=null;
    for(const f of fringe){
      const used=fringeUse.get(f)||0;
      const d=dist([v.x,v.y],f.p)+used*90+(f.rank==='vicolo'?35:0);
      if(!target||d<target.d)target={f,d};
    }
    const end=target?target.f.p:centre;
    const pts=directRoad([v.x,v.y],end,WF,bridgeAdapter,terr)
      ||routeRoad([v.x,v.y],end,F,WF,bridgeAdapter,terr,countryUsed);
    if(pts&&pts.length>1){country.push(pts);if(target)fringeUse.set(target.f,(fringeUse.get(target.f)||0)+1)}
  }
  // gli ospedali (fillers 'H') erano solo un'iconcina appoggiata sopra il
  // tessuto, senza un vero ingombro — "un ospedale che prende piu' spazio"
  // vuol dire che deve occupare un lotto vero come un landmark, non restare
  // decorativo. Dove trova un lotto abbastanza vicino lo reclama con la
  // stessa forma a cortile dei palazzi importanti; altrimenti resta
  // l'iconcina di riserva.
  const rawFillers=makeFillers(F,inWater,places);
  const claimedHospital=new Set();
  const fillers=rawFillers.filter(f=>{
    if(f.kind!=='H')return true;
    let best=-1,bd=Infinity;
    out.buildings.forEach((b,i)=>{
      if(claimedHospital.has(i)||b.landmark||b.footprintParts||b.A<600)return;
      const d=dist([f.x,f.y],b.c); if(d<bd){bd=d;best=i}
    });
    if(best<0||bd>CELL*1.5)return true; // nessun lotto adatto: tengo l'icona
    claimedHospital.add(best);
    const b=out.buildings[best];
    b.landmark={cat:'ospedale',name:'Ospedale'};
    b.footprintParts=landmarkFootprint(b.poly,'ospedale');
    return false; // assorbito in un edificio vero: l'icona non serve piu'
  });
  lastDiagnostics=diag;

  /* --- 7. render --- */
  const cityChains=tessutoStreetChains(out);
  const S=[];
  S.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SVGW}" height="${SVGH}" viewBox="0 0 ${SVGW} ${SVGH}" font-family="Iowan Old Style, Palatino, Georgia, serif">`);
  S.push(defs(P,cityChains,rivers,cityPoly));

  S.push(`<rect width="${SVGW}" height="${SVGH}" fill="${P.land}"/>`);
  S.push(reliefLayer(terr,P));
  const cfields=makeFields(F,WF,villages);
  const cfarms=makeFarms(F,WF,villages);
  S.push(countryside(villages,country,cfields,cfarms,P));

  for(const l of cityLoops)S.push(`<path d="${dPoly(l,1)}" fill="${P.built}" opacity=".07" stroke="none"/>`);
  // sotto agli edifici: dove un edificio vero esiste gia' lo ricopre
  // comunque lui, la fascia si vede solo dove prima non c'era nulla.
  S.push(`<g clip-path="url(#cityClip)">${riverbankFillLayer(river,P,out)}</g>`);
  S.push(tessutoQuaysLayer(out,P));
  S.push(tessutoBuildingsLayer(out,P));
  S.push(tessutoReservedLayer(out,P));
  S.push(gardenDetailsLayer(out,P));
  S.push(collinaContourLayer(out,P));
  S.push(tessutoStreetsLayer(out,P));
  S.push(waterLayer(waterLoops,rivers,waterComps,docks));
  S.push(tessutoBridgesLayer(bridges,P));
  S.push(tessutoRailLayer(rail,river,P));
  S.push(fillersLayer(fillers,P));
  S.push(landmarksLayer(places,P));

  S.push(tessutoStreetNames(cityChains,P));
  S.push(waterNames(waterComps,rivers,P));
  S.push(districtNames(districts,P));
  S.push(suburbNames(villages,P));
  S.push(tessutoLabelsLayer(out,P));
  S.push(landmarkNames(places,P));

  S.push(frame(P));
  S.push(scaleBar(P));
  S.push(compass(MAPW-70,SVGH-150,P));
  S.push(sidebar(places,waterComps,terr,ch,P,districts));
  S.push('</svg>');

  const split=river&&diag.components>1;
  setMap(S.join(''),`${places.length} luoghi · ${out.buildings.length} edifici · ${cityChains.length} strade con nome · ${districts.length} quartieri`
    +(ignored?` · ${ignored} pedine ignorate`:'')
    +` · componenti stradali: ${diag.components} · vicoli ciechi: ${diag.deadEnds}`
    +(split?' · ⚠ rete stradale non completamente connessa':''));
}
