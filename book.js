/* ===== Livres : choisir un livre par photo (code-barres ISBN, couverture) ou par recherche — base gratuite Open Library ===== */
const OLB="https://openlibrary.org";
// ISBN-13 (978/979) ou ISBN-10 valides → ISBN-13, sinon ""
function isbnOk(s){
  s=String(s||"").replace(/[^0-9Xx]/g,"");
  if(s.length===13&&/^97[89]\d+$/.test(s)){let t=0;for(let i=0;i<12;i++)t+=(+s[i])*(i%2?3:1);return (10-t%10)%10===+s[12]?s:""}
  if(s.length===10&&/^\d{9}[\dXx]$/.test(s)){
    let t=0;for(let i=0;i<9;i++)t+=(+s[i])*(10-i);
    const v=(11-t%11)%11;if((v===10?"X":String(v))!==s[9].toUpperCase())return"";
    const b="978"+s.slice(0,9);let u=0;for(let i=0;i<12;i++)u+=(+b[i])*(i%2?3:1);return b+((10-u%10)%10);
  }
  return"";
}
/* --- décodeur EAN-13 (utilisé quand le navigateur n'a pas BarcodeDetector, ex. Chrome sous Windows) --- */
const EAN_L=["3211","2221","2122","1411","1132","1231","1114","1312","1213","3112"];
const EAN_G=EAN_L.map(s=>[...s].reverse().join(""));
const EAN_P=["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];
function eanDigit(r,tab){
  const s=r[0]+r[1]+r[2]+r[3];if(s<=0)return null;
  let best=-1,bd=1e9;
  for(let d=0;d<10;d++){let e=0;for(let i=0;i<4;i++)e+=Math.abs(r[i]*7/s-(+tab[d][i]));if(e<bd){bd=e;best=d}}
  return bd<1.7?[best,bd]:null;
}
function eanFromRuns(r){
  const m=(r[0]+r[1]+r[2])/3;if(m<1)return"";
  let tot=0;for(let i=0;i<59;i++)tot+=r[i];if(Math.abs(tot/m-95)>16)return"";
  let par="";const ds=[];
  for(let k=0;k<6;k++){
    const q=r.slice(3+4*k,7+4*k),a=eanDigit(q,EAN_L),b=eanDigit(q,EAN_G);
    if(!a&&!b)return"";
    if(a&&(!b||a[1]<=b[1])){par+="L";ds.push(a[0])}else{par+="G";ds.push(b[0])}
  }
  const f=EAN_P.indexOf(par);if(f<0)return"";
  for(let k=0;k<6;k++){const a=eanDigit(r.slice(32+4*k,36+4*k),EAN_L);if(!a)return"";ds.push(a[0])}
  const s=f+ds.join("");let t=0;for(let i=0;i<12;i++)t+=(+s[i])*(i%2?3:1);
  return (10-t%10)%10===+s[12]?s:"";
}
function scanLine(v){
  const n=v.length,B=4,nb=Math.ceil(n/B),mn=new Float32Array(nb).fill(255),mx=new Float32Array(nb);
  for(let i=0;i<n;i++){const k=(i/B)|0;if(v[i]<mn[k])mn[k]=v[i];if(v[i]>mx[k])mx[k]=v[i]}
  const hw=Math.max(8,Math.round(n/16/B)),lo=new Float32Array(nb),hi=new Float32Array(nb);
  for(let k=0;k<nb;k++){let a=255,b=0;for(let j=Math.max(0,k-hw);j<=Math.min(nb-1,k+hw);j++){if(mn[j]<a)a=mn[j];if(mx[j]>b)b=mx[j]}lo[k]=a;hi[k]=b}
  const runs=[];let cur=-1,len=0;
  for(let i=0;i<n;i++){
    const k=(i/B)|0,c=(hi[k]-lo[k]>30&&v[i]<(hi[k]+lo[k])/2)?1:0;
    if(c===cur)len++;else{if(cur>=0)runs.push([cur,len]);cur=c;len=1}
  }
  runs.push([cur,len]);
  for(let i=0;i+59<=runs.length;i++){
    if(runs[i][0]!==1)continue;
    const r=[];for(let k=0;k<59;k++)r.push(runs[i+k][1]);
    const g=Math.max(r[0],r[1],r[2])/Math.max(1,Math.min(r[0],r[1],r[2]));if(g>2.4)continue;
    let s=eanFromRuns(r)||eanFromRuns(r.slice().reverse());
    if(s&&/^97[89]/.test(s))return s;
  }
  return"";
}
function scanEAN(cv){
  const tries=[];
  for(const maxS of [2000,1100]){
    const sc=Math.min(1,maxS/Math.max(cv.width,cv.height)),W=Math.round(cv.width*sc),H=Math.round(cv.height*sc);
    const c=document.createElement("canvas");c.width=W;c.height=H;const x=c.getContext("2d",{willReadFrequently:true});x.drawImage(cv,0,0,W,H);
    const px=x.getImageData(0,0,W,H).data,g=new Float32Array(W*H);
    for(let i=0;i<W*H;i++)g[i]=0.299*px[i*4]+0.587*px[i*4+1]+0.114*px[i*4+2];
    tries.push({g,W,H});
  }
  for(const {g,W,H} of tries){
    for(let k=0;k<70;k++){const y=Math.floor(H*(0.04+0.92*k/69)),s=scanLine(g.subarray(y*W,y*W+W));if(s)return s}
    for(let k=0;k<70;k++){const x=Math.floor(W*(0.04+0.92*k/69)),v=new Float32Array(H);for(let y=0;y<H;y++)v[y]=g[y*W+x];const s=scanLine(v);if(s)return s}
  }
  return"";
}
async function detectISBN(cv){
  if("BarcodeDetector" in window){
    try{const bd=new BarcodeDetector({formats:["ean_13"]});for(const b of await bd.detect(cv)){const i=isbnOk(b.rawValue);if(i)return i}}catch(e){}
  }
  return scanEAN(cv);
}
/* --- Open Library --- */
const olData=(v,isbn)=>({title:v.title||"",author:(v.authors||[]).map(a=>a.name).filter(Boolean).slice(0,2).join(", "),year:(String(v.publish_date||"").match(/\d{4}/)||[""])[0],isbn,subjects:(v.subjects||[]).map(s=>s.name||s).slice(0,15),url:v.url?String(v.url).replace(/^http:/,"https:"):""});
const olDoc=d=>({title:d.title||"",author:(d.author_name||[]).slice(0,2).join(", "),year:d.first_publish_year||"",isbn:(d.isbn||[]).map(isbnOk).find(Boolean)||"",subjects:(d.subject||[]).slice(0,15),url:""});
async function olJson(u){const r=await fetch(u);if(!r.ok)throw new Error("HTTP "+r.status);return r.json()}
async function lookupISBN(isbn){
  try{const j=await olJson(OLB+"/api/books?bibkeys=ISBN:"+isbn+"&format=json&jscmd=data"),v=j["ISBN:"+isbn];if(v&&v.title)return olData(v,isbn)}catch(e){if(e instanceof TypeError)throw e}
  const j=await olJson(OLB+"/search.json?isbn="+isbn+"&limit=1&fields=title,author_name,first_publish_year,isbn,subject");
  const d=j.docs&&j.docs[0];return d&&d.title?{...olDoc(d),isbn}:null;
}
async function searchBooks(q){
  const w=String(q).trim().split(/\s+/).filter(Boolean);
  for(const n of [8,4]){
    if(!w.length)break;
    const j=await olJson(OLB+"/search.json?q="+encodeURIComponent(w.slice(0,n).join(" "))+"&limit=8&fields=title,author_name,first_publish_year,isbn,subject,language");
    const docs=(j.docs||[]).filter(d=>d.title);
    if(docs.length)return docs.map(olDoc);
    if(w.length<=n)break;
  }
  return[];
}
/* --- thème déduit des sujets du livre (sans IA : mots-clés) --- */
const THEMES_FR=[
  ["Économie",/econom|labou?r\b|travail|work\b|emploi|chomage|unemploy|business|financ|commerce|capital|entreprise|management|salaire|wage/i],
  ["Politique",/politi|democra|government|gouvern|election|etat\b|state\b|parti/i],
  ["Histoire",/histor|guerre|war\b|revolution|empire/i],
  ["Philosophie",/philosoph|ethic|ethique|morale|metaphys/i],
  ["Droit",/\blaw\b|droit|juridi|legal|justice/i],
  ["Sociologie",/sociolog|social|societe|society|culture/i],
  ["Psychologie",/psycholog|psychan|cognit|emotion/i],
  ["Éducation",/educat|enseign|school|ecole|pedagog/i],
  ["Écologie",/ecolog|environment|climat|nature|energy|energie|sustainab|durable/i],
  ["Sciences",/scien|physic|physique|biolog|chimi|chemis|mathemat|astronom/i],
  ["Technologie",/techno|comput|inform|numerique|digital|internet|artificial|intelligence|robot/i],
  ["Santé",/health|sante|medic|medecine/i],
  ["Religion",/relig|theolog|christ|islam|bible/i],
  ["Littérature",/fiction|roman|novel|poetry|poesie|litter|literar/i]
];
function themeFromSubjects(subs){
  const s=(subs||[]).join(" | ").normalize("NFD").replace(/[̀-ͯ]/g,"");
  for(const [n,re] of THEMES_FR)if(re.test(s))return n;
  return"";
}
function bookSource(b){
  const t=(b.title||"").trim();if(!t)return"";
  const id="s_"+hash32(t);
  let s=db.sources.find(x=>(b.isbn&&x.isbn===b.isbn)||x.id===id);
  if(!s){
    const nid=newSource({title:t,author:b.author||"",year:String(b.year||""),kind:"Livre",url:b.url||"",isbn:b.isbn||"",cat:themeFromSubjects(b.subjects),note:""});
    return nid;
  }
  let ch=0;
  for(const [k,v] of [["author",b.author],["year",String(b.year||"")],["isbn",b.isbn],["cat",themeFromSubjects(b.subjects)],["url",b.url]])if(v&&!s[k]){s[k]=v;ch=1}
  if(s.kind!=="Livre"&&!s.kind){s.kind="Livre";ch=1}
  if(ch){s.u=now();save()}
  return s.id;
}
/* --- fenêtre « Choisir un livre » --- */
function pickBook(done){
  const old=document.getElementById("bk");if(old)old.remove();
  const d=document.createElement("div");d.className="ov";d.id="bk";
  const recent=db.sources.filter(s=>s.kind==="Livre").sort((a,b)=>(b.u||"").localeCompare(a.u||"")).slice(0,5);
  d.innerHTML=`<div class="sheet" role="dialog" aria-label="Choisir un livre"><div class="h"></div><h2 class="ct" style="margin:0">Choisir un livre</h2>
<button class="opt pri" data-b="cam"><span class="ico">${ic("cam",24)}</span><span><b>Photographier le livre</b><small>Code-barres au dos (le plus fiable), sinon la couverture</small></span></button>
<div class="row"><input id="bkQ" placeholder="Titre, auteur ou ISBN" enterkeyhint="search" aria-label="Rechercher un livre"><button class="btn pri" data-b="find" style="flex:none">Chercher</button></div>
<p class="mu" id="bkSt" style="margin:0;min-height:20px" role="status"></p>
<div id="bkL" class="stack" style="margin:0;gap:8px"></div>
<button class="btn gh" data-b="close">Fermer</button></div>`;
  document.body.append(d);
  let list=[];
  const st=m=>{d.querySelector("#bkSt").textContent=m||""};
  const draw=(items,head)=>{
    list=items;
    d.querySelector("#bkL").innerHTML=(head&&items.length?`<h3 class="sec" style="margin:4px 0 0">${esc(head)}</h3>`:"")+items.map((b,i)=>`<button class="opt" data-b="pick" data-i="${i}"><span><b>${esc(b.title)}</b><small>${esc([b.author,b.year].filter(Boolean).join(" · "))}</small></span></button>`).join("");
  };
  const pick=b=>{const id=bookSource(b);if(!id){st("Titre manquant.");return}d.remove();ocrSay=null;done(id,b)};
  draw(recent.map(s=>({title:s.title,author:s.author,year:s.year,isbn:s.isbn||"",subjects:[],_id:s.id})),"Déjà dans ta bibliothèque");
  const find=async()=>{
    const q=d.querySelector("#bkQ").value.trim();if(!q)return;
    st("Recherche…");
    try{
      const i=isbnOk(q),r=i?await lookupISBN(i):await searchBooks(q);
      const items=Array.isArray(r)?r:(r?[r]:[]);
      draw(items);st(items.length?"Touche le bon livre.":"Rien trouvé. Essaie avec moins de mots, ou le nom de l’auteur.");
    }catch(e){st(e instanceof TypeError?"Pas de connexion internet.":"Recherche impossible : "+e.message)}
  };
  const photo=async f=>{
    try{
      st("Lecture de la photo…");
      const bmp=await createImageBitmap(f),sc=Math.min(1,2400/Math.max(bmp.width,bmp.height));
      const cv=document.createElement("canvas");cv.width=Math.round(bmp.width*sc);cv.height=Math.round(bmp.height*sc);
      cv.getContext("2d").drawImage(bmp,0,0,cv.width,cv.height);if(bmp.close)bmp.close();
      const isbn=await detectISBN(cv);
      if(isbn){
        st("Code-barres lu (ISBN "+isbn+"), recherche du livre…");
        const b=await lookupISBN(isbn);
        if(b){pick(b);return}
        d.querySelector("#bkQ").value=isbn;draw([]);st("ISBN "+isbn+" absent de la base. Tape le titre ci-dessus, ou ferme et crée la source à la main.");return;
      }
      st("Pas de code-barres lu. Lecture de la couverture…");ocrSay=st;
      const q=await coverQuery(cv);ocrSay=null;
      if(!q){st("Rien de lisible. Reprends la photo (couverture bien éclairée) ou tape le titre.");return}
      d.querySelector("#bkQ").value=q;
      st("Recherche : « "+q+" »…");
      const items=await searchBooks(q);
      draw(items);st(items.length?"Couverture lue. Touche le bon livre (ou corrige la recherche).":"Couverture lue : « "+q+" ». Rien trouvé : corrige le texte et touche Chercher.");
    }catch(e){ocrSay=null;st(e instanceof TypeError?"Pas de connexion internet.":"Échec : "+e.message)}
  };
  d.onclick=e=>{
    if(e.target===d){d.remove();return}
    const b=e.target.closest("[data-b]");if(!b)return;
    const k=b.dataset.b;
    if(k==="close")d.remove();
    else if(k==="find")find();
    else if(k==="cam"){
      const i=document.createElement("input");i.type="file";i.accept="image/*";i.style.display="none";document.body.append(i);
      i.onchange=()=>{const f=i.files[0];i.remove();if(f)photo(f)};i.click();
    }else if(k==="pick"){
      const it=list[+b.dataset.i];if(!it)return;
      if(it._id){d.remove();ocrSay=null;done(it._id,it)}else pick(it);
    }
  };
  d.querySelector("#bkQ").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();find()}};
}
async function coverQuery(cv){
  const wk=await getOcr();
  await wk.setParameters({tessedit_pageseg_mode:"11"});
  let t="";
  try{
    const r=await wk.recognize(cv),d=r.data||{};
    t=d.text||"";
    if(!t&&d.blocks)t=d.blocks.flatMap(b=>b.paragraphs.flatMap(p=>p.lines.map(l=>l.words.map(w=>w.text).join(" ")))).join("\n");
  }finally{await wk.setParameters({tessedit_pageseg_mode:"3"})}
  return t.split(/\n+/).map(s=>s.replace(/[^\p{L}\p{N}' -]/gu," ").replace(/\s+/g," ").trim()).filter(s=>s.length>=3&&/\p{L}{3}/u.test(s)).slice(0,5).join(" ");
}
