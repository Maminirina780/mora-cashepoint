# Cash Point Mora

Application pour les **cash points Mobile Money** (MVola, Orange Money, Airtel Money).
Chaque dépôt (*mandefa vola*), retrait (*maka vola*), transfert, vente de crédit ou paiement de facture est
enregistré, et l'application calcule **le bonus gagné dans la journée**.

Un seul code (`www/`) donne trois versions :

| Version | Comment l'obtenir |
|---|---|
| **Site web** | `https://cashpoint-mora.pages.dev` une fois les secrets Cloudflare ajoutés (voir plus bas). Fonctionne aussi sans réseau et s'installe sur l'écran d'accueil. |
| **APK Android** | Onglet **Actions** → « Construire les applications » → dernière exécution → *Artifacts* → `CashPointMora-Android`. |
| **Logiciel Windows** | Même endroit → `CashPointMora-Windows` (installateur `.exe`). |

Pour une version à donner au client : créer un tag `v1.0.0` (ou *Releases → Draft a new release*), et l'APK
et le `.exe` sont publiés ensemble dans la Release.

## Ce que fait l'application

- **Accueil** : bonus du jour, nombre de transactions, total des dépôts et des retraits, et la liste du jour.
  Deux grands boutons *Dépôt* et *Retrait* pour une saisie en quelques secondes.
- **Bonus automatique** : selon la **grille de commissions** de chaque opérateur, que le propriétaire recopie
  dans *Réglages* (tranches de montant, bonus fixe en Ariary ou en pourcentage). Le bonus peut aussi être
  saisi à la main pour une transaction.
- **Caisse** : ouverture le matin (billets + solde UV de chaque opérateur), soldes attendus en direct,
  clôture le soir avec l'**écart** (manque ou surplus).
- **Rapports** : aujourd'hui, hier, 7 jours, ce mois, mois dernier ou dates au choix ; totaux par opérateur,
  par type et jour par jour ; **export Excel** (CSV).
- **Sauvegarde / restauration** en un fichier, pour changer de téléphone ou passer à l'ordinateur.

### Important

- **Aucune grille de commissions n'est fournie** : les grilles varient selon l'opérateur et le contrat de
  l'agent, et une grille inventée donnerait de faux bonus. Tant qu'une grille est vide, l'accueil le signale.
- **Les données restent sur l'appareil** (pas de compte, pas de serveur, marche sans Internet).
  Désinstaller l'application efface tout : l'application rappelle de sauvegarder chaque semaine.

## Signature de l'APK (à faire avant de livrer au client)

Sans clé, GitHub produit une APK d'**essai** (`-essai.apk`). Chaque APK d'essai est signée par une clé
différente : Android refuse de l'installer par-dessus la précédente, et désinstaller **efface les transactions**.

Une seule fois, sur un ordinateur avec Java :

```bash
keytool -genkeypair -v -keystore cashpoint.jks -alias cashpoint -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 cashpoint.jks > cashpoint.jks.b64
```

Puis dans **Settings → Secrets and variables → Actions** de ce dépôt :

| Secret | Valeur |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | le contenu de `cashpoint.jks.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | le mot de passe du fichier |
| `ANDROID_KEY_ALIAS` | `cashpoint` |
| `ANDROID_KEY_PASSWORD` | le mot de passe de la clé |

Gardez `cashpoint.jks` et ses mots de passe en lieu sûr, **hors de ce dépôt** : sans eux, aucune mise à jour
de l'application ne pourra plus s'installer chez le client.

## Site web (Cloudflare Pages)

Ajouter `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` dans les secrets de ce dépôt (les mêmes valeurs
que pour moraformation). Sans eux, la publication est simplement sautée.

## Développement

```bash
npm ci
npm test                  # calculs + parcours complet dans Chromium
npm run serve             # http://localhost:8080
npm run android:sync      # copie www/ dans le projet Android
cd desktop && npm ci && npm start   # version Windows en local
```

| Dossier | Contenu |
|---|---|
| `www/` | l'application (HTML, CSS, JS sans étape de construction) |
| `www/calc.js` | les calculs : bonus, soldes de caisse, totaux, export CSV |
| `www/store.js` | le stockage local (IndexedDB) |
| `android/` | le projet Android (Capacitor) |
| `desktop/` | la version Windows (Electron) |
| `test/` | les tests |
