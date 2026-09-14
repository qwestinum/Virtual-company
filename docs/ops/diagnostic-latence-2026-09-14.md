# Diagnostic de latence — 14/09/2026

> **Phase 1** (mesure, ci-dessous) puis **Phase 2** (corrections, en fin de document).
> L'instrumentation `PERF_TRACE` utilisée pour la mesure a été **retirée** à la fin du
> diagnostic : elle n'est pas versionnée.
>
> **Règle issue du diagnostic : fonctions Vercel en `cdg1` — obligation DPA, ne jamais
> laisser Vercel choisir la région.**

## 0. Méthode et limites

- **Instrumentation** (temporaire, retirée depuis ; `src/lib/perf/request-trace.ts`, branchée dans `src/instrumentation.ts`
  + 2 lignes dans `src/proxy.ts`) : par requête entrante, durée totale, durée du proxy,
  nombre/durée des appels Auth, base (PostgREST/RPC), Storage, LLM, email, Exa, avec la
  chronologie de chaque appel (ce qui permet de compter les **étapes séquentielles**).
  Sortie : ligne JSON `[perf]` + en-tête `Server-Timing`. `PERF_NO_SCHEDULER=1` évite
  une seconde relève IMAP quand le serveur de mesure tourne à côté du serveur de dev.
- **Banc** : build de production local (`next start`), base **DEV** (eu-west-1), session
  admin de test. Les navigateurs pilotables n'ayant pas démarré, chaque surface a été
  **rejouée par script** avec exactement les requêtes que le code client déclenche
  (cartographie §3), 1 passage froid + 5 chauds.
- **Prod** (lecture seule) : région d'exécution Vercel via `x-vercel-id`, statistiques
  `pg_stat_statements` / `pg_stat_user_tables` / index / palier via l'API d'administration
  Supabase (catalogue uniquement, aucune ligne métier).
- **Non mesuré** : le temps d'un aller-retour base **depuis une fonction Vercel** (il
  faudrait déployer l'instrumentation sur l'instance démo) et les logs de démarrage à froid
  Vercel. Les chiffres « prod » du §1 sont donc des **projections** : étapes séquentielles
  mesurées × RTT transatlantique typique iad1↔Paris (~90 ms). Le RTT local mesuré vers
  eu-west-1 est de 50–60 ms par appel.

## 1. Page → durée → décomposition → cause principale

Temps perçu = de la première à la dernière requête de la surface (médiane de 5 passages chauds).

| Surface | Local chaud (froid) | Requêtes | Décomposition de la route dominante | Cause principale | Projection prod |
|---|---|---|---|---|---|
| **Entretiens** | **1 692 ms** (1 851) | 2 | `/api/interviews` 1 748 ms : proxy 94 (auth) · auth route 50 · **base 1 566 (39 appels, 29 étapes séquentielles)** · calcul 30 | Cascade séquentielle : boucle campagne par campagne (liens puis RDV) + 2 requêtes **par RDV** (`sched_targets`, `sched_resources`) | ~2,6 s serveur + froid + réseau navigateur↔iad1 ⇒ **3–5 s** |
| **Bureau** | **806 ms** (1 074) | 2, **toutes les 5 s** | `/api/metrics/global` 817 ms : auth 130 (**2 appels en série**) · base 658 (14 appels, **9 étapes**) · calcul 30 | 8 chargements indépendants enchaînés ; 2 fenêtres journal (500 + 897 lignes) ; `listPendingValidations` ×2 | ~0,8–1 s par poll + démarrages à froid lourds (bundle 48 Mo) |
| **Campagnes** | **714 ms** (834) | 2, **toutes les 5 s** | idem Bureau (`/api/metrics/global`, nouvelle instance du hook ⇒ refetch immédiat) | idem Bureau | idem |
| **Validations** (onglet) | 429 ms (416) | 3 + N artefacts | `/api/notifications/business` 342 ms (22 appels, 3 étapes, 2 auth) ; `/api/validations` 232 ms (4 étapes) puis `/api/artifacts` ×campagnes **chaînés** | Signaux métier (dupliqués) + chaîne validations → artefacts | ~0,5–0,8 s |
| **Candidatures** | 328 ms (377) | **5** (double fetch au montage) | `/api/candidatures` 266–294 ms : base 196 (4 étapes) · **2ᵉ auth à la fin** (`loadReferentContext`) | Montage en deux temps (filtres vides puis campagnes actives) ; signaux + auth en série | ~0,4–0,6 s ; polling 25 s |
| **Shell** `/rh/recrutement` (tout montage) | 616 ms (816) | **25** | 20 × `/api/artifacts` (1 par campagne/tâche, chacune avec son auth proxy), badges, signaux | Éventail de requêtes rejoué à chaque montage | 25 invocations de fonction, chacune avec sa vérification de session |

Référence : `/rh/recrutement` (HTML) 68 ms, `/api/campaigns` 147 ms, `/api/tasks` 132 ms, compteurs 130 ms.

## 2. Top 5 des causes, par contribution totale

1. **Régions désalignées : fonctions Vercel en `iad1` (Washington), base prod en `eu-west-3` (Paris).**
   > **Statut (14/09/2026, fin de journée)** : fonctions passées en `cdg1` par le donneur d'ordre.
   > **Prod vérifiée** : `x-vercel-id: cdg1::cdg1::…` (TTFB `/login` à chaud 107–147 ms, contre
   > 178–257 ms en `iad1`). **Dev et démo : NON vérifiés** (URL absentes du dépôt) — tant qu'un
   > `x-vercel-id` n'y montre pas `cdg1::cdg1`, ce point reste ouvert pour ces deux instances.
   Mesuré : `x-vercel-id: cdg1::iad1::…` sur une page rendue ; `vercel.json` vide (région par défaut).
   Chaque aller-retour base ou auth traverse l'Atlantique, deux fois. C'est un **multiplicateur de
   toutes les autres causes** : latence d'une route ≈ étapes séquentielles × RTT. Le proxy, lui,
   s'exécute en `cdg1`. Gain attendu en alignant sur `cdg1` : ~90 → ~5–10 ms par appel (à confirmer
   par une mesure depuis une fonction).
2. **Cascade séquentielle de `/api/interviews`** (29 étapes pour 39 appels). `loadInterviewPipeline`
   (`src/lib/interviews/pipeline.ts:158-177`) parcourt les campagnes natives **une par une**, et
   `listLinksForTarget` puis `listBookings` s'enchaînent ; `listBookings` hydrate chaque RDV avec 2
   requêtes (`scheduling/bookings.ts:473` → `events.ts:209`) ; `listOrphanTargets` enchaîne 3 lectures
   exhaustives indépendantes. Le coût croît avec campagnes natives × RDV.
3. **`/api/metrics/global`, sondé toutes les 5 s par Bureau ET Campagnes.** 9 étapes alors que 7
   chargements sont indépendants ; `listPendingValidations` chargé deux fois (route + `zoneDistribution`) ;
   `fetchCandidateTotalRows` relit tout le journal de 8 actions (897 lignes en dev, croissance sans
   borne) ; fenêtre brute de 500 lignes servant seulement de repli. Le timer ne s'arrête pas quand
   l'onglet est masqué. **Bundle de 48 Mo** (dont 33 Mo `@napi-rs/canvas`) entraîné par l'import de
   `ensureSchedulerStarted` (no-op sur Vercel) ⇒ démarrages à froid les plus lourds sur la route la
   plus sollicitée. Effet collatéral mesuré : **2,0 millions d'appels PostgREST** cumulés en prod.
4. **Double vérification de session.** Le proxy appelle `auth.getUser()` puis la route rappelle
   `getApiUser()` → second `auth.getUser()` (aller-retour Auth), **en série au début** sur
   `/api/interviews`, `/api/metrics/global`, `/api/notifications/business`, `/api/recruiters/options`,
   et en fin de route via `loadReferentContext` (validations, candidatures). Coût local 50–60 ms ;
   en prod, depuis iad1, ~150–200 ms par route.
5. **Rechargements côté client sans nécessité.** À chaque montage du workspace : 20 × `/api/artifacts`
   (une requête par campagne/tâche, sans garde, `artifacts-sync.ts:104,143`) ; `/api/notifications/business`
   (22 appels base) à **chaque changement d'onglet** ; Candidatures monte deux fois (4 requêtes + signaux) ;
   `/api/validations` chargé deux fois dans l'onglet (badge + hub) et ses artefacts rechargés. Aucun
   cache client (ni SWR ni store) hormis campagnes/tâches.

**Ce qui n'est PAS une cause** : l'exécution SQL. Prod : 403 requêtes applicatives distinctes, **0,42 ms
d'exécution moyenne**, aucune requête applicative > 200 ms (la seule > 200 ms est `pg_timezone_names`,
émise par le tableau de bord Supabase). Volumes minuscules (journal 2 408, candidate_analyses 169,
pending_validations 157, interview_briefs 14, sched_bookings 4). Palier **Micro** (2 vCPU partagés,
1 Go) suffisant à ce volume.

## 3. Détails par point de la demande

**Points 1-2 (instrumentation, cartographie).** Cartographie client exhaustive des appels :
aucun SWR/React Query, tout en `useEffect` + `cache: 'no-store'`. Les onglets sont **démontés** au
changement (`WorkspacePane.tsx:172-230`) ⇒ tout est refetché. Polling : `/api/metrics/global` 5 s
(Bureau, Campagnes), candidatures + compteurs 25 s + `focus` + `visibilitychange` (double rafraîchissement
au retour sur la fenêtre). `/api/interviews` déclenche en plus, après la réponse, `after(drainSchedulingEvents)`,
qui fait un DELETE (`sched_rate_limits`), et potentiellement un téléchargement de CV, un appel LLM et des
envois d'email : pas de latence perçue, mais l'instance reste occupée.

**Point 3 (séquentiel vs parallèle), gains théoriques en étapes :**

| Route | Étapes mesurées | Atteignables sans changer le résultat | Détail |
|---|---|---|---|
| `/api/interviews` | 29 | ~4 | auth ∥ briefs ; campagnes natives en parallèle ; liens ∥ RDV ; hydratation RDV groupée ; `activeResourceIds` ∥ `countActiveLinksByTarget` |
| `/api/metrics/global` | 9 | ~3 | auth puis tout le reste en parallèle ; réutiliser `listPendingValidations` ; chunks de `countPendingMatched` en parallèle |
| `/api/candidatures` | 4 | 2 | `loadStageSignals` ∥ page ; `listRecruiters` + auth dès t0 |
| `/api/validations` | 4 | 2 | chunks d'analyses ∥ `loadReferentContext` |
| `/api/notifications/business` | 3 | 2 | auth ∥ signaux S1-S3/S6-S7 ; `loadStageSignals` chargé 2× (S2, S3), `getResource` + règles 2× (S4, S5), `listLiveJobPostings` 2× (S6, S7) |
| `/api/recruiters/options` | 4–5 | ~2 | tous indépendants |

**Point 4 (régions).** Dev base eu-west-1 ; prod base eu-west-3 ; fonctions prod `iad1` (mesuré) ;
proxy `cdg1`. RTT base mesuré depuis le poste : 50–60 ms (eu-west-1). Depuis une fonction : non mesuré
(nécessite un déploiement instrumenté). L'instance démo n'a pas pu être identifiée : son URL n'est dans
aucun fichier du dépôt.

**Point 5 (proxy).** `getUserFromMiddleware` = 1 aller-retour Supabase Auth par requête (48–107 ms en
local, plus quand 20 requêtes arrivent ensemble). Montage du workspace : **25 requêtes le paient** ;
un changement d'onglet : 2 à 5.

**Point 6 (base).** Voir « Ce qui n'est pas une cause ». Index : `journal` n'a pas d'index sur `action`
alors que les lectures ciblées filtrent `action = ANY(…)` (prod : 24 409 seq scans, 38,7 M tuples lus ;
2,1 ms aujourd'hui ⇒ dette de croissance, pas cause actuelle). `candidate_analyses` : 179 675 seq scans
(table de 169 lignes, le planificateur a raison). `interview_briefs`, `pending_validations`, `sched_*`
indexés sur les colonnes filtrées.

**Point 7 (démarrages à froid).** Premier `/login` en prod : TTFB 1 253 ms, puis 178–257 ms (mesuré de
l'extérieur). Tailles tracées : `/api/metrics/global` 48,1 Mo · `/rh/recrutement` 3,9 Mo ·
`/api/interviews` 3,2 Mo · `/api/notifications/business` 3,2 Mo · `/api/validations` 2,2 Mo.
Fréquence : non mesurée (logs Vercel non accessibles).

**Point 8 (chargements exhaustifs rejoués).** `/api/artifacts` ×(campagnes + tâches) à chaque montage ;
`listRecruiters` (table entière) dans `/api/interviews`, `/api/validations`, `/api/candidatures`,
`/api/recruiters/options` ; `listCampaigns` (`select *`, sans `.range()`) à chaque poll du Bureau ;
`app_settings` à chaque rendu de `/rh/recrutement` (si flags sourcing) ; `loadStageSignals` (journal des
marqueurs + validations + briefs) dans candidatures, compteurs, entretiens et **deux fois** dans les
signaux métier, rejoué à chaque changement d'onglet.

## 4. Pièces

Traces brutes et scripts (scratchpad de session, non versionnés) : `perf.jsonl`, `bench.jsonl`,
`db-stats-*.json`, `bench.mjs`, `probe-vercel.mjs`, `db-stats.mjs`.

---

# Phase 2 — corrections sans changement de comportement (14/09/2026)

**Régions : traitées hors code par le donneur d'ordre** (fonctions en `cdg1` sur dev, démo et
prod) — voir « Régions — obligation DPA » en fin de document. Les mesures ci-dessous ne
l'incluent PAS : elles isolent le gain du code.

## Ce qui a été changé

| # | Correction | Fichiers |
|---|---|---|
| 1 | **Entretiens** : campagnes natives lues en parallèle (liens ∥ rendez-vous), résultats appliqués dans l'ordre d'origine ; campagnes des briefings lues dès la 2ᵉ étape, les orphelines seulement si inconnues ; session vérifiée en parallèle de la lecture | `lib/interviews/pipeline.ts`, `api/interviews/route.ts` |
| 2 | **Réservation** : hydratation des rendez-vous GROUPÉE (2 lectures `in(id)` au lieu de 2 par rendez-vous, même repli) ; `listOrphanTargets` : 3 lectures indépendantes en parallèle ; `listBookings` : les deux références résolues ensemble | `lib/scheduling/{events,bookings,targets}.ts` (frontière du module intacte) |
| 3 | **Bureau / Campagnes** (`/api/metrics/global`) : toutes les lectures démarrent ensemble ; la file HITL n'est plus relue par `zoneDistribution` ; tranches de `countPendingMatched` en parallèle | `api/metrics/global/route.ts`, `lib/dashboard/zone-counts.ts` |
| 4 | **Signaux métier** : lectures partagées le temps d'UN calcul (`createSharedLoads` — signaux d'étape S2/S3, ressource+règles S4/S5, offres S6/S7) ; seuls les signaux PERSONNELS attendent la session ; S1 et tranches en parallèle | `lib/notifications/business-signals.ts`, route |
| 5 | **Validations / Candidatures** : recruteurs + session démarrés dès l'entrée (`prepareReferentContext`), zones en parallèle du référent, signaux ∥ page | `lib/referent/context.ts`, routes |
| 6 | **Options recruteurs** : trois lectures indépendantes en parallèle | `api/recruiters/options/route.ts` |
| 7 | **Artefacts** : lecture GROUPÉE `GET /api/artifacts?campaign_ids=…&task_ids=…` (keyset sur la PK, lots de 100 — jamais tronquée), utilisée au montage du workspace et par la file des validations. Même fraîcheur qu'avant (toujours rechargée au montage) | `lib/db/repos/artifacts.ts`, `api/artifacts/route.ts`, `lib/db/sync/artifacts-sync.ts`, `HydrationGate.tsx`, `use-validations-queue.ts` |
| 8 | `listCampaignSummaries` : tranches en parallèle, appliquées dans l'ordre | `lib/db/repos/campaigns.ts` |

**Délibérément NON changé**
- **Signaux métier rechargés à chaque changement d'onglet** : c'est le mécanisme documenté
  d'extinction des badges après une action ; un cache les ferait mentir. On a accéléré la
  route plutôt que de la mettre en cache.
- **Cache 30-60 s des référentiels** : non nécessaire après parallélisation (recruteurs,
  session et campagnes ne sont plus sur le chemin séquentiel), et un cache par instance
  serverless ne se partage pas entre invocations.
- **Import du scheduler dans `/api/metrics/global`** (bundle 48 Mo) : `@napi-rs/canvas` est
  déjà chargé à la demande (`cv-extract.ts`), le coût est la taille du paquet et non le
  chargement ; retirer l'import casserait le remplacement du minuteur IMAP après
  recompilation en dev (défaut du 17/08).
- **Double vérification de session proxy + route** : la seconde ne s'appuie plus en série
  sur le chemin critique (elle part en parallèle) ; la supprimer demanderait de faire
  confiance à un en-tête posé par le proxy. Écarté. Ce raisonnement a mis au jour un trou
  du `matcher` (chemins `/api/…` finissant par `.png|.jpg|…` qui n'atteignaient pas le
  proxy, route exécutée sans session) — corrigé à part, branche
  `fix/proxy-static-extension`.
- **Index `journal(action)`** : 2,1 ms aujourd'hui, pas une cause — dette de croissance.

## Mesures avant / après

Build de production local, base DEV, 1 passage froid + 6 alternances **entrelacées**
avant/après (mêmes conditions réseau). Temps perçu par surface, médiane :

| Surface | Avant | Après | Requêtes |
|---|---|---|---|
| **Entretiens** | 1 801 ms | **483 ms** (−73 %) | 2 → 2 |
| **Bureau** (poll 5 s) | 706 ms | **425 ms** (−40 %) | 2 → 2 |
| **Campagnes** (poll 5 s) | 759 ms | **358 ms** (−53 %) | 2 → 2 |
| **Workspace** (montage) | 636 ms | **453 ms** (−29 %) | **25 → 7** |
| Validations | 446 ms | 404 ms | 3 → 3 (+ artefacts groupés) |
| Candidatures | 487 ms | 491 ms | 5 → 5 (étapes 4 → 3, gain noyé dans la variance réseau) |

Par route (médiane serveur, étapes séquentielles) :

| Route | Avant | Après |
|---|---|---|
| `/api/interviews` | 1 748 ms · 29 étapes | **473 ms · 4 étapes** |
| `/api/metrics/global` | 817 ms · 9 étapes | **324 ms · 2 étapes** |
| `/api/notifications/business` | 342 ms · 3 étapes · 22 appels | 325 ms · 2 étapes · 17 appels |
| `/api/validations` | 232 ms · 4 étapes | 225 ms · 2 étapes |
| artefacts au montage | 20 requêtes × 164 ms | 1 requête · 114 ms |

**Projection prod** (étapes × RTT transatlantique ~90 ms, estimation) : Entretiens
~2,6 s → ~0,4 s de base côté serveur ; Bureau ~0,8 s → ~0,2 s par poll.

## Non-régression

- **Réponses identiques** avant/après sur la même base, requêtes simultanées :
  `/api/interviews`, `/api/metrics/global`, `/api/notifications/business`,
  `/api/validations` (+ `?status=sent`), `/api/candidatures` (3 variantes dont filtre
  d'étape), `/api/candidatures/counters`, `/api/recruiters/options` ; **316 artefacts**
  lus unitairement = lecture groupée.
- Suite unitaire verte (+ tests : lecture groupée d'artefacts, lectures partagées des
  signaux) : 247 fichiers, 2 416 tests + nouveaux.
- **Suite de régression S1–S23 verte** (24 fichiers, 200 tests, routes réelles sur DEV).
- Instrumentation retirée ; aucune route ne porte de code de mesure.

## Régions — obligation DPA

**Fonctions en `cdg1` — obligation DPA, ne jamais laisser Vercel choisir la région.**

Constat de départ, mesuré : `x-vercel-id: cdg1::iad1` — les fonctions qui traitent CV, noms
et adresses tournaient à Washington (région par défaut de Vercel, `vercel.json` vide), la
base étant à Paris. La donnée était traitée hors UE à chaque requête, et chaque aller-retour
base traversait l'Atlantique (cause n°1 de la latence, multiplicateur de toutes les autres).

Correction : régions des fonctions positionnées sur `cdg1` (Paris) par le donneur d'ordre
sur dev, démo et prod. Vérification : l'en-tête `x-vercel-id` d'une page rendue doit se lire
`cdg1::cdg1::…` (le 2ᵉ segment est la région de la fonction).

| Instance | État au 14/09/2026 |
|---|---|
| Prod (`orqa-bia-prod.vercel.app`) | ✅ `cdg1::cdg1` vérifié |
| Démo | ⚠️ non vérifié (URL non connue du dépôt) |
| Dev | ⚠️ non vérifié (URL non connue du dépôt) |
