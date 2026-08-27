"use strict";
/* =====================================================================
   NOMI — toponimi, vie, personaggi. Puro testo, nessuna dipendenza
   geometrica: riusa solo RND/pick da geometry.js.
   ===================================================================== */
const NB={
 pre:['San','Santa','Porto','Castel','Monte','Villa','Borgo','Ponte','Torre','Colle','Val','Ca\'','Rocca'],
 root:['ald','savr','corel','mont','vald','aster','fior','cael','ombr','sol','bran','esper','luc','sarn',
       'trev','marev','oldr','cass','vern','durn','melf','ansel','quer','tibr','arn','sevr','lond','pram'],
 suf:['ano','ora','etta','ino','aglia','esco','onte','ea','iano','usa','ento','ico','ella','ari'],
 street:['Via','Via','Via','Via','Corso','Viale','Vicolo','Strada','Salita','Contrada','Calle'],
 major:['Corso','Viale','Boulevard','Corso','Viale'],
};
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
function word(){return cap(pick(NB.root)+pick(NB.suf))}
function propr(){const s=RND();
  if(s<.38)return cap(pick(NB.pre))+' '+word();
  if(s<.8)return word();
  return word()+' '+word();
}
function streetName(major){
  const t=major?pick(NB.major):pick(NB.street);
  const s=RND();
  if(s<.3)return t+' di '+propr();
  if(s<.5)return t+' del '+word();
  if(s<.65)return t+' dei '+word()+'i';
  return t+' '+propr();
}
// 'sub' e' il sottotipo scelto dal giocatore per le categorie generiche
// (oggi solo 'chiesa' → CUSTOM_TYPES in world.js): "Moschea di X" invece
// del fisso "Chiesa di X". Nessun sub passato = comportamento di sempre.
function nameFor(cat,sub){
  const n=propr();
  if(sub)return sub+' di '+n;
  return ({chiesa:'Chiesa di '+n,cimitero:'Cimitero di '+n,monumento:'Monumento a '+n,municipio:'Palazzo '+n,
   piazza:'Piazza '+n,torre:'Torre '+n,mercato:'Mercato di '+n,stazione:'Stazione '+n,porto:'Porto '+n,
   biblioteca:'Biblioteca '+n,teatro:'Teatro '+n,cinema:'Cinema '+n,giardino:'Giardino '+n,
   fontana:'Fontana di '+n,osteria:'Osteria '+n,bottega:'Bottega '+n,locale:'Locale '+n,collina:'Collina di '+n})[cat]||n;
}
const MICRO={
 classico:{chiesa:'raccoglimento tra navate antiche',piazza:'cuore civile della città',mercato:'voci e banchi al mattino',
   teatro:'sipario di velluto e stucchi',cinema:'buio in sala, luce del proiettore',giardino:'ombra e sentieri ordinati',_:'una tappa della città vecchia'},
 culturale:{chiesa:'silenzio e affreschi da studiare',biblioteca:'sale di lettura e manoscritti',
   teatro:'prosa e concerti da camera',cinema:'pellicole d\'autore e retrospettive',_:'luogo colto, da attraversare piano'},
 festaiolo:{locale:'musica fino a tarda notte',piazza:'brindisi e folla festante',osteria:'tavolate lunghe e vino',
   _:'tappa vivace del giro'},
 rilassante:{giardino:'panchine e passi lenti',fontana:'acqua che scorre in pace',_:'sosta tranquilla, lontano dal chiasso'},
 avventura:{torre:'vedetta sui confini',
   _:'punto aspro, ai margini'},
};
const microFor=(c,ch)=>{const m=MICRO[ch]||MICRO.classico;return m[c]||m._};
