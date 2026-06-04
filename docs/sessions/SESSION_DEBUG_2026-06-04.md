# Session de débogage — 2026-06-04

Branche : `refactor/campaign-lifecycle` (PR #1) · 15 commits · poussés.
Périmètre : correction de bugs remontés en test + durcissement déterministe du
Manager + branchement reporting réel. Aucune régression : **449 tests verts**,
typecheck + lint propres à chaque étape.

Traçabilité : symptôme (fonctionnel) → cause racine (technique) → correctif →
commit → validation.

---

## 1. Parsing des CV PDF

### 1.1 — CV PDF non analysés (dev)
- **Symptôme** : « CV … n'a pas pu être analysé (ReferenceError: DOMMatrix is not
  defined) ». Aucun candidat ni au dashboard, ni d'invitation/refus par mail.
- **Cause** : `pdf-parse@2` → `pdfjs-dist@5` exige les globals navigateur
  `DOMMatrix`/`ImageData`/`Path2D`, qu'il auto-polyfille depuis `@napi-rs/canvas`
  — paquet jamais installé. Les PDF texte simples passaient ; un vrai CV
  (polices/images) touchait le chemin canvas → ReferenceError.
- **Correctif** : install `@napi-rs/canvas` + garde explicite
  `pdf_engine_unavailable` (message métier si binaire absent).
- **Commit** : `cbad430` · **Validé** : route `/api/cv-analyzer` HTTP 200, score 95.
- **Fichiers** : `cv-extract.ts`, `cv-analyzer/route.ts`, `package.json`.

### 1.2 — Même erreur en preview/prod (≠ dev)
- **Symptôme** : réglé en dev, mais revient en build de production.
- **Cause** : l'auto-polyfill pdfjs (`require("@napi-rs/canvas")` via
  `createRequire(import.meta.url)`) ne survit pas à l'encapsulation « external
  module » de `pdf-parse` par Next en prod → globals jamais posés.
- **Correctif** : `ensurePdfDomPolyfills` importe directement `@napi-rs/canvas`
  et pose les globals AVANT de charger `pdf-parse` ; `@napi-rs/canvas` ajouté à
  `serverExternalPackages`.
- **Commit** : `86c3181` · **Validé** : reproduit + corrigé en `next build && next
  start`, HTTP 200 / score 95.
- **Fichiers** : `cv-extract.ts`, `next.config.ts`.

### 1.3 — Nettoyage dépendance
- `@types/pdf-parse@1` (API v1) supprimé — `pdf-parse@2` embarque ses types.
- **Commit** : `0bffe66`.
- **Backlog** : robustesse PDF à durcir avant prod VPS (binaire natif spécifique
  plateforme, liste de globals en dur, chemin worker en dur). → `8c3588e`,
  `docs/BACKLOG.md`. Alternative robuste notée : migration `unpdf`.

---

## 2. Flux email (IMAP) — aucune action sur candidature

### 2.1 — Cause opérationnelle (pas de code)
- **Symptôme** : envoi d'un CV par mail → ni refus ni invitation, rien au dashboard.
- **Cause** : le serveur en cours d'exécution n'avait pas `MAILBOX_ENCRYPTION_KEY`
  chargé (process démarré avant l'ajout de la clé). Le poller ne peut pas
  déchiffrer le mot de passe IMAP → ne se connecte jamais. La clé EST présente
  dans `.env.local`.
- **Résolution** : **redémarrer le serveur**. Vérifié live (`/api/imap/poll-now`) :
  `last_error` effacé, backlog traité, action générée (refus envoyé `status: sent`).
- ⚠️ **Effet de bord du diagnostic** : le `poll-now` a réellement envoyé 2 mails
  de refus à des candidatures en attente (uid 1212/1226).

### 2.2 — Destinataire candidat déterministe
- **Symptôme** : les mails au candidat partaient aléatoirement à l'expéditeur de
  l'enveloppe ou ailleurs.
- **Cause** : le destinataire venait de `CVAnalysisResult.email`, extrait par le
  LLM — non déterministe.
- **Correctif** : helper pur `resolveCandidateEmail(cvText, llmEmail)` — le
  destinataire DOIT être une adresse littéralement présente dans le CV
  (`verified` / `corrected` → 1ʳᵉ adresse du CV / `absent` → on n'envoie rien).
  Appliqué dans le poller IMAP ET la route chat. Avertissement visible au
  dashboard si aucun email exploitable.
- **Commit** : `0a24ac4` · **Validé** : 9 tests + live (résout vers l'email du CV).
- **Fichiers** : `candidate-email.ts`, `poller.ts`, `cv-analyzer/route.ts`,
  `derive-metrics.ts`.

### 2.3 — Non-réception des refus (délivrabilité)
- **Symptôme** : `status: sent` en journal mais mail jamais reçu.
- **Cause** : domaine d'envoi `send.qwestinum.fr` = `partially_failed` chez Resend.
  DKIM + SPF **vérifiés** (envoi authentifié OK) ; seul le **MX de réception**
  échoue (sans rapport avec l'envoi). Pas de DMARC → spam probable (Yahoo/Gmail).
  `status: sent` = accepté par Resend, PAS forcément délivré.
- **Correctif (traçage)** : `providerMessageId` (message-id Resend) persisté dans
  le journal outreach + `getEmailDeliveryStatus` + endpoint
  `GET /api/email/status?id=…` (delivered/bounced/sent).
- **Commit** : `aefbdc5` · **Validé** : endpoint OK (400 sans id, 502 sur id inconnu).
- **Action ops (backlog)** : poser un DMARC ; vérifier l'existence des boîtes
  destinataires. Chemins chat (`mail-composer`/`scheduler`) à journaliser aussi.
- **Fichiers** : `email/client.ts`, `email/status/route.ts`, `imap/outreach.ts`.

---

## 3. Dashboard — métriques & affichage

### 3.1 — CV uploadés par chat non comptés
- **Cause** : seul le poller IMAP journalisait (`imap_cv_received`/`imap_cv_analyzed`).
  La route chat `/api/cv-analyzer` n'écrivait rien → candidats invisibles.
- **Correctif** : journalisation côté route (mêmes actions réutilisées, tag
  `source: 'chat'`, `uid = taskId`). Dette de naming consignée au backlog.
- **Commit** : `3304d79` · **Validé** : live, candidates 20→21, cvReceived 55→56.

### 3.2 — « Invités » redondant avec « Shortlistés »
- **Cause fonctionnelle** : tout shortlisté est auto-invité → doublon.
- **Correctif** : indicateur « Invités » retiré du corps de carte ; « Shortlistés »
  renommé « Shortlistés / Invités » sur les 3 affichages (corps, tête, KPIs).
- **Commit** : `a8c17d8`.

### 3.3 — ID de campagne entre parenthèses
- **Correctif** : `(CAMP-XXXX)` ajouté sur chaque candidat et chaque ligne
  d'activité (donnée déjà présente, affichage seul).
- **Commit** : `3afcb06`.

### 3.4 — « Shortlistés/Invités » réagissait aux décisions DRH
- **Symptôme** : le compteur décrémentait après un refus/GO.
- **Cause** : condition `recommendation === 'go' && validationMarked !== 'rejected'`
  dans les 2 calculs (KPIs globaux + agrégation campagne).
- **Correctif** : `shortlisted = recommendation === 'go'` — fait figé à l'analyse,
  indépendant des décisions ultérieures.
- **Commit** : `646edcc` · **Validé** : test « reste figé après GO et refus ».

---

## 4. Manager RH — verrous déterministes & reporting réel

Doctrine appliquée : **le LLM propose, le code verrouille**.

### 4.1 — « je veux un recrutement » → « je n'ai pas trouvé de fiche »
- **Cause** : sur une demande sans poste, la pré-recherche tournait à vide et le
  prompt forçait l'annonce d'un échec de recherche.
- **Correctif** : nouveau signal classifier `specifiedRole` + court-circuit
  serveur : si `new_campaign` + démarrage à froid + aucun poste → réponse fixe
  « Pour quel poste ? », sans LLM conversationnel ni pré-recherche. Garde-fou
  prompt en défense.
- **Commit** : `6e00ac6` · **Validé** : live, demande le poste ; « comptable
  senior » → flux normal.
- **Fichiers** : `intent.ts`, `manager.ts`, `manager-prompts.ts`.

### 4.2 — Intention `other` + bulle vide
- **Correctif** : `other` (salutation/hors-sujet, hors campagne) → recadrage RH
  déterministe + chips, sans LLM. Filet universel `ensureNonEmptyMessage` contre
  les messages blancs.
- **Commit** : `365e36c` · **Validé** : live (« bonjour », « merci », « météo »).

### 4.3 — Suivi de campagne & point global (réponses réelles)
- **Cause** : `campaign_followup` / `reporting_request` traversaient le prompt de
  collecte FDP → réponses à côté.
- **Correctif** : module pur `manager-reporting.ts` (resolveCampaign +
  buildCampaignFollowupResponse + buildReportingResponse) alimenté par un loader
  paresseux injecté (campagnes + journal Supabase). Métriques via
  `journalToCampaignMetric`/`journalToGlobalKPIs`. Chips rebouclent.
- **Commit** : `a68e3b8` · **Validé** : live, chiffres exacts par campagne et global.
- **Fichiers** : `manager-reporting.ts`, `manager.ts`, `manager/chat/route.ts`.

---

## 5. Chat — UX

### 5.1 — Option « tâche isolée » masquée
- **Décision** : les briques campagne/tâche isolée (TASK-XXXX) ne sont pas fiables
  → option retirée du `CVRoutePicker` (flag `ISOLATED_TASK_ENABLED = false`) + chip
  « Préparer une fiche isolée » retiré du prompt. Réversible (mécanique conservée).
- **Commit** : `a7a0b19`.

### 5.2 — « Ajuster » des champs longs (missions / compétences)
- **Symptôme** : « Ajuster » semblait ne rien faire sur les missions/compétences
  (champs liste), aléatoirement.
- **Cause** : l'ouverture de l'éditeur en place n'ajoute pas de message →
  l'auto-scroll ne se déclenchait pas. Pour les bulles longues (listes
  multi-lignes), l'éditeur s'ouvrait sous la zone visible. Serveur vérifié OK
  (proposalField + extraction array corrects sur 8 passes) — bug d'affichage.
- **Correctif** : `editingMessageId` ajouté aux deps de l'effet de scroll.
- **Commit** : `6018c63` · **Validé** : non reproduit après correctif (confirmé DRH).

---

## Constats opérationnels (hors code) à retenir

- **Serveur de dev périmé** = cause de plusieurs « bugs » de la session (PDF,
  clé de chiffrement mailbox). Réflexe : **redémarrer** après changement d'env/déps.
- **Resend** : `status: sent` ≠ livré. Domaine `send.qwestinum.fr` `partially_failed`
  (MX réception + DMARC manquant) → délivrabilité fragile.
- **Données de test** injectées pendant le diagnostic (journal) : nettoyées.

## Backlog ouvert (`docs/BACKLOG.md`)
- Robustesse parsing PDF avant prod VPS (binaire natif / globals / worker, ou `unpdf`).
- Délivrabilité email : DMARC + journaliser les envois `mail-composer`/`scheduler`.
- Naming `imap_cv_*` réutilisé pour le chat (cosmétique).
- UI dashboard : bouton « vérifier la livraison » (via `providerMessageId`).

## Périmètre des tests
449 tests verts (50 fichiers). Nouveaux : `candidate-email`, `cv-extract`,
`manager-reporting` + cas ajoutés sur `manager` et `derive-metrics`.
