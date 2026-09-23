# Maquette d'aménagement v2 — structure corrigée

**Date** : 20/09/2026 · **Statut** : CONCEPTION — POINT D'ARRÊT, aucun code, aucune migration.
**Remplace** : `maquette-structure-2026-09-20.md` (v1) · **Amont** : `audit-ux-2026-09-20.md`.

Maquettes en texte. Le rendu graphique vient après validation de la structure.

---

## 0. Confrontation au code — cinq résultats, dont trois qui demandent un arbitrage

### 0.1 ⛔ **Le commentaire de verdict est FACULTATIF depuis hier**

Le brief v2 écrit « verdicts à donner (**commentaire obligatoire**) ». Or l'arbitrage du
**19/09/2026** a retiré cette obligation, et la spec le dit dans ces termes :

> `docs/specs/compte-rendu-entretien.md` §16 — *« Arbitrage du 19/09/2026 — le commentaire
> devient FACULTATIF. […] l'obligation de commentaire est retirée — elle pouvait susciter des
> objections. »* Code : `verdict.ts:69` *« `null` : verdict posé sans commentaire (facultatif) »*.
> `CandidatureActions.tsx:10` : *« commentaire FACULTATIF et verdict, par la route dédiée »*.

Rétablir l'obligation serait **un changement de comportement métier**, que les garde-fous du
brief interdisent — et une inversion d'une décision prise la veille.

> **Retenu dans cette maquette : le commentaire reste facultatif.** *Aujourd'hui* dit donc
> « verdict à donner », pas « verdict à motiver ». Si l'obligation doit revenir, c'est un
> arbitrage métier à poser explicitement, pas un effet de bord d'une refonte d'écran.

### 0.2 ⛔ **La puce « À valider » compte 14 dossiers. Douze sont indécidables.**

Mesuré ce jour sur la base dev, et c'est **le point le plus important de cette relecture** :

| Mesure | Valeur |
|---|---|
| Candidatures en zone d'attente (`gray` + `proposed_reject`), `decided_by='auto'`, non classées | **14** &larr; ce que compte la puce « À valider » |
| Dont une ligne dans `pending_validations` | **2** &larr; ce que comptait le badge de l'onglet |
| Dont **aucune** ligne | **12** |

Sur ces 12, l'écran Candidatures affiche aujourd'hui, en gris italique 12 px :

> *« Validation introuvable (déjà traitée ?). »* — `GrayValidationAction.tsx:57-62`

Le dossier porte « À valider », n'est pas décidable, et le message **suggère à tort qu'il a été
traité**. Les 12 sont datés des **20 et 21/08/2026** — la fenêtre de
`docs/ops/reparation-scoring-2026-08-21.md`, dont la garantie n°1 est *« aucun envoi, jamais »* :
le re-scoring a réparé la **zone** sans **remettre en file**. (Cause à confirmer, la coïncidence
de dates est forte.)

**Précision mesurée sur les 2 dossiers qui SONT en file** : tous deux portent la zone
`proposed_reject` (uid 1903 et 1904, campagne CAMP-2026-628). D'où l'écran observé à l'audit —
sous-onglet « À examiner » à **0**, « Propositions de refus » à **2** — pendant que le badge
d'onglet annonce **2**. Corollaire à ne pas manquer : **la revue groupée ne voit que les lignes de
la file**. Les 12 hors file ne sont donc atteignables ni à l'unité, ni en fournée.

**Conséquence directe sur le brief v2.** Le v2 supprime l'onglet « Validation suspendue » et fait
de la puce « À valider » l'entrée unique. Aujourd'hui le badge affichait **2** et cachait le
problème ; demain la puce affichera **14** et l'exposera — dont **12 culs-de-sac**. La refonte
**amplifie** le défaut au lieu de le corriger.

> **Prérequis, pas un livrable UX.** Avant de retirer l'onglet, il faut décider du sort des 12.
> Deux options, l'arbitrage est métier :
> 1. **Remettre en file** (créer la ligne `pending_validations` manquante). Aucun envoi n'est
>    déclenché par une mise en file — c'est ce que fait déjà le gate. Les 12 redeviennent
>    décidables, le chiffre 14 devient vrai de bout en bout.
> 2. **Les classer** (`sans_suite`, raison « campagne clôturée » ou « sans réponse »). Ils
>    sortent du compte, la puce retombe à 2.
>
> **Ne rien faire n'est pas une option** : la structure v2 rend ces 12 dossiers visibles et
> cliquables, donc leur impasse aussi.

### 0.3 ✅ **Supprimer la file du vivier est sans risque métier — sous une condition**

Vérifié : la présélection persistante (`runAndPersistPreselection`, qui crée les lignes
`identified`) n'est appelée que par **une seule route**,
`POST /api/campaigns/[id]/vivier-preselection`, elle-même déclenchée **uniquement** par le
panneau vivier d'une campagne. **Aucun déclenchement automatique à l'activation** — contrairement
à ce que laisse entendre la documentation. Toute ligne `identified` naît donc déjà d'un humain
dans un écran de recherche : **décider sur place est une relocalisation, pas un changement de
règle.**

Deux réserves :

- **Le mode `auto` existe** (`vivier-settings.ts:15,76` — `contactMode: 'manual' | 'auto'`, défaut
  `manual`). En `auto`, `autoContactIfEnabled` envoie l'invitation sans file **ni écran**. La
  décision sur place ne concerne donc que le mode `manual` ; le mode `auto` continue d'exister et
  **ne passe par aucun écran** — à dire dans les Réglages.
- **1 ligne `identified` est en attente dans la base dev.** Supprimer l'onglet sans destination
  la rendrait inatteignable. Elle doit réapparaître dans la recherche vivier de sa campagne.

### 0.4 ⚠️ **« Sourcer sur LinkedIn » promet une intégration qui n'existe pas — et qui est interdite**

Le module Sourcing porte un interdit non négociable : *« aucun accès direct à LinkedIn, aucun
enrichissement tiers, aucun envoi automatique vers une personne sourcée, sur aucun canal »*
(`docs/specs/sourcing.md`). Ce qu'il fait : interroger un index de **profils professionnels
publics** (Exa), l'humain arbitre, **l'humain approche lui-même** en copiant son message.

Un bouton « **Sourcer sur LinkedIn** » se lit comme « ORQA va sur LinkedIn pour moi ». C'est la
même famille de défaut que « Refus auto » (audit §1-C) : un libellé qui décrit un comportement
que le produit n'a pas.

> **Proposé : « Approcher des profils »**, avec sa ligne d'état qui dit la vérité du geste —
> *« 6 approches préparées, 2 réponses — vous envoyez vous-même »*. Le mot « LinkedIn » reste
> dans l'écran de résultats, où il décrit la **source** des profils, pas un canal d'envoi.

### 0.5 ⚠️ **Deux compteurs de la carte campagne ne peuvent pas porter le mot de leur destination**

Le brief demande que chaque compteur soit un lien « avec **LE MÊME MOT** que la puce de
destination ». Deux d'entre eux ne le peuvent pas en l'état, parce qu'ils comptent une
**trajectoire**, pas une **étape** :

| Compteur de carte | Ce qu'il compte aujourd'hui | Puce de destination | Cas mesuré |
|---|---|---|---|
| Shortlistés / Invités | ceux qui **sont passés par** l'invitation, y compris ceux qui ont avancé depuis (`everInvited`, `CampaignCard.tsx:38`) | « Invité » = étape **courante** | **CAMP-2026-221 : la carte affiche 2. Les deux candidats sont aujourd'hui « RDV pris » et « Retenu ». La puce « Invité » de cette campagne affiche donc 0.** |
| Entretiens | ceux qui **sont passés par** l'entretien (`everInterviewed`) | « Entretien fait » = étape courante | même mécanique |

Cliquer « **Invités 2** » et atterrir sur une liste « Invité » **vide** est pire que deux mots
différents. Il faut trancher, et l'écrire une fois pour toutes (§B.1).

### 0.6 ✅ Ce qui est confirmé sans réserve

- **Candidatures et Entretiens reçoivent déjà des filtres** : `CandidaturesWorkspace` accepte
  `initialCampaignId` / `initialStage` / `everInvited` / `everInterviewed`, et
  `GET /api/interviews?campaignId=` existe **déjà** (`api/interviews/route.ts:25`). Le livrable E
  est donc bien « ajouter la réception par URL », pas « ajouter le filtrage ».
- **La suite de régression S1 → S25 ne bouge pas** : elle traverse les routes API, **zéro import
  de `components/`**. Aucune route `/api/*` n'est déplacée par cette maquette.
- **Il n'existe aucune URL dans le produit** (v1 §0.1) : les 8 onglets et tous les sous-onglets
  sont dans un `useState`, le seul `router.push` mène à `/settings`. C'est ce qui rend
  impossible, aujourd'hui, le « lien vers la vue filtrée » sur lequel repose tout le v2.
- **Fenêtre APEC** : la republication ferme **30 jours après la publication**
  (`REPUBLISH_WINDOW_DAYS`), et le signal s'allume **7 jours avant** la fermeture
  (`apecRepublishWarningDays: 7`), soit vers J+23 — pas à J+30.
- **« Campagne sans candidat depuis N jours » n'existe pas** : à ajouter au registre
  (une entrée, §A.4).

---

## 1. Navigation cible — 5 entrées

```
/rh/recrutement                    → redirige vers /aujourdhui

  Aujourd'hui   Campagnes   Candidatures   Entretiens   Pilotage        [⚙]
  ▔▔▔▔▔▔▔▔▔▔▔
  défaut
```

| Entrée | Route | Nature |
|---|---|---|
| **Aujourd'hui** | `/aujourdhui` | l'écran nouveau : ce qui attend une action |
| **Campagnes** | `/campagnes` (+ `/nouvelle`, + carte dépliée) | l'objet, en hub |
| **Candidatures** | `/candidatures?campagne=…&statut=…` | **LA** vue des candidatures, conservée |
| **Entretiens** | `/entretiens?campagne=…&section=…` | **LA** vue des entretiens, conservée |
| **Pilotage** | `/pilotage` | reporting, KPI, agents, répartition |
| Réglages | `/settings` | hors navigation, par l'engrenage |

**Disparaissent du premier niveau** — et rien n'est supprimé :

| Onglet retiré | Où va son contenu |
|---|---|
| **Bureau** | devient *Aujourd'hui* ; agents + répartition &rarr; *Pilotage* |
| **Validation suspendue** | puce « À valider » de Candidatures (unitaire) + **mode groupé** pour les propositions de refus &mdash; ⛔ **sous réserve du §0.2** |
| **Validations vivier** | absorbé par la recherche vivier d'une campagne (décision sur place) |
| **Sourcing** | bouton « Approcher des profils » de la carte campagne |

**Routes redirigées** : `/validations` &rarr; `/candidatures?statut=a_valider` ·
`/validations-vivier` &rarr; `/campagnes` · `/reporting` &rarr; `/pilotage` ·
`/vivier` &rarr; `/pilotage/vivier` (ou `/candidatures/vivier`, §G-Q3).
**Supprimée** : `/candidatures-apercu` (aperçu jetable, marqué « À SUPPRIMER » dans son en-tête).

---

## A. *Aujourd'hui* — l'écran nouveau

**Principe verrouillé n°1 appliqué** : une section = une nature d'action = un verbe. Aucune
section ne mélange des dossiers appelant des gestes différents.

### A.1 Maquette

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ORQA    Lobby › RH › Recrutement                                    [⚙]  [Compte]    │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  Aujourd'hui   Campagnes   Candidatures   Entretiens   Pilotage                      │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Vendredi 20 septembre                              Référent : [ Mes campagnes ▾ ]   │
│  Bonjour Imad. 6 choses vous attendent.                                              │
│                                                                                      │
│  ── À DÉCIDER ────────────────────────────────────────────────────── 2 ──────────────│
│     Arbitrer une candidature dont le score est dans la bande de validation.          │
│                                                                                      │
│    9 j   Mila Renard               72   Directeur de Dépt. Ops. · CAMP-2026-221      │
│                                                        [ Voir le dossier ] [ Décider ]│
│    4 j   Sonia Berthet             62   Ingénieur data · CAMP-2026-991               │
│                                                        [ Voir le dossier ] [ Décider ]│
│                                   → Toutes les candidatures à valider (Candidatures) │
│                                                                                      │
│  ── PROPOSITIONS DE REFUS ────────────────────────────────────────── 1 ligne ────────│
│     Passer en revue en une fois les dossiers sous le seuil bas.                      │
│                                                                                      │
│    N candidatures à passer en revue — la plus ancienne depuis 31 jours               │
│                                                          [ Ouvrir la revue groupée ] │
│                                                                                      │
│  ── ENTRETIENS ───────────────────────────────────────────────────── 2 ──────────────│
│     Pointer ce qui s'est passé, puis donner le verdict.                              │
│                                                                                      │
│    hier  Damois Bernard      Entretien du 18 sept. 10:00 — non pointé                │
│                       [ Entretien réalisé ]  [ Candidat absent ]  [ Sans suite ]     │
│    3 j   Molika Khuon        Entretien réalisé — verdict attendu                     │
│                                                       [ Donner le verdict ]          │
│                                                     → Tous les entretiens (Entretiens)│
│                                                                                      │
│  ── À VÉRIFIER ───────────────────────────────────────────────────── 1 ──────────────│
│     Des réglages ou des campagnes qui vont poser problème. Jamais un candidat.       │
│                                                                                      │
│    11 nov.  4 jours fériés restent proposables aux candidats sur votre agenda        │
│                                                      [ Ouvrir mes disponibilités ]   │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

> **Les lignes ci-dessus sont ILLUSTRATIVES** (la maquette montre une mise en page peuplée).
> **État réel de la base dev ce jour**, mesuré : *À décider* **0** &middot; *Propositions de refus*
> **2 en file** (+ **12 hors file**, cf. §0.2) &middot; *Entretiens* **1 à pointer** (Damois Bernard,
> 18 sept. 10:00) **+ 1 verdict** (Molika Khuon) &middot; *À vérifier* **1**.
> Le détail du §0.2 tient dans ces chiffres : la file HITL et la puce « À valider » ne décrivent
> pas la même population — **les 2 dossiers de la file sont tous deux `proposed_reject`, donc le
> sous-onglet « À examiner » affiche 0** pendant que le badge d'onglet annonce 2.

### A.2 Les quatre sections

| Section | Verbe | Format | Comportement à zéro |
|---|---|---|---|
| **À décider** | *arbitrer* | **unitaire** — une ligne = un dossier, plafond 5 + « voir les N autres » | *« Aucune candidature à arbitrer. »* |
| **Propositions de refus** | *passer en revue* | **UNE ligne agrégée**, jamais une ligne par candidat | *« Aucune proposition de refus en attente. »* |
| **Entretiens** | *pointer*, puis *donner le verdict* | **unitaire**, à pointer d'abord, verdicts ensuite | *« Aucun entretien à pointer ni verdict à donner. »* |
| **À vérifier** | *corriger* | unitaire, **jamais mélangée aux candidats** | *« Rien à vérifier. »* |

**À zéro partout : une phrase, pas une carte vide.** Si les quatre sont vides :

```
  Rien ne vous attend. Bonne journée.
  15 campagnes tournent, 12 candidatures sont arrivées cette semaine.
```

Si le filtre référent masque tout — et **seulement** dans ce cas :

```
  Rien ne vous attend pour vos campagnes.
  4 dossiers attendent d'autres recruteurs.        [ Voir tout ]
```

Si aucune campagne n'existe (seul parcours de première fois, disparaît après la première) :

```
  Aucune campagne pour l'instant.
  Une campagne, c'est un poste à pourvoir : sa fiche, sa grille d'évaluation, et par où
  les CV arrivent. Comptez cinq minutes.          [ Créer ma première campagne → ]
```

### A.3 Pourquoi cet ordre

1. **À décider** — seul coût **externe** : une personne attend, et depuis le 18/08 aucun refus ne
   part seul : sans ce geste, le dossier n'a pas de fin.
2. **Propositions de refus** — même nature mais **geste de masse** : une ligne, un écran dédié.
   Les mélanger violerait le principe n°1.
3. **Entretiens** — coût **interne** : rien ne se dégrade côté candidat, mais la frise, le rapport
   et le signal restent bloqués.
4. **À vérifier** — coût **futur et silencieux** : aucun symptôme jusqu'à l'incident.

**Hors d'*Aujourd'hui*** : agents, répartition par zone, KPI, taux, conversion &rarr; *Pilotage*.

### A.4 Source de chaque ligne

| Ligne | Origine | Signal existant ? |
|---|---|---|
| À décider | `pending_validations` (`pending`/`sending`) &times; zone `gray` | `pending_validations_overdue` ✅ |
| Propositions de refus (agrégat) | même table, zone `proposed_reject` (`partitionRejectionProposals`) | ✅ (même signal, à scinder) |
| Entretien à pointer | `interview_briefs` `scheduled` &times; fin &lt; now &minus; 24 h &times; étape ∈ {invite, rdv_pris} | `interviews_awaiting_pointing` ✅ |
| Verdict à donner | étape `entretien_fait` | `interviews_awaiting_decision` ✅ |
| Jours fériés proposables | règles &times; `french-holidays` | `availability_holidays_unblocked` ✅ *(personnel)* |
| Lieu d'entretien manquant | ressource sans lieu complet | `availability_meeting_location_missing` ✅ *(personnel)* |
| Offre APEC à republier | `job_postings` — fenêtre 30 j, alerte à 7 j restants | `apec_republication_window_closing` ✅ |
| Offre APEC en ligne sur campagne clôturée | idem | `apec_offer_live_on_closed_campaign` ✅ |
| Lien de réservation orphelin | cibles sans référent actif (`pipeline.ts`) | ⚠️ existe comme **bandeau**, pas comme signal |
| **Campagne sans candidat depuis N j** | campagne `active`, aucune analyse depuis N j | ❌ **à créer** |
| **Campagne active sans canal d'arrivée** | campagne `active` et `sources = []` | ❌ **à créer** — elle ne recevra jamais rien, et rien ne le dit |

Ajouter un signal = **une entrée** dans `BUSINESS_SIGNALS` ; ni route ni composant ne changent.

### A.5 Deux garde-fous

1. **« À vérifier » n'est jamais filtré par référent.** Le filtre réduit les **dossiers**. Garde
   structurelle à étendre : `components/referent/__tests__/surfaces.test.ts`.
   ⚠️ Ne pas confondre avec la **portée personnelle** des deux signaux d'agenda (`personal: true`)
   — un agenda est un réglage individuel, c'est un autre axe, il reste tel quel.
2. **Aucune action en un clic sur un geste qui écrit au monde.** « Décider » **ouvre** la carte
   avec la relecture du mail. « Candidat absent » garde son dialogue : le no-show **est** une
   décision (invariant du module Entretiens), pas un constat.

---

## B. Carte campagne dépliée — retravaillée, pas refaite

La liste dépliable actuelle (`CampaignsList` + `CampaignCard`) est **conservée**. Seul le contenu
déplié change.

### B.1 D'abord, trancher la sémantique des compteurs *(cf. §0.5)*

| Option | Ce que ça donne | Coût |
|---|---|---|
| **A — étape courante** *(recommandée)* | « Invités 0 · En entretien 1 · Retenus 1 » : le mot, le chiffre et la destination coïncident **toujours**. On perd la lecture « combien sont passés par là ». | changer le préset des liens ; la trajectoire déménage en **Pilotage**, où elle est à sa place |
| B — trajectoire, avec un autre mot | « Passés par l'invitation 2 » &rarr; liste `everInvited`. Exact, mais réintroduit deux vocabulaires. | contredit le principe « un mot par étape » |

> **Retenu : option A.** Les compteurs de la carte deviennent des **états courants**, un mot, un
> chiffre, une destination. La notion de trajectoire (« combien ont été invités en tout ») est
> une **mesure de performance** : sa place est le rapport de campagne, pas la carte.

### B.2 Maquette du contenu déplié

```
  CAMP-2026-221  Directeur de Département Opérations Industrielles (H/F)   ● Active   ▴
  ────────────────────────────────────────────────────────────────────────────────────
   ① COMPTEURS-FILTRES  (chaque chiffre est un lien ; même mot que la puce de destination)

     12 Reçues      2 À valider      0 Invité      1 RDV pris      1 Retenu
     ↳ Candidatures ↳ Candidatures   ↳ Candidatures ↳ Entretiens   ↳ Candidatures
       campagne       campagne         campagne       campagne       campagne
                      + À valider      + Invité       + programmés   + Retenu

   ② CE QUI ATTEND   (deux lignes maximum)

     2 candidatures à valider — la plus ancienne depuis 9 jours      → Candidatures ↗
     1 entretien passé sans pointage                                 → Entretiens ↗

   ③ TROUVER DES CANDIDATS

     [ Diffuser l'annonce ]        publiée sur l'APEC le 14/09 — republiable jusqu'au 4/10
     [ Chercher dans le vivier ]   3 profils du vivier inclus · 1 contact à approuver
     [ Approcher des profils ]     6 approches préparées, 2 réponses — vous envoyez vous-même

   ④ ACTIONS

     [ Suspendre ]   [ Clôturer ]   [ Réglages ]
```

### B.3 Ce qui sort de la carte

| Sort | Va où | Pourquoi |
|---|---|---|
| Taux GO, Conversion globale | **Pilotage** | Ce sont des mesures, pas des points d'entrée |
| Bloc « Détails » | **Pilotage** | idem |
| Arrivée des candidatures | derrière **Réglages** | Configuration, pas pilotage |
| Évaluation (critères, seuils) | derrière **Réglages** | idem |
| **La duplication des 4 chiffres** (en-tête + corps, audit §2.2) | **supprimée** | Les mêmes nombres affichés deux fois sous deux noms |

### B.4 Le bloc ③ n'existe que sur une campagne **validée**

Principe n°4 : *constituer, puis alimenter*. Les trois boutons apparaissent une fois la campagne
prête à recevoir. Sur un brouillon, le bloc est **présent et parlant**, jamais masqué en silence
— c'est déjà la règle de `PostActivationPanels` :

```
   ③ TROUVER DES CANDIDATS
     Disponible dès que la campagne est activée. Une candidature reçue sur une campagne
     en brouillon n'est pas analysée : rien ne part avant.        [ Activer la campagne ]
```

---

## C. Assistant de création

`/campagnes/nouvelle` — une décision par étape, « Suivant » bloqué tant que l'étape n'est pas
valide, retour possible sans perte, **composants de l'ÉDITION réutilisés**.

```
  ●───────○───────○───────○───────○───────○
  Poste  Critères Réception Seuils   RDV   Récap        Étape 1 sur 6
```

| # | Étape | Bloquante | Contenu | Composant réutilisé |
|---|---|---|---|---|
| 1 | **Le poste** | oui | intitulé, puis les 8 champs de la fiche, **marqués obligatoires**, compteur « 5 sur 8 », « Proposer la fiche », porte « démarrer d'un document » | `JobTitleStep`, `FDPInlineEditor` |
| 2 | **Les critères** | non (pré-remplie) | grille, niveaux, poids. **Bloque si** des pondérations suggérées par l'IA restent à traiter | `ScoringDraftEditor` |
| 3 | **La réception** | **oui — ≥ 1 canal** | dépôt manuel · boîte mail (+ boîtes) · vivier. Les 6 flux non branchés : **listés, non cochables** | `FluxDraftEditor`, `MailboxPicker` |
| 4 | **Seuils & référent** | non (défauts) | curseur (**« Proposé au refus »**, jamais « Refus auto »), référent (défaut : vous) | **`DecisionThresholdsBlock`** (celui de l'édition, au texte juste), `OwnerDraftEditor` |
| 5 | **Réservation d'entretien** | non (défaut) | régime + lieu | `SchedulingDraftEditor` |
| 6 | **Récapitulatif** | — | les 5 étapes résumées, chacune modifiable ; dit ce qui se passe à l'activation | **neuf** (~120 lignes) |

**Pas de canaux de diffusion, pas d'annonce dans l'assistant** — c'est la phase 2.

### C.1 Écran de sortie

```
  ✓  CAMP-2026-419 « Chef de projet SI » est prête à recevoir.
     Les CV envoyés à recrutement@… avec la référence CAMP-2026-419 en objet seront
     analysés dans la minute.

     Maintenant, trouvez des candidats :

     [ Chercher dans le vivier ]   38 profils correspondent déjà chez vous
     [ Diffuser l'annonce ]        rédiger et publier l'annonce
     [ Approcher des profils ]     chercher des profils publics, vous les contactez

                                                   [ Plus tard — voir la campagne ]
```

Le vivier est en **premier** et porte son chiffre : c'est le seul des trois qui donne un résultat
immédiat, sans rien publier ni écrire à personne.

### C.2 Provenance des pré-remplissages

| Champ | Provenance | Marquage | État |
|---|---|---|---|
| Intitulé, nom de campagne | saisie / dérivé de `job_title` | — | ✅ |
| Fiche, grille, flux, seuils | **campagne comparable** | bandeau « Repris de CAMP-… » + « Repartir à zéro » | ✅ |
| Champs factuels, pondérations | **document déposé** | bandeau, ⓘ extrait, « Suggéré par l'IA » &rarr; bloque l'activation | ✅ |
| Fiche / grille par « Proposer » | **IA, opt-in** | *rien* | **à combler** |
| 3 critères initiaux | gabarit en dur | *rien* | **à combler** — « modèle de départ » |
| Seuils 10 / 90 | défaut produit | *rien* | **à combler** — écrire le défaut |
| Référent | le créateur | « vous, par défaut » | ✅ |

⚠️ **Trou de fond** (mémoire `project_suggere_gap`) : le drapeau `suggere` n'est posé que par le
chemin « document déposé ». « Proposer la grille » et la campagne comparable injectent des
pondérations **sans marquage, donc sans confirmation exigée** — incohérence de **traitement**,
pas d'affichage. L'assistant la rend visible : trois provenances, un seul traitement.

---

## D. Lexique appliqué

### D.1 Les sept étapes — un mot, partout

`À valider` · `Invité` · `RDV pris` · `Entretien fait` · `Retenu` · `Non retenu` · `Sans suite`

Ces sept mots valent pour : les puces de Candidatures, les compteurs de la carte campagne, les
sections d'*Aujourd'hui*, les filtres d'URL, le Manager et sa cartographie, le PDF d'audit, les
rapports.

### D.2 Ce qui disparaît

| Disparaît | Remplacé par | Pourquoi |
|---|---|---|
| **GO**, **GO définitif** | **Retenu** | Jargon interne ; le ruban dit déjà « Retenu » |
| **Shortlistés** | **Invité** (étape courante, §B.1) | Deux mots, une réalité, et des chiffres qui ne coïncident pas |
| **Taux GO** | *(part en Pilotage)* | Une mesure, pas un état |
| **Validation suspendue** | **À valider** (puce) + **Propositions de refus** (revue) | Rien n'est suspendu ; ce sont deux gestes différents |
| **Refus auto** *(curseur de création)* | **Proposé au refus** | Le refus automatique n'existe plus depuis le 18/08 |
| **Refus auto** *(puce d'historique)* | **Refusé** | Ces refus sont **réellement partis** avant la bascule : ils sont clos, pas en attente |
| **Validations vivier** | **Contacts à approuver**, dans la recherche | Une décision se prend là où on la comprend |
| **Sourcer sur LinkedIn** | **Approcher des profils** | ORQA n'accède pas à LinkedIn, et se l'interdit (§0.4) |
| **Fiche de scoring** | **Grille d'évaluation** | « Scoring » n'est pas du français RH |
| **Flux de réception** / **sources de réception** | **Réception des candidatures** | Deux noms pour un objet, dont un seul apparaît à l'écran |
| **Bureau** | **Aujourd'hui** | Nomme ce qu'on y fait |
| **Manifesté** *(sourcing)* | **A répondu** | Terme de modèle |

### D.3 Dette à solder dans le même geste

`manager-cartography.ts` est **déjà périmé sur 6 points** sans qu'aucune refonte ait eu lieu, et
son propre en-tête prévient : *« un chemin faux ici se traduit par une orientation fausse côté
donneur d'ordre »*. Il se réécrit avec cette carte **et** reçoit un **test de non-divergence**
entre les libellés du code et ceux de la cartographie. Sans ce test, la dérive recommence.

---

## E. Candidatures et Entretiens — conservés

**Aucun changement de structure.** Trois ajouts seulement.

### E.1 Réception des filtres par URL

```
/candidatures?campagne=CAMP-2026-221&statut=a_valider
/entretiens?campagne=CAMP-2026-221&section=a_pointer
```

Le filtre reçu s'affiche **en tête, visible et retirable**, avec le retour en un clic :

```
  Candidatures                                                    59 candidatures
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ Filtré :  CAMP-2026-221 ✕   ·   À valider ✕        [ Voir toutes ]        │
  └──────────────────────────────────────────────────────────────────────────┘
  [ruban des 7 étapes — inchangé]
```

Côté code, le filtrage existe déjà : `CandidaturesWorkspace` prend `initialCampaignId` /
`initialStage` / `everInvited` / `everInterviewed`, et `GET /api/interviews?campaignId=` est
**déjà** servi. Le travail est la **lecture de l'URL** et le **bandeau de filtre**, pas le filtre.

### E.2 Accès au mode groupé depuis la puce « À valider »

La puce « À valider » agrège les deux zones (`isAwaitingHumanZone` = `gray` ∪ `proposed_reject`).
Quand des propositions de refus sont présentes, la liste porte en tête :

```
  Dont N propositions de refus (sous le seuil bas)      [ Passer en revue en une fois → ]
```

⛔ **Ne pas livrer avant l'arbitrage du §0.2** : aujourd'hui 12 des 14 dossiers de cette puce
n'ont pas de ligne en file et affichent « Validation introuvable (déjà traitée ?) ».

### E.3 Lexique appliqué aux puces

Sept mots (§D.1), et « Refus auto » &rarr; « Refusé ».

---

## F. Migration et chemins critiques

### F.1 Composants

| Verdict | Lesquels |
|---|---|
| **Conservés sans modification** | `CandidaturesWorkspace` et ses 10 composants, `CandidatureRow/Panel/FullPage`, `CandidaturesRibbon/Filters`, `InterviewsWorkspace` et ses 6 listes, `NoShowDialog`, `InterviewDecisionBlock`, `InterviewReport*`, `CorrectDecision*`, `ValidationCard`, `RejectionProposalsTab`, `BulkRejectDialog`, `CampaignDismissFlowDialog`, `ApecPanel`, `GenericJobAdPanel`, `SourcingCampaignView`, `ReportingHub`, `SettingsHub`, `CampaignEditAccordion` |
| **Conservés + lecture d'URL** | `CandidaturesWorkspace`, `InterviewsWorkspace` (bandeau de filtre + `useSearchParams`) |
| **Retravaillés** | `CampaignCardBody` (4 blocs, duplication retirée), `CampaignsWorkspace` (double titre), `VivierPreselectionPanel` (décision sur place) |
| **Refaits** | `WorkspacePane` &rarr; routeur à 5 entrées ; `CampaignCreateSheet` (**1 695 lignes** &rarr; assistant de 7 composants ≤ 200, règle projet) |
| **Nouveaux** | `TodayBoard` + ses 4 sections ; le récapitulatif de l'assistant ; le bandeau de filtre partagé |
| **Déplacés** | `HRDepartmentView` + `AgentDetailsPanel` + `ZoneDistribution` + `BureauPulse` &rarr; *Pilotage* ; `VivierValidationsWorklist` &rarr; absorbé |
| **Supprimés** | `/candidatures-apercu` ; la liste de campagnes du Sourcing (c'est `/campagnes`) |

### F.2 Routes

| | |
|---|---|
| **Créées** | `/aujourdhui` · `/campagnes` · `/campagnes/nouvelle` · `/candidatures` · `/entretiens` · `/pilotage/*` |
| **Redirigées** | `/validations` · `/validations-vivier` · `/reporting` · `/vivier` |
| **Supprimée** | `/candidatures-apercu` |
| **Inchangées** | **toutes les `/api/*`**, `/settings`, `/admin/*`, `/r/`, `/b/`, `/s/`, `/jobs/`, `/login` |

⚠️ Le proxy est une **liste blanche de préfixes** (`['/app','/rh','/settings','/validations','/admin']`).
Les nouvelles pages restent sous `/rh/recrutement/…` : couvertes sans modification. Un module
sorti de `/rh` deviendrait **public par défaut**.

### F.3 Tests

| Suite | Impact |
|---|---|
| **Régression S1 → S25** | **aucun** — routes API, zéro import de `components/` |
| Tests purs `lib/` | aucun — aucune logique métier déplacée |
| `campaign-create-sheet.test.ts` | **à réécrire** (`nextOpenSection` disparaît, `deriveCampaignName` reste) |
| `referent/__tests__/surfaces.test.ts` | **à étendre** — la garde « les alertes ne sont jamais filtrées » doit couvrir *Aujourd'hui* |
| `stage-ui.test.ts` + 12 autres | aucun |
| **À ajouter** | routeur (un écran = une adresse) · carte ↔ cartographie du Manager · sémantique des compteurs de carte (§B.1) |

### F.4 Signaux et cartographie

`BusinessSignalTarget` (union de 4 formes) devient **une route**. 7 cibles à réécrire, vérifiées à
la compilation ; les 2 cibles APEC **gagnent en précision** (elles pointent aujourd'hui la racine
du workspace sans dire quelle campagne). 2 signaux à ajouter (§A.4).
`manager-cartography.ts` réécrit + test de non-divergence (§D.3).

### F.5 Estimation

| Lot | Contenu | Poids | Bloque |
|---|---|---|---|
| **M0 — Squelette adressable** | routeur à 5 entrées, redirections, proxy vérifié, lecture d'URL + bandeau de filtre | **M** | tout |
| **M1 — *Aujourd'hui*** | `TodayBoard`, 4 sections, 2 signaux, états à zéro, garde « À vérifier » | **M** | — |
| **M2 — Carte campagne** | 4 blocs, sémantique tranchée (§B.1), duplication retirée, 3 boutons de sourcing | **S** | — |
| **M3 — Assistant** | 6 étapes + récap + écran de sortie, découpe des 1 695 lignes, 3 trous de provenance | **L** | — |
| **M4 — Vivier sur place** | décision dans la recherche, retrait de l'onglet, reprise de la ligne en attente | **S** | — |
| **M5 — Lexique & cartographie** | 7 mots partout, cartographie réécrite, test de non-divergence | **S** | après M1-M4 |
| **P0 — Prérequis métier** | **arbitrage du §0.2** (les 12 indécidables) et du §0.1 (commentaire) | — | **M1, E.2** |

**Ordre** : P0 &rarr; M0 &rarr; M1 &rarr; (M2, M3, M4) &rarr; M5.
**M0 + M1 = le minimum démontrable** : c'est le chemin (a) qui passe de 5 à 2 clics.

### F.6 Les trois chemins critiques, mesurés

Depuis l'ouverture de session. Aujourd'hui la connexion dépose sur `/app` (`next-path.ts:11`) ;
dans la cible, sur `/aujourdhui`.

**(a) Valider un candidat** — le test de la refonte

| Aujourd'hui | Cible |
|---|---|
| 1. Lobby &rarr; Entrer (RH) | *L'écran ouvre sur Aujourd'hui : le dossier est visible* |
| 2. RH &rarr; Ouvrir (Recrutement) | 1. « Décider » sur la ligne &rarr; la carte s'ouvre avec la relecture du mail |
| 3. Onglet « Validation suspendue » | 2. « Accepter » / « Refuser » |
| 4. Sous-onglet « Propositions de refus » ⚠️ *l'onglet ouvre sur une liste vide* | |
| 5. Action sur la carte | |
| **5 clics, dont 4 de navigation** | **2 clics, dont 0 de navigation** |

**&minus;60 %, navigation à zéro.** La revue groupée passe de **6 à 2**.

**(b) Créer une campagne**

| | Aujourd'hui | Cible |
|---|---|---|
| Navigation | 3 | **1** |
| Ouverture | 1 | 1 |
| Saisie | 6 dépliages à l'aveugle + jusqu'à 7 « Enregistrer » qui n'enregistrent rien | **5 « Suivant »** |
| Fin | Créer + Activer (2) | **Créer et activer (1)** |
| **Nominal** | **~13** | **8** |
| **Observé en démonstration** | **18–20** + une explication orale (Créer &rarr; « Compléter la campagne » &rarr; retrouver la section &rarr; recommencer) | **8** — l'échec est impossible : « Suivant » ne laisse pas passer une étape invalide |

**&minus;38 % en clics, et surtout la disparition du chemin d'échec** — c'est le défaut n°1.

**(c) Pointer un entretien**

| Aujourd'hui | Cible |
|---|---|
| 1. Lobby &rarr; RH · 2. &rarr; Recrutement · 3. Onglet Entretiens · 4. Action de ligne | *Aujourd'hui, section Entretiens* &rarr; **1 clic** (« Entretien réalisé ») |
| **4 clics, dont 3 de navigation** | **1 clic** — ou **2** pour « Candidat absent », dont le dialogue reste : c'est une décision, pas un constat |

**&minus;75 %.**

---

## G. Ce qui reste à trancher

| # | Question | Pourquoi ça ne se décide pas dans une maquette |
|---|---|---|
| **Q1** | **Les 12 dossiers « À valider » indécidables** (§0.2) — remettre en file, ou classer sans suite ? | Arbitrage métier sur des dossiers réels. **Bloque** la suppression de l'onglet. |
| **Q2** | **Le commentaire de verdict** (§0.1) — le brief le dit obligatoire, l'arbitrage du 19/09 l'a rendu facultatif. Lequel fait foi ? | Changement de comportement métier, interdit par les garde-fous. La maquette retient *facultatif*. |
| **Q3** | **Le vivier** — sous *Pilotage*, sous *Candidatures*, ou seulement depuis la carte campagne ? | Le v2 ne lui donne plus d'onglet, mais le dépôt et la recherche libre doivent rester atteignables. |
| **Q4** | **Volume** — *Aujourd'hui* liste les dossiers (plafond 5 + « voir les N autres »). Quel volume réel en cabinet&nbsp;? | À 40 dossiers, une liste devient un mur ; à 3, un compteur serait du gâchis. |
| **Q5** | **La scène des 6 agents** — elle part en *Pilotage* et quitte l'ouverture de démonstration, alors que c'est elle qui fait l'effet « une équipe au travail » face à Limova. | **Arbitrage commercial, pas UX.** Alternative : bandeau compact en pied d'*Aujourd'hui*. |
| **Q6** | **Le Lobby et le portail RH** restent-ils sur le chemin&nbsp;? La maquette les garde (mimétique « entreprise virtuelle ») mais **hors du chemin quotidien** : la connexion dépose sur *Aujourd'hui*. | Différenciateur produit assumé. |

---

## H. Ce qui ne change pas

Trois zones de décision et leurs seuils · HITL et ses claims deux-phases · machine d'états du
cycle de vie · invariants du module de réservation · « classée sans suite » orthogonale au refus ·
« corriger = poser un nouveau marqueur » · frontière d'autonomie de `src/lib/scheduling/**` ·
purge RGPD · idempotence des envois · **commentaire de verdict facultatif** (§0.1).
**Toutes les routes `/api/*` restent identiques** — c'est ce qui rend S1–S25 insensible à cette
refonte, et la garantie que réorganiser l'accès ne peut pas casser le métier.

---

## I. Règle de composition — deux composants, et pas un troisième (21/09/2026)

**Un écran ne crée JAMAIS son composant de navigation ni son compteur.** Il prend l'un des deux
qui existent :

| Besoin | Composant | Fichier |
|---|---|---|
| Basculer de vue | **Puces à point coloré** | `src/components/ui/DotTabs.tsx` |
| Montrer des volumes | **Cartes-compteurs soulignées** | `src/components/ui/CounterRibbon.tsx` |

**Pourquoi.** Le produit en avait quatre formes pour le même geste : les puces de la liste des
campagnes, une barre segmentée inventée pour *Pilotage*, une barre soulignée pour le *Vivier* et
les *Validations*, une rangée d'onglets pour *Entretiens*. D'un écran à l'autre, on ne
reconnaissait plus la chose qui fait changer de vue — et chaque nouvelle forme rendait la
suivante plus facile à justifier.

**Contraintes portées par les composants eux-mêmes :**

- **Le point coloré n'est pas un ornement** : c'est le même repère de couleur que la pastille
  d'état d'une ligne, le soulignement d'une carte-compteur et les segments de l'entonnoir.
- **Une carte-compteur n'a que deux rangs** : un chiffre, un libellé. **Jamais une troisième
  ligne.** Une précision tient DANS la deuxième ligne, en pastille poussée à droite
  (`CountBadge`, celle des onglets de navigation) ; une carte qui n'en a pas n'affiche rien à
  droite et ne réserve aucune place. Toutes les cartes d'un ruban ont la même structure et la
  même hauteur.
- **Le chiffre est FACULTATIF** : une bascule de vue qui ne compte rien (les vues de *Pilotage*)
  prend le même ruban sans chiffre — le libellé et le point coloré suffisent. Le composant
  l'accepte ; on ne le recopie pas pour ça.
- **La couleur vient des composants existants**, jamais d'un aplat local : entonnoir en segments
  (`SegmentedCounts`, la géométrie du mini-pipeline de *Candidatures*) à la place de nombres gris,
  pastille d'état colorée, soulignement de carte.
- **Aucune ombre portée** sur un élément du flux ; la sélection se marque par la bordure et le
  fond. Une ombre n'informe que sur une couche flottante (dialogue, liste déroulante).

### La navigation passe en COLONNE (lot 8, 21/09/2026)

La barre d'onglets horizontale devient une **colonne à gauche**, montée par la coquille du
workspace — **les pages ne changent pas**. Trois rangs, et ils ne se ressemblent pas :

| Rang | Contenu | Rendu |
|---|---|---|
| ① | **Aujourd'hui** — le point de départ | une **icône de maison** (`#fedc96`), **sans libellé** et **sans rendu d'onglet** : ni pastille, ni fond. L'état actif ne se marque que par le poids du trait |
| ② | Campagnes · Candidatures · Entretiens · Pilotage | rendu d'onglet, pastille active = celle des cartes-compteurs (`SELECTION`, **mêmes valeurs importées**), badges existants alignés à droite |
| ③ | **Paramètres**, en bas | la roue dentée quitte la barre du haut, mais ne rejoint pas les quatre |

La barre du haut garde le logo, *Lobby / RH / Recrutement* et le compte. **Repli sous
1 100 px** : icônes seules, libellés en infobulles, le contenu garde son cadre de 1 400 px.
Le repli est en **CSS pur** — piloté en JavaScript, il montrerait la version large pendant
une frame au chargement.

**Clavier** : Tab et Entrée viennent des liens ; les **flèches** haut/bas déplacent le
focus, comme dans un menu. `aria-current="page"` marque l'entrée active — c'est ce que lit
un lecteur d'écran, la couleur ne lui dit rien.

⚠️ **Mesure.** `#fedc96` sur blanc donne **1,32:1**. C'est la seule chose qui désigne cette
entrée (elle n'a pas de libellé), donc l'icône n'est **jamais atténuée** — une première
version la passait à 65 % d'opacité au repos et elle devenait invisible. Son nom reste
porté par `aria-label` et par l'infobulle. Pour la rendre perceptible sans quitter la
famille : `#e8a33a` donnerait 2,2:1, `--dash-orange` 3,09:1.

**Garde** : S36 (5 cas) — chaque entrée ouvre sa page, *Aujourd'hui* est l'entrée par
défaut et en tête, la colonne tombe au même pixel sur les cinq, elle se replie à 1 000 px
sans emporter la largeur du contenu, et les flèches déplacent le focus.

### La barre du haut : atterrissage direct + espaces transverses (lot 8 bis, 21/09/2026)

**Plus de « Lobby / RH / Recrutement ».** Le fil d'Ariane décrivait une hiérarchie que
personne ne parcourait : trois clics pour atteindre le travail du jour. L'application
s'ouvre sur *Aujourd'hui*, le **logo y ramène**, et `/app`, `/rh`, `/rh/recrutement`
**redirigent** — jamais 404.

À sa place, **quatre espaces de gestion TRANSVERSES**, groupés **À DROITE** juste avant le
compte, en **liens texte verts et gras** (pas des onglets : la colonne garde ce rendu) :

| Espace | Ce qu'il porte | Ce qu'il ne porte PAS |
|---|---|---|
| **Vivier** | l'écran existant, ré-atteignable directement (déposer, parcourir, rechercher) | — |
| **Sourcing** | **la base des campagnes ACTIVES qui existait déjà** : celles qui ont sourcé passent en tête, portent la pastille « Sourcée » et proposent **Détail** ; les autres proposent **Sourcer** | **aucune indication de coût** — le budget vit dans l'administration ; un recruteur n'a pas à connaître le prix d'une recherche pour décider s'il en a besoin |
| **Diffusion** | toutes les annonces publiées, tous canaux, toutes campagnes : état, date, jours restants avant que republier soit refusé | aucun geste — chaque ligne mène à la campagne |
| **Revue de candidature** | la revue **groupée** des dossiers à valider, avec un indicateur du nombre en attente | la décision à l'unité, qui reste sous la puce « À valider » |

Puis le compte / *Se déconnecter* à l'extrême droite.

⚠️ **« Revue de candidature » n'est pas un troisième chemin vers la même décision.** C'est
la revue GROUPÉE — celle qui passe les propositions de refus en une fois. La décision
dossier par dossier reste sous la puce « À valider » de *Candidatures*. Les **règles** de
validation (seuils par défaut, gabarits de refus) sont dans *Réglages*. Son indicateur ne
s'affiche qu'à partir de 1 : un « 0 » sur un lien se lit comme un compteur en panne.

⚠️ **Une seconde vue transverse du sourcing a existé quelques heures, et a été retirée.**
Elle listait les APPROCHES là où la base existante liste les CAMPAGNES : deux écrans pour
« où en est mon sourcing ? » finissent par se contredire.

⚠️ **Le vert des liens du bandeau est le sien.** Le bandeau est ambre (#FFB000 à 50 % sur
blanc ≈ #ffd77f), donc plus sombre qu'une carte : `--dash-green` n'y tient que **2,37:1**
et `--dash-green-text` **3,65** — sous les 4,5:1 exigés d'un texte de 13 px, fût-il gras
(le seuil « grand texte » commence à 18,66 px gras). `--dash-green-bandeau` (#166534)
donne **5,19:1**.

⚠️ **L'état d'une annonce est un CACHE.** Un consultant Apec peut valider, un recruteur
peut modifier sur apec.fr : ORQA ne l'apprend qu'en demandant. Chaque ligne de *Diffusion*
dit donc **quand l'état a été lu**. Et « J+30 » n'est pas une expiration qu'ORQA
connaîtrait : c'est la borne au-delà de laquelle l'Apec **refuse une republication** — on
affiche donc « N jours pour republier », jamais « expire le ».

**Garde** : S37 (5 cas) — les trois liens ouvrent leur page (colonne comprise), le logo
ramène à *Aujourd'hui*, les trois anciennes adresses redirigent, la barre ne porte que ces
trois espaces, et *Sourcing* ne propose aucun lancement de recherche.

### Une couleur par NATURE d'objet (21/09/2026)

**Règle.** La couleur d'un pavé d'initiales ou d'une icône de ligne ne code ni l'étape, ni
l'urgence, ni le score : tout cela est déjà écrit sur la ligne, en toutes lettres. Elle dit
**de quelle nature est l'objet**, et rien d'autre.

| Objet | Pastille | Écrans |
|---|---|---|
| Une **personne** | pastille **`#ffcb60`**, initiales **`#ff7f00`**, sans exception | Entretiens · Candidatures · Audit |
| Une **campagne** | **bleu ciel** (`--dash-sky`) et son éclair | Campagnes · Pilotage → Rapport de campagne |

**Pourquoi.** Un candidat était orange sur *Entretiens* quand il était en retard, turquoise
sinon, violet en attente de réservation, et marine dégradé sur *Candidatures* : **quatre
couleurs pour la même personne**, selon l'écran et son état. Une couleur qui change sans
rien signifier se lit comme une information — et on la cherche. L'icône de campagne, elle,
était **verte** : le vert disait « conforme » là où il ne signifiait rien de tel, pendant
qu'il servait ailleurs à marquer les candidats retenus.

⚠️ **Portée exacte.** Sur la **carte** d'une campagne, « suspendue » (jaune) et
« brouillon » (gris) gardent leurs teintes : elles distinguent trois cartes côte à côte
dans une même liste, ce qui est un autre problème. Seule l'icône **active** change.

⚠️ **Mesure, et elle est basse.** Les initiales `#ff7f00` sur la pastille `#ffcb60`
donnent **1,68:1**, et la pastille se détache de **1,42:1** du fond sand — très en dessous
des 3:1 d'un élément non textuel. Ce n'est tenable QUE parce que les initiales sont
**redondantes** : le nom complet est à côté, en contraste AA, et aucune information ne
dépend de leur lecture. Ce sont les teintes choisies par le donneur d'ordre, et
l'arbitrage lui appartient ; dans la même famille, `#9a3412` donnerait 4,86:1 sur la même
pastille.

Côté campagne, le ciel `#d7e6ff` est lui aussi **pâle** : le glyphe ne peut pas être blanc
(1,26:1) et prend `--dash-blue` (**3,66:1**, au-delà des 3:1 d'un élément non textuel) ; la
pastille porte un filet, car elle ne se détache que de 1,19:1 du fond.

**Garde** : `socle-jetons.test.ts` — un `avatarColor` qui n'est pas `PASTILLE.candidat`,
ou un fond posé à la main derrière des initiales, fait rougir la suite. Sondée.

### Le socle de jetons (lot 7, 21/09/2026)

Un fichier : **`src/components/ui/tokens.ts`**. Il ne dessine rien — il NOMME ce que les
écrans sains employaient déjà : **trois niveaux typographiques** (`font-display` ·
`font-body` · `font-data`, cette dernière réservée aux chiffres et aux références), une
**échelle d'espacement** en multiples de 4, les **rôles de couleur**, les **trois
profondeurs** (carte · sous-bloc · rangée) et leurs bornes de contraste.

**Candidatures a pris la peau du produit.** Sa palette `orqa-*` (marine `#0a1f3f`,
bleu-gris `#64748b`, brume `#f4f7fb`) et ses deux polices (Fraunces, Inter) ont été
retirées : elles n'existaient que là, sur un seul écran, et se chargeaient sur toutes les
pages. **Sa structure, elle, ne bouge pas** — c'est elle qui a servi de modèle aux autres.

⚠️ **Deux familles de couleur, et il ne faut pas les confondre.** Les couleurs de marque
(`--dash-green`…) sont des **repères** : mesurées sur leur propre fond clair elles donnent
2,83 à 3,44:1 — assez pour un élément non textuel (WCAG 1.4.11 : 3:1), **sous AA pour du
texte**. Le texte d'une pastille d'état prend les teintes `--dash-*-text` (4,56 · 6,95 ·
4,59 · 5,68:1, mesurées).

**Garde structurelle** : `src/components/ui/__tests__/socle-jetons.test.ts` — aucune
couleur en dur, aucune famille de police déclarée à la main, la palette retirée ne revient
pas. Et `stage-ui.test.ts` **résout les jetons dans `globals.css`** avant de mesurer le
contraste : une teinte changée en CSS fait rougir la suite sans qu'on touche au code.

**Garde structurelle** : `src/components/ui/__tests__/interface-sobre.test.ts` — aucune bascule de
vue définie hors de `DotTabs` (`role="tablist"`, `aria-selected`, onglets soulignés), et le type
`CounterItem` borné aux champs d'une carte à deux rangs. Sondée dans les deux sens.

---

### Recette du donneur d'ordre — 22 et 23/09/2026

Ce que la recette a changé, une fois la refonte à l'écran. Chaque point a sa
raison : elle vaut plus que la règle qu'elle produit.

**On arrive sur des titres, pas sur des murs.** *Aujourd'hui* et *Paramètres*
s'ouvrent **repliés** ; *Campagnes* n'ouvre **aucune** carte (seule exception :
la campagne désignée par l'URL — on y revient pour elle). Ce qu'on ouvre reste
ouvert **le temps de la session** (`sessionStorage`) : une nouvelle ouverture de
l'application repart fermée. Avant, les réglages ouverts la veille rouvraient
seuls, et la première campagne de la page était dépliée d'office — un rang
qu'elle n'a pas.

**Les familles de réglages portent un FILET `--dash-famille` (#ebbb58)**, sans
aplat. ⚠️ Le texte reste en encre du produit : ce jaune **en texte** sur fond
clair donne 1,78:1. La couleur borde, elle n'écrit pas. (En aplat, l'encre
#1b1b18 y tenait 9,68:1 — la première version ; le donneur d'ordre a préféré le
trait seul.)

**Le compteur du vivier quitte la colonne.** Il vivait sous « Campagnes » et ne
s'éteignait pas de lui-même : son décompte ignore l'état de la campagne, donc un
profil présélectionné sur une campagne clôturée le tenait allumé. La file reste
à `/validations-vivier`.

**Le flou, seulement là où le fond est INERTE.** Le détail complet d'une
candidature (`fixed inset-0`, portail vers `body`, Échap et clic-fond ferment)
gagne `backdrop-blur-sm` par-dessus son voile à 30 %. ⚠️ **Pas** le panneau
latéral de 420 px : c'est une **seconde colonne**, la liste qu'il côtoie reste le
moyen de passer au dossier suivant, et la flouter la ferait passer pour
désactivée.

**Un seul rapport d'analyse : le PDF.** Il se lisait sous deux formes selon la
porte — le PDF d'audit depuis la fiche candidature, un markdown dépouillé depuis
la fiche de validation, c'est-à-dire là où l'on accepte ou refuse. Le lecteur est
unique (`src/lib/reporting/open-report-inline.ts`), la fiche de validation
l'ouvre par l'identifiant d'analyse, et un échec est DIT plutôt que de laisser un
bouton mort. L'artefact markdown continue d'être produit et archivé.

**Assistant de création — étape « Le poste ».** L'intitulé et « Démarrer à partir
d'un document » sont **côte à côte, à la même largeur** ; l'import est mis en
exergue (indigo, filet de dépôt), et une lecture affiche un bandeau animé avec
son compteur, gèle les champs et refuse « Suivant » — plusieurs dizaines de
secondes sur un écran immobile faisaient cliquer partout. Les aides qui dépendent
de l'intitulé (« Proposer le reste de la fiche », campagne comparable)
n'apparaissent qu'une fois celui-ci saisi. Changer d'étape remonte en haut de la
carte.

**Assistant — l'étape « réception » ne choisit plus les canaux.** Cocher APEC à
la création ne diffusait rien : le texte s'écrit et se publie APRÈS le lancement,
et l'écran « Diffuser l'annonce » **propose déjà le canal** quand la campagne n'en
a aucun. Le choix vivait à deux endroits, le premier ne servant qu'à préparer le
second. L'état `channels` disparaît du brouillon (une campagne comparable n'en
copie plus : des canaux activés sans écran pour les montrer), et la note de
l'étape DIT où la diffusion se règle.

**Mots de l'écran.** « Méthode » → « **Méthode de recherche** » ; « LLM » → «
**IA** » partout où le recruteur lit (sélecteur de la grille, badges, message de
cohérence, audit candidat).

**Sur un dossier tranché, le compte rendu d'entretien se LIT** et ne s'écrit plus
— et disparaît quand rien n'a été rédigé. Voir `docs/specs/compte-rendu-entretien.md`
§19.2.
