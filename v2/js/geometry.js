"use strict";
/* =====================================================================
   GEOMETRIA CONDIVISA — RNG deterministico, rumore, campi scalari,
   marching squares, smoothing, primitive di poligono.
   Usato sia dal mondo (campagna/fiumi/quartieri) sia dal tessuto urbano.
   ===================================================================== */

/* ---------------- RNG deterministico ---------------- */
function hashStr(s){let h=2166136261>>>0;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
let RND=mulberry32(1);
const rr=(a,b)=>a+(b-a)*RND();
const pick=a=>a[Math.floor(RND()*a.length)|0];
const clamp=(v,a,b)=>v<a?a:v>b?b:v;

/* ---------------- rumore frattale (domain warping) ---------------- */
let NSEED=1;
function h2(i,j){let n=(i*374761393+j*668265263+NSEED*1442695041)|0;
  n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295}
function vnoise(x,y){
  const i=Math.floor(x),j=Math.floor(y),fx=x-i,fy=y-j;
  const u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
  return h2(i,j)*(1-u)*(1-v)+h2(i+1,j)*u*(1-v)+h2(i,j+1)*(1-u)*v+h2(i+1,j+1)*u*v;
}
function fbm(x,y,oct){let s=0,a=.5,f=1;for(let k=0;k<oct;k++){s+=a*(vnoise(x*f,y*f)*2-1);f*=2;a*=.5}return s}
function warp(x,y,amp){
  const wx=x+amp*(fbm(x*.0042,y*.0042,2)+.35*fbm(x*.019,y*.019,2));
  const wy=y+amp*(fbm(x*.0042+53.1,y*.0042+17.7,2)+.35*fbm(x*.019+91.3,y*.019+44.9,2));
  return [wx,wy];
}

/* ---------------- geometria di base ---------------- */
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const polyLen=p=>p.reduce((a,q,i)=>i?a+dist(p[i-1],q):0,0);
function polyArea(p){let a=0;for(let i=0,j=p.length-1;i<p.length;j=i++)a+=(p[j][0]*p[i][1]-p[i][0]*p[j][1]);return Math.abs(a/2)}
function centroid(p){let x=0,y=0;for(const v of p){x+=v[0];y+=v[1]}return[x/p.length,y/p.length]}
function inPoly(p,poly){
  let c=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i],b=poly[j];
    if((a[1]>p[1])!==(b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/((b[1]-a[1])||1e-9)+a[0])c=!c;
  }
  return c;
}
function distSeg(p,a,b){
  const vx=b[0]-a[0],vy=b[1]-a[1];const wx=p[0]-a[0],wy=p[1]-a[1];
  const L=vx*vx+vy*vy||1e-9;let t=(wx*vx+wy*vy)/L;t=clamp(t,0,1);
  return Math.hypot(a[0]+vx*t-p[0],a[1]+vy*t-p[1]);
}
const segPointDist=distSeg;
const norm=v=>{const L=Math.hypot(v[0],v[1])||1;return[v[0]/L,v[1]/L]};

// mezzo piano: tiene il lato positivo (keepPos) o negativo di n*x=offset
function clipHalf(poly,nVec,offset,keepPos){
  const out=[],n=poly.length;
  for(let i=0;i<n;i++){
    const a=poly[i],b=poly[(i+1)%n];
    const sa=a[0]*nVec[0]+a[1]*nVec[1]-offset, sb=b[0]*nVec[0]+b[1]*nVec[1]-offset;
    const aIn=keepPos?sa>=-1e-9:sa<=1e-9, bIn=keepPos?sb>=-1e-9:sb<=1e-9;
    if(aIn)out.push(a);
    if(aIn!==bIn){const t=sa/(sa-sb);out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t])}
  }
  return out;
}
// segmento(i) visibile dell'intersezione poly ∩ {x·nVec=offset}
function sliceLine(poly,nVec,offset){
  const pts=[],n=poly.length;
  for(let i=0;i<n;i++){
    const a=poly[i],b=poly[(i+1)%n];
    const sa=a[0]*nVec[0]+a[1]*nVec[1]-offset, sb=b[0]*nVec[0]+b[1]*nVec[1]-offset;
    if((sa<0)!==(sb<0)){const t=sa/(sa-sb);pts.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t])}
  }
  if(pts.length<2)return[];
  const dv=[-nVec[1],nVec[0]];
  pts.sort((p,q)=>(p[0]*dv[0]+p[1]*dv[1])-(q[0]*dv[0]+q[1]*dv[1]));
  const chords=[];
  for(let i=0;i+1<pts.length;i+=2){
    const mid=[(pts[i][0]+pts[i+1][0])/2,(pts[i][1]+pts[i+1][1])/2];
    if(inPoly(mid,poly))chords.push([pts[i],pts[i+1]]);
  }
  return chords;
}
function longestChord(chords){
  let best=chords[0],bl=dist(chords[0][0],chords[0][1]);
  for(const ch of chords){const l=dist(ch[0],ch[1]);if(l>bl){bl=l;best=ch}}
  return best;
}
function axisAngle(poly){
  const c=centroid(poly);let sxx=0,sxy=0,syy=0;
  for(const p of poly){const dx=p[0]-c[0],dy=p[1]-c[1];sxx+=dx*dx;sxy+=dx*dy;syy+=dy*dy}
  return .5*Math.atan2(2*sxy,sxx-syy);
}
function orientedExtent(poly){
  const c=centroid(poly), angle=axisAngle(poly);
  const dirVec=[Math.cos(angle),Math.sin(angle)], nVec=[-dirVec[1],dirVec[0]];
  let maxA=0,maxN=0;
  for(const p of poly){const dx=p[0]-c[0],dy=p[1]-c[1];maxA=Math.max(maxA,Math.abs(dx*dirVec[0]+dy*dirVec[1]));maxN=Math.max(maxN,Math.abs(dx*nVec[0]+dy*nVec[1]))}
  return{c,dirVec,nVec,maxA,maxN};
}
const addv=(c,dirVec,da,nVec,dn)=>[c[0]+dirVec[0]*da+nVec[0]*dn, c[1]+dirVec[1]*da+nVec[1]*dn];
function rectAt(c,dirVec,nVec,halfA,halfN){
  return[addv(c,dirVec,halfA,nVec,-halfN),addv(c,dirVec,halfA,nVec,halfN),
         addv(c,dirVec,-halfA,nVec,halfN),addv(c,dirVec,-halfA,nVec,-halfN)];
}
const scalePoly=(poly,c,s)=>poly.map(p=>[c[0]+(p[0]-c[0])*s,c[1]+(p[1]-c[1])*s]);
function convexHull(pts){
  const p=pts.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lower=[];for(const pt of p){while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],pt)<=0)lower.pop();lower.push(pt)}
  const upper=[];for(let i=p.length-1;i>=0;i--){const pt=p[i];while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],pt)<=0)upper.pop();upper.push(pt)}
  lower.pop();upper.pop();
  return lower.concat(upper);
}

/* ---------------- densificazione, campi campionati, marching squares ---------------- */
function densify(pts,gap){
  const out=[];
  for(let i=0;i<pts.length-1;i++){
    const a=pts[i],b=pts[i+1],L=dist(a,b),n=Math.max(1,Math.ceil(L/gap));
    for(let k=0;k<n;k++){const t=k/n;out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t])}
  }
  out.push(pts[pts.length-1]);
  return out;
}
// STEP/GW/GH sono definiti in world.js (dipendono dalla scala della carta,
// N/CELL/PAD) e usati qui come globali — stesso schema del monolite originale.
function fieldAt(F,x,y){
  const fx=clamp(x/STEP,0,GW), fy=clamp(y/STEP,0,GH);
  const i=Math.min(GW-1,Math.floor(fx)), j=Math.min(GH-1,Math.floor(fy));
  const tx=fx-i, ty=fy-j, s=GW+1;
  const a=F[j*s+i],b=F[j*s+i+1],c=F[(j+1)*s+i+1],d=F[(j+1)*s+i];
  return a*(1-tx)*(1-ty)+b*tx*(1-ty)+c*tx*ty+d*(1-tx)*ty;
}
function contour(F,thr){
  const segs=[];const s=GW+1;
  const P=(i,j)=>F[j*s+i], X=i=>i*STEP, Y=j=>j*STEP;
  const lp=(a,b,va,vb)=>a+(b-a)*((thr-va)/((vb-va)||1e-9));
  for(let j=0;j<GH;j++)for(let i=0;i<GW;i++){
    const v0=P(i,j),v1=P(i+1,j),v2=P(i+1,j+1),v3=P(i,j+1);
    let k=0;if(v0>thr)k|=1;if(v1>thr)k|=2;if(v2>thr)k|=4;if(v3>thr)k|=8;
    if(k===0||k===15)continue;
    const T=[lp(X(i),X(i+1),v0,v1),Y(j)], R=[X(i+1),lp(Y(j),Y(j+1),v1,v2)];
    const B=[lp(X(i),X(i+1),v3,v2),Y(j+1)], L=[X(i),lp(Y(j),Y(j+1),v0,v3)];
    const ad=(a,b)=>segs.push([a,b]);
    switch(k){
      case 1:ad(L,T);break; case 2:ad(T,R);break; case 3:ad(L,R);break;
      case 4:ad(R,B);break; case 5:ad(L,T);ad(R,B);break; case 6:ad(T,B);break;
      case 7:ad(L,B);break; case 8:ad(B,L);break; case 9:ad(B,T);break;
      case 10:ad(T,R);ad(B,L);break; case 11:ad(B,R);break; case 12:ad(R,L);break;
      case 13:ad(R,T);break; case 14:ad(T,L);break;
    }
  }
  const key=p=>((p[0]*4)|0)+'_'+((p[1]*4)|0);
  const start=new Map();
  for(const g of segs){const k=key(g[0]);(start.get(k)||start.set(k,[]).get(k)).push(g)}
  const used=new Set(), loops=[];
  for(const g0 of segs){
    if(used.has(g0))continue;
    const pts=[g0[0]];let cur=g0,guard=0;
    while(cur&&!used.has(cur)&&guard++<20000){
      used.add(cur);pts.push(cur[1]);
      const nx=(start.get(key(cur[1]))||[]).find(x=>!used.has(x));
      cur=nx;
    }
    if(pts.length>8)loops.push(pts);
  }
  return loops;
}
function simplifyLoop(poly,eps=3.5){
  const pts=poly.slice();
  if(pts.length>1&&dist(pts[0],pts[pts.length-1])<.1)pts.pop();
  if(pts.length<5)return pts;
  const rdp=line=>{
    if(line.length<=2)return line;
    let best=0,at=-1;
    for(let i=1;i<line.length-1;i++){
      const d=distSeg(line[i],line[0],line[line.length-1]);
      if(d>best){best=d;at=i}
    }
    if(best<=eps)return [line[0],line[line.length-1]];
    return rdp(line.slice(0,at+1)).slice(0,-1).concat(rdp(line.slice(at)));
  };
  let split=1,far=0;
  for(let i=1;i<pts.length;i++){const d=dist(pts[0],pts[i]);if(d>far){far=d;split=i}}
  const a=rdp(pts.slice(0,split+1));
  const b=rdp(pts.slice(split).concat([pts[0]]));
  return a.slice(0,-1).concat(b.slice(0,-1));
}
function chaikin(pts,it){
  for(let k=0;k<it;k++){
    const out=[],n=pts.length;
    for(let i=0;i<n;i++){
      const a=pts[i],b=pts[(i+1)%n];
      out.push([a[0]*.75+b[0]*.25,a[1]*.75+b[1]*.25],[a[0]*.25+b[0]*.75,a[1]*.25+b[1]*.75]);
    }
    pts=out;
  }
  return pts;
}
// chaikin() liscia curve CHIUSE; su una curva APERTA (il fiume) la chiuderebbe
// in un anello, facendola tornare indietro come un secondo canale parallelo.
function chaikinOpen(pts,it){
  for(let k=0;k<it;k++){
    const out=[pts[0]];
    for(let i=0;i<pts.length-1;i++){
      const a=pts[i],b=pts[i+1];
      out.push([a[0]*.75+b[0]*.25,a[1]*.75+b[1]*.25],[a[0]*.25+b[0]*.75,a[1]*.25+b[1]*.75]);
    }
    out.push(pts[pts.length-1]);
    pts=out;
  }
  return pts;
}
const dPoly=(pts,close)=>pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ')+(close?'Z':'');
const esc=s=>String(s).replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
const F1=n=>n.toFixed(1);
