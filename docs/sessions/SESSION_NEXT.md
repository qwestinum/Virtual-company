# Brief — prochaine session (réécrit le 20/09/2026)

Le chantier est la **REFONTE DES INTERFACES**. Source de vérité :
**`docs/ux/maquette-structure-v2-2026-09-20.md`** — à lire EN ENTIER avant de toucher à un
écran. Elle supersède la v1 (`maquette-structure-2026-09-20.md`, conservée pour la trace).
L'état objectif de l'existant est dans **`docs/ux/audit-ux-2026-09-20.md`**.

> Le brief précédent (APEC / ADEP) est archivé en §8. Ce qu'il contient reste vrai ; le
> connecteur est livré et tourne en simulation tant que `ADEP_ENABLED` n'est pas posé.
> Compte rendu de la session qui précède celle-ci :
> `docs/sessions/SESSION_2026-09-20_UX_COHERENCE.md`.

---

## 0. ÉTAT — la maquette est validée, aucun écran n'est commencé

`fix/validations-orphelines` porte 7 commits **jamais poussés** : ils n'ont RIEN à voir avec la
refonte (cohérence de la file HITL), mais ils touchent `ValidationsHub`, `RejectionProposalsTab`
et `GrayValidationAction`. **Les merger avant de commencer**, sinon la refonte repartira d'un
hub périmé.

Vert au moment d'écrire : typecheck propre, **2 707 tests**, **régression 232/232**.

---

## 1. Ce que la refonte change — et ce qu'elle ne change PAS

**5 entrées** : `Aujourd'hui` (défaut) · `Campagnes` · `Candidatures` · `Entretiens` ·
`Pilotage`. Réglages hors navigation.

**Conservés SANS changement de structure** : `Candidatures` et `Entretiens`. Seuls ajouts —
réception des filtres par URL avec un bandeau visible et retirable, accès au mode groupé depuis
la puce « À valider », lexique appliqué aux puces. **Ne pas les refondre.**

**Un seul écran est à créer de zéro** : *Aujourd'hui*.

| Disparaît du premier niveau | Où va son contenu |
|---|---|
| Bureau | devient *Aujourd'hui* ; agents + répartition → *Pilotage* |
| Validation suspendue | puce « À valider » + mode groupé |
| Validations vivier | décision **sur place** dans la recherche vivier d'une campagne |
| Sourcing | bouton de la carte campagne |

---

## 2. Le blocage n°1, et il n'est pas technique

**Il n'existe AUCUNE URL dans le produit.** Les 8 onglets et tous les sous-onglets vivent dans un
`useState` ; le seul `router.push` du workspace mène à `/settings`. Donc : pas de favori, pas de
bouton Précédent, pas de lien partageable, et **rien où pointer** — les deux signaux APEC ciblent
déjà `{ route: '/rh/recrutement' }` sans pouvoir dire QUELLE campagne.

**Le lot M0 (squelette adressable) conditionne tout le reste.** Une refonte « en modules » sans
routes serait le même produit avec d'autres étiquettes, et *Aujourd'hui* — dont chaque ligne doit
mener quelque part — serait irréalisable.

⚠️ **Rester sous `/rh/…`** : le proxy est une **liste blanche de préfixes**
(`['/app','/rh','/settings','/validations','/admin']`). Un module sorti de là devient **public
par défaut**.

---

## 3. Ordre des lots (§F.5 de la maquette v2)

| Lot | Contenu | Poids | Bloque |
|---|---|---|---|
| **P0** | **Arbitrages métier** — cf. §5 | — | M1, E.2 |
| **M0** | Squelette adressable : routeur à 5 entrées, redirections 301, proxy vérifié, lecture d'URL + bandeau de filtre partagé | M | tout |
| **M1** | *Aujourd'hui* : `TodayBoard`, 4 sections, 2 signaux à ajouter, 3 états à zéro, garde « À vérifier jamais filtré » | M | — |
| **M2** | Carte campagne : 4 blocs, **sémantique des compteurs tranchée**, duplication retirée, 3 boutons de sourcing | S | — |
| **M3** | Assistant de création : 6 étapes + récap + écran de sortie, découpe des **1 695 lignes** de `CampaignCreateSheet`, 3 trous de provenance | L | — |
| **M4** | Vivier : décision sur place, retrait de l'onglet, reprise de la ligne en attente | S | — |
| **M5** | Lexique (7 mots partout), cartographie du Manager réécrite + **test de non-divergence** | S | après M1-M4 |

**M0 + M1 = le minimum démontrable** : c'est le chemin (a) qui passe de 5 clics à 2.

---

## 4. Les six pièges à ne pas perdre

1. **Les compteurs de la carte comptent une TRAJECTOIRE, pas une étape.**
   « Shortlistés / Invités » = `everInvited` (passés par l'invitation, y compris ceux qui ont
   avancé). Mesuré : la carte CAMP-2026-221 affiche **2**, et la puce « Invité » de cette
   campagne affiche **0**. La v2 tranche pour l'**étape courante** (option A, §B.1) et déménage
   la trajectoire en Pilotage — **à valider avant de coder M2**.
2. **Les alertes ne sont JAMAIS filtrées par référent.** Garde structurelle existante à étendre :
   `src/components/referent/__tests__/surfaces.test.ts`. Ne pas confondre avec la **portée
   personnelle** des deux signaux d'agenda (`personal: true`) — autre axe, il reste tel quel.
3. **Les filtres existent déjà côté serveur.** `CandidaturesWorkspace` prend `initialCampaignId` /
   `initialStage` / `everInvited` / `everInterviewed`, et **`GET /api/interviews?campaignId=`**
   est déjà servi. Le travail est la **lecture de l'URL**, pas le filtrage.
4. **La suite S1→S25 est insensible à une refonte UI** : elle traverse les routes API, **zéro
   import de `components/`**. Tant qu'aucune route `/api/*` ne bouge, impact nul.
5. **Le diffusion d'une campagne ne s'ouvre que sur une campagne ACTIVE** (invariant :
   diffuser depuis un brouillon appelle des CV qui ne seront pas analysés). Le sous-onglet
   existe toujours et **dit** ce qui s'ouvrira — on ne masque jamais en silence.
6. **`manager-cartography.ts` est DÉJÀ périmé sur 6 points** sans qu'aucune refonte ait eu lieu
   (onglet Sourcing absent, « 5 sections » au lieu de 7, « Seuil d'acceptation », un niveau de
   scoring supprimé, un onglet Dashboard qui n'existe plus, HITL présenté comme global). Le
   réécrire **avec** un test de non-divergence, sinon la dérive recommence.

---

## 5. P0 — les arbitrages qui bloquent, à poser AVANT M1

| # | Question | Effet si non tranchée |
|---|---|---|
| **Q1** | **Sémantique des compteurs de carte** (trajectoire vs étape, §4-1) | M2 ne peut pas être codé |
| **Q2** | **La scène des 6 agents** part en Pilotage — elle quitte l'ouverture de démonstration, alors que c'est elle qui fait l'effet « une équipe au travail » face à Limova. **Arbitrage commercial, pas UX.** | M1 (on garde ou non un bandeau compact en pied) |
| **Q3** | **Volume réel** de dossiers en attente en cabinet. *Aujourd'hui* liste les dossiers (plafond 5 + « voir les N autres »). À 40, c'est un mur ; à 3, un compteur serait du gâchis. | Format des sections de M1 |
| **Q4** | **Où vit le vivier** : Pilotage, Candidatures, ou seulement depuis la carte campagne ? | M4 |
| **Q5** | **Jooble** — absent du code. Diffusion réelle = annonce générique + APEC. | Libellés de M2 |
| **Q6** | **Le commentaire de verdict reste FACULTATIF** (arbitrage du 19/09). Le brief v2 le disait obligatoire ; la maquette retient facultatif. À confirmer. | Libellé d'*Aujourd'hui* |

---

## 6. Correctifs XS/S autorisés en parallèle (branche `fix/ux-mensonges`)

Vrais quelle que soit la structure, tous mesurés dans l'audit :

- **« Refus auto » → « Proposé au refus »** dans le curseur de CRÉATION (celui de l'édition est
  déjà juste). Le refus automatique n'existe plus depuis le 18/08 : le formulaire enseigne un
  comportement supprimé.
- **`STAGE_PILL_CLASS` → `STAGE_TONE_*`** : 5 pastilles sur 7 échouent AA, et la palette
  conforme est **déjà écrite dans le même fichier**, jamais importée.
- **« Enregistrer » qui n'enregistre rien** (7 boutons de la création) → « Section terminée ».
- **Champs obligatoires marqués** + compteur « 4 sur 8 ».
- **Message d'accueil du Manager** : il promet « lancer un recrutement […] je m'occupe du reste »
  alors qu'il est en lecture seule.
- **Vouvoiement** (3 chaînes tutoient : `ChatInput`, `SettingsHub:498`, `AgendaSettings:82`).
- **Identifiant technique `can_src_…` retiré** de l'en-tête de la fiche candidature.
- `--dash-text-tertiary` (2,87:1) et les bordures (1,22:1) remontés au-dessus des seuils.

---

## 7. Ce qui attend ailleurs (hors refonte)

- **Sourcing : la saisie d'un candidat est DÉTRUITE sur une cause transitoire**
  (`docs/ops/diagnostic-s20-4-2026-09-20.md` §2). Diagnostic posé, **arbitrage non tranché**.
- **Lots 4-5 du module de réservation** : extinction du stock Cal.com puis décommission.
- **Cartographie produit du Manager** — dette qui grandit (cf. §4-6).
- **Lot audit 🟠 résiduel** (`docs/audit/audit-orqa.md`) : I1, I2, I3/I4, I15/I16, I17,
  **Settings I12** (sauvegarde optimiste sans rollback).
- **UI de rejeu des `imap_unmatched_cvs`** (API only).
- `docs/BACKLOG.md` pour le reste.

---

## 8. Archive — brief APEC / ADEP du 09/09 (lots 0-4 livrés, jamais poussés)

Toujours valable, simplement plus le sujet. Source : `docs/specs/apec-adep-connector.md`.


### 0. ÉTAT — lots 0 à 4 livrés, aucun appel réel

Le connecteur est **complet et commité** (6 commits, `feat(adep): lot 0` à
`docs(adep)`), **jamais poussé** au moment d'écrire — le DO pousse lui-même.

| Lot | Contenu | État |
|---|---|---|
| 0 | noyau pur : namespaces, nomenclature, Argon2, constructeur XML SEP, parseur d'acquittement, 96 codes d'erreur, validateur métier, sonde XSD | ✅ |
| 1 | port `JobBoardPublisher`, mock **couturé au transport**, règle « jamais un second `openPosition` » | ✅ |
| 2 | migration `job_postings`, réservation avant appel, mapping, panneau APEC dans le bloc Canaux | ✅ |
| 3 | `createHttpAdepTransport` (aucun retry), `resolveTransport` fail-closed, `npm run adep:probe` | ✅ |
| 4 | 2 signaux métier, case de dépublication dans `CampaignDismissFlowDialog` | ✅ |

**Le connecteur tourne en mode SIMULATION** tant que `ADEP_ENABLED` n'est pas
posé (`1` exactement — `true` ne suffit pas), et **il le dit à l'écran**. Aucune
offre n'est jamais partie chez l'Apec.

Dev vert au moment du commit : typecheck, **2097 tests** (7 sautés quand
`xmllint` est absent), 221 fichiers.

### Les trois règles du connecteur, à ne pas éroder

1. **Jamais un second `openPosition`.** `uncertain` (on ne sait pas) n'est PAS
   `unavailable` (vérifié : rien n'existe). Les confondre fabrique des doublons
   indélébiles sur apec.fr. Seul `certainlyNotSent` se rejoue tel quel.
2. **Le statut est un CACHE, jamais une vérité.** L'Apec seule sait où en est une
   offre ; « Relire le statut » va le lui demander.
3. **La dépublication est PROPOSÉE, jamais automatique.** Même raison que « aucun
   refus n'est envoyé automatiquement » : c'est une action sortante et visible du
   public, et au-delà de J+30 elle n'a pas de retour arrière.

---

### 1. Migration APEC — AVANT tout déploiement

`scripts/migrate.sql`, **fichier entier**, **deux exécutions successives** (règle
absolue), puis **Dashboard Supabase → Reload schema cache**. Sans le rechargement
du cache PostgREST, les lectures rendent « not found in schema cache » et le
panneau se retire **en silence**.

Quatre objets ajoutés par le chantier :

| Objet | Nature |
|---|---|
| `job_postings` | table + CHECK `attempt_state` + 2 index |
| `recruiters.adep_numero_dossier` | colonne, **chiffrée** (AES-256-GCM, mécanisme IMAP) |
| `app_settings.adep_config` | colonne jsonb |
| `sites.insee_code` | colonne — l'Apec veut un code commune, pas un nom de ville |

⚠️ **Pas encore appliquée en dev au 09/09** — les tests unitaires ne la
touchent pas (repos mockés), ils ne prouvent donc rien de la base. C'est le
point de reprise immédiat, avec un contrôle POSITIF : un vrai `SELECT`,
`select(head: true)` ne remonte PAS l'absence d'une table.

---

### 2. Les quatre restes ouverts — et qui les bloque

| Reste | Bloqué par | Ce qu'on fait en attendant |
|---|---|---|
| **Le WSDL de PRODUCTION n'a jamais été vu** | l'Apec (accès) | `adep:probe` compare le `targetNamespace` réellement servi à notre constante et **refuse de continuer** en cas d'écart |
| **Formulaire du bloc client réel (mode indirect)** | convention Apec Cabinets / ETT / PRISME non signée | le bloc est construit, validé et testé de bout en bout ; seul l'écran ne le saisit pas. Le mode `broker` dans les réglages du cabinet est le déclencheur naturel |
| **Les 8 questions au support** | envoi à `supportadep@apec.fr` | bloc rédigé, `docs/ops/apec-questions-support.md`. Chaque point porte **l'hypothèse retenue** : le code n'attend personne, mais il dit ce qu'il suppose |
| **Premier appel réel** | les trois lignes ci-dessus | `npm run adep:probe -- --env <fichier>` en dry-run d'abord, `--execute` ensuite. ⚠️ Si la sonde rend `uncertain`, **NE PAS la relancer** : vérifier sur apec.fr sous la référence affichée |

Un cinquième reste est **traité le 09/09** : le pré-remplissage de l'offre APEC
depuis l'annonce générique (§3).

---

### 3. Pré-remplissage depuis l'annonce générique (09/09, livré)

Détail : **§6quater de la spec**. Ce que le recruteur a validé ne se ressaisit
pas — à l'ouverture du panneau, le titre et le corps de l'offre APEC viennent de
l'annonce générique publiée, en restant **éditables** (le format Apec n'est pas
celui du canal générique). À défaut, un bouton **pré-rédige** par le même chemin
que le canal générique : générer à l'ouverture écrirait à la place du recruteur,
et à chaque rechargement de l'écran.

Trois choses à ne pas défaire :

- **rien n'est tronqué ni reformaté** — un descriptif de 3 500 caractères est
  recopié entier et l'écart est DIT ; le Markdown est signalé, jamais retiré ;
- **`prefillIssues` reste borné aux deux champs pré-remplis** — le rapport
  complet à l'ouverture crierait sur des champs que personne n'a pu saisir ;
- **le snapshot APEC est distinct et figé à SA publication.** Modifier l'annonce
  générique ensuite ne touche pas l'offre partie, et le panneau le dit avant
  comme après — sinon on corrige une coquille en croyant corriger les deux, et
  on le découvre quand l'offre n'est plus modifiable.

---

### 4. Ce qui attend ailleurs (inchangé)

- **Cartographie produit du Manager** — le panneau APEC s'ajoute à la liste des
  surfaces qu'il ignore (référent, Entretiens, disponibilités, sans-suite). Il
  avouera son incertitude plutôt que d'inventer un menu, mais la dette grandit.
- **Lots 4-5 du module de réservation** : extinction du stock Cal.com puis
  décommission (`docs/specs/scheduling-module.md`).
- **Lot audit 🟠 résiduel** (`docs/audit/audit-orqa.md`) : I1, I2, puis I3/I4,
  I15/I16, I17. **Settings I12** : sauvegarde optimiste sans rollback.
- **UI de rejeu des `imap_unmatched_cvs`** (API only aujourd'hui).
- Voir `docs/BACKLOG.md` pour le reste.

---

### 5. Archive du brief du 21/08 — IMAP et conformité prod

Toujours valable, simplement moins prioritaire que le connecteur. Compte-rendu :
`docs/sessions/SESSION_2026-08-20_21_IMAP_UX.md`.

- **Migration prod** : les 9 tables `sched_*` + `sched_rate_limit_hit`,
  `campaigns.scheduling_native`, `app_settings.branding_config`,
  `interview_booking_events`, le CHECK `candidate_analyses_decision_zone_chk`
  étendu à `proposed_reject`, et **`mailboxes.folder`** (sans elle, toute
  création ou édition de boîte mail échoue en 500). Contrôle :
  `npm run check:scheduling`.
- **`NEXT_PUBLIC_APP_URL`** sur l'alias de production, et **`CRON_SECRET`**
  (fail-closed). Poser une variable ne suffit pas : Vercel les attache **par
  déploiement**, il faut redéployer.
- **Savoir qui pointe où** : `virtual-company-chi` (démo) et `orqa-bia-prod`
  (prod client) **ne partagent pas la même base**. Établir quel projet Supabase
  chaque instance interroge AVANT tout diagnostic.
- **Le signal 4 n'a aucun badge** (il vise `/settings`, qui n'est pas un onglet).
- **Une boîte au compte LENT reste irrelevable sur Vercel** : ~10 s par commande
  n'entre jamais dans `maxDuration = 60`. Aucune des trois sorties n'est du code.
- **`imap_unmatched_cvs` : 107 lignes parasites en dev**, résidu du crawl du
  20/08.

---

### 6. OUT (ne pas entamer sans décision)

- n8n / event bus externe (post-MVP).
- Cloisonnement de données par recruteur — « espace commun » est un CHOIX validé.
- **V2 du module de réservation** : synchronisation Google/Outlook, visio par
  RDV, rappels J-1, réémission automatique. La couture existe, ne pas
  l'implémenter.
- **Mode indirect ADEP sans convention signée** — le formulaire bâtirait sur une
  hypothèse (§2.4 de la spec).
- Fériés hors métropole (Alsace-Moselle, outre-mer).

---

---

## 9. Rappels d'exécution permanents

- `migrate.sql` = état final idempotent : un bloc canonique par contrainte,
  guards sur la DÉFINITION, **double application en dev avant la prod**.
- Cadrage + inventaire EXHAUSTIF des lecteurs avant de coder (réflexe DO).
- `npm run typecheck` + `npm test` avant commit ; `npm run test:regression`
  (base DEV, application fermée) avant tout push.
- Le DO pousse lui-même (`! git push origin main`).
- **Une instance Vercel ne relève JAMAIS le mail toute seule** : c'est
  **cron-job.org** qui appelle `/api/cron/imap-poll`. Son « Échec (délai
  d'attente) » à 30 s n'est pas un échec de la relève.
- **Le poller lit le dossier configuré (défaut INBOX).** Un mail de test envoyé
  *depuis* la boîte surveillée part dans `\Sent` et restera invisible.
- **Jamais deux poller sur une même base** (`next dev` local + cron déployé).
- **Le serveur de dev et `test:regression` partagent la base.** Une fixture posée
  dans un état qu'un rail de maintenance traite doit se protéger elle-même
  (cf. `docs/ops/diagnostic-s20-4-2026-09-20.md`).
- **Un identifiant de fiche de validation ne se choisit plus** : il est DÉRIVÉ du
  dossier. Une fixture qui l'invente crée une seconde fiche par candidature.
