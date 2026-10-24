// Petit serveur statique pour essayer le site en local et pour les tests :
//   node scripts/serve.js [port]
const http = require("http");
const fs = require("fs");
const path = require("path");

const RACINE = path.join(__dirname, "..", "www");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

function creer() {
  return http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const fichier = path.join(RACINE, path.normalize(p));
    if (!fichier.startsWith(RACINE)) { res.writeHead(403); res.end(); return; }
    fs.readFile(fichier, (err, data) => {
      if (err) { res.writeHead(404); res.end("introuvable"); return; }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(fichier)] || "application/octet-stream" });
      res.end(data);
    });
  });
}

module.exports = { creer };

if (require.main === module) {
  const port = Number(process.argv[2]) || 8080;
  creer().listen(port, () => console.log(`Cash Point Mora : http://localhost:${port}`));
}
