# Diagnostic — les 14 dossiers « À valider », dont 12 indécidables

**Date** : 20/09/2026 · **Base** : dev (`sacopwwazjbibfazfmmv`) · **Statut** : DIAGNOSTIC, aucun
code modifié, aucune écriture en base.
**Origine** : `docs/ux/maquette-structure-v2-2026-09-20.md` §0.2 — la refonte fait de la puce
« À valider » l'entrée unique, il fallait savoir ce qu'elle compte.

---

## 1. Le symptôme

| Mesure | Valeur |
|---|---|
| Candidatures en zone d'attente (`gray` ∪ `proposed_reject`), `decided_by='auto'`, non classées | **14** &larr; ce que compte la puce « À valider » |
| Dont une ligne dans `pending_validations` | **2** |
| **Dont aucune** | **12** |

Sur ces 12, l'écran affiche, en gris italique 12 px :

> *« Validation introuvable (déjà traitée ?). »* — `GrayValidationAction.tsx:57-62`

Le dossier est présenté comme attendant une décision, **il n'est pas décidable**, et le message
**suggère l'inverse de la vérité** : il n'a pas été traité, il est perdu de vue.

### Les 14, en clair

| uid | créée | score | zone | campagne | source | file |
|---|---|---|---|---|---|---|
| 1730 | 13/08 | 80 | `gray` | CAMP-2026-293 | email | **aucune** |
| 1779 | 20/08 | 10 | `proposed_reject` | CAMP-2026-511 | email | **aucune** |
| 1780 | 20/08 | 12 | `proposed_reject` | CAMP-2026-511 | email | **aucune** |
| 66174 | 20/08 | 10 | `proposed_reject` | CAMP-2026-511 | email | **aucune** |
| 66179 | 20/08 | 14 | `proposed_reject` | CAMP-2026-511 | email | **aucune** |
| 66181 | 20/08 | 10 | `proposed_reject` | CAMP-2026-511 | email | **aucune** |
| 66183 | 20/08 | 12 | `proposed_reject` | CAMP-2026-511 | email | **aucune** |
| 1781 | 20/08 | 12 | `proposed_reject` | CAMP-2026-511 | email | **aucune** |
| 1782 | 21/08 | 12 | `proposed_reject` | CAMP-2026-573 | email | **aucune** |
| 66185 | 21/08 | 12 | `proposed_reject` | CAMP-2026-511 | email | **aucune** |
| 66187 | 21/08 | 6 | `proposed_reject` | CAMP-2026-511 | email | **aucune** |
| 66188 | 21/08 | 10 | `proposed_reject` | CAMP-2026-511 | email | **aucune** |
| 1903 | 10/09 | 0 | `proposed_reject` | CAMP-2026-628 | email | `pending` |
| 1904 | 10/09 | 0 | `proposed_reject` | CAMP-2026-628 | email | `pending` |

Les 14 viennent du **même chemin** (`source = email`, donc le poller IMAP). Deux boîtes
différentes (uids `17xx` et `661xx`). `computed_at = created_at` partout : aucune n'a été
recalculée après coup.

---

## 2. Ce que ce n'est pas

Cinq hypothèses écartées, chacune sur preuve.

### 2.1 ❌ Ce n'est pas un défaut du gate HITL

`gateCandidateOutreach` liste la **seule** zone qui envoie (`auto_accept`) et met **tout le
reste** en file. `proposed_reject` et `gray` passent donc bien par `ports.enqueue()`
(`outreach-gate.ts:68-86`). Le chemin IMAP l'appelle sans condition pour le mode `reject`
(`imap/outreach.ts:178-181`) — seul le mode `invite` a un retour anticipé, et seulement faute de
lien de réservation.

### 2.2 ❌ Ce n'est pas une mise en file ratée

Le journal porte **`imap_outreach_pending`** pour les uids concernés :

```
uid 1730   : 08-13 15:28 imap_cv_received · 15:29 imap_cv_analyzed · 15:29 imap_outreach_pending
uid 1779   : 08-20 18:55 imap_cv_received · 18:56 imap_cv_analyzed · 18:56 imap_outreach_pending
uid 1780   : 08-20 19:07 … imap_outreach_pending
uid 1781   : 08-20 20:44 … imap_outreach_pending
uid 1782   : 08-21 01:04 … imap_outreach_pending
uid 66174  : 08-20 20:21 … imap_outreach_pending
uid 66179  : 08-20 20:21 … imap_outreach_pending
uid 66181  : 08-20 20:22 … imap_outreach_pending
uid 66183  : 08-20 20:22 … imap_outreach_pending
```

*(les 3 derniers uids et les 2 de septembre tombent hors de la fenêtre de 1 000 entrées lue)*

Or cette entrée **ne s'écrit qu'après un upsert réussi** : le chemin d'échec retourne `false`
avant de journaliser, et le cas « rien à écrire » retourne `true` **également avant**
(`imap/outreach.ts:305-320`). Une entrée `imap_outreach_pending` est donc la **preuve** que la
ligne a existé en base.

> **Les lignes ont bien été créées. Elles ont disparu ensuite.**

### 2.3 ❌ Ce n'est pas la purge RGPD

Une seule demande exécutée sur cette base (`gdpr_erasure_requests`, réf. `TEST-DEV-2026-08-27`,
exécutée le **02/09**), et son compteur dit : **`validations: 0`**. Elle n'a supprimé aucune ligne
de file. Par ailleurs les 12 analyses portent **leur vrai nom** (BAHATI KATAKA, Imad BELFAQIR) —
elles n'ont pas été pseudonymisées.

### 2.4 ❌ Ce n'est pas le nettoyage de la suite de régression

`tests/regression/helpers/db.ts` est borné à `TEST_CAMPAIGN_PREFIX = 'CAMP-TREG-'` et aux adresses
`%@<domaine de test>`. Les campagnes concernées (`CAMP-2026-293/511/573`) et les adresses
(`gmail`, `yahoo`) sont hors périmètre. Et surtout : ce nettoyage supprime, **dans la même
boucle**, `pending_validations`, `candidate_analyses` ET `journal` — or les analyses et le journal
sont intacts.

### 2.5 ❌ Ce n'est pas le re-scoring

**Zéro** entrée `analysis_rescored` sur cette base. Le script n'a jamais tourné ici.

---

## 3. Ce que c'est : la table a été vidée à la main

Âge de la donnée, table par table :

| table | lignes | plus ancienne | plus récente |
|---|---|---|---|
| `candidate_analyses` | 68 | **03/07/2026** | 17/09 |
| `journal` | 4 414 | **03/07/2026** | 20/09 |
| `imap_outreach_claims` | 155 | **03/07/2026** | 19/09 |
| `artifacts_meta` | 318 | **03/07/2026** | 17/09 |
| **`pending_validations`** | **4** | **10/09/2026** | 14/09 |
| **`interview_briefs`** | **7** | **03/09/2026** | 17/09 |

Toutes les tables remontent au **3 juillet**, sauf deux qui commencent en **septembre**. Aucun
code du dépôt ne supprime dans `pending_validations` en dehors de la purge RGPD (`execute.ts`),
dont les compteurs sont à zéro.

> **Conclusion sur la cause des 12** : suppression manuelle de `pending_validations` (et
> `interview_briefs`) sur la base de dev, entre le 02/09 et le 10/09. **Ce n'est pas un défaut du
> produit.** Les analyses, elles, ont survécu — d'où les fantômes.

---

## 4. Mais le diagnostic met au jour un vrai défaut, et il est vivant

**`candidate_analyses` et `pending_validations` décrivent le même fait, et rien ne les relie.**
Pas de clé étrangère, pas de réconciliation, **aucun lecteur qui remarque la divergence**. Un
dossier peut donc rester en `a_valider` indéfiniment sans que rien n'existe pour agir dessus.

C'est exactement la classe de défaut identifiée le 21/08 sur le fil d'activité : *« une liste
maintenue à côté finit par diverger, et la divergence est SILENCIEUSE »*. Ici, elle l'est.

### 4.1 Trois chemins du code ACTUEL produisent cet état, sans aucune manipulation

**① Le dépôt de CV par le chat — le seul qui peut frapper un client.**
`/api/cv-analyzer` **persiste l'analyse côté serveur** (`route.ts:180`, avec sa `decision_zone`).
La mise en file, elle, est orchestrée **côté navigateur** : `manager-flow.ts` est de
l'« orchestration client » (il lit `useCampaignsStore.getState()`), et le dispatch part en
**fire-and-forget** :

```ts
// src/lib/chat/manager-flow.ts:502
void dispatchPostAnalysisOutreach({ campaignId, jobTitle, summary, uids, … });
```

Onglet fermé, réseau coupé, navigation pendant la boucle : **l'analyse est persistée, la file ne
l'est pas.** Le candidat porte « À valider » et personne ne peut le décider. Le chemin IMAP, lui,
fait tout côté serveur et **remonte l'échec** (`RetryableOutreachError` → curseur gelé → réessai) :
les deux portes d'entrée n'ont pas la même garantie.

**② Le re-scoring.** `rescore-analyses.ts:244` **patche le score d'une validation existante** —
il n'en crée jamais :

```ts
await patchPendingValidationDecision(`val_${r.id.replace(/^can_/, '')}_reject`, { score: after })
  .catch(() => {});
```

Un dossier que le re-scoring fait **entrer** en zone d'attente (par exemple `auto_reject` legacy
ou `auto_accept` → `proposed_reject`) devient un fantôme. Le `.catch(() => {})` avale au passage
l'absence de cible. Jamais lancé sur cette base, mais c'est **l'outil de réparation documenté**,
et la réparation du 21/08 est précisément le scénario où il sert.

**③ La purge RGPD.** Par doctrine, `pending_validations` est **EFFACER** et `candidate_analyses`
est **PSEUDONYMISER** (squelette conservé : date, campagne, score, **zone**). La purge ne pose
**pas** `dismissed_at` (vérifié : aucune mention dans `execute.ts`). Un sujet purgé alors qu'une de
ses candidatures est en `gray`/`proposed_reject` avec `decided_by='auto'` laisse donc **un dossier
à décider sur une personne dont on vient d'effacer les données**.
*Aucun cas dans cette base — les 19 analyses pseudonymisées sont soit `auto_accept`, soit déjà
tranchées, soit déjà classées — mais le chemin est ouvert.*

### 4.2 Et le produit affirme le contraire de ce qu'il constate

```
« Validation introuvable (déjà traitée ?). »
```

« Déjà traitée » est l'hypothèse **exactement inverse** de la réalité. Un dossier jamais traité est
présenté comme probablement traité, dans le gris le moins lisible de l'écran
(`text-stone-400`, 12 px, italique — 2,56:1, sous le seuil AA). C'est la même faute que
« Refus auto » : une interface qui décrit un état qu'elle n'a pas vérifié.

---

## 5. Correctifs — APPLIQUÉS le 20/09/2026

Branche `fix/validations-orphelines`. Typecheck propre, **2 690 tests unitaires verts**,
**suite de régression S1→S25 au niveau de la ligne de base** (1 échec, `S20.4`, présent avant
comme après — cf. §5.1), aucune erreur de lint ajoutée. Vérifié sur la base dev : le bandeau
s'affiche sur un dossier orphelin, la carte de validation reste intacte sur un dossier sain, et
le nouveau signal remonte **12**.

| # | Correctif | Ce que ça résout | État |
|---|---|---|---|
| **1** ✅ | **Dire la vérité, et proposer une sortie.** Remplacer le message par : *« Ce dossier attend une décision, mais sa fiche de validation est introuvable — elle n'a pas été créée, ou elle a été supprimée. »* + deux actions : **[ Remettre en file ]** et **[ Classer sans suite ]** | Le mensonge (§4.2) et l'impasse | fait |
| **2** ✅ | **Rendre la divergence bruyante.** Un signal métier `validations_orphelines` : « N candidatures attendent une décision sans fiche de validation », dans la section **À vérifier** d'*Aujourd'hui*. Une entrée dans `BUSINESS_SIGNALS`, ni route ni composant à toucher | La divergence silencieuse (§4) | fait |
| **3** ✅ | **Fermer le chemin ①** — mettre en file **côté serveur** dans `/api/cv-analyzer` (`after()`), comme le fait déjà l'IMAP. La seule des trois portes qui peut perdre un dossier chez un client | Le défaut vivant le plus dangereux | fait |
| **4** ✅ | **Fermer le chemin ②** — `rescore` crée la ligne si la zone devient une zone d'attente ; à défaut, il **refuse** de re-scorer un dossier qu'il ferait entrer en attente, **et le dit**. Retirer le `.catch(() => {})` qui avale l'absence de cible | Le fantôme fabriqué par l'outil de réparation | fait |
| **5** ✅ | **Fermer le chemin ③** — la purge **classe sans suite** (`dismissed_at`, raison dédiée) l'analyse qu'elle prive de sa file. Le terminal orthogonal existe exactement pour ça | Un dossier à décider sur une personne effacée | fait |
| **6** ⏳ | **Réparer les 12** — décision du donneur d'ordre, cf. §6. Le correctif 1 met les deux boutons à l'écran : c'est désormais un clic par dossier | L'état présent de la base dev | à faire |

⚠️ **L'ordre compte** : le correctif 1 devait précéder le retrait de l'onglet « Validation
suspendue » (maquette v2) — c'est fait, la refonte peut donc s'appuyer dessus.

### 5.1 Un invariant que la régression a fait apparaître

Le filet serveur crée la ligne de file **avant** que le client ne poste la sienne. Les fixtures
de la suite de régression inventaient leur propre identifiant (`val_treg_<uid>`) : elles
produisaient donc une **SECONDE ligne pour la même candidature**, et un dossier déjà tranché
restait compté « à valider » (`deriveCandidateStage` regarde `isPendingValidation` AVANT
`decidedBy === 'user'`). 14 scénarios tombaient pour cette seule raison.

Les fixtures sont alignées sur l'identifiant canonique (`validationIdFor`). Ce n'est pas un
contournement : S9 pose elle-même la règle — *« sinon ce scénario testerait un cas qui n'existe
plus en production »*. Depuis l'écrivain unique, **aucun chemin du produit ne peut plus créer
deux lignes pour une candidature** ; une fixture qui y parvenait testait un état devenu
impossible.

Une assertion a été corrigée pour la même raison : S18.4 exigeait une campagne **sans aucune**
validation après l'effacement. Or le VOISIN en a une, légitimement, et la purge ne doit
surtout pas y toucher. L'assertion confondait « les satellites du sujet sont partis » avec
« personne d'autre n'attend » — elle vérifie désormais les deux séparément, donc aussi le
non-débordement.

**Ce que la correction a changé au passage**, et qui n'était pas dans le périmètre initial :
l'identifiant de validation du chemin chat était **ALÉATOIRE** (`nowTaskId('val')`), donc deux
dispatches du même lot créaient **deux lignes pour un seul candidat** ; et son enqueue rendait
`true` **inconditionnellement**, si bien qu'un échec de mise en file passait pour un succès et
que le gate ne différait jamais. Les deux sont corrigés — l'identifiant est désormais
déterministe (`validationIdFor`, contrat testé contre les identifiants déjà en base) et la
persistance réelle remonte au gate.

---

## 6. Les 12 : que fait-on ?

Ce sont des dossiers de **dev** (BAHATI KATAKA et Imad BELFAQIR, deux adresses de test réelles),
sur des campagnes de recette. Trois options :

| Option | Ce que ça fait | Pour |
|---|---|---|
| **A — Classer sans suite** *(recommandée)* | `dismissed_at` + raison `campagne_cloturee` ou `sans_reponse`. **Aucun mail** (le mail d'information est optionnel et se décoche). Ils sortent de la puce, la partition reste juste | Ce sont des dossiers de recette d'août, sur des campagnes qui ne recrutent plus. Les décider n'a aucun sens métier |
| B — Remettre en file | Recréer la ligne `pending_validations` à partir de l'analyse. Aucun envoi n'est déclenché par une mise en file | Si l'on veut vérifier le parcours de décision sur des cas réels |
| C — Ne rien faire | Les 12 restent visibles et indécidables | **Non** : la maquette v2 les met en première page |

> **Ma recommandation : A pour les 12 de dev**, et le correctif **1** pour que le cas ne se
> reproduise plus en silence. La question « remettre en file ou classer » se reposera pour de vrai
> le jour où cela arrive en production — et c'est le correctif **1** qui la posera, à l'écran, au
> bon moment.

---

## 7. Ce qui reste ouvert

- **Pourquoi `pending_validations` et `interview_briefs` ont-elles été vidées ?** Aucune trace
  dans le dépôt. Si c'est une opération manuelle assumée sur la base de dev, il n'y a rien à
  corriger — mais il faut le savoir, car **le même geste en production détruirait la file HITL
  sans laisser d'autre trace que ces fantômes.**
- **Le chemin ① a-t-il déjà frappé ?** Non mesurable ici : les 14 viennent toutes de l'IMAP
  (`source = email`). Sur la base client, la requête du correctif **2** le dira en une passe.
