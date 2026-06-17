# Virtual Enterprise — QWESTINUM

## Projet

Prototype d'entreprise virtuelle où des agents IA jouent les rôles d'une équipe RH. Le donneur d'ordre dialogue avec un Manager RH virtuel qui est à la fois son **point de contact unique (SPOC)** et l'**orchestrateur** de l'équipe d'agents spécialisés (Job Writer, Publisher, CV Analyzer, Scheduler, Rejection Writer) qu'il dispatche et coordonne. Il n'y a pas d'agent Orchestrateur séparé.

Le MVP couvre le département RH avec deux modalités de travail : **campagnes complètes de recrutement** (cycle R1 à R6) et **sollicitations hors campagne** (livrables atomiques). Le donneur d'ordre interagit par deux canaux : **conversation avec le Manager** et **actions directes via l'interface** (toggles, sliders, clics).

**Positionnement QWESTINUM** : Process First — l'IA appliquée à des processus métier réels. Le projet sert à démontrer le concept à des clients en cabinet de conseil. La mimétique avec le fonctionnement d'une vraie équipe RH est le différenciateur principal face à la concurrence (Limova).

## Spécification fonctionnelle de référence

**`docs/specs/entreprise-virtuelle-rh.md`** est la source de vérité fonctionnelle. Tout comportement métier (rôles des agents, rituels, validations, artefacts, actions directes, escalades) y est défini. Claude Code consulte ce document avant toute décision de design fonctionnel.

**Brief de la session courante** : voir `docs/sessions/SESSION_3.md` pour le périmètre exact de ce qui doit être implémenté maintenant et ce qui ne doit pas l'être.

## Stack

- **Framework** : Next.js 16 (App Router, TypeScript strict)
- **UI** : Tailwind CSS + shadcn/ui
- **State** : Zustand (store unique pour MVP)
- **AI** : OpenAI API (GPT-4o pour les agents, Whisper pour la transcription voix)
- **Storage hybride (à partir de la Session 5)** : Supabase pour les données opérationnelles (tables, métriques, journal, RLS), Google Drive pour les artefacts visibles client (FDP, annonces, bilans) — voir §5.2 de la spec.
- **Communication temps réel (à partir de la Session 7)** : Supabase Realtime
- **Migration future post-MVP** : n8n + Supabase comme cerveau externe (non implémenté actuellement)
- **Déploiement** : VPS Hostinger (Session 8)

## Décisions architecturales déjà prises

- **Pas de 3D.** La scène 3D a été abandonnée en Session 2 au profit d'une interface 2D Notion/Linear avec cartes d'agents, lignes de flux SVG, panneau détail. Fond sand. Avatars PNG placeholder avec initiales.
- **MVP = Next.js seul.** Pour le MVP actuel, types, store, agents, UI tournent dans Next.js. Pas de n8n, pas de microservice externe, pas d'event bus distribué. Communication agents = appels de fonction côté client + état dans Zustand.
- **Storage différé.** En Session 3, les fonctions d'accès au storage (`searchExistingJobDescriptions`, etc.) existent mais retournent des valeurs vides ou mockées. Implémentation réelle hybride Supabase + Drive en Session 5.
- **Pas d'auth utilisateur dans le MVP.** Le système est mono-utilisateur (le donneur d'ordre = la personne devant l'écran).
- **Gestion de campagne = onglet « Campagnes ».** La gestion de campagne (liste, création, édition, actions de cycle de vie suspendre/arrêter/reprendre) vit dans l'onglet **Campagnes** du `WorkspacePane` (workspace `/rh/recrutement`), hébergée par `src/components/campagnes/CampaignsWorkspace.tsx` ; les composants sont sous `src/components/campagnes/` (`edit/`, `edit/draft/`). Les primitives partagées (`StatusPill`, `AnimatedCounter`, `tokens`) restent sous `src/components/dashboard/`. Le **Dashboard** (`DashboardView`) est désormais une vue résiduelle (KPIs, candidats, activité, agents), en attente d'une refonte décisionnelle. Pas de route `/campagnes` séparée : la navigation reste homogène via les onglets du workspace.

- **Cycle de vie persisté + création hors chat.** La machine d'états du cycle de vie (`src/types/campaign-lifecycle.ts`, phases `fdp → scoring → intake → announcement → publication`, obligatoires vs optionnelles `postponed`) est **persistée** en base (colonne `campaigns.lifecycle jsonb`, nullable) : `rowToCampaign` lit le lifecycle stocké comme `prev` de `reconcileLifecycle` (machine autoritaire, phases obligatoires réconciliées sur leurs artefacts), `campaignToRow` l'écrit, la route `PUT /api/campaigns` l'accepte. Repli legacy (lignes sans colonne) : reconstruction du `postponed` des optionnelles d'une campagne `active`. Modèle fonctionnel : cf. mémoire `project_campaign_lifecycle`. La **création hors chat** (`edit/CampaignCreateSheet.tsx`, sections pliables `CollapsibleSection`) suit deux invariants UI : (1) **« Enregistrer » par section** confirme+replie+ouvre la suivante (ne persiste rien — seul « Créer la campagne » écrit en base) ; (2) le **nom de campagne suit le champ `job_title` de la FDP** (source de vérité unique, `deriveCampaignName`), et un préremplissage par campagne comparable propose **toujours « Repartir à zéro »** (parité chat Manager). Logique extraite en helpers purs testés (`nextOpenSection`, `deriveCampaignName`, `parseListInputRaw`/`normalizeListInput`). Les éditeurs de listes (missions/compétences) conservent le **texte brut à la frappe** (normalisation au blur) pour ne pas déplacer le curseur.

- **Réception des CV par email (poller IMAP).** Pour qu'une candidature reçue par mail soit traitée (`src/lib/imap/poller.ts`, scheduler 30 s au boot via `instrumentation.ts`), **3 conditions cumulatives** : (1) la **boîte est associée à la campagne** (`associateMailbox`, via le flux « email » de la campagne) — sinon skip **silencieux, sans journal** ; (2) la campagne est **`active`** (le chemin email filtre `status==='active'` ; l'upload chat ne l'exige pas) — sinon `imap_match_inactive_campaign` ; (3) **sujet contenant `CAMP-XXXX` + PJ PDF** (sans fiche de scoring validée → `imap_cv_received` `pendingScoringSheet:true`, reçu non analysé). `last_uid_seen` avance même sur les non-matchés ⇒ corriger l'association après coup ne rejoue pas un mail déjà lu, il faut le **renvoyer**. Diagnostic : `GET /api/imap/status`, `GET /api/imap/debug/<mailboxId>?force=1`, `POST /api/imap/poll-now`. Cf. mémoire `project_email_intake_requirements`.

## Règles absolues

- **TypeScript strict, jamais de `any`.** Si un type est complexe, on le définit dans `src/types/`.
- **Chaque agent implémente le contrat `AgentContract`** défini dans `src/types/agent.ts`. La prise d'acte des actions UI fait partie du contrat du Manager (voir spec §4.1).
- **Chaque composant React = un fichier, max 200 lignes.** Au-delà, on découpe.
- **Tous les appels AI passent par `src/lib/ai/provider.ts`**, jamais directement à OpenAI. Cela centralise les retries, le logging, et la mesure des coûts.
- **Les clés API sont dans `.env.local`**, jamais hardcodées, jamais commitées.
- **Tests vitest avant commit.** Le projet a déjà 42 tests verts en Session 1 — on ne régresse pas.
- **`npm run typecheck` avant chaque commit important.** Le typecheck du projet a `incremental: true` : un `.tsbuildinfo` périmé peut produire des **faux négatifs** (erreurs de type masquées par le cache). `npm run typecheck` force `tsc --noEmit --incremental false` et donne l'état réel. Le typecheck incrémental (`tsc --noEmit`) reste pour le dev local en boucle rapide.
- **Commits conventionnels** : `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.

## Architecture agents

- Chaque agent = `{ id, name, role, skills[], inputs[], outputs[], trigger, humanValidation, individualToggle }`
- Le **Manager RH** est le seul interlocuteur du donneur d'ordre (SPOC) **et** l'orchestrateur de l'équipe : il classe l'intention, fait la pré-recherche, collecte progressivement, prend acte des actions UI, **et** dispatche aux agents exécutants en gérant les dépendances. Il n'y a pas d'agent Orchestrateur séparé — l'orchestration est une responsabilité du Manager, déterministe et pilotée par le code (machine d'états du cycle de vie), jamais par le LLM.
- Les agents communiquent via **appels de fonction internes** dans le MVP. Les hooks Zustand exposent l'état nécessaire à chaque agent.
- Chaque exécution d'agent produit des **métriques** (durée, tokens, coût, statut, queue depth) — le contrat `AgentMetrics` est défini dans `src/types/agent.ts`.
- Chaque agent expose un **toggle d'activation individuel** et un **toggle de validation humaine indépendant** — voir spec §6.3 (actions directes UI).

## Pré-recherche du Manager — contrat à respecter dès la Session 3

Le Manager doit **toujours** appeler `searchExistingJobDescriptions(query)` avant de lancer la collecte des champs manquants, même quand le storage est vide. Cela cristallise le contrat d'interface dès maintenant pour que l'implémentation réelle (Session 5) ne nécessite aucun changement de code dans le Manager.

```typescript
// src/lib/storage/job-descriptions.ts (MVP Session 3)
export async function searchExistingJobDescriptions(query: string): Promise<JobDescription[]> {
  // MVP : retourne toujours [] tant que le storage n'est pas implémenté
  // Session 5 : interroge Supabase + Drive
  return [];
}
```

Trois niveaux progressifs (L1 récupération, L2 suggestion, L3 inspiration) — voir spec §4.1.

## Conventions de nommage

- **Composants React** : PascalCase (`AgentCard.tsx`, `ManagerChat.tsx`)
- **Fonctions/variables** : camelCase
- **Types/Interfaces** : PascalCase préfixé (`AgentContract`, `TaskInput`, `CampaignBrief`)
- **Fichiers utilitaires** : kebab-case (`ai-provider.ts`, `job-descriptions.ts`)
- **Identifiants métier** : `CAMP-XXXX` pour les campagnes, `TASK-XXXX` pour les sollicitations hors campagne (voir spec §3.2), `SITE-XXXX` pour les sites (`SITE-DEFAULT` = site par défaut), `DO-XXXX` pour les donneurs d'ordre

## Modèle de données — donneur d'ordre & site (préparation reporting)

Deux dimensions métier rattachées à une campagne, introduites comme pré-requis du module Reporting (source de vérité : `docs/specs/reporting.md` §2). Toute session future doit en tenir compte.

- **Donneur d'ordre** : la personne (interne à l'organisation **cliente**) qui a **initié** une campagne. **À ne pas confondre avec l'utilisateur ORQA** qui manipule l'interface. Une campagne a **au plus un** donneur d'ordre. Champs : nom (obligatoire), prénom, email pro, rôle/fonction (texte libre).
- **Site** : l'implantation géographique/organisationnelle de rattachement d'une campagne (orgs multi-sites). Une campagne a **au plus un** site. Un site **par défaut** (`SITE-DEFAULT`, seedé par `scripts/migrate.sql`) sert les organisations mono-site. Champs : nom (obligatoire), type/catégorie, ville, code postal.

Implémentation : types `src/types/organisation.ts` ; rows + colonnes `campaigns.site_id` / `campaigns.donneur_ordre_id` (**nullable**, `on delete set null`) dans `src/lib/db/types.ts` + `scripts/migrate.sql` ; repos `src/lib/db/repos/{sites,donneurs-ordre}.ts` ; API `src/app/api/{sites,donneurs-ordre}` ; admin légère (CRUD + archivage soft) dans `/settings` (`SitesManager`, `DonneursOrdreManager`). Les deux liens campagne sont **nullable** (migration douce : vides pour les campagnes historiques, à remplir via l'admin ou — phase ultérieure — la capture conversationnelle au brief Temps 1).

**Rapport de campagne (Reporting Phase 2, livré).** Sous-onglet `Rapport de campagne` du `ReportingHub` (onglet interne, pas de route Next dédiée). Colonnes `campaigns.launched_at` / `closed_at` (**nullable**, posées par `patchCampaign` sur transition de statut ; repli `created_at` / `updated_at`). Logique **pure** dans `src/lib/reporting/campaign-report*.ts` (calcul + tri/filtre + libellés), template PDF `campaign-report-pdf.tsx` sur charte partagée `pdf-theme.ts`. **Cache PDF stable** en Supabase Storage (`uploadArtifactBinary`/`downloadArtifact`), traçabilité génération/envoi via le **journal** (`campaign_report_generated` / `campaign_report_sent`). Proxies documentés (canal = réception, time-to-hire = lancement→clôture, recos par règles) — cf. `docs/specs/reporting.md` §3.7.

**Rapport multi-campagnes (Reporting Phase 3, livré).** Sous-onglet `Rapport multi-campagnes` (onglet interne). **Période libre** (défaut « Ce mois »), filtres recherche/donneur/site, **aperçu réactif client-side** (fetch unique de `/reporting/campaigns`). **Génération à la volée, sans cache** (`Cache-Control: no-store`, date+heure en page 1). Primitives d'agrégation **mutualisées** dans `src/lib/reporting/aggregations.ts` (re-exportées par `campaign-report.ts` pour stabilité), chargement clôturées mutualisé `closed-campaigns-loader.ts`, projection `analysis-datum.ts`. Logique pure `multi-campaign-report.ts`, template `multi-campaign-report-pdf.tsx`, routes `/api/reporting/multi-campaigns/{report,send}`. `SearchableSelect` générique (base de `DonneurOrdreSelect` + `SiteSelect`). Traçabilité envoi = journal `multi_campaign_report_sent` (Option A, pas d'UI). Seuils des recos transverses + limitations (marque employeur ≈ taux de réponse) documentés — cf. `docs/specs/reporting.md` §4.8.

## Le Vivier de candidats (V1–V3 + refonte titre, livré)

Stock interne de CV indexés, réutilisable d'une campagne à l'autre comme **source** de candidats (jamais un canal de diffusion). Source de vérité fonctionnelle : `docs/specs/vivier.md` (§14 = état courant de la présélection ; §3.3/§4.2 décrivent l'ancienne cascade, **explicitement marquées « remplacées par §14 »**). Tout comportement métier s'y règle avant le code.

**Modèle de données (pgvector).** `vivier_candidates` (UUID PK, **dédup par email**, entités structurées en JSONB, `title` + `title_variants text[]` + `title_anchors jsonb` (ancres Bloc 1 : déclaré + 2 derniers postes)), `vivier_embeddings` (`title_embedding vector(1536)` — signal courant ; `embedding` full-CV **nullable, conservé mais plus régénéré**, `provider`/`model` nullable), `vivier_skill_embeddings` (1 ligne = 1 compétence : `skill` + `embedding vector(1536)` + `provider`/`model`, `unique(candidate_id, skill)`) + colonne `vivier_candidates.skills text[]`, `vivier_anchor_embeddings` (1 ligne = 1 ancre : `depth` + `anchor_text` + `embedding vector(1536)`, PK `(candidate_id, depth)` ; RPC `match_vivier_anchors`), `vivier_preselections` (PK `(campaign_id, candidate_id)`, porte `state` + faits datés `contacted_at`/`rejected_at`/`decided_by`/`applied_at` + `match_kind`/`match_term`). Migrations dans `scripts/migrate.sql` (idempotentes, l'utilisateur les applique **manuellement** dans Supabase). RPC : `match_vivier_titles`, `match_vivier_candidates` (legacy), `vivier_pending_by_campaign`.

**Indexation** (`src/lib/vivier/indexing.ts`, asynchrone, idempotente). Un appel LLM extrait **entités + TITRE + compétences + 2 derniers postes** (`entity-extraction.ts`) → upsert entités → variantes **iso-rôle** du titre par bloc (`runTitleVariantsSuggestion`, non bloquant) → `setVivierTitle` → **ancres de titre** (déclaré + 2 derniers postes, variantes par ancre, `setVivierTitleAnchors`) → embedding du **titre seul** → **un embedding par ANCRE** (`replaceAnchorEmbeddings` ; depth 0 réutilise le vecteur du titre) → **compétences atomiques + un embedding par compétence** (`setVivierSkills` + `replaceSkillEmbeddings`), tout non bloquant. On **n'embedde plus le CV entier**. Alimentation à deux portes : upload manuel (`/api/cv-analyzer` en `after()`) et poller IMAP (fire-and-forget), via `feedVivierFromApplication` — **non bloquant de bout en bout**, garde email obligatoire.

**Présélection sur le TITRE + COMPÉTENCES** (`src/lib/vivier/preselection.ts`). Cascade deux blocs (porte d'entrée = TITRE) : **Bloc 1 déterministe MULTI-ANCRES** (`title-anchors.ts` : ancres = {titre déclaré depth 0, dernier poste 1, poste précédent 2}, chacune splittée — `splitTitleIntoBlocks`, le tiret ne sépare QUE entouré d'espaces — + variantes iso-rôle ; match si UNE ancre ∩ {blocs intitulé + variantes poste}, on retient la plus RÉCENTE ; **décote d'ancienneté** `titleAnchorWeights` [1, 0.95, 0.9] ; repli sur le titre déclaré si `title_anchors` vide ; normalisation casse + **accents**) puis **Bloc 2 sémantique MULTI-ANCRES** (`anchor-semantic.ts` : cosinus de l'intitulé ⇄ embedding de CHAQUE ancre via RPC `match_vivier_anchors` ; `pickBestAnchor` : PORTE sur le cosinus BRUT `≥ similarityFloor`, SCORE = brut × décote `titleAnchorWeights` ; repêche un titre déclaré bruité via un poste propre ; repli `match_vivier_titles` sur le déclaré si pas d'ancre-embedding). **Score final = 70% titre + 30% compétences** (`vivierConfig.titleWeight`/`skillWeight`) : les **compétences réordonnent les qualifiés, n'en éliminent aucun**. **Tri global** décroissant, **pas de plafond**, fraîcheur en départage léger, **liste vide = réponse valide**. Variantes du poste via le générateur **iso-rôle** (`title-variants-execute.ts`). Garde-fou d'**espace d'embeddings** : modèle requête ≠ modèle indexé ⇒ échec FORT `embedding_model_mismatch`. Seuils dans `vivierConfig` (Settings, calibration) : `similarityFloor` (entrée titre, départ 0,55 — `npm run vivier:title-distribution`), `skillPerSkillFloor` (couverture par compétence, départ 0,6).

**Compétences set-to-set** (`skill-coverage.ts`, **pure** + testée). UN embedding **par compétence** des deux côtés (jamais moyenné : le barycentre dilue et l'asymétrie N vs M pénalise les spécialistes). Pour chaque compétence **attendue** de la fiche (`key_skills` atomisés, `job-skills.ts`, déterministe, embeddés à la volée), max cosinus sur les compétences du candidat ≥ seuil ⇒ **taux de couverture** + **mapping interprétable** (attente → compétence CV). Côté CV : champ `skills` extrait (hard + soft), stocké en `vivier_candidates.skills` + un vecteur par compétence dans `vivier_skill_embeddings`. V1 : poids égal (criticité = V2).

**Cycle factuel & contact (V3).** `vivier_preselections.state` = `identified → contacted | rejected` (transitions pures `proposal-cycle.ts`, cohérence état↔dates garantie en base par CHECK **et** dans la couche d'accès `markContacted`/`markRejected`). Réconciliation `replacePreselection` **idempotente et non destructive des décisions** (ne ressuscite ni ne supprime jamais un `contacted`/`rejected`). Validation **org-level** `/validations-vivier` (lien + badge `TopBanner`, pas un onglet campagne ; décisions unitaires + en masse, tracées au journal). Invitation à **candidater** (`invitation-template.ts`, déterministe, **mention RGPD systématique** partagée via `rgpd-mention.ts`) : `[référence]` = `CAMP-XXXX`, c'est elle que le poller cherche dans l'objet (`matchCampaignInSubject`) ; l'envoi pose `contacted` (best-effort). **Rapprochement par email** exact aux deux portes (`matchVivierApplication` → `recordApplied`, jamais de fuzzy). **Cooldown** : contacté ⇒ exclusion **globale** (`cooldownDays`) ; rejeté ⇒ exclusion **par campagne** ; sortie automatique à la candidature. Settings `vivierConfig` (jsonb : mode manuel/auto, template, cooldown, plafond, organisation, `similarityFloor`). Métrique de conversion dans le rapport de campagne.

**Scripts.** `npm run reindex:vivier` (régénère titres + variantes iso-rôle + embedding titre + **compétences + embeddings par compétence** ; **obligatoire après tout changement de modèle/représentation** ; avant reindex, skills=∅ ⇒ couverture 0, dégradation douce — `--only-failed`, `--dry-run`), `npm run vivier:title-distribution -- <campaignId>` (calibration du seuil). Changer `OPENAI_EMBEDDING_MODEL` ⇒ reindex **+ redémarrage serveur** (env figé au boot — réflexe `feedback_restart_dev_server`).

## Ce que Claude Code doit savoir

- **Le projet est un prototype client-facing.** Il doit être visuellement crédible en démo. L'effet wow compte autant que la fonctionnalité — un client doit voir « une équipe » au travail, pas un dashboard technique.
- **La mimétique entreprise réelle est le différenciateur.** Quand un comportement est ambigu, demande-toi : que ferait un responsable RH humain dans cette situation ? Si la réponse est « il ne ferait jamais ça comme ça », c'est que le design est à revoir.
- **Le Manager parle métier, jamais technique.** Pas de « tâche dispatchée », pas de « erreur 401 ». Même quand il orchestre en coulisse, côté donneur d'ordre cela se résume à « je m'en occupe, je reviens vers vous » et « la diffusion sur LinkedIn semble en panne, je publie sur les autres canaux en attendant ».
- **Une seule question à la fois** dans les phases de collecte. Jamais de rafale de questions, jamais de formulaire déguisé.
- **Priorité actuelle** : fonctionnel > beau > performant. C'est un prototype — le code doit être propre et lisible, pas optimisé prématurément.
- **Toujours respecter le périmètre de la session courante** (`SESSION_X.md`). La spec couvre tout, mais une session n'implémente qu'un sous-ensemble. Si une fonctionnalité hors session semble nécessaire, on l'ajoute au backlog plutôt qu'à la session en cours.

## Workflow de session

1. Lire `CLAUDE.md` (ce fichier)
2. Lire `docs/specs/entreprise-virtuelle-rh.md` (spec fonctionnelle)
3. Lire `docs/sessions/SESSION_X.md` (périmètre courant)
4. Implémenter strictement ce qui est dans le périmètre IN
5. Si une question relève du périmètre OUT, le signaler et reporter
6. Tester (vitest), commit conventionnel

## Concurrence et inspiration

**Limova** (concurrent identifié, contrat non signé) propose un SaaS RH classique où tout passe par chat IA. La différenciation QWESTINUM repose sur :

- La **mimétique organisationnelle** (équipe, pas chatbot)
- La **dualité chat / actions directes** (Limova force tout par chat — le donneur d'ordre clique sur ses propres outils)
- L'**option Drive** (le client voit ses livrables apparaître dans son Drive partagé — Limova garde tout en silo)
- Le **positionnement Process First** (cabinet de conseil, pas SaaS — le système s'adapte au processus client, pas l'inverse)

Ces différenciateurs doivent transparaître dans le code et l'UI.
