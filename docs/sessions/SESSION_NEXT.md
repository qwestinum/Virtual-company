# Brief — prochaine session (réécrit le 21/08/2026)

Compte-rendu de la session précédente :
`docs/sessions/SESSION_2026-08-20_21_IMAP_UX.md`. **À lire avant de coder** : il
contient les pièges opérationnels IMAP/Vercel qui ont coûté la moitié de la
session, et une explication que j'ai donnée puis corrigée (le coût d'un SELECT
IMAP ne dépend PAS de la taille du dossier).

---

## 0. ÉTAT

**Le module de réservation natif est livré et poussé** (lots 1-2-3). La
coexistence tient : `campaigns.scheduling_native` vaut `false` par défaut, donc
la chaîne Cal.com reste seule en service tant que personne ne bascule une
campagne. Les lots 4 (extinction du stock Cal.com) et 5 (décommission) restent
à faire — `docs/specs/scheduling-module.md`.

Sont également sur `main` et poussés : « aucun refus envoyé automatiquement »
(RGPD), le refus groupé, la refonte Paramètres, le multi-utilisateur, les jours
fériés, le signal 4, et la fiabilisation IMAP.

Dev est vert : typecheck, **1554** tests unitaires, **110** de régression
(S1-S15), build, lint identique à la baseline.

---

## 1. BLOQUANT — mettre la production en conformité

Le CODE est déployé ; la BASE et l'ENVIRONNEMENT ne le sont pas
nécessairement. Tant que ces trois points ne sont pas faits, des écrans
entiers répondront 500 en prod.

### 1.1 Migration Supabase PROD

`scripts/migrate.sql`, **fichier entier**, **deux exécutions successives** (règle
absolue), puis **Dashboard → Reload schema cache**.

Ce que la prod n'a probablement pas encore : les 9 tables `sched_*` + la
fonction `sched_rate_limit_hit`, `campaigns.scheduling_native`,
`app_settings.branding_config`, `interview_booking_events`, le CHECK étendu
`candidate_analyses_decision_zone_chk` (valeur `proposed_reject`), et
**`mailboxes.folder`** (ajoutée le 21/08 — sans elle, toute création ou édition
de boîte mail échoue en 500 ; c'est exactement ce qui a fait rougir S1/S11/S15
en dev avant application).

Contrôle : `npm run check:scheduling` → `TOUT EST EN PLACE`.
⚠️ Vérifier avec un vrai `SELECT` : `select(head: true)` ne remonte PAS
l'absence d'une table.

### 1.2 Variables d'environnement

| Variable | Pourquoi | État |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | base des liens `/r/` et `/b/` **et** du domaine de l'UID iCalendar. À poser sur l'**alias de production** (`orqa-bia-prod.vercel.app` — pas besoin d'un domaine acheté). Sans elle, le repli prend l'URL du *déploiement*, qui change à chaque mise en ligne : liens morts et rendez-vous dupliqués à la première modification. | **à vérifier** |
| `CRON_SECRET` | fail-closed : sans lui la route cron répond 500 et la relève mail s'arrête. | posé sur la démo (vérifié : la route rend **401**, pas 500) — **à vérifier en prod client** |

Poser une variable ne suffit pas : **Vercel les attache par déploiement**, il
faut redéployer.

### 1.3 Savoir qui pointe où

Deux instances coexistent et **ne partagent pas la même base** :

- `virtual-company-chi.vercel.app` (démo) ;
- `orqa-bia-prod.vercel.app` (prod client).

Avant tout diagnostic « ça ne marche pas », **établir quel projet Supabase
chaque instance interroge**. Une heure a été perdue le 20/08 à chercher pourquoi
un `git push` ne changeait rien : la boîte concernée vivait dans le projet du
`.env.local`, relevé par le `next dev` local, pas par l'instance déployée.

---

## 2. Suites du chantier IMAP

Le gros est fait (démarrage au bord récent, fermeture et ouverture bornées,
dossier configurable, `imap_mailbox_skipped`). Ce qui reste :

- **Le signal 4 n'a aucun badge.** Il n'apparaît que dans le toast, une fois
  par session de navigateur, sur `/rh/recrutement`. Les trois autres signaux ont
  un badge d'onglet ; celui-ci vise `/settings`, qui n'en est pas un. Piste :
  pastille sur le lien « Paramètres » du `TopBanner`
  (`src/components/navigation/TopBanner.tsx:69`). Coût : le bandeau devrait
  consommer les signaux (un fetch de plus par page).
- **Une boîte au compte LENT reste irrelevable sur Vercel.** L'ouverture est
  maintenant bornée à 20 s et l'échec est tracé, mais un compte à ~10 s par
  commande n'entrera jamais dans `maxDuration = 60`. Trois sorties, aucune
  n'est du code : laisser le compte respirer (la limitation du fournisseur
  s'atténue), utiliser une boîte dédiée, ou monter `maxDuration` **si le plan
  Vercel le permet** (`src/app/api/cron/imap-poll/route.ts:27`, Hobby plafonne
  à 60).
- **`imap_unmatched_cvs` : 107 lignes parasites en dev**, résidu du crawl du
  20/08 (plans d'accès, procédures). Sans effet sur les candidatures, mais elles
  pollueront le futur écran de rejeu. Purge ciblée par `mailbox_id` si besoin.
- **UI de rejeu des `imap_unmatched_cvs`** — toujours au backlog, API only.

---

## 3. Chantiers candidats (à arbitrer avec le DO)

- **Cartographie produit du Manager** — les surfaces récentes (référent, section
  Recruteurs, sans-suite, dialog de clôture, **disponibilités**, **onglet
  Entretiens**, **dossier relevé**) sont inconnues de
  `manager-cartography.ts` : le Manager ne sait pas y orienter et avouera son
  incertitude. Quasi-obligatoire, et le lot 3 vient d'en ajouter.
- **Lots 4-5 du module de réservation** : extinction du stock Cal.com puis
  décommission (`docs/specs/scheduling-module.md`).
- **Lot audit 🟠 résiduel** (`docs/audit/audit-orqa.md`) : I1 (`send_failed`
  jamais re-tenté + brief mis en file quand même), I2 (couche d'audit poller en
  `.catch(() => {})`), puis I3/I4, I15/I16, I17.
- **Settings I12** : sauvegarde optimiste sans rollback (`SettingsHub`).
- **`/validations-vivier` hors préfixe proxy** (SEC-7 résiduel).
- **Fériés hors métropole** : Alsace-Moselle (Vendredi saint, 26 décembre) et
  outre-mer sont volontairement hors périmètre — les poser sans savoir où
  travaille la personne bloquerait des journées ouvrées à tort.
- Voir `docs/BACKLOG.md` pour le reste.

---

## 4. OUT (ne pas entamer sans décision)

- n8n / event bus externe (post-MVP).
- Cloisonnement de données par recruteur — le modèle « espace commun » est un
  CHOIX validé, ne pas le remettre en cause au détour d'un ticket.
- **V2 du module de réservation** : synchronisation Google/Outlook (OAuth),
  liens visio uniques par RDV, rappels J-1, réémission automatique après
  annulation. La couture existe, ne pas l'implémenter.
- Option B Cal.com (Team payante) — sans objet.

---

## Rappels d'exécution permanents

- `migrate.sql` = état final idempotent : un bloc canonique par contrainte,
  guards sur la DÉFINITION, **double application en dev avant la prod**.
- Cadrage + inventaire EXHAUSTIF des lecteurs avant de coder (réflexe DO).
- `npm run typecheck` + `npm test` avant commit ; `npm run test:regression`
  (**S1-S15**, base DEV, application fermée) avant tout push.
- Le DO pousse lui-même (`! git push origin main`).
- **Une instance Vercel ne relève JAMAIS le mail toute seule** : le
  `setInterval` est désactivé si `process.env.VERCEL`, `vercel.json` est `{}`,
  c'est **cron-job.org** qui appelle `/api/cron/imap-poll`. Son historique
  affiche « Échec (délai d'attente) » dès 30 s alors que la fonction dispose de
  60 s : ce n'est pas un échec de la relève.
- **Le poller lit le dossier configuré (défaut INBOX).** Un mail de test envoyé
  *depuis* la boîte surveillée part dans `\Sent` et restera invisible.
- **Jamais deux poller sur une même base** (`next dev` local + cron déployé).
