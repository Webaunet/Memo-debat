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
function visMerge(a,b){
  const out=a.slice(),ar=l=>Math.max(0,l.x1-l.x0)*Math.max(0,l.y1-l.y0);
  for(const l of b){
    const o=out.find(o=>{const w=Math.min(o.x1,l.x1)-Math.max(o.x0,l.x0),h=Math.min(o.y1,l.y1)-Math.max(o.y0,l.y0);return w>0&&h>0&&w*h>0.5*Math.min(ar(o),ar(l))});
    if(!o)out.push(l);else if(l.conf>o.conf+8&&l.text.length>=o.text.length*0.8)out[out.indexOf(o)]=l;
  }
  return out;
}
// relit une ligne de titre seule (recadrée, agrandie ×2, en 1 ligne) : récupère par ex. « 44 % » lu « © » dans un bandeau coloré
async function visRefine(wk,gray,l,cv){
  const ml=Math.round(cv.width*0.1),mr=Math.round(cv.width*0.012),my=Math.round(l.h*0.35),x0=Math.max(0,l.x0-ml),y0=Math.max(0,l.y0-my),x1=Math.min(cv.width,l.x1+mr),y1=Math.min(cv.height,l.y1+my);
  if(x1-x0<20||y1-y0<10)return"";
  const c=document.createElement("canvas");c.width=(x1-x0)*2;c.height=(y1-y0)*2;
  const g=c.getContext("2d");g.fillStyle="#fff";g.fillRect(0,0,c.width,c.height);g.drawImage(gray,x0,y0,x1-x0,y1-y0,0,0,c.width,c.height);
  let r;try{r=await visLines(wk,c,"7")}catch(e){return""}
  if(!r.length)return"";
  const t=r.map(x=>x.text).join(" ").replace(/^[\s|\[\]]+|[\s|\[\]]+$/g,"").trim(),cf=r.reduce((a,x)=>a+x.conf,0)/r.length,w=l.text.split(" "),tail=w.slice(1).join(" "),head=w.slice(0,-1).join(" ");
  let out="";
  if(tail.length>=8){const i=t.indexOf(tail);if(i>0&&i<=14){const ex=t.slice(i+tail.length);out=t.slice(0,i)+tail+(/^\p{L}{2,}$/u.test(ex)?ex:"")}}
  if(!out&&head.length>=8&&t.startsWith(head)&&t.length-head.length<=14)out=t;
  const mid=w.slice(1,-1).join(" ");  // début ET fin mal lus : on s'appuie sur le milieu
  if(!out&&mid.length>=12){const i=t.indexOf(mid);if(i>=0&&i<=14&&t.length-i-mid.length<=14)out=t}
  return cf>=70&&out.length>l.text.length?out:"";
}
const pct=t=>t.trim().replace(/\s*%$/," %");
async function localAnalyse(cv){
  const wk=await getOcr(),vs=ocrVersions(cv);let lines=[];
  for(let i=0;i<vs.length;i++){
    window.ocrExtra=" (passe "+(i+1)+"/"+vs.length+")";
    try{lines=visMerge(lines,await visLines(wk,vs[i]))}catch(e){if(!i)throw e}
  }
  window.ocrExtra="";
  const H=cv.height,txt=l=>l.text.replace(/[^\p{L}\p{N}]/gu,""),lettr=l=>(txt(l).match(/\p{L}/gu)||[]).length/Math.max(1,txt(l).length);
  const top=lines.filter(l=>l.y0<H*0.38&&l.text.length>=8&&l.conf>=70&&lettr(l)>=0.75&&/\p{L}{3,}\s+\S+/u.test(l.text));
  let title="",tl=null;
  if(top.length){
    const m=Math.max(...top.map(l=>l.h)),big=top.filter(l=>l.h>=m*0.8).sort((a,b)=>a.y0-b.y0);
    let cur=big[0];const grp=[cur];tl=cur;
    for(const l of big.slice(1)){if(l.y0-cur.y1<Math.max(cur.h,1)*1.4){grp.push(l);cur=l;tl=l}else break}
    for(const l of grp){try{const t=await visRefine(wk,vs[0],l,cv);if(t)l.text=t}catch(e){}}
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
  return{title:clip(title,120),subtitle:subt?clip(subt.text+(subt2?" "+subt2.text:""),200):"",summary:"",figures:fig,sourceLine:clip(source,120),year:yr?yr[0]:"",theme:themeFromSubjects([all]),sub:(()=>{const p=title.split(/\s*:\s/)[0].trim();return p.length>=6&&p.length<=50&&p!==title?p:title.length>=6&&title.length<=45?title:""})(),tags:words,type:"chi",engine:"local",found:lines.length};
}

/* --- brouillon de fiche --- */
function toDraft(a,imgId){
  const ls=[];
  if(a.summary)ls.push(a.summary);else{if(a.title)ls.push(a.title);if(a.subtitle)ls.push(a.subtitle)}
  (a.figures||[]).forEach(f=>ls.push("• "+f));
  const title=a.title||("Image du "+new Date().toLocaleDateString("fr-FR"));
  return{type:a.type||"chi",text:ls.join("\n"),tags:[...new Set(["graphique",...(a.tags||[])])],imgs:[imgId],
    newSrc:{title,kind:"Graphique",url:"",author:a.sourceLine||"",year:a.year||"",note:a.sourceLine?"Source indiquée sur l’image : "+a.sourceLine:"",cat:a.theme||""},
    place:{theme:a.theme||"À classer",sub:a.sub||"En vrac"}};
}

/* --- « Image ou graphique » : choisir, analyser, ouvrir la fiche prête --- */
function imageFlow(tid){
  const i=document.createElement("input");i.type="file";i.accept="image/*";i.style.display="none";document.body.append(i);
  i.onchange=()=>{const f=i.files[0];i.remove();if(f)runImage(f,tid)};i.click();
}
async function runImage(file,tid){
  const d=document.createElement("div");d.className="ov";d.id="an";let dead=false,id="";
  const url=URL.createObjectURL(file);
  d.innerHTML=`<div class="sheet" role="dialog" aria-label="Analyse de l’image"><div class="h"></div><h2 class="ct" style="margin:0">Analyse de l’image</h2>
<img src="${url}" alt="" style="max-height:200px;width:100%;object-fit:contain;border-radius:12px;background:#fff">
<p class="mu" id="anS" role="status" style="margin:0">Préparation…</p><button class="btn gh" data-x="1">Annuler</button></div>`;
  const close=()=>{d.remove();URL.revokeObjectURL(url);ocrSay=null};
  d.onclick=e=>{if(e.target===d||e.target.closest("[data-x]")){dead=true;close();if(id)dropImgs([id])}};
  document.body.append(d);
  const st=m=>{const e=d.querySelector("#anS");if(e)e.textContent=m};
  let a=null,gErr="",msg="";
  try{
    const blob=await compress(file);id=uid();await idbPut({id,blob,up:0,t:Date.now()});
    if(dead){dropImgs([id]);return}
    if(gKey()){
      st("Lecture du graphique par Gemini…");
      const tryG=async()=>{try{return await geminiAnalyse(blob)}catch(e){return e}};
      let r=await tryG();
      if(r instanceof Error&&r.status===404&&await healModel())r=await tryG();
      if(r instanceof Error)gErr=r.name==="AbortError"?"Gemini : délai dépassé":r.status?"Gemini : erreur "+r.status:r instanceof TypeError?"Gemini injoignable":"Gemini : réponse inutilisable";
      else a=r;
    }
    if(dead){dropImgs([id]);return}
    if(!a){
      const pre=gErr?gErr+" — ":"";
      st(pre+"Lecture du texte de l’image…");ocrSay=m=>st(pre+m);
      a=await localAnalyse(await ocrCanvas(file));ocrSay=null;
    }
    if(dead){dropImgs([id]);return}
    msg=a.engine==="gemini"?"Fiche prête (Gemini). Vérifie, puis enregistre.":(a.found?"Fiche prête (texte lu sur l’image). Vérifie, puis enregistre.":"Aucun texte lisible : décris l’image en une phrase.");
    draft=toDraft(a,id);
  }catch(e){
    if(dead){if(id)dropImgs([id]);return}
    msg="Analyse impossible ("+clip(e.message,60)+"). L’image est jointe : décris-la toi-même.";
    if(!id){close();toast("Image illisible : "+clip(e.message,60));return}
    draft=toDraft({},id);
  }
  close();flushImages();go("#/e/"+tid+"/new");toast(msg,6000);
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
