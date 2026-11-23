const C="memo-v12",F=["./","./index.html","./photo.js","./book.js","./vision.js","./manifest.json","./ic192.png","./ic512.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(F)));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))));self.clients.claim()});
// partage Android (images, texte, lien) : reçu en POST, mis de côté, puis l'app s'ouvre et le reprend
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(e.request.method==="POST"&&u.origin===location.origin&&u.searchParams.has("share-target")){
    e.respondWith((async()=>{
      try{
        const f=await e.request.formData(),fs=f.getAll("img").filter(x=>x&&x.size),c=await caches.open("memo-share");
        await Promise.all((await c.keys()).map(k=>c.delete(k)));
        for(let i=0;i<fs.length;i++)await c.put("./__share/"+i,new Response(fs[i],{headers:{"Content-Type":fs[i].type||"image/jpeg"}}));
        await c.put("./__share/meta",new Response(JSON.stringify({title:f.get("title")||"",text:f.get("text")||"",url:f.get("url")||"",n:fs.length,names:fs.map(x=>x.name||""),at:Date.now()}),{headers:{"Content-Type":"application/json"}}));
      }catch(err){}
      return Response.redirect("./index.html?shared=1",303);
    })());
    return;
  }
  if(e.request.method!=="GET"||new URL(e.request.url).origin!==location.origin)return;
  e.respondWith(fetch(e.request.url,{cache:"no-cache"}).then(r=>{const c=r.clone();caches.open(C).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request,{ignoreSearch:true})));
});
