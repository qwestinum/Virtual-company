# Session du 28-29/09/2026 — Message au candidat, vivier dans la campagne, clôture et compteurs

Deux chantiers enchaînés, puis un rapport de bugs. Tout est **fusionné sur `main`
en fast-forward** (`15681f4..ac18632`, 12 commits). **Rien n'est poussé** ;
**`demo` est en retard sur `main`**.

| Indicateur (sur `main`, 29/09) | Valeur |
|---|---|
| Typecheck | propre |
| Tests unitaires | **3 278 verts**, 1 ignoré |
| Régression | **250/250** (28 fichiers), application fermée |
| Tests de clic touchés | S43-S50 verts, chaque correctif sondé (défaut rétabli ⇒ rouge) |
| Migration base | **`candidate_feedback`** (chantier A) — à appliquer deux fois, dev puis prod, AVANT déploiement |

---

## 1. Chantier A — `feat/feedback-candidat` (lots 1 à 6)

Spec : `docs/specs/feedback-candidat.md` ; inventaire des lecteurs d'étape :
`docs/specs/feedback-candidat-inventaire-etapes.md`.

- **Informer le candidat, l'un de deux gestes, OBLIGATOIRE** à chaque décision qui
  clôt (verdict, absent classé non retenu, sans suite individuel, retenus non
  sélectionnés à la clôture) : « Envoyer ce message » (gabarit des Réglages,
  signé du recruteur, `Reply-To` = lui, mention RGPD par le code) ou « Je préviens
  moi-même » (canal tracé). Règle serveur, contrôle avant écriture, un message par
  (candidature, type) sous verrou deux-phases, le commentaire du recruteur n'a
  aucun chemin vers le message, une correction n'envoie rien.
- **« Recruté »** désigné à la clôture (marqueur `candidate_hired_marked`), retenus
  non sélectionnés = verdict `rejected` + cause `not_selected_at_closure`,
  `campaign_closed` à un seul écrivain (la route de clôture), signal
  `closure_incomplete`.
- **Dix étapes**, libellé court + définition au survol, « Refusé » banni.
- Commits `19bf800` → `75340b1`.

## 2. Chantier B — `fix/vivier-replanif-filtres`

### Point 2 — absence → reproposer un créneau (`be71bc8`)
Le dossier redescend en « Invité » tout de suite : RDV manqué décommandé sans
notifier, liens révoqués, briefing en attente, un message avec un lien neuf ; une
deuxième absence ne rouvre pas (409 + signal `repeated_no_show`).
`docs/specs/scheduling-module.md` §12 ter ; S47.

### Point 3 — filtres de campagne (`d38d31c`, `d131919`)
Périmètre (référent) et état de campagne cumulés, mémorisés par recruteur,
partagés entre écrans, libellé de résultat. **Correction du 28/09** : les puces
colorées de Campagnes, que j'avais remplacées par une liste, sont RÉTABLIES et
pilotent le même état ; le libellé suit l'état AFFICHÉ. S48.

### Point 1 — le vivier dans la campagne (`b624531`)
`docs/specs/vivier.md` §16.
- Ouvrir « Chercher dans le vivier » LANCE la recherche (`onOpen` : jamais de
  contact automatique à la consultation).
- Profils proposés **et** résultats par mot-clé portent les MÊMES gestes
  (`VivierActions` : CV, Écarter, Inviter) et se DÉPLIENT (pourquoi, synthèse,
  historique, voir le CV — `GET /api/vivier/[id]/profile`).
- « Inviter » = une candidature À PART ENTIÈRE (option A : une analyse sur la
  grille au clic), aucune fiche de validation, un mail au plus, gabarit PROPRE
  (« Une opportunité : [poste] », `[origine]`), origine lisible partout (fiche,
  frise, briefing, rapport, purge RGPD).
- Un profil ajouté à la main n'est jamais purgé par une recherche.
- S27 (régression), S49 (clic).

## 3. Rapport de bugs — campagne 221 (`ac18632`)

Diagnostic d'abord (point d'arrêt), puis correction. **Pas de cause commune** :

| Bug | Cause | Correctif |
|---|---|---|
| 1 — « Poste pourvu » après un verdict « retenu » | déclencheur d'écran hérité du chantier sans-suite | retiré ; le classement des restantes appartient à la clôture |
| 2 — « Retenu 0 » sur une campagne clôturée | la carte montrait l'étape COURANTE (maquette v2 §B.1, option A) | **règle du DO** : compteurs = ENTONNOIR (« passé par l'étape »), taux de conversion recrutés / reçues ; `passedThrough` unique pour carte, filtre `?parcours=` et rapport |
| 3 — un seul recruté possible | contrat singulier de bout en bout | cases à cocher, `hiredAnalysisIds[]`, l'ancien format reste lu |
| 4 — « 2 entretiens passés sans confirmation » après décision | la carte lisait le statut du briefing (« programmé » à vie) | `awaitsPointing(stage)`, règle partagée avec l'alerte d'Aujourd'hui |

Vérifié sur la 221 (base de dev) : Reçues 2 · À valider 1 · Invité 2 · Entretien
fait 2 · Retenu 2 · Recruté 1, conversion 50 %, plus rien à pointer. S44 (compteur
= liste ouverte), S45.4 (deux recrutés), S50 (parcours complet), S26.7.

---

## 4. Ce qui a coûté des allers-retours (à retenir)

Le donneur d'ordre a dû corriger **quatre fois** la livraison vivier : puces
supprimées sans le dire, recherche sans gestes sur ses résultats, objet ET corps
du mail d'invitation inadaptés, ligne sans synthèse, « Écarter » oublié sur les
résultats. Leçon consignée (mémoire `feedback_rigor_all_surfaces`) : ne rien
retirer sans le dire ; lire le TEXTE réellement envoyé ; mêmes gestes partout où
l'objet apparaît ; se demander quel est le geste suivant de l'utilisateur.

Pièges techniques rencontrés :
- un message de confirmation rendu DANS une liste disparaît avec elle quand son
  dernier élément est traité — le rendre dans le parent ;
- une recherche relancée à l'ouverture purge ce qu'un calcul ne retrouve pas :
  protéger ce qu'un humain a ajouté (`match_kind='keyword'`) ;
- `pkill -f "next dev"` tue le shell qui le lance (le motif figure dans sa propre
  ligne de commande) : utiliser `pkill -f "[n]ext dev"`. Une régression lancée
  « serveur arrêté » tournait en fait serveur ouvert.

## 5. Ouvert

- Libellé « À valider » sur une campagne clôturée (compte un passage, se lit
  comme un reste à faire).
- « Activez la campagne d'abord : un brouillon ne reçoit rien » affiché sur une
  campagne clôturée.
- « N recrutement(s) finalisé(s) » du rapport compte encore les retenus.
- Backlog (`docs/BACKLOG.md`) : CV à jour renvoyé après une invitation vivier,
  chaînage `rescheduled_from` après absence, invitation vivier en masse, clôture
  en transaction unique.
- `CAMP-2026-034` : clôturée le 28/09 à 11 h 39 sans issue ni recruté au journal
  (probablement avant la nouvelle route de clôture) — à vérifier.
- `scripts/_diag-transcript*.ts` : non suivis, à trancher.
