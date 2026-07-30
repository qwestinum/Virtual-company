# Multi-utilisateur — runbook de déploiement et d'exploitation

## ⚠️ PRÉREQUIS BLOQUANT AVANT DE DÉPLOYER CE LOT

**`CRON_SECRET` doit être posé ET vérifié sur l'environnement AVANT le
déploiement.** La route `/api/cron/imap-poll` est passée en **fail-closed**
(I13) : sans la variable, elle répond `500 cron_not_configured` et **la relève
des candidatures par mail s'arrête au déploiement**.

1. Vercel → Settings → Environment Variables → vérifier/poser `CRON_SECRET`
   (production ET preview si le cron y pointe).
2. cron-job.org → vérifier que le job envoie bien
   `Authorization: Bearer <CRON_SECRET>` (même valeur).
3. Après déploiement : un hit manuel sans header doit répondre 401 (et le poll
   planifié doit continuer de tourner — vérifier `GET /api/imap/status`).

## 1. Migration + seed admin (dev d'abord, puis prod)

**⚠️ ORDRE IMPÉRATIF — surtout en PROD : migration → seed admin (UUID de
CET environnement) → SEULEMENT ENSUITE déployer le code du gate.** Le gate
`/admin` lit `recruiters.role` en fail-closed : déployer le code avant le
seed verrouille l'admin hors de `/admin` (et masque la section Recruteurs).
Le seed est MANUEL et PAR ENVIRONNEMENT : dev et prod ont des `auth.users`
différents — jamais d'UUID/email en dur rejoué partout (l'ancien seed cléé
sur un email no-opait en silence, incident 30/07/2026).

1. Appliquer `scripts/migrate.sql` EN ENTIER (deux fois — règle de double
   application). La table `recruiters` est créée VIDE : c'est attendu.
2. **Seed admin (manuel)** : Dashboard → Auth → Users → copier l'UUID du
   compte admin de CET environnement, puis exécuter :

   ```sql
   insert into public.recruiters (id, display_name, email, role)
   values ('<UUID_ADMIN>', 'QWESTINUM', '<EMAIL_ADMIN>', 'admin')
   on conflict (id) do nothing;
   ```

3. **Backfill des campagnes historiques** (dépend du seed — relancer après) :

   ```sql
   update public.campaigns
      set owner_user_id = (
        select id from public.recruiters where role = 'admin'
        order by created_at asc limit 1
      )
    where owner_user_id is null;
   ```

4. **Vérifier AVANT de déployer le code** :
   `select id, email, role, is_active from public.recruiters;`
   → une ligne `admin` active dont l'id = l'UUID du compte. Table vide =
   STOP, ne pas déployer.
5. Dashboard Supabase → **Reload schema cache** (sinon « column not found in
   schema cache »).
6. Déployer le code, puis vérifier : `/admin` accessible avec le compte
   admin, `/settings` affiche la section « Recruteurs ».

## 2. Verrouiller les signups Supabase (dev ET prod)

Dashboard Supabase → Authentication → Sign In / Up → **désactiver « Allow new
users to sign up »**. Tant que ce toggle est ouvert, n'importe qui possédant
l'anon key peut se créer une session valide pour tout l'espace. À vérifier sur
**chaque environnement** avant l'ouverture du premier compte member.

## 3. Ajouter un recruteur (procédure admin)

1. Dashboard Supabase → Authentication → Users → **Invite user** (email pro).
   Le recruteur définit son mot de passe via le lien reçu.
2. Copier l'**UUID** du compte créé (colonne id).
3. App → Paramètres → **Recruteurs** → « Ajouter un recruteur » : coller
   l'UUID, l'email, le nom affiché, et le **lien Cal.com personnel** (cf. §4).
4. (Optionnel) Poser ce recruteur comme **référent** de ses campagnes :
   édition de campagne → bloc « Recruteur référent ».

Un recruteur qui part : **Désactiver** (jamais de suppression — ses actions
passées restent attribuées). Il sort des sélecteurs et son agenda n'est plus
résolu (repli global).

## 4. Agenda Cal.com personnel (architecture « comptes séparés », option A)

Chaque recruteur a **son propre compte Cal.com (Free)** : vrai calendrier
connecté, vraies disponibilités, login propre.

À l'onboarding de chaque recruteur :

1. Le recruteur crée son compte Cal.com + un event-type « Entretien » et
   connecte son calendrier. Son lien : `https://cal.com/<username>/<slug>` →
   à renseigner dans Paramètres → Recruteurs.
2. **Enregistrer le webhook sur SON compte** (obligatoire — un webhook est
   propre à un compte ; sans lui, ses bookings n'arrivent jamais à l'app) :
   - UI : Settings → Developer → Webhooks → New —
     `Subscriber URL = https://<app>/api/webhooks/calcom`,
     événement `BOOKING_CREATED`, **Secret = la valeur de
     `CAL_COM_WEBHOOK_SECRET`** (LE MÊME secret pour tous les comptes : la
     route ne vérifie qu'un secret unique) ;
   - ou API : `POST https://api.cal.com/v2/webhooks` avec la clé API du
     recruteur (`Authorization: Bearer cal_…`), body
     `{"subscriberUrl":"…","triggers":["BOOKING_CREATED"],"active":true,"secret":"…"}`.
3. Tester : réserver un créneau de test → le brief DRH doit partir ; le
   journal `interview_brief_delivered` porte `organizerEmail`/`eventTypeId`
   (traçabilité : quel agenda a produit le RDV).

Rappels de fonctionnement :
- Le **matching** booking → candidat se fait par l'email du candidat — il est
  indifférent au compte source. Deux exigences seulement : même URL, même
  secret.
- **Résolution du lien** dans les mails d'invitation : référent de la
  campagne (actif, lien renseigné) → lien global (Paramètres → Entretiens) →
  env `CAL_COM_EVENT_URL` → sinon invitation bloquée.
- Bascule possible plus tard vers l'option B (Team Cal.com payante +
  event-types « Collective » mono-hôte, un seul webhook team) — pur setup,
  zéro changement de code.

## 5. Rôles et périmètres

- **member** : tout l'espace métier (campagnes, candidatures, validations,
  vivier, reporting, settings métier). PAS `/admin`, pas les coûts IA (le
  Bureau lui répond avec agents vidés et coût 0), pas les diagnostics
  techniques (`/api/imap/*`, `/api/metrics/campaigns/*`, `/api/email/status`),
  pas la gestion des recruteurs.
- **admin** : tout, plus `/admin`, les coûts, les diagnostics et la section
  Recruteurs. Le rôle vit dans `recruiters.role` (source unique) — promotion :
  `update recruiters set role = 'admin' where id = '<uuid>'`.
