// Fabrique les icones PNG (site, Android, Windows) a partir de www/icon.svg.
// A relancer seulement si le logo change : les PNG sont versionnes.
//   node scripts/icones.js
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const racine = path.join(__dirname, "..");
const svg = fs.readFileSync(path.join(racine, "www", "icon.svg"), "utf8");
const FOND = "#0f2a4a";

// echelle : part de l'image occupee par le dessin. L'icone adaptative
// d'Android rogne les bords (zone sure = 66 %) : le dessin y est reduit.
async function rendre(page, taille, fichier, { echelle = 1, fond = "transparent", sansCadre = false } = {}) {
  let contenu = svg;
  if (sansCadre) contenu = contenu.replace(/<rect[^>]*\/>/, "");
  const d = Math.round(taille * echelle);
  await page.setViewportSize({ width: taille, height: taille });
  await page.setContent(`<html><body style="margin:0;background:${fond};display:grid;place-items:center;width:${taille}px;height:${taille}px">
    <div style="width:${d}px;height:${d}px">${contenu.replace("<svg ", `<svg width="${d}" height="${d}" `)}</div></body></html>`);
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  await page.screenshot({ path: fichier, omitBackground: fond === "transparent" });
  console.log(path.relative(racine, fichier), taille + "px");
}

(async () => {
  const navigateur = await chromium.launch();
  const page = await navigateur.newPage();

  await rendre(page, 192, path.join(racine, "www", "icon-192.png"));
  await rendre(page, 512, path.join(racine, "www", "icon-512.png"));
  await rendre(page, 512, path.join(racine, "www", "icon-maskable-512.png"), { echelle: 0.8, fond: FOND, sansCadre: true });
  await rendre(page, 512, path.join(racine, "desktop", "build", "icon.png"));

  const res = path.join(racine, "android", "app", "src", "main", "res");
  if (fs.existsSync(res)) {
    const densites = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
    for (const [nom, k] of Object.entries(densites)) {
      const dossier = path.join(res, "mipmap-" + nom);
      await rendre(page, 48 * k, path.join(dossier, "ic_launcher.png"));
      await rendre(page, 48 * k, path.join(dossier, "ic_launcher_round.png"));
      await rendre(page, 108 * k, path.join(dossier, "ic_launcher_foreground.png"), { echelle: 0.62, sansCadre: true });
    }
    // Ecran de demarrage : on garde les dimensions de chaque image d'origine.
    for (const dossier of fs.readdirSync(res).filter((d) => d.startsWith("drawable"))) {
      const f = path.join(res, dossier, "splash.png");
      if (!fs.existsSync(f)) continue;
      const tete = fs.readFileSync(f);
      const l = tete.readUInt32BE(16);
      const h = tete.readUInt32BE(20);
      const cote = Math.round(Math.min(l, h) * 0.35);
      await page.setViewportSize({ width: l, height: h });
      await page.setContent(`<html><body style="margin:0;background:${FOND};display:grid;place-items:center;width:${l}px;height:${h}px">
        <div style="width:${cote}px;height:${cote}px">${svg.replace("<svg ", `<svg width="${cote}" height="${cote}" `)}</div></body></html>`);
      await page.screenshot({ path: f });
      console.log(path.relative(racine, f), `${l}x${h}`);
    }
    const fondXml = path.join(res, "values", "ic_launcher_background.xml");
    if (fs.existsSync(fondXml)) {
      fs.writeFileSync(fondXml, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${FOND}</color>\n</resources>\n`);
    }
  }
  await navigateur.close();
})();
