# Déploiement client — isolation (Voie A) & mise en production

Deux sujets :
1. **Voie A** — modèle d'isolation : une instance (Supabase + déploiement) par client.
2. **Mise en production réelle** — passer du prototype localhost à un client vivant,
   avec les points durs à régler avant.

> Rappel : le projet est mono-tenant (pas de cloisonnement par utilisateur). Voir
> [README.md](README.md). L'alternative à la Voie A serait la **Voie B** (multi-tenant
> dans une base unique : `user_id`/`org_id` + RLS sur toutes les tables et tous les
> repos/routes) — non implémentée, c'est un chantier (cf. `docs/BACKLOG.md`).

---

## Voie A — une instance par client

**Principe.** 1 client = 1 projet Supabase + 1 déploiement de l'app, avec son propre
`.env.local`. Le code est identique partout ; seules les variables d'environnement et
les réglages in-app changent. Isolation totale, **zéro modification de code**.

**Avantages** : isolation forte immédiate, colle au positionnement « Process First »
(un engagement = un environnement). **Inconvénients** : N projets/déploiements à gérer ;
pas de vue cross-clients (chaque client est un silo).

### Runbook de provisioning (à répéter par client)

1. **Projet Supabase dédié** (free tier OK). Noter région + mot de passe DB.
2. **Schéma** : SQL Editor → coller tout `scripts/migrate.sql` → Run. Idempotent ;
   crée les tables (`campaigns`, `fdps_archived`, `journal`, `mailboxes`, …),
   l'extension `pg_trgm`, et le bucket Storage `artifacts`. Vérifier tables + bucket.
3. **Auth** : désactiver l'**inscription publique** ; créer le compte du client
   (Authentication → Users).
4. **Clés Supabase** : Settings → API → `Project URL`, `anon public`, `service_role`.
5. **Secrets propres au client** : `MAILBOX_ENCRYPTION_KEY` (`openssl rand -hex 32`,
   une fois), `EMAIL_DRH`, `CAL_COM_EVENT_URL`, `EMAIL_FROM`.
6. **`.env.local`** depuis `.env.example` (voir
   [configuration-client.md](configuration-client.md) couche 1). Per-client :
   les 3 clés Supabase + `MAILBOX_ENCRYPTION_KEY` + emails/Cal.com. `OPENAI_API_KEY`
   et `RESEND_API_KEY` : par client de préférence (attribution des coûts).
7. **Déployer** l'instance (voir plus bas), un sous-domaine par client.
8. **Réglages in-app** : `/settings` + `/settings/mailboxes` (couches 2-3).
9. **Smoke test** (couche 4) : login → campagne → upload CV → mail reçu.

---

## Mise en production réelle (VPS Hostinger = cible du projet)

> Le projet reste un **prototype** (`CLAUDE.md` : « fonctionnel > beau > performant »).
> « Déployer vraiment » implique de traiter d'abord les **2 bloqueurs** ci-dessous,
> pas seulement de lancer `next start`.

### Phase 0 — Les 2 vrais bloqueurs (sinon le cœur métier casse en silence)

**B1. Extraction PDF des CV sur la plateforme cible.**
Le code dépend du binaire natif `@napi-rs/canvas` (**linux x64 glibc**) + d'un worker
pdfjs résolu par chemin `process.cwd()/node_modules/...` (`next.config.ts`,
`src/lib/agents/cv-extract.ts`).
- VPS **Ubuntu/Debian x64** → OK. **Alpine/musl** ou **arm64** → l'analyse CV casse
  (message dégradé mais inutilisable).
- **Ne PAS utiliser `output: 'standalone'`** (prune `node_modules` → casse le worker).
  Déployer avec `node_modules` complet (`next start`).
- À **valider en premier** sur le VPS (upload d'un vrai PDF). Si la cible n'est pas
  x64 glibc → migrer vers **`unpdf`** (~1 h, supprime le binaire natif). Cf.
  `docs/BACKLOG.md` « Robustesse du parsing PDF ».

**B2. Délivrabilité email.**
Refus candidats / invitations Cal.com partent via Resend. Défaut actuel
`EMAIL_FROM=onboarding@resend.dev` et **pas de DMARC** → spam quasi garanti.
- Vérifier le **domaine d'envoi du client** dans Resend (DKIM + SPF), poser un
  enregistrement **DMARC** en DNS, mettre `EMAIL_FROM` sur ce domaine. Cf.
  `docs/BACKLOG.md` « Délivrabilité email ».

### Phase 1 — Provisionner le back

1. **Projet Supabase prod** dédié → `scripts/migrate.sql`.
2. **Auth** : inscription publique désactivée, compte client créé.
3. **Backups** : backups automatiques Supabase (tier payant) ou `pg_dump` cron.
4. **Secrets** : `OPENAI_API_KEY` (+ limite de dépense), `RESEND_API_KEY`,
   `MAILBOX_ENCRYPTION_KEY`, 3 clés Supabase, `EMAIL_DRH`, `CAL_COM_EVENT_URL`.

### Phase 2 — Déployer l'app sur le VPS

> Vercel déconseillé ici (binaire natif PDF + worker filesystem, mal adaptés au
> serverless). VPS = le bon choix avec le code actuel.

1. VPS **Ubuntu x64**, **Node 20+** (aligné Next 16).
2. `git clone` → `npm ci` → `npm run typecheck && npm run test` → `npm run build`.
3. Poser `.env.local` (valeurs prod, jamais committé).
4. Process manager : `pm2 start "npm run start" --name client-x` (ou systemd), port 3000.
5. **Reverse-proxy nginx** → `client.tondomaine.fr`, **HTTPS Let's Encrypt** (certbot).

### Phase 3 — DNS & domaine

- `A` record `client.tondomaine.fr` → IP du VPS.
- Enregistrements email (SPF/DKIM/**DMARC**) pour le domaine d'envoi (cf. B2).

### Phase 4 — Veille emails (réception CV)

Le poller IMAP tourne via `setInterval` **dans le process Node**
(`src/lib/imap/scheduler.ts`) → vit tant que pm2/systemd tient le process. Plus
robuste : faire taper l'endpoint **`/api/imap/poll-now`** par un **cron système**
(`curl` chaque minute) ou un cron Supabase (le code le recommande lui-même).

### Phase 5 — Go-live : smoke test réel

Connecté en tant que client : créer une campagne → **uploader un vrai CV PDF**
(valide **B1**) → vérifier extraction + scoring → déclencher un **mail de refus** et
confirmer qu'il **arrive en boîte de réception** (valide **B2**) → vérifier le dashboard.

### Ops minimum

- Logs (`pm2 logs` / `journalctl`), check uptime.
- Route `/health` : **n'existe pas encore** — à ajouter pour le monitoring.
- Sauvegarde du `.env.local` hors serveur.

---

## Récapitulatif des « à faire avant un vrai client »

- [ ] **B1** : extraction PDF validée sur la plateforme cible (ou migration `unpdf`).
- [ ] **B2** : domaine d'envoi vérifié (DKIM/SPF) + DMARC + `EMAIL_FROM` du client.
- [ ] Projet Supabase **prod** distinct du dev, backups activés.
- [ ] Inscription publique Supabase Auth **désactivée**, compte client créé.
- [ ] `OPENAI_API_KEY` avec **limite de dépense**.
- [ ] `npm run build` + suite de tests verts.
- [ ] HTTPS + domaine + reverse-proxy.
- [ ] Poller IMAP déclenché de façon fiable (cron sur `/api/imap/poll-now`).
- [ ] (Recommandé) route `/health` + monitoring.
