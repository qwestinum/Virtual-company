# Brief — prochaine session (réécrit le 09/09/2026)

Le chantier courant est le **connecteur APEC / ADEP V5**. Source de vérité :
**`docs/specs/apec-adep-connector.md`** — à lire avant de toucher au connecteur.
Exploitation : `docs/ops/apec-mise-en-service.md`.

> Le brief précédent (21/08, IMAP et conformité prod) est archivé en §5. Ce qu'il
> contient reste vrai, mais ce n'est plus le sujet.

---

## 0. ÉTAT — lots 0 à 4 livrés, aucun appel réel

Le connecteur est **complet et commité** (6 commits, `feat(adep): lot 0` à
`docs(adep)`), **jamais poussé** au moment d'écrire — le DO pousse lui-même.

| Lot | Contenu | État |
|---|---|---|
| 0 | noyau pur : namespaces, nomenclature, Argon2, constructeur XML SEP, parseur d'acquittement, 96 codes d'erreur, validateur métier, sonde XSD | ✅ |
| 1 | port `JobBoardPublisher`, mock **couturé au transport**, règle « jamais un second `openPosition` » | ✅ |
| 2 | migration `job_postings`, réservation avant appel, mapping, panneau APEC dans le bloc Canaux | ✅ |
| 3 | `createHttpAdepTransport` (aucun retry), `resolveTransport` fail-closed, `npm run adep:probe` | ✅ |
| 4 | 2 signaux métier, case de dépublication dans `CampaignDismissFlowDialog` | ✅ |

**Le connecteur tourne en mode SIMULATION** tant que `ADEP_ENABLED` n'est pas
posé (`1` exactement — `true` ne suffit pas), et **il le dit à l'écran**. Aucune
offre n'est jamais partie chez l'Apec.

Dev vert au moment du commit : typecheck, **2097 tests** (7 sautés quand
`xmllint` est absent), 221 fichiers.

### Les trois règles du connecteur, à ne pas éroder

1. **Jamais un second `openPosition`.** `uncertain` (on ne sait pas) n'est PAS
   `unavailable` (vérifié : rien n'existe). Les confondre fabrique des doublons
   indélébiles sur apec.fr. Seul `certainlyNotSent` se rejoue tel quel.
2. **Le statut est un CACHE, jamais une vérité.** L'Apec seule sait où en est une
   offre ; « Relire le statut » va le lui demander.
3. **La dépublication est PROPOSÉE, jamais automatique.** Même raison que « aucun
   refus n'est envoyé automatiquement » : c'est une action sortante et visible du
   public, et au-delà de J+30 elle n'a pas de retour arrière.

---

## 1. Migration APEC — AVANT tout déploiement

`scripts/migrate.sql`, **fichier entier**, **deux exécutions successives** (règle
absolue), puis **Dashboard Supabase → Reload schema cache**. Sans le rechargement
du cache PostgREST, les lectures rendent « not found in schema cache » et le
panneau se retire **en silence**.

Quatre objets ajoutés par le chantier :

| Objet | Nature |
|---|---|
| `job_postings` | table + CHECK `attempt_state` + 2 index |
| `recruiters.adep_numero_dossier` | colonne, **chiffrée** (AES-256-GCM, mécanisme IMAP) |
| `app_settings.adep_config` | colonne jsonb |
| `sites.insee_code` | colonne — l'Apec veut un code commune, pas un nom de ville |

⚠️ **Pas encore appliquée en dev au 09/09** — les tests unitaires ne la
touchent pas (repos mockés), ils ne prouvent donc rien de la base. C'est le
point de reprise immédiat, avec un contrôle POSITIF : un vrai `SELECT`,
`select(head: true)` ne remonte PAS l'absence d'une table.

---

## 2. Les quatre restes ouverts — et qui les bloque

| Reste | Bloqué par | Ce qu'on fait en attendant |
|---|---|---|
| **Le WSDL de PRODUCTION n'a jamais été vu** | l'Apec (accès) | `adep:probe` compare le `targetNamespace` réellement servi à notre constante et **refuse de continuer** en cas d'écart |
| **Formulaire du bloc client réel (mode indirect)** | convention Apec Cabinets / ETT / PRISME non signée | le bloc est construit, validé et testé de bout en bout ; seul l'écran ne le saisit pas. Le mode `broker` dans les réglages du cabinet est le déclencheur naturel |
| **Les 8 questions au support** | envoi à `supportadep@apec.fr` | bloc rédigé, `docs/ops/apec-questions-support.md`. Chaque point porte **l'hypothèse retenue** : le code n'attend personne, mais il dit ce qu'il suppose |
| **Premier appel réel** | les trois lignes ci-dessus | `npm run adep:probe -- --env <fichier>` en dry-run d'abord, `--execute` ensuite. ⚠️ Si la sonde rend `uncertain`, **NE PAS la relancer** : vérifier sur apec.fr sous la référence affichée |

Un cinquième reste est **traité le 09/09** : le pré-remplissage de l'offre APEC
depuis l'annonce générique (§3).

---

## 3. Pré-remplissage depuis l'annonce générique (09/09, livré)

Détail : **§6quater de la spec**. Ce que le recruteur a validé ne se ressaisit
pas — à l'ouverture du panneau, le titre et le corps de l'offre APEC viennent de
l'annonce générique publiée, en restant **éditables** (le format Apec n'est pas
celui du canal générique). À défaut, un bouton **pré-rédige** par le même chemin
que le canal générique : générer à l'ouverture écrirait à la place du recruteur,
et à chaque rechargement de l'écran.

Trois choses à ne pas défaire :

- **rien n'est tronqué ni reformaté** — un descriptif de 3 500 caractères est
  recopié entier et l'écart est DIT ; le Markdown est signalé, jamais retiré ;
- **`prefillIssues` reste borné aux deux champs pré-remplis** — le rapport
  complet à l'ouverture crierait sur des champs que personne n'a pu saisir ;
- **le snapshot APEC est distinct et figé à SA publication.** Modifier l'annonce
  générique ensuite ne touche pas l'offre partie, et le panneau le dit avant
  comme après — sinon on corrige une coquille en croyant corriger les deux, et
  on le découvre quand l'offre n'est plus modifiable.

---

## 4. Ce qui attend ailleurs (inchangé)

- **Cartographie produit du Manager** — le panneau APEC s'ajoute à la liste des
  surfaces qu'il ignore (référent, Entretiens, disponibilités, sans-suite). Il
  avouera son incertitude plutôt que d'inventer un menu, mais la dette grandit.
- **Lots 4-5 du module de réservation** : extinction du stock Cal.com puis
  décommission (`docs/specs/scheduling-module.md`).
- **Lot audit 🟠 résiduel** (`docs/audit/audit-orqa.md`) : I1, I2, puis I3/I4,
  I15/I16, I17. **Settings I12** : sauvegarde optimiste sans rollback.
- **UI de rejeu des `imap_unmatched_cvs`** (API only aujourd'hui).
- Voir `docs/BACKLOG.md` pour le reste.

---

## 5. Archive du brief du 21/08 — IMAP et conformité prod

Toujours valable, simplement moins prioritaire que le connecteur. Compte-rendu :
`docs/sessions/SESSION_2026-08-20_21_IMAP_UX.md`.

- **Migration prod** : les 9 tables `sched_*` + `sched_rate_limit_hit`,
  `campaigns.scheduling_native`, `app_settings.branding_config`,
  `interview_booking_events`, le CHECK `candidate_analyses_decision_zone_chk`
  étendu à `proposed_reject`, et **`mailboxes.folder`** (sans elle, toute
  création ou édition de boîte mail échoue en 500). Contrôle :
  `npm run check:scheduling`.
- **`NEXT_PUBLIC_APP_URL`** sur l'alias de production, et **`CRON_SECRET`**
  (fail-closed). Poser une variable ne suffit pas : Vercel les attache **par
  déploiement**, il faut redéployer.
- **Savoir qui pointe où** : `virtual-company-chi` (démo) et `orqa-bia-prod`
  (prod client) **ne partagent pas la même base**. Établir quel projet Supabase
  chaque instance interroge AVANT tout diagnostic.
- **Le signal 4 n'a aucun badge** (il vise `/settings`, qui n'est pas un onglet).
- **Une boîte au compte LENT reste irrelevable sur Vercel** : ~10 s par commande
  n'entre jamais dans `maxDuration = 60`. Aucune des trois sorties n'est du code.
- **`imap_unmatched_cvs` : 107 lignes parasites en dev**, résidu du crawl du
  20/08.

---

## 6. OUT (ne pas entamer sans décision)

- n8n / event bus externe (post-MVP).
- Cloisonnement de données par recruteur — « espace commun » est un CHOIX validé.
- **V2 du module de réservation** : synchronisation Google/Outlook, visio par
  RDV, rappels J-1, réémission automatique. La couture existe, ne pas
  l'implémenter.
- **Mode indirect ADEP sans convention signée** — le formulaire bâtirait sur une
  hypothèse (§2.4 de la spec).
- Fériés hors métropole (Alsace-Moselle, outre-mer).

---

## Rappels d'exécution permanents

- `migrate.sql` = état final idempotent : un bloc canonique par contrainte,
  guards sur la DÉFINITION, **double application en dev avant la prod**.
- Cadrage + inventaire EXHAUSTIF des lecteurs avant de coder (réflexe DO).
- `npm run typecheck` + `npm test` avant commit ; `npm run test:regression`
  (base DEV, application fermée) avant tout push.
- Le DO pousse lui-même (`! git push origin main`).
- **Une instance Vercel ne relève JAMAIS le mail toute seule** : c'est
  **cron-job.org** qui appelle `/api/cron/imap-poll`. Son « Échec (délai
  d'attente) » à 30 s n'est pas un échec de la relève.
- **Le poller lit le dossier configuré (défaut INBOX).** Un mail de test envoyé
  *depuis* la boîte surveillée part dans `\Sent` et restera invisible.
- **Jamais deux poller sur une même base** (`next dev` local + cron déployé).
