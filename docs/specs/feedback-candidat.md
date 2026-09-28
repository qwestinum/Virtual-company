# Message au candidat après décision — et « Recruté »

Chantier `feat/feedback-candidat`, 28/09/2026. Lots 1 à 5 livrés (commits
`19bf800`, `689723e`, `c23ab1f`, `c719e0f`, `e5a9151`). Inventaire des
lecteurs d'étape : `docs/specs/feedback-candidat-inventaire-etapes.md`. Lexique :
`docs/ux/lexique.md` §4. Configuration : `docs/ops/configuration-client.md`
§2.2-2.3.

## 1. Le constat

Un candidat refusé sur CV recevait un mail ; un candidat reçu en entretien ne
recevait **rien** après le verdict — ni retenu, ni non retenu. Même trou pour
l'absent classé non retenu, le « classer sans suite » individuel, et les retenus
non choisis à la clôture.

## 2. La règle

À chaque décision qui clôt une candidature, **l'un de deux gestes est
obligatoire** — jamais le silence, jamais l'envoi forcé :

- **Envoyer ce message** : gabarit des Réglages pré-rempli, relu, retouchable ;
  signé du recruteur, `Reply-To` = son adresse, mention RGPD ajoutée par le code ;
- **Je préviens moi-même** : téléphone, messagerie personnelle, autre (précisé) —
  aucun envoi, le canal est tracé.

C'est une règle **serveur** : les routes refusent une décision sans ce choix
(`feedback_required`), et contrôlent le choix **avant** toute écriture
(`checkFeedbackChoice` : adresse connue, commentaire interne absent du message,
aucune variable restée entre crochets).

| Décision | Route | Gabarit |
|---|---|---|
| Verdict final (retenu / non retenu) | `POST /api/candidatures/[id]/verdict` | Retenu / Non retenu |
| Absent classé non retenu | `POST /api/candidatures/[id]/no-show` (le journal générique refuse `missed`) | Absent |
| Classer sans suite (individuel) | `POST /api/candidatures/[id]/dismiss` (sauf doublon / invalide) | Sans suite |
| Clôture : retenus non sélectionnés | `POST /api/campaigns/[id]/close` | Non retenu |
| Clôture / poste pourvu : dossiers ouverts | idem, envoi **groupé** (case cochée) | Sans suite |
| Rattrapage (verdict antérieur, envoi raté) | `POST /api/candidatures/[id]/feedback` — type **déduit** de l'état | selon l'état |

## 3. Invariants

1. **Le commentaire du recruteur ne part jamais** : `FeedbackTemplateVars` est une
   liste fermée (garde structurelle + test négatif), et un corps qui recopie le
   commentaire est refusé (`comment_in_message`).
2. **Un seul envoi par (candidature, type)** : verrou deux-phases
   (`imap_outreach_claims`, pseudo-boîte `candidate_feedback`) ; le « sans suite »
   réutilise la clé historique `candidature_dismissal` — un seul message sans
   suite par candidature, quel que soit le chemin. Double clic, rejeu : `duplicate`.
3. **Une correction de décision n'envoie rien** (garde structurelle
   `decision-correction` n'importe pas `feedback`) ; la fiche dit « non informé »
   et propose « Informer le candidat ».
4. **Le corps n'entre jamais au journal** : `candidate_feedback_recorded` porte
   l'identifiant de la ligne, le type, le canal, le statut.
5. **Aucune décision sous panne d'envoi** : la décision est posée d'abord ; un
   message qui ne part pas se DIT (`send_failed`, fiche « non informé »), il ne
   défait rien.

## 4. Modèle

- Table **`candidate_feedback`** (`scripts/migrate.sql`) : rattachée à l'analyse
  (`on delete cascade`), `kind` (retenu · non_retenu · absent · sans_suite),
  `channel`, `subject`/`body` **tels qu'envoyés** (NULL pour « je préviens »),
  `mail_status`. Ajout seul, sauf la **pose unique** du statut d'envoi
  (`pending` → final), tenue par déclencheur. Registre RGPD : **EFFACER** par
  rattachement (`purge:candidate`).
- Gabarits : quatre champs de `interview_config` (défauts Zod, aucune migration).

## 5. « Recruté » et les dix étapes

- **Retenu** = retenu par le cabinet après entretien, présenté au client — la fin
  de ce qu'ORQA orchestre, jamais une promesse d'embauche.
- **Recruté** = désignation HUMAINE à la clôture d'une campagne conclue,
  marqueur `candidate_hired_marked` (dernier gagne, gomme `cleared` via
  « Annuler la désignation »). Jamais déduit ; ne vaut que sur un retenu.
- Étapes : À valider · Propositions de refus · Invité · RDV pris · Entretien fait
  · Retenu · Recruté · Écarté · Non retenu · Sans suite. « Écarté » = refusé sur
  CV (proposition validée ou arbitrage ; inclut les refus automatiques antérieurs
  au 18/08). Somme des dix = Reçues, sur chaque campagne (régression S6).
- Carte campagne : ENTONNOIR (Reçues · À valider · Invité · Entretien fait ·
  Retenu · Recruté) — chaque candidature PASSÉE par une étape la compte (règle
  du donneur d'ordre, 28/09/2026 : un recruté a été retenu, un retenu non
  sélectionné à la clôture a été retenu), soldé par le taux de conversion
  (recrutés / reçues). Chaque compteur ouvre Candidatures sur les candidatures
  qu'il compte (`?parcours=…`, S44). Les PUCES gardent l'étape courante.
  Règle unique `passedThrough` (`src/lib/reporting/campaign-trajectory.ts`),
  partagée avec l'entonnoir du rapport.

## 6. Clôture

Dialogue : le recrutement est-il conclu ? → qui est recruté — UN OU PLUSIEURS
(cases, 28/09/2026 ; jamais pré-cochées, « ne pas préciser » possible) → un message par retenu non sélectionné → dossiers
ouverts classés sans suite → dépublication Apec. Serveur (`checkClosure` puis
`applyClosureDecisions`) : tout est contrôlé contre l'état RELU avant la
première écriture ; non-sélectionnés = verdict canonique `rejected` + cause
`not_selected_at_closure`. **`campaign_closed` n'a qu'un écrivain** : la route de
clôture (issue, `hiredAnalysisIds[]`, non-sélectionnés — identifiants
seulement ; l'ancien `hiredAnalysisId` reste lu, `hiredIdsOfClosure`).

**Un verdict « retenu » n'est pas un poste pourvu** (bug du 28/09/2026) : le
dialogue « Poste pourvu — candidatures restantes » ne s'ouvre plus après le
verdict ; le classement des candidatures restantes appartient à la clôture.

Filet : signal **`closure_incomplete`** (« à vérifier ») quand `campaign_closed`
annonce un recruté ou des non-sélectionnés sans leurs marqueurs. Transaction
unique + messages sur le rail : **backlog** (`docs/BACKLOG.md`).

## 7. Où la décision se lit

- Fiche : état « informé / non informé » + « Informer le candidat ».
- Frise : « Recruté », chaque message (envoyé · prévenu · non parti).
- PDF d'audit : rubrique « Message au candidat » (corps tel qu'envoyé).
- Rapport de campagne : du CV au recrutement, taux de placement (recrutés /
  retenus, quand un recruté est désigné), « candidats reçus en entretien informés :
  N/M » — un indicateur, jamais le contenu.
- Pilotage : « Recrutement conclu — nom » (désignation courante).
- Vivier : recrutés exclus `hiredCooldownMonths` (12 par défaut).

## 8. Tests

Unitaires (règles pures, routes, verrou d'envoi, contrôles de clôture, frise,
PDF) ; régression **S26** (clôture par les vraies routes, signal de clôture
incomplète) et S6/S9/S10/S16/S25 réalignées ; suites qui cliquent **S43**
(verdict), **S44** (compteurs = puces), **S45** (clôture, trois cas), **S46**
(informer après coup) — envoi réel vérifié quand `E2E_FEEDBACK_INBOX` est posée.

## 9. Ouvert

- « N recrutement(s) finalisé(s) » du rapport de campagne compte encore les
  **retenus** (calcul historique) : à basculer sur les recrutés ou à renommer —
  arbitrage du donneur d'ordre (basculer changerait les rapports déjà envoyés).
- Retenu non recruté mis en avant par le vivier sur une campagne similaire :
  backlog.
- Cartographie du Manager : citer « Propositions de refus », « Recruté » et
  « Informer le candidat ».
