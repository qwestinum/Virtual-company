# Connecteur agenda externe (Outlook / Google) — Phase 1 : étude

> Statut : **ÉTUDE VALIDÉE le 15/09/2026** — arbitrages en §0 bis. Aucun code écrit ; relecture
> intégrale par le DO avant le lot A.
> Rédigée le 15/09/2026. Module concerné : `src/lib/scheduling/` (spec `scheduling-module.md`).
> Donnée d'entrée : propagation ICS mesurée **< 30 s** (compte testé) ⇒ voie Graph écartée
> (esquisse §9 conservée comme option théorique) ; **relecture systématique à la confirmation**.

Promesse au recruteur : **« ORQA sait quand vous êtes pris, pas pourquoi. »**

---

## 0. Synthèse — ce que l'étude tranche et ce qu'elle te demande

### Tranché (argumenté plus bas)

| # | Sujet | Décision |
|---|---|---|
| 1 | Parseur | **`ical.js` 2.2.1** (Mozilla, MPL-2.0, **zéro dépendance**) — côté **hôte**, pas dans le module |
| 2 | Où vit quoi | Le module définit le **port** `BusyProvider` et la **politique d'échec** (pure). L'hôte fait tout le reste : URL chiffrée, relève, parsing, cache, signal |
| 3 | Cache | **En base, une ligne par recruteur** (`recruiter_busy_snapshots`, intervalles en `jsonb` remplacés d'un bloc). Pas de cache mémoire : sur serverless il serait décoratif |
| 4 | Intégration moteur | Un champ **`externalBusy`** distinct de `busy` dans `SlotEngineInput`, assemblé au point unique **`loadEngineInput`** |
| 5 | Offre vs confirmation | Liste des créneaux = **instantané** (relève à la minute). Confirmation **et déplacement** = **relecture fraîche**, systématique |
| 6 | Reflet des RDV ORQA | Le RDV pris via ORQA **revient** dans le flux externe (le recruteur reçoit un `.ics`). Il faut le neutraliser, sinon le déplacement casse (§5.4) |
| 7 | Politique d'échec | **Graduée** : tolérance courte sur le dernier instantané, avec RDV **marqué « non vérifié »** ; au-delà, **blocage** (§6). Chiffrage §6.3 |
| 8 | Journal | **Transitions d'état seulement**, jamais une ligne par relève (leçon `imap_mailbox_skipped` du 21/08) |
| 9 | Flag | Deux étages fail-closed, calqué sur le sourcing (§10) |

### ⚠️ Deux écarts avec les décisions de départ — arbitrés en §0 bis

1. **Google n'a pas de flux « disponibilités uniquement » privé.** Deux options seulement :
   - **adresse publique** + réglage « voir uniquement les disponibilités » : le flux ne contient
     que des plages « Occupé », mais le calendrier devient **public**, et son URL se **déduit de
     l'adresse email** (`…/calendar/ical/<email>/public/basic.ics`) : ce n'est **pas un secret**,
     n'importe qui connaissant l'adresse lit les disponibilités ;
   - **adresse secrète** : l'URL est un vrai secret, mais le flux porte **tout le détail**
     (titres, participants, descriptions). ORQA n'en extrairait que les horaires — mais le contenu
     **transite** par nos fonctions.

   La promesse doit alors se formuler exactement : **« jamais extrait, jamais stocké, jamais
   journalisé »** — pas « jamais lu ». Google Workspace peut en outre interdire le partage externe
   par politique d'administration. **Il me faut ton choix** (recommandation : adresse secrète,
   avec un avertissement à la saisie qui dit ce qu'elle contient — §8.3).

2. **« Aucun consentement admin » est vrai côté application, pas côté Microsoft 365.** La
   publication anonyme d'un calendrier dépend de la **politique de partage du tenant** (Exchange
   Online, domaine « Anonymous »). Aucune inscription Azure, mais un client peut l'avoir
   désactivée : ce sera à vérifier chez chaque client **avant** la démo.

### Questions posées pour lancer la Phase 2 — répondues en §0 bis

- **Q1** — Google : adresse secrète (recommandé) ou adresse publique en disponibilités seules ?
- **Q2** — Politique d'échec : valides-tu la tolérance de **2 heures ouvrées** puis blocage (§6.4) ?
- **Q3** — Un **email au recruteur** quand son agenda passe en « bloqué », en plus du signal
  in-app (§7.3) ? Recommandé : oui.
- **Q4** — **Deux vrais exports** (Outlook « disponibilités uniquement » et Google), idéalement
  avec au moins : une réunion récurrente hebdomadaire, une occurrence déplacée, une occurrence
  supprimée, un événement sur toute la journée, un événement « disponible » et un « provisoire ».
  Les dates seront décalées avant d'entrer dans les fixtures (§2.5).
- **Q5** — Mesures à faire sur ces comptes (je ne peux pas les faire sans les URL) : taille du
  fichier, temps de réponse depuis `cdg1`, présence d'`ETag`/`Last-Modified`, **étendue temporelle**
  servie par Outlook, et **ce que rend une URL dépubliée** (404 ? calendrier vide ? page HTML ?).

---

## 0 bis. Arbitrages du 15/09/2026

| Question | Décision | Conséquence dans l'étude |
|---|---|---|
| Pièges §5.4 (reflet) et §6.1 (`suspicious_empty`) | **Acceptés** | L'égalité RDV ⇄ reflet se prouve par un **aller-retour réel** (§5.5), pas en théorie : décalages de fuseau ou de secondes possibles |
| **Q1** Google | **Adresse SECRÈTE**, chiffrée comme le reste | Promesse reformulée (ci-dessous) ; test dédié « un export Google complet ne laisse aucun titre en base ni en journal » (§2.5) |
| **Q2** Politique d'échec | **2 h ouvrées de tolérance puis blocage — validé** | Pendant la tolérance : « **agenda non vérifié** » dans le briefing ; au-delà ou échec définitif : page « momentanément indisponible » |
| **Q3** Email au recruteur | **Oui** — email + signal métier | Le message dit **quoi faire** (« republiez votre agenda », §7.3) |
| **Q4/Q5** Exports et mesures | **Oui** | Priorité n°1 : **comportement d'une URL DÉPUBLIÉE** — c'est lui qui arme la parade (§14 bis) |
| Architecture | **Confirmée** : ical.js côté hôte, cache en base une ligne par recruteur, route cron dédiée, journal sur transition | — |
| Priorité de relecture du DO | **La relecture À LA CONFIRMATION** | Remontée **dans le lot A** (§13) : c'est elle qui rend la tolérance de 2 h acceptable |

**Promesse au recruteur (définitive)** : « ORQA sait quand vous êtes pris, pas pourquoi. Le détail de
vos rendez-vous n'est **jamais extrait, jamais stocké, jamais journalisé** : seuls les intervalles
occupé/libre sont calculés à la volée, et le reste est jeté. »

---

## 1. Ce qui existe — constats dans le code

| Constat | Où | Conséquence |
|---|---|---|
| Moteur **pur** : règles − exceptions − `busy` (élargi du buffer) − préavis − horizon | `slots.ts` `computeSlots` | Ajouter une source = ajouter un champ d'entrée, pas un chemin |
| **Point d'assemblage unique** page publique / aperçu réglages / revalidation | `resources.ts` `loadEngineInput` | C'est LE point d'ajout (objectif 4) |
| Confirmation : revalidation (1ter) **avant** le claim (2) | `bookings.ts` `confirmBooking` | La relecture fraîche s'insère en 1ter ; un créneau devenu occupé ⇒ `invalid_slot` ⇒ **409 + rechargement**, mécanique existante |
| Déplacement : même revalidation ; créneaux de déplacement retirent le RDV courant de `busy` | `rescheduleBooking`, `listSlotsForManageToken` | Doivent aussi recevoir les intervalles externes — et le reflet (§5.4) |
| Ports injectés par `configureScheduling` (base, mailer, horloge, URL) | `runtime.ts` | Le `BusyProvider` y entre comme port optionnel |
| Frontière : dépendances admises `luxon`, `@supabase/supabase-js`, `react` | `__tests__/frontier.test.ts` | Mettre le parseur **hors** du module évite d'élargir la liste |
| ORQA envoie au recruteur un `.ics` de l'entretien (`METHOD:PUBLISH`) | `scheduling-host/consumer.ts`, `lib/calendar/ics.ts` | Le RDV **apparaît dans son agenda**, donc **dans son flux publié** |
| Chiffrement AES-256-GCM déjà utilisé sur une colonne de `recruiters` | `crypto/mailbox-credentials.ts`, `recruiters.adep_numero_dossier` | Même motif pour l'URL, aucune brique nouvelle |
| Rail cron `/api/cron/imap-poll` (`maxDuration 60`, déjà chargé : IMAP, drain, sourcing, clôtures) | `app/api/cron/imap-poll/route.ts` | Ne pas y empiler la relève (§3.2) |
| Registre de signaux + `SignalContext { recruiterId }` (signal 4 fériés, personnel) | `notifications/business-signals.ts` | Le signal agenda est personnel, même forme |
| Registre RGPD testé contre `migrate.sql` | `gdpr/table-inventory.ts` | Nouvelle table ⇒ verdict + ligne §4.1 dans le même commit |

---

## 2. Parsing ICS

### 2.1 Choix de bibliothèque

| Critère | **ical.js 2.2.1** | node-ical 0.27.2 | Réutiliser `ics.ts` du module |
|---|---|---|---|
| Licence / dépendances | MPL-2.0 / **aucune** | Apache-2.0 / `rrule-temporal` + `temporal-polyfill` | — |
| Fuseaux | Utilise les **VTIMEZONE embarqués** du fichier (gère donc les TZID Windows d'Outlook tant que le VTIMEZONE est présent) | Table de correspondance Windows → IANA | — |
| RRULE / EXDATE / RDATE / RECURRENCE-ID | Oui (itérateur borné par l'appelant, `relateException`) | Oui | — |
| Mainteneur | Thunderbird (usage réel sur des flux Outlook/Google depuis des années) | Communautaire | — |
| Verdict | **Retenu** | Écarté (deux dépendances, dont un polyfill) | **Impossible** : c'est un *générateur* de 140 lignes, écrire un parseur RRULE+VTIMEZONE à la main est exactement le code qui casse en silence |

MPL-2.0 est un copyleft **par fichier** : utilisé tel quel comme dépendance, aucune obligation sur
le code d'ORQA ; seule une modification de ses propres fichiers devrait être republiée.

Le parseur vit **côté hôte** (`src/lib/calendar/busy-ics/` — pur, testé), à côté des fériés. Le
module ne voit jamais un octet d'ICS : il reçoit des intervalles, comme il reçoit un mailer.

### 2.2 Ce qu'on lit — liste blanche de propriétés

Le parseur est écrit en **liste blanche**, sur le modèle de `keepAllowedSections` du sourcing :

- **Lues** : `DTSTART`, `DTEND`, `DURATION`, `RRULE`, `RDATE`, `EXDATE`, `RECURRENCE-ID`, `STATUS`,
  `TRANSP`, `X-MICROSOFT-CDO-BUSYSTATUS`, `X-MICROSOFT-CDO-ALLDAYEVENT`, `VTIMEZONE`.
- **Jamais lues** : `SUMMARY`, `DESCRIPTION`, `LOCATION`, `ATTENDEE`, `ORGANIZER`, `ATTACH`, `URL`,
  et tout le reste. Seule leur **présence** (pas leur valeur) est constatée, pour l'avertissement
  « ce lien publie le détail de vos rendez-vous » (§8.3).
- Sortie du parseur : `{ startAt, endAt }[]` UTC + compteurs (`eventCount`, `skipped` par cause).
  **Aucune** autre donnée ne sort de la fonction ; le texte brut est lâché dès le parsing.

### 2.3 Règles de conversion

| Cas | Règle | Justification |
|---|---|---|
| Ponctuel `DTSTART`/`DTEND` en `Z` | Tel quel | — |
| `TZID` avec `VTIMEZONE` embarqué | Converti par la définition embarquée | Outlook écrit `TZID:Romance Standard Time` |
| `TZID` IANA sans `VTIMEZONE` | Converti via Luxon | Google omet parfois le bloc |
| `TZID` inconnu **et** sans `VTIMEZONE` | Heure murale interprétée **dans le fuseau de la ressource** + compteur `tzAssumed` | Ne jamais lâcher un événement : un intervalle perdu = un créneau occupé proposé |
| Heure **flottante** (ni `Z` ni `TZID`) | Fuseau de la ressource | RFC 5545 : heure locale de l'observateur |
| Toute la journée (`VALUE=DATE`) | `[jour 00:00, jour+N 00:00)` **dans le fuseau de la ressource** | Un congé bloque la journée du recruteur, pas une journée UTC décalée d'1-2 h |
| Sans `DTEND` ni `DURATION` | Date seule ⇒ 1 jour ; date-heure ⇒ **durée nulle ⇒ ignoré** (RFC) | — |
| `RRULE` | Expansion **bornée à la fenêtre** `[from, to]`, plafond **2 000 occurrences / événement** (au-delà : compteur `truncated`, relève marquée **en échec** — jamais un agenda à moitié lu considéré comme sain) | Un `RRULE` sans `UNTIL` est infini |
| `EXDATE` | Occurrence retirée | — |
| `RECURRENCE-ID` (occurrence déplacée) | L'occurrence d'origine est retirée, la surcharge ajoutée | Sinon on bloque l'ancien ET le nouvel horaire (le premier à tort) |
| `STATUS:CANCELLED` (événement ou surcharge) | Ignoré | — |
| `TRANSP:TRANSPARENT` ou `BUSYSTATUS:FREE` | **Ignoré** | « Disponible » ne doit pas bloquer (anniversaires, rappels) |
| `BUSYSTATUS:WORKINGELSEWHERE` | **Ignoré** | Le recruteur est joignable ; à confirmer avec toi |
| `BUSYSTATUS:TENTATIVE` / `STATUS:TENTATIVE` | **Bloquant** | Doute ⇒ prudence : un créneau en moins vaut mieux qu'un double RDV |
| `BUSYSTATUS:OOF` / `BUSY` / absent | Bloquant | — |
| Intervalles | Triés, **fusionnés** s'ils se chevauchent, découpés à la fenêtre | Taille du cache et du moteur bornée |

### 2.4 Validation du document

**Règle d'acceptation (arrêtée le 15/09 sur mesure Outlook réelle, §14 ter)** — une lecture est
ACCEPTÉE seulement si les trois conditions sont réunies :

1. statut **200** après redirections — suivies **uniquement vers les domaines connus du
   fournisseur** de l'URL (Microsoft pour une URL Outlook, Google pour une URL Google). Un
   `Location:` vers un domaine arbitraire est **refusé, pas suivi**, et forme un **cas à part**
   (`redirect_refused`, signalé comme anomalie de sécurité) — décision 15/09 ;
2. `Content-Type` **`text/calendar`** (paramètres `; charset=…` admis) ;
3. le corps **contient** `BEGIN:VCALENDAR`.

**Tout le reste est un échec de lecture** : 302 non résolu, 404, `text/html`, corps sans
`BEGIN:VCALENDAR` — et, en plus, corps > **5 Mo**, erreur de parsing, plafond RRULE atteint.
4. **et** le corps contient `END:VCALENDAR` — intégrité contre un téléchargement coupé (décision
   15/09).
 Pas de tolérance « on prend ce qu'on a pu lire » : un agenda lu à moitié est
un agenda qui ment.

**Agenda légitimement vide** (200, `text/calendar`, `BEGIN:VCALENDAR`, **zéro** `VEVENT`) : cas
**VALIDE**, distinct d'une panne — instantané à zéro intervalle, état « vérifié ».

### 2.5 Tests

- **Fixtures réelles** (Q4) : un export Outlook « disponibilités uniquement », un export Google.
  Dates **décalées** d'un nombre fixe de jours avant commit (ce sont des données personnelles du
  recruteur) ; pour Google en adresse secrète, les propriétés hors liste blanche sont **retirées
  du fichier** avant commit.
- **Fixtures synthétiques** pour chaque ligne du tableau §2.3, dont les deux changements
  d'heure 2026 (29/03, 25/10) : une récurrence hebdo 9h Paris doit rester 9h locale des deux
  côtés de la bascule ; un événement à 02:30 le 25/10 (ambigu) ; une récurrence Outlook avec
  TZID Windows.
- Test « **aucune valeur interdite ne sort** » : un flux truffé de `SUMMARY:SECRET-…` — la
  sortie sérialisée ne contient jamais `SECRET`.
- **Test dédié Google (Q1)** — unitaire ET régression : un export Google **complet** (adresse
  secrète : titres, participants, lieux, descriptions, marqués d'un motif reconnaissable) passe
  par la relève réelle ; on relit ensuite **`recruiter_busy_snapshots`, `journal`, les réponses
  d'API du réglage et la sortie console** : aucun titre, participant, lieu ni description.
  Les propriétés hors liste blanche sont jetées **dans le parseur**, avant tout retour de
  fonction — donc avant toute écriture possible.
- Tolérance zéro, fonctions pures, aucune requête réseau (règle `feedback_pure_function_test_purity`).

---

## 3. Fraîcheur et relève

### 3.1 Conséquence de la mesure (< 30 s)

La propagation étant quasi immédiate, la fraîcheur est bornée par **notre** cadence, pas par
Microsoft ou Google. Deux lectures, deux usages :

| Usage | Source | Âge maximal attendu |
|---|---|---|
| Liste de créneaux (page candidat, aperçu réglages, page de déplacement) | Instantané en base | ≈ 1 min 30 (cron à la minute + propagation) |
| **Confirmation** et **déplacement** | **Relecture fraîche**, systématique | ≈ 30 s (propagation seule) |
| « Agenda relu il y a N min » | `read_at` de l'instantané | — |

Un créneau devenu occupé entre l'affichage et le clic est rattrapé à la confirmation : 409,
rechargement — exactement la course entre deux candidats.

### 3.2 Rail de relève

- **Route dédiée** `/api/cron/busy-calendars` (même `CRON_SECRET` fail-closed, `timingSafeEqual`),
  **job cron-job.org distinct**. Le rail IMAP a déjà un budget de 60 s partagé entre quatre
  traitements, dont une ouverture de boîte à 20 s : y ajouter N requêtes HTTP sortantes serait
  recréer le défaut du 20/08 (invocation tuée avant toute écriture d'état). En dev/VPS : un tick
  du scheduler existant.
- **Périmètre** : recruteurs actifs, avec URL, **et** une ressource réservable. Pas de relève pour
  un agenda que personne ne peut consulter.
- **Anti double relève** : réservation conditionnelle `refresh_claimed_at` (même motif que les
  claims) — le cron et une relève à la demande ne lisent pas deux fois la même URL en même temps.
- **Coût** : N requêtes/minute, en parallèle bornée (5), délai 5 s par URL. Si `ETag` /
  `Last-Modified` sont servis (Q5), requête conditionnelle ⇒ `304` sans parsing. Sans eux, le coût
  dominant est le parsing : **à mesurer sur l'export réel** (un agenda Outlook de plusieurs années
  peut peser plusieurs centaines de Ko).
- **Rattrapage** : une liste de créneaux qui trouve un instantané **plus vieux que 5 min** tente
  **une** relecture fraîche (délai 3 s) avant d'appliquer la politique d'échec. Cela distingue
  « le cron est tombé » (cron-job.org en panne — l'URL va bien) de « l'URL est morte », et évite
  de bloquer des candidats pour une panne qui n'est pas celle du recruteur.
- **Relève immédiate** à l'enregistrement de l'URL et à la modification de la grille hebdomadaire
  (cf. minimisation §12.2).

---

## 4. Modèle de données — tranché

### 4.1 Pourquoi une table (et pas un cache mémoire)

Le cache mémoire « par requête » ne tient que si **seule** la confirmation lit l'agenda. Or la
liste de créneaux en a besoin aussi : sans table, chaque ouverture de page candidat irait chercher
l'URL chez Microsoft sur le chemin critique d'un lien ouvert depuis un mail, et un porteur de
jeton pourrait nous faire marteler l'URL (le débit limite, il ne supprime pas). Et un cache en
mémoire de process est **décoratif** sur serverless (leçon du double mail). ⇒ **table.**

### 4.2 Pourquoi côté hôte (et pas `sched_external_busy`)

Le module ne doit connaître ni URL, ni source, ni cadence de relève, ni jeton OAuth demain : tout
cela est l'**adaptateur**. Il reçoit une réponse au port (§5.1). Une table `sched_*` porteuse d'une
colonne `source` ferait entrer dans le module la notion de fournisseur. La clé est l'identifiant
du recruteur, qui **est** l'`external_ref` de sa ressource.

Et **une ligne par recruteur** plutôt qu'une ligne par intervalle : l'instantané se remplace d'un
bloc (jamais un ensemble à moitié réécrit lu par une confirmation concurrente), une seule lecture
par ressource, et la purge est implicite (seule la fenêtre `[maintenant, horizon]` est gardée).

### 4.3 Schéma (état final, rejouable)

```sql
alter table public.recruiters add column if not exists busy_ics_url text;
-- blob AES-256-GCM `iv:tag:ciphertext` — JAMAIS l'URL en clair

create table if not exists public.recruiter_busy_snapshots (
  recruiter_id        uuid primary key references public.recruiters(id) on delete cascade,
  intervals           jsonb not null default '[]'::jsonb,  -- [[startIso,endIso],…] fusionnés
  window_from         timestamptz,
  window_to           timestamptz,
  event_count         integer not null default 0,           -- occurrences sur la fenêtre
  read_at             timestamptz,                          -- dernière relève RÉUSSIE
  attempted_at        timestamptz,
  failing_since       timestamptz,                          -- null ⇔ sain
  failure_code        text,                                 -- code CLASSÉ, jamais un message
  failure_permanent   boolean not null default false,
  refresh_claimed_at  timestamptz,
  last_journaled_state text,                                -- transitions seulement (§7.2)
  updated_at          timestamptz not null default now()
);
alter table public.recruiter_busy_snapshots enable row level security;

-- sched_bookings : trace de la vérification faite à la confirmation (générique, sans vocabulaire hôte)
alter table public.sched_bookings add column if not exists availability_check text;
-- CHECK canonique unique : ('live','snapshot','none') ; null = RDV antérieur à la fonctionnalité
```

`failure_code` ∈ `timeout`, `network`, `http_4xx_auth` (401/403), `http_not_found` (404/410),
`http_5xx`, `not_ics`, `too_large`, `parse_error`, `recurrence_overflow`, `suspicious_empty`,
`decrypt_failed`. **Jamais** le message brut d'une exception de `fetch` : ceux de Node embarquent
l'URL (`Failed to parse URL from https://…`) — c'est la fuite la plus probable du secret (§11).

Changer ou effacer l'URL **supprime l'instantané** dans la même opération : garder les intervalles
de l'ancien agenda sous le nouveau serait un mensonge.

---

## 5. Intégration au moteur

### 5.1 Le port

```ts
// src/lib/scheduling/types.ts — vocabulaire du module, aucune notion de fournisseur
export type ExternalBusyRequest = {
  resource: Pick<Resource, 'id' | 'externalRef' | 'timezone'>;
  from: string; to: string;          // UTC ISO
  freshness: 'snapshot' | 'live';    // offre ⇒ snapshot ; confirmation ⇒ live
};

export type ExternalBusyAnswer =
  | { kind: 'not_configured' }       // aucune source : comportement d'aujourd'hui, pas un échec
  | { kind: 'ok'; intervals: BusyInterval[]; readAt: string }
  | {
      kind: 'unavailable';
      lastGood: { intervals: BusyInterval[]; readAt: string } | null;
      failingSince: string;
      permanent: boolean;
    };

export type BusyProvider = { read(req: ExternalBusyRequest): Promise<ExternalBusyAnswer> };
// configureScheduling({ …, busyProvider? })  — absent ⇒ exactement le moteur actuel
```

Le port rend des **intervalles**, un **horodatage** et un **état** : rien sur l'URL, le format ou
le fournisseur. Il vit dans le module ; l'adaptateur ICS dans `src/lib/scheduling-host/busy/`.

### 5.2 Un seul point d'ajout

1. `SlotEngineInput` gagne `externalBusy: BusyInterval[]` (défaut `[]`), **distinct** de `busy`.
   Distinct parce que le traitement du reflet (§5.4) et du déplacement porte sur l'un et pas sur
   l'autre ; les fondre obligerait à les redistinguer plus loin. Le **buffer s'applique aux deux** :
   le recruteur qui sort d'une réunion à 10h n'est pas plus disponible à 10h qu'après un entretien.
2. `computeSlots` soustrait `busy ∪ externalBusy` au même endroit (`overlapsBusy`). C'est la seule
   ligne du moteur qui change.
3. `loadEngineInput(resource, window, { freshness })` appelle le port **en parallèle** des règles,
   exceptions et réservations (déjà un `Promise.all`), puis applique la politique pure
   `resolveExternalBusy(answer, policy, now, rules)` (§6.4) qui rend
   `{ intervals, check: 'live' | 'snapshot' | 'none', blocked: boolean }`.

Chaîne finale : **règles − exceptions − réservations − intervalles externes − buffer − préavis −
horizon**.

### 5.3 Répercussions dans les appelants (tous déjà passés par `loadEngineInput`)

| Appelant | `freshness` | Si `blocked` |
|---|---|---|
| `listSlotsForLink`, `listSlotsForManageToken`, `previewSlots` | `snapshot` | Liste vide **et** motif `availability_unverified` — la page dit « momentanément indisponible, réessayez plus tard », jamais « aucun créneau » (qui ferait croire à un agenda plein) |
| `confirmBooking` (étape 1ter) | `live` | Nouveau motif `availability_unverified` (message distinct, pas un 409 de rechargement) |
| `rescheduleBooking` | `live` | Idem ; l'invité **garde** son RDV actuel (ordre déjà garanti) |

La réservation enregistre `availability_check` ; l'événement `booking.created` le transporte ;
l'hôte l'écrit dans le briefing (« ORQA n'a pas pu relire votre agenda au moment de la réservation
— vérifiez ce créneau ») et dans l'onglet Entretiens.

### 5.4 Le reflet des RDV ORQA — piège identifié

Le recruteur reçoit le `.ics` de l'entretien ; s'il l'ajoute, le RDV **réapparaît** dans son flux
publié. Effets :

- nouveaux créneaux : **aucun** (le RDV est déjà soustrait) ;
- **déplacement : cassé.** `listSlotsForManageToken` retire le RDV courant de `busy` pour que
  l'invité voie son propre horaire ; le reflet externe le rebloque ⇒ l'invité « croit l'avoir
  perdu », et tout déplacement de 15-30 min qui chevauche l'horaire actuel est refusé ;
- **annulation** : le créneau reste bloqué tant que l'agenda du recruteur n'a pas traité le
  `CANCEL` — sens prudent, acceptable.

Neutralisation (pure, testée) : **un intervalle externe dont début ET fin égalent exactement une
réservation confirmée de la ressource est son reflet**, et il est retiré. Un flux « disponibilités
uniquement » n'expose pas d'UID fiable, l'égalité exacte des bornes est le seul signal ; elle ne peut
masquer aucun vrai conflit, puisque le créneau est de toute façon déjà occupé par la réservation.
En déplacement, le reflet du RDV courant est retiré **avec** le RDV courant.

Cas limite : le recruteur a modifié l'heure du reflet dans son agenda ⇒ plus d'égalité ⇒ l'intervalle
bloque. Sens prudent, conservé.

### 5.5 Preuve par aller-retour réel (exigence du 15/09)

L'égalité « exacte » est une hypothèse tant qu'elle n'a pas traversé un vrai agenda : ORQA émet en
UTC à la seconde (`DTSTART:20260922T080000Z`), mais Outlook et Google ré-exportent souvent en heure
locale avec `TZID`, et peuvent tronquer ou arrondir. Protocole, sur chaque fournisseur :

1. réserver via ORQA (dev) un créneau sur la ressource du compte de test ;
2. ajouter à l'agenda le `.ics` reçu par le recruteur (tel qu'il arrive, sans retouche) ;
3. **déplacer** ce RDV via `/b/…`, ajouter le `.ics` de déplacement ; puis **annuler** ;
4. à chaque étape, relire l'URL publiée et comparer bornes externes ⇄ `sched_bookings`, **à la
   milliseconde après conversion UTC** ;
5. consigner le résultat brut (fixture décalée) ; il devient le test du reflet.

Règle de comparaison **décidée sur la mesure** : égalité stricte si l'aller-retour la préserve ;
sinon tolérance **minimale observée** (ex. ≤ 60 s) et **documentée avec la fixture qui la justifie**.
Une tolérance posée sans mesure est exactement le « en théorie » écarté.

---

## 6. Robustesse — politique d'échec chiffrée

### 6.1 Classement des échecs

> **Révisé le 15/09 sur mesure Outlook réelle (§14 ter).** L'étude initiale distinguait des échecs
> « permanents » bloquant sans tolérance. Abandonné : **tout échec de lecture suit la même règle** —
> tolérance de 2 h ouvrées sur la dernière copie, puis blocage + email + signal.

| Code (diagnostic seulement) | Exemple mesuré ou attendu |
|---|---|
| `unpublished_or_error_page` | Outlook dépublié : **302 → page HTML d'erreur** (`text/html`, « GetAnonymousCalendarSessionData failed ») |
| `http_status` | 404, 401/403, 5xx, 429 |
| `not_calendar` | 200 mais `Content-Type` ≠ `text/calendar`, ou corps sans `BEGIN:VCALENDAR` |
| `timeout`, `network` | — |
| `too_large`, `parse_error`, `recurrence_overflow`, `truncated`, `decrypt_failed` | — |
| `redirect_refused` | `Location:` hors des domaines du fournisseur — **non suivi**, cas à part (anomalie de sécurité) |
| `suspicious_empty` | Filet réservé aux fournisseurs **non mesurés** (ci-dessous) |

Le code sert au **message** (email, écran — §7.3), jamais à la **décision**. Pourquoi une règle
unique : la page d'erreur Outlook ne distingue pas « lien dépublié » de « service Outlook en
difficulté » — la même réponse peut guérir seule ou jamais. Bloquer immédiatement priverait le
cabinet de RDV sur un hoquet Microsoft ; tolérer 2 h ouvrées coûte ≈ 0,003 double RDV par panne
(§6.3), et chaque RDV pris pendant ce temps est marqué « agenda non vérifié ».

**RÈGLE (15/09) : le comportement de dépublication est MESURÉ par service, jamais supposé.** Le
rempart 200 + `text/calendar` + `BEGIN:VCALENDAR` + `END:VCALENDAR` vaut **partout** ; le filet
ci-dessous se retire **service par service, sur preuve** consignée au §14 ter.

**Filet `suspicious_empty`** (0 occurrence alors que la lecture précédente en avait ≥ 5) : conservé
**par service**, pour ceux dont le comportement à la dépublication n'est **pas mesuré**. Outlook
personnel (`outlook.live.com`) est mesuré : une URL dépubliée n'y rend **jamais** un calendrier vide
valide ⇒ filet **désactivé**, et un vide y est un vide. Activé pour Google (à mesurer avant son lot)
et pour tout hôte non mesuré. Levé à la relève suivante qui trouve des événements, ou quand le
recruteur reteste son URL.

### 6.2 Les trois options, posées

| Option | Candidat | Recruteur | Risque |
|---|---|---|---|
| A. Proposer quand même | Réserve normalement | Découvre le double RDV le jour J | Croît avec la durée de panne (§6.3) |
| B. Bloquer | « Momentanément indisponible » — une partie ne revient pas | Averti, corrige en minutes | Nul en double RDV, coût en candidats perdus |
| C. Proposer avec avertissement | L'avertissement ne lui sert à rien : il ne voit pas l'agenda | Averti **au moment** du RDV | Même que A, mais **quelqu'un le sait** |

Un assistant RH humain qui ne voit plus l'agenda de son manager depuis dix minutes continue de
caler des rendez-vous en le prévenant ; au bout d'une demi-journée, il arrête et va le voir. C'est
la politique recommandée : **C sur une fenêtre courte, puis B.**

### 6.3 Chiffrage du risque de double RDV

Hypothèses **explicites** (ordres de grandeur, à recalibrer — §6.5) :

| Symbole | Hypothèse | Valeur |
|---|---|---|
| λ | Nouvelles plages occupées ajoutées par heure **ouvrée** dans l'horizon | 1,5 / jour ouvré ⇒ **0,19 / h** |
| k | Créneaux offerts invalidés par une plage d'1 h (créneau 45 min + buffer 15 min) | **2** |
| O | Créneaux offerts sur l'horizon de 30 j (7 h/j de grille, ~50 % déjà occupés) | **75** |
| c | Concentration : ajouts **et** choix des candidats se portent sur les jours proches | **×2,5** |
| b | Réservations par recruteur par heure ouvrée (5/semaine) | **0,125 / h** |

Probabilité qu'**une** réservation tombe sur un créneau devenu occupé, avec un instantané âgé de
S heures ouvrées : **p(S) ≈ λ·S·k·c / O ≈ 1,25 % × S**.

Espérance de doubles RDV **sur toute la durée** d'une panne de S heures ouvrées, en option A :
**E(S) ≈ b·S × p(S)/2 ≈ 0,0008 × S²**.

| Panne (h ouvrées) | p(S) pour une résa en fin de panne | Résas pendant la panne | **Doubles RDV attendus** |
|---|---|---|---|
| 0,25 | 0,3 % | 0,03 | ≈ 0,00005 |
| 1 | 1,25 % | 0,13 | ≈ 0,0008 |
| **2** | **2,5 %** | **0,25** | **≈ 0,003** |
| 4 (½ journée) | 5 % | 0,5 | ≈ 0,013 |
| 8 (1 jour) | 10 % | 1 | ≈ 0,05 |
| 24 (3 jours — URL dépubliée un vendredi) | 30 % | 3 | **≈ 0,45** |

Lecture : une panne de quelques minutes est négligeable ; **le risque réel est la panne longue et
silencieuse** — exactement l'URL révoquée — où l'option A rend un double RDV **quasi certain en une
à deux semaines**. Le coût est quadratique : chaque heure de tolérance supplémentaire coûte plus que
la précédente.

La relecture fraîche à la confirmation fait que ce tableau ne s'applique **qu'aux pannes réelles**
(relève périodique ET relecture à la volée en échec) : un hoquet isolé ne dégrade rien.

### 6.4 Recommandation

| État | Condition | Offre | Confirmation | Qui le sait |
|---|---|---|---|---|
| **Vérifié** | Relecture fraîche OK | Instantané | `check='live'` | — |
| **Toléré** | **Tout** échec de lecture, dernier succès il y a **≤ 2 h ouvrées** de la ressource | Dernier instantané | Accepte, `check='snapshot'` | Briefing + onglet Entretiens (« non vérifié ») ; signal in-app dès 1 h ouvrée |
| **Bloqué** | Échec de lecture depuis **> 2 h ouvrées** | Liste vide + « momentanément indisponible » | `availability_unverified` | Email au recruteur (Q3) + signal (allumé dès 1 h ouvrée) ; journal de transition |

- **Heures ouvrées de la ressource** (fonction pure sur sa grille, son fuseau et ses exceptions),
  pas des heures d'horloge : c'est pendant ses heures de travail que le recruteur ajoute des
  réunions et que les conflits comptent. Une panne qui commence à 19h ne bloque pas les candidats
  qui réservent le soir ; elle bloque le lendemain à 11h si rien n'a été corrigé — et le signal est
  parti à 10h.
- Résidu assumé : ≤ **2,5 %** par réservation prise en état « toléré », ≈ **0,003** double RDV
  par panne de 2 h, et chacune de ces réservations est **marquée** auprès du recruteur. Le
  garde-fou « un échec ne doit pas ouvrir un créneau occupé sans que quelqu'un le sache » tient.
- ~~Le permanent bloque sans tolérance~~ — **révisé le 15/09** (§6.1) : une seule règle pour
  tout échec de lecture. Une URL dépubliée un vendredi 18h bloque le lundi vers 11h (grille 9h-18h,
  heures ouvrées), signal allumé vers 10h.
- Recruteur **sans URL** : `not_configured`, comportement d'aujourd'hui — ce n'est pas un échec.
- Flag éteint (§10) : idem, et l'écran de réglages **dit** que l'agenda externe est ignoré.

### 6.5 Recalibrage

λ se **mesure** sur nos propres données : la différence entre deux instantanés successifs donne les
plages ajoutées. Après 3-4 semaines d'usage réel, un script d'agrégat (compteurs seulement, jamais
d'intervalles exportés) remplace les hypothèses et on revoit la tolérance.

---

## 7. Observabilité

### 7.1 Recruteur (écran Disponibilités)

- « Agenda Outlook relu il y a 2 min · 14 plages occupées sur les 30 prochains jours. »
- Toléré : « Dernière lecture il y a 1 h 10 — ORQA continue avec cette lecture, les réservations
  prises entre-temps vous seront signalées. »
- Bloqué : « ORQA ne parvient plus à lire votre agenda (lien introuvable) depuis 9h42. **Vos
  créneaux ne sont plus proposés** tant que ce n'est pas réglé. » + bouton « Retester le lien ».
- L'**aperçu des créneaux** (déjà présent) montre le résultat réel, intervalles externes compris :
  ce que le recruteur voit reste exactement ce que le candidat verra.

### 7.2 Journal — transitions uniquement

`busy_calendar_state_changed { recruiterId, from, to, failureCode }` à chaque changement d'état
(`healthy → tolerated → blocked → healthy`), mémoire en base (`last_journaled_state`), **jamais une
ligne par relève** : 1 440 relèves/jour par recruteur rempliraient le journal et évinceraient le fil
d'activité du Bureau (incident du 21/08). Aucune URL, aucun intervalle dans le payload.

### 7.3 Signal métier 5 — `busy_calendar_unreadable`

Registre `business-signals`, `SignalContext { recruiterId }` (réglage **personnel**, comme le
signal 4 fériés). Allumé si **échec de lecture depuis > 1 h ouvrée** — même horloge que la
tolérance, pour que le signal précède TOUJOURS le blocage d'une heure ouvrée (révisé le 15/09 : plus
de cas « immédiat ») ; éteint par construction à la première relève réussie. Cible `{ route }` vers les
réglages. Le signal in-app n'est vu qu'à la connexion : d'où l'**email** au passage en « bloqué »
(Q3 — validé), sous claim deux-phases `('busy_calendar_blocked', recruiterId, failingSince)` pour
n'en envoyer qu'un par panne.

Le message dit **quoi faire**, selon la cause (jamais un code technique) :

| Cause | Objet | Action demandée |
|---|---|---|
| Lien introuvable / vide suspect | « Vos créneaux d'entretien ne sont plus proposés » | « Votre agenda ne semble plus publié. **Republiez votre agenda** puis collez le nouveau lien dans ORQA › Paramètres › Disponibilités. » |
| Accès refusé | idem | « Le lien a été réinitialisé ou restreint. Republiez votre agenda et mettez le lien à jour. » |
| Illisible / trop volumineux | idem | « Le lien ne mène plus à un agenda lisible. Vérifiez que vous avez copié le lien ICS. » |
| Transitoire > 2 h ouvrées | idem | « ORQA ne parvient plus à joindre votre agenda depuis [heure]. Retestez le lien dans vos paramètres ; si le problème persiste, republiez-le. » |

Chaque email rappelle la conséquence (« tant que ce n'est pas réglé, les candidats voient vos
créneaux comme momentanément indisponibles ») et le lien direct vers le réglage.

---

## 8. Fiche recruteur

### 8.1 Champ

Section « Agenda externe » **dans** `AvailabilityEditor` (pas dans la fiche d'identité) : c'est un
réglage de disponibilité, et c'est là que l'aperçu en montre l'effet. Autorisation identique à
`/api/recruiters/[id]/availability` : soi-même ou admin. Un admin peut **poser ou effacer** l'URL
d'un autre, jamais la **relire**.

API : l'URL **entre** (PUT) et ne **sort jamais**. Les lectures rendent
`{ configured, provider: 'outlook' | 'google' | 'other', state, readAt, occurrenceCount, failureCode }` —
`provider` déduit du nom d'hôte, qui n'est pas le secret.

### 8.2 Test à la saisie

`POST /api/recruiters/[id]/busy-calendar/test { url }` — lit une fois, parse, ne stocke rien.
- OK : « Agenda lu : 14 plages occupées sur les 30 prochains jours. » ⇒ bouton **Enregistrer**
  actif ; l'enregistrement pose l'URL chiffrée et amorce l'instantané avec cette lecture.
- 0 occurrence : « Agenda lu, mais vide sur 30 jours. Vérifiez qu'il s'agit du bon calendrier. »
  (enregistrable — un agenda vide est possible, mais on le dit).
- Échec : message métier par code (« Ce lien ne mène pas à un agenda », « Lien introuvable — a-t-il
  été dépublié ? »), **enregistrement refusé**. On n'enregistre pas une URL illisible.
- `webcal://` accepté et réécrit en `https://`.

### 8.3 Avertissement de contenu

Le parseur **ignore tout `SUMMARY`, quel qu'il soit** (générique « Occupé(e) » chez Outlook,
possiblement vide ailleurs) : il n'en lit pas la valeur, pas même pour la comparer. L'avertissement
repose donc sur la seule **présence** de `DESCRIPTION`, `LOCATION` ou `ATTENDEE` (valeurs jamais
lues). S'il y en a : « Ce lien publie le **détail**
de vos rendez-vous. ORQA n'en garde que les horaires, mais le plus sûr est de publier en
« disponibilités uniquement ». » Pour Google en adresse secrète (Q1), l'avertissement s'affichera
toujours et le guide le dit d'avance.

### 8.4 Mini-guide (repliable, trois onglets)

- **Outlook.com (perso)** — Paramètres › Calendrier › Calendriers partagés › Publier un calendrier ›
  choisir le calendrier › « Peut voir quand je suis occupé » › Publier › copier le lien **ICS**
  (pas le lien HTML).
- **Microsoft 365** — même chemin dans Outlook sur le web. Si « Publier un calendrier » est absent ou
  grisé : la publication est désactivée par l'administrateur de votre organisation — à lui demander.
- **Google** — selon Q1. Adresse secrète : Paramètres › (calendrier) › Intégrer l'agenda › « Adresse
  secrète au format iCal ». Adresse publique : Autorisations d'accès › « Rendre disponible
  publiquement » + « Afficher uniquement les disponibilités », puis « Adresse publique au format iCal ».
- Commun : « Ce lien donne accès à vos disponibilités : ne le partagez pas ailleurs. Pour couper
  l'accès d'ORQA, effacez-le ici **et** réinitialisez-le chez Microsoft/Google. »

Libellés exacts des menus **à vérifier sur les comptes réels** avant publication (ils bougent), puis
reportés dans la cartographie du Manager (`manager-cartography.ts`).

---

## 9. Esquisse V2 — Microsoft Graph (non retenue, option théorique)

Ce que le port doit déjà permettre, et permet :

| Besoin Graph | Couvert par le port actuel ? |
|---|---|
| Lecture temps réel `POST /me/calendar/getSchedule` (statuts `free/tentative/busy/oof/workingElsewhere`) | Oui : `freshness: 'live'` ; même table de mapping des statuts que §2.3 |
| Identité du recruteur ⇒ jetons | Oui : `resource.externalRef` = identifiant du recruteur, l'adaptateur retrouve ses jetons |
| Échec « reconnexion requise » (refresh token expiré, consentement retiré) | Oui : `unavailable` + `permanent: true` ⇒ même blocage, même signal |
| Throttling Graph | Oui : l'instantané sert l'offre ; seule la confirmation appelle en direct |
| Fuseau | Oui : on demande en UTC (`Prefer: outlook.timezone="UTC"`) |

Ce qui resterait à construire côté hôte : inscription d'application Entra ID, OAuth par recruteur
(PKCE, `offline_access` + permission de lecture de disponibilités — `Calendars.ReadBasic` ou
`Calendars.Read`, **à vérifier**), refresh token chiffré (même blob AES-GCM), et — obstacle réel —
le **consentement administrateur** exigé par beaucoup de tenants. Rien dans le module ne changerait.

---

## 10. Flag par client, fail-closed

Deux étages, calqués sur `src/lib/sourcing/flag.ts` :
1. **Déploiement** : `BUSY_CALENDAR_ENABLED === '1'` strict **et** `MAILBOX_ENCRYPTION_KEY` valide.
2. **Cabinet** : `app_settings.scheduling_config.busyCalendarEnabled === true`.

Éteint ⇒ section absente des réglages, routes de test/enregistrement **404**, relève inactive,
**port non injecté** ⇒ moteur strictement identique à aujourd'hui (régressions S13/S14 inchangées).
Rallumé ⇒ les URL enregistrées sont conservées et reprennent à la relève suivante.

⚠️ Éteindre le flag alors que des recruteurs s'y fient remet leurs créneaux occupés en offre : c'est
un geste d'administrateur délibéré, et l'écran de réglages du recruteur **l'affiche**
(« agenda externe ignoré sur cette installation »).

---

## 11. Sécurité

- **Secret** : URL chiffrée AES-256-GCM (`encryptCredential`), déchiffrée en mémoire juste avant la
  requête, jamais renvoyée, jamais journalisée, jamais dans une erreur. Un déchiffrement en échec ⇒
  `decrypt_failed` (permanent), pas une exception qui casse la page.
- **Fuite par les erreurs** : toute exception de relève est **classée en code** dans un `try/catch`
  unique autour de `fetch` + parsing ; le message d'origine n'est ni stocké, ni loggé, ni renvoyé.
  Test dédié : une URL piégée (`https://…/SECRET-TOKEN/…`) injoignable ⇒ ni la base, ni le journal,
  ni la réponse d'API, ni `console.*` ne contiennent `SECRET-TOKEN`.
- **SSRF** : l'URL est fournie par un utilisateur et lue par le serveur. `https` seulement, **liste
  blanche d'hôtes** (`outlook.office365.com`, `outlook.live.com`, `calendar.google.com`), redirections
  **suivies manuellement** et re-vérifiées contre la liste (max 3). Un autre fournisseur (iCloud,
  Zimbra) s'ajoute à la liste, jamais par une ouverture générale. Sur Vercel l'enjeu est modéré ; sur
  le VPS prévu, sans cette garde, l'URL devient une sonde du réseau interne.
- **Débit** : route de test limitée en base (5/10 min par recruteur), fail-closed — chaque appel est
  une requête sortante.
- Région `cdg1` : la relève et le parsing tournent en UE comme le reste (obligation DPA).

---

## 12. RGPD

### 12.1 Verdicts au registre

| Emplacement | Verdict | Motif |
|---|---|---|
| `recruiters.busy_ics_url` | CONSERVER (table existante) | Donnée du **recruteur** (agent du responsable de traitement), jamais d'un candidat |
| `recruiter_busy_snapshots` | **CONSERVER** | Aucune donnée de candidat ; intervalles horaires d'un recruteur, fenêtre glissante ≤ horizon |
| `sched_bookings.availability_check` | Suit la table (EFFACER) | — |

Entrée `table-inventory.ts` + ligne §4.1 de `purge-rgpd-candidat.md` **dans le même commit** que
le `create table` (sinon la suite est rouge — c'est voulu).

### 12.2 Ce qui reste une donnée personnelle — du recruteur

« Pas une donnée de candidat » ne veut pas dire « pas une donnée personnelle » : l'emploi du temps
d'un salarié en est une. D'où :
- **Opt-in** du recruteur lui-même, information claire à la saisie (la promesse, §8) ;
- **Minimisation** : on ne garde que les intervalles qui chevauchent sa **grille de disponibilité**
  (± buffer). ORQA ne sait rien de ses soirées ni de ses week-ends. Coût : relève immédiate quand la
  grille change (§3.2), et un test qui prouve qu'aucun intervalle pertinent n'est rogné — un
  découpage fautif est un double RDV ;
- **Désactivation du recruteur** (`is_active=false`) ⇒ URL effacée et instantané supprimé ;
- Aucune rétention au-delà de la fenêtre : chaque relève **remplace** l'instantané.

---

## 13. Découpage proposé pour la Phase 2 (après validation)

**Préalable (avant tout code)** : mesures §14 bis sur les deux comptes, URL dépubliée en premier.

Réordonné après validation : la **relecture à la confirmation** est la priorité de relecture du DO
— c'est elle qui rend la tolérance de 2 h acceptable. Elle entre donc dans le **lot A**, avec le
strict nécessaire pour l'exercer de bout en bout, plutôt que d'attendre le lot B.

| Lot | Contenu | Tests |
|---|---|---|
| **A — Parseur + confirmation** | `src/lib/calendar/busy-ics/` pur (ical.js), liste blanche, règles §2.3, fusion ; port `BusyProvider` ; `externalBusy` dans le moteur ; **relecture fraîche en étape 1ter de `confirmBooking` et `rescheduleBooking`** (créneau devenu occupé ⇒ `invalid_slot` ⇒ 409) ; `availability_check` | Fixtures réelles + synthétiques ; « aucune valeur interdite ne sort » ; **export Google complet sans titre en sortie** ; confirmation qui trouve le créneau occupé ⇒ 409 ; latence mesurée depuis `cdg1` ; frontière verte ; S13 inchangée sans port |
| **B — Politique & reflet** | `resolveExternalBusy` (pure, heures ouvrées), états vérifié/toléré/bloqué, motif `availability_unverified`, reflet (§5.4) calibré par l'aller-retour réel (§5.5) | Unitaires purs ; fixture d'aller-retour Outlook + Google |
| **C — Adaptateur & relève** | Migration, chiffrement, route cron dédiée, claim, classement des échecs, `suspicious_empty`, SSRF | Fuite du secret ; SSRF ; double application `migrate.sql` |
| **D — Surfaces** | Section réglages, test d'URL, guide, états, signal 5, email « bloqué », mention briefing/Entretiens | Garde structurelle ; nouvelle régression **S25** (routes réelles, flux ICS servi par un faux serveur local : sain → toléré → bloqué → rétabli ; confirmation qui trouve le créneau devenu occupé ⇒ 409) |

---

## 14. Risques et inconnues

| Risque | Mitigation | Statut |
|---|---|---|
| Google sans flux privé en disponibilités seules | Choix Q1 + avertissement + promesse reformulée | **À arbitrer** |
| Publication désactivée par le tenant M365 du client | Guide + vérification avant démo | À vérifier par client |
| URL dépubliée qui rend un calendrier vide valide | Outlook : **n'arrive pas** (302 → HTML, §14 ter) ; filet `suspicious_empty` pour les non mesurés | Outlook **mesuré** ; Google à mesurer avant son lot |
| Outlook ne publie qu'une fenêtre limitée < horizon | Couper l'offre à la couverture observée | À mesurer (Q5) — un flux ne déclare pas son étendue |
| Taille / coût de parsing à la minute | Requêtes conditionnelles, fenêtre bornée, parallélisme 5 | Outlook : ~1,2 Ko pour 1 événement — négligeable ; à revoir sur un agenda chargé |
| Microsoft 365 (`outlook.office365.com`) supposé identique à Outlook personnel | Filet `suspicious_empty` **actif** tant que non mesuré | À mesurer |
| TZID Windows sans VTIMEZONE | Repli fuseau de la ressource + compteur | Couvert par tests |
| Reflet des RDV ORQA | Égalité exacte des bornes (§5.4) | Couvert par tests |
| Latence ajoutée à la confirmation | Lecture en parallèle, délai 4 s, puis politique §6.4 | À mesurer depuis `cdg1` |

## 14 bis. Protocole de mesure (préalable au lot A)

Sur un compte Outlook (perso ou M365) et un compte Google, dans cet ordre :

| # | Mesure | Pourquoi | Consigné |
|---|---|---|---|
| **1** | **URL dépubliée** : publier, lire (200), **dépublier**, relire à t+0, +1 min, +10 min, +1 h. Puis **réinitialiser** le lien (Outlook « réinitialiser », Google « réinitialiser l'adresse secrète ») et relire l'ancien | Arme la parade : 404/410 ⇒ `http_not_found` ; 200 + calendrier vide ⇒ `suspicious_empty` indispensable ; 200 + HTML ⇒ `not_ics` ; 401/403 ⇒ `http_4xx_auth`. Délai avant effet mesuré | Statut HTTP, `Content-Type`, 200 premiers octets (sans contenu d'événement), délai |
| 2 | Propagation (re-mesure) : création, déplacement, suppression d'un événement ⇒ délai de visibilité | Confirme < 30 s sur les deux fournisseurs et pour les **trois** gestes | Délais |
| 3 | Aller-retour du reflet (§5.5) | Règle d'égalité | Fixture décalée |
| 4 | Taille du flux et temps de réponse depuis `cdg1` (10 lectures) | Budget cron, délai 4 s à la confirmation | Médiane, p95 |
| 5 | `ETag` / `Last-Modified` / `304` | Coût de la relève à la minute | Oui/non |
| 6 | Étendue temporelle servie (événement à J+60, J+120, passé à J−400) | Couverture ≥ horizon (30 j) ? | Bornes observées |
| 7 | Statuts : disponible, provisoire, absent, travail ailleurs, journée entière, récurrence avec exception déplacée et supprimée | Table §2.3 | Fixture |

Les URL de test ne sont **jamais** écrites dans un fichier du dépôt ni dans un compte rendu : on
consigne le fournisseur et le résultat, pas le lien.

## 14 ter. Mesures réalisées

### Outlook personnel (`outlook.live.com`) — 15/09/2026, compte de test

| Mesure | Résultat |
|---|---|
| URL vivante | **200**, `text/calendar`, ~1 195 octets pour 1 événement |
| Contenu en « disponibilités uniquement » | `SUMMARY:Occupé(e)` — libellé générique, jamais le vrai titre ; **aucun** `ATTENDEE` ni `LOCATION` |
| **URL dépubliée** | **302 → page HTML d'erreur Outlook** (`text/html`, `<!DOCTYPE …>`, « GetAnonymousCalendarSessionData failed »). **Jamais** un calendrier vide valide |

**Décisions qui en découlent** (arrêtées le 15/09) : règle d'acceptation 200 + `text/calendar` +
`BEGIN:VCALENDAR` (§2.4) ; tout le reste = échec de lecture ⇒ tolérance 2 h puis blocage + email +
signal (§6.1, §6.4) ; `SUMMARY` ignoré quel qu'il soit (§8.3) ; agenda vide légitime = valide ;
filet `suspicious_empty` désactivé pour Outlook personnel, conservé pour les non mesurés.
**Outlook est débloqué pour le lot A.**

### Restant à mesurer

| Fournisseur | Mesure | Bloque |
|---|---|---|
| Google | **URL secrète révoquée** (réinitialisée) : statut, type, corps | Lot Google |
| Google | `Content-Type` servi (la règle exige `text/calendar`) | Lot Google |
| Microsoft 365 | URL dépubliée (identique à Outlook perso ?) | Désactivation du filet pour `outlook.office365.com` |
| Outlook | Export riche : récurrence avec exception déplacée et supprimée, journée entière, disponible, provisoire | Fixture réelle du parseur (lot A — synthétiques en attendant) |
| Outlook | Propagation déplacement/suppression ; `ETag`/`Last-Modified` ; étendue servie ; latence depuis `cdg1` | Lot A (latence) / lot C (coût de relève) |
| Outlook + Google | Aller-retour du reflet (§5.5) | Lot B |
