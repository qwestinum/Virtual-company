# Session — Fiabilisation du chemin mail IMAP (03–08 juillet 2026)

Session de correction/robustesse sur la **réception des candidatures par email**
(poller IMAP). Trois défauts traités + un durcissement fonctionnel. **Tout est
commité et poussé** : `origin/main` = `HEAD` = `3849bc7`.

## Commits livrés (du plus récent au plus ancien)

| Commit | Type | Objet |
|---|---|---|
| `3849bc7` | feat(imap) | **Rapprochement campagne par l'ID dans le CORPS** du mail, en repli du sujet. Module pur testé `campaign-match.ts` (`resolveCampaignMatch`). |
| `33e1129` | docs(imap) | Bloc IMAP de CLAUDE.md (idempotence outreach + formats CV). |
| `13a2b8a` | fix(imap) | **Support .docx sur le chemin mail** + trace explicite des formats non exploitables (.doc). |
| `3b0f5ed` | fix(imap) | **Idempotence durable de l'outreach** — fin du double mail/brief sur invocations cron concurrentes. |

## Détail des trois problèmes

### 1. Double mail d'invitation en zone verte (`3b0f5ed`)
**Cause** (diagnostiquée sur données prod) : sur Vercel, chaque hit du cron
`/api/cron/imap-poll` est une **instance isolée**. Les gardes anti-doublon du
poller (`__imapPollInFlight__`, `inflight` Set) sont **en mémoire de process** →
ne sérialisent pas deux invocations concurrentes. Elles lisent le même
`last_uid_seen` (committé en fin de poll seulement) et envoyaient DEUX fois le
mail candidat + le brief. Preuve : `candidate_analyses_pkey` violée (avalée) +
deux `imap_outreach_mail` même uid, message-id Resend distincts, ~10–24 s
d'écart.
**Fix** : verrou durable en base `imap_outreach_claims (mailbox_id, uid, mode)`,
sur le modèle de `calcom_webhook_events`. `claimOutreach` réserve juste avant
`sendEmail` (perdu → `SendResult{kind:'duplicate'}`, on n'envoie rien ni le
brief) ; `releaseOutreachClaim` si l'envoi n'aboutit pas (anti-perte). Fail-open
si Supabase absent (dev mono-process).
Mémoire : `project_outreach_idempotency`.

### 2. CV en Word non traités (`13a2b8a`)
**Cause** : `isCvMime` filtrait en PDF-only alors que `extractCVText` (déjà câblé
sur ce chemin) sait lire le .docx via mammoth. Le .docx était rejeté au portail
et compté à tort en `imap_email_no_cv`, sans candidature — un CV évaporé.
**Fix** : module pur `cv-attachment.ts` (PDF+DOCX, détection MIME OU extension —
un .docx en `application/octet-stream` passe) ; `.doc` ancien non extractible →
trace dédiée `imap_cv_unsupported_format` (jamais silencieux) ; repli MIME
filename-aware.

### 3. Rapprochement par le corps du mail (`3849bc7`, demande fonctionnelle)
Le poller ne matchait la campagne que sur l'ID du **sujet**. Ajout du **corps**
en repli, avec trois gardes (analyse de risque faite avant code) :
- **priorité stricte sujet > corps** (nominal inchangé) ;
- **refus de deviner** : ≥2 campagnes actives distinctes dans le corps →
  `imap_ambiguous_body_match`, pas de rattachement (un mauvais rattachement
  silencieux est pire qu'un non-rattachement) ;
- **active > inactive** ; corps = `parsed.text` puis HTML dé-balisé
  (`emailBodyText`) ; `matchSource` tracé dans `imap_cv_received`.

Tests : **1202 verts** (départ session 1188). Typecheck propre.

## À VÉRIFIER / FAIRE EN PROD (Vercel)

1. **⚠️ Migration `imap_outreach_claims` + reload cache PostgREST** — le fix
   double-mail (`3b0f5ed`) est **inerte** sans elle : `claimOutreach` fail-open →
   le doublon **persiste**. Bloc SQL en fin de `scripts/migrate.sql`. Après la
   migration : Supabase → API → *Reload schema cache*. **C'est le geste
   prioritaire de la reprise.**
2. **Vérifier la fin du doublon** : envoyer un CV sur une campagne active en
   auto-accept → un seul `imap_outreach_mail` ; si une passe concurrente a été
   bloquée, un `imap_outreach_duplicate_skipped` à côté (preuve du verrou).
3. **Tester le rapprochement par le corps** : envoyer un mail **neuf** (après
   déploiement) avec `CAMP-XXXX` **dans le corps, pas le sujet** → candidature
   traitée, `imap_cv_received.matchSource = 'body'`. ⚠️ Piège curseur : un mail
   envoyé AVANT le déploiement a déjà fait avancer `last_uid_seen` → il ne se
   rejoue pas, il faut en renvoyer un.

## Décisions / points OUVERTS

- **Trou `none` silencieux (BACKLOG)** : un mail avec un CV en PJ mais AUCUNE
  campagne reconnue (`resolveCampaignMatch → none`) est skippé **sans trace
  journal**. Aligné-négativement avec la règle « pas d'échec silencieux ». Fix
  proposé : trace `imap_no_campaign_match` **conditionnée à une PJ de type CV**
  (ne pas journaliser les newsletters). ~10 lignes + 1 test. Voir
  `docs/BACKLOG.md`.
- **`src/app/candidatures-apercu/`** : aperçu JETABLE (données mockées) créé pour
  valider l'identité ORQA au début d'une session précédente. Non commité,
  toujours présent. Son en-tête dit « À SUPPRIMER après validation ». À purger.
- **Branches locales périmées** : `feat/candidatures-menu`,
  `feat/nav-reorg-dashboard-admin` (déjà mergées dans `main`) — à supprimer.

## Pointeurs

- Source de vérité intake : mémoire `project_email_intake_requirements` (mise à
  jour cette session) + bloc « Réception des CV par email » de CLAUDE.md.
- Idempotence serverless : mémoire `project_outreach_idempotency`,
  `project_imap_poll_per_environment`.
- Modules purs testés ajoutés : `src/lib/imap/cv-attachment.ts`,
  `src/lib/imap/campaign-match.ts`.
