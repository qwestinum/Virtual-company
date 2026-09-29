# Brief — prochaine session (réécrit le 29/09/2026)

**`main` a reçu en fast-forward** `feat/feedback-candidat` puis
`fix/vivier-replanif-filtres` (`15681f4..ac18632`, 12 commits). **Rien n'est
poussé** (le donneur d'ordre pousse : `! git push origin main`). **`demo` est en
retard sur `main`** — à aligner si la démo doit montrer ces chantiers.

Compte rendu détaillé : **`docs/sessions/SESSION_2026-09-28_FEEDBACK_VIVIER_CLOTURE.md`**.
La refonte des interfaces (session du 20-27/09) reste décrite ci-dessous (§1, §5).

---

## 0. ÉTAT AU 29/09/2026

| Indicateur | Valeur |
|---|---|
| Typecheck | propre (`npm run typecheck`) |
| Tests unitaires | **3 278 verts**, 1 ignoré |
| Régression | **250/250** (28 fichiers), application fermée |
| Tests de clic (E2E) | S43-S50 verts ; chaque correctif sondé |
| Migration base | **OUI : `candidate_feedback`** (table + déclencheur, chantier message au candidat) |

Ce qui est entré :
- **Message au candidat après décision** (`docs/specs/feedback-candidat.md`) :
  l'un de deux gestes obligatoire, « Recruté » désigné à la clôture, dix étapes.
- **Absence → reproposer un créneau** : le dossier redescend « Invité »
  (`docs/specs/scheduling-module.md` §12 ter).
- **Filtres de campagne** cumulés et partagés ; puces d'état de Campagnes rétablies.
- **Vivier dans la campagne** : voir le CV, inviter (candidature à part entière,
  gabarit « Une opportunité »), écarter, lignes dépliables (`docs/specs/vivier.md` §16).
- **Rapport de bugs 221** : compteurs de campagne en ENTONNOIR + taux de
  conversion (règle du donneur d'ordre), entretiens à pointer lus sur l'étape,
  plusieurs recrutés à la clôture, plus de « poste pourvu » au verdict.

> ⚠️ **Les deux suites ne se lancent jamais ensemble.** `npm run test:regression` exige
> l'application **fermée** ; `npm run test:e2e` exige `npm run dev` **ouvert**. Pour
> arrêter le serveur : `pkill -f "[n]ext dev"` (sans crochets, la commande se tue
> elle-même et le serveur reste ouvert).
>
> ⚠️ **Un test rouge une fois sur trois est un défaut, pas un test fragile.** S22
> (sourcing, clôture) a été vu intermittent le 28/09, y compris sans les changements
> de la session — non investigué.

### Questions ouvertes au donneur d'ordre
- Libellé « À valider » sur une campagne clôturée (compte un passage).
- « Activez la campagne d'abord : un brouillon ne reçoit rien » sur une campagne
  clôturée (message faux).
- « N recrutement(s) finalisé(s) » du rapport : basculer sur les recrutés ?

---

## 1. Rappel — la refonte des interfaces (20-27/09)

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

### 2.1 Avant de pousser / déployer

1. **Migration** : appliquer `scripts/migrate.sql` **deux fois de suite** en dev,
   puis sur la prod client (table `candidate_feedback`, déclencheur de pose unique).
2. **Recette du donneur d'ordre** sur dev.
3. **Variables d'environnement, par instance** (`docs/ops/env-reference.md`) :
   - `CRON_SECRET` — toutes les instances (facultatif en dev) ;
   - `CRON_ENABLED=1` — client et démo, **la prod en dernier** ; **jamais en dev**. Le
     cron Vercel remplace cron-job.org : désactiver le job cron-job.org de l'instance
     AU MÊME MOMENT, sinon deux relèves (double brief) ;
   - `CV_ANALYZER_LEDGER_MODEL` — posé en dev, sur les clients après recette ;
   - `OPENAI_CHAT_MODEL=gpt-4o` — toutes ;
   - `SOURCING_*` — là où le sourcing sert ; `DEMO_JOBBOARD_ENABLED` — démo seulement ;
     `ADEP_ENABLED` — si APEC ; `NEXT_PUBLIC_APP_URL` — toutes ;
   - `E2E_FEEDBACK_INBOX` — dev seulement (tests qui vérifient l'envoi réel).
4. Après déploiement : 2ᵉ segment de `x-vercel-id` = **`cdg1`**.

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

1. Migration `candidate_feedback` (double application dev, puis prod).
2. Recette du donneur d'ordre sur dev.
3. `! git push origin main` ; aligner `demo` si la démo doit suivre.
4. Variables par instance (§2.1), cron-job.org coupé au moment où `CRON_ENABLED` est posé.
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
| Compte rendu de la dernière session | `docs/sessions/SESSION_2026-09-28_FEEDBACK_VIVIER_CLOTURE.md` |
| Compte rendu de la refonte | `docs/sessions/SESSION_2026-09-20_UX_COHERENCE.md` |
| Message au candidat, Recruté, dix étapes | `docs/specs/feedback-candidat.md` |
| Vivier dans la campagne | `docs/specs/vivier.md` §16 |
| Compteurs de campagne (entonnoir) | `src/lib/reporting/campaign-trajectory.ts` ; maquette v2 §B.1 (renversée) |

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
