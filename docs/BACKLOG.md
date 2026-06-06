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
`runManagerTurn`, repasser `ISOLATED_TASK_ENABLED = true`, et migrer le flux
isolé vers le nouveau pipeline (extraction/scoring/narration) — l'analyse `freeText`
sans fiche devra être repensée avec une fiche de scoring minimale ou un mode
dédié, car `scoreCandidat` exige une `ScoringSheet`.
