# Spécification — Multi-utilisateur (recruteurs, agendas, rôles)

Document de référence **fonctionnel ET technique** du modèle multi-utilisateur.
Livré et mergé le 30/07/2026 (commits `e9d1494` → `a53ca16`). Runbook
d'exploitation : `docs/ops/multi-utilisateur.md`. Mémoire associée :
`project_multi_user`.

---

## 1. Modèle cible (validé)

Plusieurs recruteurs d'une même entité partagent l'espace : **tout le métier
est commun** (campagnes, candidatures, vivier, compteurs — AUCUN
cloisonnement de données, c'est un choix, pas un oubli). Ce qui est
**individuel** :

- l'**agenda Cal.com** (chaque recruteur a son lien de réservation) ;
- l'**identité dans les actions** (pattern `decided_by_user_*` existant,
  toujours capturée côté serveur, jamais du payload) ;
- l'**accès admin** (rôle).

## 2. Référentiel des recruteurs

Table `recruiters` : `id` (= `auth.users.id`, sans FK dure — pattern
snapshot, un recruteur parti reste référencé par ses actions), `display_name`,
`email`, `calcom_link` (nullable), `role` (`admin` | `member`), `is_active`
(désactivation **douce**, jamais de suppression), `created_at`. RLS activée
sans policy (le service_role applicatif bypasse ; l'anon key ne lit rien).

**Cycle de vie d'un recruteur** :
1. Invitation Supabase (Dashboard → Auth → Users → Invite user) — crée le
   *compte* ; c'est le seul canal, les **signups publics sont verrouillés**.
   Un compte invité mais non référencé peut se connecter et voit tout le
   métier (session = accès métier) ; il se comporte partout en member
   fail-closed, sans agenda ni éligibilité référent.
2. Référencement dans l'app (Paramètres → **Recruteurs**, admin-only) — le
   compte apparaît dans le **sélecteur des comptes non référencés**
   (`GET /api/recruiters/available-accounts`, `auth.admin.listUsers` moins
   les référencés — zéro resaisie d'UUID), nom pré-rempli depuis l'email.
3. Départ : **Désactiver** — sort des sélecteurs et de la résolution
   d'agenda, l'historique reste attribué. Un désactivé n'est pas
   « disponible » : on le **réactive**, on ne le re-crée pas.

**Amorçage** : le premier admin est seedé **manuellement par environnement**
(bloc commenté à placeholders `<UUID_ADMIN>` dans `migrate.sql` — dev et
prod ont des `auth.users` différents ; un seed cléé sur un email en dur
no-opait en silence, incident 30/07). ⚠️ Ordre impératif prod : migration →
seed admin → **seulement ensuite** déploiement du code du gate.

## 3. Référent de campagne et résolution d'agenda

`campaigns.owner_user_id` (nullable, backfill admin) — bloc « Recruteur
référent » dans l'édition de campagne (options = recruteurs **actifs**, via
`/api/recruiters/options` : projection minimale `{id, displayName,
hasCalcomLink}`, accessible à toute session ; avertissements « sans lien »
et « plus actif » affichés).

**Résolution du lien d'agenda — POINT UNIQUE**
(`getResolvedAgendaLink(campaignId)` / `buildInterviewMail`,
`src/lib/agents/server/interview-mail.ts`) :

```
1. référent (owner_user_id) ACTIF avec calcom_link      → lien PERSONNEL
2. interviewConfig.agendaLink (Paramètres → Entretiens)  → lien GLOBAL
3. env CAL_COM_EVENT_URL (historique)                    → repli
4. ''  → gate « invitation bloquée » (inchangé)
```

Fail-soft à chaque étage (référent absent/désactivé/sans lien, hoquet DB ⇒
étage suivant) — rien ne casse tant que les référents ne sont pas posés.
Surfaces couvertes : invitation auto du poller IMAP (gate + rendu), envoi
direct chat, **preview HITL**. ⚠️ **Le preview HITL est le point de vérité
du lien** : l'override d'envoi expédie le HTML relu **tel quel** — toute
logique de lien s'applique au preview, jamais seulement à l'envoi.

## 4. Synthèse par campagne

- **Destinataires des briefs d'entretien**
  (`getSynthesisAudienceForCampaign`) : l'adresse du **référent actif** en
  tête + les adresses de synthèse **cochées** des Paramètres, **dédup
  insensible à la casse** (jamais de double envoi). Sans contexte campagne
  (booking non rapproché) : liste configurée seule. `no_recipient` seulement
  si ni référent ni configurée. Invariant du modèle settings : cochées ⊆
  connues (`resolveActiveSynthesis` filtre).
- **Principal vs copie** (01/09/2026) : le briefing s'adresse au **référent**
  — lui seul est en **destinataire principal** (`to`) ; les adresses de
  synthèse partent en **copie** (`cc`). C'est le geste d'une équipe réelle :
  on écrit à la personne qui doit agir, on tient les autres informés.
  Répartition **pure et testée** (`splitSynthesisAudience`). Sans référent
  (aucun, désactivé, adresse non expédiable, hors contexte campagne), la
  **1ʳᵉ adresse de synthèse** prend la place du principal : un message sans
  destinataire principal n'est pas expédiable et le fournisseur le rejette —
  on ne troque pas une convention contre un envoi qui n'arrive à personne.
  `to` vide = il n'y a personne du tout ⇒ `no_recipient` ; **jamais** un
  message en copie seule. Surfaces : briefing d'entretien (Cal.com et natif),
  notice « réservation non rapprochée », mails de déplacement/annulation du
  module natif.
- **`replyTo` des mails candidat** (invitation/refus, IMAP + mail-composer) :
  référent → 1ʳᵉ adresse de synthèse → env `EMAIL_DRH`. Une réponse du
  candidat arrive chez SON recruteur. **Inchangé délibérément** : invitation
  vivier et mail sans-suite gardent `replyTo` = adresse de **réception** (le
  poller doit rattacher leurs réponses).

## 5. Cal.com — architecture retenue (option A)

**Comptes Cal.com séparés par recruteur** (Free) : vrais agendas,
disponibilités et logins individuels. **Un webhook PAR compte** (même URL +
**même `CAL_COM_WEBHOOK_SECRET`** — la route n'en vérifie qu'un), procédure
d'onboarding au runbook §4.

- ⚠️ **Piège vérifié** (doc + code source Cal.com) : un webhook *team* ne
  couvre QUE les « team event types » — PAS les event-types personnels des
  membres. Ne jamais « mettre les recruteurs dans une team » en croyant
  régler le webhook.
- Le **matching** booking → candidat reste par **email du candidat**
  (`attendees[0].email`) — indifférent au compte/event-type source.
- `organizer.email`/`organizer.username`/`eventTypeId` sont captés au parseur
  et **journalisés** (`interview_brief_delivered`) — traçabilité « quel
  agenda a produit ce RDV » (détecte un référent mal posé). Jamais utilisés
  pour le matching.
- Bascule possible vers l'option B (Team payante + N event-types
  « Collective » mono-hôte, un seul webhook team) : pur setup, zéro code.

## 6. Rôles et autorisation

Rôle lu de **`recruiters.role` seul** (pas de custom claim — pas de deuxième
source de vérité). L'autorisation est **applicative** (le service_role
bypasse la RLS) :

- **Proxy** (`src/proxy.ts` — Next 16, pas de `middleware.ts`) : session
  exigée partout (pages protégées + `/api/*` deny-by-default) ; `/admin`
  exige EN PLUS le rôle admin (lookup limité au préfixe, **fail-closed** :
  table absente / ligne absente / désactivé / doute ⇒ redirect `/app`).
- **Routes API techniques** : `requireAdminApiUser()` (cache rôle 60 s,
  401 sans session / 403 member) sur `/api/metrics/campaigns/*`,
  `/api/imap/*`, `/api/email/status`, `/api/artifacts/test-connection`,
  `/api/recruiters` (+ `available-accounts`).
- **`/api/metrics/global` SCINDÉ** (il sert des surfaces member — Bureau,
  campagnes) : un member reçoit le payload métier intact avec
  `agents: []` et `kpis.costEstimate: 0` ; un admin reçoit tout.
- **Périmètre member** : tout le métier (campagnes, candidatures,
  validations, vivier, reporting, settings métier) ; PAS `/admin`, les
  coûts IA, les diagnostics, la gestion des recruteurs.
- Section « Recruteurs » des Paramètres rendue **côté serveur** (flag
  `isAdmin` calculé dans `settings/page.tsx`).

## 7. Sécurisation associée

- **`CRON_SECRET` fail-closed** (I13) : absent ⇒ `500 cron_not_configured`,
  comparaison `timingSafeEqual`. ⚠️ Poser la variable AVANT tout déploiement
  (runbook §0) — sinon la relève mail s'arrête.
- **Anti open-redirect** : `?next` du login assaini (`sanitizeNextPath` —
  chemin relatif interne uniquement) sur les trois lecteurs (page login,
  callback, formulaire).
- **Signups Supabase** : à désactiver dans le dashboard (dev ET prod) —
  vérifié par le DO, non vérifiable depuis le code.
- Résiduel connu (backlog) : `/validations-vivier` échappe au préfixe
  `/validations` du proxy (page shell, APIs gatées).

## 8. Tests

Unitaires : chaîne de résolution d'agenda (5 cas dont désactivé et
fail-soft), fusion synthèse (dédup casse), `sanitizeNextPath`, cron
fail-closed, parseur organizer. Régression **S10** : lien perso dans le
**preview** ET l'envoi réel + `replyTo` référent, fallback global, référent
désactivé, gate 401/403/200 par rôle, metrics scindé, métier accessible au
member, sélecteur de comptes, **chaîne webhook complète signée HMAC** (brief
au référent + configurées avec dédup, organizer journalisé). Identité
simulée par mock de `getAuthServerClient` — gates et résolutions réels.
