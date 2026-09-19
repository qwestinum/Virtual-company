# Compte rendu d'entretien + commentaire du recruteur — Phase 1 (étude)

> **Statut au 18/09/2026 : ÉTUDE VALIDÉE, arbitrages consignés au §14 (ils
> priment sur le corps de l'étude là où ils le modifient ; le §16 rend le
> commentaire FACULTATIF). Phase 2 : lots 1 à 4 livrés — avancement au §15.**
> Ce document établit où vivent les deux objets, où le verdict est bloqué dans le
> chemin existant (fichier:ligne), comment la transcription est traitée sans
> jamais être conservée, et ce que chaque lecteur (fiche, frise, PDF d'audit,
> rapport, briefing, purge) doit en faire. Les décisions qui restent au donneur
> d'ordre sont regroupées au §11.

---

## 0. Ce qui change par rapport au brief

Sept précisions ou objections, par ordre de conséquence.

**0.1 — Le verdict n'a aujourd'hui AUCUN point de passage serveur.** Il s'écrit
comme une ligne de journal quelconque : le navigateur envoie
`candidate_validation_marked` à `POST /api/journal`
(`src/lib/dashboard/candidate-actions.ts:49-68` → `postJournal` `:78-96` →
`src/app/api/journal/route.ts:47-72`), une route générique qui accepte n'importe
quelle action. Un blocage posé dans l'interface seule serait contournable, et
surtout il faudrait le recopier sur **trois** surfaces qui posent un verdict
(§4.1). Il faut une **route de verdict dédiée**, et `/api/journal` doit refuser
cette action. C'est le vrai point dur de la Phase 2.

**0.2 — Il n'existe pas de « fiche d'entretien ».** Un entretien existe sous
trois formes : une ligne de `interview_briefs` (parfois absente), une ligne de
l'onglet Entretiens, et l'étape `entretien_fait` d'une candidature. Le seul
endroit qui raconte l'histoire complète est la **fiche candidature** (panneau
`CandidaturePanel.tsx` et page `CandidatureFullPage.tsx`). C'est là que vivent
les deux champs. L'onglet Entretiens y renvoie au moment du verdict (§9).

**0.3 — « Points forts » et « réserves » sont des jugements.** Un compte rendu
qui « ne juge pas » ne peut pas écrire « point fort : autonomie ». Dans le CR
**généré**, ces rubriques deviennent des restitutions attribuées : « ce que le
candidat a mis en avant », « réserves exprimées pendant l'entretien » (par qui,
avec citation), « points restés sans réponse ». Dans le CR **rédigé à la main**,
le recruteur écrit ce qu'il veut : c'est un humain.

**0.4 — « Réserves » n'est pas un troisième verdict.** Le verdict reste binaire
(`validated` | `rejected`, `decision-markers.ts:32`). Un « GO avec réserves »
est un GO dont le commentaire dit les réserves. Ajouter une valeur de marqueur
serait l'état parallèle que le module d'entretien s'interdit.

**0.5 — Le « deuxième tour » n'existe pas dans le modèle.** Après
`entretien_fait`, seuls « GO définitif » et « Non retenu » sont offerts
(`CandidatureActions.tsx:151-156`). Le CR est prévu pour porter un numéro de tour
(le schéma est prêt), mais « le briefing affiche le CR du tour précédent » n'a
pas d'occasion de se produire aujourd'hui. À ne pas construire avant qu'un
deuxième tour existe (§7.3).

**0.6 — Le briefing part par MAIL, en copie aux adresses de synthèse**
(`src/lib/interview/deliver-brief.ts:286`). Y mettre le contenu d'un CR, c'est le
sortir d'ORQA vers des boîtes que la purge n'atteint pas. Le briefing porte un
**renvoi** vers la fiche, jamais le contenu (§7.3).

**0.7 — Le rapport de campagne est agrégé et envoyé au donneur d'ordre client.**
Il ne contient aujourd'hui aucune section nominative (`campaign-report-pdf.tsx` :
synthèse, performance, vivier, scoring, recommandations, RGPD). Y verser des CR
nominatifs changerait sa nature. Recommandation : un **indicateur** dans le
rapport, le contenu dans le **PDF d'audit** par candidat (§7.2).

---

## 1. Les deux objets

| | Compte rendu (CR) | Commentaire du recruteur |
|---|---|---|
| Porte sur | ce qui s'est passé pendant l'entretien | pourquoi il décide |
| Auteur | le recruteur, ou ORQA à partir d'une transcription puis vérifié par le recruteur | le recruteur, **jamais l'IA** (pas même une reformulation) |
| Obligatoire | non | **oui**, avant tout nouveau verdict |
| Unité | un par entretien (tour) | un par verdict posé |
| Cycle de vie | brouillon → vérifié, modifiable ensuite | ajout seul, jamais modifié (une correction pose un nouveau commentaire) |
| Contient un avis | non s'il est généré ; libre s'il est rédigé | oui, c'est son rôle |

Les deux objets ont des cycles de vie différents, d'où deux tables et non une
(§2).

---

## 2. Où vivent les deux objets

### 2.1 Pourquoi pas `interview_briefs`

`interview_briefs` (`scripts/migrate.sql:1127-1150`) semble l'endroit naturel. Il
ne l'est pas, pour trois raisons :

1. **Un entretien peut avoir lieu sans ligne de briefing.** « Entretien réalisé »
   se pointe dès l'étape `invite` (`CandidatureActions.tsx:58-59`), donc sans
   réservation ; les briefings historiques n'ont pas d'`uid`
   (`migrate.sql:1148-1153`) ; le repli du webhook crée des lignes après coup.
   Un CR rattaché au briefing n'aurait parfois nulle part où s'accrocher.
2. **Le briefing a son propre cycle de vie** : dédoublonné par (campagne, email)
   tant qu'il attend (`interview-briefs.ts:97-120`), annulé au classement sans
   suite, restauré à la réouverture. Un CR ne doit suivre aucune de ces
   transitions.
3. **Le commentaire justifie un verdict**, pas un entretien. Or le verdict est
   indexé par `uid` d'analyse, pas par briefing.

### 2.2 Pourquoi pas des colonnes sur `candidate_analyses`

La table est **pseudonymisée** à la purge, avec un squelette en liste blanche
vérifiée à la compilation (`application-skeleton.ts`). On pourrait y ajouter des
colonnes, mais une colonne s'écrase : un verdict corrigé perdrait le commentaire
qui justifiait le premier. Or tout le modèle de décision est en ajout seul,
« dernier gagne » (`decision-markers.ts:1-23`).

### 2.3 Recommandation : deux tables dédiées

```
interview_reports                       -- le CR
  id               uuid pk
  analysis_id      text not null  → candidate_analyses(id) on delete cascade
  uid              text not null        -- clé des marqueurs de journal
  campaign_id      text
  brief_id         uuid null     → interview_briefs(id) on delete set null
  round            smallint not null default 1
  source           text check in ('manual','transcript')
  status           text check in ('draft','verified')
  sections         jsonb not null       -- même forme, que le CR soit généré ou rédigé
  generated_model  text null            -- traçabilité, jamais le texte source
  omitted_count    smallint null        -- passages hors cadre écartés (§5.4), compte seul
  verified_by_user_id / verified_by_email / verified_at
  created_at / updated_at
  unique (analysis_id, round)

verdict_comments                        -- le commentaire
  id               uuid pk
  analysis_id      text not null  → candidate_analyses(id) on delete cascade
  uid              text not null
  campaign_id      text
  verdict          text check in ('validated','rejected')  -- le verdict POUR LEQUEL il est écrit
  body             text not null check (length(btrim(body)) >= 20)
  author_user_id / author_email         -- identité de SESSION serveur
  created_at
```

- `verdict_comments` est en **ajout seul** : aucune route ne modifie ni ne
  supprime une ligne (sauf la purge).
- Le marqueur de verdict porte l'identifiant du commentaire
  (`payload.commentId`). Le commentaire qui compte est celui du **marqueur
  gagnant** : on réutilise le pliage `foldValidationMark`
  (`decision-markers.ts:135-141`) en y ajoutant la lecture de `commentId`, dans
  ce même fichier (il reste le seul à lire le payload des marqueurs).
- **Le texte du commentaire n'entre JAMAIS dans le journal.** Le journal est
  pseudonymisé à la purge, pas supprimé, et le caviardage par valeur ne reconnaît
  que les empreintes du candidat (`payload-pseudonymize.ts:13-17`) : un
  commentaire qui ne cite pas son nom (« solide techniquement, réserves sur la
  mobilité ») y survivrait. Le journal porte `commentId` et rien d'autre.
  *Constat au passage* : le `reason` libre de `decision_corrected`
  (`decision-correction.ts:216`) a déjà ce défaut. À consigner au backlog.

---

## 3. Le compte rendu rédigé à la main — les repères

Un seul éditeur, cinq rubriques **toutes facultatives**, chacune avec une phrase
d'aide en gris (placeholder) et non un formulaire à cases. Le recruteur peut
n'en remplir qu'une. Le CR généré (§5) remplit le même éditeur.

1. **Sujets abordés** : « Parcours, motivations, projet, conditions (disponibilité,
   mobilité, rémunération)… »
2. **Réponses aux critères de la campagne** : une sous-ligne par critère de la
   fiche de scoring **validée**, pré-intitulée avec le libellé du critère
   (« Pilotage MOA — ce que le candidat en a dit : »). Un critère non abordé
   reste vide ; il n'est pas marqué « non ».
3. **Points forts** (en manuel) / **Ce que le candidat a mis en avant** (en généré)
4. **Réserves** (en manuel) / **Réserves exprimées pendant l'entretien** (en généré)
5. **À vérifier lors d'un prochain échange** : références, point technique à
   creuser, pièce à fournir.

Rappel affiché au-dessus de l'éditeur, une ligne : « Ne consignez que ce qui a
un lien direct avec le poste. » (Code du travail L1221-6 : les informations
demandées à un candidat doivent avoir un lien direct avec l'emploi.)

---

## 4. Le commentaire obligatoire

### 4.1 Les trois surfaces qui posent un verdict aujourd'hui

| Surface | Boutons | Appel |
|---|---|---|
| Fiche candidature (panneau et page) | `CandidatureActions.tsx:151-156` | `FinalDecisionAction` → `markCandidateValidation` `:133` |
| Onglet Entretiens, section « verdict attendu » | `ScheduledList.tsx:163-177` | `InterviewsWorkspace.tsx:166-185` (`verdict`) → `markCandidateValidation` `:170` |
| Dashboard résiduel (`CandidatesCard`) | `CandidatesCard.tsx:~305` | `onValidation` → `markCandidateValidation` |

Toutes trois aboutissent à `candidate-actions.ts:49-68`, qui poste au journal
générique. Le seul geste serveur qui écrit aussi ce marqueur est la correction
(`decision-correction.ts:150-161`), qui appelle `appendJournalEntry` sans passer
par `/api/journal`.

### 4.2 Le point de blocage

1. **Nouvelle route** `POST /api/candidatures/[id]/verdict`
   `{ status: 'validated'|'rejected', comment: string }` :
   - relit l'analyse et l'étape côté serveur (`stageFor`) ; refuse (409) si
     l'étape n'est pas `entretien_fait` ;
   - refuse (400 `comment_required`) si le commentaire fait moins de 20
     caractères une fois les espaces retirés ;
   - insère le commentaire, **puis** le marqueur via `buildValidationMarkerEntry`
     (writer canonique, avec `commentId`), auteur tiré de `getApiUser()` ;
   - si le marqueur échoue, le commentaire reste orphelin : aucun marqueur ne le
     désigne, aucun lecteur ne l'affiche. On accepte cet orphelin plutôt que
     d'ajouter une transaction qui contournerait le writer du journal.
2. **`/api/journal` refuse `candidate_validation_marked`** (409
   `use_verdict_route`). Sans ce refus, le blocage n'est qu'une convention.
3. `markCandidateValidation` appelle la nouvelle route ; les trois surfaces
   ouvrent un dialog de décision (§9.3) au lieu de poser le verdict en un clic.
   Le dashboard résiduel peut aussi perdre ses boutons de verdict et renvoyer à
   la fiche (§11, décision D5).

### 4.3 Ce qui n'est PAS bloqué

- **Les verdicts déjà posés.** Aucune relecture ne les requalifie ; aucun écran
  ne les signale comme « incomplets ». La frise dit « aucun commentaire
  enregistré » (même règle que « auteur non enregistré »).
- **« Corriger la décision »**, ancien ou nouveau dossier. Une correction ne
  peut pas créer un premier verdict : elle n'est offerte que depuis un verdict
  existant (`correction-options.ts:119-136`). Elle garde son motif facultatif.
  Le dialog de correction **affiche** le commentaire existant et le verdict pour
  lequel il a été écrit, et propose (sans l'imposer) d'en ajouter un nouveau. Un
  GO corrigé en « Non retenu » garde un commentaire qui justifiait le GO : les
  lecteurs affichent donc toujours le commentaire **avec** son verdict et, si
  besoin, « verdict corrigé depuis ».
- **L'absence (no-show).** « Classer non retenu » depuis `NoShowDialog` pose un
  marqueur d'entretien `missed`, pas un verdict. Le motif (« absent ») est dans
  l'acte. Rien à bloquer ; un commentaire facultatif peut être offert.
- **La décision de la zone grise** (screening, avant tout entretien) et le
  **classement sans suite** (motif en liste fermée) : hors périmètre.

⚠️ **Rétro-compatibilité : la règle porte sur l'ACTE, pas sur le dossier.** Une
candidature déjà en `entretien_fait` au moment du déploiement demandera un
commentaire à son verdict, puisque ce verdict sera posé après. C'est voulu.

### 4.4 Ce que le champ dit au recruteur

Sous le champ, une ligne : « Ce commentaire fait partie du dossier. Le candidat
peut en obtenir communication s'il exerce son droit d'accès. » Les notes
d'entretien sont des données personnelles communicables (RGPD art. 15). Le
recruteur écrit mieux quand il le sait.

---

## 5. Import de transcription

### 5.1 Formats et taille

| Format | Source courante | Traitement |
|---|---|---|
| `.vtt` | Teams, Meet, Zoom | texte ; balises `<v Nom>` → locuteur ; horodatages gardés en ancre |
| `.srt` | Zoom, Otter | texte ; numéros de séquence retirés ; horodatages gardés en ancre |
| `.txt` | Otter, tl;dv, copier-coller | texte tel quel ; locuteurs « Nom : » détectés s'ils existent |
| `.docx` | Teams (téléchargement), tl;dv | `mammoth`, déjà utilisé par `extractCVText` (`cv-extract.ts:172`) |
| `.pdf` | Otter | facultatif — l'extracteur existe ; à trancher (D6) |

- Reconnaissance par **MIME ou extension** (même porte que le poller et le
  jobboard : `.srt` arrive souvent en `application/octet-stream`).
- **2 Mo** par fichier : très au-dessus d'une heure de VTT (~150-250 Ko), sous
  la limite de corps de requête Vercel (4,5 Mo).
- **Plafond sur le texte nettoyé : 200 000 caractères** (~50 000 tokens, environ
  trois heures d'entretien). Au-delà, refus explicite, sans troncature : un CR
  bâti sur une transcription coupée omettrait la fin sans le dire.
- Normalisation **pure et testée** (retrait des horodatages de chaque cue,
  fusion des tours consécutifs d'un même locuteur, horodatage du début de tour
  gardé comme ancre de citation).

### 5.2 Qui est le candidat

Les étiquettes de locuteurs des outils de visio sont des noms d'affichage, parfois
faux (« iPhone de Marc »). Le modèle ne doit pas deviner qui est le candidat.
Si la normalisation trouve au moins deux locuteurs, l'écran demande en un clic
« Lequel est le candidat ? ». S'il n'en trouve aucun (texte brut), le CR ne fait
aucune attribution et le dit.

### 5.3 Le prompt de structuration — un seul appel

`chatCompleteJson` via `src/lib/ai/provider.ts`, modèle par défaut du fournisseur
(`OPENAI_CHAT_MODEL`, repli `gpt-4o-mini` si la variable est absente —
`provider.ts:30`). Consignes :

- **Restituer, organiser, citer. Ne jamais évaluer.** Aucun score, aucune note,
  aucune recommandation, aucun adjectif appréciatif qui ne soit pas une
  citation.
- Chaque élément porte une **citation courte** (≤ 200 caractères), le locuteur,
  et l'horodatage quand il existe.
- Rubriques = celles du §3, dans leur version « générée » ; critères de la fiche
  de scoring validée injectés **par libellé seulement** (sans poids ni seuil :
  le modèle n'a pas à savoir ce qui compte).
- Un critère non abordé est dit « non abordé », jamais « non satisfait ».
- **Exclusion** de tout ce qui n'a pas de lien direct avec le poste : santé,
  grossesse, situation familiale, origine, religion, opinions, appartenance
  syndicale, vie privée. Le modèle rend seulement le **nombre** de passages
  écartés (`omitted_count`), jamais leur contenu.
- **Le schéma de sortie n'a aucun champ** où poser un score ou un avis. C'est
  la première ceinture, structurelle, comme `ReportInput` dans la purge.

« Un seul appel » : `maxAttempts` de validation à 1 ou 2 (§11, D4). Une
correction de format n'est pas une seconde analyse, mais chaque tentative
renvoie la transcription au fournisseur.

### 5.4 Contrôles déterministes pendant que la transcription est en mémoire

C'est la seconde ceinture. Elle s'exécute **avant** que la transcription ne soit
abandonnée, dans la même requête :

1. **Chaque citation est retrouvée mot pour mot** (après normalisation des
   espaces et de la casse) dans la transcription. Citation introuvable ⇒
   l'élément est retiré et un compteur le dit au recruteur. Principe du
   pré-filtre du 21/08 : on ne restitue que ce qu'on peut montrer.
2. **Lexique évaluatif** : les motifs `\d+ ?/ ?(10|20|100)`, « note »,
   « recommand », « je conseille », « profil idéal », « à retenir »… hors
   citation ⇒ élément signalé au recruteur (« formulation à vérifier »), pas
   supprimé. Un lexique est imparfait ; il signale, il ne juge pas.
3. **Garde-fou de volume** : le CR ne doit pas devenir une transcription
   déguisée. Somme des citations ≤ 15 % du texte source ; au-delà, refus de
   générer.

### 5.5 Budget de temps

`DEFAULT_TIMEOUT_MS` = 30 s par tentative et 4 réessais de transport
(`provider.ts:41-42`). Une structuration de 15 000 tokens avec 1 500 à 2 000
tokens de sortie prend 20 à 40 s sur gpt-4o. Avec les réessais, le pire cas
dépasse le `maxDuration` de 60 s et Vercel coupe l'appel. Il faut donc un
**délai par appel** dans le provider (petite extension de `ChatCompleteParams`),
au plus 1 réessai de transport pour cet appel, et `maxDuration = 60` sur la
route. Une coupure Vercel ne laisse rien derrière elle (aucune écriture n'a
précédé), ce qui est conforme à la règle « échec ⇒ rien stocké ».

### 5.6 Cycle de la transcription — la promesse

```
multipart ──► File en mémoire ──► texte normalisé ──► 1 appel LLM ──► contrôles §5.4
   │                                                                     │
   │   aucun Storage, aucun fichier temporaire, aucun journal du texte   │
   ▼                                                                     ▼
réponse = CR proposé (sections + citations vérifiées)       la variable sort de portée
```

- `request.formData()` garde le fichier en mémoire : **aucun fichier temporaire**.
- **Aucune écriture** avant la fin des contrôles. En cas d'échec, rien n'est
  écrit, et l'écran dit « La génération n'a pas abouti. Réimportez la
  transcription. »
- **Messages d'erreur génériques, jamais `err.message`.** `JSON.parse` et Zod
  citent un fragment du texte fautif dans leur message ; `AIValidationError`
  porte `lastError`. Rien de tout cela ne sort dans une réponse, un
  `console.error` ou le journal : on journalise la classe d'erreur et une durée.
- Journal `interview_report_generated` : `analysisId`, nombre de caractères,
  nombre de citations retenues et retirées, `omitted_count`, modèle, durée.
  **Aucun texte.**
- ⚠️ **Hors ORQA, à dire au client.** ORQA ne conserve rien, mais le fournisseur
  de modèle reçoit la transcription. L'API OpenAI peut conserver les entrées
  jusqu'à 30 jours pour la détection d'abus, sauf accord de conservation zéro.
  C'est la même limite que pour les CV, déjà listée dans la procédure de purge
  (« fournisseur de modèle »). À ajouter en une ligne à l'information du client.

### 5.7 Le brouillon

Après génération, la transcription est partie. Si le recruteur ferme l'onglet
avant de valider, le CR proposé est perdu et il faut réimporter. Deux options
(D2) :
- **(a) recommandée** : le CR proposé est enregistré en `status='draft'`. C'est
  un CR, pas une transcription, et il ne contient que des citations courtes et
  vérifiées. Un brouillon n'apparaît dans **aucun** lecteur (frise, PDF,
  rapport) avant vérification.
- **(b)** lecture stricte de « seul le CR relu persiste » : le brouillon reste
  dans l'état React, avec un avertissement à la fermeture de l'onglet.

« Vérifier » pose `status='verified'`, `verified_by_*`, `verified_at`. La mention
« Établi à partir d'une transcription, vérifié par Sarah D. le 18/09/2026 » est
**rendue** à partir de ces colonnes, pas stockée en texte.

---

## 6. Purge (`purge:candidate`)

- Deux nouvelles tables, verdict **EFFACER**, traitement **`step`**. Le
  traitement `cascade` n'est pas possible : le parent `candidate_analyses` est
  PSEUDONYMISER, et le registre exige un parent EFFACER
  (`table-inventory.ts:35-40`). `--purge-analyses` supprimerait de toute façon
  par cascade.
- À faire dans le même commit que les `create table` (sinon
  `table-inventory.test.ts` est rouge) : une entrée dans `TABLE_INVENTORY`, une
  ligne au §4.1 de `docs/ops/purge-rgpd-candidat.md`, une étape dans `execute.ts`
  (par `analysis_id` du périmètre), une relecture dans `verify.ts` (absence et
  ré-identification par `uid`).
- Journal : `interview_report_generated` et le `commentId` des marqueurs ne
  portent aucun texte. La pseudonymisation existante suffit.
- **Aucune donnée de transcription à purger**, par construction. Le rapport de
  purge peut le dire en une ligne : « Transcriptions d'entretien : non conservées
  par ORQA. »
- Les **auteurs recruteurs** (`author_*`, `verified_by_*`) disparaissent avec la
  ligne. La preuve qu'un humain a décidé reste dans le marqueur de journal
  (`actorEmail`), qui est conservé.

---

## 7. Intégration au dossier

### 7.1 Fiche candidature et frise

- Nouvelle section « Entretien » entre « Action » et « Profil »
  (`CandidatureFullPage.tsx:244-248` ; section équivalente dans le panneau).
- Frise (`timeline-facts.ts`, `candidate-timeline.ts`) : un fait « Compte rendu
  vérifié » (daté `verified_at`) ; le fait « Retenu » / « Non retenu » existant
  affiche le commentaire, son auteur et, si le verdict a été corrigé depuis,
  « écrit pour : Retenu ». Les deux tables sont lues par `analysis_id`, en une
  requête chacune.

### 7.2 PDF d'audit et rapport de campagne

- **PDF d'audit** (`candidate-audit-pdf.tsx`) : deux sections après « Parcours
  candidat » (`:215`) : « Entretien » (CR vérifié uniquement, avec sa mention de
  vérification) et « Décision » (commentaire, auteur, date). C'est le document
  qui rend la candidature « défendable ».
- **Rapport de campagne** : recommandation, **un indicateur** dans « Synthèse du
  déroulé » : « Décisions finales motivées : 12/14 » et « Entretiens avec compte
  rendu : 9/14 ». Aucun contenu nominatif (D3). Le PDF est mis en cache stable
  à la génération : un commentaire ajouté après ne s'y verra qu'à la régénération.

### 7.3 Briefing d'entretien

- Pas de contenu de CR dans le mail de briefing (§0.6). S'il existe un CR d'un
  tour précédent pour la même analyse, le briefing dit « Un compte rendu du
  1er entretien existe — à consulter dans ORQA », avec le lien vers la fiche.
- Tant qu'aucun deuxième tour n'existe dans le modèle (§0.5), ce renvoi n'a pas
  d'occasion de s'afficher. On le construit avec le deuxième tour, pas avant.

### 7.4 Connecteur BoondManager (pour mémoire)

Le déclencheur recommandé du connecteur est le GO. Le commentaire est le
candidat naturel d'une « action » Boond. À trancher avec la Phase 2 du
connecteur, pas ici.

---

## 8. Vivier (bonus, non tranché)

Un CR aiderait si la même personne repasse pour une autre mission. Deux freins,
à noter seulement :
- **Identité par analyse** : chaque candidature est un traitement distinct, sans
  fusion par email. Relier un CR à une autre campagne passerait par l'email du
  vivier. Un lien **en lecture** ne contredit pas la règle ; une fusion, si.
- **Finalité** : un CR établi pour la campagne A, relu pour la campagne B,
  relève de l'information vivier déjà faite au candidat. Pertinent, mais c'est
  une décision du client (responsable de traitement), pas d'ORQA.

---

## 9. Périmètre : universel

**Confirmé, avec une nuance.**
- **Commentaire obligatoire et CR rédigé à la main : universels.** Ils ne coûtent
  rien, ne font appel à aucun modèle et renforcent tous les dossiers.
- **Import de transcription : universel mais désactivable** par un réglage
  d'installation (`app_settings`, activé par défaut). Le DPO d'un client peut
  refuser d'envoyer des transcriptions d'entretien au fournisseur de modèle.
  Elles sont plus riches et plus exposées aux données sensibles qu'un CV. Sans
  ce réglage, un client qui refuse n'aurait qu'une option : renoncer à ORQA. Un
  réglage éteint retire le bouton d'import, pas le CR.

---

## 10. Maquettes

### 10.1 Section « Entretien » de la fiche candidature (étape `entretien_fait`)

```
┌─ ENTRETIEN ─────────────────────────────────────────────────────────────┐
│ Entretien du 16/09/2026 · 10:00 · avec Sami B.                          │
│                                                                         │
│ Compte rendu                                        facultatif          │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Aucun compte rendu.                                                 │ │
│ │ [ Rédiger ]   [ Importer une transcription ]                        │ │
│ │ .vtt .srt .txt .docx — 2 Mo max. La transcription n'est pas         │ │
│ │ conservée : elle sert à proposer un compte rendu, puis elle est     │ │
│ │ supprimée.                                                          │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ Décision                                                                │
│ [ Poser le verdict… ]                                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 10.2 Import → CR proposé → corriger → vérifier

```
① [ Importer une transcription ]  entretien-dupont.vtt  (142 Ko)
   Lequel est le candidat ?   ( ) Sami Benali   (•) Jean Dupont   ( ) Invité 3
   [ Proposer un compte rendu ]

② ⏳ Lecture de la transcription… (jusqu'à une minute)

③ ┌─ COMPTE RENDU PROPOSÉ — à vérifier ─────────────────────────────────┐
   │ Établi à partir d'une transcription. La transcription a été         │
   │ supprimée. 2 passages hors cadre professionnel ont été écartés.     │
   │ 1 citation introuvable dans la transcription a été retirée.         │
   │                                                                     │
   │ ▸ Sujets abordés                                          [modifier]│
   │ ▸ Réponses aux critères                                             │
   │     Pilotage MOA     « j'ai piloté la recette de bout en bout… »    │
   │                      Jean Dupont · 00:12:40                         │
   │     Anglais courant  non abordé                                     │
   │ ▸ Ce que le candidat a mis en avant                                 │
   │ ▸ Réserves exprimées pendant l'entretien                            │
   │     ⚠ formulation à vérifier : « profil idéal »                     │
   │ ▸ À vérifier lors d'un prochain échange                             │
   │                                                                     │
   │ [ Vérifier et enregistrer ]      [ Abandonner ]                     │
   └─────────────────────────────────────────────────────────────────────┘

④ Compte rendu · établi à partir d'une transcription,
   vérifié par Sarah D. le 18/09/2026                           [modifier]

   Échec de ② : « La génération n'a pas abouti. Rien n'a été enregistré.
   Réimportez la transcription. »   [ Réimporter ]
```

### 10.3 Dialog de verdict : le blocage visible

```
┌─ Verdict — Jean Dupont · Consultant MOA (CAMP-2026-288) ────────────────┐
│ Décision        (•) GO définitif     ( ) Non retenu                     │
│                                                                         │
│ Pourquoi cette décision ?                                  obligatoire  │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │                                                                     │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│ Ce commentaire fait partie du dossier. Le candidat peut en obtenir      │
│ communication s'il exerce son droit d'accès.                            │
│ Compte rendu : vérifié le 18/09  [voir]                                 │
│                                                                         │
│ [ Confirmer le verdict ]  ← désactivé : « Rédigez votre commentaire     │
│                              (20 caractères minimum). »                 │
│ [ Annuler ]                                                             │
└─────────────────────────────────────────────────────────────────────────┘
```

Dans l'onglet Entretiens, les boutons « GO définitif » / « Non retenu » de la
section « verdict attendu » (`ScheduledList.tsx:163-177`) ouvrent ce même dialog.
Le bouton actif choisit la décision présélectionnée. Le composant est partagé :
un seul dialog, trois surfaces.

---

## 11. Décisions ouvertes (au donneur d'ordre)

| # | Question | Recommandation |
|---|---|---|
| D1 | Longueur minimale du commentaire | 20 caractères (le « . » passe sinon ; au-delà, on bride sans raison) |
| D2 | Brouillon de CR persisté ou non (§5.7) | (a) persisté en `draft`, invisible des lecteurs |
| D3 | Rapport de campagne : indicateur seul, ou section nominative « décisions finales motivées » | indicateur seul |
| D4 | `maxAttempts` de validation JSON : 1 ou 2 | 2 (une correction de format, pas une nouvelle analyse) |
| D5 | Dashboard résiduel : dialog de verdict, ou retrait des boutons au profit de la fiche | retrait (surface en attente de refonte) |
| D6 | Accepter le PDF (export Otter) | oui, l'extracteur existe |
| D7 | Réglage d'installation pour couper l'import (§9) | oui, activé par défaut |
| D8 | Commentaire facultatif offert sur le no-show | oui, facultatif |

---

## 12. Tests à prévoir (Phase 2)

**Unitaires (purs, sans LLM)**
- Normalisation VTT / SRT / TXT / DOCX : locuteurs, horodatages, fusion des tours.
- Contrôles §5.4 : citation introuvable retirée ; lexique évaluatif signalé ;
  plafond de volume.
- `foldValidationMark` rend le `commentId` du marqueur gagnant ; un marqueur
  historique sans `commentId` rend `null` (et pas une erreur).
- Schéma de sortie du CR : aucun champ de score ou d'avis (garde structurelle).
- Registre RGPD : `interview_reports` et `verdict_comments` avec verdict et
  traitement (le test existant l'impose).

**Régression (routes réelles, LLM mocké) — nouvelle série S25**
- **Verdict impossible sans commentaire** : route de verdict sans commentaire
  ⇒ 400, aucun marqueur ; `POST /api/journal` avec `candidate_validation_marked`
  ⇒ 409. Les séries S8, S9 et S12, qui posent aujourd'hui ce marqueur par
  `/api/journal`, passent par la nouvelle route.
- **Rétro-compatibilité** : un dossier `retenu` sans commentaire (marqueur posé
  à l'ancienne) reste corrigeable (`verdict_rejected`, `verdict_cleared`) ;
  aucune lecture ne le bloque.
- **Aucune trace de la transcription** : une transcription portant une chaîne
  témoin unique (le LLM mocké rend un CR qui ne la contient pas). Après
  génération réussie, puis après échec (LLM mocké qui lève une erreur **dont le
  message contient la chaîne témoin**, pour simuler `JSON.parse`) : la chaîne est
  absente de toutes les tables de `migrate.sql` (lues par `schema-tables.ts`), du
  bucket, du journal, des sorties console capturées et du corps des réponses.
- **Échec ⇒ rien stocké** : zéro ligne `interview_reports`, zéro objet en
  Storage, message « réimportez ».
- **Purge** : `purge:candidate` efface CR et commentaires d'un candidat ; le
  contrôle final les relit ; un autre candidat garde les siens.

---

## 13. Ce que la Phase 2 touche (inventaire)

- Schéma : 2 tables dans `scripts/migrate.sql` (idempotent, double application).
- Serveur : route de verdict, routes CR (génération, enregistrement,
  vérification), refus dans `/api/journal`, délai par appel dans `provider.ts`,
  normaliseur de transcription, contrôles déterministes, extension de
  `decision-markers.ts` (`commentId`).
- Client : `markCandidateValidation` recâblé ; dialog de verdict partagé ;
  section « Entretien » (panneau + page) ; éditeur de CR ; `ScheduledList` et
  `CandidatesCard`.
- Lecteurs : `timeline-facts`, `candidate-timeline`, `candidate-audit-pdf`,
  `campaign-report` (indicateur), dialog de correction (affichage du
  commentaire).
- RGPD : `table-inventory.ts`, `execute.ts`, `verify.ts`, §4.1 de la procédure.
- Cartographie du Manager (`manager-cartography.ts`) : les nouveaux libellés,
  pour qu'il puisse orienter vers « Poser le verdict » et « Importer une
  transcription ».

---

## 14. Arbitrages du 18/09/2026 (validation de la Phase 1)

Validés sans modification : le catch sécurité (route de verdict dédiée, refus de
`candidate_validation_marked` par `/api/journal`), les reformulations du CR
généré (restitutions attribuées et citées, réserves ≠ 3ᵉ verdict, citations
vérifiées mot pour mot, schéma sans score), D2, D3, D4, D5, D6, D7, D8.

### 14.1 D1 — un minimum de SENS, pas une longueur

20 caractères laissaient passer « ok pour moi, bon profil ». Règle retenue :
**au moins 15 mots**, mesurés par une fonction PURE partagée client/serveur
(`assessCommentSubstance`), testée :

- un **mot** = une suite de lettres Unicode (apostrophes et traits d'union
  internes admis) de **2 lettres au moins** — chiffres, ponctuation, émojis et
  lettres isolées ne comptent pas ;
- **anti-remplissage** : au moins **10 mots distincts** (insensible à la casse et
  aux accents), sinon « bla bla bla… » ×15 passerait ;
- le serveur applique la même fonction (400 `comment_too_thin`) — l'écran n'est
  qu'un reflet ; il affiche le compteur (« 9 / 15 mots ») et la raison du refus ;
- le CHECK de `verdict_comments.body` (§2.3) passe de 20 à **40 caractères** :
  un plancher en base pour tout écrivain qui contournerait la route, pas la
  règle elle-même. Il doit rester SOUS le minimum que la règle peut produire
  (quinze mots de deux lettres + espaces = 44 caractères) : un plancher plus
  haut refuserait en base un commentaire que la route a accepté (500 au lieu
  d'un 400 lisible). Un test pur tient cette inégalité.

« Une phrase complète » n'est **pas** retenue comme critère alternatif : « Ok pour
moi. » EST une phrase complète, et la détecter proprement demanderait une
analyse grammaticale. Quinze mots distincts forment de fait une phrase, et c'est
mesurable sans ambiguïté. Le repli « 80 caractères » n'est pas nécessaire : le
seuil en mots se fait proprement.

⚠️ Aucune règle mécanique n'empêche un recruteur déterminé d'écrire quinze mots
creux. La règle empêche la **case cochée déguisée** ; la qualité du motif relève
de l'encadrement, et le commentaire, signé et daté, est relu dans le PDF d'audit.

### 14.2 Placement — un objet, deux points d'affichage, une route

- **Saisie principale : onglet Entretiens**, section « verdict attendu »
  (`ScheduledList.tsx:163-177`). Chaque ligne se déplie en un bloc qui porte, dans
  cet ordre : le **CR** (rédiger / importer une transcription), le
  **commentaire** (obligatoire), puis les boutons **GO définitif / Non retenu**,
  désactivés tant que le commentaire n'atteint pas le seuil. Le dialog de verdict
  du §10.3 disparaît au profit de ce bloc en ligne : les champs sont DEVANT la
  décision, pas derrière un clic.
- **Même composant sur la fiche candidature** (panneau et page, étape
  `entretien_fait`), à la place de `FinalDecisionAction`
  (`CandidatureActions.tsx:116-176`) : le verdict peut y être posé, la règle
  étant serveur, aucun écran de décision ne doit être un cul-de-sac. Le flux
  « poste pourvu » après un GO (`CampaignDismissFlowDialog mode="go"`) suit le
  bloc, sur les deux surfaces.
- **Dashboard résiduel** : boutons de verdict retirés (D5), aucun champ.
- Le composant (`InterviewDecisionBlock`) découpé sous 200 lignes : CR (éditeur +
  import), commentaire (champ + compteur), barre de verdict.

Maquette de la ligne dépliée dans l'onglet Entretiens :

```
▾ Jean Dupont · Consultant MOA · entretien du 16/09 10:00 · Réf. Sami B.
  ┌──────────────────────────────────────────────────────────────────────┐
  │ Compte rendu (facultatif)                                            │
  │   [ Rédiger ]  [ Importer une transcription ]   .vtt .srt .txt .docx .pdf │
  │                                                                      │
  │ Pourquoi cette décision ? (obligatoire)                  9 / 15 mots │
  │ ┌──────────────────────────────────────────────────────────────────┐ │
  │ │ Bonne maîtrise de la recette, réserves sur                       │ │
  │ └──────────────────────────────────────────────────────────────────┘ │
  │ Ce commentaire fait partie du dossier. Le candidat peut en obtenir   │
  │ communication s'il exerce son droit d'accès.                         │
  │                                                                      │
  │ [ GO définitif ] [ Non retenu ]  ← inactifs : « encore 6 mots »      │
  └──────────────────────────────────────────────────────────────────────┘
```

Le bouton d'import n'apparaît que si le réglage D7 est activé.

### 14.3 Délai réglable par appel — DANS le lot, prérequis

`ChatCompleteParams` et `ChatCompleteJsonOptions` gagnent `timeoutMs` et
`maxTransportRetries` (options de requête du SDK, **par appel** — les clients
restent partagés). Les deux chemins sont couverts : OpenAI **et** Anthropic
(`chatCompleteJson` route vers Anthropic si `CV_ANALYZER_PROVIDER=anthropic`,
`provider.ts:218-222` ; le client Anthropic a le même délai figé à 30 s,
`provider.ts:86`). Sans paramètre, le comportement actuel ne change pas (aucun
appelant existant touché). Budget de l'appel de structuration : 2 tentatives de
validation (D4) dans une enveloppe totale **< 55 s** (route `maxDuration = 60`) —
par exemple 25 s par tentative et 0 réessai de transport ; les valeurs exactes
se fixent sur mesure en Phase 2, pas au jugé. Un test unitaire vérifie que les
options atteignent bien le SDK sur les deux chemins.

### 14.4 Information du DPO — rétention fournisseur

La structuration suit **le même routage de fournisseur que l'analyse des CV**
(`CV_ANALYZER_PROVIDER`). C'est ce qui rend vraie la phrase « comme les CV » :
même fournisseur, même contrat, même DPA. Conséquence de nommage : le modèle est
`OPENAI_CHAT_MODEL` en mode OpenAI, `ANTHROPIC_CHAT_MODEL` en mode Anthropic.

Texte à publier **dans le même commit que le réglage D7**, à deux endroits :
`docs/ops/configuration-client.md` §2 (entrée du réglage) et
`docs/ops/purge-rgpd-candidat.md`, tableau « hors ORQA » (à côté de la ligne
« fournisseur de modèles de langage », `:519`) :

> **Import de transcription d'entretien — à lire par le DPO avant activation.**
> ORQA ne conserve aucune transcription : le texte est lu en mémoire, sert à
> proposer un compte rendu, puis est abandonné, y compris en cas d'échec. En
> revanche, **le texte intégral transite par le fournisseur de modèle de langage**
> configuré pour l'analyse des CV. Ce fournisseur peut le conserver **jusqu'à
> 30 jours** (détection d'abus), **comme les CV** — même fournisseur, même
> contrat de sous-traitance ; zéro avec un accord de non-conservation. Une
> transcription d'entretien est plus riche qu'un CV et plus exposée aux données
> sensibles. L'information et le consentement du candidat à l'enregistrement et
> à la transcription relèvent du client. Réglage : `/settings`, désactivable à
> tout moment ; désactivé, le compte rendu reste saisissable à la main.

L'écran du réglage renvoie à ce texte.

### 14.5 Purge — confirmation : par rattachement, jamais par détection du nom

Confirmé, et c'est déjà la mécanique de toutes les tables EFFACER :
`resolve.ts` bâtit le périmètre à partir de l'**adresse** seule
(`strongIdentifiersOnly`) et en déduit les identifiants d'analyse
(`acc.analysisIds`, `resolve.ts:399-408`) ; les étapes suppriment **par
identifiant** (`deleteByIds`, ex. `interview_briefs` `execute.ts:134-141`).
Les deux nouvelles étapes suivent ce modèle :

```
deleteByIds(ctx, 'verdict_comments',  'analysis_id', ctx.identity.analysisIds)
deleteByIds(ctx, 'interview_reports', 'analysis_id', ctx.identity.analysisIds)
```

Un commentaire qui ne nomme pas le candidat part donc avec sa candidature. Le
contrôle final (`verify.ts`) relit ces tables **par `analysis_id` / `uid`** —
jamais par recherche du nom, qui manquerait précisément ce cas.

Angle mort à traiter dans le même lot (un seul point, pas le backlog) : l'inverse
— le candidat **cité dans le dossier d'un AUTRE** (« moins solide que Dupont
sur la recette »). Le rattachement ne l'atteint pas, et il ne doit pas : c'est la
ligne d'un tiers. Le contrôle l'**avertit** : `verdict_comments.body` et
`interview_reports.sections` entrent dans la branche « homonymes / mentions »
existante (emplacement seulement, jamais un extrait), et c'est un humain qui
tranche. Même régime que le téléphone ou le nom aujourd'hui.

### 14.6 Découpage de la Phase 2

| Lot | Contenu | Visible |
|---|---|---|
| **1 — Socle** | `timeoutMs`/`maxTransportRetries` par appel (§14.3) ; 2 tables + registre RGPD + étapes purge/contrôle + §4.1 ; `assessCommentSubstance` ; `commentId` dans `decision-markers` | non |
| **2 — Verdict motivé** | route `POST /api/candidatures/[id]/verdict` ; refus par `/api/journal` ; S8/S9/S12 recâblées ; `InterviewDecisionBlock` (commentaire + verdict) sur Entretiens et fiche ; retrait dashboard ; frise, PDF d'audit, indicateur du rapport | oui — le commentaire est obligatoire à partir d'ici |
| **3 — CR manuel** | éditeur à 5 rubriques (critères de la fiche injectés), brouillon / vérifié, lecteurs (frise, PDF) | oui |
| **4 — Import de transcription** | normaliseur VTT/SRT/TXT/DOCX/PDF, choix du locuteur, appel de structuration, contrôles §5.4, réglage D7 + textes DPO §14.4, test de la chaîne témoin | oui, désactivable |

Régression **S25** répartie sur les lots 2 à 4. Chaque lot : `npm run
typecheck`, vitest, double application de `migrate.sql` au lot 1.

---

## 15. Avancement

### 15.1 Lot 1 — socle (18/09/2026, branche `feat/compte-rendu-entretien`)

Livré, **aucune surface visible** — POINT D'ARRÊT avant que les tables portent
des données :

- **Délai par appel** (`src/lib/ai/provider.ts`) : `timeoutMs` et
  `maxTransportRetries` sur `chatComplete` et `chatCompleteJson`, chemins
  OpenAI ET Anthropic ; sans option, aucun second argument n'est passé au SDK
  (appelants existants inchangés). Tests `provider-transport.test.ts`, sondés.
- **Schéma** (`scripts/migrate.sql`, bloc « COMPTE RENDU D'ENTRETIEN ») :
  `interview_reports` et `verdict_comments`, RLS, 8 CHECK nommés (drop + add),
  colonne générée `search_text` (sert à la purge), ajout seul de
  `verdict_comments` tenu par un déclencheur. Contrôle positif
  `scripts/checks/interview-report-schema.sql` (34 contrôles). Validé hors
  Supabase sur Postgres 17 embarqué (PGlite) : **triple** application sans
  erreur, 34/34, zéro résidu ; sondé (retirer le plancher et le déclencheur ⇒
  5 KO).
- **Règle du commentaire** (`src/lib/candidatures/comment-substance.ts`) :
  15 mots dont 10 distincts ; plancher en base 40 caractères, tenu SOUS le
  minimum de la règle (44) par un test qui lit `migrate.sql` (sondé : 60 ⇒
  rouge).
- **Marqueur de verdict** (`decision-markers.ts`) : `commentId` (l'identifiant,
  jamais le texte), `foldValidationDecision` — même dernier-gagne que
  `foldValidationMark`, dont il n'est qu'un enrichissement (test d'équivalence).
- **Purge** : registre (`table-inventory.ts`, EFFACER / `step`), §4.1 et §7.4
  de la procédure, étapes `execute.ts` par `analysis_id`, compteurs et libellés
  du rapport, contrôle final (absence littérale, ré-identification : une ligne
  qui SURVIT est un échec) et branche « mentions » : le sujet cité dans le
  dossier d'un tiers est signalé, emplacement seul. Régression **S18** étendue
  (point 10) — **à lancer après application de la migration en dev**.

### 15.2 Lot 2 — verdict motivé (19/09/2026)

Livré — **à partir d'ici, aucun verdict final ne se pose sans commentaire**.
POINT D'ARRÊT avant le lot 3 (vérification de la rétro-compatibilité et recette).

- **Route unique** `POST /api/candidatures/[id]/verdict` (cœur
  `src/lib/candidatures/verdict.ts`) : règle du commentaire (400
  `comment_too_thin`, avant toute lecture), étape RELUE (`entretien_fait`, sinon
  409 `not_awaiting_verdict`), commentaire PUIS marqueur portant `commentId`,
  auteur de la session serveur, aucun envoi (tenu au runtime et
  structurellement). `/api/journal` refuse `candidate_validation_marked` (409
  `use_verdict_route`, garde sondée).
- **Écrans** : bloc partagé `InterviewDecisionBlock` (champ + compteur de mots +
  mention droit d'accès, boutons inactifs tant que le commentaire manque, texte
  CONSERVÉ en cas d'échec) — onglet Entretiens (« Motiver et décider » déplie la
  ligne) et fiche candidature (remplace `FinalDecisionAction`, flux « poste
  pourvu » conservé). Dashboard résiduel : boutons de verdict retirés, une
  phrase dit où décider.
- **Lecteurs** : frise (« Retenu définitivement » porte le commentaire et son
  auteur, ou « aucun commentaire enregistré » ; lecture KO ⇒ silence, jamais
  une absence affirmée) ; PDF d'audit (section « Décision finale », trois cas
  dits, lecture KO ⇒ écrit) ; rapport de campagne (indicateur « décisions
  finales motivées N/M », montré seulement si la campagne a vécu sous la règle ;
  aucun contenu) ; dialog de correction (commentaire existant + verdict pour
  lequel il a été écrit ; auteur du verdict = auteur de son commentaire).
- **Rétro-compatibilité** : la règle porte sur l'ACTE. Un verdict antérieur
  (marqueur sans `commentId`) n'est ni requalifié ni bloqué ; « Corriger la
  décision » reste possible sans commentaire. Un dossier en `entretien_fait` au
  déploiement demandera un commentaire à son verdict — voulu.
- **Non fait, consigné** : proposer d'ajouter un commentaire DANS le dialog de
  correction (§4.3, « sans l'imposer ») — la correction garde son motif
  facultatif ; à trancher.
- **Régression** : S8, S9, S12 recâblées sur la route (helper
  `tests/regression/helpers/verdict.ts`) ; **S25** (lot 2) : 409 hors attente,
  400 sans commentaire / « ok pour moi » / répétition (rien écrit), 409 par
  `/api/journal`, commentaire + auteur de session + `commentId` sans texte au
  journal, ajout seul refusé par la base, second verdict 409, dossier HISTORIQUE
  corrigeable sans commentaire, dialog et frise.

---

## 16. Arbitrage du 19/09/2026 — le commentaire devient FACULTATIF

Décision du donneur d'ordre, après recette du lot 2 : **l'obligation du
commentaire est retirée** — elle pouvait susciter des objections. Ce qui
change, et ce qui NE change PAS :

- **Change.** Un verdict final se pose sans commentaire. Le champ « Pourquoi
  cette décision ? » est marqué facultatif, les boutons ne dépendent plus de
  lui. La règle des 15 mots (§14.1) et son module (`comment-substance.ts`) sont
  SUPPRIMÉS : une règle de substance sur un champ facultatif n'a pas d'objet.
  Le plancher en base devient « non vide » (`char_length(btrim(body)) >= 1`,
  même bloc canonique, pas de doublon) : un verdict sans commentaire n'écrit
  AUCUNE ligne, une ligne présente porte toujours un texte.
- **Ne change pas.** La route unique `POST /api/candidatures/[id]/verdict` et
  le refus de `candidate_validation_marked` par `/api/journal` : le verdict et
  son commentaire éventuel s'écrivent ENSEMBLE, par un seul chemin, sur tous
  les écrans. Le commentaire écrit reste en ajout seul, lié au marqueur par son
  identifiant (jamais son texte au journal), effacé par rattachement à la purge.
  Lecteurs inchangés : ils disaient déjà « aucun commentaire » quand il n'y en
  a pas.
- **Rapport de campagne** : l'indicateur devient « Décisions finales
  accompagnées d'un commentaire du recruteur : N/M », montré seulement si au
  moins un verdict en porte. ⚠️ À trancher : avec un commentaire facultatif, ce
  ratio montre au client une pratique de documentation — il peut lui-même
  susciter des objections. Le retirer est une ligne.
- **Supersède** : §4 (commentaire obligatoire), §14.1 (D1), et les mentions
  « obligatoire » des maquettes §10.

### 15.3 Lot 3 — compte rendu rédigé à la main (19/09/2026)

- **Contrat** `src/types/interview-report.ts` : une forme unique (rubriques
  `topics`, `criteria[]` — repères tirés de la fiche de scoring, libellé seul,
  jamais un « non » —, `highlights`, `reservations`, `followUps`), toutes
  facultatives, bornées (6 000 caractères par rubrique), aucun champ de score.
  Libellés selon la source : un compte rendu proposé dit « ce que le candidat a
  mis en avant », jamais « points forts ».
- **Serveur** `GET/PUT /api/candidatures/[id]/interview-report` (cœur
  `src/lib/candidatures/interview-report.ts`) : il faut un entretien marqué
  « réalisé » (409 sinon, rien écrit) ; valider = signer (session requise,
  auteur + date posés) ; un gabarit vide ne se valide pas ; un compte rendu
  validé ne redevient pas brouillon (409), il se modifie en étant RE-validé ;
  source toujours `manual` par cette route — seul le serveur d'import (lot 4)
  peut créer un compte rendu « établi à partir d'une transcription » ; trace
  `interview_report_saved` sans aucune rubrique.
- **Écrans** : `InterviewReportPanel` au-dessus du commentaire dans le bloc de
  décision (Entretiens + fiche), et sur la fiche d'un dossier retenu / non
  retenu (on rédige souvent après avoir décidé ; se tait sans entretien).
  Brouillon annoncé comme « hors dossier ».
- **Lecteurs** (validé seulement) : frise (« Compte rendu d'entretien », après
  l'entretien, avant le verdict, avec la mention) ; PDF d'audit (section
  dédiée, mention rendue des colonnes, lecture KO écrite). Mention unique
  `interviewReportMention` (écran, frise, PDF).
- **Non fait, consigné** : le briefing d'un tour suivant (§7.3) — aucun second
  tour n'existe encore.
- **Régression** : S25.8 à S25.11.

### 15.4 Lot 4 — import de transcription (19/09/2026)

- **Normaliseur** pur `src/lib/transcript/normalize.ts` : WebVTT (balises `<v>`,
  identifiants de repère), SubRip, texte (Otter / Teams .docx « Nom  0:03 »,
  tl;dv « [00:03] Nom : »), étiquette « Nom : » reconnue seulement si elle
  revient ou ouvre un repère ; tours fusionnés ; aucune attribution inventée.
  `.docx`/`.pdf` extraits en mémoire par `extractCVText`.
- **Choix du candidat** : plusieurs locuteurs ⇒ 422 avec les noms, AVANT tout
  appel au modèle et toute écriture ; l'écran renvoie le même fichier avec le
  choix.
- **Un appel** (`src/lib/agents/interview-report-structuring.ts`) : même routage
  de fournisseur que les CV, `maxAttempts: 2`, `timeoutMs: 25 000`, aucun réessai
  de transport, route `maxDuration = 60`. Prompt : restituer, organiser, citer,
  ne jamais juger, exclure les passages hors cadre (compter seulement).
- **Contrôles** `src/lib/transcript/structure.ts` : schéma de sortie strict
  (aucun champ de score), citations retrouvées mot pour mot (12 à 200
  caractères, sinon élément retiré et compté), formulations évaluatives
  signalées « [formulation à vérifier] », plafond de citations (15 % du texte,
  plancher 600 caractères) ⇒ refus. Critères de la campagne : « non abordé »,
  jamais « non satisfait ».
- **Persistance** : le brouillon est créé CÔTÉ SERVEUR (`source = transcript`,
  modèle, nombre de passages écartés) — le client ne peut jamais se déclarer
  « transcription » ; une proposition ne recouvre jamais un compte rendu
  existant. Journal `interview_report_generated` : compteurs seulement.
- **Transcription jamais conservée** : variables locales uniquement, aucune
  écriture avant la fin des contrôles, messages d'erreur génériques (jamais
  `err.message`), console = classe d'erreur seule.
- **Réglage** `interview_config.transcriptImportEnabled` (défaut activé, sans
  migration), section « Comptes rendus d'entretien » (administrateurs), texte
  DPO à l'écran ET dans `docs/ops/configuration-client.md` §2.1 et
  `docs/ops/purge-rgpd-candidat.md` §8 (fournisseur de modèle, outil de visio).
  Lecture du réglage illisible ⇒ import éteint (fail-closed).
- **LA PREUVE (S25.12 à S25.16)** : une transcription porte un témoin que la
  proposition ne cite pas ; après génération, puis après un échec où le modèle
  simulé lève en CITANT le texte, le témoin n'est dans AUCUNE table du schéma
  (balayage de toutes les tables de `migrate.sql`, `tests/regression/helpers/
  trace-scan.ts`), ni en console, ni dans la réponse. **Sondée** : un extrait
  glissé dans le journal ou un `err.message` en console fait échouer 4 tests.
  Doublée par une garde structurelle unitaire (aucun import de stockage ni de
  système de fichiers, aucun message d'erreur recopié — sondée).
