# Compte-rendu — Module de réservation natif, lots 1 et 2 (16-17/08/2026)

**Objet** : remplacer Cal.com par un module de réservation interne et autonome.
**État à la fin de la session** : étude validée, **lots 1 et 2 livrés et verts en dev**.
Rien n'est déployé. **Aucun comportement existant n'a changé** — la chaîne Cal.com reste
la seule en service jusqu'au lot 3.

Spec de référence : `docs/specs/scheduling-module.md` (lots 1 à 5).

---

## 1. Ce qui a été fait

### Étude en deux volets (validée)

- **Volet 1 — impact** : inventaire exhaustif des points de contact Cal.com (grep large +
  lecture de chaque point). Verdict par point : ce qui disparaît (`src/lib/calcom/`, le
  matching par email, les deux variables d'env), ce qui est remplacé (la route webhook
  devient consommateur d'événements, la chaîne du lien d'agenda), ce qui est **inchangé**
  (la machine d'états `interview_briefs`, tous ses lecteurs, le sans-suite).
- **Volet 2 — architecture** : module autonome, schéma `sched_*`, contrat d'API et
  d'événements, lieu de rencontre opaque, écrans, lots, risques.

### Lot 1 — cœur (livré)

Module `src/lib/scheduling/` + 7 tables. Moteur de créneaux pur (Luxon), cibles
re-pointables, liens idempotents, séquence de confirmation avec compensations, outbox
d'événements avec drain et réparation, annulation/replanification.

### Lot 2 — surfaces candidat (livré)

Pages `/r/{token}` et `/b/{manageToken}`, routes `/api/sched/**`, gabarits de messages +
invitation d'agenda `.ics`, limitation de débit en base, exemption proxy.

---

## 2. Décisions structurantes (et pourquoi)

| Décision | Raison |
| --- | --- |
| **Indirection par « cible »** : un lien pointe une cible re-pointable, jamais une ressource | Le référent d'une campagne change en cours de route. Sans indirection, il faudrait réémettre tous les liens en vol. Les RDV déjà pris figent leur ressource : un rendez-vous est un engagement. |
| **UID d'agenda = racine de la chaîne `rescheduled_from`** | `booking.id` change à chaque déplacement (nouvelle ligne) : l'agenda afficherait un second événement au lieu de déplacer le premier. |
| **`METHOD:REQUEST` + `ORGANIZER` = `notify_email`, `RSVP=FALSE`** | Les réponses d'agenda arrivent chez une vraie personne — comportement attendu d'un cabinet. `RSVP=FALSE` évite de réclamer une réponse que personne ne traite. Repli `PUBLISH` sans organisateur (une invitation sans organisateur n'est pas valide). |
| **Rate-limiting EN BASE** | Un compteur en mémoire de process est décoratif sur serverless : entre deux instances, seule la base est partagée (leçon du double mail). Fail-open assumé : la limitation protège d'un abus, elle n'est pas le contrôle d'accès. |
| **Écrans DANS le module** (`ui/`, CSS brut) | Un module de réservation sans ses écrans n'est réutilisable qu'à moitié. `react` a été ajouté aux dépendances autorisées ; la ligne rouge tient ailleurs : aucun composant ni jeton de design de l'hôte. |
| **UNE seule exemption proxy (`/api/sched`)** | Les pages sont protégées par liste blanche, donc déjà publiques : inscrire `/r/` et `/b/` dans une liste d'exemption serait du code mort **et** ferait croire à une garde inexistante. |
| **Mention de traitement des données surchargeable** | Elle relève de l'organisation qui exploite le service, pas de l'outil. Deux niveaux : `configureScheduling({ labels })` et `display.privacyNotice`. |

---

## 3. Défauts trouvés en cours de route (tous corrigés, tous couverts par un test)

Ils valent d'être connus : chacun aurait produit un dysfonctionnement plausible et
silencieux.

1. **Report du `manage_token`** — la replanification insérait la nouvelle réservation avec
   le jeton de l'ancienne alors qu'elle était encore `confirmed` : violation de l'index
   unique partiel, traduite en `slot_taken`. **Tout déplacement aurait échoué avec un motif
   mensonger.** Corrigé par un report en trois temps (jeton provisoire → annulation →
   report).
2. **Verdict `slot_taken` trop large** — toute violation 23505 devenait « créneau pris »,
   masquant le vrai défaut. Corrigé par `isSlotClaimConflict`, prudent dans les deux sens.
3. **Format d'horodatage** — Postgres rend `+00:00`, le moteur `.000Z` : un hôte comparant
   un créneau et une réservation par égalité de chaînes n'aurait rien trouvé. Normalisation
   ISO canonique à la frontière de mapping (`rows.ts`).
4. **`AvailabilityExceptionInput`** — le cas le plus courant (`{ day }` seul, un congé) ne
   compilait pas. Trouvé par le harnais, c'est-à-dire par du code écrit « de l'extérieur ».
5. **Vocabulaire de l'hôte dans les commentaires du module** — trouvé par le test de
   frontière, reformulé en vocabulaire du module (« invité », « titulaire »).
6. **Méthode de détection de tables faussement positive** — `select(head: true)` ne remonte
   PAS l'absence d'une table. Démasqué par une table témoin inexistante qui passait pour
   « OK ». Même famille que les troncatures silencieuses de juillet.

---

## 4. État de la vérification

| Vérification | État |
| --- | --- |
| Suite unitaire | **1406 tests / 161 fichiers, verts** (dont 70 dans le module) |
| Régression S1→S14 | **81 tests / 14 fichiers, verts** |
| S13 + S14 rejoués | **3× de suite sans échec** (aucun test capricieux) |
| Typecheck, lint | Propres sur tout le lot |
| Build Next | Routes `/api/sched/**`, `/r/`, `/b/` **enregistrées**. Le build complet échoue dans l'environnement de développement de la session sur `next/font/google` (téléchargement de polices, pas d'accès réseau) — **sans rapport avec ce chantier**, à confirmer au premier build connecté. |
| Recette fonctionnelle | **NON FAITE** — c'est le point de reprise (`SESSION_NEXT.md` §0). |

---

## 5. Migrations appliquées (dev uniquement)

Deux blocs ajoutés en fin de `scripts/migrate.sql`, appliqués à la main en dev, **pas en
prod** :

1. **Lot 1** — 7 tables `sched_*` (ressources, règles, exceptions, cibles, liens,
   réservations, événements).
2. **Lot 2** — `sched_rate_limits` + fonction `sched_rate_limit_hit()`.

Les deux respectent la règle de l'état final idempotent.

---

## 6. Fichiers ORQA touchés (hors module)

Peu, et chacun pour une raison précise :

| Fichier | Changement |
| --- | --- |
| `src/proxy.ts` | Exemption `/api/sched` + court-circuit d'auth + en-têtes `noindex`/`no-store`/`no-referrer` sur les préfixes publics |
| `src/lib/email/client.ts` | `contentType` optionnel sur les pièces jointes (additif) — sans lui le `.ics` part comme fichier ordinaire |
| `eslint.config.mjs` | Règle de frontière du module |
| `package.json` | `luxon`, `@types/luxon`, scripts `demo:scheduling` et `check:scheduling` |
| `scripts/migrate.sql` | Les deux blocs ci-dessus |
| `CLAUDE.md` | Section « Décisions architecturales » |

Tout le reste est **nouveau** : `src/lib/scheduling/`, `src/lib/scheduling-host/`,
`src/app/api/sched/`, `src/app/r/`, `src/app/b/`, `docs/specs/scheduling-module.md`,
`tests/regression/s13-*`, `s14-*`, `scripts/scheduling-demo.ts`,
`scripts/check-scheduling-schema.ts`.

---

## 7. Ce qui reste (lots 3 à 5)

Voir `docs/specs/scheduling-module.md` §8-9 pour le détail. En résumé :

- **Lot 3 — intégration ORQA** : câbler ressources ↔ recruteurs, cibles ↔ campagnes, le
  preview HITL idempotent, les consommateurs d'événements vers `interview_briefs`, le
  sans-suite, le dialog d'impact au changement de référent, l'écran de disponibilités.
- **Lot 4 — coexistence** : flag par campagne, S10 réécrit, compteur d'extinction.
- **Lot 5 — décommission** : retrait de Cal.com, entrée explicite (jamais de code mort).
