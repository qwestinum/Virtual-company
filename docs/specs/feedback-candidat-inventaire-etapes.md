# Inventaire des lecteurs d'étape — avant le lot 3 (feat/feedback-candidat)

28/09/2026. Point d'arrêt demandé par le donneur d'ordre avant de toucher au type `CandidateStage`.

## Ce qui change dans le type

| Aujourd'hui (8) | Après le lot 3 (10) | Règle de dérivation |
|---|---|---|
| `a_valider` | `a_valider` | en file, zone **grise** (ou zone grise sans ligne de file) |
| — | **`proposition_refus`** | en file, zone **`proposed_reject`** (ou cette zone sans ligne de file) |
| `invite`, `rdv_pris`, `entretien_fait` | inchangés | inchangée |
| `retenu` | `retenu` | verdict `validated`, **sans** désignation |
| — | **`recrute`** | marqueur `candidate_hired_marked` (dernier gagne, gomme `cleared`), posé au lot 4 |
| `non_retenu` | `non_retenu` (**restreint**) | verdict `rejected` (dont `not_selected_at_closure`) **ou** absence `missed` |
| — | **`ecarte`** | refus sur CV : `decided_by='user'` sans marqueur d'entretien ni de verdict, **ou** l'ancien refus automatique |
| `refus_auto` | **supprimé** (fondu dans `ecarte`) | la ZONE `auto_reject` reste en base, intacte |
| `sans_suite` | inchangé | domine toujours tout |

Échelle de priorité : sans_suite › **recrute** › retenu › non_retenu (verdict) › entretien_fait › non_retenu (absence) › rdv_pris › invite › a_valider / **proposition_refus** › **ecarte**.

## 42 fichiers de production (38 par le type, 4 par les littéraux), en quatre familles

Un fichier peut figurer dans plusieurs familles (plusieurs lignes, plusieurs effets).

### A. Ce que le compilateur attrape seul (Record exhaustifs)
Un `Record<CandidateStage, …>` sans la nouvelle clé ne compile pas.

| Fichier | Lignes | Ce qu'il faut y mettre |
|---|---|---|
| `src/lib/reporting/candidate-stage.ts` | 32-42, 70-110, 114-128, 137-148, 165-176 | le type, la dérivation, les libellés courts (« Propositions de refus », « Recruté », « Écarté »), les tons (`recrute` positif, `ecarte` négatif, `proposition_refus` en attente), `emptyStageCounts` |
| `src/components/candidatures/stage-ui.ts` | 40-48, 55-63 | pastille de couleur et rang d'étape (`recrute` après `retenu` ; `proposition_refus` au rang 1 comme `a_valider`) |
| `src/lib/interviews/history-rows.ts` | 30-45 | l'union `HistoryVerdict` + libellé « Recruté » (Record de libellés) |
| `src/components/interviews/HistoryList.tsx` | 34-41 | le ton de `recrute` |

### B. ⚠️ Ce que le compilateur NE voit PAS
Ce sont des tableaux, des `switch` avec `default`, des égalités littérales. Une étape oubliée y disparaît **sans erreur**. C'est la famille qui justifie l'inventaire.

| Fichier | Lignes | Effet si on l'oublie | Correction |
|---|---|---|---|
| `candidate-stage.ts` `CANDIDATE_STAGE_RIBBON_ORDER` | 152-161 | puce **invisible** dans Candidatures | les 10 dans l'ordre du DO |
| `navigation/workspace-routes.ts` `STAGES` | 149-158 | `?statut=recrute` **effacé** en silence par la réécriture canonique ; ancien lien `?statut=refus_auto` perdu | dériver de `CANDIDATE_STAGES` (fin de la copie) + alias `refus_auto` → `ecarte` |
| `campagnes/card-detail.ts` `ETAPES_CARTE` + `APPARENCE` | 54-68 | carte à 4 compteurs au lieu de 11 | Reçues + rangée « en cours » (5) + rangée « issues » (5), arbitrage C |
| `candidatures/dismissal-batch.ts` `OPEN_STAGES` | 46-51 | une **proposition de refus** ne serait plus classée sans suite à la clôture (resterait ouverte pour toujours) | ajouter `proposition_refus` |
| `candidatures/stage-ui.ts` `isTerminalStage` | 163-170 | fiche d'un **recruté** ou d'un **écarté** sans « Corriger la décision » ni lecture seule | ajouter `recrute`, `ecarte` |
| `candidatures/CandidatureActions.tsx` | 47-78 | fiche d'une **proposition de refus** sans carte de décision ; compte rendu non affiché sur un recruté | `proposition_refus` ⇒ même branche que `a_valider` ; `recrute` comme `retenu` |
| `candidatures/CorrectDecisionAction.tsx` | 28 | bouton « Corriger » offert sur une proposition (rien à corriger) | exclure aussi `proposition_refus` |
| `candidatures/correction-options.ts` | 45-78 | `default: null` : l'écarté et le recruté **perdent** « Corriger la décision » | `ecarte` ⇒ décision de tri (auto si ancienne zone) ; `recrute` ⇒ famille « désignation » (lot 4) ; `proposition_refus` ⇒ `null` |
| `campagnes/CampaignDismissFlowDialog.tsx` | 132-133 | récapitulatif de clôture qui liste « Recruté/Écarté » comme **ouverts** | filtrer par `OPEN_STAGES` (source unique) au lieu d'une liste d'exclusions |
| `candidatures/CandidaturesWorkspace.tsx` | 313-315 | l'accès à la revue groupée reste sur « À valider » alors que les propositions n'y sont plus | le déplacer sur la puce « Propositions de refus » |
| `reporting/stage-signals.ts` `computeStageCountsByCampaign` | 273 | l'ancienneté « en attente » ignore les propositions | voir question 4 |
| `campagnes/CampaignCardDetail.tsx` | 89 | « Ce qui attend » ignore les propositions | idem, question 4 |
| `interviews/history-rows.ts` `historyVerdict` | 59-76 | `default: null` : un recruté, ou un invité écarté par correction, **disparaît** de l'historique des Entretiens | `recrute` ⇒ « Recruté » ; `ecarte` ⇒ `non_retenu` |
| `notifications/business-signals.ts` | 681 | le lien « remettre en file » vise `a_valider` ; une proposition orpheline est désormais ailleurs | viser la puce qui porte le plus d'orphelins (ou les deux, voir question 5) |
| `today/board.ts` | 197 | l'accès « à valider » de *Aujourd'hui* ne mène qu'aux gris | décider si *Aujourd'hui* ouvre aussi sur les propositions (lot 5) |

### C. Lecteurs à RELIRE (branchés sur une étape précise, sans changement attendu)
`candidatures/verdict.ts` (64 : `entretien_fait`), `candidatures/no-show.ts` (28 : `invite`/`rdv_pris`), `interviews/pipeline-rows.ts` (45, 147-151), `notifications/business-signals.ts` (265, 319-322), `interviews/VerdictRow.tsx` (37), `candidatures/correction-context.ts` (219-233, libellé seul), `candidatures/decision-correction.ts` (263). Aucune de leurs étapes ne change de sens.

⚠️ Une exception : `pipeline-rows` et Entretiens ne doivent PAS montrer un recruté comme « ouvert ». Son `OPEN_STAGES` local ne le contient pas : c'est correct, et **c'est vérifié** par cette relecture.

### D. Passe-plat (le type circule, aucune logique)
Routes `campaigns/counters`, `candidatures/counters`, `candidatures` (filtre sur `CANDIDATE_STAGES`, donc automatique), `reporting/audit/candidates/[id]` ; `CandidatureRow`, `StagePill`, `CandidaturesScreen`, `CandidaturesRibbon` (itère l'ordre du ruban), `CandidatureFullPage`, `CandidaturePanel`, `CampaignCard`, `useCandidatures` ; types `reporting.ts`, `notifications.ts`, `decision-correction.ts` ; `queue-coherence.ts` et `decision-markers.ts` (commentaires seulement).

## Hors du type, mais dans le périmètre du test négatif « Refusé »
Le DO demande qu'aucun rendu ne montre « Refusé », « Écarté sur CV » ou « Non retenu après entretien ». Ces rendus ne passent **pas** par `CandidateStage` :

| Fichier | Ligne | Texte | Proposition |
|---|---|---|---|
| `candidatures/ZonePill.tsx` | 35 | « Refusé (historique) » (pastille de ZONE) | « Écarté » |
| `candidatures/correction-options.ts` | 225 | « Refusé (historique) » (dialog de correction) | « Écarté (refus automatique antérieur au 18/08) » dans le **texte**, pas en libellé |
| `validations/ValidationsHistory.tsx` | 48 | « Refusée » (historique des validations) | « Écartée » |
| `bureau/ZoneDistribution.tsx` | 28 | « Refusés » (répartition du Bureau) | « Écartés » |
| `src/__tests__/lexique.test.ts` | 29, 96 | fige « Refusé (historique) » | remplacer ; ajouter les trois termes interdits |
| `docs/ux/lexique.md` | 75 | idem | la table des dix libellés |

Exclus volontairement : `jobboards` (« Refusée par l'Apec », il s'agit d'une annonce) et les commentaires de code.

## Parcours et frise (`reporting/candidate-journey.ts`)
Ce module a ses PROPRES états (`screening: retenu|ecarte`, `final: … retenu …`) : ce ne sont pas des étapes, mais le PDF d'audit et la frise les lisent. Deux libellés contredisent le nouveau lexique :
- ligne 80 : « Retenu définitivement ». Le lexique dit « présenté au client, jamais une promesse d'embauche ». Proposition : « Retenu », et « Recruté » pour le désigné (lot 5).
- ligne 330 : « Écarté au screening ». Ce libellé porte un complément, comme « Écarté sur CV » que le DO interdit. Proposition : « Écarté ».

## Tests à réaligner (22 fichiers)
Unitaires : `candidate-stage`, `stage-ui` (contraste des nouvelles pastilles, mesuré sur `globals.css`), `card-detail`, `correction-options`, `correction-context`, `decision-correction(-propagation)`, `history-rows`, `pipeline-rows`, `workspace-routes`, `queue-coherence`, `today/board`, `lexique`.
Régression : **S6** (invariant de partition : la somme des 10 = Reçues), S9, S16, S25.
E2E : S33, S40 (puces).
Nouveaux tests : « compteur = puce » pour chaque étape ; une ancienne adresse `?statut=refus_auto` qui ouvre « Écarté » ; aucun des trois libellés interdits dans aucun rendu.

## Questions à trancher avant le lot 3
1. **Définition d'« Écarté »** : le DO écrit « proposition de refus validée sur CV ». Un **gris** refusé par le recruteur arrive aussi là : c'est un refus sur CV, sans être une proposition. Infobulle proposée : « refusé sur CV par le recruteur (proposition validée ou arbitrage), dont refus automatiques antérieurs au 18/08 ».
2. **Anciennes adresses** : `?statut=non_retenu` gardé dans les favoris montrera moins de dossiers, puisque les refus sur CV passent en « Écarté ». On l'accepte, ou on ajoute un bandeau d'explication ?
3. **« Recruté » avant le lot 4** : le lot 3 crée l'étape et sa lecture, mais rien ne la produit avant le lot 4. On livre la puce dès le lot 3 (elle affichera 0), ou on la masque jusqu'au lot 4 ?
4. **« Ce qui attend »** (carte campagne) : les propositions en attente, sur la même ligne qu'« À valider » ou sur une ligne à part ? Je recommande une ligne à part : l'une attend un arbitrage, l'autre une revue groupée.
5. **Lien « remettre en file »** du signal de cohérence : viser la puce qui porte le plus d'orphelins, ou revenir à la page de validation qui montre les deux ?
