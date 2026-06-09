# Passation — Préparation Reporting & travaux annexes (2026-06-09)

> Document de passation pour reprendre dans une nouvelle session. Récapitule
> l'état livré, les actions requises de l'utilisateur, et les prochaines étapes.

Branche : `refactor/campaign-lifecycle`.

---

## 1. Action REQUISE de l'utilisateur (bloquant pour la suite)

1. **Re-jouer la migration Supabase** : `scripts/migrate.sql` contient les
   nouvelles tables (`sites`, `donneurs_ordre`), colonnes
   (`campaigns.site_id`, `campaigns.donneur_ordre_id`) et le seed
   `SITE-DEFAULT`. **Exécuter le fichier dans le SQL editor Supabase** sinon
   l'admin `/settings` affiche « Supabase non configuré » et la persistance des
   liens campagne échoue. Migration idempotente (`create ... if not exists`).
2. **Pousser les commits** : `git push` (le push depuis l'agent est bloqué par
   les permissions). 2 commits non poussés au moment de l'écriture :
   - `a7e4d4f` feat(model): entités donneur d'ordre & site (fondation reporting)
   - `92bdd62` docs(spec): module reporting — campagne / multi-campagnes / audit
3. **Suppressions manuelles** (mes `rm` sont bloqués) : `bench/_validate.mts`
   (temp neutralisé, gitignoré) et `scripts/_probe.mts` si encore présent.

---

## 2. Ce qui a été livré (commits, du plus récent au plus ancien)

| Commit | Résumé |
|---|---|
| `a7e4d4f` | **Phase 1a reporting** — entités donneur d'ordre & site (modèle + admin) |
| `92bdd62` | Spec module Reporting (`docs/specs/reporting.md`) |
| `5fdd48a` | Backlog : anticipation modèle de données reporting |
| `67c6f5f` | `.gitignore` artefacts de bench (CV/sorties), trace `bench/fiche.json` |
| `1b4369c` | Durcissement prompt verdicts contre l'extrapolation de domaine |
| `772a005` | Script `bench-cv-analyzer` reproductible |
| `85828ee` | Adaptateur Anthropic Sonnet 4.6 pour le CV Analyzer |
| `c516312` | Modèle chat par défaut configurable via `OPENAI_CHAT_MODEL` |
| `97fe30c` | Durcissement ancrage anti-extrapolation (prompts analyse, 1ère passe) |

Suite à jour : **typecheck propre · 655 tests verts · lint OK**.

### 2.1 Comparatif modèle CV Analyzer (OpenAI vs Anthropic)
- `OPENAI_CHAT_MODEL` pilote le modèle OpenAI par défaut (vide = gpt-4o-mini).
- `CV_ANALYZER_PROVIDER=openai|anthropic` route `chatCompleteJson` (seul appelant
  = le CV Analyzer). En `anthropic` : Sonnet 4.6 (`claude-sonnet-4-6`), outil
  forcé = équivalent JSON mode, validation Zod + retry identiques.
  **Pas de seed côté Anthropic** (déterminisme non garanti) ; Whisper reste OpenAI.
- Bench : `CV_ANALYZER_PROVIDER=… npm run bench:cv -- <cv…> --runs=N --sheet=bench/fiche.json`.
  `bench/fiche.json` = fiche « Chargé de recrutement » (tracée). CV/sorties gitignorés.
- **Backlog** : `pricing.ts` rend `costEstimate=0` pour gpt-4o (model string daté
  renvoyé par OpenAI absent de la table). À aligner pour comparer le coût.

### 2.2 Durcissement anti-extrapolation (verdicts)
`buildVerdictsSystemPrompt` (`src/lib/agents/cv-extraction-prompts.ts`) : 3 axes
additifs (DISCIPLINE DU DOMAINE, BIAIS CONSERVATEUR → non_verifiable par défaut
sur les 4 verdicts, CITATION ANCRÉE SUR LE DOMAINE) + 3 exemples négatifs
(domaine étranger / durée trop courte / compétence transversale). Validé
comportementalement au bench (CV5). Tests = présence + acheminement (pas d'appel LLM).

### 2.3 Phase 1a reporting — modèle de données + admin
- **Spec de référence** : `docs/specs/reporting.md` (3 sous-onglets : rapport de
  campagne, multi-campagnes, audit). Phasage en §6.
- **Entités** (cf. `CLAUDE.md` § « Modèle de données — donneur d'ordre & site ») :
  - `donneur_ordre` (initiateur de campagne, ≠ utilisateur ORQA), `site`
    (rattachement géo/orga, `SITE-DEFAULT` seedé pour mono-site).
  - Liens **nullable** `campaigns.site_id` / `donneur_ordre_id` (migration douce).
- **Fichiers clés** : `src/types/organisation.ts` ; `src/lib/db/types.ts` ;
  `src/lib/db/repos/{sites,donneurs-ordre,campaigns}.ts` ;
  `src/app/api/{sites,donneurs-ordre}/…` ; `src/components/settings/{Sites,DonneursOrdre}Manager.tsx`
  (inlinés dans `SettingsHub`) ; `src/stores/campaigns-store.ts`.
- Admin légère : CRUD + **archivage soft** (`archived_at`) via `/settings`.

---

## 3. Prochaines étapes (au choix — proposer le plan AVANT de coder)

### Option A — Audit candidat (gate levé)
Premier des 3 types d'audit (cf. `docs/specs/reporting.md` §5.3, priorité
commerciale démo). Le gate « donneur d'ordre + site en place » est **levé** par
la Phase 1a → l'audit peut démarrer (il lit les champs nullable).
Périmètre rappelé : vue d'accueil sous-onglet Audit (3 cartes, 2 en « Bientôt
disponible ») + interface Audit candidat (sélection/filtres, vue détaillée
critère par critère, génération PDF `ORQA-audit-candidat-[nom]-[date].pdf`,
modale d'envoi standardisée, retour). Briques à mutualiser si absentes : modale
d'envoi générique, chips de période, helper PDF par template.

### Option B — Phase 1b (capture Temps 1) — le morceau lourd
Capture **conversationnelle** du donneur d'ordre + site par le Manager au brief
initial (cf. spec §2, phasage Phase 1). Touche la machine d'états de collecte
FDP + prompt `manager.ts` + `ManagerChat` + projections audio/chips/Ajuster
(cf. mémoires). **Non bloquant** pour l'audit. Inclut idéalement un picker
d'affectation donneur/site dans l'édition de campagne (dashboard).

> Recommandation : Audit candidat (A) débloque la valeur démo ; Phase 1b ensuite.

---

## 4. Backlog ouvert pertinent (cf. `docs/BACKLOG.md`)
- Aligner les clés `pricing.ts` avec les model strings datés OpenAI (~10 min,
  rend le bench utile sur le coût).
- Préparation modèle reporting : **Phase 1a faite** ; restent la capture Temps 1
  (1b) et l'admin déjà livrée.
- Autres : convergence machine d'états lifecycle, robustesse parsing PDF (avant
  VPS), E2E Playwright, C7 critères versionnés, ré-activation tâche isolée.
