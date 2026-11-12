/* ===== Image / graphique → fiche prête : lecture locale (OCR) ou Gemini (clé gratuite facultative, réglée dans Compte) ===== */
const GK="memo_gkey",GM="memo_gmodel",GM_DEF="gemini-flash-latest",GAPI="https://generativelanguage.googleapis.com/v1beta/";
const gKey=()=>{try{return localStorage.getItem(GK)||""}catch(e){return""}};
const gModel=()=>{try{return localStorage.getItem(GM)||GM_DEF}catch(e){return GM_DEF}};
const blobB64=b=>new Promise((ok,ko)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(",")[1]);r.onerror=()=>ko(r.error);r.readAsDataURL(b)});
const clip=(s,n)=>String(s==null?"":s).replace(/\s+/g," ").trim().slice(0,n);

/* --- Gemini --- */
async function geminiCall(parts,key,model){
  const ctl=new AbortController(),to=setTimeout(()=>ctl.abort(),45000);
  try{
    const r=await fetch(GAPI+"models/"+encodeURIComponent(model)+":generateContent",{method:"POST",signal:ctl.signal,headers:{"x-goog-api-key":key,"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts}],generationConfig:{responseMimeType:"application/json",temperature:0.2}})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok){const e=new Error(r.status+" "+clip((j.error&&j.error.message)||"",160));e.status=r.status;throw e}
    const txt=((((j.candidates||[])[0]||{}).content||{}).parts||[]).map(p=>p.text||"").join("");
    if(!txt){const e=new Error("réponse vide");e.status=0;throw e}
    return txt;
  }finally{clearTimeout(to)}
}
function parseJson(t){
  t=String(t).replace(/^\s*```(?:json)?/i,"").replace(/```\s*$/,"").trim();
  try{return JSON.parse(t)}catch(e){const m=t.match(/\{[\s\S]*\}/);if(m)return JSON.parse(m[0]);throw e}
}
async function geminiAnalyse(blob){
  const places=allSubs().slice(0,80).map(x=>x.theme.name+" › "+x.sub.name).join("\n")||"(aucun pour l’instant)";
  const prompt=`Tu aides une personne à mémoriser des éléments de débat. Analyse cette image (graphique, tableau, capture d’écran, photo de document ou autre) et réponds UNIQUEMENT par un objet JSON avec ces clés :
- "titre" : titre du graphique ou intitulé court de l’image (100 caractères max)
- "resume" : 1 à 2 phrases en français disant ce que montre l’image, avec la tendance principale
- "chiffres" : liste de 0 à 6 chaînes « libellé : valeur (période ou lieu) », uniquement des valeurs lisibles sur l’image
- "source" : auteur ou source indiquée sur l’image (ex. INSEE, Eurostat, un journal), sinon ""
- "annee" : année ou période principale, sinon ""
- "theme" et "sujet" : où classer la fiche. Choisis EXACTEMENT un couple existant de la liste ci-dessous s’il convient ; sinon propose un thème général court (ex. Économie, Écologie) et un sujet précis court
- "mots_cles" : 0 à 4 mots-clés
- "type" : "chi" (chiffre ou graphique), "arg" (argument), "ex" (exemple), "cpt" (concept), "con" (contre-argument) ou "note"
N’invente rien : ce qui n’est pas lisible reste vide. Réponds en français.
Thèmes › sujets existants :
${places}`;
  const o=parseJson(await geminiCall([{inline_data:{mime_type:"image/jpeg",data:await blobB64(blob)}},{text:prompt}],gKey(),gModel()));
  const arr=(v,n,l)=>(Array.isArray(v)?v:[]).map(x=>clip(x,l)).filter(Boolean).slice(0,n);
  return{title:clip(o.titre,120),summary:clip(o.resume,600),figures:arr(o.chiffres,6,140),sourceLine:clip(o.source,120),year:clip(o.annee,20),
    theme:clip(o.theme,40),sub:clip(o.sujet,60),tags:arr(o.mots_cles,4,24),type:["chi","arg","ex","cpt","con","note"].includes(o.type)?o.type:"chi",engine:"gemini"};
}
function pickModel(list){
  const ok=(list||[]).filter(m=>(m.supportedGenerationMethods||[]).includes("generateContent")).map(m=>String(m.name).replace(/^models\//,""));
  const best=ok.map(n=>({n,m:/^gemini-(\d+(?:\.\d+)?)-flash$/.exec(n)})).filter(x=>x.m).sort((a,b)=>parseFloat(b.m[1])-parseFloat(a.m[1]))[0];
  return best?best.n:(ok.find(n=>/flash/.test(n)&&!/lite|image|tts|live/.test(n))||"");
}

async function healModel(){
  try{
    const r=await fetch(GAPI+"models?pageSize=200",{headers:{"x-goog-api-key":gKey()}}),j=await r.json(),m=pickModel(j.models);
    if(m){try{localStorage.setItem(GM,m)}catch(e){}return m}
  }catch(e){}
  return"";
}

/* --- lecture locale (OCR sur l'appareil) : titre, source, chiffres --- */
async function ocrCanvas(file){
  const bmp=await createImageBitmap(file),s=Math.min(2,2000/Math.max(bmp.width,bmp.height));
  const c=document.createElement("canvas");c.width=Math.max(1,Math.round(bmp.width*s));c.height=Math.max(1,Math.round(bmp.height*s));
  const g=c.getContext("2d");g.fillStyle="#fff";g.fillRect(0,0,c.width,c.height);g.drawImage(bmp,0,0,c.width,c.height);if(bmp.close)bmp.close();
  return c;
}
// 2 versions pour l'OCR : niveaux de gris, et « contraste local » (texte noir sur blanc même s'il est blanc sur fond coloré)
function ocrVersions(c){
  const W=c.width,H=c.height,N=W*H,src=c.getContext("2d").getImageData(0,0,W,H).data;
  const mk=()=>{const k=document.createElement("canvas");k.width=W;k.height=H;const x=k.getContext("2d");return{k,x,i:x.createImageData(W,H)}};
  const G=mk(),M=mk(),gd=G.i.data,md=M.i.data;
  for(let i=0;i<N;i++){const v=(src[4*i]*299+src[4*i+1]*587+src[4*i+2]*114)/1000;gd[4*i]=gd[4*i+1]=gd[4*i+2]=v;gd[4*i+3]=255}
  const BS=32,bw=Math.ceil(W/BS),bh=Math.ceil(H/BS),bg=new Uint8Array(bw*bh*3),buf=[new Uint8Array(256),new Uint8Array(256),new Uint8Array(256)];
  for(let by=0;by<bh;by++)for(let bx=0;bx<bw;bx++){
    let n=0;for(let y=by*BS;y<Math.min(H,by*BS+BS);y+=2)for(let x=bx*BS;x<Math.min(W,bx*BS+BS);x+=2){const k=4*(y*W+x);buf[0][n]=src[k];buf[1][n]=src[k+1];buf[2][n]=src[k+2];n++}
    for(let ch=0;ch<3;ch++){const s=buf[ch].subarray(0,n).sort();bg[(by*bw+bx)*3+ch]=s[n>>1]}
  }
  // distance à la couleur de fond la plus proche parmi celles des blocs voisins (évite les cadres aux frontières de couleur)
  for(let y=0;y<H;y++){const by=y/BS|0;for(let x=0;x<W;x++){
    const bx=x/BS|0,k=4*(y*W+x),R=src[k],Gc=src[k+1],B=src[k+2];let best=765;
    for(let j=Math.max(0,by-1);j<=Math.min(bh-1,by+1)&&best>0;j++)for(let i=Math.max(0,bx-1);i<=Math.min(bw-1,bx+1);i++){
      const b=(j*bw+i)*3,d=Math.abs(R-bg[b])+Math.abs(Gc-bg[b+1])+Math.abs(B-bg[b+2]);if(d<best)best=d}
    const v=255-Math.min(255,best*1.5);md[k]=md[k+1]=md[k+2]=v;md[k+3]=255}}
  G.x.putImageData(G.i,0,0);M.x.putImageData(M.i,0,0);
  return[G.k,M.k];
}
async function visLines(wk,img,psm){
  await wk.setParameters({tessedit_pageseg_mode:psm||"11"});
  let d;try{d=(await wk.recognize(img)).data||{}}finally{await wk.setParameters({tessedit_pageseg_mode:"3"})}
  const lines=[];
  for(const b of d.blocks||[])for(const p of b.paragraphs||[])for(const l of p.lines||[]){
    const ws=(l.words||[]).filter(w=>w.text&&w.text.trim());if(!ws.length)continue;
    const text=ws.map(w=>w.text.trim()).join(" ").replace(/\s+/g," ").trim(),cw=ws.filter(w=>/[\p{L}\p{N}]/u.test(w.text)),conf=(cw.length?cw:ws).reduce((a,w)=>a+(w.confidence||0),0)/(cw.length||ws.length),bb=l.bbox||{x0:0,x1:0,y0:0,y1:0};
    if(conf>=45&&text.replace(/[^\p{L}\p{N}]/gu,"").length>=2)lines.push({text,conf,x0:bb.x0,x1:bb.x1,y0:bb.y0,y1:bb.y1,h:bb.y1-bb.y0});
  }
  if(!lines.length&&d.text)d.text.split(/\n+/).forEach((t,i)=>{t=t.trim();if(t.length>=3)lines.push({text:t,conf:60,y0:i,y1:i+1,h:1})});
  return lines;
}
// blocs de couleur unie (rectangles pleins) : on les relit un par un, le gros texte y est bien plus fiable que sur la page entière
function visFindBlocks(c){
  const W=c.width,H=c.height,D=c.getContext("2d").getImageData(0,0,W,H).data,S=8,gw=Math.floor(W/S),gh=Math.floor(H/S);
  if(gw<10||gh<10)return[];
  const col=new Uint8Array(gw*gh*3),P=[[2,2],[5,2],[2,5],[5,5]];
  for(let j=0;j<gh;j++)for(let i=0;i<gw;i++){let r=0,g=0,b=0;for(const[dx,dy]of P){const k=4*((j*S+dy)*W+i*S+dx);r+=D[k];g+=D[k+1];b+=D[k+2]}const o=(j*gw+i)*3;col[o]=r>>2;col[o+1]=g>>2;col[o+2]=b>>2}
  const N=gw*gh,seen=new Uint8Array(N),st=new Int32Array(N),out=[];
  for(let s0=0;s0<N;s0++){
    if(seen[s0])continue;
    const o0=s0*3,r0=col[o0],g0=col[o0+1],b0=col[o0+2];let sp=0,n=0,x0=gw,x1=0,y0=gh,y1=0;st[sp++]=s0;seen[s0]=1;
    while(sp){
      const p=st[--sp],px=p%gw,py=(p/gw)|0;n++;if(px<x0)x0=px;if(px>x1)x1=px;if(py<y0)y0=py;if(py>y1)y1=py;
      for(const q of[p-1,p+1,p-gw,p+gw]){
        if(q<0||q>=N||seen[q]||(q===p-1&&px===0)||(q===p+1&&px===gw-1))continue;
        const o=q*3;if(Math.abs(col[o]-r0)+Math.abs(col[o+1]-g0)+Math.abs(col[o+2]-b0)<=50){seen[q]=1;st[sp++]=q}
      }
    }
    const bw=x1-x0+1,bh=y1-y0+1;
    if(n>=Math.max(24,N*0.004)&&n/(bw*bh)>=0.45&&bw>=5&&bh>=4&&bw*bh<=N*0.6)out.push({n,x0:x0*S,y0:y0*S,x1:(x1+1)*S,y1:(y1+1)*S});
  }
  return out.sort((a,b)=>b.n-a.n).slice(0,8);
}
async function visBlocks(wk,cv){
  const out=[];
  for(const b of visFindBlocks(cv)){
    const x0=b.x0+3,y0=b.y0+3,x1=Math.min(cv.width,b.x1-3),y1=Math.min(cv.height,b.y1-3);
    if(x1-x0<24||y1-y0<16)continue;
    const c=visBin(cv,x0,y0,x1,y1,y1-y0<140?2:1),k=y1-y0<140?2:1;
    if(!c)continue;
    let r=[];try{r=await visLines(wk,c,"6")}catch(e){}
    r.forEach(l=>{l.x0=l.x0/k+x0;l.x1=l.x1/k+x0;l.y0=l.y0/k+y0;l.y1=l.y1/k+y0;l.h=l.y1-l.y0;l.blk=1;out.push(l)});
  }
  return out;
}
function visMerge(a,b){
  const out=a.slice(),ar=l=>Math.max(0,l.x1-l.x0)*Math.max(0,l.y1-l.y0);
  for(const l of b){
    const o=out.find(o=>{const w=Math.min(o.x1,l.x1)-Math.max(o.x0,l.x0),h=Math.min(o.y1,l.y1)-Math.max(o.y0,l.y0);return w>0&&h>0&&w*h>0.5*Math.min(ar(o),ar(l))});
    if(!o)out.push(l);else if((l.conf>o.conf+8&&l.text.length>=o.text.length*0.8)||(l.blk&&l.conf>=70&&l.text.length>o.text.length+2))out[out.indexOf(o)]=l;
  }
  return out;
}
// image « texte noir sur blanc » : on retire la couleur de fond dominante de la zone (marche aussi pour du blanc sur rouge, jaune, bleu…)
function visBin(cv,x0,y0,x1,y1,k){
  x0=Math.max(0,x0|0);y0=Math.max(0,y0|0);x1=Math.min(cv.width,x1|0);y1=Math.min(cv.height,y1|0);
  const w=x1-x0,h=y1-y0;if(w<8||h<8)return null;
  const D=cv.getContext("2d").getImageData(x0,y0,w,h).data,N=w*h,cnt=new Map(),q=o=>((D[o]>>4)<<8)|((D[o+1]>>4)<<4)|(D[o+2]>>4);
  for(let i=0;i<N;i+=2){const z=q(4*i);cnt.set(z,(cnt.get(z)||0)+1)}
  let bq=0,bn=-1;for(const[z,n]of cnt)if(n>bn){bn=n;bq=z}
  let r=0,g=0,b=0,n=0;for(let i=0;i<N;i+=2){const o=4*i;if(q(o)===bq){r+=D[o];g+=D[o+1];b+=D[o+2];n++}}
  r/=n;g/=n;b/=n;
  const c=document.createElement("canvas");c.width=w;c.height=h;const x=c.getContext("2d"),im=x.createImageData(w,h),o=im.data;
  for(let i=0;i<N;i++){const p=4*i,d=Math.abs(D[p]-r)+Math.abs(D[p+1]-g)+Math.abs(D[p+2]-b),v=255*(1-Math.min(1,Math.max(0,(d-100)/220)));o[p]=o[p+1]=o[p+2]=v;o[p+3]=255}
  // le cadre qui touche le bord du recadrage (hors du bandeau) est effacé : il ne doit pas coller aux lettres.
  // Seules les grandes formes (cadre : large ou haut comme le recadrage) partent ; une lettre coupée par le bord reste.
  const dk=new Uint8Array(N),st=new Int32Array(N);
  const flood=s0=>{
    let sp=0,n=0,x0=w,x1=0,y0=h,y1=0;st[sp++]=s0;dk[s0]=1;const comp=[];
    while(sp){
      const p=st[--sp],px=p%w,py=(p/w)|0;comp.push(p);if(px<x0)x0=px;if(px>x1)x1=px;if(py<y0)y0=py;if(py>y1)y1=py;
      for(const q of[px>0?p-1:-1,px<w-1?p+1:-1,p>=w?p-w:-1,p<N-w?p+w:-1])if(q>=0&&!dk[q]&&o[4*q]<128){dk[q]=1;st[sp++]=q}
    }
    if(x1-x0+1>=0.35*w||y1-y0+1>=0.8*h)for(const p of comp){const q=4*p;o[q]=o[q+1]=o[q+2]=255}
  };
  for(let i=0;i<w;i++){if(!dk[i]&&o[4*i]<128)flood(i);const j=(h-1)*w+i;if(!dk[j]&&o[4*j]<128)flood(j)}
  for(let j=0;j<h;j++){const l=j*w,r=j*w+w-1;if(!dk[l]&&o[4*l]<128)flood(l);if(!dk[r]&&o[4*r]<128)flood(r)}
  x.putImageData(im,0,0);
  if(!k||k===1)return c;
  const t=document.createElement("canvas");t.width=w*k;t.height=h*k;const tx=t.getContext("2d");tx.fillStyle="#fff";tx.fillRect(0,0,t.width,t.height);tx.imageSmoothingQuality="high";tx.drawImage(c,0,0,t.width,t.height);return t;
}
// consensus entre plusieurs lectures d'une même ligne : on garde celle qui ressemble le plus aux autres (pondérées par leur confiance)
const visNrm=t=>t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9% ]+/g," ").replace(/\s+/g," ").trim();
function visLev(a,b){
  const m=a.length,n=b.length;if(!m)return n;if(!n)return m;
  let p=Array.from({length:n+1},(_,j)=>j);
  for(let i=1;i<=m;i++){const c=[i];for(let j=1;j<=n;j++)c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));p=c}
  return p[n];
}
const visSim=(a,b)=>{a=visNrm(a);b=visNrm(b);const m=Math.max(a.length,b.length)||1;return 1-visLev(a,b)/m};
function visPick(c){
  c=c.filter(x=>x.t&&x.t.length>=2);if(!c.length)return"";
  let best=c[0],bs=-1;
  for(const x of c){let s=0;for(const y of c)s+=(y===x?1:visSim(x.t,y.t)**4)*y.w;if(s>bs){bs=s;best=x}}
  return best.t;
}
// relit une ligne seule (recadrée, agrandie, mode « 1 ligne ») sous 3 formes : gris ×2, texte noir sur blanc ×2 et ×3
async function visReadLine(wk,cv,gray,l,o){
  o=o||{};
  const ml=Math.round(cv.width*(o.ml==null?0.1:o.ml)),mr=Math.round(cv.width*(o.mr==null?0.012:o.mr)),my=Math.round(l.h*0.35),x0=Math.max(0,l.x0-ml),y0=Math.max(o.top==null?0:o.top,l.y0-my),x1=Math.min(cv.width,l.x1+mr),y1=Math.min(o.bot==null?cv.height:o.bot,l.y1+my),out=[];
  if(x1-x0<20||y1-y0<10)return out;
  const run=async(img,w,k)=>{
    if(!img)return;let r;try{r=await visLines(wk,img,"7")}catch(e){return}
    if(!r.length)return;
    const t=r.map(x=>x.text).join(" ").replace(/^[\s|\[\]]+|[\s|\[\]]+$/g,"").trim(),cf=r.reduce((a,x)=>a+x.conf,0)/r.length;
    if(t&&cf>=55)out.push({t,w:w*cf/100,hh:Math.max(...r.map(x=>x.h))/k,yr0:y0+Math.min(...r.map(x=>x.y0))/k,yr1:y0+Math.max(...r.map(x=>x.y1))/k,cut:img.width-Math.max(...r.map(x=>x.x1))<=Math.max(6,0.006*cv.width*k)});
  };
  const c=document.createElement("canvas");c.width=(x1-x0)*2;c.height=(y1-y0)*2;
  const g=c.getContext("2d");g.fillStyle="#fff";g.fillRect(0,0,c.width,c.height);g.drawImage(gray,x0,y0,x1-x0,y1-y0,0,0,c.width,c.height);
  await run(c,1,2);await run(visBin(cv,x0,y0,x1,y1,2),1.5,2);await run(visBin(cv,x0,y0,x1,y1,3),1.5,3);
  return out;
}
/* --- publication, capture d'écran, citation : un bloc de lignes de même taille (+ date, source) --- */
const visLet=l=>(String(l.text).match(/\p{L}/gu)||[]).length;
// barre d'état / de navigation d'un téléphone : heure, réseau, batterie (en haut ou en bas de l'image)
const visUi=(l,H)=>(l.y1<H*0.09||l.y0>H*0.93)&&(/\b\d{1,2}\s*[:h]\s*\d{2}\b/.test(l.text)||/\b(?:LTE|4G|5G|VoLTE|Wi-?Fi)\b/i.test(l.text)||visLet(l)<4);
// signes isolés en fin ou début de ligne (« : | ; | ! ») : bruit des motifs de fond
const visTrim=t=>{
  const a=String(t).trim().split(/\s+/),jk=w=>!/[\p{L}\p{N}]/u.test(w);
  while(a.length>1&&jk(a[a.length-1])&&(a[a.length-1].length>=3||jk(a[a.length-2])))a.pop();
  return a.join(" ").replace(/^\s*([^\p{L}\p{N}(«"'\s]{1,2}\s+)+/u,"").trim();
};
// la lecture retenue est peut-être coupée (« d'origine af ») : si au moins deux autres lectures la prolongent par des mots vraisemblables, on prend la partie commune
function visExtend(t,c){
  const tk=s=>s.split(/\s+/).filter(Boolean),n1=w=>visNrm(w).replace(/ /g,""),ot=tk(t),nt=ot.map(n1);
  if(!nt.length)return t;
  const wl=w=>(w.match(/\p{L}/gu)||[]).length>=3&&visSane(w);
  const ex=[];
  for(const x of c){
    const o=tk(x.t),n=o.map(n1);
    if(n.length<nt.length)continue;
    let ok=true;for(let i=0;i<nt.length-1;i++)if(n[i]!==nt[i]){ok=false;break}
    const li=nt.length-1;if(!ok||!(n[li]===nt[li]||n[li].startsWith(nt[li])))continue;
    let m=nt.length;while(m<o.length&&wl(o[m]))m++;     // la suite doit ressembler à des mots
    const keep=o.slice(0,m);if(keep.length>nt.length||n1(keep[li]).length>nt[li].length)ex.push({o:keep,w:x.w});
  }
  if(ex.length<2)return t;
  let k=Math.min(...ex.map(x=>x.o.length));
  while(k>0&&!ex.every(x=>n1(x.o[k-1])===n1(ex[0].o[k-1])))k--;
  if(k<nt.length)return t;
  const best=ex.slice().sort((a,b)=>b.w-a.w)[0].o.slice(0,k).join(" ");
  return n1(best).length>n1(t).length?best:t;
}
// un chiffre isolé de 1-2 signes en bout de ligne (« … personnes 0, ») est du bruit si une autre lecture n'en a pas
function visUntail(t,c){
  const a=t.split(/\s+/),l=a[a.length-1];
  if(a.length>2&&!/\p{L}/u.test(l)&&!/%/.test(l)&&/\p{N}/u.test(l)&&l.replace(/[^\p{N}]/gu,"").length<=2){const sh=a.slice(0,-1).join(" ");if(c.some(x=>visNrm(x.t)===visNrm(sh)))return sh}
  return t;
}
// un mot qui mélange majuscules et minuscules au milieu (« ICaine ») est probablement mal lu : poids réduit
const visShape=t=>0.75**t.split(/\s+/).filter(w=>/\p{Ll}\p{Lu}|\p{Lu}{2,}\p{Ll}/u.test(w)).length;
const visMed=a=>{a=a.slice().sort((x,y)=>x-y);return a.length?a[a.length>>1]:0};
const visGood=l=>l.x1!==undefined&&l.h>0&&l.conf>=70&&visLet(l)>=4&&visLet(l)/Math.max(1,l.text.replace(/\s/g,"").length)>=0.7;
const visVo=(a,b)=>Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0))/Math.max(1,Math.min(a.h,b.h));
// une ligne lisible : assez de lettres et des mots qui ont des voyelles (écarte « B ‘: » ou « ui| ED »)
const visSane=t=>{const w=t.match(/\p{L}{3,}/gu)||[],c=t.replace(/\s/g,"").length||1;return visLet({text:t})/c>=0.6&&(!w.length||w.filter(x=>/[aeiouyàâéèêëîïôöùûü]/i.test(x)).length/w.length>=0.7)};
// fragments d'une même rangée (venant de passes différentes) : recollés ou départagés
function visBands(L){
  L=L.slice().sort((a,b)=>a.y0-b.y0);const out=[];
  for(const l of L){const g=out.find(o=>visVo(o.m[0],l)>0.5);if(g)g.m.push(l);else out.push({m:[l]})}
  return out.map(g=>{
    if(g.m.length===1)return g.m[0];
    const xs=g.m.slice().sort((a,b)=>a.x0-b.x0);
    if(xs.length<=3&&xs.every((l,i)=>!i||Math.min(xs[i-1].x1,l.x1)-Math.max(xs[i-1].x0,l.x0)<=0.2*Math.min(xs[i-1].x1-xs[i-1].x0,l.x1-l.x0))){const bm=xs.slice().sort((a,b)=>b.conf*b.text.length-a.conf*a.text.length)[0];return{text:xs.map(l=>l.text).join(" "),conf:xs.reduce((a,l)=>a+l.conf,0)/xs.length,x0:xs[0].x0,x1:xs[xs.length-1].x1,y0:bm.y0,y1:bm.y1,h:bm.y1-bm.y0}}
    return g.m.slice().sort((a,b)=>b.conf*b.text.length-a.conf*a.text.length)[0];
  });
}
function visInk(c){const d=c.getContext("2d").getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]<128)n++;return n/(d.length/4)}
const visMonth=/\b(\d{1,2}|1er)\s*[-–. ]\s*(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\b(?:\s*((?:19|20)\d{2}))?/i;
async function visCard(cv,vs,raws,lines,wk,dg){
  const H=cv.height,W=cv.width,passes=raws.filter(r=>r.n!=="blocs");
  // beaucoup de valeurs chiffrées isolées : c'est un graphique, pas un texte
  if(lines.filter(l=>{const a=l.text.replace(/[^\p{L}\p{N}]/gu,"");return a.length>=2&&a.length<=12&&(a.match(/\p{N}/gu)||[]).length/a.length>=0.5}).length>=4)return null;
  // graines : lignes plausibles de toutes les passes (même partielles) ; la lecture définitive se fait ligne par ligne ensuite
  const sRe=/^\s*(sources?|d['’]apr[eè]s|donn[eé]es|cr[eé]dit)\b\s*[:\-–.]?\s*(.*)$/i,pr=/^\(\s*[^()]{3,90}\)[^\p{L}\p{N}]*\p{L}{0,2}[^\p{L}\p{N}]*$/u,isSrc=l=>sRe.test(visTrim(l.text))||pr.test(visTrim(l.text));
  const seed=l=>l.x1!==undefined&&l.h>0&&l.conf>=55&&visLet(l)>=4&&visLet(l)/Math.max(1,l.text.replace(/\s/g,"").length)>=0.7&&!visUi(l,H)&&!isSrc(l);
  let L=[];passes.forEach(r=>r.L.forEach(l=>{if(seed(l))L.push({...l,pw:r.w})}));
  const m0=visMed(L.map(l=>l.h));if(!m0)return null;
  L=visBands(L.filter(l=>l.h<=m0*1.7));
  dg.push("Graines : "+L.map(l=>Math.round(l.y0)+"/"+Math.round(l.h)+" «"+clip(l.text,16)+"»").join(" "));
  // bloc principal : lignes consécutives, de même taille, alignées, espacées de moins de ~2,6 lignes (un trou = ligne manquante)
  const al=(a,b)=>Math.abs(a.x0-b.x0)<=W*0.06||Math.abs((a.x0+a.x1)/2-(b.x0+b.x1)/2)<=W*0.06,bl=[];let cur=[];
  for(const l of L){const p=cur[cur.length-1];if(p&&l.y0-p.y1<=3.2*Math.max(l.h,p.h)&&l.h/p.h>=0.7&&l.h/p.h<=1.43&&al(l,p))cur.push(l);else{if(cur.length)bl.push(cur);cur=[l]}}
  if(cur.length)bl.push(cur);
  const B0=bl.map(b=>({b,n:b.reduce((a,l)=>a+visLet(l),0)})).sort((a,b)=>b.n-a.n)[0];
  if(!B0)return null;
  const B=B0.b,wpl=B.reduce((a,l)=>a+l.text.split(/\s+/).length,0)/B.length,hb0=visMed(B.map(l=>l.h));
  const tot=L.filter(l=>l.h/hb0>=0.7&&l.h/hb0<=1.43).reduce((a,l)=>a+visLet(l),0);   // texte de la même taille
  if(B.length<2||wpl<2.2||B0.n<tot*0.5){dg.push("Mode texte écarté : bloc "+B.length+" ligne(s), "+wpl.toFixed(1)+" mots/ligne, "+Math.round(100*B0.n/Math.max(1,tot))+" % du texte de cette taille");return null}
  const hB=visMed(B.map(l=>l.h)),bx0=Math.min(...B.map(l=>l.x0)),bx1=Math.max(...B.map(l=>l.x1)),steps=[];
  for(let i=1;i<B.length;i++)if(B[i].y0-B[i-1].y1<=1.3*hB)steps.push(B[i].y0-B[i-1].y0);
  const pitch=steps.length?visMed(steps):Math.round(hB*1.15),added=[];let srcFound="";
  // bornes verticales d'une relecture : à mi-chemin des lignes voisines (du bloc ou non : source, légende…), pour ne pas lire deux lignes d'un coup
  const others=lines.filter(o=>o.x1!==undefined&&visLet(o)>=3&&o.conf>=50);
  const bounds=(y0,y1,rl)=>{let top=null,bot=null;const hh=y1-y0;for(const o of rl.concat(others)){if(visVo({y0,y1,h:hh},o)>0.3)continue;if(o.y1<=y0+hh*0.3){const m=Math.round((o.y1+y0)/2);if(top===null||m>top)top=m}else if(o.y0>=y1-hh*0.3){const m=Math.round((y1+o.y0)/2);if(bot===null||m<bot)bot=m}}return{top,bot}};
  dg.push("Mode texte : "+B.length+" lignes repérées, taille "+Math.round(hB)+" px, interligne "+Math.round(pitch)+" px");
  // lecture directe d'une rangée où l'OCR n'a rien trouvé (ex. texte jaune sur noir)
  const readBand=async y0=>{
    y0=Math.round(y0);if(y0<0||y0+hB>H)return null;
    const{top,bot}=bounds(y0,y0+hB,B.concat(added)),mx=Math.round(W*0.02);
    const ik=visBin(cv,bx0-mx,y0,bx1+W*0.04,y0+hB,1),ink=ik?visInk(ik):0;if(!ik||ink<0.012){dg.push("Rangée y="+y0+" : vide");return null}
    const c=(await visReadWide(wk,cv,vs[0],{x0:bx0,x1:bx1,y0,y1:y0+hB,h:hB},{ml:Math.max(0.02,0.12*(bx1-bx0)/W),mr:0.04,top,bot})).filter(x=>visSane(x.t)&&visLet({text:x.t})>=4);
    if(!c.length){dg.push("Rangée y="+y0+" : rien de lisible");return null}
    const cd=c.map(x=>({...x,t:visTrim(x.t)})),t0=visPick(cd),t=t0?visUntail(visExtend(t0,cd),cd):"";if(!t)return null;
    if(isSrc({text:t})){srcFound=t;dg.push("Rangée y="+y0+" : source « "+clip(t,50)+" »");return null}
    {const nt=visNrm(t),dup=B.concat(added).find(o=>{const n=visNrm(o.text);return n.length>=10&&nt.includes(n)&&nt.length>n.length*1.15});if(dup){dg.push("Rangée y="+y0+" : recouvre la ligne voisine « "+clip(dup.text,30)+" »");return null}}
    const hh=visMed(c.map(x=>x.hh));if(hh<hB*0.72||hh>hB*1.35){dg.push("Rangée y="+y0+" : taille "+Math.round(hh)+" ≠ "+Math.round(hB)+" ("+clip(c[0].t,30)+")");return null}
    const agree=c.filter(x=>visSim(x.t,t)>=0.6).length-1;
    if(c.length<2?c[0].w<1.1:agree<1){dg.push("Rangée y="+y0+" : lectures trop divergentes ("+c.map(x=>"«"+clip(x.t,24)+"»").join(" ")+")");return null}
    dg.push("Ligne retrouvée par lecture directe (y="+y0+") : « "+clip(t,60)+" » ← "+c.map(x=>"«"+clip(x.t,30)+"»").join(" | "));
    return{text:t,x0:bx0,x1:bx1,y0,y1:y0+hB,h:hB,conf:80,filled:1};
  };
  for(let i=0;i<B.length-1;i++){
    const d=B[i+1].y0-B[i].y0,n=Math.round(d/pitch)-1;
    if(n<1||n>3)continue;
    for(let j=1;j<=n;j++){let y=B[i].y0+j*pitch;if(y+hB>B[i+1].y0-2)y=B[i].y0+j*d/(n+1);const r=await readBand(y);if(r)added.push(r)}
  }
  for(const dir of[1,-1]){
    let y=dir>0?B[B.length-1].y0:B[0].y0;
    for(let k=0;k<10;k++){
      let r=await readBand(y+dir*pitch);if(!r)r=await readBand(y+dir*pitch*1.28);if(!r)r=await readBand(y+dir*pitch*2);
      if(!r)break;added.push(r);y=r.y0;
    }
  }
  const rows=B.concat(added).sort((a,b)=>a.y0-b.y0);
  // chaque ligne lue : vote entre les passes qui la recouvrent et trois relectures « 1 ligne »
  window.ocrExtra=" (relecture)";
  let partial=false;
  for(let i=0;i<rows.length;i++){
    const l=rows[i];if(l.filled)continue;
    const cands=[];
    passes.forEach(r=>r.L.forEach(x=>{if(x.x1!==undefined&&x.h<=l.h*1.5&&visVo(x,l)>0.6&&Math.abs((x.x0+x.x1)/2-(l.x0+l.x1)/2)<l.h*3&&x.text.length>=l.text.length*0.6&&x.text.length<=l.text.length*1.6)cands.push({t:x.text,w:r.w*x.conf/100})}));
    if(!cands.some(c=>c.t===l.text))cands.push({t:l.text,w:l.conf/100});
    {
      const{top,bot}=bounds(l.y0,l.y1,rows.filter(o=>o!==l));
      try{(await visReadWide(wk,cv,vs[0],{...l,x0:bx0,x1:bx1},{ml:0.02,mr:0.012,top,bot})).forEach(x=>cands.push({t:x.t,w:x.w*0.6}))}catch(e){}
    }
    const cc=cands.map(c=>({...c,t:visTrim(c.t)})).map(c=>({...c,w:c.w*visShape(c.t)})),t0=visPick(cc),t=t0?visUntail(visExtend(t0,cc),cc):"";if(t)l.text=t;
    dg.push("Ligne "+(i+1)+" « "+clip(l.text,60)+" » ← "+cands.map(c=>"«"+clip(c.t,40)+"» "+c.w.toFixed(1)).join(" | "));
  }
  window.ocrExtra="";
  rows.forEach(l=>{if(!visSane(l.text)){l.text="[…]";partial=true}});
  if(rows.length<3||rows.every(l=>l.text==="[…]")||rows.reduce((a,l)=>a+l.text.split(/\s+/).length,0)/rows.length<2.5){dg.push("Mode texte écarté : "+rows.length+" ligne(s) au final");return null}
  // un texte qui commence par une minuscule continue une phrase : il manque sans doute la ligne d'avant
  if(/^\p{Ll}/u.test(rows[0].text)){rows[0].text="[…] "+rows[0].text;partial=true}
  // paragraphes : un interligne plus large, ou une phrase finie suivie d'une majuscule
  const st=[];for(let i=1;i<rows.length;i++)st.push(rows[i].y0-rows[i-1].y0);
  const ms=visMed(st)||pitch,paras=[[rows[0].text]];
  for(let i=1;i<rows.length;i++){
    const s=st[i-1],end=/[.!?…»"]\s*$/.test(rows[i-1].text),cap=/^[\p{Lu}\d]/u.test(rows[i].text),est=rows[i].filled||rows[i-1].filled,brk=est?(end&&cap):(s>1.2*ms||(end&&s>1.1*ms));
    if(brk)paras.push([rows[i].text]);else paras[paras.length-1].push(rows[i].text);
  }
  // source lue sur la même rangée que la dernière ligne : « … étrangère. (Ministère de la justice) »
  {const lp=paras[paras.length-1],lt=lp[lp.length-1],m=/^(.*?\S)\s*(\(\s*[^()]{3,90}\))[^\p{L}\p{N}]*\p{L}{0,2}[^\p{L}\p{N}]*$/u.exec(lt);if(m&&m[1].length>=8){lp[lp.length-1]=m[1];if(!srcFound)srcFound=m[2]}}
  const main=paras.map(p=>p.join(" ")).join("\n");
  // source (entre parenthèses sous le texte, ou « Source : … ») et date
  const last=rows[rows.length-1];
  const sl=lines.filter(l=>l.conf>=70&&!rows.some(r=>visVo(r,l)>0.5)&&(sRe.test(visTrim(l.text))||(pr.test(visTrim(l.text))&&l.y0>=last.y0))).sort((a,b)=>b.conf-a.conf)[0];
  const srcTxt=sl?sl.text:srcFound,source=srcTxt?(()=>{const t=visTrim(srcTxt);if(t[0]==="(")return t.slice(1).split(")")[0].trim();return t.replace(sRe,"$2").trim()||t})():"";
  let date="";for(const l of lines){if(l.conf<80)continue;const m=visMonth.exec(l.text);if(m){date=(m[1]+" "+m[2]+(m[3]?" "+m[3]:"")).toLowerCase();break}}
  const yr=(main+" "+source+" "+date).match(/\b(?:19|20)\d{2}\b/),p1=paras[0].join(" "),title=p1.length>80?p1.slice(0,p1.lastIndexOf(" ",80))+"…":p1;
  const text=[main,date?"Date indiquée : "+date:"",source?"Source indiquée : "+source:""].filter(Boolean).join("\n");
  dg.push("Texte : "+rows.length+" lignes, "+paras.length+" paragraphe(s)"+(partial?" — lecture incomplète […]":"")+(source?" ; source : "+source:"")+(date?" ; date : "+date:""));
  return{card:1,partial,title:clip(title,120),summary:text,figures:[],sourceLine:clip(source,120),year:yr?yr[0]:"",theme:themeFromSubjects([main]),sub:"",tags:[],type:/\d/.test(main)?"chi":"arg",kind:"Autre",note:date?"Date indiquée sur l’image : "+date:"",engine:"local",found:rows.length,diag:"Lecture locale (version 6a, mode texte)\n"+dg.join("\n")};
}
// relecture d'une ligne ; si le texte touche le bord droit du recadrage (mot coupé), on relit avec un recadrage plus large
async function visReadWide(wk,cv,gray,l,o){
  o=o||{};let mr=o.mr==null?0.012:o.mr,r=await visReadLine(wk,cv,gray,l,o);
  for(let i=0;i<2&&r.some(x=>x.cut)&&l.x1+cv.width*mr<cv.width;i++){mr+=0.1;const r2=await visReadLine(wk,cv,gray,l,{...o,mr});if(r2.length)r=r2}
  return r;
}
const pct=t=>t.trim().replace(/\s*%$/," %");
async function localAnalyse(cv){
  const wk=await getOcr(),vs=ocrVersions(cv),raws=[],dg=[];let lines=[];
  for(let i=0;i<vs.length;i++){
    window.ocrExtra=" (passe "+(i+1)+"/"+vs.length+")";
    try{const L=await visLines(wk,vs[i]);raws.push({n:i?"contraste":"gris",w:i?1.2:1,L});lines=visMerge(lines,L)}catch(e){if(!i)throw e}
  }
  window.ocrExtra=" (blocs de couleur)";
  let BL=[];try{BL=await visBlocks(wk,cv)}catch(e){}
  raws.push({n:"blocs",w:1.5,L:BL});lines=visMerge(lines,BL);
  window.ocrExtra="";
  dg.push("Lignes lues : "+raws.map(r=>r.n+" "+r.L.length).join(" · ")+" ; blocs de couleur : "+visFindBlocks(cv).length);
  // barre d'état du téléphone (heure, réseau, batterie) : jamais du contenu
  const ui=l=>visUi(l,cv.height);lines=lines.filter(l=>!ui(l));raws.forEach(r=>{r.L=r.L.filter(l=>!ui(l))});
  window.ocrExtra=" (texte)";let cd=null;
  try{cd=await visCard(cv,vs,raws,lines,wk,dg)}catch(e){dg.push("Mode texte : erreur "+clip(e.message,60))}
  window.ocrExtra="";
  if(cd)return cd;
  const H=cv.height,txt=l=>l.text.replace(/[^\p{L}\p{N}]/gu,""),lettr=l=>(txt(l).match(/\p{L}/gu)||[]).length/Math.max(1,txt(l).length);
  const top=lines.filter(l=>l.y0<H*0.38&&l.text.length>=8&&l.conf>=70&&lettr(l)>=0.75&&/\p{L}{3,}\s+\S+/u.test(l.text));
  let title="",tl=null;
  if(top.length){
    const m=Math.max(...top.map(l=>l.h)),big=top.filter(l=>l.h>=m*0.8).sort((a,b)=>a.y0-b.y0);
    let cur=big[0];const grp=[cur];tl=cur;
    for(const l of big.slice(1)){if(l.y0-cur.y1<Math.max(cur.h,1)*1.4){grp.push(l);cur=l;tl=l}else break}
    window.ocrExtra=" (titre)";
    for(const l of grp){
      try{
        const ov=(a,b)=>{const w=Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0),h=Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0);return w>0&&h>0?w*h/Math.min((a.x1-a.x0)*(a.y1-a.y0),(b.x1-b.x0)*(b.y1-b.y0)):0};
        const cands=[];raws.forEach(r=>r.L.forEach(x=>{if(x.x1!==undefined&&ov(x,l)>0.5&&x.text.length>=l.text.length*0.6&&x.text.length<=l.text.length*1.6)cands.push({t:x.text,w:r.w*x.conf/100,n:r.n})}));
        (await visReadLine(wk,cv,vs[0],l)).forEach((x,i)=>cands.push({...x,n:"relecture "+(i+1)}));
        const t=visPick(cands);
        dg.push("Titre « "+clip(t||l.text,70)+" » ← "+cands.map(c=>"«"+clip(c.t,40)+"» "+c.n+" "+c.w.toFixed(1)).join(" | "));
        if(t)l.text=t;
      }catch(e){dg.push("Titre : erreur "+clip(e.message,40))}
    }
    window.ocrExtra="";
    title=grp.map(l=>l.text).join(" ");
    // sous-titre : ligne plus petite juste sous le titre
    var subt=lines.filter(l=>l!==cur&&l.y0>=tl.y1-2&&l.y0-tl.y1<tl.h*2.2&&l.h<=m*0.8&&l.h>=m*0.3&&l.conf>=70&&l.text.length>=18&&lettr(l)>=0.75).sort((a,b)=>a.y0-b.y0)[0];
  }
  const subt2=subt&&lines.find(l=>l!==subt&&l.y0>=subt.y1-2&&l.y0-subt.y1<subt.h*1.2&&Math.abs(l.h-subt.h)<=subt.h*0.3&&Math.abs(l.x0-subt.x0)<cv.width*0.03&&l.conf>=70&&l.text.length>=18&&lettr(l)>=0.75);
  if(!title&&lines.length)title=lines.slice().sort((a,b)=>b.h-a.h)[0].text;
  const sRe=/^\s*(sources?|d['’]apr[eè]s|donn[eé]es|cr[eé]dit)\b\s*[:\-–.]?\s*(.*)$/i,sl=lines.find(l=>sRe.test(l.text)),source=sl?(sl.text.replace(sRe,"$2").trim()||sl.text):"";
  const lab=lines.filter(l=>l!==sl&&!title.includes(l.text)&&/\d/.test(l.text)&&/\p{L}{2,}/u.test(l.text)&&l.text.length>=5&&l.text.length<=70)
    .sort((a,b)=>b.conf-a.conf).slice(0,6).sort((a,b)=>a.y0-b.y0).map(l=>clip(l.text,70));
  // valeurs avec unité (8,4 %) : associées aux années (2019…) les plus proches à l'horizontale, sinon à l'étiquette voisine (au-dessus ou à gauche)
  const valRe=/^[\s(]*[+\-−]?\d{1,3}(?:[\s.]\d{3})*(?:[.,]\d+)?\s*(?:%|€|\$|£|k€|m€|md€|milliards?|millions?|points?)\s*\)?$/i,yrRe=/^\s*(?:19|20)\d{2}\s*$/,cx=l=>(l.x0+l.x1)/2;
  lines.forEach(l=>{const c=l.text.replace(/^[\s=|_~.,:;*•·'"]+/,"").replace(/^[\-−]\s*[=|_~.,:;*•·]+\s*(?=\d)/,"");if(c!==l.text&&valRe.test(c))l.text=c});
  const vals=lines.filter(l=>valRe.test(l.text)),yrs=lines.filter(l=>yrRe.test(l.text)),paired=[];
  if(yrs.length>=2){
    const used=new Set();
    for(const v of vals.slice().sort((a,b)=>cx(a)-cx(b))){
      let best=null,bd=1e9;for(const y of yrs){if(used.has(y))continue;const dd=Math.abs(cx(y)-cx(v));if(dd<bd){bd=dd;best=y}}
      if(best&&bd<cv.width*0.12){used.add(best);paired.push({x:cx(v),t:best.text.trim()+" : "+pct(v.text)})}
    }
  }
  let lp=[];
  if(paired.length<2){
    for(const v of vals){
      let best=null,bd=1e9;
      for(const L of lines){
        if(L===v||L===sl||valRe.test(L.text)||yrRe.test(L.text)||L.text.length>40||txt(L).replace(/\P{L}/gu,"").length<3||lettr(L)<0.8)continue;
        const hh=Math.max(v.h,L.h);let dd=1e9;
        if(L.y1<=v.y0+hh*0.3&&v.y0-L.y1<hh*1.6&&Math.abs(L.x0-v.x0)<hh*2)dd=Math.hypot(L.x0-v.x0,v.y0-L.y1);
        else if(Math.abs((L.y0+L.y1)/2-(v.y0+v.y1)/2)<hh*0.6&&L.x1<=v.x0+hh*0.3&&v.x0-L.x1<hh*4)dd=Math.hypot(v.x0-L.x1,0)+hh;
        if(dd<bd){bd=dd;best=L}
      }
      if(best)lp.push({v,y:v.y0,x:v.x0,t:best.text.replace(/[\s:]+$/,"").replace(/^[^\p{L}\p{N}]+/u,"")+" : "+pct(v.text)});
    }
    if(lp.length){const mh=Math.max(...lp.map(p=>p.v.h));lp=lp.filter(p=>p.v.h>=mh*0.75).sort((a,b)=>a.y-b.y||a.x-b.x)}
  }
  // ni valeurs associées, ni étiquettes : ce n'est pas un graphique lisible → on rend simplement les lignes sûres, dans l'ordre, en le disant
  if(paired.length<2&&!lp.length&&vals.length<3){
    const gd=lines.filter(l=>l!==sl&&l.conf>=70&&visLet(l)>=4&&visSane(visTrim(l.text))).sort((a,b)=>a.y0-b.y0||a.x0-b.x0).map(l=>visTrim(l.text));
    if(gd.length>=2){
      dg.push("Pas de graphique reconnu : "+gd.length+" lignes sûres reprises telles quelles");
      const yr0=(gd.join(" ")+" "+source).match(/\b(?:19|20)\d{2}\b/);
      return{card:1,plain:1,partial:true,title:clip(gd[0],120),summary:gd.join("\n"),figures:[],sourceLine:clip(source,120),year:yr0?yr0[0]:"",theme:themeFromSubjects([gd.join(" ")]),sub:"",tags:[],type:/\d/.test(gd.join(" "))?"chi":"arg",kind:"Autre",note:"",engine:"local",found:gd.length,diag:"Lecture locale (version 6a)\n"+dg.join("\n")};
    }
  }
  const fig=(paired.length>=2?paired.sort((a,b)=>a.x-b.x).map(p=>p.t):lp.length?lp.map(p=>p.t):[...vals.slice(0,6).map(v=>pct(v.text)),...lab]).slice(0,8);
  const all=lines.map(l=>l.text).join(" "),yr=(source+" "+title+" "+(subt?subt.text:"")+" "+(subt2?subt2.text:"")).match(/\b(?:19|20)\d{2}\b/);
  const words=[...new Set((title.toLowerCase().match(/\p{L}{5,}/gu)||[]))].slice(0,3);
  return{title:clip(title,120),subtitle:subt?clip(subt.text+(subt2?" "+subt2.text:""),200):"",summary:"",figures:fig,sourceLine:clip(source,120),year:yr?yr[0]:"",theme:themeFromSubjects([all]),sub:(()=>{const p=title.split(/\s*:\s/)[0].trim();return p.length>=6&&p.length<=50&&p!==title?p:title.length>=6&&title.length<=45?title:""})(),tags:words,type:"chi",engine:"local",found:lines.filter(l=>visLet(l)>=4&&visSane(l.text)).length,diag:"Lecture locale (version 6a)\n"+dg.join("\n")+"\nValeurs : "+fig.length+(fig.length?" — "+fig.join(" ; "):"")};
}

/* --- brouillon de fiche --- */
function toDraft(a,imgId){
  const ls=[];
  if(a.summary)ls.push(a.summary);else{if(a.title)ls.push(a.title);if(a.subtitle)ls.push(a.subtitle)}
  (a.figures||[]).forEach(f=>ls.push("• "+f));
  const title=a.title||("Image du "+new Date().toLocaleDateString("fr-FR"));
  return{diag:a.diag||(a.engine==="gemini"?"Lecture par Gemini (version 5g)":""),type:a.type||"chi",text:ls.join("\n"),tags:[...new Set([a.card?"capture":"graphique",...(a.tags||[])])],imgs:[imgId],
    newSrc:{title,kind:a.kind||"Graphique",url:"",author:a.sourceLine||"",year:a.year||"",note:[a.note,a.sourceLine?"Source indiquée sur l’image : "+a.sourceLine:""].filter(Boolean).join(" — "),cat:a.theme||""},
    place:{theme:a.theme||"À classer",sub:a.sub||"En vrac"}};
}

/* --- « Image ou graphique » : choisir (une ou plusieurs), analyser, ouvrir la fiche prête --- */
function imageFlow(tid){
  const i=document.createElement("input");i.type="file";i.accept="image/*";i.multiple=true;i.style.display="none";document.body.append(i);
  i.onchange=()=>{const fs=[...i.files];i.remove();if(fs.length===1)runImage(fs[0],tid);else if(fs.length>1)runBatch(fs,tid)};i.click();
}
// analyse d'une image : compresse + stocke, puis Gemini (si clé) ou lecture locale. ctx={dead,id} partagé avec l'écran d'attente.
async function visAnalyse(file,st,ctx){
  let a=null,gErr="";
  try{
    const blob=await compress(file);ctx.id=uid();await idbPut({id:ctx.id,blob,up:0,t:Date.now()});
    if(ctx.dead)return{id:ctx.id};
    if(gKey()){
      st("Lecture du graphique par Gemini…");
      const tryG=async()=>{try{return await geminiAnalyse(blob)}catch(e){return e}};
      let r=await tryG();
      if(r instanceof Error&&r.status===404&&await healModel())r=await tryG();
      if(r instanceof Error)gErr=r.name==="AbortError"?"Gemini : délai dépassé":r.status?"Gemini : erreur "+r.status:r instanceof TypeError?"Gemini injoignable":"Gemini : réponse inutilisable";
      else a=r;
    }
    if(ctx.dead)return{id:ctx.id};
    if(!a){
      const pre=gErr?gErr+" — ":"";
      st(pre+"Lecture du texte de l’image…");ocrSay=m=>st(pre+m);
      try{a=await localAnalyse(await ocrCanvas(file))}finally{ocrSay=null}
    }
    return{id:ctx.id,a};
  }catch(e){return{id:ctx.id,err:e}}
}
async function runImage(file,tid){
  const d=document.createElement("div");d.className="ov";d.id="an";const ctx={dead:false,id:""};
  const url=URL.createObjectURL(file);
  d.innerHTML=`<div class="sheet" role="dialog" aria-label="Analyse de l’image"><div class="h"></div><h2 class="ct" style="margin:0">Analyse de l’image</h2>
<img src="${url}" alt="" style="max-height:200px;width:100%;object-fit:contain;border-radius:12px;background:#fff">
<p class="mu" id="anS" role="status" style="margin:0">Préparation…</p><button class="btn gh" data-x="1">Annuler</button></div>`;
  const close=()=>{d.remove();URL.revokeObjectURL(url);ocrSay=null};
  d.onclick=e=>{if(e.target===d||e.target.closest("[data-x]")){ctx.dead=true;close();if(ctx.id)dropImgs([ctx.id])}};
  document.body.append(d);
  const st=m=>{const e=d.querySelector("#anS");if(e)e.textContent=m};
  const r=await visAnalyse(file,st,ctx);
  if(ctx.dead){if(r.id)dropImgs([r.id]);return}
  let msg="";
  if(r.err||!r.a){
    if(!r.id){close();toast("Image illisible : "+clip(r.err?r.err.message:"",60));return}
    msg="Analyse impossible ("+clip(r.err?r.err.message:"",60)+"). L’image est jointe : décris-la toi-même.";
    draft=toDraft({},r.id);
  }else{
    msg=r.a.engine==="gemini"?"Fiche prête (Gemini). Vérifie, puis enregistre.":r.a.plain?"Lecture partielle du texte : vérifie et corrige avant d’enregistrer.":r.a.partial?"Lecture incomplète : complète les passages « […] », puis enregistre.":(r.a.found?"Fiche prête (texte lu sur l’image). Vérifie, puis enregistre.":"Aucun texte lisible : décris l’image en une phrase.");
    draft=toDraft(r.a,r.id);
  }
  close();flushImages();go("#/e/"+tid+"/new");toast(msg,6000);
}

/* --- plusieurs images d'un coup : une fiche créée par image, puis récapitulatif --- */
function visCreate(dr,hasTitle,tid){
  let src="";
  if(hasTitle){const n=dr.newSrc;src=newSource({title:n.title,kind:n.kind,url:n.url,author:n.author,year:n.year,note:n.note,cat:n.cat})}
  let to=tid&&tid!=="auto"&&findSub(tid)?tid:"";
  if(!to)to=commitPlace(planPlace({text:dr.text,cite:"",tags:dr.tags,src,hint:dr.place}));
  const f=findSub(to),it=newItem({type:dr.type,text:dr.text,src,tags:dr.tags,imgs:dr.imgs,u:now()});
  f.sub.items.unshift(it);save();
  return{sid:to,iid:it.id,title:hasTitle?dr.newSrc.title:"Image à décrire",label:f.theme.name+" › "+f.sub.name,todo:dr.tags.includes("à décrire")};
}
async function runBatch(files,tid){
  const N=files.length,d=document.createElement("div");d.className="ov";d.id="an";const ctx={dead:false,id:""};
  d.innerHTML=`<div class="sheet" role="dialog" aria-label="Import de ${N} images"><div class="h"></div><h2 class="ct" style="margin:0" id="anH">Import de ${N} images</h2>
<img id="anI" src="" alt="" style="max-height:160px;width:100%;object-fit:contain;border-radius:12px;background:#fff">
<p class="mu" id="anS" role="status" style="margin:0">Préparation…</p><button class="btn gh" data-x="1">Arrêter</button></div>`;
  let url="";const close=()=>{d.remove();if(url)URL.revokeObjectURL(url);ocrSay=null};
  d.onclick=e=>{if(e.target===d||e.target.closest("[data-x]")){ctx.dead=true;close();if(ctx.id)dropImgs([ctx.id])}};
  document.body.append(d);
  const q=s=>d.querySelector(s),made=[];let bad=0;
  for(let k=0;k<N&&!ctx.dead;k++){
    ctx.id="";if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(files[k]);
    if(q("#anI"))q("#anI").src=url;
    const tag="Image "+(k+1)+"/"+N+" — ";
    if(q("#anH"))q("#anH").textContent="Image "+(k+1)+" sur "+N;
    const r=await visAnalyse(files[k],m=>{const e=q("#anS");if(e)e.textContent=tag+m},ctx);
    if(ctx.dead){if(r.id)dropImgs([r.id]);break}
    if(!r.id){bad++;continue}
    try{
      const ok=!r.err&&r.a&&(r.a.engine==="gemini"||r.a.found),dr=toDraft(ok?r.a:{},r.id);
      if(!ok)dr.tags=[...new Set([...dr.tags,"à décrire"])];
      made.push(visCreate(dr,ok&&!!r.a.title,tid));
    }catch(e){bad++;dropImgs([r.id])}
  }
  close();flushImages();
  if(!made.length){toast(ctx.dead?"Import arrêté.":"Aucune image lisible.");return}
  route();visSummary(made,bad,ctx.dead?N-made.length-bad:0);
}
function visSummary(made,bad,left){
  closeSheet();const n=made.length,todo=made.filter(m=>m.todo).length;
  const d=document.createElement("div");d.className="ov";d.id="sh";
  d.innerHTML=`<div class="sheet" role="dialog" aria-label="Fiches créées"><div class="h"></div><h2 class="ct" style="margin:0">${n} fiche${n>1?"s":""} créée${n>1?"s":""}</h2>
<p class="mu" style="margin:0">Touche une fiche pour la vérifier ou la corriger.${todo?` ${todo} sans texte lisible : à décrire (étiquette « à décrire »).`:""}${bad?` ${bad} image${bad>1?"s":""} illisible${bad>1?"s":""}.`:""}${left>0?` ${left} non traitée${left>1?"s":""} (arrêt).`:""}</p>
<div class="stack" style="overflow:auto">${made.map(m=>`<button class="opt" data-g="#/f/${m.sid}/${m.iid}"><span><b>${esc(clip(m.title,70))}</b><small>${esc(m.label)}${m.todo?" · à décrire":""}</small></span></button>`).join("")}</div>
<button class="btn" data-o="done">Terminer</button></div>`;
  d.onclick=e=>{
    if(e.target===d){closeSheet();return}
    const g=e.target.closest("[data-g]");if(g){closeSheet();go(g.dataset.g);return}
    if(e.target.closest("[data-o]"))closeSheet();
  };
  document.body.append(d);
}

/* --- « Relire le texte de l'image » sur une fiche existante : refait l'analyse de la 1re image et remplit le formulaire --- */
async function rereadImage(){
  const id=typeof fImgs!=="undefined"&&fImgs[0];if(!id){toast("Ajoute d’abord une image à la fiche.");return}
  const btn=document.querySelector("[data-a=reread]"),old=btn?btn.textContent:"",say=m=>{if(btn)btn.textContent=m};
  if(btn){if(btn.disabled)return;btn.disabled=true}
  try{
    say("Lecture en cours…");
    const u=await imgUrl(id);if(!u)throw new Error("image introuvable");
    const blob=await(await fetch(u)).blob();let a=null,pre="";
    if(gKey()){try{a=await geminiAnalyse(blob)}catch(e){pre="Gemini indisponible, lecture locale. "}}
    if(!a){ocrSay=m=>say(m);a=await localAnalyse(await ocrCanvas(blob))}
    const dr=toDraft(a,id),$=q=>document.querySelector(q);
    if(!$("#fX"))return;
    $("#fX").value=dr.text;if(a.type)$("#fT").value=dr.type;
    const tg=$("#fG");tg.value=[...new Set([...tg.value.split(",").map(x=>x.trim().replace(/^#/,"")).filter(Boolean),...dr.tags])].join(", ");
    window.rereadNS=dr.newSrc;$("#fR").value="__new";$("#fN").hidden=false;$("#fNT").value=dr.newSrc.title;$("#fNK").value="Graphique";
    const dg=$("#diag");if(dg){$("#diagT").textContent=dr.diag||"";dg.hidden=!dr.diag}
    toast(pre+(a.found||a.engine==="gemini"?"Texte relu. Vérifie, puis enregistre.":"Aucun texte lisible sur l’image."),5000);
  }catch(e){toast("Lecture impossible : "+clip(e.message,60))}
  finally{ocrSay=null;if(btn){btn.disabled=false;btn.textContent=old}}
}

/* --- réglage Gemini (page Compte) --- */
function gemCard(){
  return`<div class="card"><b>Analyse des images par Gemini (facultatif)</b>
<p class="mu" style="margin:0">Sans clé, l’app lit le texte des images sur ton appareil. Avec une clé gratuite (Google AI Studio), elle comprend le graphique, le résume et propose le classement. L’image est alors envoyée à Google : n’envoie rien de confidentiel. La clé reste sur cet appareil seulement.</p>
<label class="lbl" for="gK">Clé API Gemini</label><input id="gK" type="password" autocomplete="off" value="${esc(gKey())}" placeholder="AIza…">
<label class="lbl" for="gM">Modèle</label><input id="gM" value="${esc(gModel())}">
<div id="gS" class="mu" role="status" style="min-height:18px"></div>
<div class="row"><button class="btn pri sp" data-g="save">Enregistrer</button><button class="btn sp" data-g="test">Tester</button></div></div>`;
}
function gemBind(){
  const root=document.getElementById("gK");if(!root)return;
  const card=root.closest(".card"),say=m=>{card.querySelector("#gS").textContent=m};
  const store=()=>{try{const k=card.querySelector("#gK").value.trim(),m=card.querySelector("#gM").value.trim()||GM_DEF;k?localStorage.setItem(GK,k):localStorage.removeItem(GK);m!==GM_DEF?localStorage.setItem(GM,m):localStorage.removeItem(GM)}catch(e){}};
  card.onclick=async e=>{
    const b=e.target.closest("[data-g]");if(!b)return;
    store();
    if(b.dataset.g==="save"){say(gKey()?"Enregistré. Les images seront analysées par Gemini.":"Clé retirée : lecture locale seulement.");return}
    if(!gKey()){say("Colle d’abord une clé.");return}
    say("Test en cours…");
    try{await geminiCall([{text:"Réponds par {\"ok\":true}"}],gKey(),gModel());say("Clé valide, modèle « "+gModel()+" » OK.")}
    catch(x){
      if(x.status===404){
        const m=await healModel();
        if(m){card.querySelector("#gM").value=m;say("Modèle remplacé par « "+m+" » (l’ancien n’existe plus).");return}
        say("Modèle introuvable : change le nom du modèle.");return;
      }
      say(x.status===400||x.status===403?"Clé refusée ("+x.status+") : vérifie-la.":x.status===429?"Quota gratuit atteint : réessaie plus tard.":x instanceof TypeError?"Pas de connexion internet.":"Échec : "+x.message);
    }
  };
}

// la page Compte peut être affichée avant le chargement de ce fichier : on la redessine une fois prêt
if(location.hash==="#/c"&&typeof accountPage==="function"&&!document.getElementById("gK"))accountPage();
