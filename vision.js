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
  // le cadre qui touche le bord du recadrage (hors du bandeau) est effacé : il ne doit pas coller aux lettres
  const dk=new Uint8Array(N),st=new Int32Array(N);let sp=0;
  const pu=i=>{if(!dk[i]&&o[4*i]<128){dk[i]=1;st[sp++]=i}};
  for(let i=0;i<w;i++){pu(i);pu((h-1)*w+i)}for(let j=0;j<h;j++){pu(j*w);pu(j*w+w-1)}
  while(sp){const p=st[--sp],px=p%w;if(px>0)pu(p-1);if(px<w-1)pu(p+1);if(p>=w)pu(p-w);if(p<N-w)pu(p+w)}
  for(let i=0;i<N;i++)if(dk[i]){const q=4*i;o[q]=o[q+1]=o[q+2]=255}
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
async function visReadLine(wk,cv,gray,l){
  const ml=Math.round(cv.width*0.1),mr=Math.round(cv.width*0.012),my=Math.round(l.h*0.35),x0=Math.max(0,l.x0-ml),y0=Math.max(0,l.y0-my),x1=Math.min(cv.width,l.x1+mr),y1=Math.min(cv.height,l.y1+my),out=[];
  if(x1-x0<20||y1-y0<10)return out;
  const run=async(img,w)=>{
    if(!img)return;let r;try{r=await visLines(wk,img,"7")}catch(e){return}
    if(!r.length)return;
    const t=r.map(x=>x.text).join(" ").replace(/^[\s|\[\]]+|[\s|\[\]]+$/g,"").trim(),cf=r.reduce((a,x)=>a+x.conf,0)/r.length;
    if(t&&cf>=55)out.push({t,w:w*cf/100});
  };
  const c=document.createElement("canvas");c.width=(x1-x0)*2;c.height=(y1-y0)*2;
  const g=c.getContext("2d");g.fillStyle="#fff";g.fillRect(0,0,c.width,c.height);g.drawImage(gray,x0,y0,x1-x0,y1-y0,0,0,c.width,c.height);
  await run(c,1);await run(visBin(cv,x0,y0,x1,y1,2),1.5);await run(visBin(cv,x0,y0,x1,y1,3),1.5);
  return out;
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
  const fig=(paired.length>=2?paired.sort((a,b)=>a.x-b.x).map(p=>p.t):lp.length?lp.map(p=>p.t):[...vals.slice(0,6).map(v=>pct(v.text)),...lab]).slice(0,8);
  const all=lines.map(l=>l.text).join(" "),yr=(source+" "+title+" "+(subt?subt.text:"")+" "+(subt2?subt2.text:"")).match(/\b(?:19|20)\d{2}\b/);
  const words=[...new Set((title.toLowerCase().match(/\p{L}{5,}/gu)||[]))].slice(0,3);
  return{title:clip(title,120),subtitle:subt?clip(subt.text+(subt2?" "+subt2.text:""),200):"",summary:"",figures:fig,sourceLine:clip(source,120),year:yr?yr[0]:"",theme:themeFromSubjects([all]),sub:(()=>{const p=title.split(/\s*:\s/)[0].trim();return p.length>=6&&p.length<=50&&p!==title?p:title.length>=6&&title.length<=45?title:""})(),tags:words,type:"chi",engine:"local",found:lines.length,diag:"Lecture locale (version 5g)\n"+dg.join("\n")+"\nValeurs : "+fig.length+(fig.length?" — "+fig.join(" ; "):"")};
}

/* --- brouillon de fiche --- */
function toDraft(a,imgId){
  const ls=[];
  if(a.summary)ls.push(a.summary);else{if(a.title)ls.push(a.title);if(a.subtitle)ls.push(a.subtitle)}
  (a.figures||[]).forEach(f=>ls.push("• "+f));
  const title=a.title||("Image du "+new Date().toLocaleDateString("fr-FR"));
  return{diag:a.diag||(a.engine==="gemini"?"Lecture par Gemini (version 5g)":""),type:a.type||"chi",text:ls.join("\n"),tags:[...new Set(["graphique",...(a.tags||[])])],imgs:[imgId],
    newSrc:{title,kind:"Graphique",url:"",author:a.sourceLine||"",year:a.year||"",note:a.sourceLine?"Source indiquée sur l’image : "+a.sourceLine:"",cat:a.theme||""},
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
    msg=r.a.engine==="gemini"?"Fiche prête (Gemini). Vérifie, puis enregistre.":(r.a.found?"Fiche prête (texte lu sur l’image). Vérifie, puis enregistre.":"Aucun texte lisible : décris l’image en une phrase.");
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
