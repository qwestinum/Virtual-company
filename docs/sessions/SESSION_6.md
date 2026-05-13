# Session 6 — Dashboard de métriques

> **Statut** : en cours
> **Pré-requis** : Sessions 1 à 5 complétées (chat manager, CV Analyzer, scoring, sélecteur de campagne, persistance Supabase + journal d'audit, IMAP).
> **Spec de référence** : `docs/specs/entreprise-virtuelle-rh.md` — §6.3 (actions directes UI) et §8 (métriques + dashboard).

## Objectif

Donner au donneur d'ordre une vue agrégée et vivante de l'activité du département RH : KPIs globaux, liste des campagnes avec stats live, candidats reçus, flux d'activité et performance des agents. L'onglet « Dashboard » du `WorkspacePane` cesse d'être un placeholder ; il devient le second écran fonctionnel du MVP, à côté du département RH.

À la fin de la session, on doit pouvoir tenir une démo en alternant entre l'onglet Département RH (chat + agents) et l'onglet Dashboard (métriques + édition campagne), avec des chiffres réels dérivés du journal Supabase.

---

## Périmètre IN — à implémenter

### 1. Tokens & fonts

- Variables CSS `--dash-*` ajoutées sous `:root` de `globals.css` (8 paires de couleurs accent + light, surfaces chaudes, textes).
- Weights Plus Jakarta (jusqu'à 800) et Nunito (jusqu'à 800) ajoutés dans `layout.tsx` pour les compteurs et titres.
- Keyframe `dash-fade-in` pour les animations en cascade des cartes candidats et activité.

### 2. Couche backend (agrégation)

- `src/lib/dashboard/derive-metrics.ts` — module pur testable. 5 fonctions :
  - `journalToGlobalKPIs(rows)` — 6 KPIs (CV reçus, shortlistés, entretiens, GO, conversion, coût)
  - `journalToAgentMetrics(rows, agentIds)` — tâches / succès / coût par agent du registry
  - `journalToCampaignMetric(rows, campaignId)` — stats d'une campagne
  - `journalToCandidatesList(rows)` — reconstruction de la liste candidats avec statut dérivé du croisement `imap_cv_analyzed` × `imap_outreach_*`
  - `journalToActivityFeed(rows, limit)` — mapping action → message métier + icône + couleur
- `src/lib/db/repos/metrics.ts` — wrapping fin du repo journal. Renvoie `null` si Supabase n'est pas configuré (mode offline cohérent).
- API routes :
  - `GET /api/metrics/global` — KPIs + agents + candidats + 20 dernières activités
  - `GET /api/metrics/campaigns/[id]` — stats d'une campagne

### 3. UI dashboard

- `DashboardView` racine — polling `/api/metrics/global` toutes les 5s via `useDashboardData`. Fallback offline silencieux.
- 6 KPI animés avec `AnimatedCounter` (ease-out cubic, 1s).
- `CampaignsList` + `CampaignCard` + `CampaignCardBody` — head clickable, 4 mini-stats live, body avec grille de 5 stats, deux rate boxes (Taux GO, Conversion globale), méta-tags (salaire, date, canaux), zone d'actions inline.
- `CandidatesCard` — filtres tous / shortlistés / entretiens, lignes avec avatar coloré, pill statut, `ScoreRing` SVG animé.
- `ActivityCard` — feed des actions du journal traduites en messages métier.
- `AgentsCard` — totaux + ligne par agent du registry (Manager, CV Analyzer, Mail Composer, Job Writer, Publisher, Scheduler) avec progress bar largeur ∝ tâches.

### 4. Sheet d'édition campagne

- `CampaignEditSheet` — slide-in latéral (560px max), overlay sombre, fermeture clavier (Escape) ou clic overlay.
- `CampaignEditAccordion` — 5 blocs dépliables :
  - **Fiche de poste** — affichage lecture seule + bouton « Reprendre l'édition dans le chat » qui ferme le sheet et seed un message utilisateur.
  - **Fiche de scoring** — édition inline (label / niveau / poids), ajout/suppression de critères, bouton « Revalider la grille ».
  - **Canaux de diffusion** — toggles par canal (`PUBLICATION_CHANNEL_ORDER`).
  - **Seuil d'acceptation** — slider 0..100 avec preview live de la valeur.
  - **Cycle de vie** — boutons Suspendre / Reprendre / Activer / Clôturer selon le statut courant. La clôture demande une confirmation native.

### 5. Prise d'acte du Manager (spec §6.3)

`src/lib/chat/manager-acknowledgments.ts` — helper unique appelé par tous les call sites. Pour chaque action UI :
- pousse un message Manager dans `chat-store` avec une phrase métier (pas de jargon technique),
- POST best-effort sur `/api/journal` pour tracer l'audit.

Actions couvertes : `campaign_paused / resumed / closed / activated`, `threshold_changed`, `scoring_updated`, `channel_toggled`.

### 6. Persistance du seuil

- Colonne `campaigns.threshold int default 75 check(0..100)` ajoutée via `scripts/migrate.sql` (ALTER idempotent).
- Champ propagé dans `CampaignRow`, `ActiveCampaign`, repo `campaigns`, `/api/campaigns` (PUT + PATCH).
- Action store `setThreshold(id, value)` (clamp 0..100, no-op si valeur identique).

### 7. Tests vitest

- `derive-metrics.test.ts` — 16 cas (KPIs vides / mixtes, conversion sans CV, attribution par agent, croisement uid candidat, filtrage actions techniques).
- `metrics-repo.test.ts` — null sur Supabase absent, propagation des erreurs non-503, agrégation happy path.
- `manager-acknowledgments.test.ts` — phrases attendues, appel `/api/journal` best-effort, robustesse à un échec réseau.
- `campaigns-store.test.ts` — seuil par défaut, clamp, no-op sur valeur identique.

---

## Périmètre OUT — à NE PAS implémenter

- **Recompute rétroactif des candidats au changement de seuil**. Le seuil s'applique aux prochaines candidatures uniquement — le Manager le dit explicitement dans la prise d'acte. Recompute reporté (nécessite une requête par campagne sur les artefacts de scoring, hors scope démo).
- **Supabase Realtime**. On poll à 5s, c'est volontaire — Realtime est planifié pour la Session 7.
- **Instrumentation `durationMs` / `tokensUsed`** côté agents. Les coûts sont des **estimations** par type d'action (table `COST_PER_ACTION` dans `derive-metrics.ts`). `avgDurationMs` reste `null` en Session 6, affiché « ⚡— » côté UI. La vraie instrumentation viendra avec la Session 7.
- **Persistance du chat Manager**. Les prises d'acte restent volatiles, comme le reste du chat (cohérent avec la règle « reset chat sur switch »).
- **Agents fictifs** (NLU Parser, Synthesizer présents dans le HTML de référence). On n'affiche que les agents réels du registry — un agent à 0 tâche est rendu en idle plutôt qu'absent.

---

## Critères de fin

1. **Onglet Dashboard fonctionnel.** Plus de placeholder « Bientôt » ; la vue se charge sans erreur même sans Supabase (mode offline cohérent).
2. **6 KPIs réels.** Quand au moins un CV passe par le poller IMAP, les compteurs se mettent à jour au tour de polling suivant.
3. **Liste campagnes dépliable.** Une carte par campagne du store, avec 4 mini-stats live, body dépliable, et boutons d'action qui modifient le statut + pushent un message Manager.
4. **Sheet d'édition complet.** Les 5 blocs sont accessibles ; scoring, canaux et seuil sont réellement éditables avec persistance Supabase pour le seuil et les canaux.
5. **Carte candidats + ScoreRing.** Les candidats reçus par IMAP apparaissent avec leur score, statut dérivé et avatar coloré.
6. **Activity feed métier.** Les 20 dernières entrées du journal sont traduites en messages compréhensibles (pas de `imap_cv_analyzed` brut).
7. **Mode offline.** Sans variables Supabase, le dashboard s'affiche avec les campagnes du store Zustand et un badge « Mode local » dans le header.
8. **Tests verts.** 26 nouveaux tests sur cette session, suite totale à 345 ✓.

---

## Pièges à éviter

- **Ne pas casser le chat à droite.** L'onglet Dashboard partage la moitié gauche avec le chat (~50%). Les grilles utilisent `auto-fit minmax(...)` pour s'adapter à la largeur disponible — éviter les `grid-template-columns: repeat(N, 1fr)` fixes.
- **Ne pas confondre `score` candidat et `threshold` campagne.** Le `score` est 0-100, le `threshold` est 0-100, mais leur sémantique diffère. La conversion couleur (≥75 vert, ≥50 orange, sinon rouge) s'applique au score, pas au seuil. Pour le seuil, on inverse : haut seuil = exigeant = vert.
- **Ne pas instancier le Sheet si la campagne n'existe pas.** `CampaignEditSheet` retourne `null` si `byId[campaignId]` est `undefined` — évite un crash si une campagne disparaît pendant l'édition (reset chat, par exemple).
- **Ne pas considérer le pré-rendu serveur.** Tous les composants dashboard sont `'use client'` — les hooks Zustand et `useDashboardData` exigent un contexte navigateur. La page racine reste serveur, le contenu dashboard est entièrement client.
- **Ne pas modifier le journal sans prise d'acte.** Toute action UI qui écrit dans le journal doit aussi pousser un message Manager (sinon le DRH a une trace serveur sans contexte conversationnel — l'illusion de l'équipe se brise).
