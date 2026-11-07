const CACHE='reelrank-pwa-v12-top10-amc-ratings';
const SHELL=['./','./index.html','./manifest.webmanifest','./icon.svg','./icon-180.png','./letterboxd-integration.js', './reelrank-ties-and-posters.js', './reelrank-smooth-drag.js', './reelrank-top10-postshow.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin)return;
e.respondWith(fetch(e.request).then(response=>{if(response.ok){const c=response.clone();caches.open(CACHE).then(cache=>cache.put(e.request,c)).catch(()=>{});}return response}).catch(()=>caches.match(e.request).then(v=>v||caches.match('./index.html'))))});