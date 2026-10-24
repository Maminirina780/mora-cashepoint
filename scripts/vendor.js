// Copie dans www/vendor/ les scripts Capacitor dont l'APK a besoin pour
// enregistrer et partager un fichier (export Excel, sauvegarde).
//
// Le site n'a pas d'etape de construction : ces fichiers sont donc les
// versions « navigateur » fournies par les paquets, recopiees telles quelles.
// Sur le web et sur Windows ils se chargent sans rien faire.
const fs = require("fs");
const path = require("path");

const racine = path.join(__dirname, "..");
const nm = (p) => path.join(racine, "node_modules", p);
const dest = path.join(racine, "www", "vendor");
fs.mkdirSync(dest, { recursive: true });

function lire(p) {
  return fs.readFileSync(nm(p), "utf8").replace(/\n\/\/# sourceMappingURL=.*$/m, "");
}

fs.writeFileSync(path.join(dest, "capacitor.js"), lire("@capacitor/core/dist/capacitor.js"));

// Le plugin Filesystem attend une variable globale « synapse », que le
// paquet publie sous le nom « outsystemsSynapse ».
fs.writeFileSync(
  path.join(dest, "filesystem.js"),
  lire("@capacitor/synapse/dist/synapse.js") +
    "\nvar synapse = (typeof globalThis !== 'undefined' ? globalThis : window).outsystemsSynapse;\n" +
    lire("@capacitor/filesystem/dist/plugin.js")
);

fs.writeFileSync(path.join(dest, "share.js"), lire("@capacitor/share/dist/plugin.js"));

for (const f of fs.readdirSync(dest)) {
  console.log("vendor/" + f, fs.statSync(path.join(dest, f)).size, "octets");
}
