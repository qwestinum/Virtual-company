# Audit global ORQA — cartographie, vulnérabilités, performance, stratégie

> **Date** : audit du 8 juillet 2026, consolidé le 9 juillet 2026 · **Périmètre** : l'intégralité de `src/` (578 fichiers TS), `scripts/migrate.sql`, config racine.
> **Méthode** : 6 passes d'exploration parallèles (fonctionnel, technique, pertes silencieuses, sécurité, idempotence, performance), constats croisés puis contre-vérifiés dans le code réel. Chaque point est ancré `fichier:ligne`.
> **Règle respectée** : audit en lecture seule — aucun fichier de code modifié, aucun commit, aucune migration. Ce rapport est le seul livrable.

**Lecture rapide** : si vous ne lisez qu'une section, lisez le [Tableau de bord](#tableau-de-bord--suivi-des--et-) ci-dessous, puis la [Synthèse priorisée](#synthèse-priorisée) et la [Stratégie de mise en œuvre](#stratégie-de-mise-en-œuvre-graduelle-et-sécurisée). Les urgences après correction de la RLS (✅ 09/07/2026) : **(1)** le refus automatique envoyé au candidat quand le LLM échoue (C2), **(2)** les caps silencieux à 1000/200 lignes qui rendent la présélection vivier et les rapports **faux dès la fin de l'import des 1600 CV** (C8/C9/C10), **(3)** finir le Lot 0 (signups Supabase, `CRON_SECRET`, bucket privé).

---

## Tableau de bord — suivi des 🔴 et 🟠

> Pilotage de l'avancement. Statuts : **à faire** / **en cours** / **✅ corrigé (date)**. Le détail de chaque item est dans la [Synthèse priorisée](#synthèse-priorisée) (mêmes identifiants) ; les correctifs sont ordonnancés dans la [Stratégie en lots](#stratégie-de-mise-en-œuvre-graduelle-et-sécurisée).

| ID | Sév. | Constat (résumé) | Lot | Statut |
|---|---|---|---|---|
| C1 | 🔴 | RLS absente + anon key publique | 0 | **✅ Corrigé le 09/07/2026** (RLS activée sur toutes les tables) |
| C2 | 🔴 | Panne LLM ⇒ refus auto envoyé au candidat (`llmFailures` sans consommateur) | 2 | **En cours** — correctif codé le 09/07/2026 (verdicts KO ⇒ `AnalysisUnavailableError`, jamais de score fantôme) ; reste : migration `imap_cv_retries` + déploiement prod |
| C3 | 🔴 | Curseur IMAP avance sur échecs transitoires → CV consommés | 2 | **En cours** — correctif codé le 09/07/2026 (rails `minRetryUid` unifiés + backoff durable + abandon signalé) ; reste : migration + déploiement prod |
| C4 | 🔴 | CV sans fiche validée : binaire jamais stocké, pas de rescoring | 2 | À faire |
| C5 | 🔴 | Claim outreach orphelin (pas de TTL) → candidat muet définitif | 2 | **En cours** — correctif codé le 10/07/2026 (claims deux-phases `confirmed_at` + release garanti + reprise TTL 5 min ; `in_flight` → rails minRetryUid) ; reste : migration + déploiement prod |
| C6 | 🔴 | Double décision grise concurrente → deux mails contradictoires possibles | 3 | **En cours** — correctif codé le 10/07/2026 (machine d'états `pending→sending→sent`, décision immuable dès réservation, claim humain dans mail-composer, journal `mailStatus` + `hitl_mail_not_sent`) ; reste : migration + déploiement prod |
| C7 | 🔴 | Sync optimiste tasks + artifacts (pertes silencieuses UI) | 4 | À faire |
| C8 | 🔴 | Vivier aveugle >1000 (listes non paginées + RPC cappées) | 1 | **En cours** — keyset + chunking RPC codés le 14/07/2026 ; reste test à volume dev + prod |
| C9 | 🔴 | Exclusion « déjà postulé » cap 200 → réinvitation de candidats | 1 | **En cours** — `loadExcludedEmails` exhaustif codé le 14/07/2026 ; reste test à volume + prod |
| C10 | 🔴 | Rapports clôturés : cap global 1000 + journal 500 → PDF client faux | 5 | **En cours** — A9/A10/A14 + surface b (KPIs Bureau exhaustifs via `fetchCandidateTotalRows`) codés le 14/07/2026, **validés à volume sur dev** (1000/200/500→exhaustif) ; reste A11/A13/A12 (mineurs) + prod |
| C11 | 🔴 | Trou `none` : mail avec CV skippé sans trace | 2 | **En cours** — correctif codé le 09/07/2026 (trace `imap_no_campaign_match` + stockage `imap_unmatched_cvs` + rejeu API) ; reste : migration + déploiement prod |
| I1 | 🟠 | `send_failed`/agenda absent : jamais re-tenté (+ brief en file quand même) | 2 | À faire |
| I2 | 🟠 | Couche d'audit poller en `.catch(() => {})` | 2 | À faire |
| I3 | 🟠 | Multi-CV même mail : collisions de clés par uid | 6 | À faire |
| I4 | 🟠 | uid brut cross-boîte : décision humaine sur la mauvaise analyse | 7 | À faire |
| I5 | 🟠 | Claim ne couvre que le mail : journal/artefacts/LLM doublés | 6 | À faire |
| I6 | 🟠 | `last_uid_seen` last-writer-wins + commit tout-ou-rien | 2 | À faire |
| I7 | 🟠 | Claim Cal.com orphelin sur kill → brief jamais livré | 2 | **En cours** — correctif codé le 10/07/2026 (deux-phases `confirmed_at`, `in_flight` → 500 = retry Cal.com) ; reste : migration + déploiement prod |
| I8 | 🟠 | `interview_briefs` : doublons `awaiting_booking` possibles | 3 | À faire |
| I9 | 🟠 | Invitation vivier : mail envoyé avant la garde d'état | 3 | À faire |
| I10 | 🟠 | Vivier `indexed` sans embedding : invisible, non réparable | 6 | À faire |
| I11 | 🟠 | Catch avaleurs à impact métier (×4) | 3 | À faire |
| I12 | 🟠 | Settings optimistes sans rollback | 4 | À faire |
| I13 | 🟠 | Signups Supabase à vérifier ; `CRON_SECRET` fail-open ; `/admin` sans rôle | 0/7 | **En cours** (reste du Lot 0 : signups + CRON_SECRET + bucket ; `/admin` → Lot 7) |
| I14 | 🟠 | Prompt injection CV ; URL signée CV 30 j | 7 | À faire |
| I15 | 🟠 | Journal tronqué : METRICS_WINDOW 500, journey-lookup 500 | 5 | À faire |
| I16 | 🟠 | Index manquants (journal action, received_at, trgm email) | 5 | À faire |
| I17 | 🟠 | Backoff 429 absent ; embeddings non batchés ; pas de cache skills ; 200 sends concurrents | 6 (envois masse : 3) | À faire |
| I18 | 🟠 | Cap + sur-fetch : skill embeddings, `listPendingValidations` | 1 | À faire |
| I19 | 🟠 | 3 chemins de comptage parallèles (dashboard ≠ rapports) | 5 | À faire |
| I20 | 🟠 | `listCampaigns select('*')` dans la boucle poller | 6 | À faire |

---

## Volet 1 — Cartographie fonctionnelle

### 1.1 Cadre d'exécution

- **Boot** : `src/instrumentation.ts:19` démarre le scheduler IMAP (runtime Node uniquement).
- **Relève IMAP, deux voies mutuellement exclusives** : dev/VPS = `setInterval` 30 s (`src/lib/imap/scheduler.ts:30`, désactivé sur Vercel à la ligne 41) ; prod Vercel = cron HTTP externe `GET /api/cron/imap-poll` (`route.ts:23`, Bearer `CRON_SECRET`). ⚠️ `vercel.json` est vide `{}` : le planning du cron n'est **pas versionné** (cron-job.org configuré hors repo — cohérent avec la mémoire projet, mais invisible pour un repreneur du code).
- **Auth global** : `src/proxy.ts` (convention Next 16). APIs = **deny-by-default 401** (`proxy.ts:52-57`) sauf `/api/webhooks/calcom` et `/api/cron/imap-poll` auto-authentifiées (`proxy.ts:33`). Pages = **allow-by-default** avec `PROTECTED_PREFIXES = ['/app','/rh','/settings','/validations','/admin']` (`proxy.ts:27`).

### 1.2 Points d'entrée

**~50 routes API** sous `src/app/api/**` (toutes `runtime='nodejs'`), regroupées : campagnes (CRUD + prefill + mailboxes), vivier (list/upload/détail/CV/reindex + présélection/décisions/repêchage/recherche par campagne + validations org), analyse (cv-analyzer, documents/classify, transcribe), Manager (chat, fdp-proposal, scoring, isolated-criteria), agents de production (job-writer, publisher, mail-composer, scheduler), HITL (validations CRUD + send), IMAP (mailboxes CRUD/test/associate, poll-now, status, debug), reporting (campagne/multi/audit × liste/PDF/send + metrics), candidatures (liste paginée + compteurs), admin léger (settings, sites, donneurs-ordre, tasks, artifacts + signed-url, journal, email/status, fdps/search).

**1 webhook** : `POST /api/webhooks/calcom` (`route.ts:35`) — `BOOKING_CREATED` uniquement, signature HMAC vérifiée, idempotence par `booking_uid`.

**Pages** : publiques `/`, `/login`, `/login/reset` ; protégées `/app`, `/rh/recrutement` (cœur : chat Manager + workspace campagnes), `/settings`, `/validations`, `/admin/dashboard` ; **non protégées mais shells clients sans données** `/vivier`, `/validations-vivier`, `/reporting`, `/candidatures-apercu` (ce dernier = aperçu jetable à supprimer, données factices).

### 1.3 Parcours « réception CV par email » (bout en bout)

`pollMailbox → pollMailboxImpl` (`src/lib/imap/poller.ts:107,129`) :

1. Déchiffrement credentials (`:135`), campagnes associées (`:147`), filtre `active` (`:185-188`).
2. Fetch incrémental `last_uid_seen+1:*` (`:213`), plafond 50/poll (`:230`).
3. Rapprochement campagne `resolveCampaignMatch` (`campaign-match.ts:66`) : sujet actif > sujet inactif > corps actif (ambigu si ≥2 → `imap_ambiguous_body_match`) > corps inactif.
4. Détection PJ (`PDF+DOCX`) ; `.doc` → `imap_cv_unsupported_format` (`:362`) ; rien → `imap_email_no_cv` (`:382`).
5. `processEmailAttachment` (`:492`) : garde fiche de scoring validée (`:517-543`) → `extractCVText` (`:549`) → `analyzeCVApplication` (`:556`) → rapport + artefact + `imap_cv_analyzed` → `persistCandidateAnalysis` id `can_imap_{mailbox}_{uid}` (`:651`) → alimentation vivier fire-and-forget (`:662,670`) → CV binaire en artefact (`:689-710`) → outreach (`:718`).
6. **Scoring pur** `scoreCandidat` (`score-candidat.ts:155`) — le LLM produit des verdicts cités, le code calcule le score ; `classifyDecisionZone` (`:117`) → `auto_reject` / `gray` / `auto_accept`.
7. **Gate HITL unique** `gateCandidateOutreach` (`hitl/outreach-gate.ts:54`) : zones auto → envoi ; gris → file `pending_validations` ; enqueue non persistable → `deferred` (`RetryableOutreachError`) qui **rembobine le curseur** — le seul cas de rembobinage (voir Volet 3).
8. Outreach candidat (`imap/outreach.ts:83`) : refus / invitation + lien agenda, protégé cross-instance par `claimOutreach` (`:293`).
9. Accepté contacté → brief en file `queueInterviewBrief` (`interview/queue-brief.ts:26`, statut `awaiting_booking`) ; le webhook Cal.com délivre (`deliver-brief.ts:207`) aux adresses de synthèse (CV en PJ + .ics) et marque `scheduled`.
10. Étape du candidat = `deriveCandidateStage` (`reporting/candidate-stage.ts:63`) — helper unique, 7 étapes, « le plus avancé gagne ».

### 1.4 Parcours « upload CV chat/UI »

`POST /api/cv-analyzer` (`route.ts:38`) : même cœur (`analyzeCVApplication`, `persistCandidateAnalysis`, alimentation vivier en `after()`), mêmes actions journal (préfixe `imap_` conservé sciemment). **Divergences** : l'outreach n'est pas dans la route — il est piloté côté client (`dispatchPostAnalysisOutreach` → `/api/mail-composer` + `/api/scheduler`) ; repli seuils sûr si absents (0/100 = tout gris, `:116-117`) ; HITL gris via `sendValidation`/`decideGrayValidation`.

### 1.5 Parcours vivier

Indexation `indexVivierCandidate` (`vivier/indexing.ts:95`) : entités+titre → variantes iso-rôle → ancres (titre + 2 derniers postes) → embedding titre → embeddings d'ancres → compétences + embeddings. Présélection `runVivierPreselection` (`preselection.ts:335`) : Bloc 1 déterministe multi-ancres + Bloc 2 sémantique, score 70 % titre / 30 % compétences, exclusions (déjà candidats, cooldown, rejetés). Cycle `identified → contacted | rejected` (`proposal-cycle.ts`), invitation avec référence `CAMP-XXXX` en objet (re-rattachable par le poller), rapprochement par email exact (`match-application.ts:38`) qui pose `from_vivier` et sort du cooldown.

### 1.6 Modules et articulation

| Module | Source de vérité | Consommé par |
|---|---|---|
| HITL | `gateCandidateOutreach` + `pending_validations` | poller, chat, `/validations` |
| Campagnes | `lifecycle.ts` (pur) + `campaigns` (lifecycle persisté) | poller (filtre active), vivier, reporting |
| Vivier | `vivier_*` (pgvector) | présélection, deliver-brief (CV), candidatures (`from_vivier`) |
| Reporting | `candidate_analyses` + journal | PDF campagne/multi/audit, metrics |
| Candidatures | `candidate_analyses` + marqueurs journal ciblés | menu 3 niveaux, ruban |
| Manager | lecture seule — cartographie produit + reporting déterministe (`manager-reporting.ts`, aucun LLM sur les chiffres) | chat |

Les grands invariants revendiqués par le projet sont **vérifiés dans le code** : gate HITL unique chat+IMAP, briefing unique (`queueInterviewBrief`, 3 voies), `deriveCandidateStage` partagé, extraction CV unique (`cv-extract.ts`), scoring 100 % code, Manager sans écriture (verrou `runManagerTurn`).

---

## Volet 2 — Cartographie technique

### 2.1 Architecture applicative — les couches

```
src/proxy.ts                    Auth globale (ex-middleware Next 16) : deny-by-default API, préfixes pages
src/instrumentation.ts          Boot serveur : démarre le scheduler IMAP (runtime Node uniquement)
src/app/**/page.tsx             Pages (App Router) — shells, la donnée passe par les routes API
src/app/api/**/route.ts         ~50 routes API (toutes runtime='nodejs') : validation d'entrée + orchestration,
                                PAS de logique métier (elle est déléguée à src/lib)
src/lib/<domaine>/              Services métier par domaine : imap/ vivier/ hitl/ scoring/ interview/
                                reporting/ agents/ chat/ campaign/ calcom/ email/ calendar/ crypto/ dashboard/ fdp/
src/lib/ai/                     Passage obligé des appels IA : provider.ts (chat), embeddings.ts
src/lib/db/repos/*.ts           Accès Supabase, ~1 fichier par table ; conversions rowTo*/toRow aux frontières
src/lib/db/supabase-server.ts   Client service_role UNIQUE (:21), confiné à lib/db + lib/storage
src/lib/storage/blob.ts         Supabase Storage (upload + URLs signées)
src/components/<domaine>/       UI par domaine (règle projet : 1 composant = 1 fichier ≤ 200 lignes)
src/stores/                     Zustand (état client) · src/types/ contrats TS · src/hooks/
```

**Où vit la décision** — les points de décision partagés, vérifiés à source unique : `gateCandidateOutreach` (`hitl/outreach-gate.ts:54`, chat ET IMAP), `classifyDecisionZone` (`scoring/score-candidat.ts:117`), `decideGrayValidation` (`hitl/decide-gray-validation.ts:23`), `deriveCandidateStage` (`reporting/candidate-stage.ts:63`, liste + ruban), `queueInterviewBrief` (`interview/queue-brief.ts:26`, 3 voies), `extractCVText` (`agents/cv-extract.ts`, 6 call-sites), machine `lifecycle.ts` (pure, `applyTransition` seul mutateur). La logique **encore dupliquée** est au §2.6.

### 2.2 Schéma de données (23 tables, `scripts/migrate.sql`, 1195 l.)

Aucune RLS dans `migrate.sql` au moment de l'audit (assumé « mono-utilisateur MVP », `migrate.sql:7` — examiné au Volet 3, SEC-1 ; **✅ RLS depuis activée côté Supabase le 09/07/2026**). Migrations idempotentes appliquées **manuellement** dans Supabase. `updated_at` maintenu par trigger `touch_updated_at()` (`:120`) sur ~9 tables.

**Cœur campagne**
- `campaigns` (`:18`) — la campagne et ses artefacts embarqués. PK `id text` applicative (`CAMP-XXXX`). Jsonb : `fdp`, `scoring_sheet`, `flux_config`, `channels_config`, `lifecycle`, `prefill_extraction`. FK `site_id → sites`, `donneur_ordre_id → donneurs_ordre` (ON DELETE SET NULL, `:536-538`). CHECK statut (`:21`), `thresholds_chk low≤high` (`:340`). **Frontières douces (nullable)** : `lifecycle` (null → re-dérivation `campaigns.ts:42-48`), `threshold_low/high` (null → repli 0/100 « tout gris », `campaigns.ts:62-63`), `launched_at`/`closed_at` (null → repli created/updated_at), `site_id`/`donneur_ordre_id` (campagnes historiques), `prefill_extraction`.
- `fdps_archived` (`:42`) — index de pré-recherche L1 ; PK = FK `campaign_id` CASCADE ; **duplique** `campaigns.fdp` (maintenu par code, pas de trigger) ; trgm sur `job_title` (`:52`).
- `scoring_sheets_archived` (`:71`) — historique des fiches ; PK `bigserial` ; FK campagne CASCADE.
- `tasks_archived` (`:85`) — sollicitations hors campagne ; PK `id text` (`TASK-XXXX`).
- `artifacts_meta` (`:178`) — métadonnées des livrables (le binaire est dans Storage) ; PK `id text` applicative (⚠️ ids IMAP aléatoires `art_imap_cv_${Date.now()}_${rand}` — doublons possibles, Volet 3 IDE-3) ; FK campagne/task CASCADE + CHECK **XOR owner** (`:190`) ; `storage_*` nullable = mode dégradé si upload échoue.
- `journal` (`:101`) — audit append-only ; PK `bigserial` ; `campaign_id` text **sans FK** ; aucune contrainte d'unicité (⚠️ doublons sous concurrence, Volet 3 IDE-3).

**Analyses & HITL**
- `candidate_analyses` (`:589`) — une ligne = un traitement de CV (jamais de fusion par email, politique assumée). PK `id text` **dérivée** : chat = id de tâche, IMAP = `can_imap_${mailbox}_${uid}` (`poller.ts:652`) — PK sûre car préfixée par la boîte. **AUCUNE FK** (`campaign_id` lenient, `vivier_candidate_id` uuid nu). Stocké : `application` jsonb complet (verdicts cités), `score`, `status` (binaire accepted/rejected — `rejected` **provisoire** pour un gris), `decision_zone` (la vérité 3 zones, persistée au scoring, `candidate-analyses.ts:213-214`), `decided_by` + identité valideur, `from_vivier` + `vivier_candidate_id` (**dénormalisés**, posés par `markAnalysisFromVivier` au rapprochement email, figés ensuite — assumé). **Frontières douces** : `decision_zone` null = lignes pré-HITL-3-zones (jamais reconstruites, `candidate-analyses.ts:73`), `from_vivier` default false + backfill script. ⚠️ Colonne de corrélation `uid` = uid IMAP **brut non préfixé** (`poller.ts:655`) : ambiguë entre boîtes — et `updateCandidateAnalysisDecision` matche `.eq('uid').eq('campaign_id')` (`candidate-analyses.ts:257-268`) → Volet 3, IDE-6.
- `pending_validations` (`:435`) — file HITL zone grise. PK `id text` dérivée `val_imap_${mailbox}_${uid}_${decision}` (sûre, upsert idempotent, `outreach.ts:198`). `campaign_id` sans FK. CHECK decision/status/decided_by (`:441,446,479`). ⚠️ `decision` force accept|reject alors qu'un gris n'est pas tranché (stocké `reject` provisoire).
- `interview_briefs` (`:1112`) — état des invités (brief en file → délivré). PK **`uuid gen_random_uuid()`** (robuste, délibéré). `campaign_id`/`task_id`/`uid` text **sans FK** ; `uid` = même uid brut ambigu cross-boîte. UNIQUE partiel `booking_uid where not null` (`:1154`) ; **pas** de CHECK état↔dates ni d'unique sur (campagne, email, awaiting_booking) — Volet 3, IDE-8.
- `calcom_webhook_events` (`:1170`) — claims d'idempotence webhook. PK `booking_uid text`. Pas de TTL (Volet 3, IDE-5).

**IMAP**
- `mailboxes` (`:257`) — boîtes surveillées. PK `id text`. `encrypted_password` (AES-256-GCM, clé env), curseur **`last_uid_seen`**, `last_error`, `last_polled_at`.
- `campaign_mailboxes` (`:284`) — association N-N. PK composite, 2 FK CASCADE.
- `imap_outreach_claims` (`:1189`) — verrou durable anti-double-envoi cross-instance. PK composite `(mailbox_id, uid, mode)` (sûre). Pas de FK, pas de TTL (Volet 3, IDE-1).

**Organisation & réglages**
- `sites` / `donneurs_ordre` (`:495,514`) — dimensions reporting. PK `id text` (`SITE-XXXX`/`DO-XXXX`), archivage soft (`archived_at`).
- `app_settings` (`:368`) — **mono-ligne** (CHECK `id=1`) : `resend_api_key` (en clair — Volet 3, SEC-7), `hitl/vivier/interview/intake` en jsonb. Un seul enregistrement = point de contention (last-writer-wins, Volet 3, IDE-9).

**Vivier (pgvector)**
- `vivier_candidates` (`:719`) — dossier candidat. PK **uuid** ; **UNIQUE `email`** (= la clé de dédup métier). Stocké : `cv_text`, `title` + `title_variants text[]` + `title_anchors jsonb`, `skills text[]`, `indexing_status` (pending/indexed/failed). `cv_tsv` = **seule colonne générée par la base** (`:1054`) ; le reste (titre, variantes, ancres, skills) est régénéré par code au reindex. **Frontière douce** : `title_anchors` vide → repli sur le titre déclaré.
- `vivier_embeddings` (`:759`) — PK = FK `candidate_id` CASCADE. `title_embedding vector(1536)` = signal courant ; `embedding` full-CV **nullable-isé après coup** (`:933`, conservé mais plus régénéré — frontière douce assumée).
- `vivier_entities` (`:780`) — entités structurées (GIN techs/certifs/diplômes/langues). PK = FK CASCADE.
- `vivier_skill_embeddings` (`:985`) — 1 ligne = 1 compétence. UNIQUE `(candidate_id, skill)`. HNSW.
- `vivier_anchor_embeddings` (`:1011`) — 1 ligne = 1 ancre. PK composite `(candidate_id, depth)`. HNSW.
- `vivier_preselections` (`:834`) — short-list par campagne + cycle factuel. PK composite `(campaign_id, candidate_id)` ; FK candidat CASCADE, `campaign_id` sans FK. `state` (identified/contacted/rejected) + faits datés, **CHECK état↔dates** (`:872` — le modèle du genre, absent d'`interview_briefs`). ⚠️ `skill_coverage`/`skill_matches` non persistés (Volet 4).

RPC : `match_vivier_titles` (`:948`), `match_vivier_anchors` (`:1028`), `match_vivier_candidates` (legacy, `:811`), `vivier_pending_by_campaign` (`:887`), `search_vivier_fulltext` (`:1068`). ⚠️ Set-returning sans LIMIT → cap PostgREST silencieux, Volet 4 PERF-3.

### 2.3 Flux techniques

**Poll IMAP — déclenchement.** Deux voies **mutuellement exclusives** sur `process.env.VERCEL` :
- dev/VPS : `instrumentation.ts:19` → `ensureSchedulerStarted()` → `setInterval` 30 s (`scheduler.ts:22,56`), garde `globalThis.__imapSchedulerHandle__` ;
- prod Vercel : le timer est désactivé (`scheduler.ts:41`) ; la relève vient d'un **cron externe (cron-job.org, à la minute)** qui appelle `GET /api/cron/imap-poll` (`route.ts:23`, `maxDuration:60`) avec `Bearer CRON_SECRET` (⚠️ fail-open si la variable manque — Volet 3, SEC-3). `vercel.json` est vide `{}` : le planning n'est **pas versionné** (configuré chez cron-job.org, invisible dans le repo).

**Poll IMAP — curseur `last_uid_seen`.** Lu en début de poll (`fromUid = last_uid_seen+1:*`, `poller.ts:213`), plafond 50 messages/poll (`:230`). **Committé une seule fois, en fin de boîte** (`:485`) via `updateMailboxPollState` (`mailboxes.ts:148-160`, écriture **sans condition** — last-writer-wins entre invocations concurrentes, Volet 3 IDE-4). Avance **même quand le traitement échoue** ; l'unique rembobinage est `minRetryUid`, posé seulement sur `RetryableOutreachError` (HITL non confirmable, `:429-435`) qui arrête la boucle (`:457`) et plafonne le commit (`:466-472`) — Volet 3, SIL-1 pour tous les autres échecs. Gardes anti-réentrance en mémoire de process (`__imapPollInFlight__` `:768`, `inflight` Set `:98`) — inopérantes cross-instance serverless ; la seule parade durable est le claim en base.

**Poll IMAP — traitement d'une PJ** (`processEmailAttachment`, `poller.ts:492`) : garde fiche de scoring validée (`:517-543`) → `extractCVText` (`:549`) → `analyzeCVApplication` (`:556`) → rapport + artefact + journal (`:607-646`) → `persistCandidateAnalysis` (`:651`) → vivier fire-and-forget (`:662,670`) → CV binaire (`:689-710`) → outreach gaté HITL (`:718`). **Formats extraits** : PDF (pdf-parse) + DOCX (mammoth), détection MIME **ou** extension (`cv-attachment.ts` — les clients envoient des .docx en `application/octet-stream`) ; `.doc` ancien = non extractible, trace dédiée `imap_cv_unsupported_format` (`:362`).

**Webhook Cal.com** (`webhooks/calcom/route.ts:35`) : `BOOKING_CREATED` uniquement. Signature HMAC-SHA256 sur le **corps brut** avec `timingSafeEqual`, fail-closed si secret absent (`:36-42`). Idempotence : `claimBookingEvent(booking_uid)` **avant** livraison (`:75`), rejeu → `replay` (`:85`), release sur échec transitoire (`:118-119`). Effet : `deliverBriefForBooking` (`deliver-brief.ts:207`) résout le brief en file par email (ou régénère), charge le CV du vivier, envoie **aux adresses de synthèse** (jamais tirées du payload) avec CV en PJ + `.ics`, marque `scheduled`.

**Appels externes.**
- **OpenAI** (`src/lib/ai/provider.ts`) : chat par défaut **`gpt-4o-mini`** (`:30` — surchargeable `OPENAI_CHAT_MODEL` ; noter que CLAUDE.md annonce « GPT-4o », le défaut réel est mini), transcription `whisper-1` (`:31`), embeddings **`text-embedding-3-small`** (`embeddings.ts:42`, surchargeable `OPENAI_EMBEDDING_MODEL` — tout changement impose `reindex:vivier` + redémarrage, env figé au boot). Timeout 30 s ; `chatCompleteJson` retry ×3 **sur échec de validation Zod uniquement** (`:217-245`), les erreurs transport (dont 429) se propagent sans retry applicatif (Volet 4, PERF-8). Seed 42 / temp 0 côté OpenAI.
- **Anthropic** (optionnel) : routage `CV_ANALYZER_PROVIDER=anthropic` → `claude-sonnet-4-6` par défaut (`provider.ts:37`), sortie forcée par outil `emit_result` ; pas de seed (déterminisme non garanti sur ce chemin).
- **Resend** (`email/client.ts:85`) : clé résolue dynamiquement depuis `/settings` (cache 60 s) avec repli env ; clé absente → no-op `{error:'email_not_configured'}`. Idempotence outreach : `claimOutreach` juste avant `sendEmail` (`outreach.ts:293`).
- **Storage** : bucket `artifacts` (10 Mo, MIME whitelist, `migrate.sql:156`) ; uploads best-effort (échec → `storage_* NULL`, la métadonnée subsiste) ; lecture par **URLs signées** (600 s par défaut `blob.ts:33` ; exception : lien CV du brief à 30 jours, `deliver-brief.ts:69` — Volet 3, SEC-6).

### 2.4 Points de couplage et défaillance unique

| Dépendance | Rôle | Si elle tombe | Point fragile |
|---|---|---|---|
| **Supabase** (Postgres+Storage+Auth) | cœur : données, claims, curseurs, auth | mode dégradé sans crash — mais la couche d'audit devient muette (`.catch(() => {})`, SIL-5) et le curseur peut avancer (SIL-1) | SPOF central assumé |
| **Cron externe cron-job.org** | seule source de relève IMAP en prod | plus aucun mail relevé, **aucun signal** : `_crashed` n'est lu nulle part et le cron répond `ok:true` (SIL-7) | ⚠️ SPOF **sans monitoring**, planning hors repo |
| **OpenAI** | analyse CV, embeddings, chat | `imap_cv_failed` + curseur avancé (SIL-1) ; dossiers vivier `indexed` creux (AVA-2) | pas de backoff applicatif |
| **Resend** | tous les envois | `send_failed` — jamais re-tenté sur le chemin IMAP (SIL-4) | |
| **Cal.com** | prise de RDV → livraison brief | briefs `awaiting_booking` indéfiniment ; `CAL_COM_EVENT_URL` absent → invitations bloquées (`imap_outreach_skipped`, jamais rejouées) | |
| **`MAILBOX_ENCRYPTION_KEY`** | déchiffrement credentials IMAP | clé perdue = boîtes irrécupérables (pas de fallback — voulu) ; clé absente = exception propre | secret à sauvegarder hors Vercel |
| **`app_settings` (ligne unique)** | Resend key, HITL, vivier, synthèse | jsonb écrasé en entier au PATCH (IDE-9) | point de contention |

### 2.5 Environnements et configuration

- **Deux environnements réels, pas de staging** : dev local (WSL, scheduler setInterval) et **prod Vercel sur le projet du client pilote** (cron externe). Bases Supabase séparées, sélectionnées par le contenu de `.env.local`.
- **Convention des fichiers env** (racine, tous gitignorés sauf `.env.example`) : `.env.local` = environnement **actif** ; `.env.localX` = credentials du projet **client pilote** ; `.env.dev.local` = backup du dev pendant un import client. Le basculement est un **swap manuel par copie de fichiers** (procédure `docs/ops/import-vivier-en-masse.md:51-57`) — ⚠️ fragile (risque d'écrire dans la mauvaise base ; mitigé pour l'import par la confirmation du ref projet exigée par `import-vivier.ts:22-41`, mais aucun garde équivalent pour `npm run dev` ou les autres scripts).
- **Répartition config env vs base** : en **env** = clés d'infrastructure (Supabase, OpenAI/Anthropic, `MAILBOX_ENCRYPTION_KEY`, `CRON_SECRET`, secrets Cal.com) — figées au boot (tout changement impose un redémarrage) ; en **base** = configuration métier modifiable à chaud : `mailboxes` (credentials chiffrés AES-256-GCM), `app_settings` (clé Resend — repli env —, HITL, vivierConfig, adresses de synthèse), associations campagne↔boîte.
- **Secrets** : aucun en dur dans le code (vérifié) ; env Vercel côté prod. ⚠️ `resend_api_key` et credentials d'intégration stockés en clair en base (Volet 3, SEC-7) ; `.env.localX` en clair sur le disque WSL.

### 2.6 Duplication de logique — bilan du motif « chemins parallèles »

| Décision | Verdict | Preuve |
|---|---|---|
| Gate HITL chat vs IMAP | ✅ **Unifié** | `outreach-gate.ts:54` importé par `imap/outreach.ts:122` ET `chat/manager-flow.ts:573` |
| Classification de zone | ✅ Unique (`classifyDecisionZone`) | repli dégradé `deriveDecisionZone(status)` limité aux lignes historiques |
| Briefing entretien | ✅ Unifié (`queueInterviewBrief`, 3 voies) | nuance : chat passe par fetch HTTP `/api/scheduler`, IMAP en appel direct |
| Extraction texte CV | ✅ Unique (`cv-extract.ts`) | multiples call-sites, zéro ré-implémentation |
| **Comptages/répartitions** | ❌ **3 chemins parallèles** | `dashboard/derive-metrics.ts` (journal) vs `dashboard/zone-counts.ts` (tables, ignore `decision_zone` volontairement) vs `reporting/aggregations.ts` (lit `decision_zone`) — la même notion « répartition des décisions » depuis 3 substrats ; sur des lignes legacy, dashboard et rapports peuvent différer |
| Backoff 429 | ❌ Dupliqué | `import-vivier.ts:295-342` a son backoff, le provider (`provider.ts`) n'en a pas — à rebours de CLAUDE.md (« centralise les retries ») |
| Helpers reporting | ❌ Dupliqué (mineur) | `campaign-report-loader.ts:30-33,84-88` re-implémente `campaignJobTitle`/`donneurDisplayLabel` exportés par `closed-campaigns-loader.ts:34-47` |

*(Faux positif écarté pendant l'audit : une « course » supposée entre le `.catch` posant `minRetryUid` et le `break` du poller — vérification faite, la chaîne `.then/.catch` est bien `await`ée à `poller.ts:408`, pas de course.)*

---

## Volet 3 — Vulnérabilités et robustesse (PRIORITAIRE)

### 3.A Pertes silencieuses (motif du bug réel observé — généralisé)

Constat central : **`last_uid_seen` avance sur quasiment tous les échecs.** Le seul rembobinage (`minRetryUid`) est déclenché par `RetryableOutreachError` (HITL non confirmable) — aucun autre échec ne l'utilise.

- **SIL-1 🔴 Tout échec de traitement d'une PJ consomme le CV définitivement** — `poller.ts:424-448`. Le `.catch` journalise `imap_cv_failed` puis l'UID avance. Concernés, y compris pour des pannes **transitoires** : extraction (`:549-553`), transport LLM (une indispo OpenAI de 2 min consomme les mails du poll), échec DB sur `appendJournalEntry` (`:522`, awaité sans try/catch) ou `insertArtifactMeta` (`:607`). Le CV binaire n'existe alors nulle part (l'upload arrive plus tard, `:687-715`). Le candidat ne reçoit jamais de réponse ; visible seulement en lisant le journal. **Effort M** — poser `minRetryUid` sur les erreurs classées transitoires, comme le fait déjà le deferred HITL.
- **SIL-2 🔴 CV reçu sans fiche de scoring validée : le fichier est perdu** — `poller.ts:538-543`. Journal `imap_cv_received` avec `pendingScoringSheet:true` puis `return` **avant tout stockage du binaire**, UID avancé. **Vérifié : `pendingScoringSheet` n'a aucun consommateur** (unique occurrence = l'écriture, `poller.ts:533`) — le rescoring « C7 » n'existe pas. Scénario pilote typique : boîte associée + campagne active + fiche pas encore validée → toute la première vague = lignes de journal sans fichier, seul recours = renvoi par le candidat. **Effort M** — uploader le binaire avant le return + chemin de rescoring (ou différer via `minRetryUid`).
- **SIL-3 🔴 Trou `none` (connu) confirmé et élargi** — `poller.ts:328-330` : `continue` sans journal même avec CV en PJ ; s'ajoute le skip boîte-sans-campagne (`:156-161`). Aucune instrumentation n'existe encore. Corriger l'association après coup ne rejoue rien (UID avancé).
- **SIL-4 🟠 `send_failed` / lien agenda absent : aucun réessai** — `outreach.ts:105-117,334-345`. Sur échec Resend transitoire, le claim est relâché « pour qu'un re-poll renvoie » **mais aucun re-poll n'aura lieu** (`send_failed` n'est pas `RetryableOutreachError`, l'UID avance) : la libération est inopérante sur ce chemin. Candidat analysé, jamais contacté. Incohérence en prime : sur `send_failed`/`skipped`, le **brief est quand même mis en file** (`:150-162` n'exclut que `queued`/`duplicate`). **Effort M.**
- **SIL-5 🟠 Toute la couche d'audit du poller est en `.catch(() => {})`** — `poller.ts:268,302,324,344,379,400,447` + `outreach.ts:139,244,305`. Sous panne Supabase partielle, les mails sont consommés avec **zéro trace d'aucune sorte** — précisément les événements censés expliquer « pourquoi rien ne s'est passé ». **Effort S** (a minima `console.error`).
- **SIL-6 🟠 Plusieurs CV dans un même mail : collisions de clés par `uid`** — toutes les clés d'idempotence dérivent de l'uid du *message*, pas de la PJ : le 2ᵉ candidat n'est pas persisté (insert en doublon avalé, `candidate-analyses.ts:231-238`), ne reçoit jamais de mail (claim perdu → `duplicate`), ou **écrase la validation grise du 1ᵉʳ** (upsert `val_imap_…`). Un mail transféré avec 3 CV → 1 traité, 2 disparus. **Effort M** (suffixer l'index de PJ).
- **SIL-7 🟡** `_crashed` de `pollAllMailboxes` (`poller.ts:794-801`) n'est lu nulle part, le cron répond `ok:true` — une boîte qui crashe post-connexion cesse d'être relevée sans signal. `if (!message.source) continue` (`:254`) : zéro trace.

### 3.B Le cas le plus grave de l'audit : refus auto sur panne LLM

- **SIL-8 🔴 Échec LLM après retries ⇒ mail de refus réel envoyé au candidat, sans alerte.** Chaîne prouvée et contre-vérifiée : `chatCompleteJson` échoue ×3 → `AIValidationError` (`provider.ts:247-251`) → **tous** les critères passent `non_verifiable` + `llmFailure:true` (`cv-application-analyze.ts:369-382`) → facteur 0 (`score-candidat.ts:207-209`) → score ≈ 0 → `auto_reject` (`classifyDecisionZone`) → gate zone auto → **envoi immédiat du refus** (`outreach-gate.ts:59-61`). Le drapeau `llmFailures` retourné par `analyzeCVApplication` a **zéro consommateur dans tout `src/`** (vérifié : seules occurrences dans le module lui-même) ; le poller ne destructure que `application` (`poller.ts:556`). Un excellent candidat peut être refusé par mail — action irréversible envers un humain — parce qu'OpenAI a renvoyé du JSON malformé, sans journal dédié, sans zone grise, sans humain. **Effort S/M** — forcer `decisionZone='gray'` (ou defer) quand `llmFailures.verdicts === true` : un point unique.

### 3.C Sécurité des accès, secrets, données sensibles

- **SEC-1 🔴 → ✅ CORRIGÉ le 09/07/2026 (RLS activée sur toutes les tables).** Constat d'origine, conservé pour trace — RLS absente sur les 23 tables + anon key publique. Vérifié : 0 occurrence de `row level security` dans `migrate.sql`, assumé en commentaire (« Pas de RLS (mono-utilisateur MVP) », `migrate.sql:7,492-493`). L'anon key est embarquée dans le bundle (`NEXT_PUBLIC_`, `supabase-browser.ts:28-32`). Si le schéma `public` est exposé par PostgREST (défaut Supabase) et que la RLS n'a pas été activée à la main dans le dashboard, **quiconque extrait l'anon key du bundle lit/écrit toutes les tables** via `rest/v1` — PII candidats, `mailboxes.encrypted_password`, `app_settings.resend_api_key` en clair — en contournant tout le proxy Next. Le code seul ne permet pas de trancher (config dashboard). **Test immédiat** : `curl -H "apikey: <anon>" https://<projet>.supabase.co/rest/v1/vivier_candidates?select=email&limit=1`. **Correction S, zéro impact applicatif** : `alter table … enable row level security` sur toutes les tables **sans aucune policy** (le service_role bypasse la RLS). Vérifier aussi que le bucket `artifacts` est privé (le code n'utilise que des URLs signées).
- **SEC-2 🟠 Signups Supabase potentiellement ouverts** : le bouton est désactivé dans l'UI (`LoginForm.tsx:10`) mais l'API Auth est publique avec l'anon key — si « Allow new users to sign up » est actif côté projet, n'importe qui obtient une session **valide pour tout le middleware** (aucun rôle, aucune allowlist). **À vérifier dashboard, effort S.**
- **SEC-3 🟠 `/api/cron/imap-poll` fail-open** — vérifié : `if (secret) {…}` (`cron/imap-poll/route.ts:24-30`) : sans `CRON_SECRET` posé, la route est **publique**. **Effort S** (refuser 500 si non configuré + `timingSafeEqual`).
- **SEC-4 🟠 `/admin` = session sans rôle** — tout utilisateur authentifié y accède ; dette documentée (`admin/dashboard/page.tsx:11-14`). Réel dès le 2ᵉ compte (pilote). **Effort M.**
- **SEC-5 🟠 Prompt injection CV → décision** : le texte du CV est inséré tel quel dans les prompts (`cv-extraction-prompts.ts:43-56,83-88,159-193`) sans délimiteurs ni consigne anti-injection. Mitigations réelles : score calculé en code, citations littérales exigées, HITL gris, rapprochement campagne déterministe, destinataire devant figurer littéralement dans le CV (`candidate-email.ts`). Résiduel : un CV façonné visant la zone verte obtient une invitation sans humain. **Effort M.**
- **SEC-6 🟠 URL signée du CV valable 30 jours** dans le mail de brief (`deliver-brief.ts:69`) alors que le CV est **déjà en PJ du même mail** — un transfert de mail expose le CV un mois. Les autres URLs signées sont à 600 s. **Effort S.**
- **SEC-7 🟡** Pages shells publiques (`/vivier`, `/validations-vivier` — échappe au préfixe car le check exige `/validations/` avec slash, `proxy.ts:36-38` —, `/reporting`, `/candidatures-apercu`) : aucune donnée ne fuit (APIs gatées) mais posture allow-by-default incohérente ; supprimer `/candidatures-apercu`. Open redirect `?next` au login (`LoginForm.tsx:22,51`). Matcher : l'exclusion d'extensions s'applique aussi sous `/api/` (`proxy.ts:76`). Aucun header de sécurité (CSP/HSTS). `resend_api_key` + credentials d'intégration en clair en base (write-only côté API, mais non chiffrés contrairement aux mailboxes). PII candidat dans le journal sans politique de purge (droit à l'effacement).
- **Points solides à préserver** : deny-by-default API fail-closed, webhook Cal.com exemplaire, crypto mailboxes irréprochable (AES-256-GCM, IV aléatoire, aucun fallback clair), zéro secret en dur, zéro `dangerouslySetInnerHTML`, `escapeHtml` systématique dans les templates mail, recherche PostgREST assainie, logs sans PII.

### 3.D Idempotence

Deux angles morts **systémiques** ressortent : (1) le pattern claim/release protège des échecs *catchables* mais pas des *crashs* (aucun TTL sur les deux tables de claims) ; (2) sur les chemins **humains**, la garde d'idempotence arrive **après** l'effet de bord — « réserver l'état d'abord, envoyer ensuite » n'est appliqué que sur les chemins automatiques.

- **IDE-1 🔴 Claim outreach orphelin → candidat muet définitif** — `outreach.ts:293` (claim) → `:321` (`getSynthesisEmail()`, qui peut lever) → `:322` (`sendEmail`) ; `releaseOutreachClaim` seulement sur le chemin nominal (`:343-345`). Exception ou kill (timeout `maxDuration:60`) entre claim et send ⇒ clé posée, mail jamais parti, **aucun re-poll ne renverra jamais** (pas de TTL, `created_at` jamais lu, aucun sweep) — avec un journal `imap_outreach_duplicate_skipped` qui affirme faussement qu'une passe gagnante s'en est chargée. **Effort S** (try/finally + TTL de re-claim).
- **IDE-2 🔴 Double décision grise concurrente → deux mails, possiblement contradictoires** — la séquence client `sendValidation` (`send-validation.ts:47-111`) fait (1) mail, (2) brief, (3) finalisation ; la garde idempotente est en (3) (`send/route.ts:44-46`), **après** l'envoi. Deux clics/onglets ⇒ deux mails ; décisions opposées ⇒ **le candidat reçoit l'invitation ET le refus**. Même cause : un retry après échec de la finalisation **renvoie le mail** (étape 1 inconditionnelle). **Effort M** (transition conditionnelle en base d'abord : `status='sending' where status='pending'`).
- **IDE-3 🟠 Le claim ne couvre que le mail** — deux invocations cron concurrentes lisent le même `last_uid_seen` et exécutent chacune tout `processEmailAttachment` : journal doublé (`imap_cv_received`/`analyzed`, append-only sans clé → sur-comptage), artefacts doublés (ids aléatoires `poller.ts:586`, `outreach.ts:362`), analyse LLM ×2. Protégés : `candidate_analyses` (PK déterministe), `pending_validations` (upsert), CV binaire, vivier. **Effort M** (claim au niveau `(mailbox, uid)` en tête de traitement, ou ids d'artefacts déterministes).
- **IDE-4 🟠 `last_uid_seen` last-writer-wins + commit tout-ou-rien** — `mailboxes.ts:148-160` écrit sans condition ; une passe lente écrase la passe rapide → rembobinage involontaire → re-traitements ; crash après 49/50 messages ⇒ 49 re-traités. **Effort S** (`update … where last_uid_seen < :new` + commit incrémental).
- **IDE-5 🟠 Claim Cal.com orphelin sur kill** — même faiblesse que IDE-1 : process tué après claim ⇒ le retry Cal.com est absorbé en `replay` ⇒ **brief jamais livré, silencieusement**. **Effort S** (même correctif TTL).
- **IDE-6 🟠 Décision humaine sur le mauvais candidat (uid cross-boîte)** — `updateCandidateAnalysisDecision` matche `.eq('uid').eq('campaign_id')` (`candidate-analyses.ts:257-268`) avec l'uid IMAP brut : deux boîtes sur la même campagne peuvent porter le même uid ⇒ la décision d'un gris peut **flipper une autre analyse**. **Effort M** (corréler par `id` ; migration des uid existants délicate).
- **IDE-7 🟠 Invitation vivier : le mail part avant la garde d'état** — `sendEmail` (`invitation-send.ts:78`) **puis** `markContacted` gardé (`:96`). Double clic / double POST decisions (`decisions/route.ts:54-58`, aucun verrou) / relance auto concurrente ⇒ **double invitation**. **Effort M** (réserver l'état d'abord, release si échec d'envoi).
- **IDE-8 🟠 `interview_briefs` sans contrainte unique sur (campagne, email, `awaiting_booking`)** — `queuePendingBrief` = find-then-insert applicatif (`interview-briefs.ts:96-127`) : deux briefs en file pour le même candidat, l'un reste « invité en attente » pour toujours. **Effort S/M** (index unique partiel + upsert).
- **IDE-9 🟡** `replacePreselection` (`vivier-preselection.ts:29-79`) : une décision humaine concurrente d'une relance fait échouer **tout le batch** sur le CHECK état↔dates (pas de corruption — bon design — mais relance plantée). `patchAppSettings` et `upsertCampaign` remplacent le jsonb entier (last-writer-wins). Rapports PDF sans garde double-clic. CHECK état↔dates manquant sur `interview_briefs`. Bons patterns constatés ailleurs : `markContacted`/`recordApplied` conditionnels, claims `ON CONFLICT DO NOTHING`.

### 3.E Erreurs avalées et écritures optimistes (inventaire « perte silencieuse » côté client)

- **OPT-1 🔴 Tasks — non corrigé** (`db/sync/tasks-sync.ts:95-106`) : catch vide **et** `res.ok` jamais testé. Clôture de sollicitation revenue en arrière au reload, zéro signal. **Effort S** (répliquer le pattern `sync-status` des campagnes).
- **OPT-2 🔴 Artifacts — non corrigé** (`db/sync/artifacts-sync.ts:44-67`, via `void pushArtifact`, `manager-flow.ts:159,458`) : `if (!res.ok) return;` + catch avaleur. L'annonce s'affiche (Blob local), le POST échoue → disparue à la session suivante. **Effort S/M.**
- **OPT-3 🟠 Settings** (`SettingsHub.tsx:252-259`) : état local posé **avant** le PUT, jamais de rollback (erreur = flash 3,5 s). Destinataires de brief « actifs » non persistés → briefs aux mauvais destinataires. **Effort S.**
- **AVA-1 🟠 Catch avaleurs à impact métier** : `dashboard/candidate-actions.ts:71-90` (le « GO » définitif d'un gris peut régresser au poll suivant — le chat a confirmé à tort) ; `hitl/send-validation.ts:71-87` (mail parti puis `fetch('/api/scheduler')` sans `res.ok` → brief jamais en file) ; `chat/manager-acknowledgments.ts:70,108-123` (journal d'audit des actions UI troué) ; `api/reporting/*/send/route.ts:119-131` (PDF envoyé, trace RGPD « qui a reçu quoi » perdue). **Effort S chacun.**
- **AVA-2 🟠 Vivier `indexed` sans embedding = invisible et non réparable** — les échecs d'embeddings sont « non bloquants » puis le statut passe `indexed` (`indexing.ts:179-181,204-205,234`) : dossier invisible du Bloc 2, couverture 0, **exclu de `reindex --only-failed`**. Le script d'import a un « statut honnête », le chemin applicatif non. **Effort S.**
- **AVA-3 🟡** Boucle de contact auto en `after()` non protégée (`invitation-send.ts:116-127`) : une exception au candidat k interrompt k+1..N après que la route a répondu. `.catch(() => [])` au call-site qui ré-avale les vraies erreurs DB (`stage-signals.ts:68-74`, `journey-lookup.ts:57-59`, `zone-counts.ts:52` → un candidat régresse d'étape à l'affichage). `loadReportingSnapshot().catch(() => null)` (`manager.ts:603-611`) → le Manager peut narrer « 0 candidature » sur simple échec de lecture.

---

## Volet 4 — Performance et bonnes pratiques

**Fait technique central** : Supabase/PostgREST applique un **cap silencieux `max-rows` (défaut 1000)** à toute requête sans `.range()`/`.limit()`, **y compris les RPC set-returning** — aucune erreur, les lignes disparaissent. Avec l'import des 1600 CV, plusieurs chemins critiques franchissent ce seuil **maintenant**.

### 4.1 Scaling — requêtes non bornées

- **PERF-1 🔴 La présélection ne voit plus tout le vivier au-delà de 1000 indexés** — `vivier.ts:661-687` (`listIndexedVivierTitles`, base des blocs 1 ET 2), `vivier.ts:761` (`listIndexedVivierEntities`), `vivier.ts:828` (`listVivierCandidateIds` — **une réindexation « complète » s'arrête à 1000** sans le dire, alors qu'elle est obligatoire après changement de modèle). À 1600, ~600 dossiers silencieusement invisibles. **Effort S** (pagination).
- **PERF-2 🔴 Exclusion « a déjà postulé » plafonnée à 200** — vérifié : `loadExcludedEmails` (`preselection.ts:321-328`) appelle `listCandidateAnalyses({campaignId})` sans limit → défaut 200 (`candidate-analyses.ts:301`). Au-delà, la présélection peut **réinviter à candidater quelqu'un qui a déjà postulé** (image client). **Effort S** — `listAllCandidateAnalyses` existe déjà.
- **PERF-3 🔴 RPC vectorielles tronquées à 1000 lignes** — `match_vivier_anchors`/`match_vivier_titles` (`migrate.sql:1028-1041,948-964`) reçoivent tous les non-retenus du bloc 1 (`preselection.ts:461`) : ~1500 candidats × 3 ancres ≈ 4500 lignes → cap → la majorité sans score sémantique, classée « sous le seuil » à tort. **Effort S/M** (chunker `candidate_ids` par ~200).
- **PERF-4 🔴 Rapport multi-campagnes : cap global de 1000 analyses toutes campagnes confondues** — `closed-campaigns-loader.ts:52` (`listCandidateAnalyses({limit:1000})` **sans filtre campagne**) : les campagnes clôturées anciennes affichent des volumes partiels ou zéro dans des **PDF présentés au client**. Rapport unitaire cappé à 1000 aussi (`campaign-report-loader.ts:53`). **Effort M.**
- **PERF-5 🟠** `listSkillEmbeddingsByCandidateIds` (`vivier.ts:463-486`) : short-list entière (`preselection.ts:479`) ⇒ cap → **couverture compétences silencieusement 0** (tri 70/30 faussé) + transfert de vecteurs 1536 floats en JSON (dizaines de Mo/présélection). `listPendingValidations` non borné + `select('*')` appelé à chaque hit `/api/candidatures` (`pending-validations.ts:108-125`). Cooldown troué au-delà de 1000 contacts (`vivier-preselection.ts:453-481`). Garde d'espace d'embeddings sans `DISTINCT` SQL (`vivier.ts:555/569/628`).
- **✅ Conforme** : pagination serveur du menu Candidatures réelle (`api/candidatures/route.ts:97-105`, range + count exact), compteurs exhaustifs paginés. Réserve : le filtre `stage` charge le périmètre en RAM (OK à 1600, à revoir à 10k+).

### 4.2 Comptages sur journal tronqué

- **PERF-6 🟠 Rapports** : `journey-lookup.ts:42` (`limit:500`) alimente les marqueurs entretien/validation/**recruté** des PDF (time-to-hire, recrutés par canal) — à 2-4 entrées de journal par CV, la fenêtre couvre une fraction d'une campagne à 1600 CV ⇒ recrutements « oubliés ». Le bon pattern existe déjà (`stage-signals.ts` + `listJournalEntriesByActions`). **Effort M.**
- **PERF-7 🟠 Dashboard résiduel** : `METRICS_WINDOW=500` (`db/repos/metrics.ts:21`) → les KPIs `/api/metrics/global` = « fenêtre des 500 derniers événements ». Déjà faux à 1600 CV. Backlogué, mais le volume l'a rattrapé. **Effort M.**

### 4.3 Index manquants (tous effort S)

| Index | Justification |
|---|---|
| `journal (action, created_at desc)` 🟠 | `listJournalEntriesByActions` appelé à chaque hit `/api/candidatures` ; table la plus écrite |
| `candidate_analyses (received_at)` 🟠 | filtres from/to du menu + ruban + reporting |
| trgm sur `candidate_analyses.candidate_email` 🟠 | `getLatestAnalysisByEmail` est sur le **chemin du webhook Cal.com** ; seul le nom a un trgm |
| `candidate_analyses (decided_by)` partiel, `(decision_zone)`, `vivier_preselections (state)` 🟡 | counts du bureau, filtres repo, cooldown |

Note : les index HNSW existent mais les RPC `match_vivier_*` filtrent `= any(ids)` puis calculent la distance ligne à ligne — l'index n'est pas exploité (sans conséquence à 1600 ; le vrai problème est le cap, PERF-3).

### 4.4 Rate limits et coûts

- **PERF-8 🟠 Aucun backoff 429 applicatif dans le provider** (`provider.ts:459-475`, `embeddings.ts:179-195` : `rate_limit` propagé sans retry ; seul filet = 2 retries du SDK). Sur le chemin réel (indexation en `after()`/fire-and-forget), un 429 soutenu produit des dossiers `indexed` **creux** (cf. AVA-2). Le script d'import a son propre backoff — duplication de la responsabilité que CLAUDe.md attribue au provider. **Effort M.**
- **PERF-9 🟠 Embeddings non batchés** (1 appel/texte, `indexing.ts:214-224`) : l'API accepte un tableau — 15-30 appels/CV → 2-3. `embedJobSkills` + variantes LLM recalculés à **chaque** présélection sans cache (`preselection.ts:240-251,423`). **Effort M.**
- **PERF-10 🟠 Décisions vivier en masse : jusqu'à 200 `sendEmail` concurrents** (`decisions/route.ts:54-58`, `Promise.all` sans chunking) → 429 Resend quasi garanti sur une validation en masse. **Effort S.**
- **PERF-11 🟡** `listCampaigns` `select('*')` (fdp, scoring_sheet, `prefill_extraction` jsonb) **dans la boucle par-mailbox du poller** (`poller.ts:168`) — des Mo transférés chaque minute pour lire un statut et un titre. N+1 `getCampaign` (`last-applied-job.ts:38`, borné à 25).

### 4.5 Qualité TS et patterns

État globalement **excellent** : zéro `any`, zéro `@ts-ignore` dans `src/` (hors tests), frontières `rowTo*` exemplaires, migrations douces systématiquement bornées à la lecture.

- 🟡 Pas d'exhaustiveness check (`assertNever`) sur les unions : `lifecycle.ts:139-152` (`default: return []` — un nouveau statut compilerait en silence), projections `SendResult` (`imap/outreach.ts:428`, `manager-flow.ts:718`), `candidate-journey.ts:81`.
- 🟡 `as unknown as EmailJoinRow[]` ×2 (`vivier-preselection.ts:463,480`) : un renommage de jointure ferait lire des `undefined` au cooldown en silence.
- 🟡 **Deux « vérités » de répartition** (cf. §2.6) : `computeVolumes` lit `decision_zone`, `zone-counts` l'évite délibérément — documenter laquelle fait foi, sinon unifier.
- 🟡 Patterns : duplication de helpers reporting (§2.6) ; incohérence DOCX (upload manuel vivier le refuse, `upload-batch.ts:11,28-30`, alors qu'IMAP/import/`extractCVText` l'acceptent — message devenu faux) ; `skill_coverage`/`skill_matches` non persistés (`vivier-preselection.ts:61-73`) → après rechargement la short-list affiche une couverture 0 non auditable (contraire au principe « capture à la source »).

---

## Synthèse priorisée

### 🔴 CRITIQUE — perte de données, faille, incident prod ou chiffres faux client

| # | Constat | Localisation | Risque concret | Effort |
|---|---|---|---|---|
| C1 | ~~RLS absente partout + anon key publique~~ **✅ CORRIGÉ le 09/07/2026** (RLS activée ; conservé pour trace) | `migrate.sql:7` (0 policy à l'audit), `supabase-browser.ts:28` | Lecture/écriture de toutes les tables (PII, credentials) en contournant le proxy | **S** — fait |
| C2 | Panne LLM ⇒ refus auto envoyé au candidat | `cv-application-analyze.ts:369-382` → `outreach-gate.ts:59-61` ; `llmFailures` sans consommateur | Refus irréversible d'un bon candidat sur JSON malformé, sans trace ni humain | **S/M** |
| C3 | Curseur IMAP avance sur échecs transitoires (LLM, DB, extraction) | `poller.ts:424-448` | CV consommé définitivement pendant toute panne — le motif du bug réel, toujours ouvert | **M** |
| C4 | CV sans fiche validée : binaire jamais stocké, rescoring inexistant | `poller.ts:533-543` (`pendingScoringSheet` jamais lu) | Première vague d'une campagne du pilote perdue si la fiche est validée en retard | **M** |
| C5 | Claim outreach orphelin (pas de TTL, release non garanti) | `outreach.ts:293-345` | Candidat analysé, jamais contacté, avec un journal qui prétend le contraire | **S** |
| C6 | Double décision grise concurrente / retry | `send-validation.ts:47-111`, `send/route.ts:44-46` | Deux mails au candidat, possiblement **invitation ET refus** | **M** |
| C7 | Sync optimiste tasks + artifacts non corrigée | `tasks-sync.ts:95-106`, `artifacts-sync.ts:44-67` | Clôture de tâche / annonce « enregistrées » qui disparaissent au reload | **S** |
| C8 | Vivier aveugle >1000 : listes non paginées + RPC cappées | `vivier.ts:661,761,828` ; `migrate.sql:948,1028` | ~600 des 1600 CV importés invisibles de toute présélection ; reindex « complet » partiel | **S/S-M** |
| C9 | Exclusion « déjà postulé » cap 200 | `preselection.ts:321-328` + `candidate-analyses.ts:301` | Réinviter à candidater quelqu'un qui a déjà postulé (image client) | **S** |
| C10 | Rapports clôturés : cap global 1000 + journal 500 | `closed-campaigns-loader.ts:52`, `journey-lookup.ts:42` | PDF client avec volumes partiels/zéro et recrutements oubliés | **M** |
| C11 | Trou `none` : mail avec CV skippé sans trace (backlog confirmé) | `poller.ts:328-330,156-161` | Candidature invisible ; corriger l'association ne rejoue rien | **S** |

### 🟠 IMPORTANT — robustesse, échelle, dette coûteuse

| # | Constat | Localisation | Effort |
|---|---|---|---|
| I1 | `send_failed`/agenda absent : jamais re-tenté (+ brief mis en file quand même) | `outreach.ts:105-117,150-162,334-345` | M |
| I2 | Couche d'audit poller en `.catch(() => {})` — panne Supabase = zéro trace | `poller.ts:268-447`, `outreach.ts:139-305` | S |
| I3 | Multi-CV même mail : collisions de clés par uid (2ᵉ candidat perdu/écrasé) | `poller.ts:652,697`, `outreach.ts:198,292` | M |
| I4 | uid brut cross-boîte : décision humaine peut flipper la mauvaise analyse | `candidate-analyses.ts:257-268` | M |
| I5 | Claim ne couvre que le mail : journal/artefacts/LLM doublés sous cron concurrent | `poller.ts:522,586,629` | M |
| I6 | `last_uid_seen` last-writer-wins + commit tout-ou-rien | `mailboxes.ts:148-160`, `poller.ts:485` | S |
| I7 | Claim Cal.com orphelin sur kill → brief jamais livré (`replay`) | `webhooks/calcom/route.ts:75-132` | S |
| I8 | `interview_briefs` : doublons `awaiting_booking` possibles | `interview-briefs.ts:96-127` | S/M |
| I9 | Invitation vivier : mail envoyé avant la garde d'état (double clic = double mail) | `invitation-send.ts:78-96`, `decisions/route.ts:54-58` | M |
| I10 | Vivier `indexed` sans embedding : invisible, exclu de `--only-failed` | `indexing.ts:179-234` | S |
| I11 | Catch avaleurs à impact métier (GO qui régresse, brief jamais en file, audit troué, trace RGPD d'envoi perdue) | `candidate-actions.ts:71-90`, `send-validation.ts:71-87`, `manager-acknowledgments.ts:70+`, `reporting/*/send:119-131` | S ×4 |
| I12 | Settings optimistes sans rollback (destinataires de brief fantômes) | `SettingsHub.tsx:252-259` | S |
| I13 | CRON_SECRET fail-open ; signups Supabase à vérifier ; `/admin` sans rôle | `cron/imap-poll/route.ts:24-30` ; dashboard ; `admin/dashboard/page.tsx` | S/S/M |
| I14 | Prompt injection CV (zone verte auto sans humain) ; URL signée CV 30 j | `cv-extraction-prompts.ts` ; `deliver-brief.ts:69` | M/S |
| I15 | Journal tronqué : METRICS_WINDOW 500 (dashboard), journey-lookup 500 (rapports) | `metrics.ts:21`, `journey-lookup.ts:42` | M |
| I16 | Index manquants : `journal(action)`, `candidate_analyses(received_at)`, trgm email (chemin webhook) | `migrate.sql` | S |
| I17 | Pas de backoff 429 provider ; embeddings non batchés ; `embedJobSkills` sans cache ; 200 sends concurrents | `provider.ts:459`, `indexing.ts:214`, `preselection.ts:240`, `decisions/route.ts:54` | M/M/M/S |
| I18 | `listSkillEmbeddingsByCandidateIds` cap + Mo de vecteurs par présélection ; `listPendingValidations` non borné à chaque hit | `vivier.ts:463-486`, `pending-validations.ts:108` | M/S |
| I19 | 3 chemins de comptage parallèles (journal vs tables vs decision_zone) — dashboard ≠ rapports possibles | `derive-metrics.ts`, `zone-counts.ts`, `aggregations.ts` | M |
| I20 | `listCampaigns select('*')` (jsonb lourds) dans la boucle par-mailbox du poller | `poller.ts:168` | S |

### 🟡 COSMÉTIQUE — propreté, confort

Pages shells publiques + posture pages allow-by-default ; open redirect `?next` ; matcher extensions sous `/api` ; headers de sécurité absents ; `resend_api_key`/credentials en clair en base (write-only) ; PII journal sans politique de purge ; `_crashed` jamais lu + cron `ok:true` trompeur ; CHECK état↔dates manquant sur `interview_briefs` ; `decision` forcée `reject` pour un gris non tranché ; TTL/purge des tables de claims ; `replacePreselection` vs décision concurrente (batch planté, pas de corruption) ; settings/campaign jsonb last-writer-wins ; PDF send sans garde double-clic ; exhaustiveness checks absents ; `as unknown as` ×2 ; non-null assertions (`CampaignCreateSheet.tsx:219-251`, code write mort de `ManagerChat`) ; duplication helpers reporting ; incohérence DOCX upload vivier ; `skill_coverage` non persisté ; N+1 `getCampaign` ; `max()` en JS (`vivier-preselection.ts:243-253`) ; garde d'espace embeddings sans DISTINCT ; `vercel.json` vide (cron non documenté dans le repo) ; suppression de `/candidatures-apercu`.

---

## Stratégie de mise en œuvre graduelle et sécurisée

Principe d'ordonnancement : d'abord ce qui se corrige **sans code** (config), puis ce qui devient faux **à la fin de l'import 1600 CV** (déjà en cours), puis les pertes silencieuses du pipeline IMAP (le cœur du produit), puis l'idempotence des chemins humains, puis le reporting. Chaque lot est déployable indépendamment, dev d'abord, migrations douces (additives, jamais destructives), avec son test de non-régression.

### Lot 0 — Config, zéro code (C1, partie I13) — **PARTIELLEMENT FAIT**
- ~~**Vérifier/activer la RLS**~~ **✅ FAIT le 09/07/2026** : RLS activée sur toutes les tables (sans policy — le service_role bypasse, zéro impact applicatif). Garder le smoke test après tout futur ajout de table : toute **nouvelle** table doit recevoir `enable row level security` dès sa migration, sinon elle rouvre le trou.
- **RESTE À FAIRE — vérifier les signups Supabase désactivés** (Dashboard → Auth → « Allow new users to sign up » ; sinon quiconque s'auto-inscrit obtient une session valide pour tout le middleware — SEC-2) et que **`CRON_SECRET` est bien posé sur Vercel** (sinon la route cron est publique — SEC-3).
- **RESTE À FAIRE — vérifier que le bucket `artifacts` est privé** (le code n'utilise que des URLs signées).
- *Risque si non terminé : session gratuite pour un inconnu (signups) ; déclenchement public de la relève IMAP (cron) ; artefacts CV lisibles sans signature (bucket).*

### Lot 1 — Échelle vivier, avant la fin de l'import (C8, C9, partie I18)
1. Paginer `listIndexedVivierTitles`/`Entities`/`CandidateIds` (pattern `listAllCandidateAnalyses` déjà présent dans le repo voisin).
2. `loadExcludedEmails` → `listAllCandidateAnalyses`.
3. Chunker les appels RPC `match_vivier_*` et `listSkillEmbeddingsByCandidateIds` (paquets de ~200 ids).
- Dépendances : aucune. Test : présélection sur une campagne avec >1000 indexés (l'import fournit le jeu de données réel) — le nombre de candidats considérés doit être égal au count SQL.
- *Risque si non fait : la moitié du vivier importé n'existe pas pour le produit, et des candidats déjà candidats sont réinvités.*

### Lot 2 — Anti-perte pipeline IMAP (C2, C3, C4, C5, C11, I1, I2, I6)
Ordre interne (dépendances réelles entre correctifs) :
1. **C2 d'abord** (gate `llmFailures` → forcer `gray`/defer) : un point unique, il conditionne la sûreté de tout le reste — tant qu'il n'est pas posé, améliorer les réessais (C3) *augmente* le nombre de refus auto erronés re-tentés.
2. **C5 + I7** (TTL sur les deux tables de claims + try/finally autour de claim→send) : migration additive (`created_at` existe déjà), re-claim si claim plus vieux que N minutes.
3. **C3** (classer les erreurs transitoires — transport LLM, DB, `pdf_engine_unavailable` — et poser `minRetryUid` comme le fait le deferred HITL) + **I6** (commit conditionnel `where last_uid_seen < :new`). Attention : C3 s'appuie sur les claims (2) pour ne pas renvoyer de mails aux re-traitements.
4. **C4** (uploader le binaire CV avant le return `pendingScoringSheet` ; le rescoring C7 peut rester au backlog, mais le fichier doit exister) et **C11** (journaliser `imap_no_campaign_match` quand une PJ CV est présente).
5. **I1** (re-tenter `send_failed` via le même mécanisme `minRetryUid` ; ne pas mettre le brief en file sur `send_failed`/`skipped`) et **I2** (`console.error` dans les catch d'audit, a minima).
- Déploiement : dev avec une boîte de test + `POST /api/imap/poll-now` ; simuler les pannes (clé OpenAI invalide, Supabase URL cassée) et vérifier que le curseur **ne bouge pas**. Tests vitest sur la classification transitoire/permanent (fonctions pures).
- *Risque si non fait : chaque incident transitoire du pilote consomme des candidatures réelles sans trace.*

### Lot 3 — Idempotence des chemins humains (C6, I8, I9, I11 partiel)
1. **C6** : transition d'état conditionnelle en base **avant** l'envoi (`status='sending' where status='pending'`, un seul gagnant), et finalisation idempotente. Migration additive (valeur d'enum/CHECK à étendre en douceur : colonne text avec CHECK à recréer — faire en deux temps `drop constraint` + `add constraint`).
2. **I9** : inverser invitation vivier (réserver `contacted` d'abord, envoyer ensuite, release si échec dur) + chunker les envois en masse (PERF-10, même fichier).
3. **I8** : index unique partiel `(campaign_id, lower(candidate_email)) where status='awaiting_booking'` + upsert. Migration : dédupliquer les doublons existants **avant** de poser l'index (requête de repérage à écrire, `keep newest`).
4. **I11** : tester `res.ok` + surfacer l'échec dans les 4 catch avaleurs listés.
- *Risque si non fait : doubles mails client-facing, et le scénario « invitation + refus au même candidat ».*

### Lot 4 — Sync client et vérité UI (C7, I12)
Répliquer le pattern `sync-status`/bannière des campagnes (déjà écrit, déjà validé) sur tasks, artifacts, settings. Pas de migration. Test : couper le réseau au moment du save et vérifier la bannière + le retry.

### Lot 5 — Reporting exact et index (C10, I15, I16, I19)
1. Charger les analyses **par campagne clôturée** (ou `listAllCandidateAnalyses` filtré) dans les deux loaders de rapport ; remplacer `journey-lookup` limit 500 par `listJournalEntriesByActions` (le pattern existe dans `stage-signals.ts`).
2. Poser les index (`journal(action, created_at)`, `candidate_analyses(received_at)`, trgm email) — migration additive pure, `create index concurrently` en prod.
3. Trancher I19 : documenter que `zone-counts` (tables) fait foi pour le bureau et migrer `derive-metrics` hors du journal au rythme de la refonte Dashboard déjà prévue.
- Test de non-régression : générer le rapport d'une campagne connue avant/après et comparer les volumes au count SQL direct.

### Lot 6 — Robustesse IA et coûts (I10, I17, I3, I5)
1. Statut `indexed_partial` (ou critère `--only-failed` élargi) pour les dossiers sans embedding + backoff 429 centralisé dans `provider.ts`/`embeddings.ts` (supprimer la duplication du script d'import ensuite, pas avant).
2. Batch d'embeddings + cache `embedJobSkills` par hash de `key_skills`.
3. I3/I5 (claim par `(mailbox, uid)` en tête de traitement + ids d'artefacts déterministes) — après le Lot 2 qui pose l'infrastructure TTL.

### Lot 7 — Sécurité de fond (I4, I13 `/admin`, I14, puis 🟡)
uid → corrélation par `id` (I4, migration de données délicate : à faire quand le volume IMAP est faible, script de backfill des uid préfixés) ; rôles pour `/admin` ; délimiteurs anti-injection dans les prompts CV ; TTL du lien CV à quelques jours ; puis la liste 🟡 au fil de l'eau (chaque item est indépendant et à faible risque).

---

**Rappel final : aucune modification de code n'a été effectuée dans le cadre de cet audit.** Toute correction ci-dessus est une proposition, à décider et à traiter séparément, une par une.
