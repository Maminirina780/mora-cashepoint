/*
 * Stockage local (IndexedDB). Les donnees restent sur l'appareil : pas de
 * compte, pas de serveur, et le cash point continue de tourner quand le
 * reseau tombe — c'est justement la que les transactions s'accumulent.
 *
 * Contrepartie : desinstaller l'application efface tout. La sauvegarde
 * (exporter / importer) existe pour ca.
 */
(function (racine) {
  "use strict";

  var NOM = "cashpoint-mora";
  var VERSION = 1;
  var dbPromise = null;

  function ouvrir() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resoudre, rejeter) {
      var req = indexedDB.open(NOM, VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains("tx")) {
          var tx = db.createObjectStore("tx", { keyPath: "id" });
          tx.createIndex("jour", "jour");
        }
        if (!db.objectStoreNames.contains("jours")) db.createObjectStore("jours", { keyPath: "jour" });
        if (!db.objectStoreNames.contains("reglages")) db.createObjectStore("reglages", { keyPath: "cle" });
      };
      req.onsuccess = function () { resoudre(req.result); };
      req.onerror = function () { rejeter(req.error); };
    });
    // Demande au systeme de ne pas vider cette base quand l'espace manque.
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    return dbPromise;
  }

  function requete(magasins, mode, travail) {
    return ouvrir().then(function (db) {
      return new Promise(function (resoudre, rejeter) {
        var t = db.transaction(magasins, mode);
        var resultat;
        t.oncomplete = function () { resoudre(resultat); };
        t.onerror = function () { rejeter(t.error); };
        t.onabort = function () { rejeter(t.error || new Error("Opération annulée")); };
        resultat = travail(t);
        if (resultat && typeof resultat.onsuccess !== "undefined") {
          var r = resultat;
          r.onsuccess = function () { resultat = r.result; };
        }
      });
    });
  }

  function tout(req) {
    return new Promise(function (resoudre, rejeter) {
      req.onsuccess = function () { resoudre(req.result); };
      req.onerror = function () { rejeter(req.error); };
    });
  }

  var REGLAGES_DEFAUT = {
    cle: "reglages",
    nomBoutique: "Mon Cash Point",
    operateurs: { mvola: true, orange: true, airtel: true },
    grilles: {},
  };

  var Store = {
    lireReglages: function () {
      return requete(["reglages"], "readonly", function (t) {
        return t.objectStore("reglages").get("reglages");
      }).then(function (r) {
        var base = JSON.parse(JSON.stringify(REGLAGES_DEFAUT));
        if (!r) return base;
        base.nomBoutique = r.nomBoutique || base.nomBoutique;
        base.operateurs = Object.assign(base.operateurs, r.operateurs || {});
        base.grilles = r.grilles || {};
        base.derniereSauvegarde = r.derniereSauvegarde || null;
        return base;
      });
    },

    ecrireReglages: function (reglages) {
      var r = Object.assign({}, reglages, { cle: "reglages" });
      return requete(["reglages"], "readwrite", function (t) { t.objectStore("reglages").put(r); });
    },

    enregistrerTx: function (tx) {
      return requete(["tx"], "readwrite", function (t) { t.objectStore("tx").put(tx); });
    },

    supprimerTx: function (id) {
      return requete(["tx"], "readwrite", function (t) { t.objectStore("tx").delete(id); });
    },

    // Transactions de du a au (inclus), triees de la plus recente a la plus
    // ancienne.
    txEntre: function (du, au) {
      return ouvrir().then(function (db) {
        var idx = db.transaction("tx", "readonly").objectStore("tx").index("jour");
        return tout(idx.getAll(IDBKeyRange.bound(du, au)));
      }).then(function (liste) {
        return liste.sort(function (a, b) { return b.ts - a.ts; });
      });
    },

    compterTx: function () {
      return ouvrir().then(function (db) {
        return tout(db.transaction("tx", "readonly").objectStore("tx").count());
      });
    },

    lireJour: function (jour) {
      return ouvrir().then(function (db) {
        return tout(db.transaction("jours", "readonly").objectStore("jours").get(jour));
      }).then(function (j) {
        return j || { jour: jour, ouverture: null, cloture: null };
      });
    },

    ecrireJour: function (j) {
      return requete(["jours"], "readwrite", function (t) { t.objectStore("jours").put(j); });
    },

    // Le dernier jour ou une cloture a ete saisie avant `jour` : ses montants
    // comptes servent de proposition d'ouverture le lendemain.
    derniereCloture: function (jour) {
      return ouvrir().then(function (db) {
        return tout(db.transaction("jours", "readonly").objectStore("jours").getAll(IDBKeyRange.upperBound(jour, true)));
      }).then(function (jours) {
        for (var i = jours.length - 1; i >= 0; i--) if (jours[i].cloture) return jours[i];
        return null;
      });
    },

    exporter: function () {
      return ouvrir().then(function (db) {
        var t = db.transaction(["tx", "jours", "reglages"], "readonly");
        return Promise.all([
          tout(t.objectStore("tx").getAll()),
          tout(t.objectStore("jours").getAll()),
          tout(t.objectStore("reglages").getAll()),
        ]);
      }).then(function (r) {
        return {
          application: "cashpoint-mora",
          format: 1,
          exporteLe: new Date().toISOString(),
          transactions: r[0],
          jours: r[1],
          reglages: r[2],
        };
      });
    },

    // Remplace TOUT par le contenu de la sauvegarde, en une seule
    // transaction : un fichier abime ne doit pas laisser une base a moitie
    // effacee.
    importer: function (donnees) {
      if (!donnees || donnees.application !== "cashpoint-mora" || !Array.isArray(donnees.transactions)) {
        return Promise.reject(new Error("Ce fichier n'est pas une sauvegarde Cash Point Mora."));
      }
      return requete(["tx", "jours", "reglages"], "readwrite", function (t) {
        ["tx", "jours", "reglages"].forEach(function (m) { t.objectStore(m).clear(); });
        donnees.transactions.forEach(function (x) { if (x && x.id && x.jour) t.objectStore("tx").put(x); });
        (donnees.jours || []).forEach(function (x) { if (x && x.jour) t.objectStore("jours").put(x); });
        (donnees.reglages || []).forEach(function (x) { if (x && x.cle) t.objectStore("reglages").put(x); });
      });
    },

    toutEffacer: function () {
      return requete(["tx", "jours", "reglages"], "readwrite", function (t) {
        ["tx", "jours", "reglages"].forEach(function (m) { t.objectStore(m).clear(); });
      });
    },
  };

  racine.Store = Store;
})(this);
