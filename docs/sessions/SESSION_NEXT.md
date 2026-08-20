# Brief — prochaine session (réécrit le 17/08/2026)

Contexte : le **module de réservation natif** destiné à remplacer Cal.com a ses
**lots 1 et 2 livrés** sur `main` local et verts en dev (S1-S14). Rien n'est
déployé. Compte-rendu complet : `docs/sessions/SESSION_2026-08-16_17_SCHEDULING.md`.
Spec de référence : `docs/specs/scheduling-module.md`.

**Aucun comportement existant n'a changé** : la chaîne Cal.com reste la seule en
service tant que le lot 3 n'est pas fait. Le nouveau module vit à côté, sans
être branché sur le métier.

---

## 0. POINT D'ARRÊT EN COURS

Le DO a demandé que **le lot 3 ne démarre qu'après sa recette fonctionnelle du
lot 2**. Ne pas entamer l'intégration ORQA avant son feu vert explicite.

### La recette à dérouler (DO)

```
npm run dev                          # terminal 1
npm run demo:scheduling -- --keep    # terminal 2
```

Le harnais s'arrête avant tout geste destructeur et imprime **trois URL** :
réserver (état ouvert), dégradé, éteint — les deux derniers montés sur une cible
séparée pour que le lien principal reste réservable. Les invitations d'agenda
sont **écrites sur disque** (chemin affiché) : les ouvrir dans un vrai agenda.

Parcours attendu, depuis un **téléphone** :

1. ouvrir le lien de réservation, vérifier le fuseau affiché et les créneaux ;
2. réserver → écran de confirmation avec lieu + lien de gestion ;
3. ouvrir le `.ics` de la confirmation dans un agenda ;
4. depuis le lien de gestion : **déplacer** → vérifier que l'agenda DÉPLACE
   l'événement au lieu d'en créer un second ;
5. **annuler** → vérifier que l'événement est retiré de l'agenda ;
6. ouvrir les liens « dégradé » et « éteint » : messages compréhensibles, aucune
   trace technique.

Points de vigilance que les tests ne couvrent pas : taille réelle des créneaux
au pouce, comportement du clavier quand le formulaire apparaît sous la grille,
lisibilité en plein soleil / thème sombre.

Une relance **sans** `--keep` supprime toutes les données marquées `SCHED-DEMO-`.

---

## 1. Après la recette — Lot 3 : intégration ORQA

C'est le lot qui BRANCHE le module sur le métier. Détail dans
`docs/specs/scheduling-module.md` §8. Ordre proposé :

1. **Câblage des concepts** : ressource ↔ recruteur (`external_ref` =
   `auth.users.id`), cible ↔ campagne (`external_ref` = `CAMP-XXXX`, créée
   paresseusement à la première invitation, pointée sur `owner_user_id`).
2. **Écran de disponibilités + lieu** dans la fiche recruteur (remplace le champ
   « lien Cal.com personnel »), avec le mini-guide « où trouver mon lien » par
   outil.
3. **Émission du lien derrière le flag par campagne**, au point de résolution
   unique (le remplaçant de `getResolvedAgendaLink`) : poller IMAP,
   mail-composer et **preview HITL** le traversent tous. Le preview appelle
   `createBookingLink` (idempotent) ⇒ le DRH relit le VRAI lien.
4. **Consommateur d'événements** → `interview_briefs` : `booking.created` avec
   claim deux-phases par `event.id`, brief retrouvé **par `context.uid`** (le
   matching par email disparaît), `booking.id` → `booking_uid` tel quel.
5. **Sans-suite** : `revokeLinkByKey(uid)` + `cancelBookingByOrganizer` avec
   `notifyAttendee: false` (la matrice de mails existante porte déjà la voix).
6. **Dialog d'impact** au changement de référent (`getTargetImpact` AVANT
   d'écrire) + panneau des cibles orphelines.

⚠️ Rappels du chantier :

- le **preview HITL est le point de vérité du lien** — toute logique s'applique
  au preview, pas à l'envoi (l'override envoie le HTML relu tel quel) ;
- la **frontière d'autonomie** reste non négociable : tout le câblage vit dans
  `src/lib/scheduling-host/`, jamais dans `src/lib/scheduling/` ;
- **rien ne se substitue à Cal.com au lot 3** : le flag est OFF par défaut, la
  chaîne existante n'est pas modifiée. La bascule est le lot 4.

---

## 2. EN ATTENTE — mise en production du lot sans-suite + multi-utilisateur

**Toujours pas déployé** (chantier de juillet). Runbook :
`docs/ops/multi-utilisateur.md`. Ordre IMPÉRATIF, chaque étape conditionne la
suivante :

1. **`CRON_SECRET` posé + vérifié sur Vercel prod** (Bearer identique côté
   cron-job.org). Sans lui, le déploiement ARRÊTE la relève mail (fail-closed).
2. **Migration `scripts/migrate.sql` sur le Supabase PROD** — fichier entier,
   **deux exécutions successives**, puis **Reload schema cache**. Le fichier
   contient désormais AUSSI les blocs `sched_*` et `sched_rate_limits` : ils
   sont inertes tant que le lot 3 n'est pas déployé, mais ils passeront.
3. **Seed admin PROD** : décommenter le bloc `<UUID_ADMIN>` avec l'UUID du
   compte prod (Auth → Users), exécuter, re-commenter ; puis le backfill
   `owner_user_id`. **Vérifier `select * from recruiters` — table vide = STOP**
   (sinon l'admin est verrouillé hors de `/admin`).
4. **Signups Supabase désactivés** (dashboard, dev ET prod).
5. `! git push origin main` → déploiement Vercel.
6. Vérifications post-déploiement : `/admin` accessible, section « Recruteurs »
   visible, hit cron sans header → 401, poll vivant (`/api/imap/status`),
   **vérification visuelle** du ruban « Sans suite » et de la 5ᵉ ligne du Bureau
   (demandée à la validation, jamais constatée à l'écran).

### Onboarding des recruteurs réels

Runbook §3-4 : invitation Supabase → référencement dans Paramètres → Recruteurs
→ compte Cal.com personnel + event-type → **webhook enregistré sur SON compte**
(même URL, même `CAL_COM_WEBHOOK_SECRET`) → test de réservation → poser le
recruteur comme référent de ses campagnes.

> Ce geste d'onboarding Cal.com est précisément ce que le module natif supprime.
> Si l'onboarding de nouveaux recruteurs n'est pas urgent, il peut valoir la
> peine d'attendre le lot 3 plutôt que de créer des comptes Cal.com jetables.

---

## 3. Chantiers candidats (à arbitrer avec le DO)

- **Cartographie produit du Manager** (backlog, quasi-obligatoire) : les
  surfaces de juillet (référent, section Recruteurs, sans-suite, dialog de
  clôture) sont inconnues de `manager-cartography.ts` — le Manager ne sait pas y
  orienter. **À refaire de toute façon au lot 3** (écran de disponibilités,
  onglet Entretiens) : peut-être à grouper.
- **Lot audit 🟠 résiduel** (cf. `docs/audit/audit-orqa.md`) : I1 (`send_failed`
  jamais re-tenté + brief mis en file quand même) + I2 (couche d'audit poller en
  `.catch(() => {})`), puis I3/I4, I15/I16, I17.
- **Settings I12** : sauvegarde optimiste sans rollback (`SettingsHub`).
- **`/validations-vivier` hors préfixe proxy** (SEC-7 résiduel, backlog).
- **UI de rejeu des `imap_unmatched_cvs`** (backlog historique — admin/API only).
- **Onglet « Entretiens »** (maquette au volet 2 de l'étude) : vue des RDV,
  bandeau des campagnes à liens actifs sans référent. Prévu au lot 3.
- Voir `docs/BACKLOG.md` pour le reste (sans-suite V2, auto-enrôlement
  recruiters, DMARC…).

---

## 4. OUT (ne pas entamer sans décision)

- n8n / event bus externe (post-MVP).
- Cloisonnement de données par recruteur — le modèle « espace commun » est un
  CHOIX validé, ne pas le remettre en cause au détour d'un ticket.
- Option B Cal.com (Team payante) — sans objet si le module natif aboutit.
- **V2 du module** : synchronisation Google/Outlook (OAuth), liens visio uniques
  par RDV, rappels J-1, réémission automatique de lien après annulation. La
  couture V2 existe (résolveur de lieu unique, type d'événement
  `booking.updated` déjà admis par le CHECK) — ne pas l'implémenter.

---

## Rappels d'exécution permanents

- `migrate.sql` = état final idempotent (règle absolue CLAUDE.md) : bloc
  canonique par contrainte, double application dev avant prod.
- Cadrage + inventaire EXHAUSTIF des lecteurs avant de coder (réflexe DO).
- Tests vitest + `npm run typecheck` avant commit ; régression
  `npm run test:regression` (**S1-S14**) sur DEV avant tout push.
- Le DO pousse lui-même (`! git push origin main`).
- Vérifier la présence des tables avec un vrai `SELECT` :
  `npm run check:scheduling` (`select(head: true)` ne remonte
  PAS l'absence d'une table).
