# Spécification — HITL à 3 zones de décision (scoring → reporting → audit)

Document de référence **fonctionnel ET technique** du modèle de décision
candidat d'ORQA. Source de vérité pour tout comportement lié aux seuils, à la
validation humaine, au reporting de décision et au parcours d'audit.

Refonte livrée en **lots 1, 2 et 3** (tous mergés sur `main` et déployés en
prod). Mémoire associée : `project_hitl_three_zones`.

---

## 1. Vue d'ensemble fonctionnelle

### 1.1. Le problème (modèle binaire abandonné)

Avant la refonte, chaque campagne avait **un seuil unique** (`campaigns.threshold`,
défaut 75) : un CV était soit `accepté` soit `refusé`, et l'éventuelle validation
humaine était pilotée par un **toggle HITL global** (`app_settings.hitl_config`,
`{rejectionMail, acceptanceMail}`) commun à toutes les campagnes. Deux défauts :

- un seuil unique force une frontière nette là où le métier veut une **zone de
  doute** ;
- un toggle global ne permet pas de régler la posture campagne par campagne.

### 1.2. Le modèle à 3 zones

Chaque campagne porte **deux seuils** `bas ≤ haut` (`threshold_low` / `threshold_high`).
Le score total d'un CV (0–100) le range dans une zone :

| Zone | Condition | Décision |
|------|-----------|----------|
| **Refus auto** | `score < bas` | écarté automatiquement (système) |
| **Zone grise** | `bas ≤ score < haut` | **validation humaine requise** |
| **Acceptation auto** | `score ≥ haut` | retenu automatiquement (système) |

- **Refus auto** : mail de refus envoyé sans intervention.
- **Acceptation auto** : invitation + brief entretien sans intervention.
- **Zone grise** : la candidature part en **file de validation** ; un humain
  tranche (accepter → invitation / refuser → refus). Rien n'est envoyé tant que
  l'humain n'a pas décidé.

**Défauts de seuils.** Campagne **neuve** : `10 / 90` (zone grise large = posture
prudente). Campagne **historique** (backfill migration) : `0 / 100` (tout gris =
tout validé à la main, préserve le comportement observé avant la refonte).

**Bord assumé** : `score = 100` avec `haut = 100` → acceptation auto (`≥`).

### 1.3. Plus de « repêchage », plus de HITL global

Le seul mécanisme de validation humaine est désormais **la zone grise**. Il n'y a
plus de notion de « repêchage » ni de toggle global : la posture se règle via les
deux seuils de chaque campagne (UI : slider double poignée).

---

## 2. Niveaux de scoring (lien avec les zones)

La fiche de scoring porte des critères pondérés, chacun à un **niveau de
criticité**. Cinq niveaux (le niveau `obligatoire` a été **retiré** — cf. §6.3) :

| Niveau | Comportement (`CRITICITY_TO_BEHAVIOR`) | Effet sur le score |
|--------|----------------------------------------|--------------------|
| `redhibitoire` | `HARD_KNOCKOUT` | non démontré ⇒ **rejected** (éliminatoire dur, score réel conservé pour l'audit) |
| `critique` | `SOFT_WEIGHTED` | contribution proportionnelle au poids (le plus fort des soft) |
| `tres_important` | `SOFT_WEIGHTED` | idem |
| `important` | `SOFT_WEIGHTED` | idem |
| `souhaitable` | `SOFT_WEIGHTED` | idem |

**Formule du score (option B).** `base = Σ_SOFT(poids × facteur) / Σ_SOFT(poids) × 100`,
facteur = satisfait 1 / partiel 0,5 / non 0 / non vérifiable 0. Les critères
**HARD** (rédhibitoire) **filtrent** : non démontrés → `rejected` (le score réel
reste calculé et affiché). Détail : `docs/specs/scoring-hybrid.md`.

**Articulation scoring ↔ zones.** `scoreCandidat` calcule le score PUIS la zone
(`classifyDecisionZone`). Le `status` reste binaire (`accepted` / `rejected`) pour
compat, mais **la vérité est `decisionZone`** : un candidat en zone grise a
`status = 'rejected'` **provisoire** + `decisionZone = 'gray'`. Aucun lecteur
agissant ne se fie au `status` d'un gris — tout passe par `decisionZone`.

**Comportements dormants** (présents dans le code, mappés par AUCUN niveau) :
`HARD_CAP` (ancien `obligatoire`, plafonnait à `bas − 1`) et `SIGNAL_BONUS`.
Conservés pour ne rien casser ; réactivables si un niveau les remappe un jour.

---

## 3. Le gate de communication (auto vs file)

`src/lib/hitl/outreach-gate.ts` est piloté **par la zone**, plus par aucune config
globale :

- zone **auto** (accept/reject) → communication envoyée immédiatement ;
- zone **grise** → mise en **file de validation** (`pending_validations`) ;
- gris + échec de mise en file → état `deferred` (jamais d'auto-envoi, y compris
  via le chat).

Chat (upload manuel) ET poller IMAP lisent `decisionZone` **au même endroit** —
zéro duplication de logique de décision.

---

## 4. Décision humaine d'une candidature grise

La file de validation vit dans `pending_validations`. L'humain tranche depuis
l'UI ; l'envoi/validation passe par `POST /api/validations/[id]/send` qui :

1. envoie le mail (refus ou invitation selon la décision) ;
2. propage la décision dans `candidate_analyses` via
   `updateCandidateAnalysisDecision` : `decided_by = 'user'` + identité
   (`decided_by_user_id` / `_email` depuis la session). `decision_zone` **reste
   `gray`** (la frontière d'origine est immuable ; ce qui change, c'est qui a
   tranché). Le `status` devient le statut final (accepted/rejected).

Mécanique de file détaillée (brouillons, idempotence) : voir
`docs/specs/hitl-validation-suspendue.md` (le **gating global** y est supersédé
par le présent document — la zone remplace le toggle).

---

## 5. Reporting de décision (volumes, taux, recos)

`src/lib/reporting/aggregations.ts`. `computeVolumes` lit `decisionZone` +
`decidedBy` (jamais le `status` seul) :

| Champ `CampaignVolumes` | Définition |
|--------------------------|-----------|
| `received` | candidatures analysées |
| `retained` | `status = accepted` (accept auto **+** gris accepté par l'humain) |
| `rejected` | refus **PRIS** (refus auto **+** gris refusé) — exclut les gris en attente |
| `enAttente` | zone grise **pas encore tranchée** (`gray` & `decidedBy ≠ user`) |
| `decidedBySystem` | zones auto (`decisionZone ≠ gray`) |
| `decidedByHuman` | gris tranché (`decidedBy = user`) |

Invariants : `received = retained + rejected + enAttente` et
`received = decidedBySystem + decidedByHuman + enAttente`. Un **gris en attente**
a un `status = rejected` provisoire → il est **exclu de `retained` ET de
`rejected`** pour ne pas fausser les taux.

**« Validation humaine »** (remplace l'ancien « arbitrage ») :
`humanValidationRate = (enAttente + decidedByHuman) / received` = part des
candidatures passées en zone grise. Reco déclenchée au-delà de
`HUMAN_VALIDATION_HIGH_RATE = 0,5` → « resserrer les deux seuils pour automatiser
davantage de cas évidents ».

**Recommandations** (campagne + multi-campagnes) recalibrées et **ré-activées** :
canal dominant, retenue faible/élevée, time-to-hire, divergence de retenue entre
sites, canaux sans aucun retenu. (Elles avaient été neutralisées le temps de la
refonte ; le flag de neutralisation et son bandeau ont été **supprimés**.)

Surfaces : carte (`CampaignReportCard`), détails (`CampaignReportDetail`,
`MultiCampaignReportDetail`), PDF (`campaign-report-pdf`, `multi-campaign-report-pdf`),
KPIs dashboard (`KPIGrid`). Libellés : « Reçues / Retenues / Écartées / En attente /
Décidé par le système / Tranché par un humain » et « Validation humaine % ».

---

## 6. Parcours d'audit (4 phases)

`src/lib/reporting/candidate-journey.ts`. Le parcours candidat (Présélection →
Validation RH → Entretien → Décision finale) est **piloté par la zone**, plus par
le toggle HITL :

- `deriveJourneyFor(screeningStatus, decisionZone, decidedBy, markers?, isPending?)` ;
- **gating** = `decisionZone === 'gray'` (un gris est « en attente » jusqu'à
  décision ; les zones auto sont définitives/automatiques). Ligne historique sans
  zone (`null`) → non gated (ancien binaire) ;
- `humanIntervention` = **`decidedBy === 'user'`** (un humain a tranché un gris),
  source autoritaire — plus l'ancienne dérivation « override du verdict IA ».

`InterventionFlag` (liste d'audit) et le PDF affichent « **Tranché par un humain** »
vs « Décision automatique (système) ».

`journeyFromSignals` (`journey-lookup.ts`) et ses 5 call-sites (datum reporting +
4 routes `/api/reporting/audit/...`) passent `decisionZone` + `decidedBy`.

---

## 7. Modèle de données

| Table.colonne | Type | Rôle |
|---------------|------|------|
| `campaigns.threshold_low` / `threshold_high` | `int` (CHECK `low ≤ high`) | seuils par campagne ; nullable → repli applicatif `0/100` |
| `candidate_analyses.decision_zone` | `auto_reject` \| `gray` \| `auto_accept` (null = legacy) | **zone figée au scoring** (vraie zone de `scoreCandidat`) |
| `candidate_analyses.decided_by` | `auto` \| `user` (null = legacy) | qui a tranché le statut final |
| `candidate_analyses.decided_by_user_id` / `_email` | text null | identité du valideur (chemin `user`) |
| `candidate_analyses.hitl_config` | jsonb null | **snapshot d'audit conservé** (alimenté par `DEFAULT_HITL_CONFIG` ; plus de source globale) |

Types : `DecisionZone` / `DecidedBy` / `HumanDecider` (`src/types/hitl.ts`),
`ScoreResult.decisionZone` (`src/types/scoring.ts`), `CampaignVolumes` /
`CampaignAnalysisDatum` (`src/types/reporting.ts`).

**⚠️ Piège corrigé (lot 3c, bugfix).** `createCandidateAnalysis` persistait
`decision_zone` **re-dérivée du statut** (un helper binaire qui ne produit jamais
`gray`) → « En attente » du reporting et le gating du parcours étaient TOUJOURS
vides. Désormais on persiste `scoringResult.decisionZone` (repli statut→zone
seulement si absente).

---

## 8. Ce qui a été retiré

- **`campaigns.threshold`** (seuil unique) : colonne **droppée** (lot 3b) +
  `ActiveCampaign.threshold`, repos, `setThreshold`, API, `dispatchCVBatch` arg,
  `CVBatchSummary.threshold` → bande `thresholdLow/High`.
- **HITL global** `app_settings.hitl_config` (lot 3c) : retiré du type / repo /
  `/api/settings` / SettingsHub. **Snapshot conservé** côté `candidate_analyses`.
- **Niveau `obligatoire`** (HARD_CAP) : retiré de l'enum, des poids, libellés,
  couleurs, mappings, prompts. Le système ne le propose plus (UI + pré-remplissage) ;
  `normalizeSuggestableLevel` mappe défensivement le mot résiduel → `critique`.
- **Code mort** : `switchValidation` (page validation refondue).

Colonnes inertes conservées (aucune migration de drop) :
`app_settings.hitl_config`, `candidate_analyses.hitl_config` (audit historique).

---

## 9. Migrations

- Seuils `threshold_low/high` + backfill `0/100` : `scripts/migrate.sql` section
  « HITL 3 zones » — **appliquée dev + prod**.
- `drop column threshold` (lot 3b) : à appliquer **après déploiement** du code qui
  ne la lit/écrit plus — **appliquée dev + prod**.
- Retrait `obligatoire` : **pas de migration** (le niveau vit dans le jsonb
  `scoring_sheet`) → **reset des données scoring** dev + prod (solution pas encore
  utilisée par un client).
- Réflexes : reload schema cache PostgREST après toute migration ; appliquer la
  migration **avant** le déploiement/push ; le DO pousse (`git push` gaté côté
  assistant).

---

## 10. Carte technique (fichiers clés)

| Couche | Fichier | Rôle |
|--------|---------|------|
| Scoring | `src/lib/scoring/score-candidat.ts` | `scoreCandidat`, `classifyDecisionZone`, `DECISION_OUTCOME_MATRIX` |
| Scoring | `src/types/scoring.ts` | niveaux, `CRITICITY_TO_BEHAVIOR`, comportements (dont dormants) |
| Gate | `src/lib/hitl/outreach-gate.ts` | route auto / file selon la zone |
| Persistance | `src/lib/db/repos/candidate-analyses.ts` | `createCandidateAnalysis`, `updateCandidateAnalysisDecision`, `deriveDecisionZone` (repli) |
| Décision humaine | `src/app/api/validations/[id]/send/route.ts` | envoi + propagation `decided_by='user'` |
| Reporting | `src/lib/reporting/aggregations.ts` | `computeVolumes`, `HUMAN_VALIDATION_HIGH_RATE` |
| Reporting | `src/lib/reporting/campaign-report.ts` / `multi-campaign-report.ts` | recos recalibrées |
| Audit | `src/lib/reporting/candidate-journey.ts` / `journey-lookup.ts` | parcours piloté par la zone |
| UI | `CampaignCreateSheet` (slider double poignée), `CampaignReport*`, `KPIGrid`, `InterventionFlag` | surfaces |

**Tests** : `decision-zone.test.ts`, `score-candidat*.test.ts` (+ golden),
`candidate-journey.test.ts`, `campaign-report*.test.ts`, `multi-campaign-report*.test.ts`,
`candidate-analyses.test.ts`. Invariant projet : `npm run typecheck` + suite
vitest verte avant tout commit.
