// Parcours complet dans un vrai navigateur, sur un ecran de telephone :
// grille de bonus, transactions, caisse, rapport, export, sauvegarde.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");
const { creer } = require("../scripts/serve.js");

let serveur;
let navigateur;
let page;
let base;
const erreurs = [];

test.before(async () => {
  serveur = creer();
  await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${serveur.address().port}/`;
  navigateur = await chromium.launch();
  const ctx = await navigateur.newContext({ viewport: { width: 360, height: 780 }, acceptDownloads: true, locale: "fr-FR" });
  page = await ctx.newPage();
  page.on("pageerror", (e) => erreurs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text()); });
  page.on("dialog", (d) => d.accept());
  await page.goto(base);
  await page.waitForSelector("#bonusJour");
});

test.after(async () => {
  if (navigateur) await navigateur.close();
  if (serveur) serveur.close();
});

const bonusJour = () => page.textContent("#bonusJour");
const onglet = (nom) => page.click(`.onglets [data-vue="${nom}"]`);

async function pasDeDebordement(nom) {
  const l = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(l <= 360, `${nom} deborde horizontalement (${l}px)`);
}

// L'ecran est redessine APRES l'enregistrement : saisir avant le message
// de confirmation, c'est ecrire dans un champ qui va disparaitre.
async function enregistrerGrille() {
  await page.evaluate(() => { document.querySelector("#toast").textContent = ""; });
  await page.click("#enrGrille");
  await page.waitForFunction(() => document.querySelector("#toast").textContent === "Grille enregistrée");
}

async function nouvelleTx({ bouton, op, type, montant, bonusManuel }) {
  await page.click(`[data-nouveau="${bouton}"]`);
  await page.waitForSelector("#feuille[open]");
  if (op) await page.click(`#choixOp input[value="${op}"]`, { force: true });
  if (type) await page.click(`#choixType input[value="${type}"]`, { force: true });
  await page.fill("#txMontant", montant);
  if (bonusManuel !== undefined) {
    await page.check("#bonusManuel");
    await page.fill("#txBonus", bonusManuel);
  }
}

test("accueil vide : l'absence de grille est signalee, bonus a 0", async () => {
  assert.equal(await bonusJour(), "0 Ar");
  assert.match(await page.textContent("#vue"), /Bonus non configuré/);
  await pasDeDebordement("accueil");
});

test("grille MVola depot : deux tranches, verification d'un montant", async () => {
  await onglet("reglages");
  await page.click("#ajouterTranche");
  await page.fill('input[data-g="0"][data-champ="max"]', "10000");
  await page.fill('input[data-g="0"][data-champ="valeur"]', "100");
  await page.click("#ajouterTranche");
  assert.equal(await page.inputValue('input[data-g="1"][data-champ="min"]'), "10001");
  await page.selectOption('select[data-g="1"]', "pourcent");
  await page.fill('input[data-g="1"][data-champ="valeur"]', "1");
  await enregistrerGrille();
  await page.fill("#testMontant", "50000");
  assert.equal(await page.textContent("#testResultat"), "50 000 Ar → bonus 500 Ar");
  await page.fill("#testMontant", "8000");
  assert.equal(await page.textContent("#testResultat"), "8 000 Ar → bonus 100 Ar");
  await pasDeDebordement("reglages");
});

test("une grille qui se chevauche est refusee", async () => {
  await page.click("#ajouterTranche");
  await page.fill('input[data-g="2"][data-champ="min"]', "5000");
  await page.fill('input[data-g="2"][data-champ="max"]', "6000");
  await page.fill('input[data-g="2"][data-champ="valeur"]', "1");
  await page.click("#enrGrille");
  assert.match(await page.textContent("#grilleErreur"), /chevauchent/);
  await page.click('[data-suppr="2"]');
  await enregistrerGrille();
  assert.equal(await page.textContent("#grilleErreur"), "");
});

test("depot MVola : bonus calcule par la grille", async () => {
  await onglet("accueil");
  await nouvelleTx({ bouton: "depot", op: "mvola", montant: "50000" });
  assert.equal(await page.inputValue("#txMontant"), "50 000");
  assert.equal(await page.textContent("#bonusLigne"), "Bonus : 500 Ar");
  await page.click("#txEnregistrer");
  await page.waitForSelector("#feuille", { state: "hidden" });
  await page.waitForFunction(() => document.querySelector("#bonusJour").textContent === "500 Ar");
});

test("retrait Orange sans grille : signale, puis bonus saisi a la main", async () => {
  await page.click('[data-nouveau="retrait"]');
  await page.click('#choixOp input[value="orange"]', { force: true });
  await page.fill("#txMontant", "20000");
  assert.match(await page.textContent("#bonusLigne"), /Aucune tranche/);
  await page.check("#bonusManuel");
  await page.fill("#txBonus", "200");
  await page.click("#txEnregistrer");
  await page.waitForFunction(() => document.querySelector("#bonusJour").textContent === "700 Ar");
  assert.equal(await page.locator(".ligne-tx").count(), 2);
});

test("modifier une transaction recalcule le bonus", async () => {
  await page.locator(".ligne-tx", { hasText: "MVola" }).click();
  await page.waitForSelector("#feuille[open]");
  assert.equal(await page.textContent("#feuilleTitre"), "Modifier la transaction");
  await page.fill("#txMontant", "5000");
  assert.equal(await page.textContent("#bonusLigne"), "Bonus : 100 Ar");
  await page.click("#txEnregistrer");
  await page.waitForFunction(() => document.querySelector("#bonusJour").textContent === "300 Ar");
});

test("bouton retour du telephone : ferme la fiche sans quitter l'accueil", async () => {
  await page.click('[data-nouveau="depot"]');
  await page.waitForSelector("#feuille[open]");
  await page.goBack();
  await page.waitForSelector("#feuille", { state: "hidden" });
  assert.equal(await bonusJour(), "300 Ar");
});

test("caisse : soldes attendus et ecart a la cloture", async () => {
  await onglet("caisse");
  await page.fill('input[data-ouv="especes"]', "100000");
  await page.fill('input[data-ouv="mvola"]', "200000");
  await page.fill('input[data-ouv="orange"]', "50000");
  await page.click("#enrOuverture");
  await page.waitForFunction(() => /195 000 Ar/.test(document.querySelector("#vue").textContent));
  const texte = await page.textContent("#vue");
  // especes : 100 000 + 5 000 (depot) - 20 000 (retrait) = 85 000
  assert.match(texte, /Espèces \(billets\)100 000 Ar85 000 Ar/);
  assert.match(texte, /UV MVola200 000 Ar195 000 Ar/);
  assert.match(texte, /UV Orange Money50 000 Ar70 000 Ar/);
  await page.fill('input[data-clo="especes"]', "84000");
  assert.equal(await page.textContent('[data-ecart="especes"]'), "Manque 1 000 Ar");
  await page.fill('input[data-clo="mvola"]', "195000");
  assert.equal(await page.textContent('[data-ecart="mvola"]'), "Juste");
  await page.click("#enrCloture");
  await pasDeDebordement("caisse");
});

test("les donnees survivent a un rechargement", async () => {
  await page.reload();
  await page.waitForSelector("#bonusJour");
  assert.equal(await bonusJour(), "300 Ar");
  assert.equal(await page.locator(".ligne-tx").count(), 2);
});

test("rapport du jour et export Excel", async () => {
  await onglet("rapports");
  await page.waitForSelector("#bonusPeriode");
  assert.equal(await page.textContent("#bonusPeriode"), "300 Ar");
  await pasDeDebordement("rapports");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#exporterCsv")]);
  assert.match(dl.suggestedFilename(), /^cashpoint_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
  const contenu = fs.readFileSync(await dl.path(), "utf8");
  assert.ok(contenu.startsWith("﻿Date;Heure;Opérateur"));
  assert.match(contenu, /;MVola;Dépôt;5000;100;/);
  assert.match(contenu, /;Orange Money;Retrait;20000;200;/);
  for (const p of ["7j", "mois", "moisDernier", "perso"]) {
    await page.click(`[data-periode="${p}"]`);
    await page.waitForSelector(`[data-periode="${p}"][aria-pressed="true"]`);
  }
  await pasDeDebordement("rapports (periode choisie)");
});

test("sauvegarde, effacement puis restauration", async () => {
  await onglet("reglages");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-action="sauvegarder"]')]);
  const fichier = path.join(os.tmpdir(), "cashpoint-test-" + Date.now() + ".json");
  await dl.saveAs(fichier);
  const sauvegarde = JSON.parse(fs.readFileSync(fichier, "utf8"));
  assert.equal(sauvegarde.application, "cashpoint-mora");
  assert.equal(sauvegarde.transactions.length, 2);

  await page.click("#toutEffacer");
  await onglet("accueil");
  await page.waitForFunction(() => document.querySelector("#bonusJour").textContent === "0 Ar");

  await onglet("reglages");
  await page.setInputFiles("#fichierRestauration", fichier);
  await page.waitForFunction(() => /Sauvegarde restaurée/.test(document.querySelector("#toast").textContent));
  await onglet("accueil");
  await page.waitForFunction(() => document.querySelector("#bonusJour").textContent === "300 Ar");
  fs.unlinkSync(fichier);
});

test("aucune erreur dans la console", () => {
  assert.deepEqual(erreurs, []);
});
