// Le site doit s'ouvrir sans reseau : un cash point note ses transactions
// meme quand la connexion tombe. On sert la copie locale tout de suite et on
// la rafraichit en arriere-plan ; la nouvelle version s'affiche au prochain
// lancement.
const CACHE = "cashpoint-1.0.0";
const FICHIERS = [
  "./", "index.html", "style.css", "calc.js", "store.js", "app.js",
  "vendor/capacitor.js", "vendor/filesystem.js", "vendor/share.js",
  "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "icon-maskable-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req, { ignoreSearch: true }).then((enCache) => {
        const reseau = fetch(req)
          .then((rep) => {
            if (rep.ok) cache.put(req, rep.clone());
            return rep;
          })
          .catch(() => enCache);
        if (enCache) e.waitUntil(reseau);
        return enCache || reseau;
      })
    )
  );
});
