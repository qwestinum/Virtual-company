# Backlog — dette technique & améliorations différées

Items identifiés hors périmètre de la session courante, à traiter plus tard.
Format : titre, contexte, risque, piste de résolution.

---

## Délivrabilité email + traçage des envois

**Statut** : envois tracés (message-id en journal + endpoint statut), mais
délivrabilité dépendante d'une config DNS externe.

### Délivrabilité (config, hors code)
Domaine d'envoi `send.qwestinum.fr` côté Resend = `partially_failed` :
- DKIM + SPF **vérifiés** (l'envoi est correctement authentifié).
- **Receiving MX `failed`** — concerne la *réception* Resend, pas l'envoi.
- **Pas de DMARC** visible → Gmail/Yahoo classent volontiers en spam.
→ Action ops : poser un enregistrement DMARC, et vérifier que les boîtes
destinataires (extraites des CV) existent réellement. Un `status: sent` en
journal = accepté par Resend, PAS forcément délivré.

### Traçage (fait, à étendre)
`imap_outreach_mail` / `imap_outreach_brief` stockent désormais
`providerMessageId` ; statut de livraison via `GET /api/email/status?id=…`
(`delivered` / `bounced` / `sent`=spam probable).
À étendre :
- **UI dashboard** : bouton « vérifier la livraison » sur chaque ligne
  outreach de l'activité (appelle /api/email/status avec le providerMessageId).
- **Chemins chat** : `mail-composer` et `scheduler` envoient de vrais emails
  mais **ne journalisent pas** (artefact seulement) → invisibles au dashboard
  et non traçables. À câbler comme l'outreach IMAP.

---

## Actions journal `imap_cv_*` réutilisées pour les CV uploadés par chat

**Statut** : fonctionnel, naming trompeur.
**Code concerné** : `src/app/api/cv-analyzer/route.ts` (`journalChatCV`),
`src/lib/dashboard/derive-metrics.ts`.

Les CV analysés via le chat sont journalisés avec les actions `imap_cv_received`
et `imap_cv_analyzed` (préfixe `imap_`) pour être comptés au dashboard sans
réécrire la dérivation des métriques ni perdre l'historique Supabase. Le champ
`payload.source: 'chat'` distingue l'origine.

**Limite** : le préfixe `imap_` ment sur la source (upload chat ≠ email IMAP).

**Piste** : introduire des actions neutres (`cv_received` / `cv_analyzed`) et
faire lire à `derive-metrics` l'ancien ET le nouveau nom (compat historique),
puis migrer les écritures. Cosmétique tant que la distinction `source` suffit.

---

## Robustesse du parsing PDF (extraction CV) — à durcir avant prod VPS

**Statut** : fonctionnel, mais repose sur des hypothèses fragiles.
**Échéance cible** : avant le déploiement VPS Hostinger (Session 8).
**Code concerné** : `src/lib/agents/cv-extract.ts`, `next.config.ts`.

### Contexte

L'extraction de texte des CV PDF passe par `pdf-parse@2` → `pdfjs-dist@5`, qui
exige les globals navigateur `DOMMatrix` / `ImageData` / `Path2D`. On les
polyfille manuellement depuis `@napi-rs/canvas` (binaire natif) **avant** de
charger `pdf-parse`, parce que l'auto-polyfill de pdfjs
(`require("@napi-rs/canvas")` via `createRequire(import.meta.url)`) ne survit
pas à l'encapsulation « external module » de Next en build de production.

La solution actuelle marche (vérifiée en `next build && next start` : HTTP 200)
et **dégrade proprement** (message métier `pdf_engine_unavailable` si le moteur
est indisponible, pas de crash ni de fuite technique dans le chat).

### Fragilités résiduelles (par ordre d'importance)

1. **Binaire natif `@napi-rs/canvas` spécifique plateforme.** OK sur
   linux x64 glibc (binaire installé : `canvas-linux-x64-gnu`). Casse
   silencieusement si la cible est **Alpine/musl** ou **arm64**, ou si le
   déploiement fait `npm ci --omit=optional`, ou build sur une machine ≠
   exécution (Docker multi-stage). → PDF KO en prod (mais message dégradé).
   **À valider au premier déploiement VPS.**

2. **Liste de globals codée en dur** (`DOMMatrix/ImageData/Path2D`). Si une
   future version de pdfjs réclame un 4ᵉ global, la précondition passe mais le
   parsing lève un `ReferenceError` que le filet `isMissingPdfGlobalError` ne
   reconnaît pas → fuite technique dans le chat. Couplage de version implicite.

3. **Chemin du worker pdfjs en dur** (`process.cwd()/node_modules/pdfjs-dist/
   legacy/build/pdf.worker.mjs`). Suppose un `node_modules` classique sur
   disque. Casse potentiellement si on passe à `output: 'standalone'`
   (recommandé pour un VPS — pruning de `node_modules`).

### Pistes de résolution

- **Durcissements cheap (~15 min)** sans changer d'archi :
  - Élargir `isMissingPdfGlobalError` pour attraper tout `… is not defined`
    lié au moteur PDF (couvre #2).
  - Logguer un warning serveur explicite quand `@napi-rs/canvas` ne se charge
    pas (« binaire PDF manquant pour cette plateforme ») → diagnostic #1 immédiat.

- **Solution robuste définitive (~1 h)** : migrer vers **`unpdf`** (wrapper
  pdfjs conçu pour serverless/Node, sans canvas ni binaire natif). Élimine #1,
  #2 et #3 d'un coup. API d'extraction texte simple.

**Recommandation** : garder l'actuel pour le prototype ; faire les durcissements
cheap OU migrer vers `unpdf` avant la mise en prod VPS (Session 8).

---

## Convergence vers la machine d'états du cycle de vie (levier de stabilité #1)

**Statut** : moteur déterministe en place (`src/lib/campaign/lifecycle.ts`,
pur et testé), mais migration **inachevée** — trois représentations de la
progression coexistent et peuvent diverger.

**Contexte.** Le moteur devait remplacer deux représentations legacy :
- `recomputeStatus` (3 booléens) dans `src/stores/campaigns-store.ts:407` ;
- `computeProgressSnapshot` (4 étages) dans `src/components/chat/ManagerChat.tsx:187`.

Aujourd'hui les trois vivent en parallèle. `recomputeStatus` est appelée
impérativement en **8 call-sites** (6 dans `ManagerChat.tsx` : ~1050, 1796,
2086, 2234, 2302, 2378 ; 2 dans `manager-flow.ts` : 175, 231).
`computeProgressSnapshot` alimente encore les chips de reprise alors que
`nextFlowStep(lifecycle)` n'est lue qu'en 2 points (ManagerChat ~897, 1494).

**Risque** : un chemin met à jour une représentation sans l'autre → `status`
diverge du `lifecycle` (campagne bloquée ou mal affichée). Ce qui empêche de
supprimer `computeProgressSnapshot` = les chips de reprise lisent encore les
4 étages, pas la phase courante.

**Piste de résolution (incrément 2c).**
1. Mapper `FlowStep → chips de reprise` (helper dérivant des chips depuis
   `nextFlowStep`/`lifecycle`).
2. Remplacer les 8 `recomputeStatus` par les transitions explicites déjà
   présentes dans le store (`completePhase` / `postponePhase` / `reopenPhase`).
3. Supprimer `computeProgressSnapshot`, puis découper `ManagerChat.tsx`
   (2838 lignes — viole la règle des 200) une fois la logique de statut sortie.

**Conséquence** : source de vérité unique + testabilité + ManagerChat allégé.

---

## Nettoyage de la couche d'orchestration (suite de la décision Manager = orchestrateur)

**Statut** : décision de conception actée (spec v1.3 + CLAUDE.md, commit
`c397853`) — l'Orchestrateur séparé est supprimé, le Manager EST l'orchestrateur
et le SPOC. Reste l'alignement **code**.

**Contexte.** Le contrat `AgentContract` est à moitié abandonné : le `.execute()`
des `src/lib/agents/contracts/*.ts` (Publisher, Scheduler…) jette
`NOT_IMPLEMENTED` et **n'est jamais appelé**. L'exécution réelle vit dans
`src/lib/agents/server/*-execute.ts` + routes `/api/*`, et le dispatch dans
`src/lib/chat/manager-flow.ts`. Ce code mort a induit en erreur l'audit de
conception (faux « agents absents »).

**Risque** : aucun en runtime, mais dette d'honnêteté architecturale — le code
ment sur le mécanisme d'exécution et la spec/CLAUDE annoncent un contrat non
respecté.

**Piste de résolution.**
- Purger les `.execute()` morts des contrats, OU recâbler l'exécution dessus si
  on veut conserver l'abstraction `AgentContract`.
- Documenter `manager-flow.ts` (+ routes `/api/*`) comme **la** couche
  d'orchestration du Manager (nommage explicite).
- Vérifier qu'aucun prompt/sortie Manager ne mentionne un « orchestrateur » au
  donneur d'ordre (déjà fait pour le Lobby ; prompts internes OK car « orchestrer »
  y est employé comme verbe générique).

---

## C7 — Critères versionnés & immutables à R4 (+ re-scoring + historique)

**Statut** : reporté. Issu du refactor scoring (extraction/scoring/narration,
commits C1→C6). À traiter **en parallèle de la Session 5 (dashboard)**, où le
versioning trouvera son premier usage visible.

**Pré-requis bloquants** : C1→C6 stables et livrés —
- C1 types fondation (`ScoringBehavior`, `CRITICITY_TO_BEHAVIOR`, `ScoreResult`,
  `JobApplicationData`),
- C2 `scoreCandidat` pur + golden tests (le re-scoring s'appuie dessus),
- C3 déterminisme provider (seed:42, temp:0, retry×3),
- C4 phase extraction, C5 phase narration, C6 adaptation flow + UI.

**Périmètre.**
- Quand une campagne entre en **R4**, ses critères (fiche de scoring) deviennent
  **immutables** : le store doit geler `ScoringSheet` (plus de `updateCriterion`
  libre — cf. `src/stores/scoring-store.ts:107-133` aujourd'hui non gelé).
- Toute modification ultérieure (seuil, pondération via action directe UI) **crée
  une nouvelle version horodatée** plutôt que de muter en place.
- Chaque nouvelle version **déclenche un re-scoring** de tous les CV déjà
  analysés via `scoreCandidat` (déterministe, sans appel LLM — réutilise les
  `JobApplicationData` + décisions par critère déjà extraites si possible).
- Le **dossier candidat conserve l'historique des scores par version**.

**Dépendances machine d'états** : touche `src/lib/campaign/lifecycle.ts` et
`campaign-status` — **ne pas démarrer tant que le refactor `refactor/campaign-
lifecycle` n'est pas convergé** (cf. ticket « Convergence vers la machine
d'états » ci-dessus).

**Risque** : élevé (lifecycle + scoring-store + dashboard candidat). Isolable une
fois C1→C6 stables.

**Tolérance golden tests** : ±2 pts en première vague, à resserrer à ±1 pt une
fois le système stabilisé (seuil progressif — même logique que C2).

---

## Ré-activation du mode « tâche isolée » (hors campagne, TASK-XXXX)

**Statut** : désactivé en v1 (gating), code conservé non-destructif.

**Contexte.** La modalité « sollicitation hors campagne » (livrables atomiques,
TASK-XXXX) est hors périmètre produit v1. Le gating se fait en UN point :
`runManagerTurn` court-circuite l'intention `out_of_campaign_task` vers une
redirection polie (`buildOutOfCampaignUnavailableResponse`). Le picker UI était
déjà coupé (`CVRoutePicker.ISOLATED_TASK_ENABLED = false`).

**Code préservé mais désormais inatteignable** (à NE PAS supprimer — réactivation
future) : `manager-isolated.ts`, `/api/manager/isolated-criteria`,
`isolated-criteria-store`, `tasks-store`, `dispatchIsolatedCVBatch` /
`chooseRouteIsolated` (manager-flow), branche `freeText` de l'ancien
`cv-analyzer-execute.ts` + `buildCVAnalyzerUserPrompt`, branche `TASK` de
`generateCampaignId`, composants `IsolatedCriteriaChecklist` /
`ValidateIsolatedCriteriaButton` + branches isolées de `ManagerChat.tsx`.

**Pour ré-activer** : retirer le verrou `out_of_campaign_task` dans
`runManagerTurn`, repasser `ISOLATED_TASK_ENABLED = true`, et **reconstruire le
câblage analyse CV isolée** — retiré en 6e car incompatible avec le scoring par
fiche obligatoire : `dispatchIsolatedCVBatch` (manager-flow), `buildIsolatedCriteriaPayload`
(ManagerChat) et les 2 appels dans `handleValidateIsolated` ont été supprimés.
L'analyse `freeText` sans fiche devra être repensée avec une fiche de scoring
minimale ou un mode dédié, car `scoreCandidat` exige une `ScoringSheet`.

---

## Migration mail-composer + scheduler vers CVApplication (6c-mail)

**Statut** : ✅ FAIT (commit 6c-mail). Sous-système migré sur l'interface étroite
`MailCandidate` (`src/types/mail-candidate.ts`) ; frontières outreach projetant
via `cvApplicationToMailCandidate` ; adapter `toLegacyCVResult` supprimé ;
`experienceYears`/`skills` retirés des templates. Reste 6d.

**Contexte initial (résolu)** : issu de C6/6b — le sous-système mail/scheduler
était resté sur `CVAnalysisResult` (cascade trop profonde pour 6b).

**Contexte.** `composeCandidateMail` / `composeInterviewGuide`
(`mail-composer-execute.ts`), les routes `/api/mail-composer` et `/api/scheduler`
(+ leurs schémas Zod `candidate: CVAnalysisResultSchema`), et l'outreach IMAP
(`imap/outreach.ts`) consomment encore `CVAnalysisResult`. En 6b, les deux
frontières outreach (chat `manager-flow.ts` + poller `imap/poller.ts`) projettent
`CVApplication → CVAnalysisResult` via l'adapter transitoire
`cv-application-legacy-adapter.ts` (`toLegacyCVResult`).

**Conséquence visible (transitoire)** : l'adapter pose `experienceYears: 0` /
`skills: []` → les briefs DRH et mails affichent « 0 an(s) » (cosmétique).

**Périmètre.**
- Migrer `composeCandidateMail` / `composeInterviewGuide` + les 2 routes
  (schémas) sur `CVApplication` (ou une projection narrow `MailCandidate`
  dédiée — interface étroite, comme `OutreachCandidate` envisagé).
- Migrer `imap/outreach.ts`.
- Retirer les projections `toLegacyCVResult` aux 2 frontières, **puis supprimer
  l'adapter** + son test.
- Retirer les usages `experienceYears`/`skills` des templates mail/brief.

**Pré-requis** : 6b livré. À faire avant ou avec 6d (cleanup `executeCVAnalyzer`
/ `CVAnalysisResult`) — l'adapter et `CVAnalysisResult` ne peuvent disparaître
qu'une fois ce ticket fait.

---

## Persistance du seuil campagne — fraîcheur côté IMAP (limites mineures)

**Statut** : fonctionnel. `campaign.threshold` (source unique du seuil, lu par le
scoring chat + IMAP depuis 6c) est édité au dashboard (`ThresholdEditBlock` →
`setThreshold`) et **persisté** via la souscription `campaigns-sync.ts` →
`PUT /api/campaigns` → `upsertCampaign` (colonne `threshold`).

**Limites assumées (pas des bugs) :**
1. **Débounce + best-effort.** La persistance arrive après `PUSH_DEBOUNCE_MS` et
   le `fetch` échoue en silence si Supabase n'est pas configuré. Sans Supabase le
   poller IMAP ne tourne pas non plus → pas d'incohérence (chat-only).
2. **Micro-course IMAP.** Un CV analysé par IMAP entre l'édition du slider et la
   fin du push débouncé utiliserait l'ancien seuil. Fenêtre négligeable.

**Piste si besoin un jour** : push immédiat (non débouncé) sur `setThreshold`
spécifiquement, ou relire `campaign.threshold` au plus tard dans le poller. Non
prioritaire — la fenêtre est étroite et le re-scoring (C7) corrigera de toute
façon les CV scorés à l'ancien seuil.

---

## CV uploadé « oublié » quand l'upload crée une nouvelle campagne

**Statut** : non implémenté (ex-« Limite Session 4 »). Pas urgent.
**Code concerné** : `src/lib/chat/manager-flow.ts` (`chooseRouteNewCampaign`,
`dispatchCVBatch`), `src/components/chat/ManagerChat.tsx` (`handleValidateFDP`,
validation de la fiche de scoring → `advanceFlow`).

**Contexte.** Quand le DRH uploade un/des CV et route vers « Nouvelle campagne »,
`chooseRouteNewCampaign` crée la CAMP-XXXX + la FDP mais **jette les fichiers**
(`pendingRoutings.delete(pendingId)` sans conserver `pending.files`). Une fois la
campagne cadrée et activée, **rien n'analyse ces CV** : le DRH doit les ré-uploader
via le source-picker. Comportement attendu (mimétique RH) : le système se
« souvient » que ces CV sont à analyser et les passe au CV Analyzer dès que la
campagne peut scorer.

**Subtilité bloquante.** L'analyse exige une **fiche de scoring validée** (garde
obligatoire, 422 sinon — cf. `dispatchCVBatch` / refactor C6). Le bon point de
déclenchement n'est donc PAS la validation FDP, mais **après validation de la
fiche de scoring** (quand `campaign.scoringSheet.isValidated`).

**Piste de résolution.**
1. À la création (`chooseRouteNewCampaign`), **stasher les `files`** dans une map
   module-locale keyée par `campaignId` (ne pas les jeter).
2. Après validation de la fiche de scoring de cette campagne, **consommer** la
   stash et appeler `dispatchCVBatch({ files, campaignId })`, puis vider la stash.
3. Idéalement poser une bulle Manager « je reprends le CV que vous m'aviez
   transmis » pour la continuité narrative.

**Limite connue** : les `File` JS vivent en mémoire — la stash **ne survit pas à
un refresh** de la page entre l'upload et la validation de la fiche. Acceptable en
prototype (parcours continu) ; à documenter si on veut la robustesse.

**Risque** : faible/moyen. Isolé au flux d'upload → nouvelle campagne.

---

## « Ajuster » ancré sur le mauvais champ à la collecte FDP (INTERMITTENT, à reproduire)

**Statut** : bug **non systématique** observé en collecte FDP (création par chat).
Pas de repro fiable au moment de la saisie — **à reconsigner avec les étapes
exactes** quand il se reproduit.
**Code concerné** : `src/lib/agents/manager.ts` (`ensureProposalAnchor`,
`lastCanonicalField`), `src/components/chat/edit-target.ts`
(`resolveEditableFieldKeys`). Introduit par le commit `521ecf4`
(« Ajuster s'ancre sur le champ proposé a′ »), **antérieur** à la session
dashboard/scoring (aucun commit de cette session ne touche la collecte FDP — vérifié).

**Symptôme observé.** À la création d'une campagne par chat, le Manager **propose
la localisation** (champ #4) alors que le chip « Ajuster » est **ancré sur
l'intitulé** (champ #1) : cliquer « Ajuster » édite l'intitulé, pas la localisation.
Au tour suivant, la localisation est re-proposée correctement (bons chips /
suggestions). Non systématique.

**Cause racine probable.** `ensureProposalAnchor` DEVINE le champ proposé via
`lastCanonicalField(extracted)` = « le dernier champ extrait dans l'ordre
canonique » (hypothèse : la double-écriture ajoute le prochain champ par défaut
en dernier dans `fieldExtractions`). Quand le LLM **propose un champ dans le
message SANS l'inclure dans `fieldExtractions`** (et oublie `proposalField`),
l'ancre retombe sur le dernier champ réellement extrait (souvent `job_title`) →
décalage entre la QUESTION (location) et le champ ANCRÉ (job_title). L'intermittence
vient de la variabilité d'extraction du LLM au tour 1.

NB : `521ecf4` a justement abandonné `firstIncompleteField` au profit de
`lastCanonicalField(extracted)` pour corriger un décalage d'un cran (l'ancre tombait
sur le champ que le DRH venait de remplir). Les deux heuristiques ont chacune un
angle mort → le vrai correctif doit réconcilier les deux.

**Pistes de résolution.**
1. Durcir le prompt : `proposalField` **obligatoire** ET la valeur proposée
   **toujours** dans `fieldExtractions` (règle déjà énoncée, à renforcer / valider).
2. Ancre déterministe robuste : croiser `lastCanonicalField(extracted)` avec
   `firstIncompleteField(fdp)` — si le champ proposé (texte du message) diffère du
   dernier extrait, préférer le premier champ VIDE (celui que le prompt impose de
   proposer). Idéalement détecter le champ visé par le message.
3. À défaut, garde-fou : si `proposalField` absent ET le dernier extrait est déjà
   `filled` depuis un tour précédent, basculer sur `firstIncompleteField`.

**À consigner au prochain repro** : chemin de création, 1er message exact tapé,
état de la checklist au tour 1, et (si visible) `proposalField` + `proposedExtractions`
de la bulle fautive.

**Risque** : moyen — touche la logique d'ancrage partagée par toute la collecte FDP ;
régression possible sur le décalage d'un cran que `521ecf4` corrigeait. À traiter
avec un repro stable et des tests ciblés.

---

## Adaptateur multi-fournisseur LLM (tester Claude/Sonnet sur l'analyse CV)

**Statut** : non implémenté. Demandé pour comparer la qualité d'analyse CV.
**Code concerné** : `src/lib/ai/provider.ts` (point d'entrée unique), tous les
agents qui passent par `chatComplete` / `chatCompleteJson`.

**Contexte.** Le provider est 100 % SDK OpenAI (`api.openai.com`). Le modèle
chat par défaut est désormais pilotable par `OPENAI_CHAT_MODEL` (fallback
`gpt-4o-mini`) — OK pour tout modèle **OpenAI** (ex. `gpt-4o`), mais **pas**
pour un modèle d'un autre fournisseur. Mettre `OPENAI_CHAT_MODEL=claude-sonnet-4-6`
échoue (modèle inconnu côté OpenAI). Tester **Sonnet** (`claude-sonnet-4-6`)
exige un adaptateur Anthropic.

**Périmètre.**
- Ajouter `@anthropic-ai/sdk` + `ANTHROPIC_API_KEY` (`.env.local` / `.env.example`).
- Router par préfixe dans `chatComplete` / `chatCompleteJson` : `claude-*` →
  client Anthropic, sinon OpenAI. Garder un seul défaut configurable.
- Adapter la requête : extraire le message `system` (top-level chez Anthropic,
  pas dans `messages[]`), `max_tokens` obligatoire, remapper `usage` pour les
  métriques de coût (+ entrée pricing `claude-sonnet-4-6` ≈ 3 $/15 $ par M).

**Pièges identifiés.**
1. **JSON mode + seed** : `chatCompleteJson` repose sur `response_format:
   {type:'json_object'}` **et** `seed:42` (déterminisme C4). Anthropic n'a ni
   l'un ni l'autre à l'identique. Sonnet 4.6 supporte les *structured outputs*
   (`output_config.format` + JSON schema dérivé du Zod) — équivalent propre mais
   à câbler. **Pas de `seed`** → le déterminisme du pipeline d'extraction/scoring
   ne tiendra plus pareil (cf. [[feedback_pure_function_test_purity]]).
2. **Whisper reste sur OpenAI** : Anthropic ne fait pas de transcription audio →
   `transcribe()` conserve le client OpenAI. Provider **hybride** (OpenAI gardé
   pour Whisper + agents câblés en dur `gpt-4o`, Anthropic ajouté pour le chat).
3. `temperature` OK sur Sonnet 4.6 (contrairement à Opus 4.8/4.7 qui l'ont retiré)
   → les `temperature: 0/0.3/0.4` actuels passent tels quels.

**Risque** : moyen — un seul fichier (`provider.ts`) + helper Zod→JSON-schema,
mais touche le chemin critique de tous les agents. Tester d'abord `gpt-4o`
(déjà actif) avant d'investir dans l'adaptateur.

---

## Aligner les clés `pricing.ts` avec les model strings datés d'OpenAI

**Statut** : non fait. Petit fix (~10 min) pour rendre le bench utile sur le coût.
**Code concerné** : `src/lib/ai/pricing.ts`, `src/lib/ai/provider.ts` (`estimateCost`).

**Contexte.** `estimateCost(model, …)` indexe `PRICING` par le `model` **renvoyé**
par l'API. OpenAI renvoie un identifiant **daté** (`gpt-4o-2024-08-06`), absent de
la table (clé `gpt-4o`) → coût estimé à **0**. Visible dans le bench
(`scripts/bench-cv-analyzer.ts`) : `costEstimate: 0` pour tout run OpenAI, alors
que les tokens sont corrects. Côté Anthropic le `model` renvoyé matche
`claude-sonnet-4-6` → coût OK ; l'asymétrie fausse la comparaison de coût.

**Piste.** Normaliser le model string avant lookup (strip du suffixe daté
`-AAAA-MM-JJ`), OU ajouter des clés datées/regex dans `PRICING`. Le strip est le
plus simple : `pricingKey(model)` qui retombe sur la famille (`gpt-4o-2024-… →
gpt-4o`). Rend le bench exploitable sur l'axe coût.

**Risque** : faible (fonction pure + table). Hors périmètre de la session
adaptateur/bench (isolée volontairement).

---

## E2E navigateur (Playwright) — non installé

**Statut** : pas d'infra E2E navigateur dans le projet (ni Playwright, ni Cypress ;
vitest tourne en `node`). Couverture E2E actuelle = **déterministe via le store**
uniquement.

**Déjà couvert** (commit `deeeced`) : `src/stores/__tests__/campaign-journey.e2e.test.ts`
— 8 scénarios chaînés du moteur de cycle de vie (porte d'activation, sources =
unique vérité, diffusion ≠ réception, cascade de réouverture, pause/reprise,
clôture, édition FDP) + round-trip persistance repo. Rapide, sans LLM ni navigateur.

**Non couvert (nécessite un harnais navigateur)** :
- Parcours UI réels du **dashboard** : clics activer/suspendre/clôturer, toggles
  Flux/Canaux, édition FDP/scoring inline, bandeaux et états désactivés du bouton
  « Activer » (tooltip motifs manquants). C'est de l'intégration React+store dans un
  vrai DOM, hors de portée de vitest `node`.
- Flux **chat** (collecte FDP, pré-recherche L1, picker sources, récap/validation)
  et **CV Analyzer** end-to-end : pilotés par le LLM → non déterministes et payants.
  À tester en E2E, il faudrait **stubber** les appels `chatCompleteJson` (rejouer des
  réponses enregistrées) pour rester reproductible.

**Piste de résolution.**
1. Ajouter Playwright (`@playwright/test`) + script `test:e2e`, lancer `next dev`
   (ou `next build && start`) en amont des specs.
2. Spécifier d'abord les parcours **dashboard déterministes** (pas de LLM) : ce sont
   les plus régression-prones et les plus simples à automatiser.
3. Pour le chat/CV : intercepter le réseau (route mocking Playwright) ou un mode
   `AI_FIXTURE` côté provider qui rejoue des réponses figées → E2E reproductible
   sans coût LLM.
4. Faire tourner en CI sur un navigateur headless (chromium).

**Coût/risque** : ajout d'infra (download navigateurs, setup CI). Non bloquant —
le moteur critique est déjà couvert en déterministe. À prioriser avant la mise en
prod VPS (Session 8) pour sécuriser les parcours UI.

---

## Préparation modèle de données pour le module reporting (donneur d'ordre + site)

**Statut** : à faire AVANT toute première session reporting. Non urgent, mais
**bloquant pour le reporting** (qui consomme ces deux dimensions). Idéalement un
**commit dédié** juste avant d'attaquer le reporting.

**Contexte.** Le reporting à venir aura besoin de deux concepts métier qui
n'existent pas encore dans le modèle. Les introduire d'abord, sinon le reporting
n'aura pas de dimensions à agréger.

### Entité 1 — Donneur d'ordre
La personne (interne à l'organisation cliente) qui a **initié** une campagne.
**Distinct de l'utilisateur ORQA** qui manipule l'interface. Une campagne a un
**seul** donneur d'ordre identifié.
- `id`
- nom + prénom
- email professionnel
- rôle / fonction (texte libre — « Directeur du site de Lyon », « Manager R&D »,
  « DRH adjoint »)

### Entité 2 — Site
L'entité géographique/organisationnelle de rattachement d'une campagne (orgs
multi-sites : réseaux d'établissements, groupes avec filiales, multi-implantations).
Une campagne a un **seul** site associé. Orgs mono-site : créer un site
« par défaut » et y rattacher toutes les campagnes sans friction.
- `id`
- nom du site (« Clinique de Bordeaux », « Filiale Industrie », « Siège Paris »)
- type / catégorie (texte libre — « Établissement médical », « Site industriel »,
  « Bureau commercial »)
- localisation (ville ; code postal optionnel)

### Migration des campagnes existantes
Les deux liens sont **nullable au début** : remplis manuellement au fil du temps
par les utilisateurs, ou laissés vides pour les campagnes anciennes. **Aucune
rupture** sur l'existant.

### Tâches (session de préparation reporting)
1. **Schéma Supabase** : tables `donneur_ordre` et `site` + relations vers
   `campaign` (probablement deux colonnes **nullable** `donneur_ordre_id` et
   `site_id` sur la table des campagnes). Migration dans `scripts/migrate.sql`.
2. **Écrans de cadrage de campagne (Temps 1)** : capturer ces deux infos à la
   création. Le Manager RH pose les questions correspondantes au donneur d'ordre
   lors du brief initial (cf. règle « une seule question à la fois »).
3. **Admin légère** : gérer la liste des donneurs d'ordre et des sites au niveau
   de l'organisation cliente (création / modification / archivage).
4. **Documenter dans `CLAUDE.md`** ces deux concepts pour que toute session
   future en tienne compte.

**Règle** : ne PAS démarrer le développement reporting tant que ces deux entités
ne sont pas en place dans le modèle.

**Risque** : moyen — touche le schéma de campagne (lifecycle) + la persistance
Supabase + le cadrage Temps 1. Isolable en commit dédié.

---

## Manager RH lecture seule — nettoyage du code mort (Phase 3, lots 3 & 4)

**Statut** : refonte « Manager lecture seule » **opérationnelle et livrée**
(Phase 1 inventaire, Phase 2 neutralisation, Phase 3 lots 1-2 commités). Il
reste à **supprimer le code mort** rendu inatteignable par la Phase 2. C'est de
l'**hygiène pure, sans impact fonctionnel** : tout ce qui est listé ici est déjà
inerte (le Manager ne peut plus écrire, l'UI déterministe est intacte).

### Rappel fonctionnel (déjà en place)
Le Manager RH conversationnel est **strictement lecture seule** : il SAIT,
ANALYSE, ORIENTE, il n'écrit jamais. Toute mutation (créer/éditer/activer une
campagne, statuts, pondérations, présélections) passe **exclusivement par l'UI
déterministe** (onglet Campagnes, formulaires, boutons). Périmètre autorisé du
Manager : (1) analyse d'un CV déposé contre une campagne existante, (2) point de
lecture sur une campagne, (3) orientation/navigation. Neutralisation faite aux
points d'entrée : `manager.ts` (`new_campaign`/`other` → orientation), le
route-picker d'upload (seul « analyser contre une campagne existante » reste),
le sélecteur de campagne (lecture seule). Cf. `CLAUDE.md` à compléter quand le
nettoyage sera fini.

### Discipline de suppression
Supprimer **uniquement sur « zéro référence » prouvé** (`grep` dans tout `src`
hors le fichier supprimé) ; **ne jamais toucher une fonction partagée avec
l'UI** (P) — couper le pont, pas la fonction ; **garder tous les agents en
place** (Job Writer, Publisher, mail-composer, scheduler, rejection-writer) et
le **subsystème isolé** (`manager-isolated.ts`, `/api/manager/isolated-criteria`,
`isolated-criteria-store`, `IsolatedCriteriaChecklist`,
`ValidateIsolatedCriteriaButton`, `handleValidateIsolated`). Typecheck + vitest
après chaque coupure, commit conventionnel par lot.

### Lot 4 — gutting `ManagerChat.tsx` (~2766 lignes) + stores + composants
Lot **gros et délicat** (suppressions interdépendantes dans un composant à état
lourd : refs, pickers, flux). À faire en sous-étapes vérifiées.

- **Handlers de cadrage morts à retirer** (`src/components/chat/ManagerChat.tsx`) :
  `advanceFlow`, `postFluxStep`, `postAnnouncementChoice`, `postPublicationChoice`,
  `postAnnouncementStep`, `postLaunched`, `handleValidateFDP`, `handleChannelToggle`,
  `handleChannelsConfirm`, `handleSourceToggle`, `handleSourcesConfirm`,
  `proposeScoringForCampaign`, `handleScoringAdd/Update/Remove`, `handleMailboxPick`,
  `handleScoringValidate`, `handleResumeAction`, `handleReopenAndContinue`,
  `handleFieldAdjust`, `handleProposalEditSubmit/Cancel`, `maybeProposeAdRegeneration`,
  `handleRegenerateAd`, `attachResumeChipsToLastBubble`, `applyFieldToSource`,
  `editableFieldsForMessage`, `handleSwitchDialogChoice`, et le `handleChipSelect`
  à élaguer (branches flux/annonce/publish/reopen/adjust). **Garder** :
  `handleReset`, `handleFilesSelected`, `handleRoutePick`, `handleCampaignPick`,
  `sendToManager`, `handleSendText`, `handleChipSelect` (épuré), `handleTranscribe`,
  `handleSelectCampaign` (déjà lecture seule), `handleNewCampaign` (oriente),
  `handleValidateIsolated` + `sendToManagerIsolated` (subsystème isolé).
- **Stores M entiers** : `src/stores/fdp-store.ts`, `src/stores/scoring-store.ts`
  (zéro consommateur hors Manager prouvé). **Garder** `isolated-criteria-store`.
- **Composants de cadrage chat** : `ScoringSheetEditor`, `CVSourcesPicker`,
  `PublicationChannelPicker`, `SourcePicker`, `FieldChecklist`, `ValidateFDPButton`,
  + le `MailboxPicker` **du dossier `components/chat/`** (⚠️ homonyme : NE PAS
  toucher `components/campagnes/edit/MailboxPicker.tsx`, utilisé par l'UI flux).
- **`chat-store`** : retirer les `kind` de bloc devenus orphelins
  (`scoring-sheet-editor`, `cv-sources-picker`, `publication-channel-picker`,
  `source-picker`, `mailbox-picker`) + leur câblage dans `ChatBubble`. **Garder**
  `cv-route-picker`, `campaign-picker`, `cv-progress`, `cv-batch-summary`
  (chemin analyse CV).

### Lot 3 — wrappers Manager (débloqué une fois le Lot 4 fait)
- `src/lib/chat/manager-flow.ts` : `dispatchJobWriter`, `dispatchPublisher`,
  `dispatchPostAnalysisOutreach`, `chooseRouteNewCampaign` (créateur de campagne).
  **Garder** le chemin analyse CV : `dispatchCVRouting`, `chooseRouteExisting`,
  `chooseExistingCampaign`, `dispatchCVBatch`, `snapshotActiveCampaigns`, et —
  par prudence (subsystème isolé) — `chooseRouteIsolated` + `wipeForFreshStart`
  tant que le flux isolé est conservé.
- `src/lib/chat/api-client.ts` : `postJobWriter`. **Garder** `postCVAnalyzer`,
  `postManagerScoring`, `postFdpProposal` (ces deux derniers utilisés par
  `CampaignCreateSheet` — P).
- **NE PAS supprimer** l'agent Job Writer lui-même (`registry.ts`,
  `contracts/job-writer.ts`, `job-writer-*`, `/api/job-writer`) ni Publisher :
  agents en place, conservés (décision produit). On retire seulement le wrapper
  d'appel côté Manager.

### Résidus mineurs (tidy final)
- `manager.ts` : helpers de garde devenus orphelins mais encore exportés/testés
  (`ensureChipsPresent`, `ensureAdjustChip`, `ensureProposalAnchor`,
  `ensureNonEmptyMessage`, `buildAskRoleResponse`) + `buildConversationalPrompt`
  (dans `manager-prompts.ts`) : à retirer avec leurs tests une fois le reste fait.
- Re-tester `manager-prompts.test.ts` (tests du prompt conversationnel à retirer).

**Risque** : moyen-élevé sur le Lot 4 (composant unique de 2766 lignes, état
imbriqué) ; faible sur le Lot 3 (suppressions mécaniques après Lot 4). Aucune
régression fonctionnelle attendue (code déjà inerte). **Bien committer par lot**
et vérifier que le chat reste fonctionnel (analyse CV + point campagne +
orientation) après chaque coupure.

---

## [App] `indexing.ts` marque `indexed` même sans embedding titre (faux « indexé » couche 2)

**Statut** : identifié pendant la conception du script d'import en masse du vivier
(`scripts/import-vivier.ts`). NON corrigé dans le lot import (volontairement) —
à traiter à part côté app.

**Contexte.** Dans `src/lib/vivier/indexing.ts`, les étapes embeddings / ancres /
compétences sont **non bloquantes** : chacune `catch`+log et continue, puis
l'étape 5 écrit le statut `indexed` **quoi qu'il arrive** (`indexing.ts:234`). Un
dossier peut donc être `indexed` **sans embedding titre** (ex. coupure d'API au
moment de `embedText`) → il est **invisible en présélection** (aucun vecteur à
comparer) mais **compté « indexé »** dans l'UI et les listes.

C'est la **couche 2** du faux « indexé » : la couche 1 (l'UI `VivierUpload` passe
au vert dès le HTTP 200, avant la fin de l'indexation lancée en `after()`) est
distincte. Les deux donnent un statut mensonger, par des chemins différents.

**Conséquence aggravante.** `npm run reindex:vivier -- --only-failed` **ne
rattrape pas** ces dossiers : ils sont `indexed`, pas `failed`. Ils restent donc
creux en silence jusqu'à un reindex COMPLET.

**Risque** : moyen. Pas de corruption, mais des dossiers présents et inertes en
présélection — sous-couverture invisible du vivier.

**Piste de résolution** (au choix) :
- **A.** Ne pas écrire `indexed` si l'embedding titre est absent → repasser en
  `failed` (rattrapable par `reindex --only-failed`). Simple, mais « failed »
  est sémantiquement fort pour un dossier dont les entités/titre sont OK.
- **B.** Introduire un statut `indexed_incomplet` (titre/entités OK mais embedding
  manquant) : honnête, rattrapable, et distinct d'un échec dur. Demande une
  migration d'enum + prise en compte dans les filtres de présélection et l'UI.

**Note** : le **script d'import** (`import-vivier.ts`) n'est PAS trompé par ce
bug — il re-lit `getVivierEmbeddingMeta` après indexation et compte le dossier
`failed (embedding_absent)` si l'embedding titre manque, indépendamment du flag
`indexed`. En revanche il ne **répare pas** les dossiers creux préexistants
(créés par le glisser-déposer) : il les voit comme doublons et les ignore. C'est
précisément ce correctif app qui les couvrira.
