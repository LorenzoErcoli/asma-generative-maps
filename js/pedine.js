"use strict";
/* =====================================================================
   IL CODICE DELLE PEDINE — sorgente unica.

   Un colore e' un tema, una forma richiama l'oggetto reale. Da qui
   discendono tre cose che devono per forza dire la stessa cosa:
     - MARKER_TO_PLACE, con cui lo scanner traduce un marker in un luogo
     - la legenda a schermo (renderLegend in ui.js)
     - la scheda A4 da stampare (pedine.html)
   Stavano dentro ui.js, che pero' costruisce anche la console e ha
   bisogno del DOM: la scheda stampabile non poteva riusarle senza
   trascinarsi dietro tutto il resto. Un solo posto da aggiornare se
   cambia un abbinamento.
   ===================================================================== */
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
    {shape:'triangolo',cat:'guarnigione',note:'lo scudo della vedetta'},
    {shape:'croce',cat:'tribunale',note:'la bilancia in equilibrio'},
  ]},
  {color:'giallo',theme:'dei Mercanti',entries:[
    {shape:'quadrato',cat:'mercato',note:'i banchi a scacchiera'},
    {shape:'croce',cat:'stazione',note:'il passaggio a livello'},
    {shape:'triangolo',cat:'porto',note:'la vela di una barca'},
    {shape:'cerchio',cat:'faro',note:'il fascio di luce sul mare'},
    {shape:'pentagono',cat:'dogana',note:'la sbarra del confine'},
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
    {shape:'croce',cat:'farmacia',note:'il mortaio e il pestello'},
    {shape:'pentagono',cat:'locanda',note:"il letto dell'ultima stanza"},
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
// Nome leggibile della forma, per etichette e tooltip.
const SHAPE_NAME={quadrato:'quadrato',cerchio:'cerchio',triangolo:'triangolo',croce:'croce',pentagono:'pentagono'};
// La pedina COME SI VEDE SUL TAVOLO: disco del suo colore, sagoma bianca
// sopra. Serve ovunque si debba dire "questa cosa qui, non un'altra" —
// nella console, nella legenda, sulla scheda A4 — ed e' l'unico disegno che
// una persona puo' confrontare a occhio con la pedina che ha in mano.
function pawnChipSvg(color,shape,size){
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" class="pawn-chip">
    <circle cx="50" cy="50" r="45" fill="${MARKER_COLOR[color]}" stroke="rgba(0,0,0,.55)" stroke-width="7"/>
    <path d="${SHAPE_SVG_PATH[shape]}" fill="#fff" transform="translate(50 50) scale(.6) translate(-50 -50)"/>
  </svg>`;
}
function shapeSvg(shape,filled){
  const fill=filled?'currentColor':'none', stroke=filled?'none':'currentColor';
  return `<svg viewBox="0 0 100 100" width="24" height="24"><path d="${SHAPE_SVG_PATH[shape]}" fill="${fill}" stroke="${stroke}" stroke-width="5"/></svg>`;
}
