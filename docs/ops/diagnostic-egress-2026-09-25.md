# Diagnostic d'egress Supabase — base dev/démo (25/09/2026)

> **Mesure, lecture seule, aucun correctif appliqué.** Organisation `tuvympuyqjgdvfcbruzp` :
> 11,6 Go sortis sur le mois pour un quota de 5 Go (~400 Mo/jour) ; restriction annoncée au
> 28/09. La prod (`obkruafjsbynwbayzuvy`) est sur une autre organisation, hors sujet.
> Aucune donnée personnelle ici : routes, formes de requêtes, volumes.

---

## 0. Conclusion en trois lignes

- **Boucle à couper (gratuit) — la majorité du mois** : la relève IMAP tourne **en double** sur la
  base partagée — le minuteur local de 30 s (`npm run dev` sur le poste) ET le cron externe à la
  minute (cron-job.org → Vercel) —, contrairement à la règle « un seul releveur à la fois ».
  Mesuré à l'instant : **2,95 ticks/min ≈ 540 Mo/jour**, dont 2/3 par le poste local.
- **Structurel (un lot)** : chaque tick relit la **liste COMPLÈTE des campagnes** (`select *`,
  60 Ko compressés) **pour chaque boîte**, même quand aucun mail n'est arrivé : 94 % du poids
  d'un tick. À lui seul, le cron externe (1/min) sort **~5,5 Go/mois** — au-dessus du quota même
  sans le poste local. S'y ajoute le Bureau, qui sonde toutes les 5 s **même onglet caché**
  (~1,8 Go/jour par onglet oublié).
- **Légitime (à ne pas payer)** : authentification, Storage (le bucket entier pèse 92 Mo),
  usage réel des écrans, suites de test — **moins de 1 Go/mois**. Après les deux premiers
  points, l'egress attendu retombe vers **0,3-0,5 Go/mois** : **pas besoin de payer**.

⚠️ **Deuxième projet dans la même organisation** : « qwestinum SW » (`unfunwcnwyvpayirazrd`,
Francfort). Le quota est **par organisation** : son egress n'a pas pu être mesuré ici (§1) et
reste un suspect tant qu'on n'a pas lu son rapport d'usage.

---

## 1. Méthode et limites

- **Accès** : la lecture du jeton de gestion Supabase a été refusée (et n'a pas été contournée) ;
  pas d'accès au dashboard ni au Logs Explorer. Mesures faites par la CLI (`supabase link` dans
  un répertoire temporaire, `inspect db`, `db query` en LECTURE) sur `pg_stat_statements`, et par
  des requêtes REST réelles pour mesurer la taille **sur le fil** des réponses.
- **`pg_stat_statements` compte depuis la création du projet (11/05/2026)**, pas depuis 30 jours :
  il donne la **répartition** cumulée, pas la courbe par jour. Le **débit actuel** a été mesuré par
  deux relevés à **10,2 minutes** d'intervalle, sans aucune activité humaine sur les écrans.
- **PostgREST agrège chaque réponse en une ligne** : le nombre de lignes renvoyées ne dit rien du
  poids. Le poids vient de requêtes REST réelles, mêmes en-têtes que `supabase-js` sous Node.
- **Les réponses partent compressées (gzip)** : la liste des campagnes fait 241 Ko décodés mais
  **60 Ko sur le fil**. Tous les volumes ci-dessous sont sur le fil (compressés) — l'hypothèse la
  plus basse ; si Supabase comptait le décodé, tout serait ×4.
- **Non mesurés ici, à lire dans le dashboard** (Reports → API / Storage, par jour) : la courbe
  quotidienne, la répartition exacte API / Storage / Auth, et l'usage du projet « qwestinum SW ».

---

## 2. Répartition par source

| Source | Mesure | Estimation |
|---|---|---|
| **API REST (PostgREST)** | 3,17 M requêtes depuis le 11/05 (~23 000/jour en moyenne) ; **48,5/min aujourd'hui, toutes issues de la relève** | **quasi-totalité** |
| Auth | ~245 000 lectures de session depuis le 11/05 (`getUser` : proxy + route, 2 par requête authentifiée) | ~0,4 Go cumulés — légitime |
| Storage | bucket `artifacts` : **92 Mo au total**, 17 Mo ajoutés en 30 jours ; téléchargements non mesurables sans les journaux | borné : < 1 Go/mois sauf boucle (aucune trouvée) |
| Realtime | aucun usage dans le code (`.channel(` absent) | 0 |

## 3. Courbe par jour

**Non disponible sans le Logs Explorer.** Indices :
- le débit **actuel** est un **plateau** : 2,95 ticks/min mesurés sur 10 minutes, sans humain ;
- le drain des événements de réservation (1 appel par tick, présent depuis août) totalise
  88 000 appels : la moyenne historique est très inférieure au rythme d'aujourd'hui — le débit
  s'est **intensifié récemment** (poste local laissé tourner en continu et/ou ajout du cron) ;
- les pics (suites de régression/E2E, runs de comparaison de modèles) sont **ponctuels** et
  petits (§4, lignes 7-8). **À lire dans le dashboard** pour dater le début du plateau.

---

## 4. Top des formes de requêtes

Volume cumulé = appels depuis le 11/05 × taille actuelle sur le fil (majorant : les tables étaient
plus petites au début).

| # | Forme (route du produit) | Appels | Poids / appel (fil) | Cumulé | Qui l'appelle | Proportionnée ? |
|---|---|---:|---:|---:|---|---|
| 1 | `campaigns` `select *` complet (`listCampaigns()`) | 275 000 | **60 Ko** (34 campagnes, fiche + grille + cycle de vie en JSON) | **~16,5 Go** | **relève IMAP** (`poller.ts:355`, 1 fois PAR BOÎTE, à chaque tick) ; `/api/metrics/global` (Bureau, 5 s) ; onglet Entretiens (`interviews/board.ts`) ; chat Manager ; écran Campagnes | **Non** — la relève n'a besoin que des campagnes rattachées à la boîte, et seulement si un mail est arrivé |
| 2 | `journal` fenêtre brute 500 lignes (`fetchMetricsRows`) | 80 000 | 25 Ko | ~2,0 Go | `/api/metrics/global` — Bureau et panneau d'activité, sondés toutes les 5 s | Non quand l'onglet est caché |
| 3 | `journal` par actions, 50-150 dernières | 171 000 | 1-8 Ko | ~0,5-1,4 Go | fil d'activité (Bureau) ; file des clôtures en attente (1/tick, presque toujours vide) | Oui (fenêtre ciblée) |
| 4 | `pending_validations` `select *` en attente | 133 000 | 7 Ko | ~0,9 Go | `/api/metrics/global`, validations, signaux | Acceptable |
| 5 | Auth `getUser` (sessions, identités, facteurs) | 245 000 | ~1-2 Ko | ~0,4 Go | proxy + chaque route authentifiée | Légitime (doublon proxy/route à regarder un jour) |
| 6 | `campaigns` par id (`select *`) | 24 500 | ~7 Ko | ~0,2 Go | écrans de campagne, routes | Oui |
| 7 | `app_settings` `select *` | 46 800 | 2,4 Ko | ~0,1 Go | réglages lus à chaque tick et par les routes | Oui |
| 8 | `artifacts_meta` par campagne | 60 000 | ~1-3 Ko | ~0,1 Go | écrans de campagne | Oui |
| 9 | `sched_bookings` / `sched_events` (drain) | ~150 000 | ~0-2 Ko | < 0,1 Go | rail de relève (1/tick) | Oui |
| 10 | `mailboxes` update + select, `campaign_mailboxes`, `imap_cv_retries` | ~620 000 | < 0,5 Ko | < 0,1 Go | relève (1-2/tick) | Oui — mais 216 665 **écritures** sur `mailboxes` : même boucle |

Écran **Candidatures** : rafraîchi toutes les **25 s** (`useCandidatures`, même onglet caché) ;
**Vivier** : toutes les 5 s **seulement** tant qu'un dossier est en cours d'indexation. Ni l'un ni
l'autre n'était actif pendant la mesure.

---

## 5. Origines

| Origine | État constaté | Part du débit actuel |
|---|---|---|
| **Poste local** (`next dev`, port 3000) — minuteur de relève 30 s au démarrage (`instrumentation.ts`) | **actif** (processus en cours) | **~2 ticks/min ≈ 360 Mo/jour** [déduit : 2,95 − 1] |
| **Cron externe** cron-job.org → `virtual-company-chi.vercel.app/api/cron/imap-poll` | actif [déduit du rythme] | **~1 tick/min ≈ 180 Mo/jour ≈ 5,5 Go/mois** |
| Démo Vercel (même base) | pas de second cron visible (sinon ~4 ticks/min) | usage des écrans seulement |
| Serveurs de mesure 3100 / 3101 (chantier latence) | **arrêtés** — aucun processus n'écoute (vérifié) | 0 |
| `/api/cron/busy-calendars` | route absente de la branche courante ; existe sur `feat/agenda-externe` — si un déploiement l'expose avec un job cron, ses lectures en base sont minimes (536 écritures au total sur `recruiter_busy_snapshots`) ; les agendas se lisent chez le fournisseur, pas chez Supabase | négligeable |
| Previews de branches Vercel | non observables ici | à vérifier dans Vercel (crons ? onglets ouverts ?) |
| Suites de test (régression, E2E), scripts (`compare:models`, `rescore`) | ponctuels | négligeable en volume |
| **Projet « qwestinum SW »** (même organisation) | **non mesuré** | **inconnu — à lire dans le dashboard** |

---

## 6. Le cron (et le minuteur)

- **Seul cron** sur cette branche : `/api/cron/imap-poll` (`vercel.json` n'en déclare aucun ;
  la cadence vient de cron-job.org). Le minuteur local exécute **exactement le même tick**
  (`src/lib/imap/scheduler.ts` `runTick`).
- **Contenu d'un tick, même sans aucun mail** (mesuré : ~16 requêtes, **~128 Ko sur le fil**) :
  boîtes activées (0,5 Ko) ; **par boîte** : campagnes rattachées (0,2 Ko), **liste complète des
  campagnes (60 Ko)**, réessais IMAP, mise à jour de `last_polled_at` ; puis drain des
  réservations (~2 Ko), maintenance sourcing (~1 Ko), maintenance vivier, file des clôtures
  (~0 Ko), réglages (2,4 Ko).
- **Volumes** : 1 tick/min = 1 440 ticks/jour ≈ **184 Mo/jour** ; le poste local en ajoute
  2 880 ≈ **368 Mo/jour** quand `next dev` tourne.
- Réponse HTTP du cron lui-même (compteurs) : négligeable, et elle ne sort pas de Supabase.

## 7. Le Storage

Bucket unique `artifacts` : **9 092 objets, 92 Mo** (dont 6 492 PDF). Les téléchargements ne
sont pas comptables sans les journaux ; par le code :
- **CV** : lien signé au clic (`/api/artifacts/<id>/signed-url`) — un téléchargement par
  ouverture, **pas de cache navigateur** au-delà de la durée du lien ;
- **rapport d'analyse** : PDF **généré à la volée** depuis l'analyse (aucune lecture Storage) ;
- **rapport de campagne** : PDF mis en cache dans Storage, relu à chaque ouverture ;
- **scripts** (`compare:models`, `rescore`) : relisent des CV — quelques dizaines de Mo par run.

Même retéléchargé 10 fois, le bucket entier ferait < 1 Go : **le Storage n'explique pas 11,6 Go.**

---

## 8. Livrable — source → Go → cause → correctif proposé → gain

Classé par volume, **au rythme actuel sur 30 jours** (cumulés : §4).

| # | Source | Go / 30 j | Cause | Correctif proposé | Gain estimé | Nature |
|---|---|---:|---|---|---|---|
| 1 | Relève par le **poste local** (minuteur 30 s) | **~11** si `next dev` tourne en continu | Deuxième releveur sur une base partagée avec le cron — règle « un seul releveur » non tenue | Couper l'un des deux : désactiver le minuteur local quand la base est partagée (variable d'environnement, ex. `IMAP_LOCAL_SCHEDULER=off`) **ou** mettre en pause le job cron-job.org pendant le développement | **~11 Go** (tout ce releveur) | **Boucle à couper — gratuit** |
| 2 | Relève par le **cron externe** (1/min) | **~5,5** | `listCampaigns()` complet par boîte et par tick, même sans mail | Ne lire les campagnes que **s'il y a des messages** à traiter, et seulement les **rattachées** à la boîte, en **projection** (colonnes utiles) — même geste que `listCampaignSummaries(ids)` | **~5,2 Go** (le tick tombe à ~8 Ko) | **Structurel — un lot** |
| 3 | **Bureau / panneau d'activité** sondés toutes les 5 s | **~1,8 / jour par onglet oublié** (non actif pendant la mesure ; ~80 000 appels cumulés ≈ 110 h d'onglet ouvert) | `setInterval` continue onglet caché ; la route relit elle aussi `listCampaigns()` complet | Suspendre le sondage onglet caché (reprendre au retour — le rechargement au retour existe déjà) ; projection des campagnes dans `/api/metrics/global` | jusqu'à **~50 Go/mois** évités par onglet oublié ; ~90 % par appel | Structurel — même lot |
| 4 | Écran **Candidatures** (25 s, même caché) | < 0,5 [non mesuré] | rafraîchissement périodique | même suspension onglet caché | faible | Structurel — même lot |
| 5 | Auth (`getUser` ×2 par requête) | ~0,1 | proxy + route | aucun pour l'instant | — | Légitime |
| 6 | Storage (téléchargements) | < 0,5 | usage réel | aucun | — | Légitime |
| 7 | Suites de test, scripts | < 0,5 | runs ponctuels | aucun | — | Légitime |
| ? | **Projet « qwestinum SW »** | **inconnu** | — | lire son usage dans le dashboard | — | à qualifier |

**Lecture** : 11,6 Go constatés ≈ cron externe continu (~5,5 Go) + poste local une partie du mois
(~5-6 Go ≈ deux semaines de `next dev` ouvert) + usage des écrans. Les deux premières lignes
suffisent à repasser sous le quota ; avec le lot structurel, l'egress retombe à ~0,3-0,5 Go/mois.

**Avant le 28/09** (décision, rien n'a été fait) : le geste le plus rapide et réversible est
d'**arrêter l'un des deux releveurs** — fermer `next dev` quand on ne développe pas, ou mettre en
pause le job cron-job.org. Aucun serveur n'a été arrêté : les serveurs de mesure 3100/3101
étaient déjà arrêtés.

---

## 9. Correctifs appliqués (26/09/2026, branche `fix/egress`) et mesure avant/après

Décisions du donneur d'ordre, dans l'ordre :

1. **Minuteur local : pause après 15 min sans requête utilisateur**, reprise à la première requête
   suivante, les deux JOURNALISÉES (`imap_local_scheduler_paused` / `imap_local_scheduler_resumed`),
   **sans variable**. Le proxy horodate chaque requête (hors `/api/cron/*`) et réveille le minuteur
   en pause (`src/lib/imap/user-activity.ts`, module sans dépendance). ⚠️ En **développement
   seulement** (`next dev`) : sous `next start` (un VPS de production), une pause la nuit, faute de
   visite, arrêterait la réception des CV — là, le minuteur EST le releveur.
2. **Tick de relève allégé** : UNE lecture (boîtes activées + campagnes rattachées réduites à
   identifiant/statut, `listEnabledMailboxesForPoll`) et une lecture groupée des réessais
   (`imap_cv_retries` n'a pas de clé étrangère vers `mailboxes` : l'embarquer aurait demandé une
   migration) ; **zéro lecture** tant qu'aucune boîte n'est due (échéance lue sur `last_polled_at`,
   intervalle 50 s — sous la cadence du cron pour que la gigue ne saute pas un passage sur deux —,
   `src/lib/imap/poll-due.ts`) ; le **dossier complet** d'une campagne n'est chargé qu'au traitement
   d'un mail rapproché ; la relève manuelle (`/api/imap/poll-now`) ignore les échéances. Effet de
   bord voulu : le poste local ne relève plus une boîte que le cron vient de relever.
   ⚠️ Les campagnes rattachées **inactives** restent lues (deux colonnes) : la trace « CV reçu pour
   une campagne inactive » en dépend. Les autres rails du tick (drain des réservations, sourcing,
   vivier, clôtures) lisent toujours à chaque tick — ~8 Ko.
3. **Pilotage → Activité** : l'onglet était DÉJÀ masqué depuis le 21/09 (aucune adresse : les
   sous-onglets de Pilotage n'en ont jamais eu, rien à passer en 404) ; `ActivityPanel` n'avait plus
   d'importeur — **supprimé**, son sondage avec lui. ⚠️ Un déploiement Vercel antérieur au 21/09 peut
   encore l'afficher.
   **`/api/metrics/global` garde deux lecteurs** et n'est donc PAS retirée : **`/admin/dashboard`**
   (`DashboardView`, le Bureau résiduel réservé à l'admin) **la sonde toujours toutes les 5 s, même
   onglet caché** (~1,8 Go/jour par onglet oublié) — non modifié, décision à prendre ; *Aujourd'hui*
   la lit UNE fois à l'affichage (bande de répartition, `poll: false`). Les avatars de la bande
   d'équipe d'*Aujourd'hui* ne dépendent pas de cette route. Composants devenus orphelins avec
   `ActivityPanel`, non supprimés : `AgentDetailsPanel`, `HRDepartmentView`, `bureau/ZoneDistribution`.

**Mesure.** « Avant » : instantané complet de `pg_stat_statements` le 25/09 à 22:03 UTC (ancien code
sur le poste et sur Vercel) ; débit mesuré ~**570 Mo/jour** (script de comparaison validé sur le
relevé du 25/09 : 2,95 ticks/min). « Après » : attendu ~**15-35 Mo/jour** (cron 1/min : lecture
~1 Ko + rails ~8 Ko ; poste local seulement quand on travaille) — **cible < 100 Mo/jour**. Pour
mesurer : redémarrer `next dev` (le minuteur garde le code du démarrage), déployer sur Vercel la
branche servie par le cron, puis 24 h plus tard prendre l'instantané « après » et comparer ; la
vérité reste le rapport d'usage quotidien du dashboard Supabase.
