# Brief — prochaine session (préparé le 30/07/2026)

Contexte : les chantiers « sans-suite » et « multi-utilisateur » sont livrés
sur `main` local (cf. `SESSION_2026-07-29_30.md`), validés en dev (S1-S10
verts). **Rien n'est déployé en prod.** La priorité de la reprise est la mise
en production ORDONNÉE, puis l'onboarding des vrais recruteurs.

## 1. PRIORITÉ — Mise en production (ordre IMPÉRATIF)

Runbook détaillé : `docs/ops/multi-utilisateur.md`. Résumé ordonné — chaque
étape conditionne la suivante :

1. **`CRON_SECRET` posé + vérifié sur Vercel prod** (et le Bearer identique
   côté cron-job.org). Sans lui, le déploiement ARRÊTE la relève mail
   (route fail-closed).
2. **Migration `scripts/migrate.sql` sur le Supabase PROD** — fichier
   entier, **deux exécutions successives** (règle de double application),
   puis **Reload schema cache**. Rappel : les migrations des lots audit de
   juillet (claims `confirmed_at`, `imap_cv_retries`, C4…) doivent déjà y
   être — vérifier, même fichier.
3. **Seed admin PROD** : décommenter le bloc `<UUID_ADMIN>` avec l'UUID du
   compte prod (Auth → Users), exécuter, re-commenter ; puis le backfill
   `owner_user_id`. **Vérifier `select * from recruiters` — table vide =
   STOP, ne pas déployer** (sinon l'admin est verrouillé hors de `/admin`).
4. **Signups Supabase désactivés** (dashboard, dev ET prod).
5. `! git push origin main` → déploiement Vercel.
6. Vérifications post-déploiement : `/admin` accessible (compte admin),
   section « Recruteurs » visible, hit cron sans header → 401, poll vivant
   (`/api/imap/status`), **vérification visuelle** du ruban « Sans suite »
   et de la 5ᵉ ligne du Bureau (demandée à la validation, jamais constatée
   à l'écran).

## 2. Onboarding des recruteurs réels

Pour chaque recruteur (runbook §3-4) : invitation Supabase → référencement
dans Paramètres → Recruteurs (sélecteur de comptes) → compte Cal.com
personnel + event-type → **webhook enregistré sur SON compte** (même URL,
même `CAL_COM_WEBHOOK_SECRET`) → test de réservation (brief reçu par le
référent, `organizerEmail` au journal) → poser le recruteur comme référent
de ses campagnes.

## 3. Chantiers candidats (à arbitrer avec le DO)

- **Cartographie produit du Manager** (backlog, quasi-obligatoire) : les
  surfaces de juillet (référent, section Recruteurs, sans-suite, dialog de
  clôture) sont inconnues de `manager-cartography.ts` — le Manager ne sait
  pas y orienter. Petite passe de libellés exacts.
- **Lot audit 🟠 résiduel** (cf. `docs/audit/audit-orqa.md`) : I1
  (`send_failed` jamais re-tenté + brief mis en file quand même) + I2
  (couche d'audit poller en `.catch(() => {})`), puis I3/I4, I15/I16, I17.
- **Settings I12** : sauvegarde optimiste sans rollback (`SettingsHub`).
- **`/validations-vivier` hors préfixe proxy** (SEC-7 résiduel, backlog).
- **UI de rejeu des `imap_unmatched_cvs`** (backlog historique — la gestion
  actuelle est admin/API only, désormais gatée admin).
- Voir `docs/BACKLOG.md` pour le reste (sans-suite V2, auto-enrôlement
  recruiters, DMARC…).

## 4. OUT (ne pas entamer sans décision)

- n8n / event bus externe (post-MVP).
- Cloisonnement de données par recruteur — le modèle « espace commun » est
  un CHOIX validé, ne pas le remettre en cause au détour d'un ticket.
- Option B Cal.com (Team payante) — bascule setup uniquement si l'ops des
  webhooks par compte devient pénible.

## Rappels d'exécution permanents

- `migrate.sql` = état final idempotent (règle absolue CLAUDE.md) : bloc
  canonique par contrainte, double application dev avant prod.
- Cadrage + inventaire EXHAUSTIF des lecteurs avant de coder (réflexe DO).
- Tests vitest + `npm run typecheck` avant commit ; régression
  `npm run test:regression` (S1-S10) sur DEV avant tout push.
- Le DO pousse lui-même (`! git push origin main`).
