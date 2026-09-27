# Brief — prochaine session (réécrit le 27/09/2026)

La **REFONTE DES INTERFACES** est **mergée sur `main`**, et **`main` = `demo`** (même
commit, rien de propre à l'une ou l'autre). Rien n'est poussé : **le donneur d'ordre
pousse** après sa recette sur dev (`! git push origin main` puis `! git push origin
demo` — le push est gaté pour l'assistant).

Source de vérité de la refonte : **`docs/ux/maquette-structure-v2-2026-09-20.md`**
(la v1 est supersédée ; l'audit de l'existant est dans `docs/ux/audit-ux-2026-09-20.md`).
Le lexique est publié en référence : **`docs/ux/lexique.md`**.

---

## 0. ÉTAT AU 27/09/2026

Ce qui est entré dans `main`, dans l'ordre : `fix/validations-orphelines` →
`fix/ux-mensonges` → `feat/ux-refonte` → la garde `CRON_ENABLED` de la maintenance du
vivier → `demo` (egress, Vercel Cron, sourcing, S34) → **deux correctifs trouvés PAR
la vérification du merge** :

- **`fix/hitl-decision-preservee`** — une remise en file ne décide jamais. Elle
  réécrivait la décision d'une fiche encore `pending` : un « accepter » posé juste avant
  la réservation repassait « refuser », l'invitation partait pendant que la
  finalisation enregistrait un refus et révoquait le lien. Mise à jour partielle dans la
  requête, réservation conditionnée à la décision affichée, seconde ceinture à l'envoi,
  garde structurelle. **Audit prod (lecture seule) : 155 envois, aucun écart.**
  Cf. `docs/specs/hitl-3-zones.md` §6bis.8.
- **`fix/sched-repair-grace`** — la réparation du drain de réservation ne touche plus
  une confirmation en cours (délai de grâce de 2 min). Cf.
  `docs/specs/scheduling-module.md`, étape 5.

| Indicateur | Valeur |
|---|---|
| Typecheck | propre (`npm run typecheck`) |
| Lint | **0 erreur**, 18 avertissements |
| Tests unitaires | **3 089 verts**, 1 ignoré |
| Régression | **234/234** (25 fichiers), application fermée |
| Tests de clic (E2E) | **66/66** (15 fichiers), application ouverte |
| Conflits au merge | **aucun** |
| Migration base | **aucune** |

> ⚠️ **Les deux suites ne se lancent jamais ensemble.** `npm run test:regression` exige
> l'application **fermée** ; `npm run test:e2e` exige `npm run dev` **ouvert**.
>
> ⚠️ **Un test rouge une fois sur trois est un défaut, pas un test fragile** — les deux
> derniers intermittents (S4, S13.3) étaient deux vraies courses. On nomme le test et on
> cherche la cause avant de relancer.

---

## 1. Ce qui est fait

**Cinq entrées adressables** — *Aujourd'hui* (défaut) · *Campagnes* · *Candidatures* ·
*Entretiens* · *Pilotage*. Chacune a son URL : favori, partage, bouton Précédent. Les
anciennes adresses redirigent. C'était le blocage n°1 de l'audit : le produit n'avait
**aucune URL**, huit onglets dans un `useState`.

| Lot | Ce qu'il a livré |
|---|---|
| 1 | Les cinq entrées, le lexique, aucune ancienne adresse perdue |
| 2 | *Aujourd'hui* : quatre sections, un verbe chacune, aucune carte vide |
| 3 | La carte campagne devient un hub (compteurs-filtres, portes) |
| 4 | Les portes de la carte s'ouvrent **et un test les CLIQUE** (S29) |
| 5 | La création devient un **assistant en six étapes** (S30) |
| — | Champ de saisie partagé (S31), **gabarit de page unique** (S32), détail de candidature à côté et non par-dessus (S33) |
| — | **Rythme vertical unique** + fond uni sand (S34) |
| — | **Deux composants d'interface, et pas un troisième** (`DotTabs`, `CounterRibbon`) |
| — | **Filtre « Référent » partout**, un seul état partagé (S35) |
| 6 | Cartographie du Manager alignée + gardée, docs client, lexique publié, captures du kit |

**Règle de chantier adoptée** (CLAUDE.md, §Règles absolues) : *une action d'interface
n'est livrée que si un test l'a CLIQUÉE.* Les tests de logique lisent une valeur ; ils ne
voient pas ce que le navigateur en fait. Deux livraisons avaient annoncé des portes
branchées qui ne l'étaient pas — d'où `npm run test:e2e`.

---

## 2. Ce qui attend

### 2.1 Avant de pousser

1. **Recette du donneur d'ordre** sur dev (commencée le 22-23/09, retours traités —
   § « Recette du donneur d'ordre » de la maquette v2).
2. **Variables d'environnement, par instance** (`docs/ops/env-reference.md`) :
   - `CRON_SECRET` — toutes les instances (facultatif en dev) ;
   - `CRON_ENABLED=1` — client et démo, **la prod en dernier** ; **jamais en dev**. Le
     cron Vercel remplace cron-job.org : désactiver le job cron-job.org de l'instance
     AU MÊME MOMENT, sinon deux relèves (double brief) ;
   - `CV_ANALYZER_LEDGER_MODEL` — posé en dev, sur les clients après recette ;
   - `OPENAI_CHAT_MODEL=gpt-4o` — toutes ;
   - `SOURCING_*` — là où le sourcing sert ; `DEMO_JOBBOARD_ENABLED` — démo seulement ;
     `ADEP_ENABLED` — si APEC ; `NEXT_PUBLIC_APP_URL` — toutes.
3. Après déploiement : 2ᵉ segment de `x-vercel-id` = **`cdg1`**.

### 2.2 Ouvert, non bloquant

- **L'assistant de création n'occupe pas la largeur du gabarit** (~980 px dans 1400,
  calé à gauche) — choix de composition à trancher.
- **Coût d'hydratation du workspace** : `/api/campaigns` + `/api/artifacts` (~341 Ko)
  chargés sur CHAQUE écran. Mesuré, non traité.
- **`PERF_TRACE=1`** : comptage des requêtes Supabase par écran non relevé.
- **Base de la démo** : l'audit « décision envoyée ≠ décision humaine » n'y a pas été
  rejoué (prod seulement).
- `scripts/_diag-transcript*.ts` : fichiers non suivis, à trancher (commiter ou
  supprimer).

---

## 3. Ordre de mise en production

1. Recette du donneur d'ordre sur dev.
2. `! git push origin main` et `! git push origin demo` (le donneur d'ordre).
3. Variables par instance (§2.1), cron-job.org coupé au moment où `CRON_ENABLED` est posé.
4. **Aucune migration à appliquer.**
5. Vérifier `cdg1` sur chaque instance.

---

## 4. Où regarder

| Sujet | Fichier |
|---|---|
| Maquette de référence | `docs/ux/maquette-structure-v2-2026-09-20.md` |
| Règle de composition (deux composants) | idem, §I |
| Audit de l'existant | `docs/ux/audit-ux-2026-09-20.md` |
| Lexique | `docs/ux/lexique.md` |
| Fiche technique (DSI / DPO) | `docs/ops/fiche-technique.md` |
| Configuration d'un client | `docs/ops/configuration-client.md` |
| Captures du kit commercial | `docs/captures/` |
| Compte rendu de la session précédente | `docs/sessions/SESSION_2026-09-20_UX_COHERENCE.md` |

---

## 5. Les pièges de ce chantier, pour qui reprend

- **Un `useState(initial)` ne s'exécute qu'AU MONTAGE.** Une navigation client vers la
  page déjà affichée ne remonte rien : une porte qui décide son état dans un initialiseur
  ne s'ouvrira jamais. C'est la cause exacte des deux portes annoncées et non branchées.
- **Une garde structurelle dit « ceci ne doit PAS exister ».** Elle ne dit jamais « ceci
  marche ». Deux livraisons l'ont confondu.
- **Une garde qui mesure la conséquence au lieu de la cause reste verte sur le défaut.**
  Vu deux fois ici : « les cartes ont la même hauteur » (la grille les égalise, donc le
  sous-texte fautif passait) et « le compte d'alerte a telle forme » (la forme a changé
  trois fois, la source jamais). Garder la **source**, compter les **rangs**.
- **`border: 1px solid var(--jeton-inexistant)`** fait tomber TOUTE la déclaration : plus
  de bordure, en silence.
- **Une liste paginée côté serveur ne se filtre pas côté client** — les compteurs
  mentiraient. On restreint le périmètre de la requête.
- **Une intersection vide n'est pas « toutes »** : un paramètre absent vaut « aucune
  restriction » côté serveur.
