# Brief — prochaine session (réécrit le 21/09/2026)

Le chantier **REFONTE DES INTERFACES** est **terminé côté code**, sur la branche
`feat/ux-refonte` (**38 commits en avance sur `main`**, jamais poussés). Il reste **la
recette de bout en bout par le donneur d'ordre** sur le jeu de démonstration, puis le
merge.

Source de vérité de la refonte : **`docs/ux/maquette-structure-v2-2026-09-20.md`**
(la v1 est supersédée ; l'audit de l'existant est dans `docs/ux/audit-ux-2026-09-20.md`).
Le lexique est publié en référence : **`docs/ux/lexique.md`**.

---

## 0. ÉTAT AU 21/09/2026

| Indicateur | Valeur |
|---|---|
| Branche | `feat/ux-refonte`, 38 commits devant `main` |
| Typecheck | propre (`npm run typecheck`) |
| Tests unitaires | **2 954 verts**, 1 ignoré |
| Tests de clic (E2E) | **38 verts** — S29 à S35 |
| Régression (S1–S25) | **à relancer avant le merge** (application fermée) |
| Migration base | **aucune** dans ce chantier |

> ⚠️ **Les deux suites ne se lancent jamais ensemble.** `npm run test:regression` exige
> l'application **fermée** ; `npm run test:e2e` exige `npm run dev` **ouvert**. La
> régression mesure des compteurs globaux qu'un serveur vivant décale.

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

### 2.1 Bloquant avant le merge

1. **Recette du donneur d'ordre**, de bout en bout, sur le jeu de démonstration.
2. **`npm run test:regression`** (application fermée) — vert exigé.
3. Décider du sort de la vue **« Activité »** de *Pilotage* : elle est **masquée**
   (elle hébergeait le vieux Bureau — cartes d'agents, lignes de flux). La rouvrir est une
   ligne (`TABS` dans `ReportingHub`). Tant qu'elle est masquée, l'ancien écran d'agents
   n'a plus de porte.

### 2.2 Ouvert, non bloquant

- **L'assistant de création n'occupe pas la largeur du gabarit** : sa carte fait ~980 px
  dans un conteneur de 1400 et se cale à gauche. Ce n'est pas une rupture de cadre (le
  conteneur est le bon), c'est un choix de composition à trancher.
- **Dette de lint préexistante** hors périmètre : `ValidationCard`, `VivierList`,
  `VivierPreselectionPanel`, `ManagerChat`, `SettingsHub`, `CampaignCard` (8 erreurs
  `react-hooks`). Aucune n'a été introduite par la refonte ; aucune n'est corrigée par
  elle.
- **Coût d'hydratation du workspace** : `/api/campaigns` + `/api/artifacts` (~341 Ko) sont
  chargés sur CHAQUE écran, y compris ceux qui n'en ont pas besoin. Mesuré, non traité.
- **`PERF_TRACE=1`** : le comptage des requêtes Supabase par écran n'a pas été relevé (il
  demande un redémarrage du serveur de dev).
- **Mesure depuis le déploiement de dev (`cdg1`)** : pas d'accès, non faite.

---

## 3. Ordre de mise en production

1. `npm run typecheck` — propre.
2. `npm test` — 2 954 verts.
3. **Fermer l'application**, `npm run test:regression` — vert.
4. **Rouvrir** `npm run dev`, `npm run test:e2e` — 38 verts.
5. Recette manuelle du donneur d'ordre sur le jeu de démonstration.
6. `git merge --ff-only feat/ux-refonte` sur `main`, puis **le donneur d'ordre pousse**
   (`! git push origin main` — le push est gaté pour l'assistant).
7. **Aucune migration à appliquer.** Aucune variable d'environnement nouvelle.
8. Après déploiement : vérifier que le 2ᵉ segment de `x-vercel-id` est bien **`cdg1`**.

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
