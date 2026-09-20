# Maquette d'aménagement — nouvelle structure d'ORQA

**Date** : 20/09/2026 · **Statut** : CONCEPTION — POINT D'ARRÊT, aucun code, aucune migration.
**Amont** : `docs/ux/audit-ux-2026-09-20.md` · **Lexique appliqué** : §6.3 de l'audit.

Maquettes **en texte** : on valide l'organisation, pas le style. Aucune règle métier n'est
touchée — on réorganise l'**accès**, jamais les règles.

---

## 0. Ce que la confrontation au code change dans la proposition

Six constats. Deux modifient le plan, quatre le confortent.

### 0.1 ⚠️ Constat qui change le plan — **il n'existe aucune URL dans le produit**

`WorkspacePane` porte les 8 onglets dans un `useState`. Le seul `router.push` de tout le
workspace mène à `/settings` (`WorkspacePane.tsx:127`). Conséquence mesurée :

| Rien de tout cela n'existe aujourd'hui |
|---|
| Mettre un onglet en favori |
| Revenir en arrière (le bouton *Précédent* quitte le workspace vers `/rh`) |
| Envoyer à un collègue « regarde CAMP-2026-221 » |
| Qu'un mail, un signal ou le Manager pointe un endroit précis |
| Rouvrir là où on s'était arrêté |

**Les deux signaux APEC le prouvent déjà** : leur cible est `{ route: '/rh/recrutement' }`
(`business-signals.ts:428,467`) — « une offre APEC est en ligne sur une campagne clôturée » vous
dépose à la racine du workspace **sans dire laquelle**, parce qu'il n'y a aucune adresse où
pointer.

> **Donc l'axe 1 n'est pas « réorganiser en modules », c'est « réorganiser en modules
> ADRESSABLES ».** Des modules sans routes, ce serait le même produit avec d'autres étiquettes,
> et le module *Aujourd'hui* — dont chaque ligne doit mener quelque part — serait irréalisable.
> C'est le seul vrai coût de la refonte, et il est structurant.

Bonne nouvelle collatérale : `campaigns.id` **est** la référence métier `CAMP-2026-221`
(`campaign-id.ts:12-27`). L'URL d'une campagne peut donc être la chaîne que le candidat voit
dans l'objet de son mail et que le DRH lit sur l'annonce — **le fil de traçabilité devient
cliquable**.

### 0.2 ⚠️ Constat qui change le plan — **Jooble n'existe pas dans le code**

Aucune occurrence dans `src/` ni `docs/`. La diffusion réelle aujourd'hui :

| Canal | Publie vraiment ? | Surface |
|---|---|---|
| **Annonce générique** | oui → jobboard de démonstration *TalentBoard* (`DEMO_JOBBOARD_ENABLED`) | `GenericJobAdPanel` |
| **APEC** | oui → apec.fr via ADEP | `ApecPanel` |
| LinkedIn, Indeed, WTTJ, France Travail | **non** — intention déclarative seulement | aucune |

Le sous-module « Diffusion » se dessine donc sur **2 canaux réels + 4 déclaratifs**, pas sur une
liste homogène. Si Jooble est au programme, il entre comme un troisième `ChannelContentPanel` —
la structure l'accueille sans modification. **À confirmer** (§8, Q5).

### 0.3 ✓ Ce qui conforte le plan — le « par campagne » est déjà là, sous les onglets

| Sous-module visé | Composant existant, déjà paramétré par campagne | Travail restant |
|---|---|---|
| Candidatures de la campagne | `CandidaturesWorkspace({ initialCampaignId })` + `GET /api/candidatures?campaignId=` | **re-parentage** |
| Entretiens de la campagne | `InterviewsWorkspace` + **`GET /api/interviews?campaignId=`** (`api/interviews/route.ts:25`) | passer la prop ; le serveur suit déjà |
| Diffusion | `ChannelContentPanel({ campaignId })` → `GenericJobAdPanel` / `ApecPanel` | **re-parentage** |
| Sourcing | `SourcingCampaignView({ campaignId })` — l'onglet global n'est qu'une **liste de campagnes** menant à cette vue | **re-parentage** |
| Vivier — présélection | `VivierPreselectionPanel({ campaignId })` | **re-parentage** |
| Réglages de la campagne | `CampaignEditAccordion` (9 sections, écran jugé sain) | **re-parentage** |

**Un seul manque réel** : `GET /api/validations` ne prend **pas** de `campaignId`
(`api/validations/route.ts:32-34`, `listPendingValidations()` sans filtre). Comme la liste est
déjà rapatriée **exhaustivement** en keyset, un filtre **côté client** suffit et reste juste —
c'est d'ailleurs déjà ce que fait le filtre par référent (`filterByReferent`). Pas de
modification d'API.

### 0.4 ✓ Ce qui conforte le plan — *Aujourd'hui* a déjà sa matière première

`BUSINESS_SIGNALS` est un **registre extensible** de 7 signaux calculés côté serveur, avec
message, compte, ancienneté et cible (`business-signals.ts:546-578`) :

| Clé | Nature | Cible actuelle |
|---|---|---|
| `pending_validations_overdue` | dossier | `{ tab: 'validations' }` |
| `interviews_awaiting_decision` | dossier | `{ tab: 'candidatures', stage: 'entretien_fait' }` |
| `interviews_awaiting_pointing` | dossier | `{ tab: 'entretiens', section: 'a_pointer' }` |
| `availability_holidays_unblocked` | **réglage** | `{ route: '/settings' }` |
| `availability_meeting_location_missing` | **réglage** | `{ route: '/settings' }` |
| `apec_republication_window_closing` | **diffusion** | `{ route: '/rh/recrutement' }` ← imprécise |
| `apec_offer_live_on_closed_campaign` | **diffusion** | `{ route: '/rh/recrutement' }` ← imprécise |

Deux enseignements : (1) *Aujourd'hui* n'a pas à inventer sa source, il a à **afficher ce
registre** ; (2) le registre mêle déjà **des dossiers** et **des réglages** — ce sont deux
registres de lecture différents, et la maquette doit les séparer (§2).

### 0.5 ✓ Ce qui conforte le plan — la suite de régression ne bouge pas

`tests/regression/` (S1→S25) traverse **les routes API**, jamais les composants : **zéro import
de `components/`**. Une restructuration purement UI, qui ne déplace aucune route d'API, a un
**impact nul** sur S1-S25. Le risque de régression se concentre sur 15 tests unitaires de
composants, dont **3 seulement** touchent les surfaces déplacées.

### 0.6 ✓ Ce qui conforte le plan — l'axe « ma journée / ma mission » existe déjà à moitié

`ReferentFilterBar` + `filterByReferent` (`lib/referent/filter.ts`) donnent déjà « Mes
campagnes » sur **Validation suspendue** et **Entretiens**. *Aujourd'hui* doit **réutiliser**
cette brique, pas en inventer une.

⚠️ **Et hériter de son garde-fou** : `src/components/referent/__tests__/surfaces.test.ts` existe
pour interdire que les **alertes** soient filtrées (un bandeau de cibles orphelines, un badge « à
pointer » lisent le pipeline COMPLET). Ce test est une garde **structurelle** ; en déplaçant les
surfaces, il faut le déplacer avec elles, pas le laisser pointer des fichiers disparus.

---

## 1. La carte des modules

### 1.1 Arborescence cible

```
/                                    landing publique
/login
/app                                 LOBBY — « l'entreprise virtuelle » (démo, hors chemin
                                     quotidien : la connexion ne passe plus par ici)
/rh                                  Portail du département RH (idem)

/rh/recrutement                      ─── LE SERVICE ───  redirige vers /aujourdhui
│
├── /aujourdhui                      ▣ MODULE 1 — AUJOURD'HUI          (par défaut)
│                                      ce qui attend une action, toutes campagnes
│
├── /campagnes                       ▣ MODULE 2 — CAMPAGNES
│   ├── (liste + filtres de statut)
│   ├── /nouvelle                      assistant de création, 6 étapes
│   └── /CAMP-2026-221               ─── LA PAGE D'UNE CAMPAGNE ───
│       ├── (vue d'ensemble)           entonnoir, référent, statut, actions de cycle de vie
│       ├── /candidatures              pipeline de CETTE campagne
│       ├── /a-decider                 file HITL de CETTE campagne
│       ├── /entretiens                entretiens de CETTE campagne
│       ├── /diffusion                 annonce générique · APEC · (Jooble ?)
│       ├── /sourcing                  recherche de profils pour CETTE campagne
│       └── /reglages                  les 9 sections d'édition (inchangées)
│
├── /candidats                       ▣ MODULE 3 — CANDIDATS
│   ├── (toutes les candidatures, transverse)
│   ├── /CAN-…                         fiche candidature (aujourd'hui non adressable)
│   └── /vivier                        stock interne : liste, recherche, dépôt
│       └── /contacts-a-approuver      ex-« Validations vivier »
│
└── /pilotage                        ▣ MODULE 4 — PILOTAGE
    ├── /rapport-campagne
    ├── /rapport-multi-campagnes
    ├── /audit
    └── /equipe                        les agents + la répartition (ex-scène du Bureau)

/settings                            RÉGLAGES — hors navigation principale (engrenage)
/admin/dashboard                     ADMIN — inchangé
```

**4 entrées de premier niveau** au lieu de 8. La zone « onglets » repasse sous le seuil de 7
(audit §3.1 : elle en comptait 10 avec l'engrenage).

### 1.2 Où va chaque écran actuel

| Écran / onglet actuel | Devient | Nature du geste |
|---|---|---|
| Onglet **Bureau** (scène d'agents + répartition) | **Aujourd'hui** (refondu) ; la scène part en `/pilotage/equipe` | refonte + déplacement |
| Onglet **Campagnes** | `/campagnes` | re-parentage |
| `CampaignCreateSheet` (feuille) | `/campagnes/nouvelle` (assistant) | **refonte** |
| `CampaignEditSheet` (feuille) | `/campagnes/:id/reglages` | re-parentage |
| Onglet **Candidatures** | **deux vues, un composant** : `/candidats` (transverse) et `/campagnes/:id/candidatures` (périmètre campagne) | re-parentage × 2 |
| Panneau + page fiche candidature | `/candidats/:id` | re-parentage + adressage |
| Onglet **Entretiens** | `/aujourdhui` (agrégé) + `/campagnes/:id/entretiens` (filtré) | re-parentage × 2 |
| Onglet **Validation suspendue** | `/aujourdhui` (agrégé) + `/campagnes/:id/a-decider` (filtré) | re-parentage × 2 |
| Onglet **Validations vivier** | `/candidats/vivier/contacts-a-approuver` + remontée dans *Aujourd'hui* | re-parentage |
| Onglet **Sourcing** (liste de campagnes → vue) | `/campagnes/:id/sourcing` ; la liste de campagnes disparaît (c'est `/campagnes`) | re-parentage, **1 écran supprimé** |
| Onglet **Reporting** (3 sous-onglets) | `/pilotage/*` | re-parentage |
| `/vivier` (route hors workspace) | `/candidats/vivier` | **fin de l'île de navigation** |
| Diffusion : `ApecPanel`, `GenericJobAdPanel` (dans l'édition + l'écran post-création) | `/campagnes/:id/diffusion` | re-parentage |
| `VivierPreselectionPanel` (dans l'édition) | `/campagnes/:id/sourcing` (onglet « Vivier ») | re-parentage |
| **Paramètres** (16 sections) | inchangé — meilleur écran du produit | aucun |

### 1.3 Ce qui disparaît en tant qu'onglet ou route

| Disparaît | Devenir | Pourquoi |
|---|---|---|
| Onglets *Validation suspendue*, *Validations vivier*, *Entretiens*, *Sourcing* | **vues**, jamais des onglets | Ce sont des **files de travail**, pas des objets : elles se lisent par la journée ou par la mission, pas par catégorie technique |
| Onglet *Bureau* | **Aujourd'hui** | Un organigramme n'est pas un poste de travail |
| Route `/validations` | → 301 `/rh/recrutement/aujourdhui` | Doublon d'onglet avec un titre et un sur-titre différents (audit §2.2) |
| Route `/validations-vivier` | → 301 `/candidats/vivier/contacts-a-approuver` | doublon |
| Route `/reporting` | → 301 `/pilotage/rapport-campagne` | doublon |
| Route `/vivier` | → 301 `/candidats/vivier` | île de navigation |
| Route `/candidatures-apercu` | **supprimée** | Aperçu jetable, marqué « À SUPPRIMER après validation » en tête de fichier, toujours livré |
| L'écran « liste des campagnes » du Sourcing | supprimé | C'est `/campagnes` |
| Section Paramètres *« Validation humaine (Human in the loop) »* | supprimée | Elle ne sert plus qu'à dire que le réglage est ailleurs |

### 1.4 Libellés — lexique de l'audit appliqué

| Ancien | Nouveau | Où |
|---|---|---|
| Bureau | **Aujourd'hui** | module 1 |
| Validation suspendue | **À décider** | section d'*Aujourd'hui*, sous-onglet de campagne |
| Validations vivier | **Contacts à approuver** | sous-module vivier |
| Zone grise / zone de validation / à examiner | **À décider** | partout |
| Refus auto *(curseur de création)* | **Proposé au refus** | assistant, étape 5 |
| Acceptation automatique | **Invité automatiquement** | pastilles, seuils |
| Fiche de scoring | **Grille d'évaluation** | assistant, réglages |
| Flux de réception / sources de réception | **Arrivée des candidatures** | assistant, réglages |
| Canaux de diffusion | **Diffusion de l'annonce** | assistant, sous-onglet |
| Seuils de décision | **Décision automatique** | assistant, réglages |
| GO définitif | **Retenu** | verdict |
| Manifesté *(sourcing)* | **A répondu** | sourcing |
| Cycle de vie | **Statut de la campagne** | réglages |
| Reporting | **Pilotage** | module 4 |

---

## 2. Module 1 — **Aujourd'hui**

### 2.1 Principe

**Une liste de tâches, pas un tableau de bord.** Trois règles :

1. **Une ligne = un dossier ou un réglage, pas un compteur.** « 3 candidatures à décider » n'est
   pas une ligne, c'est un titre de section ; les trois lignes en dessous nomment les trois
   personnes.
2. **Chaque ligne porte son action principale**, exécutable sans quitter l'écran.
3. **Trier par ce qui coûte le plus cher d'attendre**, pas par type d'objet. Dans l'ordre : un
   **candidat** qui attend une réponse · une **décision interne** en suspens · un **réglage qui
   casse en silence** · ce qui **arrive**.

### 2.2 Maquette

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ORQA        Lobby › RH › Recrutement                    [⚙]  [Se déconnecter] │
├───────────────────────────────────────────────────────────────────────────────┤
│  Aujourd'hui   Campagnes   Candidats   Pilotage                               │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  Bonjour Imad.  Vendredi 20 septembre                                         │
│  7 choses vous attendent.          Référent : [ Tous (7) ▾ ] [Mes campagnes(5)]│
│                                                                               │
│  ── DES CANDIDATS ATTENDENT VOTRE RÉPONSE ─────────────────────── 3 ──────────│
│                                                                               │
│   ⏳ 9 j  Damois Bernard              80  Directeur de Dépt. Ops. (CAMP-…-221) │
│           À décider · Réf. Imad B.              [ Voir le dossier ] [ Décider ]│
│                                                                               │
│   ⏳ 4 j  anis tahi                   30  Business Analyst (CAMP-2026-549)     │
│           Proposé au refus · Réf. Jane R.       [ Voir le dossier ] [ Décider ]│
│                                                                               │
│   ⏳ 2 j  Sofia M.                    —   Business Analyst (CAMP-2026-331)     │
│           Contact vivier à approuver            [ Voir le profil ] [ Décider ] │
│                                                                               │
│                                              → Les 3 dossiers en une fournée  │
│                                                                               │
│  ── DES DÉCISIONS VOUS REVIENNENT ──────────────────────────────── 3 ─────────│
│                                                                               │
│   📅 hier  Damois Bernard             Entretien du 18 sept., 10:00            │
│            Entretien passé, non pointé                                        │
│                     [ Entretien réalisé ]  [ Candidat absent ]  [ Sans suite ]│
│                                                                               │
│   ✓ 3 j    Molika Khuon               Entretien réalisé — verdict attendu     │
│                                                          [ Décider le verdict ]│
│                                                                               │
│  ── DES RÉGLAGES VONT POSER PROBLÈME ───────────────────────────── 1 ─────────│
│                                                                               │
│   ⚠ 11 nov.  4 jours fériés restent proposables aux candidats                 │
│              Votre agenda les offre à la réservation.                         │
│                                                  [ Ouvrir mes disponibilités ]│
│                                                                               │
│  ── CE QUI TOURNE ────────────────────────────────────────────────────────────│
│   15 campagnes actives · 12 candidatures reçues cette semaine · 0 en échec    │
│                                                  → Voir le détail (Pilotage)  │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Ordre des sections — et pourquoi

| Rang | Section | Ce qui la justifie |
|---|---|---|
| 1 | **Des candidats attendent votre réponse** | C'est le seul coût **externe** : une personne réelle attend. Depuis la mise en conformité RGPD, **plus aucun refus ne part seul** — sans ce geste, un dossier n'a littéralement pas de fin. |
| 2 | **Des décisions vous reviennent** | Coût **interne** : un entretien non pointé bloque la frise, le rapport et le signal 3. Rien ne se dégrade côté candidat. |
| 3 | **Des réglages vont poser problème** | Coût **futur et silencieux** : un agenda sans créneau ou une offre APEC qui expire ne produit **aucun symptôme** jusqu'à l'incident. |
| 4 | **Ce qui tourne** | Informatif, jamais actionnable. En bas, discret : c'est le seul endroit où un chiffre agrégé est légitime. |

### 2.4 Source de chaque ligne

| Ligne | Origine | Signal / requête | Déjà disponible ? |
|---|---|---|---|
| À décider (zone grise) | `pending_validations` (`status ∈ pending, sending`) × `candidate_analyses.decision_zone = 'gray'` | `pending_validations_overdue` + `partitionRejectionProposals` | **oui** |
| Proposé au refus | idem, `decision_zone = 'proposed_reject'` | idem | **oui** |
| Contact vivier à approuver | `vivier_preselections.state = 'identified'` | `GET /api/vivier/validations` (compteur déjà au badge) | **oui** — à promouvoir en signal |
| Entretien passé non pointé | `interview_briefs.status='scheduled'` × `interview_end_at < now − 24 h` × étape ∈ {invite, rdv_pris} | `interviews_awaiting_pointing` | **oui** |
| Verdict attendu | étape = `entretien_fait` (`deriveCandidateStage`) | `interviews_awaiting_decision` | **oui** |
| Jours fériés proposables | `sched_*` (règles hebdo + exceptions) × `french-holidays` | `availability_holidays_unblocked` | **oui** |
| Lieu d'entretien manquant | ressource réservable sans lieu complet | `availability_meeting_location_missing` | **oui** |
| APEC — fenêtre de republication | `job_postings` (ADEP) | `apec_republication_window_closing` | **oui** (cible à préciser) |
| APEC — offre en ligne sur campagne clôturée | idem | `apec_offer_live_on_closed_campaign` | **oui** (cible à préciser) |
| « Ce qui tourne » | `campaigns` (statut) + journal fenêtré | `/api/metrics/global` | **oui** |

**Deux signaux à ajouter au registre** — une entrée chacun, ni route ni composant à toucher
(c'est la promesse du registre, `business-signals.ts:5-8`) :

| Nouveau signal | Règle | Pourquoi il manque aujourd'hui |
|---|---|---|
| `vivier_contacts_pending` | ≥ 1 présélection `identified` | Le badge de l'onglet le comptait ; sans onglet, le compte doit remonter comme signal |
| `campaign_active_without_intake` | campagne `active` **et** `sources = []` | L'audit a montré qu'une campagne peut vivre sans canal d'arrivée : elle ne recevra jamais rien et **rien ne le dit** |

### 2.5 L'écran à zéro

Un *Aujourd'hui* vide ne doit pas ressembler à un écran cassé. Trois cas distincts :

```
  Rien ne vous attend. Bonne journée.

  15 campagnes tournent, 12 candidatures sont arrivées cette semaine,
  et les 3 dernières décisions sont parties hier.
                                                     → Pilotage   → Campagnes
```

```
  Rien ne vous attend pour vos campagnes.
  4 dossiers attendent d'autres recruteurs.        [ Voir tout (filtre : Tous) ]
```
> Repris de l'audit §7.2 : « il n'y a rien » et « le filtre masque tout » ne se confondent pas.
> C'est déjà la règle d'`EmptyQueueNotice` ; elle monte ici.

```
  Aucune campagne pour l'instant.
  Une campagne, c'est un poste à pourvoir : sa fiche, sa grille d'évaluation,
  et par où les CV arrivent. Comptez cinq minutes.
                                            [ Créer ma première campagne → ]
```
> C'est le **seul** parcours de première fois (audit §7.3). Il disparaît définitivement après la
> première campagne créée. Pas de visite guidée.

### 2.6 Trois garde-fous non négociables

1. **Les alertes ne sont jamais filtrées par référent.** Le filtre réduit ce qu'on affiche des
   **dossiers** ; « Des réglages vont poser problème » et « Ce qui tourne » lisent le périmètre
   **complet**. Garde structurelle existante à étendre :
   `components/referent/__tests__/surfaces.test.ts`.
   ⚠️ Ne pas confondre avec la **portée personnelle** des deux signaux d'agenda
   (`personal: true`, `business-signals.ts:561,566`) : un agenda est un réglage **individuel**,
   chacun ne voit que le sien — c'est un axe différent du filtre par référent, et il reste tel
   quel. Un signal personnel n'est pas une alerte filtrée.
2. **Les compteurs de section affichent « n sur N »** quand un filtre est posé — un dossier
   caché reste compté (règle du 27/08/2026, déjà appliquée aux files).
3. **Aucune action en un clic sur un geste qui écrit au monde.** « Décider » **ouvre** la carte
   avec la relecture du mail ; il ne décide pas. « Entretien réalisé » / « Candidat absent »
   conservent leur dialogue — le no-show **est** une décision (invariant du module entretiens).

---

## 3. La page d'une campagne

### 3.1 Maquette

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  Aujourd'hui   [Campagnes]   Candidats   Pilotage                             │
├───────────────────────────────────────────────────────────────────────────────┤
│  Campagnes ›  CAMP-2026-221                                                   │
│                                                                               │
│  Directeur de Département Opérations Industrielles (H/F)        ● Active      │
│  Ouverte le 12 sept. · Réf. Imad B. · Réservation : ORQA · Lyon               │
│                            [ Suspendre ]  [ Clôturer ]  [ Réglages ⚙ ]        │
│                                                                               │
│  ┌─ Vue d'ensemble ─┬─ Candidatures 12 ─┬─ À décider 2 ─┬─ Entretiens 3 ──────┐│
│  │                  │                   │               │  Diffusion  Sourcing││
│  └──────────────────┴───────────────────┴───────────────┴─────────────────────┘│
│                                                                               │
│   12 reçues ──→ 5 invitées ──→ 3 en entretien ──→ 1 retenue                   │
│   ▓▓▓▓▓▓▓▓▓▓▓▓    ▓▓▓▓▓            ▓▓▓               ▓                        │
│   2 à décider · 4 non retenues · 0 sans suite                                 │
│                                                                               │
│   ┌─ Ce qui attend sur cette campagne ─────────────────────────────────────┐  │
│   │  2 candidatures à décider (la plus ancienne depuis 9 jours) → À décider│  │
│   │  1 entretien passé sans pointage                          → Entretiens│  │
│   └───────────────────────────────────────────────────────────────────────┘  │
│                                                                               │
│   Diffusion    Annonce générique — publiée le 13 sept. · APEC — en ligne,     │
│                republication avant le 4 oct.                    → Diffusion   │
│   Arrivée      Boîte mail recrutement@… · Vivier                → Réglages    │
│   Évaluation   7 critères · décision auto : proposé au refus < 9, invité ≥ 90 │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Les six sous-onglets

| Sous-onglet | Contenu | Composant réutilisé | Périmètre |
|---|---|---|---|
| **Vue d'ensemble** | entonnoir, ce qui attend, résumé diffusion / arrivée / évaluation | `CampaignCardBody` **dégraissé** (la duplication des 4 chiffres tombe, audit §2.2) | — |
| **Candidatures** | le pipeline complet de la campagne, ruban d'étapes et filtres | `CandidaturesWorkspace` | `initialCampaignId` |
| **À décider** | les dossiers en file pour cette campagne, 2 sous-onglets *À examiner* / *Propositions de refus* | `ValidationsHub` | **filtre client** sur `campaignId` |
| **Entretiens** | en attente de réservation · programmés · en attente de verdict | `InterviewsWorkspace` | `?campaignId=` (**déjà supporté**) |
| **Diffusion** | annonce générique, APEC, (Jooble ?) | `ChannelContentPanel` | `campaignId` |
| **Sourcing** | recherche de profils + onglet **Vivier — présélection** | `SourcingCampaignView`, `VivierPreselectionPanel` | `campaignId` |

`Réglages ⚙` (bouton d'en-tête, pas un sous-onglet) ouvre `/campagnes/:id/reglages` :
`CampaignEditAccordion`, ses 9 sections **inchangées**.

### 3.3 Deux règles héritées à ne pas perdre

**a) Les surfaces de diffusion n'ouvrent que sur une campagne active.** C'est un invariant
(« diffuser depuis un brouillon, c'est appeler des CV qui ne seront pas traités »). Le
sous-onglet **Diffusion existe toujours** mais, sur un brouillon, il affiche le message de
`PostActivationPanels` : *« l'annonce générique et la présélection vivier s'ouvrent ici dès
l'activation »*. **On ne masque jamais en silence.**

**b) Les quadrants de la carte campagne portent des TRAJECTOIRES, pas des états.**
`openCandidaturesForCampaign` transmet `everInvited` / `everInterviewed` : « Shortlistés /
Invités » compte ceux qui **sont passés par** l'invitation, y compris ceux qui ont avancé
depuis (`CampaignCard.tsx:38`). C'est subtil et facile à perdre dans un re-parentage — les liens
de la vue d'ensemble doivent transporter ces présets tels quels.

---

## 4. L'assistant de création

`/rh/recrutement/campagnes/nouvelle` — **une décision par étape**, « Suivant » bloqué tant que
l'étape n'est pas valide, obligatoire/optionnel visible, retour possible sans perte.

```
  ●───────●───────○───────○───────○───────○
  Poste  Critères Réception Diffusion Décision Récap        Étape 2 sur 6
```

| # | Étape | Bloquante ? | Contenu | Composants |
|---|---|---|---|---|
| 1 | **Le poste** | oui (1 champ) | intitulé + porte « démarrer à partir d'un document » — **inchangée, elle marche** | `JobTitleStep` |
| 2 | **Le poste en détail** | **oui — 8 champs** | les 8 champs de la fiche, **marqués obligatoires**, compteur « 5 sur 8 », bouton « Proposer la fiche » | `FDPInlineEditor` + `htmlFor` |
| 3 | **Les critères** | non (pré-remplie) | grille d'évaluation, niveaux, poids ; **bloque si des pondérations suggérées par l'IA restent à traiter** | `ScoringDraftEditor` |
| 4 | **L'arrivée des candidatures** | **oui — ≥ 1 canal** | dépôt manuel · boîte mail (+ boîtes à associer) · vivier ; les 6 flux non branchés **listés mais non cochables** | `FluxDraftEditor` + `MailboxPicker` |
| 5 | **La diffusion** | non | canaux voulus ; **dit que la rédaction se fait après l'activation** | `ChannelsDraftEditor` |
| 6 | **La décision et le référent** | non (défauts) | seuils (**« Proposé au refus »**, pas « Refus auto »), référent, régime de réservation | `DecisionThresholdsBlock` ← **celui de l'édition**, `OwnerDraftEditor`, `SchedulingDraftEditor` |
| 7 | **Récapitulatif** | — | les 6 étapes résumées, chacune modifiable ; dit ce qui se passe à l'activation | nouveau, ~120 lignes |

> Les étapes 5 et 6 ne bloquent jamais : leurs défauts tiennent. Elles restent **des étapes** et
> non un repli « avancé », parce que le régime de réservation et le référent décident de
> l'agenda offert aux candidats — les découvrir après coup est exactement le défaut d'aujourd'hui.

**Ce que l'assistant supprime** : les 7 boutons « Enregistrer » qui n'enregistrent rien, le
bouton primaire actif dans un état non activable, l'aller-retour « Créer » → « Compléter la
campagne », et le libellé « les sources de réception » qui n'existait nulle part.

### 4.1 Provenance des pré-remplissages *(reprise de l'audit §5.4, avec les deux trous à combler)*

| Champ | Provenance | Marquage à l'écran | État |
|---|---|---|---|
| Intitulé | saisie étape 1 | aucun | ✓ |
| Nom de campagne | dérivé de `job_title` | « suit l'intitulé du poste » | ✓ |
| Fiche, grille, canaux, flux, seuils | **campagne comparable** | bandeau « Repris de *CAMP-…* » + « Repartir à zéro » | ✓ |
| Champs factuels | **document déposé** | bandeau + ⓘ extrait source | ✓ |
| Pondérations | **document déposé** | « Suggéré par l'IA » + confirmer/rejeter, **bloque l'activation** | ✓ |
| Fiche / grille | **bouton « Proposer »** (IA) | *rien* | **à combler** |
| 3 critères initiaux | gabarit en dur | *rien* | **à combler** — marquer « modèle de départ » |
| Seuils 10 / 90 | défaut produit | *rien* | **à combler** — écrire le défaut en clair |
| Référent | le créateur | « vous, par défaut » | ✓ |

⚠️ **Trou de fond à traiter dans le même lot** (mémoire `project_suggere_gap`) : le drapeau
`suggere` n'est posé que par le chemin « document déposé ». « Proposer la grille » et la
campagne comparable injectent des pondérations **sans marquage**, donc **sans confirmation
exigée** — c'est une incohérence de **traitement**, pas d'affichage. L'assistant la rend
visible : trois provenances, un seul traitement.

---

## 5. Les deux chemins critiques, mesurés

Comptage depuis l'ouverture de session. Aujourd'hui la connexion dépose sur `/app`
(`next-path.ts:11`) ; dans la cible, sur `/rh/recrutement/aujourdhui`.

### (a) Valider un candidat — **le test de la refonte**

| | Aujourd'hui | Cible |
|---|---|---|
| 1 | `/app` → « Entrer » (RH) | **l'écran s'ouvre sur *Aujourd'hui*, le dossier est visible** |
| 2 | `/rh` → « Ouvrir » (Recrutement) | clic **[ Décider ]** sur la ligne → la carte s'ouvre avec la relecture du mail |
| 3 | onglet *Validation suspendue* | clic **[ Accepter ]** / **[ Refuser ]** |
| 4 | sous-onglet *Propositions de refus* ⚠ *(le défaut : l'onglet ouvre sur une liste vide)* | |
| 5 | action sur la carte | |
| **Total** | **5 clics**, dont **4 de navigation** | **2 clics**, dont **0 de navigation** |

**−60 %, et la totalité des clics de navigation disparaît.** C'est le critère que le brief pose
comme condition de la refonte : il est rempli. Bonus : le geste de fournée (« Les 3 dossiers en
une fournée ») descend de **6 clics à 2**.

### (b) Créer une campagne

| | Aujourd'hui | Cible |
|---|---|---|
| Navigation | 3 clics (`/app` → RH → Recrutement → *Campagnes*) | **1 clic** (*Campagnes*) |
| Ouverture | 1 (*Nouvelle campagne*) | 1 (*Nouvelle campagne*) |
| Saisie | *Continuer*, puis dépliage des sections à l'aveugle : **6 clics** d'ouverture + jusqu'à **7** « Enregistrer » inutiles | **5 clics** « Suivant », un par étape |
| Fin | *Créer la campagne* + *Activer* (2) | *Créer et activer* (1) |
| **Chemin nominal** | **~13 clics** | **8 clics** |
| **Chemin observé en démonstration** | **+ 1 aller-retour** *Créer → « Compléter la campagne » → retrouver la section → recommencer* ≈ **18-20 clics**, et une explication orale | **8 clics**, l'échec est **impossible** : « Suivant » ne laisse pas passer une étape invalide |

**Le gain réel n'est pas le nombre de clics (−38 %), c'est la disparition du chemin d'échec.**
Le brief le dit : si (a) ne raccourcit pas, la refonte ne vaut pas le coup. (a) raccourcit de
60 %. (b) raccourcit moins mais **cesse d'échouer** — et c'est le défaut n°1.

---

## 6. La migration

### 6.1 Composants — réutilisés / déplacés / refaits

| Verdict | Nombre | Lesquels |
|---|---|---|
| **Réutilisés tels quels** (nouveau parent, zéro modification) | ~18 | `CandidaturesWorkspace`, `CandidatureRow/Panel/FullPage`, `CandidaturesRibbon/Filters`, `ValidationCard`, `RejectionProposalsTab`, `BulkRejectDialog`, `InterviewsWorkspace` (+ ses 5 listes), `NoShowDialog`, `InterviewDecisionBlock`, `InterviewReport*`, `CorrectDecision*`, `CampaignDismissFlowDialog`, `ApecPanel`, `GenericJobAdPanel`, `VivierPreselectionPanel`, `SourcingCampaignView`, `ReportingHub`, `SettingsHub` |
| **Réutilisés avec un paramètre de périmètre** | 3 | `ValidationsHub` (+ filtre campagne client), `InterviewsWorkspace` (passer `?campaignId=`), `CandidaturesWorkspace` (déjà prêt) |
| **Déplacés** (route + shell) | 4 | `VivierHub` (`/vivier` → `/candidats/vivier`, et **ouvrir sur la liste, pas sur le dépôt**), `VivierValidationsWorklist`, `ReportingHub`, `HRDepartmentView` + `AgentDetailsPanel` → `/pilotage/equipe` |
| **Refaits** | 3 | `WorkspacePane` → routeur de modules ; `CampaignCreateSheet` (**1 695 lignes** → assistant de 7 composants ≤ 200, règle projet) ; le Bureau → *Aujourd'hui* |
| **Dégraissés** | 2 | `CampaignCardBody` (duplication des 4 chiffres), `CampaignsWorkspace` (double titre) |
| **Supprimés** | 2 | liste de campagnes du Sourcing, `/candidatures-apercu` |

**Nouveaux composants à écrire** : le shell de module + la barre de 4 entrées ; `TodayBoard` et
ses 4 sections ; `CampaignPage` + sa barre de 6 sous-onglets ; l'assistant (6 étapes + récap). Le
reste est du re-parentage.

### 6.2 Routes

| Action | Routes |
|---|---|
| **Créées** | `/rh/recrutement/aujourdhui` · `/campagnes` · `/campagnes/nouvelle` · `/campagnes/[id]` (+ 6 sous-vues) · `/candidats` · `/candidats/[id]` · `/candidats/vivier` (+ `/contacts-a-approuver`) · `/pilotage/*` |
| **Redirigées (301)** | `/validations` · `/validations-vivier` · `/reporting` · `/vivier` |
| **Supprimée** | `/candidatures-apercu` |
| **Inchangées** | **toutes les routes `/api/*`**, `/settings`, `/admin/*`, `/r/`, `/b/`, `/s/`, `/jobs/`, `/login` |

⚠️ **Le proxy est une liste blanche de préfixes** (`PROTECTED_PREFIXES = ['/app','/rh','/settings','/validations','/admin']`).
Les nouvelles pages vivent sous `/rh/…` : **elles sont couvertes sans modification**. Si un module
sortait de `/rh`, il deviendrait **public par défaut** — c'est la raison de rester sous `/rh/recrutement/`,
au-delà de la fidélité à la métaphore « département / service ».

### 6.3 Tests

| Suite | Impact | Pourquoi |
|---|---|---|
| **Régression S1 → S25** | **aucun** | Elle traverse les routes API ; **zéro import de `components/`** (vérifié) |
| Tests unitaires purs (`lib/`) | aucun | Aucune logique métier déplacée |
| `components/campagnes/edit/__tests__/campaign-create-sheet.test.ts` | **à réécrire** | `nextOpenSection` / `deriveCampaignName` : la première notion disparaît avec l'accordéon, la seconde reste |
| `components/referent/__tests__/surfaces.test.ts` | **à étendre** | Garde structurelle « les alertes ne sont jamais filtrées » — elle doit suivre les surfaces et **couvrir *Aujourd'hui*** |
| `components/candidatures/__tests__/stage-ui.test.ts` | aucun | Les étapes ne bougent pas |
| 12 autres tests de composants | aucun | Chat, sourcing, settings, availability : hors périmètre |
| **À ajouter** | 2 | Le routeur de modules (chaque écran a exactement une adresse) ; la carte des modules ↔ la cartographie du Manager (§6.5) |

### 6.4 Impact sur les signaux

`BusinessSignalTarget` est une union typée de 4 formes (`types/notifications.ts:23-34`). Elle
devient **une seule forme : une route**. Sept cibles à réécrire, **vérifiées à la compilation**,
et deux d'entre elles **gagnent en précision** : les signaux APEC pointeront
`/campagnes/CAMP-2026-221/diffusion` au lieu de la racine du workspace.

### 6.5 Impact sur la cartographie du Manager

`manager-cartography.ts` est **déjà périmé sur 6 points** (audit §1-F) alors qu'aucune
restructuration n'a eu lieu. Le fichier prévient lui-même : *« un chemin faux ici se traduit par
une orientation fausse côté donneur d'ordre »*. Deux conséquences :

1. La cartographie se **réécrit** avec la nouvelle carte — et devient enfin **citable** : le
   Manager pourra dire une **URL**, pas une suite de clics.
2. Un **test de non-divergence** entre les libellés du code (modules, sous-onglets, sections) et
   la cartographie doit naître dans le même lot. Sans lui, la dérive recommencera.

### 6.6 Estimation par module

| Lot | Contenu | Poids | Bloque |
|---|---|---|---|
| **M0 — Squelette adressable** | routeur de modules, 4 entrées, shell, redirections 301, proxy vérifié | **M** | tout le reste |
| **M1 — Campagnes** | `/campagnes`, page campagne + 6 sous-onglets (re-parentage), filtre campagne sur la file, vue d'ensemble dégraissée | **M** | M2 |
| **M2 — Aujourd'hui** | `TodayBoard`, 4 sections, 2 signaux ajoutés, 3 états à zéro, garde « alertes non filtrées » | **M** | — |
| **M3 — Candidats** | `/candidats` (transverse), fiche adressable, vivier re-parenté, contacts à approuver | **S** | — |
| **M4 — Pilotage** | reporting re-parenté, `/pilotage/equipe` | **S** | — |
| **M5 — Assistant de création** | 6 étapes + récap, découpe des 1 695 lignes, les 3 trous de provenance | **L** | — |
| **M6 — Lexique & cartographie** | libellés du §1.4 partout, cartographie réécrite, test de non-divergence | **S** | après M1-M5 |

**Ordre** : M0 → M1 → M2 → (M3, M4, M5 en parallèle) → M6.
**M0 + M1 + M2 constituent le minimum démontrable** : c'est le chemin (a) qui passe de 5 à 2
clics.

### 6.7 Ce qui avance en parallèle, sans attendre

La branche `fix/ux-mensonges` (correctifs vrais quelle que soit la structure) :
« Refus auto » → « Proposé au refus » · palette `STAGE_TONE_*` conforme AA (déjà écrite dans le
produit) · « Enregistrer » qui n'enregistre pas · champs obligatoires marqués · message
d'accueil du Manager conforme à la lecture seule · vouvoiement · identifiant `can_src_…` retiré
de la fiche.

⚠️ **Une seule collision** : les libellés de l'assistant (M5) et ceux corrigés dans
`fix/ux-mensonges` touchent `ThresholdDraftEditor` et `CollapsibleSection`. Corriger d'abord sur
`fix/`, l'assistant repartira du texte juste.

---

## 7. Questions ouvertes — à trancher avec les verbatims

| # | Question | Enjeu | Mon inclination |
|---|---|---|---|
| **Q1** | **Par campagne ou transverse comme chemin principal ?** Un recruteur pense-t-il « mes 3 campagnes » ou « mes 40 candidatures » ? | Détermine si *Campagnes* ou *Candidats* est la 2ᵉ entrée, et si la page campagne est le vrai poste de travail | Les deux coexistent ; *Aujourd'hui* tranche de fait, car il est **transverse**. À confirmer : un cabinet suivant 15 campagnes simultanées penche « par campagne ». |
| **Q2** | **Que reste-t-il au premier niveau ?** 4 entrées, ou 3 (*Candidats* rentre dans *Campagnes*) ? | Simplicité vs accès direct au vivier | Garder 4 : le **vivier est un stock**, pas une campagne, et la recherche d'une personne est un besoin réel. Mais **une entrée nommée « Candidats » qui contient aussi le vivier** mélange deux natures — à surveiller. |
| **Q3** | **Le filtre par référent est-il utile dans *Aujourd'hui* ?** | En mono-recruteur il est du bruit ; à 5 recruteurs il est vital | Le rendre **implicite** : par défaut « Mes campagnes » si l'utilisateur est référent d'au moins une, « Tous » sinon — **sans persistance** (règle du 27/08 : un filtre oublié est pire que pas de filtre) |
| **Q4** | ***Aujourd'hui* liste-t-il les dossiers, ou des compteurs cliquables ?** | La maquette §2.2 liste les dossiers (3-10 lignes). À 40 dossiers en attente, c'est un mur | Lister, **plafonné à 5 par section** + « voir les 37 autres ». À valider : quel volume réel en cabinet ? |
| **Q5** | **Jooble** — au programme, ou confusion avec APEC/ADEP ? | 3ᵉ `ChannelContentPanel` ou rien | **Absent du code.** La structure l'accueille sans modification. |
| **Q6** | **Le Lobby et le portail RH restent-ils sur le chemin ?** | 2 clics par session, mais c'est la **mimétique « entreprise virtuelle »**, différenciateur assumé face à Limova | Les **garder** (démo, extension future aux autres départements) mais **hors du chemin quotidien** : la connexion dépose sur *Aujourd'hui*, le fil d'Ariane y remonte |
| **Q7** | **Le Bureau (les 6 agents) disparaît-il de la vue quotidienne ?** | C'est l'écran qui fait l'effet « une équipe au travail » en rendez-vous client | Le déplacer en `/pilotage/equipe` **le retire de la démonstration d'ouverture**. Alternative : un bandeau compact d'agents en pied d'*Aujourd'hui*. **Arbitrage commercial, pas UX** — à trancher explicitement. |
| **Q8** | **Fusionner « À examiner » et « Propositions de refus » ?** | Le défaut n°D de l'audit vient de cette partition | La partition est **métier** (zone figée au scoring, jamais recalculée). Dans *Aujourd'hui* les deux se **fondent en une liste triée** (chaque ligne porte sa zone) ; dans la campagne, la partition reste. À valider auprès d'un recruteur. |

---

## 8. Ce qui ne change pas — rappel

Aucune règle métier n'est touchée : trois zones de décision et leurs seuils, HITL et ses claims
deux-phases, machine d'états du cycle de vie, invariants du module de réservation, « classée
sans suite » orthogonale au refus, « corriger = poser un nouveau marqueur », frontière
d'autonomie de `src/lib/scheduling/**`, purge RGPD, idempotence des envois. **Toutes les routes
`/api/*` sont conservées à l'identique** — c'est ce qui rend la suite S1-S25 insensible à cette
refonte, et c'est la garantie que la réorganisation ne peut pas casser le métier.
