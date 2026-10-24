/*
 * Ecrans du Cash Point. La logique de calcul vit dans calc.js, le stockage
 * dans store.js : ce fichier ne fait que relier les deux a l'ecran.
 */
(function () {
  "use strict";

  const C = window.Calc;
  const S = window.Store;
  const VERSION = "1.0.0";
  // Au-dela, un rappel de sauvegarde s'affiche sur l'accueil : sur un
  // telephone, une desinstallation ou une panne efface tout.
  const JOURS_AVANT_RAPPEL = 7;

  const etat = {
    vue: "accueil",
    reglages: null,
    jourCaisse: null,
    periode: "aujourdhui",
    persoDu: null,
    persoAu: null,
    grilleOp: "mvola",
    grilleType: "depot",
    grilleBrouillon: [],
    grilleModifiee: false,
    txEdite: null,
  };

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const vue = $("#vue");
  const feuille = $("#feuille");

  function esc(s) {
    return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  const ar = C.ariary;
  const aujourdhui = () => C.jourDe(new Date());

  // « 12 500 » -> 12500. Tout ce qui n'est pas un chiffre est ignore : le
  // clavier numerique de certains telephones envoie des espaces ou des points.
  function lireMontant(v) {
    const d = String(v || "").replace(/\D/g, "");
    return d ? Number(d) : 0;
  }

  function formaterSaisie(input) {
    const d = input.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    input.value = d ? d.replace(/\B(?=(\d{3})+(?!\d))/g, " ") : "";
  }

  function jourLisible(jour, long) {
    const p = jour.split("-");
    const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return d.toLocaleDateString("fr-FR", long
      ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
      : { weekday: "short", day: "numeric", month: "short" });
  }

  function heure(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function lireLocal(cle) {
    try { return localStorage.getItem(cle); } catch (e) { return null; }
  }
  function ecrireLocal(cle, v) {
    try { localStorage.setItem(cle, v); } catch (e) { /* stockage indisponible : simple confort perdu */ }
  }

  let minuteurToast = null;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("visible");
    clearTimeout(minuteurToast);
    minuteurToast = setTimeout(() => t.classList.remove("visible"), 2600);
  }

  function opsActifs() {
    return C.OPERATEURS.filter((o) => etat.reglages.operateurs[o.id]);
  }

  function grilleVide(op) {
    return !C.TYPES.some((t) => (etat.reglages.grilles[C.cleGrille(op, t.id)] || []).length);
  }

  function natif() {
    const cap = window.capacitorExports && window.capacitorExports.Capacitor;
    return !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  }

  // Sur Android, un lien de telechargement ne fait rien dans l'application :
  // le fichier est ecrit puis confie au menu « Partager » (WhatsApp, Drive,
  // Gmail...). Ailleurs, un telechargement classique.
  async function enregistrerFichier(nom, contenu, type) {
    if (natif() && window.capacitorFilesystemPluginCapacitor && window.capacitorShare) {
      const F = window.capacitorFilesystemPluginCapacitor;
      const r = await F.Filesystem.writeFile({
        path: nom,
        data: contenu,
        directory: F.Directory.Cache,
        encoding: F.Encoding.UTF8,
      });
      try {
        await window.capacitorShare.Share.share({ title: nom, files: [r.uri], dialogTitle: "Enregistrer ou envoyer" });
      } catch (e) {
        if (/cancel/i.test(String(e && e.message))) return false;
        throw e;
      }
      return true;
    }
    const url = URL.createObjectURL(new Blob([contenu], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = nom;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  }

  /* ---------- Navigation ----------
   * Le bouton retour d'Android remonte l'historique du navigateur. On n'y
   * garde que deux niveaux — l'accueil, puis l'onglet ou la fiche ouverte —
   * pour que « retour » ferme la fiche, puis ramene a l'accueil, puis
   * quitte : jamais une longue remontee a travers chaque onglet visite.
   */
  function aller(cible) {
    if (cible === etat.vue) return;
    if (!quitterGrille()) return;
    const base = !history.state || history.state.base;
    if (cible === "accueil") {
      if (!base) { history.back(); return; }
    } else if (base) {
      history.pushState({ vue: cible }, "");
    } else {
      history.replaceState({ vue: cible }, "");
    }
    etat.vue = cible;
    rendre();
  }

  window.addEventListener("popstate", (e) => {
    if (feuille.open) feuille.close();
    const cible = (e.state && e.state.vue) || "accueil";
    if (cible !== etat.vue) {
      etat.vue = cible;
      rendre();
    }
  });

  function quitterGrille() {
    if (etat.vue !== "reglages" || !etat.grilleModifiee) return true;
    if (!confirm("La grille de bonus a été modifiée sans être enregistrée. Abandonner les modifications ?")) return false;
    etat.grilleModifiee = false;
    return true;
  }

  // Chaque ecran lit la base avant de s'afficher. Si l'on change d'onglet
  // pendant cette lecture, l'ancien ecran ne doit pas s'afficher par-dessus
  // le nouveau : seul le dernier rendu demande a le droit d'ecrire.
  let dernierRendu = 0;

  async function rendre() {
    const jeton = ++dernierRendu;
    $$(".onglets button").forEach((b) => {
      if (b.dataset.vue === etat.vue) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    $("#nomBoutique").textContent = etat.reglages.nomBoutique;
    $("#dateDuJour").textContent = jourLisible(aujourdhui(), true);
    try {
      if (etat.vue === "caisse") await vueCaisse(jeton);
      else if (etat.vue === "rapports") await vueRapports(jeton);
      else if (etat.vue === "reglages") await vueReglages(jeton);
      else await vueAccueil(jeton);
    } catch (e) {
      vue.innerHTML = `<div class="carte"><p class="erreur">Erreur : ${esc(e && e.message)}</p></div>`;
    }
  }

  /* ---------- Accueil ---------- */

  function ligneTx(tx) {
    const o = C.operateur(tx.op);
    const t = C.type(tx.type);
    const details = [tx.numero, tx.reference, tx.note].filter(Boolean).join(" · ");
    return `<li><button type="button" class="ligne-tx" data-tx="${esc(tx.id)}">
      <span class="heure">${heure(tx.ts)}</span>
      <span class="quoi"><b><span class="point" style="background:${o ? o.couleur : "#999"}"></span>${esc(t ? t.nom : tx.type)} · ${esc(o ? o.nom : tx.op)}</b>${details ? `<span>${esc(details)}</span>` : ""}</span>
      <span class="combien"><b>${ar(tx.montant)}</b><span class="plus">+ ${ar(tx.bonus)}</span></span>
    </button></li>`;
  }

  async function vueAccueil(jeton) {
    const jour = aujourdhui();
    const [txs, total] = await Promise.all([S.txEntre(jour, jour), S.compterTx()]);
    if (jeton !== dernierRendu) return;
    const r = C.resume(txs);
    const sansGrille = opsActifs().filter((o) => grilleVide(o.id));
    const derniere = etat.reglages.derniereSauvegarde ? new Date(etat.reglages.derniereSauvegarde) : null;
    const rappel = total > 0 && (!derniere || Date.now() - derniere.getTime() > JOURS_AVANT_RAPPEL * 864e5);

    vue.innerHTML = `
      ${sansGrille.length ? `<div class="avertissement">
        <b>Bonus non configuré</b> pour ${esc(sansGrille.map((o) => o.nom).join(", "))} : le bonus ne peut pas être calculé tout seul.
        Remplissez la grille de commissions de l'opérateur, ou saisissez le bonus à la main dans chaque transaction.<br>
        <button type="button" class="btn petit secondaire" data-aller="reglages">Remplir la grille</button></div>` : ""}
      ${rappel ? `<div class="avertissement">
        <b>Pensez à sauvegarder.</b> ${derniere ? "Dernière sauvegarde : " + esc(jourLisible(C.jourDe(derniere))) + "." : "Aucune sauvegarde pour l'instant."}
        Si le téléphone est perdu ou l'application désinstallée, les transactions disparaissent.<br>
        <button type="button" class="btn petit secondaire" data-action="sauvegarder">Sauvegarder maintenant</button></div>` : ""}
      <section class="carte bonus-jour" aria-label="Résumé du jour">
        <div class="etiquette">Bonus du jour</div>
        <div class="valeur" id="bonusJour">${ar(r.bonus)}</div>
        <div class="chiffres">
          <div><b>${r.nombre}</b><span>transaction${r.nombre > 1 ? "s" : ""}</span></div>
          <div><b>${ar(r.parType.depot.montant)}</b><span>dépôts</span></div>
          <div><b>${ar(r.parType.retrait.montant)}</b><span>retraits</span></div>
        </div>
      </section>
      <div class="grands-boutons">
        <button type="button" class="grand depot" data-nouveau="depot">+ Dépôt<small>Mandefa vola</small></button>
        <button type="button" class="grand retrait" data-nouveau="retrait">− Retrait<small>Maka vola</small></button>
        <button type="button" class="grand autre" data-nouveau="transfert">Autre : transfert, crédit, facture</button>
      </div>
      <section class="carte">
        <h2>Transactions d'aujourd'hui</h2>
        ${txs.length ? `<ul class="liste">${txs.map(ligneTx).join("")}</ul>`
          : `<p class="vide">Aucune transaction aujourd'hui.<br>Touchez « Dépôt » ou « Retrait » pour commencer.</p>`}
      </section>`;
  }

  /* ---------- Fiche transaction ---------- */

  function puces(conteneur, nom, items, choisi) {
    conteneur.innerHTML = items.map((it) => `<label>
      <input type="radio" name="${nom}" value="${esc(it.id)}"${it.id === choisi ? " checked" : ""}>
      <span>${it.couleur ? `<span class="point" style="background:${it.couleur}"></span>` : ""}${esc(it.nom)}</span>
    </label>`).join("");
  }

  function valeurPuce(nom) {
    const c = $(`input[name="${nom}"]:checked`, feuille);
    return c ? c.value : null;
  }

  function dateLocale(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function majBonus() {
    const ligne = $("#bonusLigne");
    const manuel = $("#bonusManuel").checked;
    $("#champBonus").hidden = !manuel;
    const montant = lireMontant($("#txMontant").value);
    if (manuel) {
      ligne.className = "bonus-ligne";
      ligne.textContent = `Bonus saisi : ${ar(lireMontant($("#txBonus").value))}`;
      return;
    }
    const op = valeurPuce("op");
    const typ = valeurPuce("type");
    if (!montant) {
      ligne.className = "bonus-ligne";
      ligne.textContent = "Bonus : saisissez le montant";
      return;
    }
    const b = C.bonus(etat.reglages.grilles, op, typ, montant);
    if (b.trouve) {
      ligne.className = "bonus-ligne";
      ligne.textContent = `Bonus : ${ar(b.bonus)}`;
    } else {
      ligne.className = "bonus-ligne manque";
      ligne.textContent = "Aucune tranche de la grille ne couvre ce montant : bonus 0 Ar. Cochez « Saisir le bonus à la main » si besoin.";
    }
  }

  function ouvrirFeuille(typeDefaut, tx) {
    etat.txEdite = tx || null;
    const ops = opsActifs();
    if (tx && !ops.some((o) => o.id === tx.op) && C.operateur(tx.op)) ops.push(C.operateur(tx.op));
    if (!ops.length) {
      toast("Activez au moins un opérateur dans Réglages.");
      return;
    }
    const dernierOp = lireLocal("dernierOp");
    const op = tx ? tx.op : (ops.some((o) => o.id === dernierOp) ? dernierOp : ops[0].id);
    puces($("#choixOp"), "op", ops, op);
    puces($("#choixType"), "type", C.TYPES, tx ? tx.type : typeDefaut);

    $("#feuilleTitre").textContent = tx ? "Modifier la transaction" : "Nouvelle transaction";
    $("#txMontant").value = tx ? String(tx.montant) : "";
    formaterSaisie($("#txMontant"));
    $("#bonusManuel").checked = !!(tx && tx.bonusManuel);
    $("#txBonus").value = tx && tx.bonusManuel ? String(tx.bonus) : "";
    formaterSaisie($("#txBonus"));
    $("#txNumero").value = tx ? tx.numero || "" : "";
    $("#txReference").value = tx ? tx.reference || "" : "";
    $("#txNote").value = tx ? tx.note || "" : "";
    $("#txDate").value = dateLocale(tx ? tx.ts : Date.now());
    $("#plusDetails").open = !!(tx && (tx.numero || tx.reference || tx.note));
    $("#txErreur").textContent = "";
    $("#txSupprimer").hidden = !tx;
    majBonus();

    feuille.showModal();
    history.pushState({ vue: etat.vue, feuille: true }, "");
    // Sur telephone, le clavier qui s'ouvre tout seul cacherait le choix de
    // l'operateur : on ne place le curseur qu'en creation.
    if (!tx) setTimeout(() => $("#txMontant").focus(), 50);
  }

  function fermerFeuille() {
    if (history.state && history.state.feuille) history.back();
    else if (feuille.open) feuille.close();
  }

  async function enregistrerFeuille() {
    const erreur = $("#txErreur");
    const montant = lireMontant($("#txMontant").value);
    const op = valeurPuce("op");
    const typ = valeurPuce("type");
    if (!op) { erreur.textContent = "Choisissez l'opérateur."; return; }
    if (!typ) { erreur.textContent = "Choisissez le type."; return; }
    if (!montant) { erreur.textContent = "Saisissez le montant."; $("#txMontant").focus(); return; }

    const manuel = $("#bonusManuel").checked;
    const bonus = manuel ? lireMontant($("#txBonus").value) : C.bonus(etat.reglages.grilles, op, typ, montant).bonus;
    let ts = Date.parse($("#txDate").value);
    if (isNaN(ts)) ts = etat.txEdite ? etat.txEdite.ts : Date.now();
    if (ts > Date.now() + 5 * 60000) { erreur.textContent = "La date est dans le futur."; return; }

    const tx = {
      id: etat.txEdite ? etat.txEdite.id : Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      ts,
      jour: C.jourDe(ts),
      op,
      type: typ,
      montant,
      bonus,
      bonusManuel: manuel,
      numero: $("#txNumero").value.trim(),
      reference: $("#txReference").value.trim(),
      note: $("#txNote").value.trim(),
      creeLe: etat.txEdite ? etat.txEdite.creeLe || etat.txEdite.ts : Date.now(),
    };
    try {
      await S.enregistrerTx(tx);
    } catch (e) {
      erreur.textContent = "Enregistrement impossible : " + (e && e.message);
      return;
    }
    ecrireLocal("dernierOp", op);
    fermerFeuille();
    toast(`${etat.txEdite ? "Modifié" : "Enregistré"} : ${C.type(typ).nom} ${ar(montant)} · bonus ${ar(bonus)}`);
    etat.txEdite = null;
    rendre();
  }

  $("#formTx").addEventListener("submit", (e) => {
    e.preventDefault();
    enregistrerFeuille();
  });
  $("#txAnnuler").addEventListener("click", fermerFeuille);
  feuille.addEventListener("cancel", (e) => {
    e.preventDefault();
    fermerFeuille();
  });
  $("#txSupprimer").addEventListener("click", async () => {
    const tx = etat.txEdite;
    if (!tx || !confirm(`Supprimer ce ${C.type(tx.type).nom.toLowerCase()} de ${ar(tx.montant)} ?`)) return;
    await S.supprimerTx(tx.id);
    etat.txEdite = null;
    fermerFeuille();
    toast("Transaction supprimée");
    rendre();
  });
  ["#txMontant", "#txBonus"].forEach((s) => $(s).addEventListener("input", (e) => {
    formaterSaisie(e.target);
    majBonus();
  }));
  $("#bonusManuel").addEventListener("change", () => {
    if ($("#bonusManuel").checked && !$("#txBonus").value) {
      const b = C.bonus(etat.reglages.grilles, valeurPuce("op"), valeurPuce("type"), lireMontant($("#txMontant").value));
      $("#txBonus").value = b.bonus ? String(b.bonus) : "";
      formaterSaisie($("#txBonus"));
    }
    majBonus();
  });
  feuille.addEventListener("change", (e) => {
    if (e.target.name === "op" || e.target.name === "type") majBonus();
  });

  /* ---------- Caisse ---------- */

  function comptesCaisse() {
    return [{ id: "especes", nom: "Espèces (billets)" }].concat(opsActifs().map((o) => ({ id: o.id, nom: "UV " + o.nom })));
  }

  function ecart(compte, theorique) {
    const d = compte - theorique;
    if (d === 0) return `<span class="ecart-ok">Juste</span>`;
    if (d < 0) return `<span class="ecart-moins">Manque <span class="nw">${ar(-d)}</span></span>`;
    return `<span class="ecart-plus">Surplus <span class="nw">${ar(d)}</span></span>`;
  }

  async function vueCaisse(jeton) {
    const jour = etat.jourCaisse || aujourdhui();
    const [j, txs, prec] = await Promise.all([S.lireJour(jour), S.txEntre(jour, jour), S.derniereCloture(jour)]);
    if (jeton !== dernierRendu) return;
    const comptes = comptesCaisse();
    const ouv = j.ouverture || {};
    const theo = C.soldes(ouv, txs);
    const clo = j.cloture || {};
    const champ = (prefixe, c, v) => `<label class="champ"><span>${esc(c.nom)}</span>
      <input inputmode="numeric" autocomplete="off" data-${prefixe}="${c.id}" value="${v === undefined || v === null ? "" : esc(String(v).replace(/\B(?=(\d{3})+(?!\d))/g, " "))}" placeholder="0"></label>`;

    vue.innerHTML = `
      <div class="sel-jour">
        <button type="button" data-jour="-1" aria-label="Jour précédent">‹</button>
        <input type="date" id="jourCaisse" value="${jour}" max="${aujourdhui()}" aria-label="Jour">
        <button type="button" data-jour="1" aria-label="Jour suivant"${jour >= aujourdhui() ? " disabled" : ""}>›</button>
      </div>
      <div class="colonnes">
      <section class="carte">
        <h2>Ouverture <small>(le matin)</small></h2>
        <p class="aide">Comptez l'argent liquide et notez le solde de chaque compte opérateur avant la première transaction.</p>
        ${!j.ouverture && prec ? `<button type="button" class="btn petit secondaire" id="reprendre">Reprendre la clôture du ${esc(jourLisible(prec.jour))}</button>` : ""}
        <div class="deux">${comptes.map((c) => champ("ouv", c, j.ouverture ? ouv[c.id] : "")).join("")}</div>
        <button type="button" class="btn primaire plein" id="enrOuverture">Enregistrer l'ouverture</button>
      </section>
      <section class="carte">
        <h2>Soldes attendus</h2>
        ${j.ouverture ? "" : `<p class="avertissement">Sans ouverture, seuls les mouvements du jour sont calculés (départ à 0).</p>`}
        <div class="tableau"><table>
          <thead><tr><th>Compte</th><th>Ouverture</th><th>Attendu</th></tr></thead>
          <tbody>${comptes.map((c) => `<tr><td>${esc(c.nom)}</td><td>${ar(ouv[c.id])}</td><td><b>${ar(theo[c.id])}</b></td></tr>`).join("")}</tbody>
        </table></div>
        <p class="aide">${txs.length} transaction${txs.length > 1 ? "s" : ""} ce jour-là. Un dépôt ajoute des billets et retire de l'UV ; un retrait fait l'inverse.</p>
      </section>
      </div>
      <section class="carte">
        <h2>Clôture <small>(le soir)</small></h2>
        <p class="aide">Recomptez et notez ce que vous avez réellement. L'écart avec le solde attendu s'affiche tout de suite.</p>
        <div class="tableau"><table>
          <thead><tr><th>Compte</th><th>Compté</th><th>Écart</th></tr></thead>
          <tbody>${comptes.map((c) => `<tr>
            <td>${esc(c.nom)}</td>
            <td><input class="mini" inputmode="numeric" autocomplete="off" data-clo="${c.id}" aria-label="${esc(c.nom)} compté"
              value="${clo[c.id] === undefined ? "" : String(clo[c.id]).replace(/\B(?=(\d{3})+(?!\d))/g, " ")}" placeholder="0"></td>
            <td class="ecart" data-ecart="${c.id}">${clo[c.id] === undefined ? "—" : ecart(clo[c.id], theo[c.id])}</td>
          </tr>`).join("")}</tbody>
        </table></div>
        <button type="button" class="btn primaire plein" id="enrCloture">Enregistrer la clôture</button>
      </section>`;

    $$("input[data-ouv], input[data-clo]", vue).forEach((i) => i.addEventListener("input", () => {
      formaterSaisie(i);
      if (i.dataset.clo) {
        const id = i.dataset.clo;
        $(`[data-ecart="${id}"]`, vue).innerHTML = i.value === "" ? "—" : ecart(lireMontant(i.value), theo[id]);
      }
    }));
    $("#jourCaisse").addEventListener("change", (e) => {
      if (!e.target.value) return;
      etat.jourCaisse = e.target.value > aujourdhui() ? aujourdhui() : e.target.value;
      rendre();
    });
    $$("[data-jour]", vue).forEach((b) => b.addEventListener("click", () => {
      const n = C.decalerJour(jour, Number(b.dataset.jour));
      etat.jourCaisse = n > aujourdhui() ? aujourdhui() : n;
      rendre();
    }));
    const rep = $("#reprendre");
    if (rep) rep.addEventListener("click", () => {
      $$("input[data-ouv]", vue).forEach((i) => {
        const v = prec.cloture[i.dataset.ouv];
        i.value = v === undefined ? "" : String(v);
        formaterSaisie(i);
      });
      toast("Montants repris. Vérifiez puis enregistrez.");
    });
    $("#enrOuverture").addEventListener("click", async () => {
      const o = {};
      $$("input[data-ouv]", vue).forEach((i) => { o[i.dataset.ouv] = lireMontant(i.value); });
      j.ouverture = o;
      await S.ecrireJour(j);
      toast("Ouverture enregistrée");
      rendre();
    });
    $("#enrCloture").addEventListener("click", async () => {
      const c = {};
      let saisi = false;
      $$("input[data-clo]", vue).forEach((i) => {
        if (i.value !== "") { c[i.dataset.clo] = lireMontant(i.value); saisi = true; }
      });
      if (!saisi) { toast("Saisissez au moins un montant compté."); return; }
      j.cloture = c;
      await S.ecrireJour(j);
      toast("Clôture enregistrée");
      rendre();
    });
  }

  /* ---------- Rapports ---------- */

  const PERIODES = [
    ["aujourdhui", "Aujourd'hui"],
    ["hier", "Hier"],
    ["7j", "7 derniers jours"],
    ["mois", "Ce mois"],
    ["moisDernier", "Mois dernier"],
    ["perso", "Choisir…"],
  ];

  function bornes() {
    const t = aujourdhui();
    const [a, m] = t.split("-").map(Number);
    const p = (n) => String(n).padStart(2, "0");
    switch (etat.periode) {
      case "hier": { const h = C.decalerJour(t, -1); return [h, h]; }
      case "7j": return [C.decalerJour(t, -6), t];
      case "mois": return [`${a}-${p(m)}-01`, t];
      case "moisDernier": {
        const debut = m === 1 ? `${a - 1}-12-01` : `${a}-${p(m - 1)}-01`;
        return [debut, C.decalerJour(`${a}-${p(m)}-01`, -1)];
      }
      case "perso": {
        let du = etat.persoDu || C.decalerJour(t, -6);
        let au = etat.persoAu || t;
        if (du > au) [du, au] = [au, du];
        return [du, au];
      }
      default: return [t, t];
    }
  }

  async function vueRapports(jeton) {
    const [du, au] = bornes();
    const txs = await S.txEntre(du, au);
    if (jeton !== dernierRendu) return;
    const r = C.resume(txs);
    const ops = C.OPERATEURS.filter((o) => etat.reglages.operateurs[o.id] || r.parOperateur[o.id].nombre);
    const jours = Object.keys(r.parJour).sort().reverse();

    vue.innerHTML = `
      <div class="periodes" role="group" aria-label="Période">
        ${PERIODES.map(([id, nom]) => `<button type="button" data-periode="${id}" aria-pressed="${etat.periode === id}">${nom}</button>`).join("")}
      </div>
      ${etat.periode === "perso" ? `<div class="deux">
        <label class="champ"><span>Du</span><input type="date" id="persoDu" value="${du}" max="${aujourdhui()}"></label>
        <label class="champ"><span>Au</span><input type="date" id="persoAu" value="${au}" max="${aujourdhui()}"></label>
      </div>` : ""}
      <p class="aide">${du === au ? esc(jourLisible(du, true)) : `Du ${esc(jourLisible(du))} au ${esc(jourLisible(au))}`}</p>
      <div class="stats">
        <div class="carte vert"><div class="etiquette">Bonus total</div><div class="valeur" id="bonusPeriode">${ar(r.bonus)}</div></div>
        <div class="carte"><div class="etiquette">Transactions</div><div class="valeur">${r.nombre}</div></div>
        <div class="carte"><div class="etiquette">Dépôts</div><div class="valeur">${ar(r.parType.depot.montant)}</div></div>
        <div class="carte"><div class="etiquette">Retraits</div><div class="valeur">${ar(r.parType.retrait.montant)}</div></div>
      </div>
      <div class="colonnes">
      <section class="carte">
        <h2>Par opérateur</h2>
        <div class="tableau"><table>
          <thead><tr><th>Opérateur</th><th>Nb</th><th>Montant</th><th>Bonus</th></tr></thead>
          <tbody>${ops.map((o) => { const x = r.parOperateur[o.id]; return `<tr><td><span class="point" style="background:${o.couleur}"></span>${esc(o.nom)}</td><td>${x.nombre}</td><td>${ar(x.montant)}</td><td>${ar(x.bonus)}</td></tr>`; }).join("")}</tbody>
          <tfoot><tr><td>Total</td><td>${r.nombre}</td><td></td><td>${ar(r.bonus)}</td></tr></tfoot>
        </table></div>
      </section>
      <section class="carte">
        <h2>Par type</h2>
        <div class="tableau"><table>
          <thead><tr><th>Type</th><th>Nb</th><th>Montant</th><th>Bonus</th></tr></thead>
          <tbody>${C.TYPES.map((t) => { const x = r.parType[t.id]; return `<tr><td>${esc(t.nom)}</td><td>${x.nombre}</td><td>${ar(x.montant)}</td><td>${ar(x.bonus)}</td></tr>`; }).join("")}</tbody>
        </table></div>
      </section>
      </div>
      ${du !== au ? `<section class="carte">
        <h2>Jour par jour</h2>
        ${jours.length ? `<div class="tableau"><table>
          <thead><tr><th>Jour</th><th>Nb</th><th>Bonus</th></tr></thead>
          <tbody>${jours.map((j) => `<tr><td>${esc(jourLisible(j))}</td><td>${r.parJour[j].nombre}</td><td>${ar(r.parJour[j].bonus)}</td></tr>`).join("")}</tbody>
        </table></div>` : `<p class="vide">Aucune transaction sur cette période.</p>`}
      </section>` : ""}
      <button type="button" class="btn secondaire plein" id="exporterCsv"${txs.length ? "" : " disabled"}>Exporter pour Excel (${txs.length} ligne${txs.length > 1 ? "s" : ""})</button>`;

    $$("[data-periode]", vue).forEach((b) => b.addEventListener("click", () => {
      etat.periode = b.dataset.periode;
      rendre();
    }));
    ["persoDu", "persoAu"].forEach((id) => {
      const i = $("#" + id);
      if (i) i.addEventListener("change", () => {
        if (!i.value) return;
        etat[id] = i.value;
        rendre();
      });
    });
    $("#exporterCsv").addEventListener("click", async () => {
      // Ordre chronologique dans le fichier : c'est ainsi qu'on le relit.
      const lignes = txs.slice().sort((a, b) => a.ts - b.ts);
      try {
        await enregistrerFichier(`cashpoint_${du}_${au}.csv`, C.csv(lignes), "text/csv;charset=utf-8");
      } catch (e) {
        toast("Export impossible : " + (e && e.message));
      }
    });
  }

  /* ---------- Reglages ---------- */

  function chargerBrouillon() {
    const g = etat.reglages.grilles[C.cleGrille(etat.grilleOp, etat.grilleType)] || [];
    etat.grilleBrouillon = g.map((t) => Object.assign({}, t));
    etat.grilleModifiee = false;
  }

  function lignesGrille() {
    if (!etat.grilleBrouillon.length) {
      return `<tr><td colspan="5"><p class="vide">Aucune tranche. Ajoutez la première ligne de la grille de l'opérateur.</p></td></tr>`;
    }
    return etat.grilleBrouillon.map((t, i) => `<tr>
      <td><input inputmode="numeric" data-g="${i}" data-champ="min" value="${esc(t.min)}" aria-label="De (Ar), ligne ${i + 1}" placeholder="0"></td>
      <td><input inputmode="numeric" data-g="${i}" data-champ="max" value="${esc(t.max)}" aria-label="À (Ar), ligne ${i + 1}" placeholder="∞"></td>
      <td><select data-g="${i}" data-champ="mode" aria-label="Type de bonus, ligne ${i + 1}">
        <option value="fixe"${t.mode !== "pourcent" ? " selected" : ""}>Ar</option>
        <option value="pourcent"${t.mode === "pourcent" ? " selected" : ""}>%</option>
      </select></td>
      <td><input inputmode="decimal" data-g="${i}" data-champ="valeur" value="${esc(t.valeur)}" aria-label="Bonus, ligne ${i + 1}" placeholder="0"></td>
      <td><button type="button" class="suppr" data-suppr="${i}" aria-label="Supprimer la ligne ${i + 1}">✕</button></td>
    </tr>`).join("");
  }

  async function vueReglages() {
    const R = etat.reglages;
    if (!etat.grilleModifiee) chargerBrouillon();
    const options = (liste, choisi) => liste.map((x) => `<option value="${x.id}"${x.id === choisi ? " selected" : ""}>${esc(x.nom)}</option>`).join("");

    vue.innerHTML = `
      <section class="carte">
        <h2>Boutique</h2>
        <label class="champ"><span>Nom affiché en haut de l'écran</span><input id="nomBoutiqueSaisie" maxlength="40" value="${esc(R.nomBoutique)}"></label>
        <button type="button" class="btn secondaire" id="enrNom">Enregistrer le nom</button>
      </section>

      <section class="carte">
        <h2>Opérateurs utilisés</h2>
        ${C.OPERATEURS.map((o) => `<label class="case"><input type="checkbox" data-op="${o.id}"${R.operateurs[o.id] ? " checked" : ""}>
          <span class="point" style="background:${o.couleur}"></span>${esc(o.nom)}</label>`).join("")}
      </section>

      <section class="carte">
        <h2>Grille de bonus</h2>
        <p class="aide">Recopiez ici la grille de commissions que vous donne l'opérateur. Pour chaque tranche de montant, le bonus est soit
          un montant fixe en Ariary, soit un pourcentage du montant. Laissez « À » vide pour « sans limite ».</p>
        <div class="deux">
          <label class="champ"><span>Opérateur</span><select id="grilleOp">${options(C.OPERATEURS, etat.grilleOp)}</select></label>
          <label class="champ"><span>Type</span><select id="grilleType">${options(C.TYPES, etat.grilleType)}</select></label>
        </div>
        <div class="tableau"><table class="grille">
          <thead><tr><th>De (Ar)</th><th>À (Ar)</th><th>En</th><th>Bonus</th><th></th></tr></thead>
          <tbody id="lignesGrille">${lignesGrille()}</tbody>
        </table></div>
        <div class="rangee" style="margin:10px 0">
          <button type="button" class="btn secondaire petit" id="ajouterTranche">+ Ajouter une tranche</button>
        </div>
        <p class="erreur" id="grilleErreur" role="alert"></p>
        <button type="button" class="btn primaire plein" id="enrGrille">Enregistrer la grille</button>

        <h3 style="margin-top:18px">Vérifier un montant</h3>
        <div class="rangee">
          <input id="testMontant" inputmode="numeric" placeholder="Montant à tester" aria-label="Montant à tester"
            style="flex:1;min-width:0;border:1px solid var(--bord);border-radius:10px;padding:10px;background:var(--fond);min-height:44px">
        </div>
        <p class="aide" id="testResultat" aria-live="polite">Le bonus calculé par la grille enregistrée s'affichera ici.</p>

        <h3 style="margin-top:18px">Copier cette grille</h3>
        <div class="rangee">
          <select id="copieVers" aria-label="Copier vers" style="flex:1;min-width:0;border:1px solid var(--bord);border-radius:10px;padding:10px;background:var(--fond);min-height:44px">
            ${C.OPERATEURS.map((o) => C.TYPES.map((t) => `<option value="${o.id}:${t.id}">${esc(o.nom)} · ${esc(t.nom)}</option>`).join("")).join("")}
          </select>
          <button type="button" class="btn secondaire petit" id="copier">Copier</button>
        </div>
      </section>

      <section class="carte">
        <h2>Sauvegarde</h2>
        <p class="aide">Les transactions sont gardées sur cet appareil uniquement. Sauvegardez régulièrement et gardez le fichier
          ailleurs (Drive, WhatsApp, e-mail). Le même fichier permet de tout retrouver sur un nouveau téléphone ou sur l'ordinateur.<br>
          Dernière sauvegarde : <b>${R.derniereSauvegarde ? esc(new Date(R.derniereSauvegarde).toLocaleString("fr-FR")) : "jamais"}</b></p>
        <div class="rangee">
          <button type="button" class="btn primaire" data-action="sauvegarder">Sauvegarder</button>
          <label class="btn secondaire" style="display:inline-flex;align-items:center">Restaurer une sauvegarde
            <input type="file" id="fichierRestauration" accept=".json,application/json" hidden></label>
        </div>
      </section>

      <section class="carte">
        <h2>Tout effacer</h2>
        <p class="aide">Supprime toutes les transactions, la caisse et les réglages de cet appareil.</p>
        <button type="button" class="btn danger" id="toutEffacer">Tout effacer</button>
      </section>
      <p class="discret">Cash Point Mora · version ${VERSION}</p>`;

    $("#enrNom").addEventListener("click", async () => {
      R.nomBoutique = $("#nomBoutiqueSaisie").value.trim() || "Mon Cash Point";
      await S.ecrireReglages(R);
      $("#nomBoutique").textContent = R.nomBoutique;
      toast("Nom enregistré");
    });

    $$("input[data-op]", vue).forEach((c) => c.addEventListener("change", async () => {
      R.operateurs[c.dataset.op] = c.checked;
      await S.ecrireReglages(R);
      toast(c.checked ? "Opérateur activé" : "Opérateur masqué");
    }));

    const changerSelection = (champ, valeur) => {
      if (!quitterGrille()) { rendre(); return; }
      etat[champ] = valeur;
      chargerBrouillon();
      rendre();
    };
    $("#grilleOp").addEventListener("change", (e) => changerSelection("grilleOp", e.target.value));
    $("#grilleType").addEventListener("change", (e) => changerSelection("grilleType", e.target.value));

    const corps = $("#lignesGrille");
    corps.addEventListener("input", (e) => {
      const i = e.target.dataset.g;
      if (i === undefined) return;
      let v = e.target.value;
      if (e.target.dataset.champ === "valeur") v = v.replace(",", ".").replace(/[^\d.]/g, "");
      else if (e.target.dataset.champ !== "mode") v = v.replace(/\D/g, "");
      if (e.target.tagName === "INPUT" && e.target.value !== v) e.target.value = v;
      etat.grilleBrouillon[i][e.target.dataset.champ] = v;
      etat.grilleModifiee = true;
    });
    corps.addEventListener("change", (e) => {
      if (e.target.tagName !== "SELECT") return;
      etat.grilleBrouillon[e.target.dataset.g].mode = e.target.value;
      etat.grilleModifiee = true;
    });
    corps.addEventListener("click", (e) => {
      const b = e.target.closest("[data-suppr]");
      if (!b) return;
      etat.grilleBrouillon.splice(Number(b.dataset.suppr), 1);
      etat.grilleModifiee = true;
      corps.innerHTML = lignesGrille();
    });
    $("#ajouterTranche").addEventListener("click", () => {
      const g = etat.grilleBrouillon;
      // La tranche suivante commence juste apres la precedente : c'est
      // presque toujours le cas dans une grille d'operateur.
      const prec = g[g.length - 1];
      const min = prec && prec.max !== "" && prec.max !== undefined ? String(Number(prec.max) + 1) : (g.length ? "" : "0");
      g.push({ min, max: "", mode: prec ? prec.mode : "fixe", valeur: "" });
      etat.grilleModifiee = true;
      corps.innerHTML = lignesGrille();
      const champs = $$(`input[data-g="${g.length - 1}"]`, corps);
      if (champs.length) champs[min ? 1 : 0].focus();
    });
    $("#enrGrille").addEventListener("click", async () => {
      const g = etat.grilleBrouillon.filter((t) => !(t.min === "" && t.max === "" && t.valeur === ""));
      const erreurs = C.erreursGrille(g);
      $("#grilleErreur").textContent = erreurs.join(" ");
      if (erreurs.length) return;
      const propre = g
        .map((t) => ({ min: Number(t.min), max: t.max === "" ? "" : Number(t.max), mode: t.mode === "pourcent" ? "pourcent" : "fixe", valeur: Number(t.valeur) }))
        .sort((a, b) => a.min - b.min);
      const cle = C.cleGrille(etat.grilleOp, etat.grilleType);
      if (propre.length) R.grilles[cle] = propre;
      else delete R.grilles[cle];
      await S.ecrireReglages(R);
      etat.grilleModifiee = false;
      toast("Grille enregistrée");
      rendre();
    });

    const test = $("#testMontant");
    test.addEventListener("input", () => {
      formaterSaisie(test);
      const m = lireMontant(test.value);
      const b = C.bonus(R.grilles, etat.grilleOp, etat.grilleType, m);
      $("#testResultat").textContent = !m ? "Le bonus calculé par la grille enregistrée s'affichera ici."
        : b.trouve ? `${ar(m)} → bonus ${ar(b.bonus)}` : `${ar(m)} → aucune tranche ne couvre ce montant.`;
    });

    $("#copier").addEventListener("click", async () => {
      const source = C.cleGrille(etat.grilleOp, etat.grilleType);
      const cible = $("#copieVers").value;
      if (cible === source) { toast("Choisissez une autre destination."); return; }
      if (etat.grilleModifiee) { toast("Enregistrez d'abord la grille."); return; }
      if (!(R.grilles[source] || []).length) { toast("Cette grille est vide."); return; }
      if ((R.grilles[cible] || []).length && !confirm("La grille de destination n'est pas vide. La remplacer ?")) return;
      R.grilles[cible] = R.grilles[source].map((t) => Object.assign({}, t));
      await S.ecrireReglages(R);
      toast("Grille copiée");
    });

    $("#fichierRestauration").addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!f) return;
      let donnees;
      try {
        donnees = JSON.parse(await f.text());
      } catch (err) {
        toast("Fichier illisible : ce n'est pas une sauvegarde.");
        return;
      }
      const n = Array.isArray(donnees && donnees.transactions) ? donnees.transactions.length : 0;
      if (!confirm(`Restaurer cette sauvegarde (${n} transaction${n > 1 ? "s" : ""}) ? Tout ce qui est sur cet appareil sera remplacé.`)) return;
      try {
        await S.importer(donnees);
      } catch (err) {
        toast(err.message);
        return;
      }
      etat.reglages = await S.lireReglages();
      etat.grilleModifiee = false;
      toast("Sauvegarde restaurée");
      rendre();
    });

    $("#toutEffacer").addEventListener("click", async () => {
      if (!confirm("Effacer TOUTES les transactions, la caisse et les réglages de cet appareil ?")) return;
      if (!confirm("Dernière confirmation : cette action est définitive. Avez-vous une sauvegarde ?")) return;
      await S.toutEffacer();
      etat.reglages = await S.lireReglages();
      etat.grilleModifiee = false;
      toast("Tout a été effacé");
      rendre();
    });
  }

  async function sauvegarder() {
    try {
      const donnees = await S.exporter();
      const ok = await enregistrerFichier(`cashpoint-sauvegarde_${aujourdhui()}.json`, JSON.stringify(donnees), "application/json");
      // Partage annule : aucun fichier n'est parti, le rappel doit rester.
      if (!ok) { toast("Sauvegarde annulée"); return; }
      etat.reglages.derniereSauvegarde = new Date().toISOString();
      await S.ecrireReglages(etat.reglages);
      toast("Sauvegarde créée");
      rendre();
    } catch (e) {
      toast("Sauvegarde impossible : " + (e && e.message));
    }
  }

  /* ---------- Demarrage ---------- */

  document.addEventListener("click", (e) => {
    const nav = e.target.closest(".onglets [data-vue]");
    if (nav) { aller(nav.dataset.vue); return; }
    const vers = e.target.closest("[data-aller]");
    if (vers) { aller(vers.dataset.aller); return; }
    const nouveau = e.target.closest("[data-nouveau]");
    if (nouveau) { ouvrirFeuille(nouveau.dataset.nouveau); return; }
    const ligne = e.target.closest("[data-tx]");
    if (ligne) {
      const jour = aujourdhui();
      S.txEntre(jour, jour).then((txs) => {
        const tx = txs.find((t) => t.id === ligne.dataset.tx);
        if (tx) ouvrirFeuille(tx.type, tx);
      });
      return;
    }
    const action = e.target.closest("[data-action='sauvegarder']");
    if (action) sauvegarder();
  });

  // L'application reste souvent ouverte toute la nuit sur le comptoir : au
  // retour, « aujourd'hui » doit etre le vrai jour, pas celui de la veille.
  let jourAffiche = null;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && jourAffiche !== aujourdhui() && !feuille.open) {
      jourAffiche = aujourdhui();
      etat.jourCaisse = jourAffiche;
      rendre();
    }
  });

  async function demarrer() {
    try {
      etat.reglages = await S.lireReglages();
    } catch (e) {
      vue.innerHTML = `<div class="carte"><p class="erreur">Le stockage de l'appareil est inaccessible : ${esc(e && e.message)}</p></div>`;
      return;
    }
    jourAffiche = aujourdhui();
    etat.jourCaisse = jourAffiche;
    history.replaceState({ vue: "accueil", base: true }, "");
    rendre();

    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol) && !natif()) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  demarrer();
})();
