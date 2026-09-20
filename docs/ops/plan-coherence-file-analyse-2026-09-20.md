# Plan — la cohérence entre l'analyse et sa file de validation

**Date** : 20/09/2026 · **Statut** : PLAN, aucun correctif appliqué.
**Entrées** : diagnostic dev `diagnostic-validations-orphelines-2026-09-20.md` (sens A) et
diagnostic prod du jour sur `obkruafjsbynwbayzuvy` (sens B).

---

## 1. Les deux diagnostics décrivent UNE seule cause

`candidate_analyses` et `pending_validations` décrivent le même fait — « ce dossier attend une
décision humaine » — **sans clé étrangère, sans contrainte, sans réconciliation**. Chaque table
est écrite par ses propres chemins. Rien ne vérifie qu'elles racontent la même histoire.

Les deux diagnostics sont les deux moitiés du même trou :

| | Sens A — *dev, 20/09* | Sens B — *prod, aujourd'hui* |
|---|---|---|
| Symptôme | analyse **en attente**, **aucune** ligne de file | ligne de file **ouverte**, analyse **plus en attente** |
| Effet écran | compté « À valider », **indécidable** ; « Validation introuvable (déjà traitée ?) » | carte présentée à l'arbitrage alors que le dossier est **accepté** ailleurs |
| Volume mesuré | 12 (dev) · **0 en prod** | **2 en prod** (sur 50 lignes ouvertes) |
| Corrigé le 20/09 | oui | **non** |

Le compte prod est exact et se referme : `50 − 2 = 48` = le ruban. Ni périmètre, ni période, ni
troncature.

---

## 2. Ce que mon correctif du 20/09 a fait — et ce qu'il n'a pas fait

Il faut le dire net : **la moitié du travail manque, et le diagnostic prod le montre à
l'endroit exact où je l'ai laissé.**

`scripts/rescore-analyses.ts:255-269` — j'ai ajouté **une** branche :

```ts
if (isAwaitingHumanZone(zoneAfter as DecisionZone)) {
  await ensureValidationForAnalysis(r.id, { … });   // la zone ENTRE en attente → poser la file
}
// ← il n'y a pas d'`else`. La zone qui QUITTE l'attente ne ferme rien.
```

Trois conséquences, toutes vérifiées dans le code d'aujourd'hui :

1. **Le prochain `npm run rescore` reproduira exactement ces deux lignes.** Le défaut n'est pas
   seulement historique.
2. **Le signal `validations_orphelines` ne surveille qu'un sens** : il part des analyses en
   attente et cherche la file manquante (`computeOrphanValidations`). Une ligne de file ouverte
   dont l'analyse n'attend plus n'est vue par personne.
3. **J'ai centralisé l'écriture, pas la fermeture.** `enqueueValidationRow` est l'écrivain unique
   de la CRÉATION. Il n'existe aucun équivalent pour la CLÔTURE : seul `dismissal.ts` ferme une
   ligne (`voidPendingValidation`). C'est cette asymétrie qui fabrique le sens B — et qui en
   fabriquera un troisième.

**Angle mort supplémentaire trouvé en vérifiant** : `decision-correction.ts` pose
`updateCandidateAnalysisDecision` (donc `decided_by='user'`) **sans jamais fermer la ligne de
file**. Corriger un dossier `invite` qui traîne une ligne ouverte le laisse dans le hub. Pas
d'occurrence en prod aujourd'hui, mais le chemin est ouvert.

---

## 3. Le danger immédiat, à contenir avant tout le reste

Les 2 cartes prod portent `decision: 'reject'` avec un score de **100** et **90**, et tombent
dans **« À examiner »** — la partition lit `decision_zone`, et `auto_accept` n'est pas
`proposed_reject` (`isRejectionProposal`, `rejection-proposal.ts:43`).

> **Cliquer « Refuser » sur ces cartes enverrait un refus à quelqu'un que tout le reste du
> produit compte comme accepté.** Rien à l'écran ne l'en empêche ni ne l'en avertit.

Et l'écran ment dans l'autre sens aussi : `deriveCandidateStage` traite `status === 'accepted'`
(étape 5) **avant** `isPendingValidation` (étape 6). Les deux dossiers sont donc affichés
« **Invité** » alors qu'**aucune invitation n'est jamais partie** — le re-scoring n'envoie rien,
par construction. Kevin NGUYEN cumule même les deux régimes : un refus automatique réellement
parti le 13/07 (incident multi-pièces jointes, pré-30/07), un statut « Invité » depuis le 21/08,
et une proposition de refus encore ouverte.

---

## 4. Taxonomie complète — pour cesser de corriger par direction

| # | Divergence | Produite par | État |
|---|---|---|---|
| **A** | analyse en attente, pas de file | chat fire-and-forget · re-scoring entrant · purge RGPD | **fermé le 20/09** (3 chemins + signal) |
| **B** | file ouverte, analyse plus en attente | **re-scoring sortant** · correction de décision | **OUVERT** — 2 cas en prod |
| **C** | file ouverte, analyse classée sans suite | une clôture hors `dismissal.ts` | fermé par construction *(un seul chemin ferme)* |
| **D** | deux files pour une analyse | un appelant qui invente son id | fermé par l'id déterministe, **mais `POST /api/validations` accepte toujours un id libre** |

Tant que la cohérence est traitée « une direction à la fois », il y aura un **E**.

---

## 5. Le plan, en quatre lots

### Lot 0 — Contenir, maintenant *(prod, XS)* — ✅ **LIVRÉ le 20/09/2026**

Ne pas laisser un refus partir sur un dossier accepté.

1. **Désarmer la carte, pas la masquer.** Le hub CONNAÎT déjà la zone
   (`zoneByValidation`, servi par `GET /api/validations`) : quand la zone de l'analyse n'est plus
   une zone d'attente, la carte n'offre plus « Accepter / Refuser ». Elle dit ce qui s'est passé
   — « ce dossier a été ré-évalué le 21/08 et n'attend plus de décision » — et propose **une
   seule** action : *Clore cette fiche*.
2. **Les 2 lignes de prod** : clore après vérification nominative. Aucun mail. (Le mail de refus
   de Kevin NGUYEN est parti en juillet et ne se dé-envoie pas — c'est un fait à consigner, pas
   à réparer ici.)

⚠️ **Masquer les cartes serait pire.** Deux dossiers disparaîtraient du hub sans que personne ne
sache pourquoi le compteur a bougé. On désarme et on explique.

**Ce qui a été livré** (branche `fix/validations-orphelines`) :

| Pièce | Rôle |
|---|---|
| `src/lib/hitl/queue-coherence.ts` | Prédicat PUR et unique — `awaiting` · `settled{reason}` · `unknown`. **Ne conclut jamais sur un doute** : analyse introuvable ou zone absente ⇒ `unknown`, la carte garde son arbitrage. 10 tests. |
| `GET /api/validations` | Sert `coherenceByValidation` à côté de `zoneByValidation` — jugé SERVEUR, jamais recalculé à l'écran. Coût nul : la route lisait déjà les analyses. |
| `SettledValidationCard` | La carte désarmée : plus d'« Accepter / Refuser », la phrase qui dit pourquoi, et **un** geste — *Clore cette fiche*. |
| `POST /api/validations/[id]/settle` | Clôture `pending → void`. **Re-juge la cohérence côté serveur** (409 `still_awaiting` sinon) et **refuse un `sending`** (409 `send_in_flight` — jamais clore sous incertitude). Journal `validation_settled`. |
| `RejectionProposalsTab` | Une fiche désarmée **n'est pas sélectionnable** : ni case à cocher, ni « Tout sélectionner », ni fournée. |

Couverture : les **quatre** motifs de clôture, pas seulement celui de production —
analyse acceptée · décision humaine prise ailleurs (l'angle mort de
`decision-correction.ts`) · candidature classée sans suite · zone `auto_reject` legacy.

Vérifié en dev sur un cas fabriqué à l'identique du cas prod (analyse `auto_accept`, fiche
ouverte en direction `reject`) : carte désarmée à l'écran, clôture → ligne `void`, journal écrit,
**aucun mail**. Typecheck propre, 2 700 tests unitaires, régression S1→S25 **232/232**.

**Les 2 lignes de production — closes le 20/09/2026 à 19:14 UTC.**

Opération bornée, en deux temps (constat puis exécution), sur `obkruafjsbynwbayzuvy` confirmé par
saisie explicite du ref — jamais une base par défaut. Le prédicat appliqué est la réplique exacte
de `checkValidationCoherence`, et le balayage a porté sur **les 50 lignes ouvertes**, pas sur les
2 identifiants du diagnostic : chercher seulement ce qu'on s'attend à trouver n'aurait rien
démontré.

| Constat | Après |
|---|---|
| 50 ouvertes, dont **2** dont le dossier n'attend plus | `pending` **50 → 48** · `void` **0 → 2** |
| Kevin NGUYEN · CAMP-2026-045 · fiche `reject`/100 · analyse `auto_accept`/`accepted` | fiche `void`, **analyse intacte** |
| Asma Zghonda · CAMP-2026-288 · fiche `reject`/90 · analyse `auto_accept`/`accepted` | fiche `void`, **analyse intacte** |

**L'équation se referme** : 48 lignes ouvertes = les 48 du ruban « À valider ».

Contrôles : `status`, `decision_zone`, `decided_by`, `dismissed_at` et le score des deux analyses
**inchangés** — la clôture est orthogonale à l'évaluation, comme le classement sans suite. Deux
entrées `validation_settled` au journal (campagne, candidat, motif). **Zéro envoi** dans les
quinze minutes autour de l'opération, vérifié sur `imap_outreach_mail` et `hitl_validation_sent`.

Le script d'exécution est resté hors du dépôt (scratchpad de session) : c'est une réparation
ponctuelle, et le geste durable est désormais à l'écran.

⚠️ **Ces deux fiches reviendront au prochain `npm run rescore`** tant que le lot 1 n'est pas
livré. La clôture répare l'état, pas la cause.

### Lot 1 — Fermer l'asymétrie du re-scoring *(S)*

La branche symétrique que je n'ai pas écrite :

```ts
if (isAwaitingHumanZone(zoneAfter)) ensureValidationForAnalysis(…)   // existe
else                                settleValidationForAnalysis(…)   // à écrire
```

`settleValidationForAnalysis` ferme la ligne **conditionnellement** (`status='pending'` seulement
— jamais un `sending`, jamais un `sent`), et **le dit** dans la sortie du script comme la branche
entrante le fait déjà (`· file posée` / `· file close` / `· ⚠ FILE NON CLOSE`).

**Statut de clôture** : réutiliser `void`, dont la définition colle déjà — *« TERMINAL : fermée,
jamais tranchée, jamais envoyée »*. Seule la CAUSE diffère, et sa place est le journal
(`validation_settled`, avec la zone avant/après). L'alternative — un statut `superseded` — coûte
une migration et un CHECK pour une nuance que le journal porte mieux. **À trancher.**

### Lot 2 — Un écrivain unique pour la CLÔTURE, comme pour la création *(M)*

C'est le lot qui empêche le **E**. `src/lib/hitl/settle.ts`, appelé par **tout** chemin qui fait
sortir une analyse de l'attente :

| Chemin | Aujourd'hui | Après |
|---|---|---|
| Décision humaine (`decideGrayValidation`) | ferme (status `sent`) | inchangé |
| Classement sans suite (`dismissal.ts`) | ferme (`void`) | passe par l'écrivain |
| **Re-scoring sortant** | **ne ferme rien** | ferme |
| **Correction de décision** | **ne ferme rien** | ferme |

Et **`POST /api/validations` cesse d'accepter un id libre** : il dérive l'identifiant canonique
de `payload.analysisId`. C'est le dernier chemin par lequel un doublon reste possible (D).

### Lot 3 — Un invariant BIDIRECTIONNEL, une seule fois *(S)*

Remplacer `validations_orphelines` (un sens) par **un prédicat unique et testé** —
`src/lib/hitl/queue-coherence.ts`, pur : *« l'analyse attend-elle ⟺ une ligne ouverte existe-t-elle ? »* —
et **un** signal métier qui compte **les deux écarts** :

> « N dossiers ne sont pas cohérents entre la file et leur analyse : M attendent sans fiche,
> P ont une fiche qui n'a plus lieu d'être. »

Plus un **test de non-divergence** : pour chaque chemin qui écrit `decision_zone`, `decided_by`
ou `dismissed_at`, la suite vérifie qu'il passe par l'écrivain de création OU celui de clôture.
Sans lui, le lot 2 se défait au premier chemin ajouté.

---

## 6. Ordre, et pourquoi

**Lot 0 → Lot 1 → Lot 3 → Lot 2.**

Le lot 0 retire le risque d'envoi ; le lot 1 empêche le prochain `rescore` de recréer le cas ;
le lot 3 rend visible ce qui reste **avant** la grosse réécriture — on saura ce que le lot 2 a
réellement fermé, au lieu de le supposer. Le lot 2 vient en dernier parce que c'est le seul qui
touche des chemins de décision déjà éprouvés.

⚠️ **Ne pas faire tourner `npm run rescore` avant le lot 1** : il reproduirait le sens B sur tout
dossier qu'il fait sortir de la zone d'attente.

---

## 7. À trancher

| # | Question | Pourquoi ça ne se décide pas seul |
|---|---|---|
| Q1 | **`void` ou un nouveau statut** pour une fiche close par ré-évaluation ? | `void` évite une migration et sa définition colle ; un statut dédié rendrait le motif requêtable sans lire le journal |
| Q2 | **Les 2 dossiers prod** : les clore suffit-il, ou faut-il reprendre le fil (Asma Zghonda est sur une campagne ACTIVE, comptée « Invité », jamais contactée depuis le 21/08) ? | C'est une décision de recrutement, pas de cohérence de données |
| Q3 | **Kevin NGUYEN** : refusé par mail en juillet, affiché « Invité », campagne suspendue. Quelle vérité affiche-t-on ? | Le produit a envoyé un refus ; « Corriger la décision » existe pour ça, mais c'est un arbitrage humain |
| Q4 | **Un `rescore` qui fait SORTIR de l'attente doit-il rester silencieux côté candidat ?** Aujourd'hui oui (garantie n°1). Un dossier passé de 47 à 90 n'a été contacté par personne depuis un mois. | C'est la tension assumée du script — mais personne ne remonte la liste des dossiers qu'il a promus |
