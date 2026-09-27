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
| `CRON_SECRET` | Bearer des crons — OBLIGATOIRE (fail-closed : sans lui, la relève mail s'arrête). Vercel l'**injecte lui-même** dans l'appel de ses Cron Jobs quand la variable porte exactement ce nom | chaîne aléatoire |
| `CRON_ENABLED` | **`1`** = les crons de `vercel.json` travaillent sur ce projet ; toute autre valeur (ou absente) ⇒ 200 `{ enabled: false }`, rien n'est lu. Instances **client et démo** seulement — **JAMAIS la dev** (§1.1) | `1` |
| `MAILBOX_ENCRYPTION_KEY` | Clé de chiffrement des mots de passe IMAP | `openssl rand -hex 32`, **unique par projet, jamais changée** (la roter invalide toutes les boîtes) |

> `.env.local` est **gitignored** — ne jamais le committer. Le sauvegarder hors serveur.

### 1.1 Relève périodique — Vercel Cron (depuis le 27/09/2026, remplace cron-job.org)

Les crons sont déclarés dans **`vercel.json`** (à la minute, plan Pro) : `/api/cron/imap-poll`
(relève des candidatures par mail, drain des réservations, maintenance). Le fichier est **commun
à tous les projets** (dev, démo, clients) ; chaque projet Vercel qui le déploie en production
déclenche donc ses crons. D'où deux variables par projet :

- **`CRON_SECRET`** — authentification fail-closed (`src/lib/auth/cron-auth.ts`) : absente ⇒ 500,
  mauvais secret ⇒ 401. Vercel injecte `Authorization: Bearer <CRON_SECRET>` lui-même.
- **`CRON_ENABLED=1`** — garde par projet (`src/lib/auth/cron-enabled.ts`), vérifiée AVANT
  l'authentification : sans elle, la route répond 200 `{ enabled: false }` sans rien lire ni
  écrire. **Règle : un seul déclencheur par base.** La dev partage sa base avec la démo et le
  minuteur local la relève déjà (pause après 15 min d'inactivité) : **`CRON_ENABLED` n'est
  JAMAIS posée sur la dev.**

**Vérification** : Vercel → projet → *Settings → Cron Jobs* : les exécutions de
`/api/cron/imap-poll` répondent **200** avec un corps de compteurs (et non `{ enabled: false }`,
qui signale une variable manquante). Les crons ne tournent que sur le déploiement de
**production** du projet, pas sur les previews.

**`/api/cron/busy-calendars`** (connecteur d'agenda externe, branche `feat/agenda-externe`,
pas encore sur `main`) : son entrée `vercel.json` arrive avec la route, sous la même garde.
L'ordre d'activation ne change pas — le job existe dès le déploiement, mais le module ne lit
RIEN tant que `BUSY_CALENDAR_ENABLED` est absent : ce drapeau reste posé **en dernier**.

**Runbook de migration cron-job.org → Vercel Cron**, projet par projet, **prod en dernier** :

1. Poser `CRON_SECRET` (s'il n'existe pas déjà) et `CRON_ENABLED=1` sur le projet — **jamais sur
   la dev**.
2. Déployer (les variables ne sont lues qu'au déploiement).
3. Vérifier dans *Cron Jobs* que les exécutions répondent 200 avec des compteurs.
4. Supprimer le(s) job(s) cron-job.org de ce projet.
5. Pendant 24 h, vérifier qu'aucun double poll n'apparaît au journal (un seul déclencheur :
   `mailboxes.last_polled_at` avance d'environ une minute, pas deux relèves par minute ; aucun
   doublon d'analyse ni de mail).

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

### 2.1 Comptes rendus d'entretien — import de transcription

Réglage `interview_config.transcriptImportEnabled` (jsonb, **activé par
défaut**), section « Comptes rendus d'entretien » de `/settings`
(administrateurs). Éteint : le bouton « Importer une transcription » disparaît,
le compte rendu reste rédigeable à la main. Aucune migration : le champ vit dans
`interview_config` (défaut appliqué aux configurations existantes).

> **Import de transcription d'entretien — à lire par le DPO avant activation.**
> ORQA ne conserve aucune transcription : le texte est lu en mémoire, sert à
> proposer un compte rendu, puis est abandonné, y compris en cas d'échec. En
> revanche, **le texte intégral transite par le fournisseur de modèle de langage**
> configuré pour l'analyse des CV. Ce fournisseur peut le conserver **jusqu'à
> 30 jours** (détection d'abus), **comme les CV** — même fournisseur, même
> contrat de sous-traitance ; zéro avec un accord de non-conservation. Une
> transcription d'entretien est plus riche qu'un CV et plus exposée aux données
> sensibles. L'information et le consentement du candidat à l'enregistrement et
> à la transcription relèvent du client. Réglage : `/settings`, désactivable à
> tout moment ; désactivé, le compte rendu reste saisissable à la main.

À l'onboarding : **faire lire ce paragraphe au DPO du client, et désactiver
l'import s'il le refuse**, avant le premier entretien.

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
- [ ] `CAL_COM_EVENT_URL` = lien de réservation du client (repli global).
- [ ] `CAL_COM_WEBHOOK_SECRET` posé + webhook enregistré sur CHAQUE compte Cal.com recruteur (même URL, même secret — docs/ops/multi-utilisateur.md §4).
- [ ] `CRON_SECRET` + `CRON_ENABLED=1` posés sur le projet Vercel, exécutions *Cron Jobs* en 200 (§1.1) — plus de cron-job.org.
- [ ] Compte du client créé dans Supabase Auth (inscription publique désactivée).
- [ ] Smoke test : login → campagne → upload CV → mail de refus reçu en boîte.
