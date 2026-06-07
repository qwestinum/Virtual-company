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
| `CAL_COM_EVENT_URL` | Lien de réservation d'entretien du client | `https://cal.com/<user>/<event>` |
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

## Checklist d'onboarding d'un nouveau client

- [ ] `.env.local` complété (couche 1), `MAILBOX_ENCRYPTION_KEY` générée une fois.
- [ ] `/settings` : `sender_email`, `synthesis_email` (= recruteur), `intake_email`.
- [ ] `/settings/mailboxes` : la/les boîte(s) IMAP du client (host/port/ssl/login/mdp).
- [ ] Domaine d'envoi vérifié côté Resend (DKIM/SPF) + **DMARC** posé (cf. déploiement).
- [ ] `CAL_COM_EVENT_URL` = lien de réservation du client.
- [ ] Compte du client créé dans Supabase Auth (inscription publique désactivée).
- [ ] Smoke test : login → campagne → upload CV → mail de refus reçu en boîte.
