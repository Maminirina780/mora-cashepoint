/*
 * Calculs du Cash Point : bonus, soldes de caisse, totaux.
 *
 * Aucune dependance au navigateur ni a la base : ce fichier est charge tel
 * quel par la page ET par les tests Node. Un calcul de bonus faux coute de
 * l'argent au client sans que rien ne le signale ; il doit donc pouvoir etre
 * verifie seul, sans ecran.
 */
(function (racine) {
  "use strict";

  var OPERATEURS = [
    { id: "mvola", nom: "MVola", couleur: "#f5b800" },
    { id: "orange", nom: "Orange Money", couleur: "#ff7900" },
    { id: "airtel", nom: "Airtel Money", couleur: "#e40000" },
  ];

  // sens : effet sur l'ARGENT LIQUIDE de la caisse. Le solde electronique
  // de l'operateur bouge toujours dans l'autre sens, du meme montant.
  //   depot    : le client donne des billets, l'agent envoie de l'UV  -> +1
  //   retrait  : l'agent donne des billets, le client envoie de l'UV  -> -1
  var TYPES = [
    { id: "depot", nom: "Dépôt", mg: "Mandefa vola", sens: 1 },
    { id: "retrait", nom: "Retrait", mg: "Maka vola", sens: -1 },
    { id: "transfert", nom: "Transfert", mg: "Mandefa any amin'olona", sens: 1 },
    { id: "credit", nom: "Crédit", mg: "Varotra crédit", sens: 1 },
    { id: "facture", nom: "Facture", mg: "Fandoavana faktiora", sens: 1 },
  ];

  function type(id) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i];
    return null;
  }

  function operateur(id) {
    for (var i = 0; i < OPERATEURS.length; i++) if (OPERATEURS[i].id === id) return OPERATEURS[i];
    return null;
  }

  function cleGrille(op, typ) {
    return op + ":" + typ;
  }

  // Une tranche : { min, max, mode: "fixe" | "pourcent", valeur }.
  // max vide = sans limite. Les bornes sont INCLUSES des deux cotes, comme
  // dans les grilles des operateurs (« de 1 000 a 5 000 Ar »).
  function trancheDe(grille, montant) {
    if (!grille || !grille.length) return null;
    for (var i = 0; i < grille.length; i++) {
      var t = grille[i];
      var min = Number(t.min) || 0;
      var max = t.max === "" || t.max === null || t.max === undefined ? Infinity : Number(t.max);
      if (montant >= min && montant <= max) return t;
    }
    return null;
  }

  // Renvoie { bonus, trouve }. trouve = false quand aucune tranche ne couvre
  // le montant : l'ecran le dit au lieu d'afficher un 0 qui passerait pour
  // un vrai resultat.
  function bonus(grilles, op, typ, montant) {
    montant = Number(montant) || 0;
    var t = trancheDe(grilles && grilles[cleGrille(op, typ)], montant);
    if (!t) return { bonus: 0, trouve: false };
    var v = Number(t.valeur) || 0;
    var b = t.mode === "pourcent" ? Math.round((montant * v) / 100) : Math.round(v);
    return { bonus: b, trouve: true };
  }

  // Les tranches qui se chevauchent ou qui sont inversees donnent un bonus
  // qui depend de l'ordre de saisie : on les signale a l'enregistrement.
  function erreursGrille(grille) {
    var erreurs = [];
    var bornes = [];
    (grille || []).forEach(function (t, i) {
      var n = i + 1;
      var min = Number(t.min);
      var max = t.max === "" || t.max === null || t.max === undefined ? Infinity : Number(t.max);
      if (t.min === "" || isNaN(min) || min < 0) erreurs.push("Ligne " + n + " : minimum invalide.");
      else if (isNaN(max)) erreurs.push("Ligne " + n + " : maximum invalide.");
      else if (max < min) erreurs.push("Ligne " + n + " : le maximum est plus petit que le minimum.");
      else bornes.push({ n: n, min: min, max: max });
      var v = Number(t.valeur);
      if (t.valeur === "" || isNaN(v) || v < 0) erreurs.push("Ligne " + n + " : bonus invalide.");
      else if (t.mode === "pourcent" && v > 100) erreurs.push("Ligne " + n + " : pourcentage supérieur à 100.");
    });
    bornes.sort(function (a, b) { return a.min - b.min; });
    for (var i = 1; i < bornes.length; i++) {
      if (bornes[i].min <= bornes[i - 1].max) {
        erreurs.push("Lignes " + bornes[i - 1].n + " et " + bornes[i].n + " : les tranches se chevauchent.");
      }
    }
    return erreurs;
  }

  // Soldes theoriques a partir de l'ouverture et des transactions du jour.
  // ouverture : { especes, mvola, orange, airtel } (valeurs absentes = 0).
  function soldes(ouverture, transactions) {
    var s = { especes: Number((ouverture || {}).especes) || 0 };
    OPERATEURS.forEach(function (o) { s[o.id] = Number((ouverture || {})[o.id]) || 0; });
    (transactions || []).forEach(function (tx) {
      var t = type(tx.type);
      if (!t || !(tx.op in s)) return;
      var m = Number(tx.montant) || 0;
      s.especes += t.sens * m;
      s[tx.op] -= t.sens * m;
    });
    return s;
  }

  function resume(transactions) {
    var r = { nombre: 0, bonus: 0, parType: {}, parOperateur: {}, parJour: {} };
    TYPES.forEach(function (t) { r.parType[t.id] = { nombre: 0, montant: 0, bonus: 0 }; });
    OPERATEURS.forEach(function (o) { r.parOperateur[o.id] = { nombre: 0, montant: 0, bonus: 0 }; });
    (transactions || []).forEach(function (tx) {
      var m = Number(tx.montant) || 0;
      var b = Number(tx.bonus) || 0;
      r.nombre++;
      r.bonus += b;
      if (r.parType[tx.type]) {
        r.parType[tx.type].nombre++;
        r.parType[tx.type].montant += m;
        r.parType[tx.type].bonus += b;
      }
      if (r.parOperateur[tx.op]) {
        r.parOperateur[tx.op].nombre++;
        r.parOperateur[tx.op].montant += m;
        r.parOperateur[tx.op].bonus += b;
      }
      var j = r.parJour[tx.jour] || (r.parJour[tx.jour] = { nombre: 0, bonus: 0 });
      j.nombre++;
      j.bonus += b;
    });
    return r;
  }

  function deuxChiffres(n) {
    return (n < 10 ? "0" : "") + n;
  }

  // Jour LOCAL (AAAA-MM-JJ). toISOString donnerait le jour UTC : a
  // Madagascar (UTC+3), une transaction de 1 h du matin tomberait la veille.
  function jourDe(date) {
    var d = date instanceof Date ? date : new Date(date);
    return d.getFullYear() + "-" + deuxChiffres(d.getMonth() + 1) + "-" + deuxChiffres(d.getDate());
  }

  function decalerJour(jour, n) {
    var p = jour.split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n);
    return jourDe(d);
  }

  function ariary(n) {
    var v = Math.round(Number(n) || 0);
    var signe = v < 0 ? "-" : "";
    var s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return signe + s + " Ar";
  }

  // Excel en francais attend le point-virgule ; le BOM lui fait lire les
  // accents correctement au lieu d'afficher « DÃ©pÃ´t ».
  function csv(transactions) {
    var entete = ["Date", "Heure", "Opérateur", "Type", "Montant (Ar)", "Bonus (Ar)", "Numéro", "Référence", "Note"];
    function champ(v) {
      var s = v === undefined || v === null ? "" : String(v);
      // Une cellule qui commence par = + - @ est executee comme formule par
      // Excel : une note saisie par un tiers ne doit pas devenir un calcul.
      // A faire AVANT les guillemets, sinon « ="x" » echappe au controle.
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    var lignes = [entete.join(";")];
    (transactions || []).forEach(function (tx) {
      var d = new Date(tx.ts);
      var o = operateur(tx.op);
      var t = type(tx.type);
      lignes.push([
        tx.jour,
        deuxChiffres(d.getHours()) + ":" + deuxChiffres(d.getMinutes()),
        o ? o.nom : tx.op,
        t ? t.nom : tx.type,
        Math.round(Number(tx.montant) || 0),
        Math.round(Number(tx.bonus) || 0),
        tx.numero,
        tx.reference,
        tx.note,
      ].map(champ).join(";"));
    });
    return "﻿" + lignes.join("\r\n") + "\r\n";
  }

  var Calc = {
    OPERATEURS: OPERATEURS,
    TYPES: TYPES,
    type: type,
    operateur: operateur,
    cleGrille: cleGrille,
    bonus: bonus,
    erreursGrille: erreursGrille,
    soldes: soldes,
    resume: resume,
    jourDe: jourDe,
    decalerJour: decalerJour,
    ariary: ariary,
    csv: csv,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Calc;
  else racine.Calc = Calc;
})(this);
