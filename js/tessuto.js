"use strict";
/* =====================================================================
   TESSUTO — il motore vettoriale unificato: una sola ricorsione produce
   isolati, strade E edifici come TAGLI dello stesso poligono (mai un
   secondo passaggio raster che li riconcilia dopo, la causa storica delle
   "strade sopra i palazzi"). Riceve il poligono città (da world.js, campo
   di urbanità + marching squares) e produce out.streets/out.buildings/
   out.reserved. Fiume, ferrovia e ancore (piazza/giardino/cimitero) sono
   TAGLI VERI dentro la stessa ricorsione, non ritocchi cosmetici dopo.
   Ponti: nessuna pedina li piazza. Il fiume spacca la città in due meta'
   generate indipendentemente; DOPO le si ricollega ad agganciando ogni
   ponte a strade gia' reali su entrambe le rive (autoBridges) — un taglio
   forzato anticipato su un poligono ancora enorme produceva rette lunghe
   e senza rapporto con dove serviva davvero il ponte.
   ===================================================================== */

// aree scalate dalla CELL del prototipo (100) a quella di v2 (110): le
// soglie sono aree, quindi scalano per il quadrato del rapporto (~1.21).
const BLOCK_TARGET=2900, BUILDING_TARGET=510, MIN_LEAF=95, MAX_DEPTH=26;
const MIN_BUILDING_DRAW=180;
// quanta area del lotto deve restare dentro rectFootprint perche' valga
// come edificio vero. Sotto, la parte esclusa (out.buildings gia' filtrati
// in "cortile in verde" qui sotto) diventa giardino o resta cortile aperto.
const RECT_ACCEPT=.34;
const RAIL_HW=3.5;
// Quanto lontano puo' stare l'aggancio di una rampa di ponte dall'impalcato.
// 440 su una mappa larga 1100 e' larghissimo — permette "rampe" che
// attraversano un terzo della citta' in retta sopra gli isolati — ma
// stringerlo NON migliora la carta, sposta soltanto il difetto: un ponte
// rifiutato lascia le due sponde scollegate e ci pensa reconnectOrphans,
// che ricuce con un raccordo il quale GUADA il fiume. Misurato sui 24
// scenari dell'audit, al variare della soglia:
//
//   CELL*4 (440):  12 strade dentro un edificio,  3 guadi
//   CELL*2.5(275): 10 strade dentro un edificio,  6 guadi
//   CELL*1.2(132): 10 strade dentro un edificio,  7 guadi
//
// Si scambia una strada sopra i palazzi con una strada dentro l'acqua, che
// e' peggio. Resta 4 finche' la rampa non viene INSTRADATA lungo le strade
// esistenti invece di essere tirata dritta: quella e' la correzione vera.
const MAX_APPROACH=CELL*4;
// due famiglie di "importanza" invece di una sola: sacro/culturale in
// sfumature del viola di brand (#674292) — chiesa, teatro, biblioteca,
// monumento, cinema, i luoghi contemplativi; civico/commerciale in
// sfumature del giallo di brand (#f29218) — municipio, mercato, stazione
// eccetera, i luoghi operosi. Dentro ogni famiglia, piu' scuro = piu'
// "importante" (es. municipio piu' scuro di una bottega), cosi' restano
// distinguibili a colpo d'occhio senza uscire dalla propria famiglia.
const LANDMARK_FILL={
  // sacro / culturale — viola
  chiesa:'#3d2856',teatro:'#5c3a80',biblioteca:'#46305f',monumento:'#674292',cinema:'#7452a0',
  // civico / commerciale — giallo
  municipio:'#8a5410',stazione:'#9c5f0e',porto:'#af6a10',mercato:'#c17512',torre:'#d1841c',
  ospedale:'#dc9530',fontana:'#e6a748',osteria:'#eeb968',bottega:'#f4c988',locale:'#f8d7a8',
};
const IMPORTANT_SHAPE={chiesa:'cross',municipio:'courtyard',mercato:'courtyard',teatro:'apse',stazione:'shed',fontana:'basin',ospedale:'courtyard',
  tribunale:'courtyard',dogana:'shed',locanda:'courtyard'};

/* ---------------- forme organiche (piazze/giardini/verde) ----------------
   rifinitura cosmetica per i due soli casi in cui non si puo' ritagliare un
   vero N-gono (vedi tryReserveShape): la rete di sicurezza di un'ancora
   rimasta senza spazio, e il verde autonomo ricavato da un lotto gia'
   finale. In entrambi i casi i vicini sono gia' fissati, quindi qui
   l'unica cosa sensata e' un inset abbondante — un vero margine tra il
   colore e la strada, non solo un contorno mosso. */
// un inset UNIFORME (stesso fattore in ogni direzione attorno al
// centroide) presume che il lotto sia grosso modo simmetrico. Su un lotto
// storto (comune: e' quasi sempre quello che resta dopo un taglio di
// fiume o un'ancora vicina, mai il piu' regolare) la forma organica esce
// piu' larga del lotto da un lato — e quel pezzo finisce disegnato sopra
// la strada o l'edificio accanto, "appiccicato". Ritaglio percio' SEMPRE
// il risultato contro i veri lati del lotto, con lo stesso margine reale
// gia' usato per gli edifici: garantisce di restare dentro qualunque sia
// la forma, l'inset resta solo un punto di partenza ragionevole.
//
// ATTENZIONE — tentativo precedente scartato: un taglio SEQUENZIALE a
// semipiani (un clipHalf per ogni lato di poly, come si fa con trimRiver)
// e' corretto solo se poly e' CONVESSO: e' letteralmente l'intersezione
// di tutti quei semipiani, cioe' l'inviluppo convesso del poligono, non
// la sua vera sagoma. Un lotto d'angolo o storto (frequentissimo dopo la
// ricorsione) e' spesso concavo: con quel metodo un giardino "spontaneo"
// (verde autonomo, cortile-in-verde, sagrato) finiva col vertice piantato
// nell'incavo del lotto — cioe' visivamente sopra il palazzo vicino che
// occupa quell'incavo. Fix: per ogni vertice della forma si spara un
// raggio dal centroide verso quel vertice e si trova la VERA distanza dal
// bordo lungo quella direzione (il primo lato di poly incontrato, non
// l'inviluppo), poi si arretra di margin. Funziona per qualunque lotto a
// stella rispetto al proprio centroide — il caso normale per un lotto
// generato dalla ricorsione.
function rayEdgeDist(o,dir,a,b){
  const sx=b[0]-a[0], sy=b[1]-a[1];
  const denom=dir[0]*sy-dir[1]*sx;
  if(Math.abs(denom)<1e-9)return null;
  const qx=a[0]-o[0], qy=a[1]-o[1];
  const t=(qx*sy-qy*sx)/denom, u=(qx*dir[1]-qy*dir[0])/denom;
  return (t>1e-6&&u>=-1e-9&&u<=1+1e-9)?t:null;
}
// il centroide "media dei vertici" (vedi geometry.js) non e' l'area giusta
// per un lotto molto concavo (una L stretta, una falce residua di un
// taglio) — puo' cadere FUORI dal poligono. Un raggio che parte gia' fuori
// non trova mai il vero bordo nella direzione giusta: verificato su un
// giro di 40 semi casuali, causava ancora vertici fuori posto (stavolta
// nei 'verde' ricavati da isolati storti). Se il centroide e' fuori, si usa
// il punto medio della coppia di vertici piu' lontana che ricade DENTRO —
// una vera diagonale interna, garantita esistere in un poligono semplice.
function interiorAnchor(poly){
  const c=centroid(poly);
  if(inPoly(c,poly))return c;
  let best=null,bd=-1;
  for(let i=0;i<poly.length;i++)for(let j=i+1;j<poly.length;j++){
    const mid=[(poly[i][0]+poly[j][0])/2,(poly[i][1]+poly[j][1])/2];
    if(!inPoly(mid,poly))continue;
    const d=dist(poly[i],poly[j]);
    if(d>bd){bd=d;best=mid}
  }
  return best||poly[0];
}
function clipToPoly(shape,poly,margin){
  const c=interiorAnchor(poly);
  const out=[];
  for(const p of shape){
    const dx=p[0]-c[0], dy=p[1]-c[1], d=Math.hypot(dx,dy);
    if(d<1e-6){out.push(p);continue}
    const ux=dx/d, uy=dy/d;
    let boundary=Infinity;
    for(let i=0;i<poly.length;i++){
      const t=rayEdgeDist(c,[ux,uy],poly[i],poly[(i+1)%poly.length]);
      if(t!==null&&t<boundary)boundary=t;
    }
    let final=boundary===Infinity?d:Math.min(d,Math.max(0,boundary-margin));
    let cand=[c[0]+ux*final,c[1]+uy*final];
    // rete di sicurezza finale: il calcolo analitico del bordo presume un
    // poligono semplice (nessun lato che si autointerseca). Un lotto
    // patologico che arriva cosi' dal resto della ricorsione (raro, ma
    // osservato: un vertice duplicato / uno spuntone a larghezza zero) puo'
    // ingannarlo. Se il punto risulta comunque fuori, si dimezza la
    // distanza dal centro finche' non rientra davvero — funziona SEMPRE
    // perche' il centro stesso e' garantito dentro (interiorAnchor sopra).
    let guard=0;
    while(!inPoly(cand,poly)&&guard<8){
      final*=.5;
      cand=[c[0]+ux*final,c[1]+uy*final];
      guard++;
    }
    out.push(cand);
  }
  return out.length>=3?out:shape;
}
function organicBlob(poly,wobbleAmp,phase,inset){
  const{c,dirVec,nVec,maxA,maxN}=orientedExtent(poly);
  const k=inset||.9;
  const rA=maxA*k, rN=maxN*k*.96, steps=16, out=[];
  for(let i=0;i<steps;i++){
    const t=i/steps*Math.PI*2;
    const wob=1+wobbleAmp*Math.sin(t*3+phase)+wobbleAmp*.55*Math.sin(t*5+phase*1.7);
    out.push(addv(c,dirVec,Math.cos(t)*rA*wob,nVec,Math.sin(t)*rN*wob));
  }
  return clipToPoly(out,poly,3);
}
// un edificio vero e' quasi sempre un rettangolo, ma il lotto grezzo che
// esce dalla ricorsione e' spesso un trapezio. Si RIDUCE il rettangolo
// candidato finche' non ci sta intero, senza che nessun lato del lotto lo
// tocchi — il primo che ci riesce e' un vero quadrilatero.
function rectFootprint(poly,maxShrink){
  const{c,dirVec,nVec,maxA,maxN}=orientedExtent(poly);
  const MARGIN=Math.min(4,Math.min(maxA,maxN)*.12);
  let last=null;
  for(const k of [maxShrink,maxShrink*.82,maxShrink*.66,maxShrink*.5,maxShrink*.36,maxShrink*.24]){
    let rect=rectAt(c,dirVec,nVec,maxA*k,maxN*k);
    for(let i=0;i<poly.length&&rect.length>=3;i++){
      const a=poly[i], b=poly[(i+1)%poly.length];
      const dx=b[0]-a[0], dy=b[1]-a[1], L=Math.hypot(dx,dy)||1;
      let nv=[dy/L,-dx/L], offset=a[0]*nv[0]+a[1]*nv[1];
      if(c[0]*nv[0]+c[1]*nv[1]-offset>0){nv=[-nv[0],-nv[1]];offset=-offset}
      rect=clipHalf(rect,nv,offset-MARGIN,false);
    }
    if(rect.length>=3)last=rect;
    if(rect.length===4)return rect;
  }
  return last||scalePoly(poly,c,maxShrink*.5);
}
function apseShape(c,dirVec,nVec,halfA,halfN,steps){
  const backA=-halfA*.5, frontA=halfA*.3;
  const back1=addv(c,dirVec,backA,nVec,-halfN), back2=addv(c,dirVec,backA,nVec,halfN);
  const front=addv(c,dirVec,frontA,nVec,0);
  const pts=[back1,back2];
  for(let i=0;i<=steps;i++){
    const ang=Math.PI/2-(i/steps)*Math.PI;
    pts.push(addv(front,dirVec,Math.cos(ang)*halfN,nVec,Math.sin(ang)*halfN));
  }
  return pts;
}
// stampo del "palazzo importante": ogni tipo produce una o piu' parti
// calcolate sul rettangolo orientato del lotto che l'edificio ha davvero
// occupato, mai una forma indipendente dal tessuto sottostante.
function landmarkFootprint(poly,cat){
  const{c,dirVec,nVec,maxA,maxN}=orientedExtent(poly);
  const kind=IMPORTANT_SHAPE[cat];
  let parts;
  if(!kind)parts=[{poly:scalePoly(poly,c,.8),hole:null}];
  else if(kind==='courtyard'){
    // cortile grande (municipio/mercato/ospedale): un vero palazzo con
    // chiostro, non una scatola — occupa quasi tutto il lotto orientato.
    const outer=rectAt(c,dirVec,nVec,maxA*.86,maxN*.82);
    const inner=rectAt(c,dirVec,nVec,maxA*.48,maxN*.44);
    parts=[{poly:outer,hole:inner}];
  }
  else if(kind==='cross'){
    // chiesa: navata+transetto piu' generosi, cosi' la pianta a croce si
    // legge davvero invece di sembrare un incrocio di due strisce sottili.
    const nave=rectAt(c,dirVec,nVec,maxA*.85,maxN*.36);
    const transept=rectAt(c,dirVec,nVec,maxA*.36,maxN*.85);
    parts=[{poly:nave,hole:null},{poly:transept,hole:null}];
  }
  else if(kind==='apse')parts=[{poly:apseShape(c,dirVec,nVec,maxA*.85,maxN*.78,10),hole:null}];
  else if(kind==='shed'){
    // stazione: capannone allungato con testata, come un vero scalo — non
    // un rettangolo qualsiasi, si riconosce dalla proporzione.
    parts=[{poly:rectAt(c,dirVec,nVec,maxA*.9,maxN*.4),hole:null},
           {poly:rectAt(addv(c,dirVec,-maxA*.62,nVec,0),dirVec,nVec,maxA*.22,maxN*.58),hole:null}];
  }
  else if(kind==='basin'){
    // fontana: una vasca ottagonale, piccola e centrata sul lotto.
    const r=Math.min(maxA,maxN)*.55, steps=8, pts=[];
    for(let i=0;i<steps;i++){const t=i/steps*Math.PI*2;pts.push(addv(c,dirVec,Math.cos(t)*r,nVec,Math.sin(t)*r))}
    parts=[{poly:pts,hole:null}];
  }
  else parts=[{poly:scalePoly(poly,c,.88),hole:null}];
  // le forme sopra usano l'ingombro ORIENTATO del lotto (maxA/maxN): su un
  // lotto non rettangolare (quasi sempre, dopo un taglio di fiume o
  // un'ancora vicina) quell'ingombro sconfina oltre i lati veri, ed e'
  // esattamente li' che due palazzi vicini finivano sovrapposti. Stesso
  // rimedio gia' usato per le forme organiche: ritaglio SEMPRE contro il
  // vero perimetro del lotto prima di restituire.
  return parts.map(p=>({poly:clipToPoly(p.poly,poly,2),hole:p.hole?clipToPoly(p.hole,poly,2):null}));
}

/* ---------------- fiume: query locale, sponde curve, taglio ---------------- */
function riverAt(river,p){
  let best=null;
  for(let i=0;i<river.pts.length-1;i++){
    const a=river.pts[i], b=river.pts[i+1];
    const dx=b[0]-a[0], dy=b[1]-a[1], L2=dx*dx+dy*dy||1e-9;
    let t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L2; t=Math.max(0,Math.min(1,t));
    const q=[a[0]+dx*t,a[1]+dy*t], d=dist(p,q);
    if(!best||d<best.d){
      const L=Math.sqrt(L2), tan=[dx/L,dy/L], nv=[-tan[1],tan[0]];
      const side=(p[0]-q[0])*nv[0]+(p[1]-q[1])*nv[1];
      best={d,side,hw:river.hw[i]+(river.hw[i+1]-river.hw[i])*t,q,tan,nv};
    }
  }
  return best;
}
// una CORDA DRITTA, per quanto accorciata, non puo' seguire una curva
// oltre una certa distanza. Il rimedio non e' accorciare ancora, e' non
// usare piu' una retta: la lungofiume ricalca i punti veri dell'asse del
// fiume, scostati della semilarghezza locale, dentro un raggio dal punto
// d'origine — curva quando il fiume curva.
function curvedBank(river,center,side,radius){
  const pts=[];
  for(let i=0;i<river.pts.length;i++){
    if(dist(river.pts[i],center)>radius)continue;
    const a=river.pts[Math.max(0,i-1)], b=river.pts[Math.min(river.pts.length-1,i+1)];
    const tv=norm([b[0]-a[0],b[1]-a[1]]), nv=[-tv[1],tv[0]];
    pts.push([river.pts[i][0]+nv[0]*river.hw[i]*side,river.pts[i][1]+nv[1]*river.hw[i]*side]);
  }
  return pts.length>=2?pts:null;
}
// TENTATIVO FALLITO, per la cronaca: tagliare il poligono a segmenti contro
// la polilinea vera della riva (invece che contro un'unica retta) sembrava
// la correzione giusta per gli spiazzi vuoti lungo il fiume — ma tagliare
// in sequenza contro tanti segmenti equivale a intersecare tanti semipiani,
// che approssima l'INVILUPPO CONVESSO della curva, non la curva stessa. Su
// un fiume che serpeggia (non convesso) il risultato taglia via molta piu'
// terra reale di quanta ne tagliasse la singola retta — dal 18% al 80% di
// suolo scoperto vicino al fiume, peggio del problema che doveva risolvere.
// Serve una vera intersezione poligono-contro-polilinea (tipo Weiler-
// Atherton), non una sequenza di clipHalf. Non implementata: il rischio di
// un altro bug silenzioso non valeva un secondo tentativo improvvisato.
// Si torna al taglio a retta singola, imperfetto ma sicuro.
function trimRiver(poly,river){
  if(!river)return{poly,quays:[]};
  const info=riverAt(river,centroid(poly));
  const nVec=info.nv, offset=info.q[0]*nVec[0]+info.q[1]*nVec[1], hwL=info.hw;
  const proj=poly.map(v=>v[0]*nVec[0]+v[1]*nVec[1]-offset);
  const lo=Math.min(...proj),hi=Math.max(...proj), lb=-hwL, hb=hwL;
  if(hi<=lb||lo>=hb)return{poly,quays:[]};
  if(lo>=lb&&hi<=hb){
    // il centroide puo' cadere proprio su un'ansa stretta del fiume: li'
    // l'approssimazione lineare (una sola normale/semilarghezza per tutto
    // il poligono) puo' dichiarare "tutto sommerso" anche se il poligono
    // include vera terraferma poco piu' in la' lungo la curva. Buttarlo
    // via alla cieca lasciava un vuoto vero sulla mappa — verifico percio'
    // ogni vertice con la SUA riva locale prima di arrendermi.
    const reallySubmerged=poly.every(v=>{const iv=riverAt(river,v);return Math.abs(iv.side)<=iv.hw});
    if(reallySubmerged)return{poly:null,quays:[]};
    return{poly,quays:[]};
  }
  const loAbs=offset+lb, hiAbs=offset+hb, qr=140;
  const crossesLow=lo<lb&&hi>lb, crossesHigh=lo<hb&&hi>hb;
  if(crossesLow&&crossesHigh){
    const qL=curvedBank(river,info.q,-1,qr), qH=curvedBank(river,info.q,1,qr);
    const leftBank=clipHalf(poly,nVec,loAbs,false), rightBank=clipHalf(poly,nVec,hiAbs,true);
    return{split:true,leftBank,rightBank,quays:[qL,qH].filter(Boolean)};
  }
  if(crossesLow){const q=curvedBank(river,info.q,-1,qr);return{poly:clipHalf(poly,nVec,loAbs,false),quays:q?[q]:[]}}
  if(crossesHigh){const q=curvedBank(river,info.q,1,qr);return{poly:clipHalf(poly,nVec,hiAbs,true),quays:q?[q]:[]}}
  return{poly,quays:[]};
}
// il mare e' un semipiano dritto (sea.nVec/sea.offset da seaBoundary in
// world.js), non un nastro con due rive come il fiume: piu' semplice,
// stesso principio — un vero taglio contro cui la ricorsione si ferma,
// non un velo disegnato sopra edifici gia' costruiti. Il lato tagliato
// via diventa il lungomare quando emerge un vero confine (fronte(poly)).
function trimSea(poly,sea){
  if(!sea)return{poly,front:null};
  const proj=poly.map(v=>v[0]*sea.nVec[0]+v[1]*sea.nVec[1]);
  const lo=Math.min(...proj),hi=Math.max(...proj);
  if(hi<=sea.offset)return{poly,front:null};
  if(lo>sea.offset)return{poly:null,front:null};
  const front=sliceLine(poly,sea.nVec,sea.offset)[0]||null;
  return{poly:clipHalf(poly,sea.nVec,sea.offset,false),front};
}
function segCrossesRiver(a,b,river){
  if(!river)return null;
  const steps=30; let firstIn=-1,lastIn=-1;
  for(let i=0;i<=steps;i++){
    const t=i/steps, p=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
    const info=riverAt(river,p);
    if(Math.abs(info.side)<info.hw){if(firstIn<0)firstIn=i;lastIn=i}
  }
  if(firstIn<0)return null;
  const tm=(firstIn+lastIn)/2/steps;
  return[a[0]+(b[0]-a[0])*tm,a[1]+(b[1]-a[1])*tm];
}

/* ---------------- ferrovia: stessa fascia-senza-edifici del fiume ---------------- */
function nearestOnPoly(poly,p){
  let best=null;
  for(let i=0;i<poly.length;i++){
    const a=poly[i], b=poly[(i+1)%poly.length];
    const dx=b[0]-a[0], dy=b[1]-a[1], L2=dx*dx+dy*dy||1e-9;
    let t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L2; t=Math.max(0,Math.min(1,t));
    const q=[a[0]+dx*t,a[1]+dy*t], d=dist(p,q);
    if(!best||d<best.d)best={q,d};
  }
  return best.q;
}
function railBand(a,b,hw){
  const dx=b[0]-a[0], dy=b[1]-a[1], L=Math.hypot(dx,dy)||1;
  const dirVec=[dx/L,dy/L], nVec=[-dirVec[1],dirVec[0]];
  const offset=a[0]*nVec[0]+a[1]*nVec[1], alongA=a[0]*dirVec[0]+a[1]*dirVec[1];
  return{dirVec,nVec,offset,hw,alongA,alongB:alongA+L,a,b};
}
function trimRailSeg(poly,band,margin){
  const proj=poly.map(v=>v[0]*band.nVec[0]+v[1]*band.nVec[1]-band.offset);
  const lo=Math.min(...proj), hi=Math.max(...proj), lb=-band.hw, hb=band.hw;
  if(hi<=lb||lo>=hb)return{poly};
  const alongProj=poly.map(v=>v[0]*band.dirVec[0]+v[1]*band.dirVec[1]);
  const aLo=Math.min(...alongProj), aHi=Math.max(...alongProj);
  if(aHi<band.alongA-margin||aLo>band.alongB+margin)return{poly};
  if(lo>=lb&&hi<=hb)return{poly:null};
  const loAbs=band.offset+lb, hiAbs=band.offset+hb;
  const crossesLow=lo<lb&&hi>lb, crossesHigh=lo<hb&&hi>hb;
  if(crossesLow&&crossesHigh){
    const leftBank=clipHalf(poly,band.nVec,loAbs,false), rightBank=clipHalf(poly,band.nVec,hiAbs,true);
    return{split:true,leftBank,rightBank,sides:[...sliceLine(poly,band.nVec,loAbs),...sliceLine(poly,band.nVec,hiAbs)]};
  }
  if(crossesLow)return{poly:clipHalf(poly,band.nVec,loAbs,false),sides:sliceLine(poly,band.nVec,loAbs)};
  if(crossesHigh)return{poly:clipHalf(poly,band.nVec,hiAbs,true),sides:sliceLine(poly,band.nVec,hiAbs)};
  return{poly};
}
// un binario vero non e' mai un righello: curva appena, con un unico arco
// dolce tra due punti (mai piu' di qualche punto percento della lunghezza)
// — abbastanza per non leggersi come una retta forzata, troppo poco per
// sembrare un tracciato impossibile da posare davvero.
function curvedTrack(a,b,bow){
  const L=dist(a,b);
  // pochi pezzi lunghi, non tanti corti: ogni pezzo genera la propria
  // fascia "senza edifici" nella ricorsione (railBand), e fasce vicine si
  // sovrappongono ai margini — troppi pezzi ravvicinati (curva morbida ma
  // frazionata) producevano bande quasi identiche registrate piu' volte,
  // proprio la confusione vista intorno alle stazioni. La curva resta
  // dolce comunque: l'arco e' un solo seno, pochi punti bastano.
  const n=Math.max(3,Math.round(L/90));
  const dx=b[0]-a[0], dy=b[1]-a[1];
  const nx=-dy/(L||1), ny=dx/(L||1);
  const pts=[];
  for(let i=0;i<=n;i++){
    const t=i/n, off=bow*Math.sin(Math.PI*t);
    pts.push([a[0]+dx*t+nx*off, a[1]+dy*t+ny*off]);
  }
  const segs=[];
  for(let i=0;i<pts.length-1;i++)segs.push([pts[i],pts[i+1]]);
  return segs;
}
const trackBow=L=>rr(-1,1)*Math.min(38,L*.07);
function buildRail(stations,cityPoly){
  const pts=stations.map(s=>[s.x,s.y]);
  // ritorna la corsa intera dalla stazione al bordo citta' (leggermente
  // curva) piu' un breve tratto decorativo oltre il bordo.
  const extendOut=(i,dirFrom)=>{
    const dir=[pts[i][0]-dirFrom[0],pts[i][1]-dirFrom[1]];
    const L=Math.hypot(dir[0],dir[1])||1, u=[dir[0]/L,dir[1]/L];
    const edge=nearestOnPoly(cityPoly,[pts[i][0]+u[0]*MAPW,pts[i][1]+u[1]*MAPW]);
    const tail=[edge[0]+u[0]*44,edge[1]+u[1]*44];
    return[...curvedTrack(pts[i],edge,trackBow(dist(pts[i],edge))),[edge,tail]];
  };
  if(pts.length===1){
    // anche con una sola stazione la ferrovia e' una linea che ATTRAVERSA
    // la citta', non un'appendice che si ferma a meta': entra da un lato
    // ed esce dall'altro, con la stazione lungo il percorso. La direzione
    // segue l'asse lungo della citta' — il modo piu' comodo per il sistema
    // di posare un tracciato plausibile senza altre stazioni da collegare.
    const ang=axisAngle(cityPoly)+rr(-.18,.18);
    const dir=[Math.cos(ang),Math.sin(ang)];
    const edgeA=nearestOnPoly(cityPoly,[pts[0][0]+dir[0]*MAPW,pts[0][1]+dir[1]*MAPW]);
    const edgeB=nearestOnPoly(cityPoly,[pts[0][0]-dir[0]*MAPW,pts[0][1]-dir[1]*MAPW]);
    const segments=[
      ...curvedTrack(edgeA,pts[0],trackBow(dist(edgeA,pts[0]))),
      ...curvedTrack(pts[0],edgeB,trackBow(dist(pts[0],edgeB))),
      [edgeA,[edgeA[0]+dir[0]*44,edgeA[1]+dir[1]*44]],
      [edgeB,[edgeB[0]-dir[0]*44,edgeB[1]-dir[1]*44]],
    ];
    return{segments};
  }
  const inT=[0], rest=pts.map((_,i)=>i).slice(1), edges=[];
  while(rest.length){
    let best=null;
    for(const a of inT)for(const b of rest){const w=dist(pts[a],pts[b]);if(!best||w<best.w)best={a,b,w}}
    edges.push([best.a,best.b]); inT.push(best.b); rest.splice(rest.indexOf(best.b),1);
  }
  const segments=[];
  for(const[a,b]of edges)segments.push(...curvedTrack(pts[a],pts[b],trackBow(dist(pts[a],pts[b]))));
  const degree=new Map();
  for(const[a,b]of edges){degree.set(a,(degree.get(a)||0)+1);degree.set(b,(degree.get(b)||0)+1)}
  for(const i of pts.map((_,k)=>k)){
    if((degree.get(i)||0)>1)continue;
    const e=edges.find(([a,b])=>a===i||b===i);
    const other=pts[e[0]===i?e[1]:e[0]];
    segments.push(...extendOut(i,other));
  }
  return{segments};
}

/* ---------------- ancore: piazza / giardino / cimitero -----------------
   genero un N-gono orientato sull'asse locale del poligono, con un raggio
   che varia in modo organico attorno alla posizione dell'ancora. Ogni lato
   e' un vero taglio a semipiano (clipHalf) — quindi diventa una vera
   strada, e il pezzo che resta fuori da quel lato E' il lotto vicino, con
   quel lato organico gia' come proprio bordo. */
function trimSegAroundCircle(p,q,center,r){
  const dx=q[0]-p[0], dy=q[1]-p[1];
  const fx=p[0]-center[0], fy=p[1]-center[1];
  const a=dx*dx+dy*dy||1e-9, b=2*(fx*dx+fy*dy), c=fx*fx+fy*fy-r*r;
  const disc=b*b-4*a*c;
  if(disc<=0)return[[p,q]];
  const sq=Math.sqrt(disc);
  let t0=Math.max(0,(-b-sq)/(2*a)), t1=Math.min(1,(-b+sq)/(2*a));
  if(t0>=t1)return[[p,q]];
  const segs=[];
  if(t0>.02)segs.push([p,[p[0]+dx*t0,p[1]+dy*t0]]);
  if(t1<.98)segs.push([[p[0]+dx*t1,p[1]+dy*t1],q]);
  return segs;
}
function trimSegAroundAnchors(seg,anchors,skip){
  let segs=[seg];
  for(const other of anchors){
    if(other===skip)continue;
    const r=Math.max(other.halfAlong,other.halfAcross)*1.15;
    segs=segs.flatMap(s=>trimSegAroundCircle(s[0],s[1],other.pos,r));
  }
  return segs;
}
function tryReserveShape(poly,anc,anchors){
  const steps=anc.steps||14;
  for(let attempt=0;attempt<4;attempt++){
    const angle=axisAngle(poly), dirVec=[Math.cos(angle),Math.sin(angle)], nVec=[-dirVec[1],dirVec[0]];
    const verts=[];
    for(let i=0;i<steps;i++){
      const t=i/steps*Math.PI*2;
      const wob=1+anc.wobble*Math.sin(t*3+anc.phase)+anc.wobble*.5*Math.sin(t*5+anc.phase*1.7);
      verts.push(addv(anc.pos,dirVec,Math.cos(t)*anc.halfAlong*wob,nVec,Math.sin(t)*anc.halfAcross*wob));
    }
    let layer=poly, ok=true;
    const remainder=[], streetChords=[];
    for(let i=0;i<steps;i++){
      const a=verts[i], b=verts[(i+1)%steps];
      const dx=b[0]-a[0], dy=b[1]-a[1], L=Math.hypot(dx,dy)||1;
      let nv=[dy/L,-dx/L], offset=a[0]*nv[0]+a[1]*nv[1];
      if(anc.pos[0]*nv[0]+anc.pos[1]*nv[1]-offset>0){nv=[-nv[0],-nv[1]];offset=-offset}
      const outside=clipHalf(layer,nv,offset,true);
      if(outside.length>=3&&polyArea(outside)>MIN_LEAF)remainder.push(outside);
      // la corda va tagliata contro LAYER (il pezzo non ancora ristretto da
      // questo taglio), non contro il poly originale: se il poly di partenza
      // non e' convesso la stessa retta puo' attraversarlo di nuovo in un
      // punto lontano e scollegato — una corda "fantasma" che diventa una
      // strada isolata perche' nessun lotto li' vicino la riconosce mai.
      for(const ch of sliceLine(layer,nv,offset))
        streetChords.push(...trimSegAroundAnchors(ch,anchors,anc));
      layer=clipHalf(layer,nv,offset,false);
      if(layer.length<3){ok=false;break}
    }
    const targetArea=anc.halfAlong*anc.halfAcross*Math.PI;
    const areaOk=ok&&polyArea(layer)>=targetArea*.45;
    const convexity=areaOk?polyArea(layer)/(polyArea(convexHull(layer))||1):0;
    if(areaOk&&convexity>=.82)return{reserved:layer,remainder,streetChords};
    const c=centroid(poly), f=.25+attempt*.2;
    const moved=[anc.pos[0]+(c[0]-anc.pos[0])*f, anc.pos[1]+(c[1]-anc.pos[1])*f];
    anc.moved+=dist(anc.pos,moved); anc.pos=moved;
  }
  return null;
}

/* ---------------- la ricorsione unica: isolato E edificio ---------------- */
function subdivide(polyIn,depth,ctx,out){
  if(depth>MAX_DEPTH||polyIn.length<3)return;
  if(polyArea(polyIn)<MIN_LEAF)return;

  // A) mare: va tagliato PRIMA delle ancore (sotto), non dopo — un'ancora
  // (piazza/giardino/collina) non sa nulla del mare e reclamerebbe
  // volentieri un pezzo di poligono ancora tutto o in parte acqua. Con
  // acqua pesante (un mare grande) e' esattamente cosi' che si finiva con
  // migliaia di edifici disegnati oltre costa: la ricorsione entrava in
  // sezione ancore su un poligono mai ancora bagnato dal taglio del mare,
  // che allora arrivava troppo tardi (dopo section C, il fiume).
  if(ctx.sea){
    const seaTrim=trimSea(polyIn,ctx.sea);
    if(seaTrim.poly===null)return;
    polyIn=seaTrim.poly;
    if(seaTrim.front&&polyArea(polyIn)<BLOCK_TARGET*2.5)out.streets.push({pts:seaTrim.front,depth,rank:'lungomare'});
    if(polyIn.length<3||polyArea(polyIn)<MIN_LEAF)return;
  }

  // B) ancore: aspetto che il poligono sia gia' abbastanza vicino alla
  // scala dell'ancora prima di tentare il ritaglio.
  if(depth<8){
    const A0=polyArea(polyIn);
    for(const anc of ctx.anchors){
      const target=anc.halfAlong*anc.halfAcross*Math.PI;
      if(anc.done||A0<target*1.3||A0>target*6||!inPoly(anc.pos,polyIn))continue;
      const box=tryReserveShape(polyIn,anc,ctx.anchors);
      if(box){
        anc.done=true;
        // il taglio vero (box.reserved) combacia esattamente con l'edificio
        // vicino, bordo a bordo — corretto per una piazza pavimentata, ma un
        // giardino o un cimitero senza NESSUN margine visibile si legge come
        // "incollato" al palazzo accanto invece che come uno spazio a se'.
        // Un piccolo rientro verso il centro (mai calcolato scavando di
        // nuovo il terreno: e' solo il contorno disegnato un po' piu' dentro)
        // basta a suggerire il sentiero/la siepe che li' separa davvero.
        // Il giardino, essendo ormai un vero parco (area grande, vedi sopra),
        // si permette anche un bordo sinuoso vero e proprio: organicBlob
        // parte dal box.reserved GIA' tagliato con successo (non tocca la
        // sagoma usata per il taglio) e lo ritaglia di nuovo contro se
        // stesso — il margine costante garantisce che resti comunque dentro.
        const shapePoly=anc.type==='piazza'?null
          :anc.type==='giardino'?organicBlob(box.reserved,rr(.16,.24),rr(0,Math.PI*2),.92)
          :anc.type==='collina'?organicBlob(box.reserved,rr(.10,.16),rr(0,Math.PI*2),.94)
          :scalePoly(box.reserved,centroid(box.reserved),.9);
        out.reserved.push({type:anc.type,poly:box.reserved,name:anc.name,shapePoly});
        for(const seg of box.streetChords)out.streets.push({pts:seg,depth});
        for(const rem of box.remainder)subdivide(rem,depth+1,ctx,out);
        return;
      }
    }
  }

  // C) fiume: ritaglio (o spacco in due rive) prima del taglio normale
  const trimmed=trimRiver(polyIn,ctx.river);
  if(trimmed.poly===null)return;
  // il lungofiume si registra solo quando il poligono e' ormai vicino alla
  // scala di un isolato: trimRiver viene chiamato a OGNI livello della
  // ricorsione che sfiora il fiume, da poligoni enormi a lotti minuscoli —
  // registrare una curva ogni volta (raggio 140) crea decine di lungofiume
  // quasi identiche e sovrapposte, che a video si fondono in un nastro
  // grigio largo invece di restare una sottile linea tratteggiata. Stesso
  // principio gia' applicato al fronte stradale della ferrovia.
  const nearLocalScale=polyArea(polyIn)<BLOCK_TARGET*2.5;
  if(trimmed.split){
    if(nearLocalScale)out.quays.push(...trimmed.quays);
    subdivide(trimmed.leftBank,depth+1,ctx,out);
    subdivide(trimmed.rightBank,depth+1,ctx,out);
    return;
  }
  let poly=trimmed.poly;
  if(nearLocalScale)out.quays.push(...trimmed.quays);
  if(poly.length<3||polyArea(poly)<MIN_LEAF)return;

  // C.6) ferrovia: fascia senza edifici, stesso meccanismo del fiume
  if(ctx.railBands.length&&polyArea(poly)<BLOCK_TARGET*20)for(const band of ctx.railBands){
    const t=trimRailSeg(poly,band,35);
    if(t.poly===null)return;
    // il fronte stradale lungo il binario si registra solo quando il
    // poligono e' ormai vicino alla scala di un isolato: prima, ogni
    // livello della ricorsione che sfiorava la fascia (anche poligoni
    // ancora enormi) ne registrava una copia leggermente diversa, e lungo
    // tutto il corridoio si accumulavano decine di segmenti quasi
    // paralleli — il disordine di rette che partono a caso vicino ai
    // binari. Il taglio della fascia (poly=t.poly, sotto) resta invece
    // attivo a ogni scala: serve comunque per non lasciare mai un edificio
    // sopra i binari.
    if(t.sides&&polyArea(poly)<BLOCK_TARGET*2.5)for(const s of t.sides)out.streets.push({pts:s,depth,rank:'sidetrack'});
    if(t.split){
      subdivide(t.leftBank,depth+1,ctx,out);
      subdivide(t.rightBank,depth+1,ctx,out);
      return;
    }
    poly=t.poly;
    if(poly.length<3||polyArea(poly)<MIN_LEAF)return;
  }

  // D) taglio normale: isolato se l'area e' ancora "da citta'", altrimenti lotto
  const A=polyArea(poly);
  if(A<BUILDING_TARGET*rr(.6,1.7)){out.buildings.push({poly,c:centroid(poly),A});return}
  const ref=ctx.gridAngleAt(centroid(poly));
  const rel=axisAngle(poly)-ref;
  const angle=ref+Math.round(rel/(Math.PI/2))*(Math.PI/2)+rr(-.02,.02);
  const nVec=[Math.cos(angle),Math.sin(angle)];
  let lo=Infinity,hi=-Infinity;
  for(const v of poly){const s=v[0]*nVec[0]+v[1]*nVec[1];if(s<lo)lo=s;if(s>hi)hi=s}
  let a=lo,b=hi,mid=(lo+hi)/2;
  for(let k=0;k<16;k++){
    mid=(a+b)/2;
    const h=clipHalf(poly,nVec,mid,true);
    if((h.length>=3?polyArea(h):0)>A/2)a=mid;else b=mid;
  }
  mid+=(hi-lo)*rr(-.04,.04);
  const chords=sliceLine(poly,nVec,mid);
  if(!chords.length){out.buildings.push({poly,c:centroid(poly),A});return}
  const p1=clipHalf(poly,nVec,mid,true), p2=clipHalf(poly,nVec,mid,false);
  if(p1.length<3||p2.length<3||polyArea(p1)<A*.12||polyArea(p2)<A*.12){
    out.buildings.push({poly,c:centroid(poly),A});return;
  }
  out.streets.push({pts:longestChord(chords),depth,phase:A>BLOCK_TARGET?'block':'lot'});
  subdivide(p1,depth+1,ctx,out); subdivide(p2,depth+1,ctx,out);
}

/* ---------------- ponti automatici -----------------
   nessuna pedina li piazza: il fiume spacca sempre la citta' in due meta'
   generate ciascuna per conto proprio, e qui le ricollego dopo — agganciando
   ogni ponte a strade gia' reali su entrambe le rive, invece di forzare un
   taglio anticipato su un poligono ancora enorme. Il numero di ponti si
   adatta a quanto fiume attraversa la citta' (uno ogni ~220 unita', da 2 a
   6): una citta' storica vera ne ha uno ogni 2-3 isolati, non uno ogni
   quartiere. */
function autoBridges(river,cityPoly,streets){
  if(!river)return[];
  // Il fiume puo' USCIRE dalla citta' e RIENTRARE (un'ansa che scavalca il
  // confine urbano): filtrare i punti dell'asse con inPoly lascia un array
  // in cui due punti adiacenti possono stare ai due capi del pezzo saltato.
  // Misurarne la distanza come se fossero consecutivi inventa lunghezza dal
  // nulla — su Stress 106 un salto singolo da 502 su un "totale" di 1023,
  // cioe' meta' del fiume che non esiste. Da li' discendeva tutto: count
  // sovrastimato (5 ponti invece di 2) e i target che cadono dentro il
  // salto ammassati tutti al suo bordo, cioe' tre ponti sovrapposti nello
  // stesso punto. Si spezza percio' l'asse in TRATTE contigue e ogni tratta
  // porta la sua lunghezza vera.
  const inCity=densify(river.pts,20).map(p=>({p,in:inPoly(p,cityPoly)}));
  const runs=[]; let cur=null;
  for(const s of inCity){
    if(!s.in){cur=null;continue}
    if(!cur){cur=[];runs.push(cur)}
    cur.push(s.p);
  }
  const legs=runs.filter(r=>r.length>=2).map(pts=>{
    const span=[];
    for(let i=0;i<pts.length-1;i++)span.push(dist(pts[i],pts[i+1]));
    return{pts,span,len:span.reduce((a,b)=>a+b,0)};
  }).filter(l=>l.len>0);
  if(!legs.length)return[];
  const total=legs.reduce((a,l)=>a+l.len,0);
  const count=Math.max(2,Math.min(6,Math.round(total/220)));

  // agganciare il ponte al punto piu' vicino in assoluto e' un errore: quel
  // punto e' spesso un mozzicone isolato di 1-2 segmenti vicino alla riva,
  // non la rete stradale principale. Raggruppo le strade in componenti
  // connesse e per ciascuna riva individuo la componente piu' grande.
  const cand=streets.filter(c=>c.phase!=='lot');
  const n=cand.length;
  const parent=Array.from({length:n},(_,i)=>i);
  const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  const union=(i,j)=>{const a=find(i),b=find(j);if(a!==b)parent[a]=b;};
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
    const A=cand[i].pts,B=cand[j].pts;
    if(segPointDist(A[0],B[0],B[1])<2.4||segPointDist(A[1],B[0],B[1])<2.4||
       segPointDist(B[0],A[0],A[1])<2.4||segPointDist(B[1],A[0],A[1])<2.4)union(i,j);
  }
  const sizeBySide={'-1':new Map(),'1':new Map()};
  for(let i=0;i<n;i++){
    const mid=[(cand[i].pts[0][0]+cand[i].pts[1][0])/2,(cand[i].pts[0][1]+cand[i].pts[1][1])/2];
    const side=Math.sign(riverAt(river,mid).side)||1;
    const m=sizeBySide[side];
    const root=find(i);
    m.set(root,(m.get(root)||0)+1);
  }
  const mainRoot={};
  for(const side of[-1,1]){
    let best=null,bestSize=-1;
    for(const[root,sz]of sizeBySide[side])if(sz>bestSize){bestSize=sz;best=root;}
    mainRoot[side]=best;
  }
  const nearestOnSide=(p,side)=>{
    let best=null;
    for(let i=0;i<n;i++){
      if(find(i)!==mainRoot[side])continue;
      const c=cand[i];
      for(const q of[c.pts[0],c.pts[1]]){
        if(Math.sign(riverAt(river,q).side)!==side)continue;
        const d=dist(p,q);
        if(!best||d<best.d)best={d,q};
      }
    }
    return best;
  };
  // il target scorre la lunghezza VERA, cioe' le tratte una dopo l'altra
  // saltando i pezzi fuori citta': cosi' i ponti si distribuiscono sul
  // fiume che la citta' vede davvero, e due target consecutivi non possono
  // piu' finire sullo stesso punto perche' in mezzo c'era un buco.
  const pointAt=d=>{
    let rest=d;
    for(const leg of legs){
      if(rest>leg.len&&leg!==legs[legs.length-1]){rest-=leg.len;continue}
      let acc=0,idx=0;
      while(idx<leg.span.length&&acc+leg.span[idx]<rest){acc+=leg.span[idx];idx++}
      return leg.pts[Math.min(idx,leg.pts.length-1)];
    }
    return null;
  };
  const bridges=[];
  for(let k=0;k<count;k++){
    const p=pointAt((k+.5)/count*total);
    if(!p)continue;
    const info=riverAt(river,p);
    const bankA=[p[0]-info.nv[0]*info.hw,p[1]-info.nv[1]*info.hw];
    const bankB=[p[0]+info.nv[0]*info.hw,p[1]+info.nv[1]*info.hw];
    const nA=nearestOnSide(bankA,-1), nB=nearestOnSide(bankB,1);
    if(!nA||!nB||nA.d>MAX_APPROACH||nB.d>MAX_APPROACH)continue;
    // due ponti nello stesso punto sono un ponte disegnato tre volte: se il
    // fiume in citta' e' corto, count puo' chiedere piu' campate di quante
    // ne stiano.
    if(bridges.some(b=>dist(b.deckA,bankA)<CELL*.8))continue;
    bridges.push({deckA:bankA,deckB:bankB,approachA:nA.q,approachB:nB.q});
  }
  return bridges;
}

// il filtro per scala (in subdivide, sopra) non basta da solo: la STESSA
// riva puo' restare sotto la soglia per diverse generazioni consecutive
// mentre il lotto continua a rimpicciolirsi, e ognuna di quelle generazioni
// registra la propria lungofiume — decine di curve quasi identiche,
// leggermente sfalsate, che sovrapposte si leggono come un nastro grigio
// largo invece di una sottile linea tratteggiata. Qui si tiene solo una
// lungofiume ogni tanto per riva, scartando quelle troppo vicine a una
// gia' accettata.
function dedupeQuays(quays,river){
  if(!river||!quays.length)return quays;
  const meta=quays.map(q=>{
    const mid=q[Math.floor(q.length/2)];
    return{q,mid,side:Math.sign(riverAt(river,mid).side)||1};
  });
  const kept=[];
  for(const m of meta){
    if(kept.some(k=>k.side===m.side&&dist(k.mid,m.mid)<170))continue;
    kept.push(m);
  }
  return kept.map(k=>k.q);
}
// stesso problema, stesso rimedio: il fronte stradale lungo il binario
// (rank 'sidetrack') puo' restare registrato piu' volte per lo stesso
// tratto mentre il lotto scende di generazione in generazione sotto la
// soglia di scala locale.
function dedupeSidetracks(streets){
  const others=streets.filter(c=>c.rank!=='sidetrack');
  const tracks=streets.filter(c=>c.rank==='sidetrack');
  const mid=c=>[(c.pts[0][0]+c.pts[1][0])/2,(c.pts[0][1]+c.pts[1][1])/2];
  const kept=[];
  for(const t of tracks){
    const m=mid(t);
    if(kept.some(k=>dist(mid(k),m)<20))continue;
    kept.push(t);
  }
  return others.concat(kept);
}

/* ---------------- rete di sicurezza: frammenti isolati -----------------
   dopo fiume, binario e ancore restano quasi sempre uno sparuto pugno di
   frammenti isolati vicino a un bordo forzato. Rincorrere la causa
   geometrica esatta e' fragile — stesso rimedio dei ponti: non toccare la
   ricorsione, ricucire DOPO con un vero segmento verso il punto piu' vicino
   della rete principale, un frammento alla volta. */
function reconnectOrphans(streets){
  const cand=streets.filter(c=>c.phase!=='lot');
  const n=cand.length;
  const parent=Array.from({length:n},(_,i)=>i);
  const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  const union=(i,j)=>{const a=find(i),b=find(j);if(a!==b)parent[a]=b;};
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
    const A=cand[i].pts,B=cand[j].pts;
    if(segPointDist(A[0],B[0],B[1])<2.4||segPointDist(A[1],B[0],B[1])<2.4||
       segPointDist(B[0],A[0],A[1])<2.4||segPointDist(B[1],A[0],A[1])<2.4)union(i,j);
  }
  const extra=[];
  for(let iter=0;iter<60;iter++){
    const groups=new Map();
    for(let i=0;i<n;i++){const r=find(i);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(i);}
    if(groups.size<=1)break;
    let mainRoot=-1,mainSize=-1;
    for(const[r,idxs]of groups)if(idxs.length>mainSize){mainSize=idxs.length;mainRoot=r;}
    const mainIdxs=groups.get(mainRoot);
    let best=null;
    for(const[r,idxs]of groups){
      if(r===mainRoot)continue;
      for(const i of idxs)for(const j of mainIdxs)
        for(const p of cand[i].pts)for(const q of cand[j].pts){
          const d=dist(p,q);
          if(!best||d<best.d)best={d,p,q,r};
        }
    }
    if(!best||best.d>CELL*1.6)break;
    extra.push({pts:[best.p,best.q],depth:8});
    for(const i of groups.get(best.r))union(i,mainRoot);
  }
  return extra;
}

// un corso e' fatto di tanti isolati con lo stesso fronte, non un singolo
// segmento lungo: unisco i segmenti che condividono un estremo e vanno
// nella stessa direzione, e giudico la catena intera.
function classifyMajorRoutes(streets,threshold){
  const idx=[]; streets.forEach((c,i)=>{if(c.phase!=='lot')idx.push(i)});
  const parent=new Map(idx.map(i=>[i,i]));
  const find=i=>{while(parent.get(i)!==i){parent.set(i,parent.get(parent.get(i)));i=parent.get(i)}return i};
  const union=(i,j)=>{const a=find(i),b=find(j);if(a!==b)parent.set(a,b)};
  const angleOf=c=>{const d=Math.atan2(c.pts[1][1]-c.pts[0][1],c.pts[1][0]-c.pts[0][0]);return((d%Math.PI)+Math.PI)%Math.PI};
  for(let ii=0;ii<idx.length;ii++)for(let jj=ii+1;jj<idx.length;jj++){
    const i=idx[ii], j=idx[jj], A=streets[i].pts, B=streets[j].pts;
    let shared=false;
    for(const pa of[A[0],A[1]])for(const pb of[B[0],B[1]])if(dist(pa,pb)<2.4)shared=true;
    if(!shared)continue;
    let diff=Math.abs(angleOf(streets[i])-angleOf(streets[j])); if(diff>Math.PI/2)diff=Math.PI-diff;
    if(diff<.18)union(i,j);
  }
  const totals=new Map();
  for(const i of idx){const r=find(i), len=dist(streets[i].pts[0],streets[i].pts[1]); totals.set(r,(totals.get(r)||0)+len)}
  for(const i of idx)if(totals.get(find(i))>=threshold)streets[i].majorRoute=true;
}

function onBoundary(p,cityPoly,eps=4){
  for(let i=0;i<cityPoly.length;i++)
    if(segPointDist(p,cityPoly[i],cityPoly[(i+1)%cityPoly.length])<eps)return true;
  return false;
}
function nearRiverbank(p,river){
  if(!river)return false;
  const info=riverAt(river,p);
  return info.d<info.hw+16;
}
/* ---------------- invarianti geometrici ----------------
   Regole che devono valere su OGNI carta, qualunque sia la scacchiera di
   partenza. Non confrontano il risultato con un'attesa — impossibile, ogni
   carta e' diversa — ma verificano che la geometria uscita rispetti le
   poche regole che rendono una carta leggibile. Erano in mapDiagnostics
   del prototipo v1 e si sono perse riscrivendo il tessuto: qui tornano
   sulle strutture di v2 (segmenti a due punti invece di polilinee, fiume
   {pts,hw} invece di campo scalare).

   Il criterio di "cosa e' acqua" e' lo STESSO che usa il disegno
   (segCrossesRiver, ponte ferroviario in render.js): dentro la
   semilarghezza locale. Cosi' diagnostica e carta non possono dissentire —
   un controllo che misura l'acqua diversamente da come la si disegna
   segnala violazioni che sulla carta non si vedono, e viceversa. */
// tolleranza per dire "questo punto sta sull'impalcato". Tarata sul ponte
// come viene DISEGNATO: tessutoBridgesLayer traccia l'impalcato con
// stroke-width 9, cioe' semilarghezza 4.5. Sette e' un filo piu' largo del
// disegno, quindi tutto cio' che passa questo controllo e' anche
// visibilmente sul ponte. Se cambia lo stroke-width del ponte, cambia qui.
const DECK_CLEAR=7;
const ROAD_STEP=4;      // passo di campionamento lungo un segmento di strada
function sampleSeg(a,b,step){
  const L=dist(a,b), n=Math.max(1,Math.ceil(L/step)), out=[];
  for(let i=0;i<=n;i++){const t=i/n;out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t])}
  return out;
}
// quante volte un segmento ENTRA nella fascia del fiume. Serve alla
// ferrovia: render.js disegna un solo ponte per segmento (segCrossesRiver
// restituisce un unico punto medio), quindi un segmento che attraversa due
// volte ha per forza un guado non scavalcato — e il ponte che disegna
// finisce a meta' strada fra i due, sulla terra.
function riverEntries(a,b,river){
  if(!river)return 0;
  let entries=0,was=false;
  for(const p of sampleSeg(a,b,ROAD_STEP)){
    const info=riverAt(river,p), now=Math.abs(info.side)<info.hw;
    if(now&&!was)entries++;
    was=now;
  }
  return entries;
}
// indice a griglia sui poligoni: il controllo strada-dentro-edificio e'
// altrimenti quadratico (centinaia di strade x centinaia di edifici x i
// campioni di ognuna) e da solo raddoppiava il tempo dell'audit.
function polyIndex(items,cellSize){
  const buckets=new Map(), key=(gx,gy)=>gx+','+gy;
  items.forEach((item,i)=>{
    const xs=item.poly.map(p=>p[0]), ys=item.poly.map(p=>p[1]);
    const gx0=Math.floor(Math.min(...xs)/cellSize), gx1=Math.floor(Math.max(...xs)/cellSize);
    const gy0=Math.floor(Math.min(...ys)/cellSize), gy1=Math.floor(Math.max(...ys)/cellSize);
    for(let gx=gx0;gx<=gx1;gx++)for(let gy=gy0;gy<=gy1;gy++){
      const k=key(gx,gy);
      if(!buckets.has(k))buckets.set(k,[]);
      buckets.get(k).push(i);
    }
  });
  return p=>buckets.get(key(Math.floor(p[0]/cellSize),Math.floor(p[1]/cellSize)))||[];
}
function computeDiagnostics(out,anchors,landmarkPawns,cityPoly,river,bridges,rail,places){
  bridges=bridges||[];places=places||[];
  const streets=out.streets.filter(c=>c.phase!=='lot'), n=streets.length;
  const parent=Array.from({length:n},(_,i)=>i);
  const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i]}return i};
  const union=(i,j)=>{const a=find(i),b=find(j);if(a!==b)parent[a]=b};
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
    const A=streets[i].pts,B=streets[j].pts;
    if(segPointDist(A[0],B[0],B[1])<2.4||segPointDist(A[1],B[0],B[1])<2.4||
       segPointDist(B[0],A[0],A[1])<2.4||segPointDist(B[1],A[0],A[1])<2.4)union(i,j);
  }
  const compsSet=new Set();for(let i=0;i<n;i++)compsSet.add(find(i));
  let deadEnds=0;
  streets.forEach((c,i)=>{
    for(const p of[c.pts[0],c.pts[1]]){
      let linked=false;
      for(let j=0;j<n;j++){if(j===i)continue;if(segPointDist(p,streets[j].pts[0],streets[j].pts[1])<2.4){linked=true;break}}
      for(const q of out.quays){if(linked)break;for(let k=0;k<q.length-1;k++)if(segPointDist(p,q[k],q[k+1])<3){linked=true;break}}
      if(!linked&&!onBoundary(p,cityPoly)&&!nearRiverbank(p,river))deadEnds++;
    }
  });
  // --- INVARIANTE: una strada attraversa l'acqua solo su un ponte ---
  // L'impalcato (deckA-deckB) e' l'unico posto dove una strada puo' stare
  // sull'acqua; le rampe (approach-deck) sono gia' su terra e non entrano
  // nella fascia. Le lungofiume (quays) corrono lungo la riva, non
  // attraversano, e stanno in out.quays: fuori da questo conto per
  // costruzione.
  //
  // "Guadare" non e' "toccare l'acqua": il confine della fascia e' una linea
  // continua e il tessuto ci si appoggia contro, quindi una strada di riva
  // sconfina di frazioni di unita' in continuazione. Misurato su Stress 106:
  // sei strade segnalate avevano 1 campione bagnato su 15-20 e profondita'
  // massima 0.0-0.6 su un fiume semilargo 13 — invisibili sulla carta.
  // Contarle come guadi seppelliva i guadi veri nel rumore.
  //
  // Un guado vero e' una delle due cose:
  //   - la strada ESCE dall'altra parte (campioni bagnati su entrambe le
  //     sponde: il segno di `side` cambia) — l'attraversamento vero e proprio;
  //   - la strada entra in profondita' e si ferma li' (oltre un terzo della
  //     semilarghezza locale) — una via che finisce dentro l'acqua.
  const DEPTH_FRACTION=.34;
  const onDeck=p=>bridges.some(b=>segPointDist(p,b.deckA,b.deckB)<DECK_CLEAR);
  let roadWaterViolations=0; const roadWaterDetails=[];
  if(river)for(const c of out.streets){
    let maxDepth=0, deepest=null; const banks=new Set();
    for(const p of sampleSeg(c.pts[0],c.pts[1],ROAD_STEP)){
      const info=riverAt(river,p);
      if(Math.abs(info.side)>=info.hw||onDeck(p))continue;
      banks.add(Math.sign(info.side)||1);
      const depth=(info.hw-Math.abs(info.side))/info.hw;
      if(depth>maxDepth){maxDepth=depth;deepest=p}
    }
    const crosses=banks.size>1;
    if(!crosses&&maxDepth<=DEPTH_FRACTION)continue;
    roadWaterViolations++;
    if(roadWaterDetails.length<12){
      const bd=bridges.reduce((v,b)=>Math.min(v,segPointDist(deepest,b.deckA,b.deckB)),Infinity);
      roadWaterDetails.push({rank:c.rank||c.phase||'local',x:Math.round(deepest[0]),y:Math.round(deepest[1]),
        crosses,depth:+maxDepth.toFixed(2),bridgeDistance:Number.isFinite(bd)?Math.round(bd):null});
    }
  }

  // --- NON-INVARIANTE: "ogni luogo e' servito da una strada" ---
  // v1 lo controllava (placeAccessFailures) e in v2 NON e' riportabile in
  // forma utile. Misurato e verificato sui 24 scenari dell'audit:
  //
  //   - dalla geometria del luogo (poligono del parco, edificio agganciato)
  //     la distanza dalla strada piu' vicina e' 0 su TUTTI gli scenari: i
  //     lotti nascono tagliati dalle strade, quindi ogni vertice di lotto e'
  //     un incrocio per costruzione. Un controllo che non puo' fallire.
  //   - dal centro della pedina va da 3 a 49, ma quella e' la deriva del
  //     punto astratto (lo scarto casuale in main.js piu' lo spostamento
  //     dell'ancora), non la raggiungibilita' del luogo: il luogo vero sulla
  //     carta e' l'edificio agganciato, che sta sulla strada comunque.
  //
  // In v2 la preoccupazione di v1 e' gia' coperta, e meglio, da
  // anchorsUnresolved e landmarksBound: li' si vede se un luogo chiesto
  // dall'utente e' finito sulla carta, che e' la domanda vera. Meglio non
  // avere il controllo che averlo sempre verde.

  // --- INVARIANTE: una piazza ha almeno due accessi e nessun edificio dentro ---
  // Una piazza con una strada sola e' un cortile, non una piazza; una piazza
  // con un isolato costruito dentro e' un errore di ritaglio.
  const plazas=out.reserved.filter(r=>r.type==='piazza');
  let plazaAccessFailures=0, plazaBlockViolations=0;
  for(const pz of plazas){
    const c=centroid(pz.poly), reach=Math.sqrt(polyArea(pz.poly)/Math.PI)+18;
    let accesses=0;
    for(const s of out.streets)if(segPointDist(c,s.pts[0],s.pts[1])<reach)accesses++;
    if(accesses<2)plazaAccessFailures++;
    if(out.buildings.some(b=>inPoly(b.c,pz.poly)))plazaBlockViolations++;
  }

  // --- INVARIANTE: nessuna strada passa dentro un edificio ---
  // Gli edifici nascono TAGLIATI dalle strade (subdivide), quindi ogni
  // strada corre per forza SUL bordo di due lotti: il confronto va fatto
  // contro il NUCLEO del lotto, non contro il lotto intero, altrimenti si
  // conta come violazione ogni normale taglio della ricorsione (misurato:
  // ~150 falsi positivi per carta). Quello che resta e' il caso vero — una
  // strada aggiunta DOPO la suddivisione, cioe' una rampa di ponte o un
  // raccordo di reconnectOrphans, tirata sopra lotti gia' costruiti.
  const cores=out.buildings.map(b=>({poly:scalePoly(b.poly,b.c,.72)}));
  const coreAt=polyIndex(cores,CELL);
  let buildingRoadViolations=0;
  for(const c of out.streets){
    let hit=false;
    for(const p of sampleSeg(c.pts[0],c.pts[1],ROAD_STEP)){
      for(const i of coreAt(p))if(inPoly(p,cores[i].poly)){hit=true;break}
      if(hit)break;
    }
    if(hit)buildingRoadViolations++;
  }

  // --- INVARIANTE: la ferrovia non guada il fiume ---
  // render.js disegna un ponte per ogni segmento che attraversa, ma UNO
  // solo: un segmento che entra due volte nell'acqua ha un guado scoperto.
  let railUnbridged=0;
  if(rail&&river)for(const[a,b]of rail.segments)if(riverEntries(a,b,river)>1)railUnbridged++;

  return{
    streets:n, components:compsSet.size, deadEnds,
    buildings:out.buildings.length, reserved:out.reserved.length,
    roadWaterViolations, roadWaterDetails,
    plazas:plazas.length, plazaAccessFailures, plazaBlockViolations,
    buildingRoadViolations, railUnbridged,
    anchorsMoved:anchors.filter(a=>a.moved>.5).length,
    anchorsFallback:anchors.filter(a=>a.fallback).length,
    anchorsUnresolved:anchors.filter(a=>!a.done).length,
    landmarksBound:landmarkPawns.filter(p=>p.bound).length,
    landmarksTotal:landmarkPawns.length,
  };
}

/* ---------------- orchestrazione del tessuto -----------------
   Riceve gli ingredienti gia' pronti da world.js (cityPoly, il fiume
   principale nel formato {pts,hw}, i luoghi) e produce l'intero tessuto
   urbano in un colpo solo. */
// PCA locale sul contorno città: stessa idea di axisAngle, ma usa solo i
// punti del bordo entro un raggio dal punto interrogato invece che tutto il
// poligono. Un'unica direzione per l'intera sagoma andava bene sul
// placeholder quasi rettangolare del prototipo, ma la sagoma vera (campo
// di urbanità + marching squares) è amorfa: un angolo fisso ci si allinea
// bene in certe zone e ci va storto in altre, producendo intere diagonali
// di lotti a trapezio (persi come "cortile" invece che come edificio).
// Con pochi punti vicini (centro città lontano da ogni bordo) non c'è una
// stima locale affidabile: si ricade sull'angolo globale.
function localAxisAngle(boundarySamples,p,radius){
  const pts=boundarySamples.filter(q=>dist(q,p)<radius);
  if(pts.length<6)return null;
  const c=centroid(pts);
  let sxx=0,sxy=0,syy=0;
  for(const q of pts){const dx=q[0]-c[0],dy=q[1]-c[1];sxx+=dx*dx;sxy+=dx*dy;syy+=dy*dy}
  return .5*Math.atan2(2*sxy,sxx-syy);
}
function buildTessuto(cityPoly, river, places, railStations, hills, sea){
  const anchors=places.filter(p=>ANCHOR_CATS.has(p.cat)).map(p=>({
    type:p.cat,pos:[p.x,p.y],name:p.name,done:false,moved:0,fallback:false,
    // un giardino da pedina e' un vero PARCO cittadino, non un'aiuola: deve
    // leggersi come uno spazio a se', ben piu' grande di una piazza o di un
    // cimitero. Un raggio quasi doppio (area ~2.6x) fa si' che l'ancora
    // reclami un pezzo di citta' ancora poco suddiviso, prima che la
    // ricorsione lo tagli in isolati piccoli — esattamente come un vero
    // parco urbano precede i quartieri intorno, non nasce dai loro ritagli.
    // p.parkTier=2 (due pedine verdi adiacenti, vedi main.js) chiede un
    // "parco cittadino" ancora piu' grande di un giardino normale.
    halfAlong:p.cat==='piazza'?rr(33,46):p.cat==='giardino'?rr(58,78)*(p.parkTier===2?1.35:1):rr(37,53),
    halfAcross:p.cat==='piazza'?rr(26,37):p.cat==='giardino'?rr(46,62)*(p.parkTier===2?1.35:1):rr(31,44),
    // ATTENZIONE — qui wobble/steps descrivono la sagoma che tryReserveShape
    // usa per il VERO taglio (le strade nascono da questi lati, vedi sopra):
    // deve restare vicina a un'ellisse, altrimenti il controllo di
    // convessita' (>=.82, riga piu' sotto in tryReserveShape) non passa mai
    // e l'ancora cade SEMPRE nel ripiego "prendi l'edificio piu' vicino" —
    // verificato: con wobble .30-.40 il giardino falliva il taglio reale nel
    // 100% dei tentativi provati, finendo minuscolo invece che un parco. Il
    // profilo sinuoso "vero" (quello che l'utente vede) va aggiunto DOPO,
    // come shapePoly cosmetico sul poligono gia' tagliato con successo, non
    // qui: vedi subdivide(), blocco "B) ancore".
    wobble:p.cat==='cimitero'?rr(.14,.20):rr(.12,.18),
    phase:rr(0,Math.PI*2), steps:10,
  }));
  // collina in citta' (agglomerato verde >=3 celle, non sul bordo — vedi
  // main.js): non nasce da una pedina vera, e' un ostacolo di terreno.
  // Riusa la STESSA macchina di ritaglio delle ancore: la sagoma diventa un
  // vero taglio nel tessuto (out.reserved), il suo perimetro nasce come
  // strada vera che le gira attorno, e la ricorsione prosegue solo sul
  // resto — nessun edificio puo' finirci sopra, esattamente come una
  // piazza. Cresce con la dimensione dell'agglomerato (h.n celle).
  for(const h of (hills||[])){
    const scale=Math.sqrt(Math.max(1,h.n)/3);
    anchors.push({
      type:'collina',pos:[h.x,h.y],name:nameFor('collina'),done:false,moved:0,fallback:false,
      halfAlong:rr(46,64)*scale,halfAcross:rr(38,52)*scale,
      wobble:rr(.14,.20),phase:rr(0,Math.PI*2),steps:12,
    });
  }
  const landmarkPawns=places.filter(p=>!ANCHOR_CATS.has(p.cat));
  const rail=railStations.length?buildRail(railStations,cityPoly):null;
  const railBands=rail?rail.segments.map(([a,b])=>railBand(a,b,RAIL_HW)):[];
  const cityGridAngle=axisAngle(cityPoly);
  const gridAngleAt=river?(p=>{
    const info=riverAt(river,p);
    if(info.d<CELL*2.6)return Math.atan2(info.tan[1],info.tan[0]);
    return cityGridAngle;
  }):(()=>cityGridAngle);
  const ctx={river,anchors,railBands,gridAngleAt,sea};
  const out={streets:[],quays:[],buildings:[],reserved:[]};
  subdivide(cityPoly,0,ctx,out);
  out.quays=dedupeQuays(out.quays,river);
  out.streets=dedupeSidetracks(out.streets);

  const bridges=river?autoBridges(river,cityPoly,out.streets):[];
  for(const b of bridges){
    out.streets.push({pts:[b.approachA,b.deckA],depth:0,rank:'bridgehead'});
    out.streets.push({pts:[b.deckA,b.deckB],depth:0,rank:'bridgehead'});
    out.streets.push({pts:[b.deckB,b.approachB],depth:0,rank:'bridgehead'});
  }
  out.streets.push(...reconnectOrphans(out.streets));
  classifyMajorRoutes(out.streets,260);

  // rete di sicurezza: un'ancora senza spazio reclama l'edificio piu' vicino
  for(const anc of anchors){
    if(anc.done)continue;
    let best=-1,bd=Infinity;
    out.buildings.forEach((b,i)=>{if(b._claimed)return;const d=dist(anc.pos,b.c);if(d<bd){bd=d;best=i}});
    if(best>=0&&bd<CELL*1.8){
      out.buildings[best]._claimed=true;
      const wob=anc.type==='giardino'?.32:anc.type==='cimitero'?.14:anc.type==='collina'?.14:.12;
      out.reserved.push({type:anc.type,poly:out.buildings[best].poly,name:anc.name,
        shapePoly:organicBlob(out.buildings[best].poly,wob,rr(0,Math.PI*2),.72)});
      out.buildings.splice(best,1);
      anc.done=true;anc.fallback=true;
    }
  }

  // i luoghi occupano l'edificio generato piu' vicino: un riferimento a un
  // oggetto che esiste davvero nel tessuto, non un'icona indipendente. Per
  // le categorie che meritano un palazzo importante (chiesa, municipio,
  // mercato, teatro, stazione) si cerca un po' piu' in la' e si preferisce
  // un lotto GIA' grande, non il piu' vicino in assoluto — altrimenti una
  // chiesa poteva finire su un lotto minuscolo solo perche' era il primo
  // a portata, mentre un lotto ben piu' grande stava a pochi passi in piu'.
  const claimed=new Set();
  const BIG_LANDMARK=new Set(['chiesa','municipio','mercato','teatro','stazione','cinema','tribunale']);
  // Una pedina sul bordo esterno della scacchiera (riga o colonna 0 e 7)
  // cade spesso FUORI dalla sagoma della citta': li' non ci sono edifici, e
  // con un raggio fisso non trovava niente a cui agganciarsi e spariva —
  // in silenzio, che e' la parte peggiore: l'utente aveva messo una pedina
  // e sulla carta non c'era nulla, senza uno straccio di spiegazione.
  // Misurato: 8 pedine tutte sul bordo -> una non compariva; le stesse 8
  // spostate di una casella verso l'interno -> tutte presenti.
  // Quindi, se il raggio normale non basta, si allarga: meglio il luogo
  // agganciato al palazzo utile piu' vicino — al margine della citta',
  // dalla parte giusta — che il luogo inesistente.
  const RAGGIO_DISPERATO=CELL*4;
  for(const lp of landmarkPawns){
    const prefersBig=BIG_LANDMARK.has(lp.cat);
    const searchR=prefersBig?CELL*1.9:CELL*1.4;
    let best=-1,bestScore=Infinity;
    const cerca=raggio=>{
      best=-1;bestScore=Infinity;
      out.buildings.forEach((b,i)=>{
        if(claimed.has(i)||b.landmark||b.A<MIN_BUILDING_DRAW)return;
        const d=dist([lp.x,lp.y],b.c);
        if(d>raggio)return;
        // nel ripiego conta solo la vicinanza: a quella distanza preferire
        // un lotto grande porterebbe il luogo ancora piu' lontano da dove
        // e' stata messa la pedina.
        const score=(prefersBig&&raggio===searchR)?d-Math.sqrt(b.A)*.7:d;
        if(score<bestScore){bestScore=score;best=i}
      });
    };
    cerca(searchR);
    if(best<0)cerca(RAGGIO_DISPERATO);
    if(best>=0){
      claimed.add(best);
      const b=out.buildings[best];
      b.landmark={cat:lp.cat,name:lp.name};
      b.footprintParts=landmarkFootprint(b.poly,lp.cat);
      lp.bound=true;
      // il simbolo va verso un angolo del palazzo vero, non al centro:
      // altrimenti la sagoma appena disegnata sparisce sotto il bollino
      // (stessa tecnica del marcatore di piazza in main.js).
      const ext=orientedExtent(b.poly);
      lp.iconAnchor=addv(ext.c,ext.dirVec,ext.maxA*.66,ext.nVec,ext.maxN*.66);
    }
  }

  // verde autonomo: qualche edificio comune diventa spazio verde, come i
  // ritagli inutilizzati che ogni citta' vera accumula nel tempo.
  {
    const candidates=[];
    out.buildings.forEach((b,i)=>{if(!b.landmark&&b.A>510&&b.A<4100)candidates.push(i)});
    let budget=Math.min(6,Math.floor(out.buildings.length/8));
    const claimedGreen=new Set();
    while(budget>0&&candidates.length){
      const idx=(RND()*candidates.length)|0, i=candidates.splice(idx,1)[0];
      const b=out.buildings[i];
      claimedGreen.add(i);
      out.reserved.push({type:'verde',poly:b.poly,name:null,
        shapePoly:organicBlob(b.poly,.22,rr(0,Math.PI*2),.68)});
      budget--;
    }
    out.buildings=out.buildings.filter((b,i)=>!claimedGreen.has(i));
  }

  // cortile in verde: un lotto troppo storto per un vero rettangolo
  // (rectFootprint sotto soglia, RECT_ACCEPT) restava sempre terreno
  // libero disegnato col colore nudo della citta' — su un gruppo di lotti
  // vicini, tutti storti per la stessa ragione (un'ansa del fiume, un
  // margine cittadino), si leggeva come una vasta area grigia. Un lotto
  // irregolare e' pero' proprio il candidato migliore per un giardino: la
  // forma organica (ora ritagliata contro i suoi lati veri) non ha bisogno
  // di un angolo retto per starci bene. Solo una PARTE viene convertita,
  // non tutti — altrimenti si perderebbe la varieta' di una citta' vera,
  // dove un cortile davvero resta anche solo terreno libero.
  {
    const claimedGarden=new Set();
    out.buildings.forEach((b,i)=>{
      if(b.landmark||b.A<MIN_BUILDING_DRAW)return;
      const rect=rectFootprint(b.poly,.84);
      if(polyArea(rect)>=b.A*RECT_ACCEPT)return;
      if(RND()>=.4)return;
      claimedGarden.add(i);
      out.reserved.push({type:'verde',poly:b.poly,name:null,
        shapePoly:organicBlob(b.poly,.20,rr(0,Math.PI*2),.7)});
    });
    out.buildings=out.buildings.filter((b,i)=>!claimedGarden.has(i));
  }

  // sagrato: qualche chiesa (e qualche municipio) reclama anche il lotto
  // libero piu' vicino per farne un piccolo spiazzo davanti — piazza o
  // giardino, come un vero sagrato o una corte d'onore. Solo una parte,
  // non tutte: altrimenti ogni chiesa diventerebbe un piccolo complesso
  // identico.
  const claimedForecourt=new Set();
  const nearbyFreeLot=(pos,maxD)=>{
    let best=-1,bd=Infinity;
    out.buildings.forEach((b,i)=>{
      if(claimedForecourt.has(i)||b.landmark||b.A<200||b.A>2600)return;
      const d=dist(pos,b.c); if(d<bd){bd=d;best=i}
    });
    return bd<maxD?best:-1;
  };
  for(const b of out.buildings){
    if(!b.landmark)continue;
    const wantsForecourt=b.landmark.cat==='chiesa'?RND()<.4:b.landmark.cat==='municipio'&&RND()<.25;
    if(!wantsForecourt)continue;
    const idx=nearbyFreeLot(b.c,CELL*1.15);
    if(idx<0)continue;
    claimedForecourt.add(idx);
    const nb=out.buildings[idx];
    const giardino=RND()<.5;
    out.reserved.push({type:giardino?'giardino':'piazza',poly:nb.poly,name:null,
      shapePoly:giardino?organicBlob(nb.poly,.32,rr(0,Math.PI*2),.72):null});
  }
  if(claimedForecourt.size)out.buildings=out.buildings.filter((b,i)=>!claimedForecourt.has(i));

  // palazzi complessi sparsi: alcuni edifici comuni, a caso, prendono una
  // pianta piu' articolata (cortile o L, ritagliata dentro il VERO lotto —
  // mai piu' grande di lui) invece del solito rettangolo, e talvolta si
  // affiancano un piccolo giardino, una piazzetta o una fontana nel lotto
  // libero adiacente. Un tocco di varieta' realistica, non un evento raro
  // quanto un vero landmark ma nemmeno la norma.
  {
    const claimedNeighbor=new Set();
    const candidates=[];
    out.buildings.forEach((b,i)=>{if(!b.landmark&&b.A>900&&b.A<4500)candidates.push(i)});
    let budget=Math.min(6,Math.floor(out.buildings.length/140));
    while(budget>0&&candidates.length){
      const idx=(RND()*candidates.length)|0, i=candidates.splice(idx,1)[0];
      if(claimedNeighbor.has(i))continue;
      const b=out.buildings[i];
      const{c,dirVec,nVec,maxA,maxN}=orientedExtent(b.poly);
      if(RND()<.5){
        const outer=scalePoly(b.poly,c,.92), inner=rectAt(c,dirVec,nVec,maxA*.42,maxN*.38);
        b.footprintParts=[{poly:clipToPoly(outer,b.poly,2),hole:inner}];
      }else{
        const a2=maxA*.85,n2=maxN*.85,cut=maxA*.5;
        const raw=[[-a2,-n2],[a2,-n2],[a2,n2-cut],[a2-cut,n2-cut],[a2-cut,n2],[-a2,n2]]
          .map(([a,n])=>addv(c,dirVec,a,nVec,n));
        b.footprintParts=[{poly:clipToPoly(raw,b.poly,2),hole:null}];
      }
      budget--;
      if(RND()<.55){
        const nIdx=nearbyFreeLot(b.c,CELL*.85);
        if(nIdx>=0){
          claimedNeighbor.add(nIdx);
          const nb=out.buildings[nIdx], roll=RND();
          if(roll<.4)out.reserved.push({type:'giardino',poly:nb.poly,name:null,
            shapePoly:organicBlob(nb.poly,.32,rr(0,Math.PI*2),.72)});
          else if(roll<.75)out.reserved.push({type:'piazza',poly:nb.poly,name:null,shapePoly:null});
          else out.reserved.push({type:'fontana',poly:nb.poly,name:null,
            shapePoly:organicBlob(nb.poly,.05,rr(0,Math.PI*2),.4)});
        }
      }
    }
    if(claimedNeighbor.size)out.buildings=out.buildings.filter((b,i)=>!claimedNeighbor.has(i));
  }

  const diag=computeDiagnostics(out,anchors,landmarkPawns,cityPoly,river,bridges,rail,places);
  diag.rail=!!rail;
  return {out,bridges,rail,anchors,landmarkPawns,diag};
}
