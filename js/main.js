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

  const coste=MARE_ENABLED?seaSides(terr.water):null;
  // La fascia costiera si STACCA dal resto prima di classificare. Un fiume
  // che sfocia in mare tocca la fila blu: senza questo taglio le due cose
  // sono una componente connessa sola, e finivano o tutte mare (il fiume
  // inghiottito) o tutte fiume (niente costa). Cosi' invece il mare resta
  // mare e il fiume resta un fiume che ci arriva dentro.
  const pezziAcqua=[];
  for(const cells of comps(terr.water)){
    const banda=coste?cells.filter(([r,c])=>seaCellIn(coste,r,c)):[];
    if(!banda.length){pezziAcqua.push(cells);continue}
    pezziAcqua.push(banda);
    for(const p of comps(cells.filter(([r,c])=>!seaCellIn(coste,r,c))))pezziAcqua.push(p);
  }
  // un pezzo attaccato alla costa che arriva fino a un bordo attraversa
  // comunque la citta': e' un fiume, anche se adesso tocca un bordo solo
  // perche' l'altro capo gliel'ha preso il mare.
  const tastaMare=cells=>!!coste&&cells.some(([r,c])=>
    NB8.some(([dr,dc])=>seaCellIn(coste,r+dr,c+dc)));
  const tastaBordo=cells=>cells.some(([r,c])=>r===0||r===N-1||c===0||c===N-1);
  const classeAcqua=cells=>{
    if(coste&&cells.every(([r,c])=>seaCellIn(coste,r,c)))return 'mare';
    if(tastaMare(cells)&&cells.length>=3&&tastaBordo(cells))return 'fiume';
    return classWater(cells);
  };
  const waterComps=pezziAcqua.map(cells=>{
    const cls=classeAcqua(cells);
    const proper=word();
    const label=cls==='fiume'?'Fiume '+proper : cls==='lago'?'Lago di '+proper
              : cls==='mare'?'Mare di '+proper : 'Fonte '+proper;
    const cx=cells.reduce((a,[r,c])=>a+W(c+.5),0)/cells.length;
    const cy=cells.reduce((a,[r,c])=>a+W(r+.5),0)/cells.length;
    return {cells,cls,proper,label,cx,cy};
  });
  // il mare piu' grande ottiene un vero taglio nel tessuto (trimSea, vedi
  // buildTessuto) esattamente come il fiume: un semipiano "qui e' terra"
  // calcolato dalla stessa costa che l'ha classificato 'mare'. Senza
  // questo il mare resta solo un velo disegnato sopra edifici e strade
  // gia' costruiti, invece di fermarli davvero a una costa.
  const mari=waterComps.filter(c=>c.cls==='mare');
  if(mari.length>1){
    mari[0].cells=mari.flatMap(c=>c.cells);
    for(const c of mari.slice(1))waterComps.splice(waterComps.indexOf(c),1);
  }
  const seaComp=mari[0];
  let sea=coste;
  // il taglio (sea) puo' essere disattivato dalla rete di sicurezza piu'
  // sotto, se il mare mangerebbe quasi tutta la citta'; il disegno
  // (seaDraw) no — il mare si vede comunque, solo senza il vero ritaglio.
  const seaDraw=sea;
  if(seaComp&&seaDraw){const q=seaLabelPoint(seaDraw);if(q){seaComp.cx=q[0];seaComp.cy=q[1]}}
  const hasWater=terr.water.length>0;
  // Una pedina con una categoria che non sta in CAT va scartata come non
  // valida, non deve far esplodere generate(): la tassonomia cambia (es.
  // 'ponte' e 'porta', tolti quando i ponti sono passati all'algoritmo) e
  // una scacchiera salvata o acquisita con una tassonomia vecchia deve
  // finire nel conteggio delle "pedine ignorate" come qualsiasi altra
  // pedina non piazzabile.
  const places=pawns.filter(p=>p.jolly||(CAT[p.cat]&&(!CAT[p.cat].needsWater||(hasWater&&nearWaterCell(p,terr.water)))));
  const ignored=pawns.length-places.length;
  for(const p of places){
    p.gx=p.c+.5+rr(-.16,.16); p.gy=p.r+.5+rr(-.16,.16);
    p.x=W(p.gx); p.y=W(p.gy);
    p.name=p.jolly?cap(p.label.split(/\s+/).slice(0,3).join(' ')):nameFor(p.cat,p.sub);
  }

  if(!places.length){
    lastDiagnostics=null;
    const msg=ignored?'nessuna pedina valida':'nessuna pedina sulla scacchiera';
    setMap(`<svg xmlns="http://www.w3.org/2000/svg" width="${SVGW}" height="${SVGH}" viewBox="0 0 ${SVGW} ${SVGH}"><rect width="${SVGW}" height="${SVGH}" fill="${P.land}"/><text x="${MAPW/2}" y="${SVGH/2}" text-anchor="middle" font-size="20" fill="${P.ink}" font-style="italic" font-family="Archivo,sans-serif">terra incognita — ${msg}</text></svg>`,ignored?`${ignored} pedine ignorate.`:'Scacchiera vuota.');
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
    setMap(`<svg xmlns="http://www.w3.org/2000/svg" width="${SVGW}" height="${SVGH}" viewBox="0 0 ${SVGW} ${SVGH}"><rect width="${SVGW}" height="${SVGH}" fill="${P.land}"/><text x="${MAPW/2}" y="${SVGH/2}" text-anchor="middle" font-size="20" fill="${P.ink}" font-style="italic" font-family="Archivo,sans-serif">le pedine sono troppo sparse per formare una città</text></svg>`,'Avvicina le pedine.');
    return;
  }
  // rete di sicurezza: se il taglio del mare cancellerebbe quasi tutta la
  // citta' (acqua pesante, pedine finite dal lato sbagliato della costa),
  // il taglio duro si disattiva invece di produrre una mappa vuota — il
  // mare resta comunque visibile, solo senza il vero ritaglio nel tessuto.
  if(sea){
    let landPoly=cityPoly;
    for(const lato of sea)landPoly=landPoly.length>=3?clipHalf(landPoly,lato.nVec,seaMeanOffset(lato),false):[];
    const landArea=landPoly.length>=3?polyArea(landPoly):0;
    if(landArea<polyArea(cityPoly)*(sea.length>=3?.10:.35))sea=null;
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
  const {out,bridges,rail,diag}=buildTessuto(cityPoly,river,places,railStations,hills,sea);
  if(sea){
    for(const lato of sea)for(const pezzo of seaPromenade(lato,cityPoly,sea))
      out.streets.push({pts:pezzo,depth:0,rank:'lungomare'});
    if(rail)rail.segments=clipSegmentsToLand(rail.segments,sea);
  }
  /* la periferia si dirada invece di finire su una linea. Nella fascia
     FRANGIA (tre o quattro file di lotti) ogni isolato, a seconda di quanto
     e' vicino all'orlo, ha una probabilita' crescente di non essere
     costruito e una taglia calante: cosi' l'ultimo strato e' fatto di poche
     case piccole e distanti, quello prima e' quasi pieno, e in mezzo c'e'
     una vera degradazione. Il fondo urbano segue i lotti, quindi dove il
     lotto sparisce torna campagna da solo, senza chiazze grigie.
     Sul fronte mare niente di tutto questo: li' i palazzi devono restare
     in riga, affacciati sul lungomare. */
  {
    const via=new Set();
    // un lotto che se ne va non lascia sempre il vuoto: una parte resta
    // come verde. Sono proprio quelle macchie a sfumare il confine della
    // citta' — ma solo una parte, se no la periferia diventa un parco.
    const leva=b=>{
      via.add(b);
      if(b.A>=MIN_BUILDING_DRAW&&b.t>.35&&RND()<FRANGIA_VERDE)
        out.reserved.push({type:'verde',poly:b.poly,name:null,
          shapePoly:organicBlob(b.poly,.24,rr(0,Math.PI*2),.72)});
    };
    for(const b of out.buildings){
      if(b.landmark||b.footprintParts)continue;
      const d=dist(b.c,nearestOnPoly(cityPoly,b.c));
      if(d>FRANGIA)continue;
      if(sea&&seaDistance(sea,b.c)<FRANGIA)continue;
      // il diradamento non e' uguale tutto intorno: una chiazza di rumore
      // lo anticipa da una parte e lo rimanda dall'altra, come una citta'
      // che si allunga lungo una direttrice e si ferma prima altrove.
      const chiazza=FRANGIA_CHIAZZE*fbm(b.c[0]*.0045,b.c[1]*.0045,3);
      const t=clamp(1-d/FRANGIA+chiazza,0,1.15);   // 1 sull'orlo, 0 dentro
      b.t=t;
      if(RND()<FRANGIA_VUOTO*Math.pow(t,1.7)){leva(b);continue}
      b.poly=scalePoly(b.poly,b.c,1-rr(FRANGIA_MAX*.35,FRANGIA_MAX)*t);
      b.A=polyArea(b.poly);
      // un lotto di frangia troppo storto per un rettangolo finirebbe
      // disegnato come cortile tratteggiato: fuori dalla citta' e' solo un
      // fantasma di isolato, meglio che il bordo si fermi prima.
      if(polyArea(rectFootprint(b.poly,.84))<b.A*RECT_ACCEPT)leva(b);
    }
    if(via.size)out.buildings=out.buildings.filter(b=>!via.has(b));
  }

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
  S.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SVGW}" height="${SVGH}" viewBox="0 0 ${SVGW} ${SVGH}" font-family="Archivo, sans-serif">`);
  S.push(defs(P,cityChains,rivers,cityPoly));

  S.push(`<rect width="${SVGW}" height="${SVGH}" fill="${P.land}"/>`);
  S.push(reliefLayer(terr,P));
  const cfields=makeFields(F,WF,villages);
  const cfarms=makeFarms(F,WF,villages);
  S.push(countryside(villages,country,cfields,cfarms,P));

  // il fondo urbano segue i lotti veri, non il contorno liscio della citta'
  S.push(tessutoGroundLayer(out,P));
  // sotto agli edifici: dove un edificio vero esiste gia' lo ricopre
  // comunque lui, la fascia si vede solo dove prima non c'era nulla.
  S.push(`<g clip-path="url(#cityClip)">${riverbankFillLayer(river,P,out)}</g>`);
  S.push(tessutoQuaysLayer(out,P));
  S.push(tessutoBuildingsLayer(out,P));
  S.push(tessutoReservedLayer(out,P));
  S.push(gardenDetailsLayer(out,P));
  S.push(collinaContourLayer(out,P));
  S.push(tessutoStreetsLayer(out,P));
  S.push(seaLayer(seaDraw,P));
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
  // stesso numero sul retro (qui) e sul fronte (assets/fronte.pdf, vedi
  // #frontNum in index.html): un solo numero per carta, non uno a faccia.
  const mapNum=100000+Math.floor(RND()*900000);
  lastMapNum=mapNum;
  S.push(sidebar(places,waterComps,terr,ch,P,districts,mapNum));
  S.push('</svg>');

  const split=river&&diag.components>1;
  // Una pedina che non trova posto nel tessuto non deve sparire in silenzio:
  // chi l'ha messa deve sapere che sulla carta non c'e', e perche'. Succede
  // quasi solo sul bordo esterno della scacchiera, dove la citta' spesso non
  // arriva (vedi il ripiego in tessuto.js, che ormai ne recupera quasi
  // tutte). Il numero delle ancore irrisolte conta allo stesso modo: anche
  // quelle sono luoghi chiesti e non comparsi.
  const nonComparsi=(diag.landmarksTotal-diag.landmarksBound)+diag.anchorsUnresolved;
  setMap(S.join(''),`${places.length} luoghi · ${out.buildings.length} edifici · ${cityChains.length} strade con nome · ${districts.length} quartieri`
    +(ignored?` · ${ignored} pedine ignorate`:'')
    +(nonComparsi?` · ⚠ ${nonComparsi} ${nonComparsi===1?'pedina non ha trovato posto':'pedine non hanno trovato posto'} (spostale verso il centro della scacchiera)`:'')
    +` · componenti stradali: ${diag.components} · vicoli ciechi: ${diag.deadEnds}`
    +(split?' · ⚠ rete stradale non completamente connessa':''));
  const frontNum=$('frontNum');if(frontNum)frontNum.textContent=mapNum;
}
