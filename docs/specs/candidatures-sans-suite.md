# Spécification — « Classée sans suite » (fin de vie propre des candidatures)

Document de référence **fonctionnel ET technique** du classement sans suite.
Source de vérité pour tout comportement lié à la fin de vie d'une candidature
non traitée. Livré et mergé le 29/07/2026 (commits `2e6079d`, `f706d86`,
`a374d03`). Mémoire associée : `project_sans_suite`.

---

## 1. Fonctionnel

### 1.1. Le problème

Aucun statut ne gérait les candidatures qu'on ne traitera **jamais** :
campagne clôturée avec des candidatures en cours (grises, invitées,
entretiens sans décision), poste pourvu (les autres candidats deviennent sans
objet), candidat retiré ou sans réponse, doublons/invalides. Elles restaient
« en attente » pour toujours, polluaient les compteurs et déclenchaient à
tort les notifications métier.

### 1.2. Le principe (non négociable)

- **« Classée sans suite » est un terminal DISTINCT du refus.** Un refus est
  une décision d'évaluation (examiné → rejeté, mail de refus). Une sans-suite
  n'est **pas** une évaluation : la candidature n'a jamais été examinée
  jusqu'au bout, pour une raison **externe**. Les mélanger fausserait la
  sélectivité et l'audit candidat.
- **Raison typée obligatoire** : `campagne_cloturee` · `poste_pourvu` ·
  `candidat_retire` · `sans_reponse` · `doublon` · `invalide`
  (`src/types/dismissal.ts`, enum extensible).
- **Jamais de suppression ni d'archivage-masquage** : la candidature reste
  visible et requêtable. « Sans suite » est un état, pas une disparition.
- **Toujours tracé** : qui (auto/humain + identité snapshot, pattern
  `decided_by`), quand, pourquoi (la raison), via le journal.

### 1.3. Les trois déclencheurs

1. **Clôture de campagne** — dialog `CampaignDismissFlowDialog` (mode
   `close`) : récapitulatif des candidatures en cours par étape, motif
   (`poste_pourvu` pré-coché si un GO existe, sinon `campagne_cloturee`),
   option mail. Jamais silencieux : clôturer **sans** classer reste possible.
   Branché sur les **trois** clôtures (carte campagne, Sheet d'édition,
   sélecteur du chat) — plus aucun `window.confirm`.
2. **GO définitif (poste pourvu)** — après « GO définitif » sur un candidat,
   le même dialog (mode `go`) propose de classer les candidatures restantes
   en `poste_pourvu`, **sans clôturer** la campagne. Non bloquant (« Plus
   tard ») : le GO est déjà acté si l'utilisateur décline.
3. **Action individuelle** — sur toute étape ouverte, « Classer sans suite »
   avec les raisons individuelles seulement (`candidat_retire`,
   `sans_reponse`, `doublon`, `invalide` — les raisons campagne sont
   refusées en 400 sur cette route).

### 1.4. Périmètre du classable

| Étape | Classable ? |
|---|---|
| `a_valider` (gris en attente) | oui |
| gris en cours d'envoi (`sending`) | **différé** (409 `send_in_flight`) — jamais classer sous incertitude d'envoi |
| `invite`, `rdv_pris`, `entretien_fait` | oui |
| `retenu` (GO) | **non** — c'est le recruté |
| `non_retenu`, `refus_auto`, `sans_suite` | non (déjà terminaux) |
| Files IMAP sans ligne `candidate_analyses` (retries, `pending_sheet`, `unmatched`) | **hors périmètre assumé** — pas encore des candidatures |

### 1.5. Le mail d'information

Template **pur et dédié** (`dismissal-template.ts`) — jamais le template de
refus : le texte ne laisse **jamais** croire à une évaluation négative
(« cela ne présage en rien de la qualité de votre profil »), ton vivier
(« nous conservons votre profil »), **mention RGPD systématique** partagée.
Matrice par raison (validée) :

| Raison | Mail |
|---|---|
| `campagne_cloturee`, `poste_pourvu`, `sans_reponse` | proposé **coché** |
| `candidat_retire` | proposé **décoché** (il sait déjà — le recruteur choisit) |
| `doublon`, `invalide` | **jamais** (option masquée) |

Envoi **exactly-once** : claim deux-phases
`('candidature_dismissal', analysisId, 'dismiss')` dans `imap_outreach_claims`
(claim avant `sendEmail`, confirm après, release sur échec) — un classement
rejoué ne renvoie jamais. `replyTo` = adresse de réception de la campagne
(les réponses restent rattachables par le poller).

### 1.6. Compteurs et taux

« Sans suite » est une **catégorie propre partout** — ni accepté, ni refusé,
ni en attente. Le total reçu ne change jamais, la ventilation s'enrichit et
**la partition somme** : `reçues = retenues + écartées + en attente + sans
suite`. Les **taux** des rapports (rétention, validation humaine, réponse,
sélectivité des recos) sont calculés sur les **évaluées** (reçues − sans
suite), avec une note de bas de page dans les PDF (« taux calculés sur les
candidatures évaluées »). Le Bureau affiche une 5ᵉ catégorie (total complet
inchangé). Les performances par canal excluent les sans-suite.

### 1.7. Notifications

Les signaux métier s'éteignent **par construction**, sans filtre ad hoc :
le signal 1 compte les validations `pending` (une voidée en sort), le
signal 2 teste le stage dérivé (`sans_suite` n'est pas `entretien_fait`).

### 1.8. Réversibilité

« Rouvrir la candidature » sur l'étape `sans_suite` : lève le classement, la
validation `void` redevient `pending`, les briefs annulés retrouvent leur
état (`scheduled` si un `booking_uid` existait, sinon `awaiting_booking`).
Un mail d'information déjà parti ne se dé-envoie pas (rappelé dans le
dialog) ; le claim confirmé reste — un re-classement futur ne RE-enverra pas.
La trace d'origine survit au journal.

---

## 2. Technique

### 2.1. Modèle de données (option B — jamais un 3ᵉ statut)

Colonnes **orthogonales** sur `candidate_analyses` (le verdict de screening
`status`, la `decision_zone` et `decided_by` restent INTACTS — un 3ᵉ statut
aurait contaminé `deriveDecisionZone`, l'audit et le PDF en « Écarté ») :

```
dismissed_at timestamptz null        -- null = non classée
dismissal_reason text null           -- CHECK sur l'enum des 6 raisons
dismissed_by text null               -- CHECK ('auto','user')
dismissed_by_user_id uuid null       -- snapshot identité (pattern decided_by)
dismissed_by_user_email text null
-- CHECK cohérence : (dismissed_at is null) = (dismissal_reason is null)
```

Satellites fermés :
- `pending_validations.status` += **`void`** (terminal) — transition
  **uniquement** `pending → void` (conditionnelle) ; un `sending` n'est
  jamais voidé. Réouverture : `void → pending`.
- `interview_briefs.status` += **`cancelled`** — bloque le « booking
  posthume » (`getPendingBriefByEmail`/`listScheduledInterviewUids` ne lisent
  que les états actifs). Restauration à la réouverture via `booking_uid`.

### 2.2. Écritures (atomicité)

- `dismissCandidateAnalysis` : update conditionnel `.is('dismissed_at', null)`
  — un seul gagnant, idempotent (`already_dismissed` au rejeu).
- `updateCandidateAnalysisDecision` gardé par `.is('dismissed_at', null)` —
  une décision tardive n'écrase jamais un classement (ceinture ; le void de
  la validation ferme déjà la porte en amont).
- Protocole complet dans le **cœur partagé unique**
  `src/lib/candidatures/dismissal.ts` (`dismissCandidature` /
  `reopenCandidature`) : void HITL → classement conditionnel → annulation
  briefs → mail sous claim → journal honnête. Batch clôture/GO :
  `dismissal-batch.ts` (énumération via `stageFor` **canonique**, séquentiel).

### 2.3. Étape dérivée

8ᵉ stage **`sans_suite`** (`candidate-stage.ts`), **prioritaire sur tout**
(y compris un marqueur GO) — terminal, ton neutre (ni vert ni rouge).
⚠️ Deux pièges NON compilables, couverts par tests : le tableau
`CANDIDATE_STAGE_RIBBON_ORDER` (une étape absente = carte invisible — test
garde-fou d'exhaustivité) et le littéral `ZONES` de `ZoneDistribution` (5
catégories à la main).

### 2.4. Routes

| Route | Rôle |
|---|---|
| `POST /api/candidatures/[id]/dismiss` | classement individuel (raisons individuelles only, 400 sinon ; 409 `send_in_flight` sur gris `sending`) |
| `POST /api/candidatures/[id]/reopen` | réouverture |
| `GET /api/campaigns/[id]/open-candidatures` | récapitulatif (compteurs par étape ouverte + `hasRetenu`) |
| `POST /api/campaigns/[id]/open-candidatures` | classement en masse SANS clôture (flux GO) |
| `POST /api/campaigns/[id]/close` | clôture dédiée — **seul chemin qui pose `closed_at`** (le PUT snapshot ne l'a jamais fait) + classement optionnel |

### 2.5. Journal

`candidature_dismissed` (uid, raison, `mailStatus`/`mailSent` réels,
`voidedValidationId`), `candidature_dismissal_mail_not_sent` (classés jamais
informés requêtables), `candidature_dismissal_reverted`,
`campaign_closure_dismissals` (résumé de clôture). Événement daté dans la
timeline candidat et l'historique d'audit (motif affiché).

### 2.6. Lecteurs alignés (inventaire)

`computeVolumes` (`classeeSansSuite`, partition), taux sur évaluées
(`campaign-report`, `multi-campaign-report`), `channelPerformance` (exclus),
`zone-counts` Bureau (5ᵉ catégorie, total complet — filtre `dismissed` sur
les counts), parcours d'audit (`final: 'sans_suite'`, jamais « écarté » ;
filtre `sans_suite`), timeline + historique, PDF (ligne « Sans suite » +
note de bas de page), vivier (un sans-suite reste « a déjà postulé » —
exclusion inchangée, voulue).

### 2.7. Tests

Unitaires : priorité du stage, partition des volumes, taux évalués, template
(matrice alignée, ton sans-refus), transitions void. Régression **S9** :
clôture complète (closed_at, void, compteurs, extinction signal 1, mail
exactly-once au rejeu), réouverture, individuel, flux GO (hasRetenu, masse
sans clôture, recruté jamais classé), gris `sending` différé. **S6 étendu** :
l'invariant de partition inclut le terme `sans_suite` des deux côtés.
