# Spécification — HITL à 3 zones de décision (scoring → reporting → audit)

Document de référence **fonctionnel ET technique** du modèle de décision
candidat d'ORQA. Source de vérité pour tout comportement lié aux seuils, à la
validation humaine, au reporting de décision et au parcours d'audit.

Refonte livrée en **lots 1, 2 et 3** (tous mergés sur `main` et déployés en
prod). Mémoire associée : `project_hitl_three_zones`.

> **Mise à jour (juil. 2026)** : la machine d'états de `pending_validations`
> est désormais `pending → sending → sent` **+ `void`** (terminal — validation
> fermée par « classement sans suite » de la candidature, uniquement depuis
> `pending`, un `sending` n'est jamais voidé). Un `void` n'est « en attente »
> pour AUCUN lecteur. Référence : `docs/specs/candidatures-sans-suite.md` §2.1.

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

### 4.1. Plus AUCUN refus automatique — le seuil bas propose, il n'envoie plus

**Mise en conformité RGPD (18/08/2026).** Une décision défavorable ne peut plus
être prise ET communiquée sans intervention humaine. La zone sous le seuil bas
**n'envoie donc plus rien** : elle met en file et **propose** un refus.

| Score | Zone | Effet |
|-------|------|-------|
| `< threshold_low` | **`proposed_reject`** | file HITL, **aucun mail** — sous-onglet « Propositions de refus », refus groupé en un geste |
| `[low, high[` | `gray` | file HITL — sous-onglet « À examiner », une par une |
| `≥ threshold_high` | `auto_accept` | **invitation envoyée automatiquement** (décision favorable et réversible : hors du champ que le RGPD verrouille) |

**Le « seuil de proposition de refus » EST `threshold_low`.** Il n'y a pas de
quatrième réglage. Une colonne dédiée (`rejection_proposal_threshold`) a existé
quelques heures : elle bornait une sous-file *à l'intérieur* de la zone grise et
ne supprimait donc aucun envoi automatique — contresens, colonne supprimée.

**`auto_reject` est LEGACY.** Elle n'est plus jamais produite, et elle est
conservée : elle marque les candidatures dont le refus est *réellement* parti
sans validation, avant la bascule. La fondre dans `proposed_reject` ferait
basculer rétroactivement tout l'historique des refus automatiques en « en
attente » — des rapports déjà envoyés changeraient de chiffres.

**Point d'application unique : `gateCandidateOutreach`.** Le gate liste la zone
qui ENVOIE (`auto_accept`) et met tout le reste en file — jamais l'inverse : une
zone ajoutée demain doit attendre par défaut, pas envoyer. Les deux pipelines
(chat, poller IMAP) passent par lui, il n'y a pas d'autre chemin de sortie de
mail candidat. Les replis des appelants retombent sur `proposed_reject`, jamais
sur `auto_reject` : un repli ne doit pas ressusciter l'envoi supprimé.

**Lecteurs sensibles** (prédicat partagé `isAwaitingHumanZone`, à ne pas
dupliquer) :
- `deriveCandidateStage` — `decidedBy === 'user'` prime (« Non retenu », quelle
  que soit la zone) ; une zone en attente sans ligne de file rend « À valider »,
  jamais un refus consommé ; `refus_auto` ne reste que pour le legacy.
- `computeVolumes` — `enAttente` couvre gris **et** proposés ; `decidedBySystem`
  se lit sur `decidedBy`, plus sur la zone.
- `deriveJourneyFor` — un gris fait passer le screening pour RETENU (son score
  est dans la bande) ; un `proposed_reject` a bien échoué au screening, mais son
  refus est **provisoire** (`rejectionGated`) jusqu'à confirmation.
- `zoneDistribution` (Bureau) — déjà agnostique : status + `decidedBy` + file
  rapprochée par uid, rien à changer.

### 4.2. Sous-onglet « Propositions de refus » (refus groupé)

Sous-onglet de Validation suspendue. L'onglet « À examiner » et
`ValidationCard` sont **intouchés** : la carte est réutilisée telle quelle sous
une couche de sélection, donc accepter une proposition suit exactement le chemin
d'acceptation normal.

Partition **stricte** (`partitionRejectionProposals`, pur/testé) sur la **ZONE
FIGÉE AU SCORING** (`candidate_analyses.decision_zone`), servie avec la file par
`GET /api/validations` (`zoneByValidation`, rapprochement par `payload.uid`,
chunké) : rien ne tombe entre les deux sous-onglets. Une zone inconnue, une
analyse introuvable, une acceptation en attente restent dans « À examiner ».
Tri **score décroissant** (les cas limites en tête), signal au-delà de ~200.

> ⚠️ **Ne JAMAIS repartitionner en comparant le score au seuil bas courant.**
> Les seuils d'une campagne se déplacent ; la zone d'un dossier déjà analysé,
> non — c'est la règle du modèle (« le changement s'applique aux prochaines
> candidatures »). Le défaut a été observé en recette : une candidature
> analysée en zone grise (score 80) basculait dans les propositions de refus
> après un déplacement du seuil bas à 93, soit re-jugée avec un barème qu'elle
> n'avait jamais connu. Deux réglages distincts : le seuil bas décide de la
> zone **au moment de l'analyse** ; la zone décide du sous-onglet **pour
> toujours**.

**Exécution** (`src/lib/hitl/bulk-reject.ts`) : ce n'est **pas** un nouveau
chemin de décision. Chaque candidature passe **une par une** par
`decideGrayValidation`, donc par sa propre réservation d'envoi, son claim
d'idempotence et sa finalisation. Séquentiel. Un échec **n'arrête pas** la
fournée et laisse la candidature `pending` — visible, retentable. Brouillon
indisponible ⇒ on ne décide **pas** (jamais de mail vide, jamais de candidature
« traitée » sans envoi). Confirmation **obligatoire**, liste nominative + score.

**Case « envoyer les mails de refus »**, cochée par défaut. Décochée, la
décision est enregistrée sans écrire au candidat : `mailStatus =
'skipped_by_user'`, et le journal **distingue** ce choix d'un échec d'envoi via
`hitl_mail_not_sent.payload.cause` (`'skipped_by_user'` vs `'send_failed'`) —
deux vérités d'audit différentes, sous une action unique pour que les
« décidés-non-contactés » restent requêtables d'une seule passe. `batchId`
journalisé de part et d'autre.

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

## 6bis. Cohérence entre l'analyse et sa fiche de validation (20/09/2026)

`candidate_analyses` et `pending_validations` décrivent **le même fait** — « ce
dossier attend une décision humaine » — **sans clé étrangère, sans contrainte,
sans réconciliation**. Chaque table est écrite par ses propres chemins. Rien ne
vérifie qu'elles racontent la même histoire, et elles ont divergé **dans les
deux sens**, en production comme en développement.

Diagnostics : `docs/ops/diagnostic-validations-orphelines-2026-09-20.md` (sens A)
et `docs/ops/plan-coherence-file-analyse-2026-09-20.md` (sens B + plan).

### 6bis.1 Les deux sens de la divergence

| | Sens A | Sens B |
|---|---|---|
| Symptôme | analyse **en attente**, **aucune** fiche ouverte | fiche **ouverte**, analyse qui **n'attend plus** |
| Ce que voit le recruteur | compté « À valider », **indécidable** — l'écran disait « Validation introuvable (déjà traitée ?) », l'hypothèse exactement inverse de la réalité | une carte d'arbitrage sur un dossier tranché ailleurs |
| Danger | un dossier oublié | **un refus envoyé à quelqu'un que le produit compte comme accepté** (cas réel : direction `reject`, score 100, analyse `auto_accept`) |

### 6bis.2 L'invariant, dans les deux sens et en un seul endroit

`src/lib/hitl/queue-coherence.ts` — **pur, testé, partagé**.

- `checkValidationCoherence(facts)` → `awaiting` · `settled{reason}` · `unknown`.
  L'ordre suit `deriveCandidateStage` : classement sans suite, puis décision
  humaine, puis zone. Quatre motifs de clôture : `accepted`, `decided`,
  `dismissed`, `legacy_auto_reject`.
- `queueMismatch({ coherence, hasOpenRow })` → `awaiting_without_row` ·
  `row_without_awaiting` · `null`.

⚠️ **Le doute ne conclut JAMAIS.** Analyse introuvable ou zone absente (ligne
antérieure au modèle 3 zones) ⇒ `unknown` : la carte garde son chemin de
décision, et le signal ne compte aucun écart. Retirer un arbitrage sur une
incertitude serait pire que la divergence qu'on cherche à voir.

⚠️ **Un seul prédicat pour les deux sens.** En écrire un par direction
re-fabriquerait la divergence : c'est précisément ce qui est arrivé au premier
signal (`validations_orphelines`, 20/09), qui n'en surveillait qu'un et a laissé
le défaut de production vivre un mois dans l'angle mort de l'autre.

### 6bis.3 Deux écrivains, et deux seulement

| Écrivain | Rôle | Appelants |
|---|---|---|
| `hitl/enqueue.ts` — `enqueueValidationRow` | **OUVRIR** une fiche. Upsert par id déterministe, fusion non destructive. Rend `written` \| `already_engaged` \| `failed` — `already_engaged` est un succès distinct, pour que l'appelant ne journalise pas une mise en file qui n'a pas eu lieu. | poller IMAP, filet serveur du chat, `requeue`, re-scoring (branche entrante) |
| `hitl/settle.ts` — `settleValidationsForAnalysis` | **FERMER** une fiche (`pending → void`). Cherche par **uid** et non par l'id canonique : les fiches antérieures à l'id déterministe portent un id aléatoire, et ce sont celles qu'on ne retrouverait pas autrement. Un `sending` **suspend tout**. | re-scoring (branche sortante), correction de décision, route du hub |

Le **classement sans suite** garde son chemin propre (`dismissal.ts`) : il ferme
déjà sa fiche, avant le classement, avec ses propres claims.

**Garde structurelle sondée** — `src/lib/hitl/__tests__/queue-writers.test.ts` :
aucun fichier du produit n'appelle les primitives d'écriture de statut hors
d'une liste **assumée et motivée**. Un chemin ajouté fait rougir la suite en le
nommant. C'est la seule chose qui tient la discipline, puisque le défaut consiste
à **ne pas** appeler quelque chose — aucun test de logique ne peut l'attraper.

### 6bis.4 L'identifiant d'une fiche est DÉRIVÉ, jamais choisi

`hitl/validation-id.ts` — `validationIdFor(analysisId, decision)` =
`val_<racine de l'analyse>_<décision>`. **C'est un CONTRAT** : il doit continuer
de rendre les identifiants déjà en base (`val_imap_<boîte>_<uid>_reject`), sinon
une re-mise en file crée un doublon au lieu de retrouver la ligne.

`POST /api/validations` le **dérive** du dossier (`payload.analysisId ?? uid`) :
l'id envoyé par l'appelant n'est qu'un repli. C'était le dernier chemin par
lequel deux fiches pouvaient coexister pour une candidature — et le chemin chat
en tirait une **aléatoire** (`nowTaskId('val')`), donc deux dispatches du même
lot créaient deux fiches pour un seul candidat.

### 6bis.5 Ce que l'écran en fait

- Fiche **désarmée**, jamais masquée (`SettledValidationCard`) : plus de
  « Accepter / Refuser », la phrase qui dit pourquoi, et **un** geste — *Clore
  cette fiche*. Masquer aurait fait disparaître des dossiers du hub sans que
  personne ne sache pourquoi le compteur a bougé.
- Une fiche désarmée **n'est pas sélectionnable** dans le refus groupé.
- Sens A, côté fiche candidature : le bandeau dit le fait et propose
  *Remettre en file* (`POST /api/validations/requeue`) — la cible est **relue
  côté serveur** (409 sur un dossier tranché, classé, ou hors zone d'attente).
- **Clore n'est pas refuser** : aucun mail, aucune décision, le verdict de
  screening, la zone et `decided_by` restent intacts. Journal
  `validation_settled` / `validation_requeued`.

### 6bis.6 Le signal

`validations_incoherentes` (registre `BUSINESS_SIGNALS`) compte les **deux**
écarts et les **nomme séparément** — ils n'appellent pas le même geste, et les
fondre dans un total rendrait le signal inactionnable :

> « 13 dossiers ne sont pas cohérents entre la file de validation et leur
> analyse : 12 attendent sans fiche de validation (non décidables), 1 garde une
> fiche qui n'a plus lieu d'être. »

---

## 7. Modèle de données

| Table.colonne | Type | Rôle |
|---------------|------|------|
| `campaigns.threshold_low` / `threshold_high` | `int` (CHECK `low ≤ high`) | seuils par campagne ; nullable → repli applicatif `0/100` |
| `candidate_analyses.decision_zone` | `proposed_reject` \| `gray` \| `auto_accept` \| `auto_reject` (LEGACY ; null = pré-modèle) | **zone figée au scoring** (vraie zone de `scoreCandidat`) |
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
| **Cohérence** | `src/lib/hitl/queue-coherence.ts` | `checkValidationCoherence`, `queueMismatch`, `SETTLED_LABELS` — **pur**, les deux sens |
| **Cohérence** | `src/lib/hitl/validation-id.ts` | `validationIdFor` — l'identifiant d'une fiche est un CONTRAT |
| **Cohérence** | `src/lib/hitl/enqueue.ts` / `settle.ts` | les **deux** écrivains de la file (ouvrir / fermer) |
| **Cohérence** | `src/lib/hitl/requeue.ts` / `validation-from-analysis.ts` | re-mise en file (sens A), reconstruction pure depuis l'analyse |
| **Cohérence** | `SettledValidationCard`, `GrayValidationAction` | fiche désarmée, bandeau « fiche introuvable » |
| **Cohérence** | `POST /api/validations/requeue`, `POST /api/validations/[id]/settle` | les deux gestes de réparation, cible relue serveur |

**Tests** : `decision-zone.test.ts`, `score-candidat*.test.ts` (+ golden),
`candidate-journey.test.ts`, `campaign-report*.test.ts`, `multi-campaign-report*.test.ts`,
`candidate-analyses.test.ts`.
**Cohérence** : `queue-coherence.test.ts` (les deux sens + le doute),
`validation-id.test.ts` (le contrat, aller-retour), `validation-from-analysis.test.ts`
(ce qu'il REFUSE), `requeue-no-send.test.ts` et `queue-writers.test.ts`
(**gardes structurelles sondées** : aucun émetteur importé, aucun écrivain hors liste). Invariant projet : `npm run typecheck` + suite
vitest verte avant tout commit.
