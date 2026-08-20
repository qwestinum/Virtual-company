# Module de réservation natif — spécification de référence

> **Statut** : validée (étude en deux volets, 16/08/2026). Spec de référence des **lots 1 à 5**
> du remplacement de Cal.com. Toute décision de design du module se règle ici avant le code.
>
> Documents liés : `docs/ops/multi-utilisateur.md` (agenda, webhook — à réécrire au lot 5),
> `docs/specs/candidatures-sans-suite.md` (révocation de lien), `docs/specs/hitl-3-zones.md`
> (preview HITL, point de vérité du lien).

---

## 0. Intention

Remplacer Cal.com par un module de réservation **natif** : les candidats réservent leur créneau
d'entretien dans ORQA. Motivations : supprimer la dépendance à un webhook externe (fragile, un
geste d'onboarding par recruteur), fermer la boucle de traçabilité (le RDV devient un objet
ORQA), maîtriser l'expérience candidat, retirer un sous-traitant du périmètre de conformité.

**Contrainte non négociable** : le module est **autonome et réutilisable hors ORQA**.

---

## 1. Frontière d'autonomie

| Le module CONNAÎT | Le module IGNORE |
| --- | --- |
| **Ressource** : personne réservable (fuseau, règles hebdo, exceptions, durée, buffer, préavis, horizon, lieu de rencontre) | Candidat, campagne, entretien, brief, recruteur, HITL, scoring |
| **Cible** : alias re-pointable vers une ressource | Toute table ORQA |
| **Lien** : token nominatif à usage unique, contexte JSON opaque | Le sens du contexte qu'il transporte |
| **Réservation**, **Événement** | Ce que l'hôte en fait |

Coutures avec l'hôte, et elles seules :

1. `external_ref` — clés opaques de l'hôte (jamais parsées) ;
2. `context` / `display` — JSON opaque stocké et **restitué tel quel** ;
3. **ports injectés** — client base, transport email, horloge, URL publique.

**Règles dures** (gardées par le lint de frontière, §11) :

- `src/lib/scheduling/**` n'importe **rien** de `@/` — ni type métier, ni repo, ni util ORQA.
  Seules dépendances autorisées : bibliothèques externes (`luxon`, `@supabase/supabase-js`, `zod`)
  et les fichiers du module lui-même.
- Aucune logique par fournisseur de visio. Le lieu est un couple `{ type, payload }` opaque.
- Le module vit dans `src/lib/scheduling/`, ses tables sont préfixées `sched_`, et il doit
  pouvoir être extrait en package sans réécriture.

---

## 2. Concepts — et pourquoi la « cible » existe

Le référent d'une campagne **change en cours de route**. Figer la ressource dans le lien
obligerait à réémettre tous les liens en vol. D'où l'indirection : un lien pointe une **cible**
(`sched_targets`), jamais une ressource ; l'hôte re-pointe la cible librement.

- **Ouverture de la page publique** : cible → ressource *actuelle* → créneaux. Un re-pointage est
  visible immédiatement par tous les liens émis, **sans réémission**.
- **Confirmation** : la résolution est **re-vérifiée atomiquement** (version de cible + créneau).
  Si l'une a bougé : verdict précis, message propre, rechargement.
- **Réservation prise** : ressource et lieu y sont **figés** — un RDV est un engagement, il ne
  suit jamais un changement de référent. Le déplacer est une **replanification explicite**.
- **Cible sans ressource active** : page dégradée propre, et l'hôte peut lister ces cibles
  (`listOrphanTargets`) pour son panneau de signalement.

### Règles métier associées (validées)

1. Changement de référent ⇒ tous les liens déjà émis montrent l'agenda du **nouveau** référent,
   sans réémission. Les réservations **déjà prises ne bougent jamais**.
2. Campagne sans référent actif à l'ouverture ⇒ page dégradée (« momentanément indisponible, le
   cabinet vous recontactera ») + signal côté ORQA.
3. Le changement de référent dans l'UI **affiche son impact** avant écriture : « X liens de
   réservation actifs basculeront sur l'agenda de [nouveau] ; Y RDV déjà pris chez [ancien] ne
   bougent pas » — même esprit que le dialog de clôture sans-suite.

---

## 3. Schéma de données (`sched_*`)

Tout en `timestamptz` **UTC**. Les règles de disponibilité sont en **minutes locales de la
ressource** (fuseau IANA porté par la ressource) — seule représentation qui survit au changement
d'heure. RLS activée dès la création (aucune policy : le `service_role` applicatif bypasse,
l'anon key ne lit rien).

| Table | Colonnes clés | Rôle & invariants |
| --- | --- | --- |
| `sched_resources` | `id uuid pk` · `external_ref text unique` · `display_name` · `timezone` (IANA) · `slot_duration_minutes` · `buffer_minutes` · `min_notice_minutes` · `horizon_days` · `meeting_location jsonb` · `notify_email` · `is_active` | Personne réservable. `notify_email` : notification organisateur (le module reste utilisable seul). |
| `sched_availability_rules` | `resource_id fk` · `weekday` · `start_minute` · `end_minute` | Règles hebdo récurrentes, **plusieurs plages par jour**. CHECK `start < end`. **`weekday` est ISO-8601 : 1 = lundi … 7 = dimanche** (aligné sur Luxon, zéro conversion — précision apportée au §3 de l'étude qui disait « 0–6 »). |
| `sched_availability_exceptions` | `resource_id fk` · `day date` (locale) · `start_minute null` · `end_minute null` · `label` | Blocage ponctuel. `(null, null)` = journée entière (congé). |
| `sched_targets` | `id uuid pk` · `external_ref text unique` · `resource_id fk null` · `meeting_location_override jsonb` · `version int` | Alias re-pointable. `version` incrémentée à chaque re-pointage → contrôle optimiste à la confirmation. `resource_id null` ⇒ page dégradée. L'override de lieu vit ici (= surcharge « par campagne », **V1**). |
| `sched_booking_links` | `token text pk` · `target_id fk` · `idempotency_key` · **`unique(target_id, idempotency_key)`** · `status active\|used\|revoked\|expired` · `expires_at` · `context jsonb` · `display jsonb` · `revoked_reason` | Lien nominatif à usage unique. L'unicité rend `createBookingLink` **idempotent** (le re-preview HITL rend le MÊME token). `display` = ce que la page publique a le droit d'afficher, fourni par l'hôte. |
| `sched_bookings` | `id uuid pk` · `link_token fk` · `target_id` · `resource_id` (**figée**) · `start_at/end_at` (UTC) · `status confirmed\|cancelled` · `cancelled_by attendee\|organizer` · `cancelled_reason` · `rescheduled_from` · `attendee_*` · `context jsonb` · `meeting_location jsonb` (snapshot) · `manage_token` | **Atomicité** : index unique partiel `(resource_id, start_at) where status='confirmed'` — l'INSERT **est** le claim, un seul gagnant. `manage_token` : unique **parmi les confirmées**, **reporté** lors d'une replanification (tout mail déjà reçu reste fonctionnel). `id` = l'uid consommé par l'hôte. |
| `sched_events` | `id uuid pk` · `type` · `booking_id` · `payload jsonb` (snapshot complet, contexte inclus) · `dispatched_at` · `attempts` · `last_error` | **Outbox** : écrite dans la séquence de l'effet, dispatchée après, drainée par cron si le dispatch immédiat échoue. **At-least-once** ⇒ consommateur idempotent par `event.id`. |

### Séquence de confirmation (à la lettre)

1. Relire **cible** (`resource_id`, `version` = v0) et **lien** (`active`, non expiré) ;
   **revalider le créneau** demandé (règles − exceptions − réservations − buffer − préavis − horizon).
2. **Claim** = `INSERT` de la réservation — l'index unique partiel tranche la concurrence.
   Violation 23505 ⇒ `slot_taken` (la page recharge les créneaux).
3. `UPDATE` conditionnel du lien `active → used`. **0 ligne** (révoqué entre-temps) ⇒
   **compensation** (suppression de la réservation, rien n'a été annoncé) + `link_gone`.
4. Relire `target.version` : **≠ v0** (re-pointage pendant la confirmation) ⇒ compensation +
   `target_changed` + rechargement.
5. `INSERT` outbox, puis dispatch best-effort, puis mails (.ics) via le **port injecté**.
   Crash entre 4 et 5 ⇒ **réparation** au drain (réservation confirmée sans événement
   `booking.created` ⇒ émission de rattrapage) : jamais d'état final non rejouable.

> **Rejeu de confirmation** : si le lien est déjà `used` et qu'une réservation confirmée existe
> pour ce token au même créneau, on **renvoie cette réservation** (succès idempotent) plutôt
> qu'un `link_gone` — un double-clic ou un retour réseau ne doit pas afficher une erreur.

---

## 4. Contrat d'API

### API hôte (fonctions serveur du module)

```
// Ressources
createResource({ externalRef, displayName, timezone, slotDurationMinutes, bufferMinutes,
                 minNoticeMinutes, horizonDays, meetingLocation?, notifyEmail? }): Resource
updateResource(externalRef, patch): Resource              // désactivation = { isActive: false }
getResource(externalRef): Resource | null
setWeeklyRules(externalRef, rules: { weekday, startMinute, endMinute }[]): WeeklyRule[]
listWeeklyRules(externalRef): WeeklyRule[]
addException(externalRef, { day, startMinute?, endMinute?, label? }): AvailabilityException
removeException(exceptionId): void
listExceptions(externalRef, { from?, to? }): AvailabilityException[]
previewSlots(externalRef, { from, to }): Slot[]           // même moteur que le public

// Cibles (alias re-pointables)
createTarget({ externalRef, resourceExternalRef?, meetingLocationOverride? }): Target
getTarget(externalRef): Target | null
repointTarget(externalRef, resourceExternalRef | null): { target, activeLinks }
setTargetLocationOverride(externalRef, MeetingLocation | null): Target
getTargetImpact(externalRef): { activeLinks, confirmedUpcomingBookings: { resourceExternalRef, count }[] }
listOrphanTargets(): { target, activeLinks }[]            // sans ressource ACTIVE + liens actifs

// Liens
createBookingLink({ targetExternalRef, idempotencyKey, context, display, expiresAt? })
  : { token, url, reused: boolean }                       // IDEMPOTENT par (cible, clé)
getBookingLink(token): BookingLink | null
revokeLink(token, reason): 'revoked' | 'already_used' | 'not_found' | 'already_revoked'
revokeLinkByKey(targetExternalRef, idempotencyKey, reason): idem

// Réservation (surface publique côté serveur)
resolveBookingPage(token): { status: 'open'|'degraded'|'gone', display, resource?, slots? }
listSlotsForLink(token, { from, to }): Slot[]
confirmBooking({ token, startAt, attendee: { name, email, phone?, timezone } })
  : { ok: true, booking, manageToken } | { ok: false, reason }
getBookingByManageToken(manageToken): Booking | null
cancelBookingByAttendee(manageToken, { reason? })
rescheduleBooking(manageToken, { startAt })
cancelBookingByOrganizer(bookingId, { reason?, notifyAttendee })
listBookings({ targetExternalRef?, resourceExternalRef?, from?, to?, status? }): Booking[]

// Événements
registerEventConsumer(handler: (event: SchedEvent) => Promise<void>): void
drainPendingEvents({ limit? }): { dispatched, failed, repaired }
```

`confirmBooking` refuse avec un motif précis : `slot_taken`, `link_gone`, `link_expired`,
`link_not_found`, `target_changed`, `resource_unavailable`, `invalid_slot`.

### Événements émis

```ts
type SchedEvent = {
  id: string; occurredAt: string;
  type: 'booking.created' | 'booking.cancelled' | 'booking.rescheduled';  // 'booking.updated' RÉSERVÉ V2
  booking: {
    id: string;                        // = l'uid consommé par l'hôte
    targetExternalRef: string; resourceExternalRef: string;
    startAt: string; endAt: string;    // UTC ISO
    attendee: { name, email, phone: string|null, timezone: string };
    meetingLocation: MeetingLocation | null;   // snapshot figé
    context: unknown;                  // restitué TEL QUEL, jamais interprété
    cancelledBy?: 'attendee' | 'organizer'; cancelReason?: string | null;
    rescheduledFrom?: string; previousStartAt?: string;
  };
};
```

Même rôle que le webhook Cal.com, mais **interne** : pas de signature, pas de parsing tolérant.
La fiabilité vient de l'outbox (at-least-once) + idempotence du consommateur par `event.id`.

---

## 5. Lieu de rencontre

```ts
type MeetingLocation =
  | { type: 'video';     payload: { url: string } }           // salle perso Meet/Teams/Zoom
  | { type: 'in_person'; payload: { address: string } }
  | { type: 'phone';     payload: { instructions: string } }; // qui appelle qui
```

- **Opaque par construction** : zéro logique par fournisseur — le module stocke, résout, injecte.
- **Résolveur unique** : `target.meetingLocationOverride ?? resource.meetingLocation`, appelé à la
  confirmation, puis **snapshot sur la réservation** (un changement ultérieur ne déplace pas les
  RDV pris). Ce point unique est la **couture V2**.
- **Injecté dans** : confirmation candidat, `LOCATION` + description du `.ics`, payload d'événement.
- **Surcharge par campagne = V1** (elle vit sur la cible, qui existe déjà).
- **V2 (esquisse, non implémentée)** : le résolveur devient un provider par API (Meet / Graph),
  génération possiblement asynchrone ⇒ réservation confirmée avec lieu provisoire, puis
  `booking.updated` (type réservé dès maintenant) + `.ics` `SEQUENCE+1`. Prévu aujourd'hui :
  le snapshot par réservation, le type d'événement réservé, une future table
  `sched_provider_credentials` (OAuth par ressource) sans impact sur les tables V1.

---

## 6. Fuseaux horaires & DST

- Stockage **UTC** ; règles en **heure locale ressource** (« lun 9h–12h » reste 9h–12h été comme hiver).
- Génération des créneaux via **Luxon**, jour local par jour local, conversion mur→instant par
  `DateTime.fromObject({ … }, { zone })`. **Aucune arithmétique d'offset manuelle.**
- **Heure locale inexistante** (passage à l'heure d'été) : Luxon décale silencieusement
  (02:30 → 03:30). Le moteur **détecte et écarte** ces créneaux (comparaison heure obtenue vs
  heure demandée) — jamais de créneau fantôme.
- **Heure locale ambiguë** (retour à l'heure d'hiver) : Luxon retient la **première** occurrence ;
  comportement déterministe et documenté.
- **Transitions Europe/Paris de référence pour les tests** : **25/10/2026** (ambiguë) et
  **28/03/2027** (sautée) — ce sont les derniers dimanches de mois, vérifiés par le calendrier.
  Les lendemains (26/10, 29/03) sont testés aussi : c'est là qu'une implémentation naïve dérive
  d'une heure.
- Affichage candidat : fuseau du navigateur (`Intl`) + sélecteur ; le fuseau choisi est stocké sur
  la réservation et repris dans les mails (« 14h00, heure de Paris »).

---

## 7. Écrans (V1)

1. **Fiche recruteur — disponibilités & lieu** (Settings) : durée / buffer / préavis / horizon,
   grille hebdo (plusieurs plages par jour), exceptions datées, aperçu des prochains créneaux,
   lieu de rencontre par défaut (visio + mini-guide « où trouver mon lien » par outil, présentiel,
   téléphone). Remplace le champ « lien Cal.com personnel ».
2. **Page publique candidat** (`/r/{token}`, sans authentification) : semaine de créneaux,
   sélecteur de fuseau, formulaire (nom, email, tél. optionnel), confirmation avec lieu + `.ics` +
   lien de gestion. États : créneau soufflé, lien révoqué/expiré, cible sans référent (dégradée).
3. **Vue des RDV dans l'app** — onglet « Entretiens » : bandeau des campagnes à liens actifs sans
   référent, filtres, agenda par jour, actions annuler / replanifier, compteurs « en attente de
   réservation » et « liens expirés ».

---

## 8. Intégration ORQA (lot 3)

| Concept module | Côté ORQA |
| --- | --- |
| Ressource | Recruteur (`external_ref` = `auth.users.id`), créée/màj depuis la fiche recruteur. Désactivation douce ⇒ `isActive:false`. |
| Cible | **Une par campagne** (`external_ref` = `CAMP-XXXX`), créée paresseusement à la première invitation, pointée sur `owner_user_id`. **Pas de cible d'organisation** : campagne sans référent = cible orpheline (page dégradée + panneau), gate « invitation bloquée » en amont. |
| Lien | `idempotencyKey` = `uid` d'analyse ; `context = { uid, campaignId }` ; `display` = intitulé du poste, organisation, prénom. Émis par le remplaçant de `getResolvedAgendaLink` — **qui reste le point unique** (poller IMAP, mail-composer, preview HITL le traversent tous). |
| Réservation | `booking.id` → `interview_briefs.booking_uid` **tel quel** : machine d'états, idempotence et réouverture sans-suite inchangées. |

**Preview HITL** : le preview appelle `createBookingLink` (idempotent) — le re-preview et l'envoi
rendent le même token, donc **le DRH relit le vrai lien**. Refus ⇒ `revokeLinkByKey(uid)`. TTL par
défaut **~30 j**, aligné sur le lien CV signé. Un token mort d'un candidat refusé est **tracé**
(`revoked_reason`), pas un problème.

**Mapping des événements**

| Événement | Effet ORQA |
| --- | --- |
| `booking.created` | Claim deux-phases par `event.id` (succède à `calcom_webhook_events`, même `claims-policy`) → brief en attente retrouvé **par `context.uid`** → délivrance existante (mail synthèse + CV + `.ics`) avec le `meetingLocation` de l'événement → `markBriefScheduled(booking.id)` → journal → confirm. « Unmatched » impossible par construction. |
| `booking.cancelled` (attendee) | Brief `scheduled → awaiting_booking` (chemin de restauration existant) + journal + signal DRH. Pas de réémission automatique de lien en V1. |
| `booking.cancelled` (organizer) | Même transition. Candidat notifié par le module **sauf `notifyAttendee:false`** — utilisé par le sans-suite, dont la matrice de mails porte déjà la communication (jamais deux voix). |
| `booking.rescheduled` | Mise à jour des faits du brief (dates/lieu) + journal + mail court à la synthèse avec `.ics` mis à jour (même UID, `SEQUENCE+1`). |

**Sans-suite** : `dismissCandidature` ajoute `revokeLinkByKey(uid)` — le lien meurt vraiment — et,
si un RDV futur est confirmé, `cancelBookingByOrganizer(notifyAttendee:false)`. Réouverture : RDV
encore confirmé ⇒ `scheduled` restauré ; RDV annulé ⇒ `awaiting_booking` + réémission par action
humaine.

**Changement de référent** : le PATCH campagne appelle `getTargetImpact` **avant** d'écrire et
affiche le dialog d'impact (règle 3), puis `repointTarget`.

---

## 8 bis. Décisions du lot 3 (livré, 17/08/2026)

Quatre décisions ont été prises pendant la réalisation, chacune contre une
formulation initiale de la spec. Elles font foi.

### 1. La clé d'idempotence est l'identifiant d'ANALYSE, pas l'uid

Le §8 disait « `idempotencyKey` = `uid` d'analyse ». Or côté IMAP,
`candidate_analyses.uid` est l'**uid brut du message**, unique par BOÎTE
seulement — et `campaign_mailboxes` est une table n:n. Deux candidats venus de
deux boîtes peuvent donc porter l'uid `102` sur la même campagne, donc sur la
même cible : même clé ⇒ **même jeton**, avec le prénom de l'autre sur la page,
et une révocation qui frappe le mauvais lien.

Retenu : `idempotencyKey = analysisId` (`can_imap_<boîte>_<uid>` ou l'id chat,
globalement unique), `context = { uid, analysisId, campaignId }`. L'`uid` reste
la clé de rapprochement du briefing ; l'`analysisId` identifie la candidature.
Helper unique `src/lib/imap/analysis-id.ts`, repli dérivable pour les
validations HITL déjà en vol (`src/lib/hitl/analysis-key.ts`, pur et testé).

**Réinvitation** : un lien est à usage unique. Renvoyer un lien crée une
GÉNÉRATION de clé (`analysisId#r2`, `reissueKey`) — ré-émettre avec la clé
d'origine rendrait fidèlement le jeton consommé. La révocation, elle, frappe
TOUTES les générations.

### 2. Le consommateur d'événements n'est branché QUE sur le rail de drain

`emitEvent` dispatche EN LIGNE, dans la requête qui confirme la réservation.
Y brancher le consommateur ferait attendre le candidat pendant qu'ORQA
télécharge un CV, régénère éventuellement une trame et envoie un mail — sur une
route publique avec un `maxDuration`.

Retenu : deux branchements distincts (`src/lib/scheduling-host/configure.ts`).
`ensureSchedulingConfigured()` pose les ports (partout, surfaces candidat
comprises) ; `ensureSchedulingConsumer()` enregistre le consommateur et n'est
appelé que par le drain. Sans consommateur, la ligne d'outbox reste en attente
— ce n'est pas un échec. **Coût assumé : le briefing part dans la minute qui
suit, pas dans la seconde.** Trois déclencheurs de drain, tous idempotents :
cron de relève (prod), tick du scheduler (dev/VPS), ouverture de l'onglet
Entretiens (`after()`, hors chemin de réponse).

### 3. L'identité visuelle est une configuration d'INSTALLATION

Le brief parlait d'un `branding` passé à `createBookingLink`. Un logo et une
couleur appartiennent à l'organisation, pas à un rendez-vous : par lien, ils
seraient répétés à chaque émission et pourraient se contredire.

Retenu : `configureScheduling({ branding: { logoUrl, accentColor } })`, plus
`updateSchedulingIdentity()` pour un rafraîchissement PARTIEL (l'hôte relit ses
réglages toutes les 60 s ; re-passer par la configuration complète reposerait
les ports et emporterait le transport d'un hôte qui l'a installé lui-même —
défaut réel, attrapé par S14).

**Nom d'organisation** : aucun nouveau champ. `interviewConfig.organisationName`
est canonique (c'est déjà la signature des messages candidat), cascade
`resolveOrganizationName` (entretien → vivier → env → `null`). Seuls le logo et
la couleur sont nouveaux (`app_settings.branding_config`).

### 4. Le flag ne voyage JAMAIS dans un snapshot

`campaigns.scheduling_native boolean not null default false`. Le PUT
`/api/campaigns` écrit la ligne entière depuis l'état du client : un onglet
ouvert avant l'activation remettrait le flag à `false` à la première
sauvegarde. Le type `CampaignSnapshot = Omit<ActiveCampaign,
'schedulingNative'>` l'interdit **à la compilation** ; un test le prouve à
l'exécution sur la ligne réellement envoyée. Seul le PATCH ciblé écrit le flag.

### Verrous complémentaires

- **Sonde sans effet** (`canInviteForCampaign`) pour le gate d'envoi : il
  s'exécute avant de savoir si le mail partira, et émettre un jeton là
  laisserait un lien orphelin derrière chaque envoi avorté.
- **Un refus ne mint jamais** : la résolution de lien n'est appelée que pour
  `mode === 'invite'`. Sans ce verrou, un modèle de refus contenant
  `[lien d'agenda]` (cas réel : le DRH part de son modèle d'acceptation)
  émettrait un lien de réservation dans un mail de refus.
- **Pas de repli Cal.com en régime natif** : sur une campagne basculée dont le
  référent n'a pas de disponibilités, l'invitation est BLOQUÉE
  (`native_link_unavailable`) plutôt que de partir avec un lien Cal.com que le
  référent n'a peut-être même pas.
- **Référent par défaut = créateur** à la création de campagne ; `null`
  EXPLICITE reste possible (« aucun référent »), seule l'absence du champ
  déclenche le défaut.

## 9. Migration & coexistence (lots 4–5)

- **Feature flag par campagne** au point de résolution unique : ON ⇒ lien natif, OFF ⇒ chaîne
  Cal.com inchangée. L'aval (brief, stages, reporting, sans-suite) est indifférent à la source.
- **Briefs `awaiting_booking` en vol** : leurs liens Cal.com déjà envoyés restent honorés ; webhook
  + matching par email restent en service **jusqu'à extinction du stock**. Aucun re-envoi.
- **Critère d'extinction mesurable** : zéro brief `awaiting_booking` sans token natif.
- **Réversibilité** : flag OFF ⇒ les nouvelles invitations repartent sur Cal.com (rien n'est démonté
  avant le lot 5). Les RDV pris via le module restent des briefs `scheduled` ordinaires.
- **Lot 5 — décommission, entrée explicite** (jamais de code mort « au cas où ») : route webhook,
  `src/lib/calcom/`, exemption proxy, table `calcom_webhook_events`, `recruiters.calcom_link`,
  `interviewConfig.agendaLink`, `CAL_COM_EVENT_URL`, `CAL_COM_WEBHOOK_SECRET`, **matching par
  email** (`getPendingBriefByEmail` + repli `getLatestAnalysisByEmail`), docs et mémoires.

---

## 10. Lots de réalisation

| Lot | Contenu | Critère de sortie |
| --- | --- | --- |
| **1 — Module cœur** ✅ | Tables `sched_*`, moteur de créneaux (Luxon), cibles/liens idempotents, séquence de confirmation, outbox + drain, annulation/replanification serveur, ports injectés | **Testable seul** : tests purs (DST, buffer, préavis, horizon) + intégration (concurrence, idempotence, compensations, rejeu) + harnais de démo hors ORQA + lint de frontière |
| **2 — Surfaces candidat** ✅ | Pages `/r/{token}` et `/b/{manageToken}`, sélecteur de fuseau, mails + `.ics` via le port, rate-limiting, exemption proxy | Parcours candidat complet sur le harnais, sans ORQA |
| **3 — Intégration ORQA** ✅ | Écran dispos+lieu, câblage cibles/référent + dialog d'impact, émission derrière le flag, preview HITL idempotent, consommateurs d'événements, sans-suite, panneau orphelines, surcharge lieu par campagne | Campagne pilote de bout en bout en dev |
| **4 — Coexistence & régression** | S10 réécrit, S13/S14, compteur d'extinction, runbook | Suite verte + critère d'extinction observable |
| **5 — Décommission** | Liste §9 | Déclenché au critère atteint ; grep `calcom` vide |

---

## 11. Garde-fous permanents

- **Lint de frontière** : `src/lib/scheduling/**` ne peut importer aucun module `@/` hors du
  module. Règle ESLint `no-restricted-imports` **et** test dédié (le test échoue même si le lint
  n'est pas exécuté) — gardien permanent de l'autonomie.
- **`scripts/migrate.sql` = état final idempotent** : un bloc canonique par contrainte, guards sur
  la définition, double application validée avant tout déploiement.
- **Pas d'`any`**, TypeScript strict ; les types du module vivent dans `src/lib/scheduling/types.ts`.
- **Tests purs sans base** pour le moteur de créneaux (tolérance zéro sur les fixtures), tests
  d'intégration sur la base **dev** avec garde `REGRESSION_PROJECT_REF` et purge par marqueurs.

---

## 12. Risques suivis

| # | Risque | Mitigation |
| --- | --- | --- |
| 1 | Double réservation concurrente | Index unique partiel = claim en une instruction ; `slot_taken` + rechargement ; test de concurrence dédié |
| 2 | DST / fuseaux | Règles en heure locale + Luxon jour par jour ; créneaux inexistants écartés ; tests sur les deux transitions réelles |
| 3 | Course re-pointage / confirmation | `target.version` relue dans la séquence ; compensation + `target_changed` |
| 4 | Lien visio partagé entre candidats consécutifs | Buffer ≥ 15 min par défaut, avertissement UI si buffer 0 + visio ; résolution complète = liens uniques V2 |
| 5 | Livraison des événements | Outbox + drain + réparation (réservation sans événement) + idempotence consommateur |
| 6 | `.ics` & délivrabilité | Acquis de `ics.ts` (UID stable, variante HTML, binaire vs lien) ; `SEQUENCE` sur replanification ; message-id tracés |
| 7 | No-show | Hors périmètre module (déjà le cas avec Cal.com) ; rappels J-1 = V2 |
| 8 | Sécurité de la surface publique | Tokens 128 bits, usage unique, expirables, révocables ; la page n'affiche que `display` ; rate-limit ; `manage_token` distinct |
| 9 | Double communication au sans-suite | `notifyAttendee:false` — une seule voix, celle de la matrice existante |
| 10 | Complexité de la coexistence | Flag au point unique, chemin legacy non modifié, critère d'extinction + lot 5 explicite |

---

## 12 bis. Où vit le lot 1

| Élément | Emplacement |
| --- | --- |
| Module | `src/lib/scheduling/` — `index.ts` est la surface publique (le contrat), `README.md` se lit sans connaître l'hôte |
| Moteur pur | `slots.ts` (`computeSlots`, `findOfferedSlot`) — aucune base, horloge injectée |
| Séquence de confirmation | `bookings.ts` — la compensation par suppression est gardée par un contrat exécutable : **elle refuse de supprimer une réservation qui a déjà produit un événement** |
| Schéma | `scripts/migrate.sql`, section « MODULE DE RÉSERVATION NATIF » |
| Tests purs | `src/lib/scheduling/__tests__/slots.test.ts` (dont les 4 dates de changement d'heure) et `frontier.test.ts` |
| Tests d'intégration | `tests/regression/s13-scheduling-core.test.ts` (concurrence, idempotence, compensations, drain, réparation) |
| Harnais de démonstration | `scripts/scheduling-demo.ts` — `npm run demo:scheduling` (refusé en production, données marquées `SCHED-DEMO-` et supprimées en sortie) |
| Lint de frontière | `eslint.config.mjs`, doublé par `frontier.test.ts` (imports hôte, dépendances externes, **vocabulaire métier jusque dans les commentaires**). `react` est autorisé depuis le lot 2 : le module emporte ses écrans, sinon il n'est réutilisable qu'à moitié |

### Lot 3 — intégration ORQA

| Élément | Emplacement |
| --- | --- |
| Point de résolution unique | `src/lib/agents/server/interview-mail.ts` — `buildInterviewMail` (émission) et `canInviteForCampaign` (sonde du gate) |
| Ponts hôte | `src/lib/scheduling-host/campaign-booking.ts` (cible de campagne, liens, révocation, annulation), `recruiter-resource.ts` (ressource ⇄ recruteur) |
| Consommateur | `src/lib/scheduling-host/consumer.ts` + rail `drain.ts` ; idempotence `interview_booking_events` (`src/lib/db/repos/booking-events.ts`) |
| Écrans | `src/components/settings/availability/**` (dispos + lieu), `src/components/settings/BrandingManager.tsx`, `src/components/campagnes/edit/{NativeSchedulingBlock,OwnerChangeDialog}.tsx`, `src/components/interviews/**` (onglet Entretiens) |
| Routes | `/api/recruiters/[id]/availability`, `/api/campaigns/[id]/scheduling`, `/api/interviews`, `/api/interviews/reissue`, `/api/interviews/[bookingId]/cancel` |
| Helpers purs testés | `src/lib/interviews/availability-form.ts`, `src/lib/hitl/analysis-key.ts`, `src/lib/imap/analysis-id.ts` |
| Migrations | `campaigns.scheduling_native`, `app_settings.branding_config`, table `interview_booking_events` — contrôlées par `npm run check:scheduling` |
| Tests | S10.4/S10.5 (les deux régimes, bout en bout) ; unitaires : verrou du refus, flag hors snapshot, consommateur, clé d'analyse, grille de disponibilités |

### Lot 2 — surfaces candidat

| Élément | Emplacement |
| --- | --- |
| Écrans | `src/lib/scheduling/ui/` — CSS brut et variables `--sched-*`, aucun jeton de design de l'hôte. Point d'entrée SÉPARÉ (`ui/index.ts`) pour qu'une route serveur n'embarque pas React |
| Pages Next | `src/app/r/[token]/page.tsx`, `src/app/b/[manageToken]/page.tsx` — coquilles : l'état est résolu côté serveur, un jeton mort ne déclenche aucun appel depuis le navigateur |
| Routes publiques | `src/app/api/sched/**` — socle commun `src/lib/scheduling-host/public-route.ts` (débit, en-têtes, fenêtre bornée) |
| Adaptateur hôte | `src/lib/scheduling-host/configure.ts` — le SEUL endroit où les deux mondes se touchent |
| Invitation d'agenda | `src/lib/scheduling/ics.ts` — UID = racine de la chaîne, `SEQUENCE` = rang, `REQUEST`/`PUBLISH`/`CANCEL`, `RSVP=FALSE` |
| Gabarits | `src/lib/scheduling/mail-templates.ts` (purs) + `labels.ts` (surcharge par `configureScheduling({ labels })` ou `display.privacyNotice`) |
| Limitation de débit | `src/lib/scheduling/rate-limit.ts` + table `sched_rate_limits` + fonction SQL `sched_rate_limit_hit` ; purge rattachée au drain |
| Proxy | `src/proxy.ts` — **une seule** exemption (`/api/sched`) ; les pages n'en ont pas besoin (régime « pages » = liste blanche) ; court-circuit d'auth + en-têtes `noindex`/`no-store`/`no-referrer` sur `/r/ /b/ /api/sched/` |
| Tests | `__tests__/ics.test.ts`, `__tests__/mail-templates.test.ts` (purs) ; `tests/regression/s14-scheduling-surfaces.test.ts` (routes réelles) |

## 13. Hors périmètre V1 (rappel)

Synchronisation Google Calendar / Outlook (OAuth), génération de liens visio uniques par RDV,
rappels automatiques J-1, réémission automatique de lien après annulation candidat. La V1 vit sur
les **disponibilités déclarées** + le `.ics`.
