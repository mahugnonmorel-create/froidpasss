# FroidPass — Guide de mise en ligne (gratuit)

Durée : environ 1 h 30, une seule fois. Coût : 0 FCFA (seule la commission FedaPay s'applique sur chaque paiement reçu).

Ce dossier contient :

| Élément | Rôle |
|---|---|
| `public/index.html` | Site vitrine (présentation, tarifs, démo, inscription membre fondateur) |
| `public/app.html` + `app.js` | Application des techniciens (parc, QR, interventions, relances, certificat, abonnement) |
| `public/e.html` | Carnet public ouvert par le QR code (sans connexion) |
| `public/config.js` | Les 2 valeurs Supabase à renseigner (étape 2) |
| `functions/api/[[route]].js` | Paiement FedaPay côté serveur (création, vérification, webhook) |
| `supabase/schema.sql` | Base de données + règles de sécurité |

> **Important sous Windows :** ne double-cliquez **jamais** sur les fichiers `.js`. Windows essaierait de les exécuter avec « Windows Script Host », ce qui affiche des erreurs (« Erreur de syntaxe », « window est indéfini »). Ce n'est pas un bug : ces fichiers ne s'exécutent que dans le navigateur ou sur Cloudflare. Pour modifier `config.js` : clic droit → *Ouvrir avec* → **Bloc-notes**.

> **Règle de sécurité n° 1 :** la clé `service_role` de Supabase et la clé secrète FedaPay ne vont **jamais** dans `config.js` ni sur GitHub. Uniquement dans les variables secrètes de Cloudflare (étape 5).

---

## Étape 1 — Créer la base de données (Supabase, 15 min)

1. Allez sur **supabase.com** → *Start your project* → connectez-vous avec GitHub ou votre e-mail.
2. *New project* : nom `froidpass`, mot de passe de base de données fort (notez-le), région la plus proche (Europe de l'Ouest), offre **Free**.
3. Une fois le projet prêt : menu **SQL Editor** → *New query* → collez **tout** le contenu de `supabase/schema.sql` → **Run**. Le message « Success » doit apparaître.
4. Menu **Authentication → URL Configuration** : *Site URL* = l'adresse de votre site (vous l'aurez à l'étape 4, revenez la renseigner), par exemple `https://froidpass.pages.dev`.
5. Menu **Authentication → Sign In / Providers → Email** : au lancement, vous pouvez **désactiver « Confirm email »**. Le service d'e-mail gratuit de Supabase a une limite d'envoi très basse ; sans confirmation, les techniciens entrent directement après inscription.

## Étape 2 — Renseigner `config.js` (2 min)

Dans Supabase : **Project Settings → API** (ou *Data API*). Copiez :
- **Project URL** → dans `SUPABASE_URL`
- la clé **anon / public** → dans `SUPABASE_ANON_KEY`

Ouvrez `public/config.js` avec le Bloc-notes et remplacez les deux valeurs. La clé *anon* est publique par conception : la sécurité est assurée par les règles de la base.

## Étape 3 — Mettre le code sur GitHub (10 min)

1. **github.com** → créez un compte → *New repository* → nom `froidpass`, **Private**, *Create*.
2. *uploading an existing file* → glissez **le contenu** du dossier (les dossiers `public`, `functions`, `supabase` et ce guide) → *Commit changes*.
   Vérifiez que le dossier `functions/api` contient bien le fichier `[[route]].js`.

## Étape 4 — Mettre le site en ligne (Cloudflare Pages, 10 min)

1. **dash.cloudflare.com** → créez un compte gratuit.
2. **Workers & Pages → Create → Pages → Connect to Git** → autorisez GitHub → choisissez `froidpass`.
3. Réglages de déploiement :
   - *Framework preset* : **None**
   - *Build command* : laisser **vide**
   - *Build output directory* : **`public`**
4. **Save and Deploy**. Votre adresse s'affiche, du type `https://froidpass.pages.dev`. Reportez-la dans Supabase (étape 1.4).

## Étape 5 — Brancher le paiement FedaPay (15 min)

Pré-requis : votre compte FedaPay Freelance est **activé** (validation d'environ 36 h ouvrables). En attendant, tout se teste en mode *sandbox* sans argent réel.

1. Dans FedaPay : **Paramètres → Clés API**. Copiez la **clé secrète** (d'abord celle du mode *sandbox*).
2. Dans Supabase : **Project Settings → API** → copiez la clé **service_role** (secrète).
3. Dans Cloudflare : votre projet Pages → **Settings → Variables and Secrets** → *Production* → ajoutez, chacune en type **Secret** :

| Nom | Valeur |
|---|---|
| `SUPABASE_URL` | Project URL de Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | clé service_role |
| `FEDAPAY_SECRET_KEY` | clé secrète FedaPay |
| `FEDAPAY_ENV` | `sandbox` (pour tester), puis `live` |
| `SITE_URL` | `https://froidpass.pages.dev` (votre adresse) |

4. **Deployments → … → Retry deployment** pour que les variables soient prises en compte.
5. Dans le tableau de bord FedaPay, rubrique **Webhooks** : ajoutez l'URL `https://VOTRE-ADRESSE/api/webhook`.
   Sécurité : à chaque notification, le serveur relit la transaction directement chez FedaPay avec la clé secrète avant d'activer un abonnement. Un faux appel ne peut donc rien activer. Même sans webhook, l'abonnement s'active quand le client revient sur l'application après paiement.

## Étape 6 — Tester avant d'annoncer (15 min)

1. Ouvrez `https://VOTRE-ADRESSE/app.html#inscription` → créez un compte test.
2. Créez un client, puis un équipement → le QR apparaît → scannez-le avec votre téléphone : le carnet public s'ouvre.
3. Enregistrez une intervention avec la saisie rapide.
4. **Abonnement → Membre fondateur → Payer** : en mode *sandbox*, utilisez les numéros de test indiqués dans la documentation FedaPay. Au retour, l'offre doit passer à « Solo ».
5. Quand tout fonctionne : remplacez `FEDAPAY_ENV` par `live` et la clé sandbox par la **clé secrète live**, puis relancez le déploiement.

## Étape 7 — Lancer

- Envoyez `https://VOTRE-ADRESSE` aux frigoristes avec le message de prévente.
- Les demandes « membre fondateur » arrivent sur votre WhatsApp (+229 01 62 77 79 77).
- Vos tableaux de suivi : Supabase → **Table Editor** (techniciens, paiements, équipements).

---

## Limites de l'offre gratuite à connaître

- **Supabase Free** : un projet sans activité pendant 7 jours est mis en pause. Il se réactive en un clic depuis le tableau de bord, et dès que des techniciens l'utilisent chaque semaine, la pause n'arrive pas. Passez à l'offre payante quand les abonnements la financent.
- **FedaPay Freelance** : 10 paiements par semaine, de 100 à 300 000 FCFA chacun. Encouragez les paiements trimestriels et annuels. Passez en compte Business après création de l'entreprise.
- **Adresse** : `.pages.dev` est gratuite. Un nom de domaine à vous (≈ 10 000 FCFA/an) peut être ajouté plus tard dans Cloudflare → *Custom domains*.

## À faire avant le premier client payant

- Pages *Conditions générales* et *Politique de confidentialité* (je peux les rédiger).
- Vérifier vous-même les fréquences d'entretien et le seuil d'alerte (écart de 8 °C) dans `app.js` → `TYPES` et `flags()`.

## En cas de problème

| Symptôme | Cause probable |
|---|---|
| « Configuration requise » | `config.js` non rempli (étape 2) |
| « Variable … manquante côté serveur » | Variables Cloudflare absentes, ou déploiement non relancé (étape 5.4) |
| « FedaPay 401 » | Clé secrète erronée, ou clé *live* avec `FEDAPAY_ENV=sandbox` (ou l'inverse) |
| Inscription sans effet | Confirmation d'e-mail activée et limite d'envoi atteinte (étape 1.5) |
| « QUOTA » à la création d'un équipement | Offre Découverte limitée à 10 équipements : normal |
