# Session — Correctifs audit + fiabilisation poller (17–26 juillet 2026)

Session de correction sur les lots de l'audit ORQA + deux incidents dev
diagnostiqués et corrigés en direct. **Tout est commité et poussé** :
`origin/main` = `HEAD` = `8db1152`. Suite : **1267 tests verts**, typecheck
`src/` propre (NB : `tsc` peut râler sur `.next/dev/types/*` généré corrompu —
supprimer ces fichiers, pas un bug du code).

## Commits livrés (du plus récent au plus ancien)

| Commit | Objet |
|---|---|
| `8db1152` | docs CLAUDE.md (poll 2 phases + commit par message) |
| `c2b7cd2` | **Commit du curseur PAR MESSAGE résolu** (`nextCommitTarget` pur) — un kill Vercel à `maxDuration=60` n'efface que le message en cours, un backlog de N CV se vide en ~N relèves au lieu de boucler |
| `fa77912` | **Poll en 2 phases** : collecte IMAP brève → traitement HORS connexion — le socket mourait pendant les minutes d'analyse LLM, le crash (avalé, SIL-7) sautait le commit ⇒ re-analyses en boucle (incident 24/07, 3 jours de boucle muette). Crash désormais loggé + `last_error` |
| `b6ca3fd` | **Refonte rails retry (validée DO)** : dé-wrap `CVExtractError` (le wrap `new Error('extract_failed…')` détruisait le type avant classification → docx illisible parti en retry, incident 21/07) ; backoff **1/5/15 min plafond 3** (~21 min, plus 7 h) ; **découplage curseur/retry** (`buildFetchSet` : uid en retry re-fetché NOMMÉMENT, la file ne bloque plus jamais) ; fail-safe INVERSÉ (persist KO ⇒ abandon signalé, plus de gel sans fin) ; différé HITL compte dans le plafond |
| `6b6d02b` `18811e7` | Fil d'activité Bureau : date+heure complètes, format compact « 18/07/26, 14:32 » (`formatFrDateTimeShort`) |
| `c144f71` | **C7 ✅** : sync tasks + artifacts ne perd plus en silence — `persistTask`, registres `failedTasks`/`failedArtifacts` (artefact conservé AVEC contenu), bannière 3 registres + réessai |
| `ef202d1` | **C4** : CV reçu sans fiche validée → binaire stocké + file `pending_sheet` (`imap_unmatched_cvs`), **drain automatique** à la validation de la fiche (hooks PUT/PATCH campagnes), cœur de rejeu partagé `unmatched-replay.ts`, garde 409 rejeu-sans-fiche |
| `72fb337` | **C10 résidus** : A11 (sélection audit exhaustive) + A13 (fulltext borné explicite « 200 sur N ») |

## État de l'audit ORQA (`docs/audit/audit-orqa.md`, tableau à jour)

- **Tous les 🔴 critiques sont codés.** C1 ✅, C7 ✅ ; C2–C6, C8–C11 « en cours » =
  codés + validés dev, **n'attendent que migrations + vérifs prod**. Reste A12
  (décoratif).
- **Prochain lot 🟠 suggéré** : I1 (`send_failed` jamais re-tenté + brief mis en
  file quand même) + I2 (couche d'audit poller en `.catch(() => {})`) — lot 2
  résiduel. Puis I3/I4 (multi-CV par mail, uid cross-boîte), I15/I16, I17.

## ⚠️ À FAIRE EN PROD (le geste prioritaire de la reprise)

1. **Migrations SQL sur le Supabase PROD (projet client) + Reload schema cache**
   — blocs de fin de `scripts/migrate.sql`, idempotents :
   `imap_outreach_claims` (+`confirmed_at`, aussi sur `calcom_webhook_events`),
   `imap_cv_retries`, `imap_unmatched_cvs` (+ **colonnes C4 `campaign_id`/`reason`
   + index**), `pending_validations` (CHECK + `sending_at`).
   Sans elles : **le double mail peut revenir** (claims fail-open), les retries
   abandonnent dès la 1ʳᵉ tentative (fail-safe inversé), pas de drain C4.
2. **`CRON_SECRET` défini dans Vercel** (la route `/api/cron/imap-poll` est
   fail-open sans lui) ; cron-job.org à la minute avec le Bearer ; un seul
   poller par boîte (jamais dev local sur creds prod + cron en même temps).
3. **Vérifs fonctionnelles** (mails NEUFS — le curseur a avancé sur les
   anciens) : un seul `imap_outreach_mail` par CV ; `matchSource:'body'` ;
   docx illisible → `imap_cv_failed` permanent immédiat ET un PDF derrière
   passe dans la même relève ; `GET /api/imap/status` sain.
4. **Lot 0 restant** : signups Supabase fermés, bucket Storage privé.

## Incidents diagnostiqués (à connaître)

- **21/07 « docx en boucle »** : cause = wrap qui détruisait `CVExtractError`
  avant `classifyProcessingError`. Verrou anti-régression :
  `src/lib/imap/__tests__/poller-extract-error.test.ts` + commentaire dans
  `processEmailAttachment`. NE JAMAIS ré-envelopper une erreur d'extraction.
- **24/07 « re-analyses incessantes »** : curseur figé 3 jours car le socket
  IMAP mourait pendant les analyses et le crash était avalé sans une ligne de
  log. Diagnostic par la base : `last_polled_at`/`updated_at` figés = le poll
  ne finit jamais. Réflexe : `mailboxes.last_error` est désormais renseigné sur
  tout crash. **Piège dev associé** : le `setInterval` du scheduler survit aux
  hot-reloads en gardant l'ANCIEN code du poller → tout fix du poller exige un
  **redémarrage du serveur dev**.

## Nettoyage à faire (rm bloqué sandbox pour l'assistant)

```bash
! rm -f scripts/check-imap-loop-tmp.ts scripts/check-migrations-tmp.ts scripts/verify-surfaceb-tmp.ts scripts/verify-volume-tmp.ts
! rm -rf src/app/candidatures-apercu
! rm -f .next/dev/types/routes.d.ts .next/dev/types/validator.ts   # générés corrompus (faux négatifs typecheck)
! git branch -d feat/candidatures-menu feat/nav-reorg-dashboard-admin  # mergées
```

## Pointeurs

- Mémoires à jour : `project_imap_analysis_retry_rails` (refonte 21/07),
  `project_email_intake_requirements` (C4/C11), `project_silent_data_loss`
  (C7 ✅), `project_hitl_send_idempotency`, `project_silent_truncation_c8`.
- Modules purs testés ajoutés : `poll-retry.ts` (`buildFetchSet`,
  `shouldProcessUid`, `nextCommitTarget`), `unmatched-replay.ts`
  (`canReceiveReplay`, `drainPendingSheetCvs`, `replayUnmatchedCv`).
- Diagnostic base en lecture seule : recréer au besoin un script sur le modèle
  `loadEnvConfig` + service role (cf. pattern des `verify-*-tmp.ts`).
