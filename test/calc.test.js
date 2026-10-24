// Les calculs d'argent, verifies sans ecran : npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../www/calc.js");

const grilles = {
  "mvola:depot": [
    { min: 100, max: 10000, mode: "fixe", valeur: 50 },
    { min: 10001, max: 100000, mode: "fixe", valeur: 300 },
    { min: 100001, max: "", mode: "pourcent", valeur: 0.5 },
  ],
};

test("bonus fixe selon la tranche, bornes incluses", () => {
  assert.deepEqual(C.bonus(grilles, "mvola", "depot", 100), { bonus: 50, trouve: true });
  assert.deepEqual(C.bonus(grilles, "mvola", "depot", 10000), { bonus: 50, trouve: true });
  assert.deepEqual(C.bonus(grilles, "mvola", "depot", 10001), { bonus: 300, trouve: true });
  assert.deepEqual(C.bonus(grilles, "mvola", "depot", 100000), { bonus: 300, trouve: true });
});

test("bonus en pourcentage, arrondi a l'Ariary, sans limite haute", () => {
  assert.deepEqual(C.bonus(grilles, "mvola", "depot", 100001), { bonus: 500, trouve: true });
  assert.deepEqual(C.bonus(grilles, "mvola", "depot", 2500000), { bonus: 12500, trouve: true });
  assert.deepEqual(C.bonus(grilles, "mvola", "depot", 150333), { bonus: 752, trouve: true });
});

test("hors grille : 0 mais signale, jamais un faux resultat", () => {
  assert.deepEqual(C.bonus(grilles, "mvola", "depot", 50), { bonus: 0, trouve: false });
  assert.deepEqual(C.bonus(grilles, "mvola", "retrait", 5000), { bonus: 0, trouve: false });
  assert.deepEqual(C.bonus({}, "orange", "depot", 5000), { bonus: 0, trouve: false });
});

test("grille : chevauchement, inversion et valeurs invalides detectes", () => {
  assert.deepEqual(C.erreursGrille(grilles["mvola:depot"]), []);
  const chevauche = C.erreursGrille([
    { min: 0, max: 5000, mode: "fixe", valeur: 10 },
    { min: 5000, max: 9000, mode: "fixe", valeur: 20 },
  ]);
  assert.equal(chevauche.length, 1);
  assert.match(chevauche[0], /chevauchent/);
  assert.match(C.erreursGrille([{ min: 9000, max: 100, mode: "fixe", valeur: 1 }])[0], /plus petit/);
  assert.match(C.erreursGrille([{ min: 0, max: "", mode: "pourcent", valeur: 150 }])[0], /100/);
  assert.match(C.erreursGrille([{ min: "", max: "", mode: "fixe", valeur: 5 }])[0], /minimum/);
  assert.match(C.erreursGrille([{ min: 0, max: "", mode: "fixe", valeur: "" }])[0], /bonus/);
  // Deux tranches « sans limite » se chevauchent forcement.
  assert.equal(C.erreursGrille([
    { min: 0, max: "", mode: "fixe", valeur: 1 },
    { min: 500, max: "", mode: "fixe", valeur: 2 },
  ]).length, 1);
});

test("soldes : un depot ajoute des billets et retire de l'UV, un retrait l'inverse", () => {
  const s = C.soldes({ especes: 100000, mvola: 200000, orange: 50000 }, [
    { op: "mvola", type: "depot", montant: 30000 },
    { op: "orange", type: "retrait", montant: 20000 },
    { op: "mvola", type: "credit", montant: 1000 },
    { op: "mvola", type: "facture", montant: 15000 },
    { op: "airtel", type: "transfert", montant: 5000 },
  ]);
  assert.equal(s.especes, 100000 + 30000 - 20000 + 1000 + 15000 + 5000);
  assert.equal(s.mvola, 200000 - 30000 - 1000 - 15000);
  assert.equal(s.orange, 50000 + 20000);
  assert.equal(s.airtel, -5000);
});

test("soldes sans ouverture : partent de 0", () => {
  const s = C.soldes(null, [{ op: "mvola", type: "retrait", montant: 7000 }]);
  assert.equal(s.especes, -7000);
  assert.equal(s.mvola, 7000);
});

test("resume : totaux par type, operateur et jour", () => {
  const r = C.resume([
    { jour: "2026-10-24", op: "mvola", type: "depot", montant: 50000, bonus: 300 },
    { jour: "2026-10-24", op: "orange", type: "retrait", montant: 20000, bonus: 150 },
    { jour: "2026-10-23", op: "mvola", type: "depot", montant: 8000, bonus: 50 },
  ]);
  assert.equal(r.nombre, 3);
  assert.equal(r.bonus, 500);
  assert.deepEqual(r.parType.depot, { nombre: 2, montant: 58000, bonus: 350 });
  assert.deepEqual(r.parType.retrait, { nombre: 1, montant: 20000, bonus: 150 });
  assert.deepEqual(r.parOperateur.mvola, { nombre: 2, montant: 58000, bonus: 350 });
  assert.deepEqual(r.parOperateur.airtel, { nombre: 0, montant: 0, bonus: 0 });
  assert.deepEqual(r.parJour["2026-10-24"], { nombre: 2, bonus: 450 });
});

test("jour local et decalage de jour, y compris changement de mois et d'annee", () => {
  assert.equal(C.jourDe(new Date(2026, 0, 5, 1, 30)), "2026-01-05");
  assert.equal(C.decalerJour("2026-03-01", -1), "2026-02-28");
  assert.equal(C.decalerJour("2024-03-01", -1), "2024-02-29");
  assert.equal(C.decalerJour("2026-12-31", 1), "2027-01-01");
});

test("format Ariary", () => {
  assert.equal(C.ariary(0), "0 Ar");
  assert.equal(C.ariary(1250000), "1 250 000 Ar");
  assert.equal(C.ariary(-3500), "-3 500 Ar");
  assert.equal(C.ariary(undefined), "0 Ar");
});

test("CSV pour Excel : BOM, point-virgule, champs proteges", () => {
  const csv = C.csv([{
    ts: new Date(2026, 9, 24, 9, 5).getTime(),
    jour: "2026-10-24",
    op: "mvola",
    type: "depot",
    montant: 50000,
    bonus: 300,
    numero: "+261 34 00 000 00",
    reference: "REF;1",
    note: '=HYPERLINK("x")',
  }]);
  assert.ok(csv.startsWith("﻿Date;Heure;Opérateur;Type;Montant (Ar);Bonus (Ar)"));
  const ligne = csv.split("\r\n")[1];
  assert.ok(ligne.startsWith("2026-10-24;09:05;MVola;Dépôt;50000;300;"));
  assert.ok(ligne.includes(";'+261 34 00 000 00;"), "un numero en +261 ne doit pas devenir une formule");
  assert.ok(ligne.includes(';"REF;1";'), "un point-virgule dans un champ ne doit pas decaler les colonnes");
  assert.ok(ligne.endsWith(';"\'=HYPERLINK(""x"")"'), "une note ne doit jamais etre executee comme formule");
});
