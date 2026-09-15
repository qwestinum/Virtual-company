# Configuration par client — inventaire exhaustif

Tout ce qui se règle pour un client donné, en **4 couches**. En Voie A (une instance
par client), l'ensemble vit dans l'instance et la base Supabase de ce client.

- Couche 1 = **secrets/infra** → fichier `.env.local` (redéploiement requis si modifié).
- Couches 2-3-4 = **réglages applicatifs** → modifiables **dans l'app**, sans redéploiement.

---

## 1. Secrets & infra — `.env.local` (par déploiement)

| Variable | Rôle | Notes |
|---|---|---|
| `OPENAI_API_KEY` | Clé OpenAI (agents + Whisper) | Activer une **limite de dépense** côté OpenAI |
| `NEXT_PUBLIC_SUPABASE_URL` | URL du projet Supabase du client | Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clé anon (auth navigateur) | Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service (accès serveur, **bypass RLS**) | **Secret** — jamais exposée au navigateur |
| `RESEND_API_KEY` | Envoi d'emails (refus, invitations, briefs) | Free tier 100 mails/j OK en démo |
| `EMAIL_FROM` | Adresse expéditeur par défaut | Mettre le **domaine du client** (cf. délivrabilité/DMARC) |
| `EMAIL_DRH` | **Adresse du donneur d'ordre / recruteur** | Reçoit bilans & briefs d'entretien |
| `CAL_COM_EVENT_URL` | Lien de réservation d'entretien du client (repli global — les référents de campagne ont leur lien perso, cf. docs/ops/multi-utilisateur.md) | `https://cal.com/<user>/<event>` |
| `CAL_COM_WEBHOOK_SECRET` | Secret HMAC du webhook Cal.com (Settings → Developer → Webhooks — LE MÊME sur chaque compte recruteur) | chaîne aléatoire |
| `CRON_SECRET` | Bearer des crons `imap-poll` ET `busy-calendars` — OBLIGATOIRE (fail-closed : sans lui, la relève mail et la relève des agendas s'arrêtent) | chaîne aléatoire |
| `BUSY_CALENDAR_ENABLED` | Connecteur d'agenda externe des recruteurs (`docs/specs/agenda-externe.md`). `1` EXACT pour l'allumer — **À POSER EN DERNIER**, cf. §5 | vide = éteint |
| `MAILBOX_ENCRYPTION_KEY` | Clé de chiffrement des mots de passe IMAP | `openssl rand -hex 32`, **unique par projet, jamais changée** (la roter invalide toutes les boîtes) |

> `.env.local` est **gitignored** — ne jamais le committer. Le sauvegarder hors serveur.

---

## 2. Réglages applicatifs — page `/settings` (table `app_settings`, **1 jeu par client**)

`app_settings` est une **ligne unique** (`id = 1`) → un seul jeu de réglages par
instance, cohérent avec « une instance par client ».

| Champ | Rôle |
|---|---|
| `sender_email` | Expéditeur des mails (surcharge applicative de `EMAIL_FROM`) |
| `synthesis_email` | Destinataire des **synthèses / bilans** (le recruteur) |
| `intake_email` | Adresse de **réception des CV** |
| `flux_config` (jsonb) | Config des canaux de **réception** (intégrations) |
| `channels_config` (jsonb) | Config des canaux de **diffusion** d'annonces (intégrations) |

> L'**adresse recruteur** apparaît à deux endroits : `EMAIL_DRH` (env, défaut) et
> `synthesis_email` (réglage in-app). Les aligner pour éviter toute divergence.

---

## 3. Boîtes mail IMAP surveillées — page `/settings/mailboxes` (table `mailboxes`, **N par client**)

Les **infos serveur IMAP du client** se saisissent ici. Le poller surveille ces
boîtes pour la réception automatique des CV.

| Champ | Rôle |
|---|---|
| `label` | Nom lisible de la boîte |
| `imap_host` | Serveur IMAP (ex. `imap.gmail.com`, `mail.client.fr`) |
| `imap_port` | Port (ex. 993) |
| `imap_ssl` | SSL/TLS (oui/non) |
| `user_email` | Adresse de la boîte surveillée |
| mot de passe | Saisi en clair dans l'UI, **stocké chiffré** (`encrypted_password` via `MAILBOX_ENCRYPTION_KEY`) — jamais en clair en base |
| `is_enabled` | Activer / désactiver la surveillance |

Champs techniques tenus par le poller (non saisis) : `last_polled_at`, `last_uid_seen`,
`last_error`.

---

## 4. Par campagne — dashboard (tables `campaigns`, `campaign_mailboxes`)

| Réglage | Rôle |
|---|---|
| Sources de réception (flux) | `manual`, `email`… — détermine l'activation (intake) |
| Seuil d'acceptation | `threshold` 0–100 utilisé par le CV Analyzer |
| Canaux de diffusion | `publishedChannels` (LinkedIn…) — phase publication |
| Fiche de poste / fiche de scoring | Contenu (8 champs FDP, critères pondérés) |
| Boîtes mail associées | Lien campagne ↔ `mailboxes` (`campaign_mailboxes`) |

---

## 5. Activer le connecteur d'agenda externe — ORDRE IMPÉRATIF

> ⚠️ **L'activation se fait EN DERNIER** — la variable `BUSY_CALENDAR_ENABLED=1`,
> puis l'interrupteur du cabinet. Posée avant que la
> relève tourne, le connecteur est actif sans que personne ne surveille les
> agendas : un agenda dépublié **sans visite de candidat** ne fait avancer aucun
> état, ne déclenche ni signal ni email, et le recruteur perd ses rendez-vous
> sans savoir pourquoi. La relève est ce qui rend l'alerte fiable.

Dans cet ordre, sans en sauter ni en inverser :

1. **Migration.** `scripts/migrate.sql` appliqué en entier (colonnes
   `recruiters.busy_ics_url`, `sched_bookings.availability_check`, table
   `recruiter_busy_snapshots` et sa colonne `refresh_claimed_at`), puis **reload
   du cache de schéma**. Le code tolère une migration en retard (il retombe sur
   un comportement plus prudent, et la relève lit quand même — testé), mais on
   n'active pas un client sur un schéma incomplet.
2. **Job cron-job.org DÉDIÉ**, distinct de celui de la relève mail :
   `GET https://<domaine>/api/cron/busy-calendars`, **toutes les minutes**,
   en-tête `Authorization: Bearer <CRON_SECRET>`.
3. **Vérifier la réponse du job** dans l'historique cron-job.org : statut 200 et
   `"calendars": { "enabled": … }`. À ce stade (flag encore absent) on lit
   `enabled: false` — c'est attendu : on vérifie que le job **atteint** la route
   et **s'authentifie** (un 401 = mauvais secret, un 500 `cron_not_configured` =
   `CRON_SECRET` absent côté Vercel).
4. **Seulement maintenant : `BUSY_CALENDAR_ENABLED=1`** côté Vercel, redéployer.
   Rien ne s'allume encore : c'est l'autorisation du déploiement.
5. **Interrupteur du cabinet** : Paramètres → « Agenda externe des recruteurs »
   (administrateur) → cocher « Tenir compte des agendas Outlook des recruteurs »
   → Enregistrer. C'est ce geste qui allume le connecteur ; la section « Agenda
   externe » apparaît alors dans « Agendas & disponibilités ».
6. **Contrôle final** : à l'exécution suivante du job (au plus une minute, plus
   30 s de mémoire du réglage), la réponse doit porter `"enabled": true` (et
   `"recruiters"` = nombre d'agendas déclarés — 0 tant qu'aucun recruteur n'a
   collé de lien). Si elle reste à `false` : variable autre que `1` exact,
   `MAILBOX_ENCRYPTION_KEY` absente/mal formée, ou interrupteur non enregistré —
   le connecteur est alors ÉTEINT, jamais à moitié allumé.

Désactiver : décocher l'interrupteur du cabinet (effet sous 30 s, sans
redéploiement) ; retirer la variable pour faire disparaître la surface. Le job
peut rester (il répond `enabled: false` sans rien lire). Les liens déjà
enregistrés sont conservés — l'écran de chaque recruteur dit qu'ils sont
ignorés, et ils restent retirables.

---

## Checklist d'onboarding d'un nouveau client

- [ ] `.env.local` complété (couche 1), `MAILBOX_ENCRYPTION_KEY` générée une fois.
- [ ] `/settings` : `sender_email`, `synthesis_email` (= recruteur), `intake_email`.
- [ ] `/settings/mailboxes` : la/les boîte(s) IMAP du client (host/port/ssl/login/mdp).
- [ ] Domaine d'envoi vérifié côté Resend (DKIM/SPF) + **DMARC** posé (cf. déploiement).
- [ ] `CAL_COM_EVENT_URL` = lien de réservation du client (repli global).
- [ ] `CAL_COM_WEBHOOK_SECRET` posé + webhook enregistré sur CHAQUE compte Cal.com recruteur (même URL, même secret — docs/ops/multi-utilisateur.md §4).
- [ ] `CRON_SECRET` posé côté Vercel ET cron-job.org (fail-closed).
- [ ] Agenda externe (si activé) : **§5, dans l'ordre** — migration → job cron-job.org dédié → réponse du job vérifiée → **`BUSY_CALENDAR_ENABLED=1` puis interrupteur du cabinet, EN DERNIER** → `enabled: true` constaté à l'exécution suivante.
- [ ] Compte du client créé dans Supabase Auth (inscription publique désactivée).
- [ ] Smoke test : login → campagne → upload CV → mail de refus reçu en boîte.
