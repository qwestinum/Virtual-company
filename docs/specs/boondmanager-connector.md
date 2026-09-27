# Connecteur BoondManager — Phase 1 (étude)

> **Statut au 15/09/2026 : ÉTUDE RENDUE, POINT D'ARRÊT. Aucun code n'a été écrit.**
> Ce document dit ce que la documentation publique de Boond contient, ce qu'elle
> ne dit pas, et ce que cela implique pour ORQA. Comme pour l'Apec, ce qui sera
> appris ensuite s'écrira dans des sections `§nbis`, jamais par-dessus l'étude.
>
> **Sources lues**, citées par leur nom court dans la suite :
> - **[RAML]** : les fichiers RAML et JSON Schema bruts servis sous
>   `https://doc.boondmanager.com/api-externe/raml-build/`. Le portail HTML
>   renvoie 403 aux clients qui ne sont pas un navigateur, mais les fichiers
>   bruts sont servis en clair. Trois schémas ont été relus directement
>   (`schemas/candidates/bodyPost.json`, `schemas/positionings/bodyPost.json`,
>   `resources/documents/search.raml`) pour vérifier les points dont dépend la
>   conception.
> - **[MOCK]** : `github.com/LittleBigCode/boondmanager-mock`, v0.10.0, commit
>   `e167ebd` du 13/09/2026.
> - **[MCP-F]** : `github.com/fauguste/boondmanager-mcp-server`, v2.15.0. Ce client
>   surveille les RAML chaque semaine et consigne des constats faits contre une
>   vraie instance ; il est cité à ce titre, jamais comme référence normative.
> - **[PYB]** : `github.com/tominardi/pyboondmanager`.
> - **[HELP]** : le centre d'aide `help.boondmanager.com`.
>
> ⚠️ **Tout ce qui est marqué NON VÉRIFIÉ ne doit pas être codé comme un fait.**
> Chaque point de ce type est repris dans les questions au support (§9).

---

## 0. Ce qui change par rapport au brief

Six corrections ou précisions, par ordre de conséquence.

**0.1 — Il n'existe AUCUN champ de référence externe sur un candidat.**
`schemas/candidates/bodyPost.json` accepte 29 attributs, et aucun n'est un
identifiant tiers : ni `externalReference`, ni `reference`, ni champ
personnalisé. `creationSource` existe, mais en **lecture seule**.

Il reste deux supports pour poser une clé de corrélation côté Boond :
- `source.detail`, 100 caractères, avec un `source.typeOf` pris dans le
  dictionnaire du client ;
- le texte d'une **action**, c'est-à-dire une note datée sur la fiche.

Aucun des deux n'est **cherchable** : `keywordsType` ne propose ni `source` ni
note. Conséquence sur la conception : **l'idempotence se tient chez nous**, dans
`ats_sync`. La clé posée côté Boond ne sert qu'à **reconnaître** un candidat déjà
trouvé par son adresse, jamais à le **retrouver** (§3).

**0.2 — La validation silencieuse est confirmée, et elle est pire que prévu.**
Les schémas déclarent `additionalProperties: false` à tous les niveaux, mais le
serveur ne les applique pas. Constats faits en réel par des tiers :
- un attribut inconnu est « silencieusement ignoré » ([MCP-F], issue #124) ;
- `state` est accepté puis ignoré sur certaines entités ;
- des noms de filtres erronés sont ignorés, et **la recherche rend alors toute
  la base** (`/positionings?candidateId=…`, [MCP-F] #107) ;
- `maxResults` est ignoré sur `/actions` ([MOCK]) ;
- une valeur hors bornes « retombe silencieusement sur la valeur par défaut »
  ([HELP], bonnes pratiques).

En revanche, un champ **obligatoire** manquant rend bien une 422 (code `1017`).

Deux conséquences :
- la validation locale avant envoi **et** la relecture après écriture sont
  toutes deux nécessaires, et aucune ne remplace l'autre ;
- **un filtre de recherche ne doit jamais être cru sur parole** : chaque
  résultat est re-filtré côté ORQA (§3.2).

**0.3 — Le mock ne couvre que la LECTURE.**
[MOCK] ne sert que des `GET`, sur 22 collections. Il ne sert ni `/positionings`
ni `/documents`, n'accepte aucun `POST` ni `PUT`, et ne sert pas les onglets
`/information`. Tout le flux (2) est donc hors de sa portée. Il faut un
**adaptateur de simulation interne**, avec état, sur le modèle de
`MockAdepTransport` (§5). De plus, sa licence est déclarée « Proprietary » : on
peut le **lancer** en local, on ne recopie ni son code ni ses données dans le
dépôt.

**0.4 — Le déclencheur « acceptation » n'existe pas comme événement serveur, et le
« GO » est posé par le navigateur.**
- L'acceptation est écrite à **trois** endroits : l'insertion de l'analyse
  (`auto_accept`, dans le poller et dans l'admission sourcing),
  `updateCandidateAnalysisDecision` (zone grise) et la correction de décision.
- Le GO définitif est un marqueur `candidate_validation_marked{validated}`,
  posé par `markCandidateValidation` **côté client**, via le `POST /api/journal`
  générique.

S'accrocher à l'un ou l'autre de ces points reviendrait à dupliquer un gate.
La réponse est la même que pour le classement sans suite : **le rail relit l'état
dérivé canonique**, il ne reçoit rien (§6).

**0.5 — Un positionnement peut avoir des effets de bord que le schéma ne montre pas.**
- La description officielle précise : « If state is `won` it will attach this
  positioning to a new project or an existing one ».
- Deux paramètres de requête, `sendMailToDependsOnManager` et
  `sendMailToOpportunityManager`, **envoient des mails**. ORQA les pose
  **explicitement à `false`** et ne compte jamais sur leur valeur par défaut,
  qui n'est pas documentée.

**0.6 — `firstName` et `lastName` sont obligatoires, et ORQA ne les possède pas.**
ORQA ne connaît que `candidate.fullName`. Découper « Jean-Marie Le Gall » est une
devinette. C'est le seul champ obligatoire côté Boond qu'ORQA doit **fabriquer**,
et il ne doit pas l'être en silence (§2.2).

---

## 1. La documentation, telle qu'elle est

### 1.1 Accès et authentification

| | Valeur | Source |
|---|---|---|
| Base | `https://ui.boondmanager.com/api` | [MCP-F], [HELP] OAuth2 |
| Format | JSON:API (`data.type`, `data.attributes`, `data.relationships`, `included`) | [RAML] |
| Identifiants | numériques, **servis en chaînes** | [MOCK], constaté en réel |
| Dates | `2026-03-12T09:24:00+0100`, **sans deux-points** dans le décalage | [MOCK], constaté en réel |
| Mise à jour | `PUT …/{id}/information` ; `PATCH` rend **405** | [MCP-F] #124, #134 |
| Test des identifiants | `GET /application/current-user` | [MOCK] |

**En-tête `X-Jwt-Client-Boondmanager`.**
- Le jeton est signé en HS256 avec la **clientKey**, encodé en base64url sans
  padding.
- Contenu **constaté contre une instance réelle 9.1.78.1** ([MOCK], 30-31/07/2026) :
  exactement `{"userToken","clientToken"}`, sans `iat`, `exp` ni `iss`.
- [PYB] envoie une variante `{userToken, clientToken, time, mode:"normal"|"god"}`.
  **NON VÉRIFIÉ** : laquelle est normative, et ce que signifie `god`.
- Construction : `node:crypto` (`createHmac('sha256')`). **Aucune dépendance
  JWT** n'est nécessaire ; `jose` n'est présent dans `node_modules` que comme
  dépendance transitive et ne doit pas être importé.

**Erreurs d'authentification** (constatées en réel, [MOCK]) :

| Situation | Réponse |
|---|---|
| Jeton absent | 401 |
| Jeton mal signé | 422 `"Signature verification failed"`, `source.parameter: xJwtClient` |
| Périmètre du userToken insuffisant | 403 `"Potential missing contractual feature(s): …"` |

**Où se trouvent les jetons** (d'après [PYB]) :
- **userToken** : dans le compte de l'utilisateur API du client, « Paramètres >
  Sécurité » ;
- **clientToken** et **clientKey** : dans l'« Espace développeur > API/Sandbox » de
  l'administrateur.

> ⚠️ **Écart avec le brief, à trancher avec le support (§9.1 Q1).** Le brief suppose
> que `clientToken` et `clientKey` sont des identifiants **d'application ORQA**,
> communs à tous les clients. D'après ce qui précède, ils sont délivrés **par
> l'instance du client**, dans son Espace développeur. Si c'est le cas, ils sont
> **propres à chaque client** au même titre que le userToken. Le mode qui porte
> une identité d'application est le JWT **App** (`X-Jwt-App-Boondmanager`, appToken
> et appKey fournis à l'installation d'une app Boond), qui a de plus l'avantage de
> **ne pas consommer le quota** du client ([HELP]).
>
> Conséquence : le stockage « clientToken/clientKey en env » reste correct tant
> qu'une installation ORQA = un client, ce qui est le cas aujourd'hui (une base
> Supabase par client). Il deviendrait faux en mutualisé.

**Sandbox** ([HELP]) : espace vide de données, avec les paramètres globaux de la
production. Il exige l'offre **ADVANCED** et permet 3 comptes de test.

### 1.2 Limites de débit

Deux mécanismes se cumulent ([HELP]) :
- un *rate limiting* par minute **et** par tranche de 10 s, qui rend `429`
  avec `Retry-After` ;
- un **quota mensuel** qui dépend de l'offre.

Un appel en échec est **décompté** lui aussi. Les chiffres sont derrière
authentification : **NON VÉRIFIÉ**.

Conséquence : les appels sont bornés **par tick**, `Retry-After` est respecté, et
ORQA ne fait aucune boucle de lecture inutile. Pas de sondage : aucun flux retour
n'est prévu.

### 1.3 Erreurs

Enveloppe : `{"meta":{…},"errors":[{"status","code","detail","source":{"parameter"|"pointer"}}]}`.
Codes constatés : `1017` (champ manquant) et `1002` (valeur rejetée). Les
obligatoires manquants remontent **par vagues**, une 422 par groupe.

⚠️ `GET /documents/{id}` avec un identifiant inconnu rend **200 `text/html`** (la
coquille de l'application) au lieu de 404, sauf si la requête demande du JSON.
Le transport exige donc `Accept: application/json` **et** vérifie le
`Content-Type` de la réponse : un 200 qui n'est pas du JSON est un **échec**.

### 1.4 Opportunités

| Besoin | Endpoint | Notes |
|---|---|---|
| Rechercher | `GET /opportunities` | `keywords` (accepte `AO<id>`), `opportunityStates`, `sort=updateDate`, `order=desc`, `page`, `maxResults` (1–500, défaut 30) |
| Lire | `GET /opportunities/{id}/information` | onglet complet (§2.1) |
| Positionnements liés | `GET /opportunities/{id}/positionings` | filtre `positioningStates` |

**Champs utiles** (`schemas/opportunities/information.json`) :

| Champ | Contrainte | Remarque |
|---|---|---|
| `title` | ≤ 150 | |
| `reference` | ≤ 250 | texte **libre** du client, distinct de `AO<id>` |
| `description` | ≤ 65 000 | |
| `criteria` | ≤ 5 000 | |
| `place` | | |
| `startDate` | date **ou** `"immediate"` | `"immediate"` sur **82 %** des opportunités d'une base réelle ([MOCK]) |
| `duration` | entier | unité NON VÉRIFIÉE |
| `typeOf`, `state`, `mode` (1–4) | entiers | codes **propres à l'instance** |
| `expertiseArea`, `activityAreas[]`, `tools[]` | | codes **propres à l'instance** |
| `closingDate` | | |
| `company`, `contact`, `mainManager` | relations | |

**Les états et les types sont des entiers dont le sens est propre à chaque
client**, lisibles dans `GET /application/dictionary`. [MOCK] le dit sans
détour : « Never encode a business rule on these integers without the target
tenant's dictionary. » ORQA ne code donc **aucun** entier en dur : chaque code
utilisé est un **réglage**, choisi dans une liste lue du dictionnaire (§7.3).

**NON VÉRIFIÉ** : si la lecture d'une opportunité inclut la raison sociale du
client dans `included`, ou s'il faut un second appel sur
`/companies/{id}/information`. À établir par la sonde (§5.3).

### 1.5 Candidats

**Création : `POST /candidates`**, schéma relu directement.
- **Obligatoires** : `data.type`, `data.attributes.firstName`,
  `data.attributes.lastName` (1 à 100 caractères). Si `source` est fourni,
  `source.typeOf` **et** `source.detail` le sont aussi.
- **Attributs disponibles** : `creationDate`, `civility`, `state`, `stateReason`,
  `typeOf`, `email1..3` (≤ 100), `phone1..3` (≤ 20), `fax`, `address`,
  `postcode`, `town`, `country`, `subDivision`, `source`, `dateOfBirth`,
  `mobilityAreas`, `globalEvaluation`, `evaluations`, `availability`,
  `isVisible`, `informationComments` (≤ 1 000), `socialNetworks`, `tmpFile`.
- **Relations** : `mainManager`, `hrManager`, `agency`, `pole`, toutes optionnelles
  selon le schéma. **NON VÉRIFIÉ** : leur valeur par défaut, et si `agency` est
  exigée en pratique.
- Le lien de dictionnaire est écrit `setting.state.candidat` dans le schéma de
  création mais `setting.state.candidate` dans le filtre de recherche. C'est une
  coquille du RAML, sans conséquence si l'on passe par le dictionnaire.

**Recherche par adresse : `GET /candidates?keywords=<adresse>&keywordsType=emails`.**
- ⚠️ Sans `keywordsType`, la valeur par défaut est `resumeTd` : la recherche
  porte alors sur le **texte du CV**, et une adresse citée dans le CV d'un autre
  candidat le ferait remonter.
- **NON VÉRIFIÉ** : correspondance exacte ou partielle, prise en compte
  d'`email2` et `email3`, sensibilité à la casse.

**Lecture : `GET /candidates/{id}/information`.** La relation `resumes` liste les
CV rattachés.

**Positionnements d'un candidat : `GET /candidates/{id}/positionings`.**

### 1.6 Documents (CV)

**`POST /documents`, en `multipart/form-data`**, schéma relu directement.
- `parentType` (obligatoire) : on utilise **`candidateResume`** parmi 24 valeurs.
- `parentId` (entier, obligatoire).
- Contenu : `file` **ou** `fileUrl`. ORQA envoie `file` : jamais d'URL signée
  exposée à un tiers.
- `parsing` (booléen) : « Enable Parsing by ai with uploaded file (only for
  candidateResume) ». ORQA l'envoie à **`false`** tant que la question n'est pas
  levée (§9.1 Q10) : une analyse par IA côté Boond pourrait **réécrire la fiche** que
  nous venons de relire.
- `temporary` et `tmpFile` : un enchaînement « envoi temporaire, puis création du
  candidat avec le fichier » est plausible mais **NON VÉRIFIÉ**. On ne s'y
  appuie pas.

**NON VÉRIFIÉ** : les formats acceptés et la taille maximale.

### 1.7 Notes (actions)

**`POST /actions`.**
- **Obligatoires** : `attributes.typeOf` (code du dictionnaire du client, famille
  `setting.action.*`) et `relationships.dependsOn` (ici `candidate`).
- **Champs utiles** : `title` (≤ 8 192), `text` (≤ 65 000), `description`
  (≤ 1 000), `startDate`.

⚠️ `GET /candidates/{id}/actions` ignore `maxResults` et rend 30 lignes. La
relecture d'une action se fait donc **par son identifiant**, jamais en cherchant
dans la liste.

### 1.8 Positionnements

**`POST /positionings`**, schéma relu directement.
- **Obligatoires** : `data.type`, `relationships.opportunity` et
  `relationships.dependsOn`. `dependsOn` peut être une ressource, un
  **candidat** ou un produit.
- **Attributs** : `state` (`setting.state.positioning`), `stateReason`,
  `startDate`, `endDate`, les champs de prix et de jours, `informationComments`
  (**≤ 500**), `includedInSimulation`, `creationSource` (seule valeur admise en
  entrée : `"ia"`, « any other value is ignored »), `additionalTurnoverAndCosts`.
- **Paramètres de requête** : `sendMailToDependsOnManager` et
  `sendMailToOpportunityManager`, **toujours `false`** (§0.5).

**Doublons** : le schéma ne prévoit **aucune** contrainte d'unicité. Selon [MCP-F],
« rien n'empêche deux positionnements du même profil sur la même affaire » ;
**NON VÉRIFIÉ officiellement**. Un positionnement ne se crée donc qu'après avoir
constaté son absence (§3.3).

---

## 2. Mapping

Légende : `⛔` = ORQA ne possède pas la donnée ; `⚙` = code du dictionnaire du
client, fixé dans les réglages.

### 2.1 Opportunité Boond → campagne ORQA (flux 1)

**Principe : l'opportunité est traitée comme un DOCUMENT déposé.** Le
pré-remplissage par document existe déjà, avec ses garde-fous :
- le LLM n'invente rien ;
- une pondération suggérée doit être **traitée** avant l'activation ;
- les seuils et les critères éliminatoires restent hors périmètre ;
- l'extraction est tracée dans `prefill_extraction`.

C'est aussi le **seul** chemin qui pose correctement le drapeau `suggere` (cf.
mémoire `project_suggere_gap`). Un second extracteur, spécifique à Boond,
reproduirait exactement le trou que ce drapeau comble.

Concrètement, le flux 1 procède ainsi :
1. Les champs **structurés** (titre, lieu, date de début) sont mappés de façon
   **déterministe**, et leur source est affichée.
2. Le texte libre (`description` + `criteria`) est passé à l'extracteur
   existant `extractCampaignPrefill`, comme le texte d'un document. Le
   `extraitSource` de chaque champ rendu est préfixé « Boond · … ».
3. Le résultat est un `CampaignPrefill`, passé tel quel à `prefillToFDP`, dans le
   même formulaire.

| Campagne ORQA | Opportunité Boond | Traitement |
|---|---|---|
| FDP `job_title` | `title` | déterministe ; le nom de campagne suit (`deriveCampaignName`) |
| FDP `location` | `place` | déterministe |
| FDP `start_date` | `startDate` | déterministe ; `"immediate"` devient « Dès que possible » |
| FDP `main_missions` | `description` | extracteur existant |
| FDP `key_skills` | `criteria` (+ `description`) | extracteur existant ; `tools[]` ⚙ **non** utilisé en v1 (libellés du dictionnaire NON VÉRIFIÉS) |
| FDP `seniority` | `criteria` / `description` | extracteur existant, **suggéré** |
| FDP `contract_type` | ⛔ | `typeOf` décrit la **nature de l'affaire** (régie, forfait, recrutement…), pas un contrat de travail ; aucune déduction |
| FDP `salary_range` | ⛔ | les montants de l'opportunité sont un **chiffre d'affaires**, pas un salaire ; ne jamais les confondre |
| Pondérations suggérées | `criteria` | extracteur existant, `suggere:true`, à traiter |
| Seuils, critères éliminatoires | — | **jamais** (saisie 100 % humaine, règle existante) |
| Donneur d'ordre | `contact` | **proposition** d'un donneur d'ordre existant dont l'adresse correspond ; **jamais de création automatique** |
| Site | — | aucun équivalent (un site est une implantation du cabinet) |
| « Client » | `company` | ⛔ ORQA n'a pas d'entité client (même constat que l'Apec §2.4) ; la raison sociale est **affichée** depuis le lien (§4.1), rien de plus |
| Référent de campagne | `mainManager` | aucune déduction en v1 (voir §4.2 pour la correspondance recruteur ↔ ressource) |
| Référence Boond | `AO<id>` + `reference` | les deux sont conservés dans le lien (§4.1) |

**Le lien et le pré-remplissage sont deux gestes distincts.**
- **Lier** une campagne à une opportunité est possible à tout moment : à la
  création comme à l'édition.
- **Pré-remplir** n'a de sens qu'à la création, ou sur une FDP encore vide.
  Proposer d'écraser une FDP déjà travaillée serait l'inverse de la règle de
  source unique.
- En édition, lier une opportunité **n'importe rien** et **le dit**.

### 2.2 Candidature ORQA → candidat Boond (flux 2)

**Minimisation.** Boond reçoit ce dont un recruteur a besoin pour positionner le
candidat, et rien de plus : identité, contact, CV, analyse. Pas de date de
naissance, pas d'adresse postale, pas de localisation, même quand l'analyse les
contient.

| Candidat Boond | Candidature ORQA | Traitement |
|---|---|---|
| `firstName` * | `application.candidate.fullName` | **découpage**, voir ci-dessous |
| `lastName` * | idem | idem |
| `email1` | `candidate_analyses.candidate_email` | **obligatoire côté ORQA** : sans adresse, aucune déduplication n'est possible ⇒ la synchronisation est **bloquée** (`no_email`) et le motif est affiché |
| `phone1` | `application.candidate.phone` | normalisé ; au-delà de 20 caractères, **omis**, avec un avertissement dans la trace |
| `source` | ⚙ `typeOf` + `detail` | `detail` = `ORQA · CAMP-2026-288 · <clé>` (≤ 100), où `<clé>` est la clé de corrélation (§3.1) |
| `state` | ⚙ | état initial choisi dans les réglages |
| `mainManager` | référent de la campagne | via `recruiters.boond_resource_id` s'il est renseigné, sinon omis |
| `socialNetworks` | ⛔ | non envoyé en v1 (une URL de profil sourcing est un choix à arbitrer, §9.2 E) |
| `informationComments` | — | vide : l'analyse va dans une **action**, qui est datée et historisée |

**Découpage du nom — ne jamais deviner en silence.** La règle pure et testée,
`splitCandidateName`, rend `{ firstName, lastName, confidence }` :
- un token entièrement en majuscules est le nom (« Jean DUPONT », « Jean-Marie
  LE GALL ») ⇒ `certain` ;
- exactement deux tokens ⇒ `certain`, prénom puis nom ;
- trois tokens ou plus, sans signal de casse ⇒ `ambiguous`.

Un nom `ambiguous` **bloque** la synchronisation au motif `name_split`. Le bloc
Boond de la fiche montre le découpage proposé, et le recruteur le **confirme** ou
le corrige d'un geste. C'est la seule saisie que le flux 2 demande, et il ne la
demande que quand il ne sait pas.

**CV (`POST /documents`).**
- `parentType=candidateResume`, `parsing=false`, fichier binaire.
- Le binaire vient de l'artefact déjà résolu par `cvArtifactIdsFor` (IMAP, chat
  ou sourcing), et se télécharge par `downloadArtifact`.
- Une candidature sourcing sans CV joint a un **CV reconstitué par ORQA** : il
  part, mais la note le **dit**.
- Pas d'artefact ⇒ la synchronisation continue **sans CV**, et c'est écrit dans
  la note comme dans la trace. Un candidat positionné sans CV reste
  exploitable ; un positionnement manquant pour un fichier absent ne l'est pas.

**Analyse (`POST /actions`, `dependsOn: candidate`, `typeOf` ⚙).**
- `title` : `Analyse ORQA — CAMP-2026-288 — 78/100`.
- `text` : la synthèse, les points forts et les points de vigilance
  (`narration`), puis les critères avec leur verdict et leur poids, la zone de
  décision, **qui a décidé** (système ou recruteur, nommé) et le lien vers la
  campagne.
- Cette note dit explicitement qu'il s'agit du score **de la grille ORQA de cette
  campagne**, et non d'une évaluation Boond. Un 78 lu hors contexte serait
  comparé à tort à des notes produites ailleurs.

**Positionnement (`POST /positionings`).**

| Positionnement Boond | Source |
|---|---|
| `relationships.opportunity` * | le lien de la campagne (§4.1) |
| `relationships.dependsOn` * | `{type:"candidate", id}` résolu à l'étape candidat |
| `state` | ⚙ état initial (voir l'avertissement ci-dessous) |
| `informationComments` | `Proposé par ORQA le 15/09/2026 · 78/100 · CAMP-2026-288 · <clé>` (≤ 500) |
| `startDate`, prix, jours | **jamais** : ce sont des données commerciales, propriété de Boond |
| query `sendMailTo*` | `false`, explicitement |

⚠️ **L'état initial du positionnement ne doit pas être un état « gagné ».**
Boond rattache un positionnement gagné à un projet (§0.5), et ORQA ne sait pas
quel code signifie « gagné » chez un client donné. Le réglage le **dit**, en
toutes lettres, à côté de la liste.

### 2.3 Ce que Boond exige et qu'ORQA ne possède pas

| Exigence Boond | Réponse ORQA |
|---|---|
| `firstName`/`lastName` séparés | découpage, confirmé par un humain s'il est ambigu (§2.2) |
| Codes d'états, sources et types d'action | réglages, choisis dans le dictionnaire lu du client (§7.3) |
| `agency`, si elle est exigée en pratique | réglage ⚙, **à confirmer** (§9.1 Q5) |
| Identifiant de ressource du recruteur | `recruiters.boond_resource_id`, optionnel |

---

## 3. Déduplication et idempotence

### 3.1 Deux verrous, à deux endroits

1. **Chez ORQA : `ats_sync`** (§4.2).
   - Une ligne par `(analysis_id, system)`, `unique`.
   - L'insertion est la réservation, sur le modèle de `job_postings` : le perdant
     sait qu'il a perdu.
   - C'est le **seul** verrou fiable, puisque Boond n'offre ni clé externe
     cherchable ni unicité (§0.1, §1.8).
   - Chaque étape franchie est **persistée**. Un rejeu reprend à l'étape en
     échec et ne recommence jamais une étape déjà prouvée.
2. **Chez Boond : la clé de corrélation**, `ORQA-<12 hex>`.
   - Elle est dérivée par un hachage **stable** de l'`analysis_id`, et non l'id
     lui-même : `can_imap_<boîte>_<uid>` dépasserait les 100 caractères de
     `source.detail` et exposerait des identifiants techniques.
   - Elle est posée dans `source.detail`, dans le titre de la note et dans le
     commentaire du positionnement.
   - Elle sert à **reconnaître** ce qu'ORQA a déjà écrit quand la trace locale ne
     suffit pas (§3.4).

### 3.2 Candidat : règle de décision

`GET /candidates?keywords=<adresse>&keywordsType=emails`, puis **re-filtrage côté
ORQA** : on ne garde que les fiches dont `email1`, `email2` ou `email3` est
**égal** à l'adresse (comparaison insensible à la casse, espaces retirés). Le
filtre serveur n'est jamais cru (§0.2).

| Correspondances exactes | Décision |
|---|---|
| **0** | **créer** le candidat |
| **1** | **réutiliser** la fiche. On ne modifie **aucun** champ d'identité : Boond est maître de ce qu'il détient, et un recruteur l'a peut-être enrichie. On ajoute le CV, la note et le positionnement. |
| **≥ 2** | **arrêt** au motif `ambiguous_candidate`. La fiche ORQA liste les candidats Boond concernés (`CAND<id>`, nom, date de création) et le recruteur **choisit**. Même principe que le rapprochement IMAP par le corps : un mauvais rattachement silencieux est pire qu'un non-rattachement. |

Une fiche réutilisée qui porte **déjà** la clé ORQA de cette candidature est la
preuve d'une création antérieure dont la trace locale s'est perdue. On l'adopte
sans rien créer (§3.4).

Un candidat déjà présent qui porte **un CV plus récent** que le nôtre en reçoit
tout de même un second. On ne supprime jamais un document côté Boond : c'est le
prix de la maîtrise partagée, et il est assumé.

### 3.3 Positionnement : exister avant de créer

Le positionnement n'est créé qu'après
`GET /candidates/{id}/positionings`, **re-filtré** sur l'identifiant de
l'opportunité liée :
- **aucun** positionnement ⇒ créer ;
- **au moins un** ⇒ **ne rien créer** ; l'étape passe à `positioned`, avec
  `already_positioned: true` et l'identifiant existant. Un recruteur a pu
  positionner la personne à la main : Boond est maître du positionnement.

On n'utilise **pas** `GET /positionings?keywords=AO<id> CAND<id>` : un filtre mal
formé y rend toute la base (§0.2).

### 3.4 Un POST sans réponse lisible n'est jamais rejoué tel quel

`POST /candidates`, `/documents`, `/actions` et `/positionings` ne sont **pas
idempotents**. Sur un délai dépassé ou une coupure, on ne sait pas si l'objet
existe. La règle est celle d'`openPosition` à l'Apec : **relire avant de
rejouer**.

| Étape incertaine | Relecture qui tranche |
|---|---|
| candidat | recherche par adresse (§3.2), puis présence de la clé dans `source.detail` |
| CV | `resumes` du candidat : un document apparu depuis `step_started_at` |
| note | actions du candidat, **titre portant la clé** (dans les 30 lignes rendues ; au-delà, c'est une trace d'incertitude, pas une création) |
| positionnement | positionnements du candidat, re-filtrés sur l'opportunité (§3.3) |

Le transport distingue `certainlyNotSent` (refus avant émission, 4xx lisible)
d'une issue `uncertain`, comme `AdepTransportError`. Seule la première autorise
un rejeu direct.

### 3.5 Relecture de preuve après chaque écriture

Une écriture n'est **jamais** comptée comme réussie sur la seule foi d'un 200.

| Écriture | Relecture | Preuve exigée |
|---|---|---|
| `POST /candidates` | `GET /candidates/{id}/information` | `firstName`, `lastName`, `email1` et `source.detail` **égaux** à ce qui est parti |
| `POST /documents` | `GET /candidates/{id}/information` | l'identifiant rendu figure dans `relationships.resumes` |
| `POST /actions` | lecture de l'action par son identifiant | `dependsOn` = le candidat, et titre égal |
| `POST /positionings` | `GET /candidates/{id}/positionings` | l'identifiant rendu est présent **et** sa relation `opportunity` est la bonne |

Un écart donne le statut **`persist_mismatch`**, qui n'est **pas re-tentable
automatiquement**. Rejouer un POST dont on sait que le serveur l'a déformé
créerait un second objet tout aussi déformé. Le motif est affiché avec le champ
concerné, et un humain tranche.

### 3.6 Validation avant envoi

1. **Règles métier locales, pures et testées** (`validate.ts`) : longueurs
   (100, 20, 500…), obligatoires, `sendMailTo*` à `false`, états ⚙ présents
   dans le dictionnaire mis en cache.
2. **Validation contre les JSON Schemas officiels.**
   - Les fichiers `bodyPost.json` de `candidates`, `positionings` et `actions`
     sont **versionnés** dans `docs/boond/schemas/`, avec leur date de
     récupération. Un test compare les payloads construits à ces fichiers, et
     non à un schéma recopié à la main.
   - Le validateur doit être une **dépendance déclarée** : `ajv` n'est
     aujourd'hui présent que transitivement. Version de brouillon JSON Schema
     **NON VÉRIFIÉE**.
   - `npm run boond:probe -- --schemas` retélécharge les schémas servis et
     **refuse de continuer** s'ils ont changé depuis la version versionnée.

Ce qu'aucune validation ne couvre : un code d'état **valide mais sans effet**
côté serveur. C'est le rôle de la relecture (§3.5).

---

## 4. Modèle de données

### 4.1 Le lien campagne ↔ opportunité — une TABLE, pas une colonne

Le brief propose `campaigns.boond_opportunity_id`. Je recommande une table, pour
deux raisons dont la première a déjà coûté deux fois.

- **Le piège du snapshot.** Toute colonne de `campaigns` est à portée de
  `campaignToRow` et du PUT `/api/campaigns`. Un onglet ouvert avant la liaison
  la remettrait à `null` au premier autosave. C'est exactement ce qu'ont payé
  `scheduling_native` et `demo_job_posts`, et c'est pourquoi `job_postings` est
  une table. Une colonne exigerait un `Omit` de plus sur `CampaignSnapshot` et un
  PATCH ciblé ; une table est hors d'atteinte **par construction**.
- **Le port est générique.** `AtsConnector` n'est pas propre à Boond. Une colonne
  par système répéterait le schéma à chaque nouvel ATS.

```sql
create table if not exists public.ats_campaign_links (
  campaign_id      text not null references public.campaigns(id) on delete cascade,
  system           text not null,                -- 'boondmanager'
  remote_id        text not null,                -- '123' (servi en chaîne par Boond)
  remote_ref       text not null,                -- 'AO123' : le fil rouge affiché
  remote_reference text,                         -- attributes.reference, texte libre du client
  remote_label     text,                         -- titre au moment de la liaison
  company_label    text,                         -- raison sociale au moment de la liaison
  snapshot_read_at timestamptz not null,         -- « lu le … » : un cache, jamais une vérité
  linked_by_user_id text,
  linked_at        timestamptz not null default now(),
  primary key (campaign_id, system)
);
alter table public.ats_campaign_links enable row level security;
create index if not exists ats_campaign_links_remote_idx
  on public.ats_campaign_links (system, remote_id);
```

Choix délibérés :
- **Une opportunité par campagne et par système.** En changer est permis tant
  qu'**aucune** synchronisation n'a abouti. Au-delà, le changement vaut pour les
  synchronisations **futures**, les positionnements déjà faits restent où ils
  sont, et le dialog le **dit**.
- **Une même opportunité peut être liée à plusieurs campagnes** (une
  réouverture, par exemple). On **avertit** sans bloquer, grâce à l'index sur
  `remote_id`.
- **Le libellé et la raison sociale sont un cache**, horodaté par
  `snapshot_read_at`, et rafraîchi à l'ouverture du bloc. Boond est maître : un
  titre renommé là-bas n'est jamais « faux » ici, il est « lu le … ».

### 4.2 `ats_sync` — traçabilité et reprise

```sql
create table if not exists public.ats_sync (
  id                 text primary key,             -- 'atss_<slug>'
  analysis_id        text not null references public.candidate_analyses(id) on delete cascade,
  campaign_id        text not null,
  system             text not null,                -- 'boondmanager'
  correlation_key    text not null,                -- 'ORQA-3f9a1c0b2e7d'

  -- Pourquoi cette ligne existe : le GO qui l'a déclenchée (§6).
  trigger_kind       text not null check (trigger_kind in ('go','manual')),
  trigger_marked_at  timestamptz not null,
  requested_by_user_id text,

  -- Machine d'états par ÉTAPE : chaque étape prouvée est acquise, un rejeu reprend là.
  state              text not null default 'pending'
    check (state in ('pending','candidate_resolved','cv_attached','note_added',
                     'positioned','done','blocked','abandoned')),
  step_started_at    timestamptz,                  -- fenêtre de la relecture incertaine (§3.4)
  block_reason       text                          -- 'no_email'|'name_split'|'ambiguous_candidate'
    check (block_reason is null or block_reason in
      ('no_email','name_split','ambiguous_candidate','persist_mismatch',
       'campaign_not_linked','settings_incomplete','decision_withdrawn')),

  -- Identités distantes : prouvées par relecture, jamais seulement « rendues ».
  remote_candidate_id   text,
  candidate_reused      boolean,
  remote_document_id    text,
  remote_action_id      text,
  remote_positioning_id text,
  already_positioned    boolean,
  remote_opportunity_id text,                      -- figé à l'envoi : un re-lien ultérieur ne le réécrit pas

  -- Reprise, sur le modèle d'imap_cv_retries.
  attempts           integer not null default 0,
  next_attempt_at    timestamptz,
  claimed_at         timestamptz,                  -- claim deux-phases (TTL claims-policy)

  -- Erreur CAVIARDÉE : code, pointeur de champ, jamais le « detail » brut
  -- (Boond peut y recopier la valeur rejetée, donc une adresse ou un nom).
  last_error_code    text,
  last_error_pointer text,
  last_error_at      timestamptz,

  synced_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (analysis_id, system)
);
alter table public.ats_sync enable row level security;
create index if not exists ats_sync_due_idx
  on public.ats_sync (next_attempt_at)
  where state not in ('done','blocked','abandoned');
```

À ajouter également :

```sql
alter table public.recruiters  add column if not exists boond_resource_id text;
alter table public.app_settings add column if not exists boond_config jsonb;
-- Le userToken : colonne DÉDIÉE, chiffrée par encryptCredential, jamais dans le jsonb
-- (un jsonb se relit et se renvoie en bloc ; une colonne se retire de la projection).
alter table public.app_settings add column if not exists boond_user_token_encrypted text;
```

⚠️ **Constat de l'inventaire** : aucun secret n'est chiffré aujourd'hui dans
`app_settings`. La clé Resend y est **en clair**, jamais renvoyée au GET. Le
userToken Boond serait le **premier** secret chiffré de cette table. Il utilise
`encryptCredential` (AES-256-GCM, clé `MAILBOX_ENCRYPTION_KEY` — un nom devenu
trop étroit, à garder tel quel pour ne pas multiplier les clés), il est déchiffré
au moment de l'appel et n'est jamais projeté vers le navigateur.

Les trois blocs rejoignent `scripts/migrate.sql`, en état final idempotent, avec
**double application** en dev avant tout déploiement.

### 4.3 Verdicts RGPD

| Table | Contenu relatif au candidat | Verdict proposé |
|---|---|---|
| `ats_campaign_links` | Aucun : une opportunité, un libellé de poste, une raison sociale de client. | **CONSERVER** |
| `ats_sync` | Aucun nom ni adresse (erreurs caviardées), mais des **identifiants distants** (`CAND…`, positionnement) qui désignent la personne **dans Boond**. | **PSEUDONYMISER**, `step` : la ligne est conservée (système, dates, état : preuve de la transmission), les `remote_*_id` et `correlation_key` sont vidés |

Trois conséquences pour la purge (`npm run purge:candidate`) :

1. **Ordre.** Les identifiants Boond sont **lus avant** d'être pseudonymisés. Ils
   sont nécessaires pour la suite, et ils disparaissent à l'étape suivante.
2. **Le rapport de confirmation gagne une ligne « hors ORQA : BoondManager ».**
   Il dit que la candidature a été transmise le …, et que la fiche candidat, son
   CV, la note d'analyse et le positionnement sont à effacer **par le
   responsable de traitement dans Boond**. ORQA n'y efface rien : il n'en est
   pas le sous-traitant pour cet outil.
3. **Arbitrage ouvert pour le DPO (§9.2 F).** Faut-il faire figurer
   l'identifiant `CAND<id>` dans ce rapport ? Il permet au client d'agir, mais
   c'est un identifiant de personne dans un document que la garde
   `assertNoLeakedIdentity` protège aujourd'hui de toute identité. Si oui, il
   faut une exemption **nommée**, sur le modèle de celle de la référence de
   demande.

Tout le reste est dans le même commit que les `create table` : les deux entrées
dans `table-inventory.ts`, les deux lignes au §4.1 de
`docs/ops/purge-rgpd-candidat.md`, et `ats_sync` nommée dans `execute.ts` puis
relue par `verify.ts`. Sans cela, la suite est rouge.

**DPA** : BoondManager devient **destinataire** des données candidats. La ligne
est à ajouter à l'annexe sous-traitants du client (qui est déjà lié à Boond par
son propre contrat). Cette ligne **conditionne l'activation**, et le réglage
d'activation le rappelle (§7.3).

---

## 5. Architecture : port, adaptateurs, simulation

### 5.1 Le port

```ts
// src/lib/ats/types.ts — générique, aucun vocabulaire Boond
interface AtsConnector {
  readonly system: 'boondmanager';
  searchOpportunities(q: OpportunityQuery): Promise<Outcome<OpportunitySummary[]>>;
  getOpportunity(remoteId: string): Promise<Outcome<OpportunityDetail>>;
  findCandidatesByEmail(email: string): Promise<Outcome<RemoteCandidate[]>>;   // re-filtré en EXACT
  createCandidate(input: CandidateInput): Promise<WriteOutcome<RemoteCandidate>>;
  attachDocument(candidateId: string, doc: DocumentInput): Promise<WriteOutcome<{ id: string }>>;
  addNote(candidateId: string, note: NoteInput): Promise<WriteOutcome<{ id: string }>>;
  listPositionings(candidateId: string): Promise<Outcome<RemotePositioning[]>>;
  createPositioning(input: PositioningInput): Promise<WriteOutcome<RemotePositioning>>;
}
// WriteOutcome = proven | persist_mismatch | rejected | unavailable | uncertain
```

Trois écarts avec le brief, qui découlent de l'étude :
- **`findCandidatesByEmail` et `listPositionings` s'ajoutent**. La déduplication
  n'est pas une option.
- **`addNote` s'ajoute**. Le score et la synthèse ont besoin d'un support.
- **`WriteOutcome` porte `proven`, et non `ok`**. La relecture de preuve (§3.5)
  vit **dans l'adaptateur** : aucun appelant ne peut recevoir une création non
  relue, ni oublier de la relire.

### 5.2 Les adaptateurs

| Couche | Réel | Simulation |
|---|---|---|
| Transport HTTP | `createHttpBoondTransport` : `fetch`, délai de 15 s, `Accept: application/json`, contrôle du `Content-Type`, JWT HS256, **une seule tentative**, `Retry-After` remonté | `MockBoondTransport` **avec état** (candidats, documents, actions, positionnements en mémoire), capable de reproduire les défauts réels : champ ignoré, 200 HTML, 429, 422 par vagues, doublon de positionnement toléré |
| Connecteur | `BoondManagerConnector` : JSON:API ↔ types du port, relectures | le même, sur le transport simulé |

Le mock se place **au niveau du transport**, comme pour l'Apec. C'est la
condition pour que le code du connecteur (mapping, re-filtrage, relectures) soit
**le même** en test et en réel. Un faux connecteur ne testerait que lui-même.

### 5.3 Qui a le droit d'appeler le réel

| Qui | Transport |
|---|---|
| Tests (vitest, régression) | simulation **uniquement** ; garde structurelle `no-real-calls.test.ts`, calquée sur l'Apec |
| Application, `BOOND_MODE` absent ou `mock` | simulation, et l'écran le **dit** (« simulation — rien n'est envoyé à BoondManager ») |
| Application, `BOOND_MODE=live` | réel. Sans identifiants ⇒ **erreur**, jamais un repli sur la simulation (leçon de l'Apec : un repli muet ferait croire à des envois) |
| `npm run boond:probe -- --env <fichier>` | réel, **lancé à la main par le DO**. En lecture seule par défaut : `current-user`, dictionnaire, recherche et lecture d'une opportunité, recherche d'un candidat par adresse, contrôle des schémas. Écritures seulement avec `--write --confirm-instance <sous-domaine>`, sur un candidat de test explicitement nommé. |

**Pendant toute la Phase 2, `BOOND_MODE=live` n'est posé nulle part** : le réel
n'est atteint que par la sonde. [MOCK] y a sa place, en option
`--target http://localhost:8000`, pour exercer la **lecture** et les **modes de
panne** (429, 5xx, rejet d'authentification, via son plan `/__admin`). C'est un
service local, jamais une dépendance de test.

### 5.4 Secrets

| Secret | Où |
|---|---|
| `BOOND_ENABLED`, `BOOND_MODE`, `BOOND_BASE_URL` | env |
| `BOOND_CLIENT_TOKEN`, `BOOND_CLIENT_KEY` | env (voir la réserve du §1.1) |
| userToken | `app_settings.boond_user_token_encrypted`, chiffré |

Aucun n'est `NEXT_PUBLIC_*`. Le JWT construit, les en-têtes et les corps
d'erreur bruts passent par une fonction de **caviardage** avant tout log ou
journal. Le JWT n'a pas d'expiration (§1.1) : une fuite vaut accès permanent,
jusqu'à régénération du userToken.

### 5.5 Flag à deux étages, fail-closed

Sur le modèle du sourcing :
- **déploiement** : `BOOND_ENABLED=1`, plus `BOOND_CLIENT_TOKEN`,
  `BOOND_CLIENT_KEY` et `MAILBOX_ENCRYPTION_KEY` si `BOOND_MODE=live` ;
- **réglage** : `app_settings.boond_config.enabled === true`, plus un userToken
  enregistré.

Flag éteint :
- bloc campagne, bloc fiche et carte admin **absents** ;
- routes `/api/boond/**` en **404** (garde `guardBoond`, calquée sur
  `guardSourcing`) ;
- **le rail ne crée aucune ligne `ats_sync`** et n'en traite aucune.

⚠️ À l'Apec, l'inventaire a relevé un écart : les routes **simulent** quand le
flag est absent au lieu de rendre 404. Ici, flag éteint = 404, et la simulation
est un **mode** du flag allumé.

Éteindre le flag alors que des lignes sont en cours les **gèle** sans les
abandonner. Au rallumage, elles reprennent là où elles en étaient.

---

## 6. Déclencheur du flux (2)

### 6.1 Acceptation ou GO définitif — recommandation : le GO

| | Acceptation | GO définitif (« retenu ») |
|---|---|---|
| Nature | décision de **présélection**, souvent **automatique** (`auto_accept`, aucun geste humain) | décision **humaine**, après entretien |
| Volume | tous les candidats au-dessus du seuil haut | les retenus |
| Réversibilité côté ORQA | fréquente (correction, no-show, entretien négatif) | rare (correction de décision) |
| Réversibilité côté Boond | **aucune** : ORQA ne supprime rien dans Boond | idem |
| RGPD | pousse chez un tiers les données de personnes qu'ORQA refusera ensuite | minimisé aux personnes réellement retenues |

**Je recommande le GO.** Le motif décisif est la dernière colonne combinée à la
première. Avec l'acceptation, une **décision automatique** créerait chez le
client une donnée personnelle **qu'ORQA ne peut plus retirer**. Le projet a déjà
renversé cette logique pour les refus : un geste sortant et irréversible
appartient à l'humain. C'est aussi le fonctionnement d'un cabinet : on saisit
dans l'outil commercial le consultant qu'on va **proposer** au client, pas chaque
CV passé au-dessus d'un seuil.

**Contrepartie** : un recruteur qui voudrait positionner **avant** l'entretien ne
le peut qu'avec le geste manuel « Envoyer vers Boond » (§6.4). Cela reste à
confirmer par le DO et par le client (§9.2 A).

### 6.2 Le rail relit l'état, il ne reçoit rien

Aucune accroche dans `markCandidateValidation`, qui est côté client, ni dans les
trois writers d'acceptation. Un job de rail, `runAtsSyncMaintenance(now)`,
procède ainsi :

1. **Détection.** Il relit les marqueurs `candidate_validation_marked` récents
   (`listJournalEntriesByActions`) et, pour chaque candidature concernée,
   recalcule l'étape **canonique** : pliage `foldValidationMark`, puis
   `deriveCandidateStage`. Seul `retenu` qualifie. Une gomme `cleared` ou un
   `rejected` postérieur ne qualifient pas, **par construction**. C'est le même
   `stageFor` que le lot de clôture : aucune seconde définition de « retenu ».
2. **Délai de rétractation.** Le marqueur doit dater de plus de
   `boond_config.goGraceMinutes` (défaut proposé : **15 min**). Un GO posé sur la
   mauvaise ligne et corrigé dans la foulée ne part jamais. Coût assumé : le
   positionnement arrive un quart d'heure après le clic, et l'écran l'annonce
   (« envoi vers Boond vers 14:27 »).
3. **Préconditions**, vérifiées **avant** l'insertion :
   - campagne liée ;
   - réglages complets ;
   - campagne ni supprimée ni la candidature classée sans suite.

   Si la campagne n'est pas liée, **aucune ligne** n'est créée. La fiche dit
   « campagne non liée à Boond ». Lier la campagne **plus tard** ne déclenche pas
   de rattrapage de masse : les retenus antérieurs s'envoient d'un geste (§6.4).
4. **Réservation.** Insertion `ats_sync` en `pending`, protégée par l'`unique`.
5. **Exécution**, bornée à **2 synchronisations par tick** (6 à 9 appels HTTP
   chacune, sous le `maxDuration` de 60 s, avec le poller et le sourcing sur le
   même rail). Chaque exécution :
   - prend un claim deux-phases (`claimed_at`, TTL de `claims-policy`) ;
   - **re-vérifie** que l'étape est toujours `retenu` juste avant la première
     écriture ; si ce n'est plus le cas, la ligne passe en `blocked` au motif
     `decision_withdrawn`, et rien ne part ;
   - enchaîne les étapes (§3), en persistant chaque preuve.

Branchement en **deux** endroits, comme les jobs existants : la route
`/api/cron/imap-poll` (prod) et `runTick` du scheduler (dev/VPS), en fail-soft.
**Jamais pendant une requête utilisateur.**

### 6.3 Réessais et arrêts

| Issue | Traitement |
|---|---|
| `unavailable` (5xx, réseau avant émission) | backoff **1/5/15/60 min**, plafond **4** tentatives, puis `abandoned` **signalé** |
| `429` | `next_attempt_at` = `Retry-After`, **sans décompter** de tentative (ce n'est pas un échec du dossier) |
| `uncertain` (délai dépassé après émission) | relecture qui tranche au prochain passage (§3.4), puis reprise |
| `rejected` (422 lisible) | `blocked` avec code et pointeur caviardés ; **pas de réessai** (le même payload serait rejeté) |
| `persist_mismatch` | `blocked` ; pas de réessai (§3.5) |
| 401 / 422 de signature / 403 de périmètre | **toutes** les lignes sont gelées, sans décompte, jusqu'à la correction des réglages ; un signal métier unique est émis (et non un signal par candidat) |

**Journal, sur transition seulement** (leçon du 21/08) :
`boond_campaign_linked`, `boond_campaign_unlinked`, `boond_candidate_synced`
(payload : `candidateReused`, `alreadyPositioned`, `remoteRef`),
`boond_sync_blocked`, `boond_sync_abandoned`. Chaque action est inscrite dans
`ACTIVITY_RENDERERS`, avec un rendu **nominatif** : le payload porte
`candidateName`, car « CAND123 synchronisé » ne se lit pas.

**Signaux métier** :
- `boond_sync_attention` : lignes `blocked` ou `abandoned`, cible l'onglet
  Candidatures ;
- `boond_auth_failed` : une seule occurrence, cible `/settings` ;
- `boond_positioned_then_withdrawn` : une candidature synchronisée (`done`) dont
  l'étape n'est plus `retenu`. ORQA ne défait rien dans Boond. Le signal dit
  « positionnée dans Boond le …, décision corrigée depuis dans ORQA », et
  l'humain agit dans Boond.

### 6.4 Le geste manuel

Le bouton « Envoyer vers Boond », sur la fiche candidature, sert à trois choses :
- rattraper un retenu antérieur à la liaison ;
- positionner avant le GO, si le client le souhaite ;
- relancer une ligne `blocked` une fois le motif levé (nom confirmé, candidat
  Boond choisi).

Le geste **ne fait pas l'appel** : il insère ou réarme la ligne
(`trigger_kind='manual'`, `requested_by_user_id`), et le rail l'exécute au tick
suivant. Même principe que la soumission sourcing asynchrone : **une seule**
voie d'écriture vers Boond.

Il est protégé par un dialog de confirmation, qui dit ce qui va partir :
identité, CV, note d'analyse et positionnement sur `AO123`.

---

## 7. Maquettes

### 7.1 Campagne : lier une opportunité

Emplacement : un nouveau bloc **« BoondManager »** dans `CampaignEditAccordion`,
placé **après « Recruteur référent »**, et une section pliable équivalente dans
`CampaignCreateSheet`, en tête : on lie **avant** de rédiger, puisque la liaison
pré-remplit.

```
┌─ BoondManager ──────────────────────────────────── non liée ─┐
│                                                               │
│  Opportunité   [ 🔍 Rechercher : titre, client ou AO…     ]   │
│                                                               │
│   AO4127 · Consultant AMOA Trade Finance                      │
│           Banque Delta · Paris · démarrage immédiat · màj 12/09│
│   AO4093 · Chef de projet MOA paiements                       │
│           Banque Delta · Lyon · 01/10/2026 · màj 02/09        │
│   AO3988 · Consultant AMOA marchés                            │
│           Crédit Nord · Paris · démarrage immédiat · màj 28/08│
│                                     ↳ états listés : réglages  │
└───────────────────────────────────────────────────────────────┘
```

Une fois l'opportunité choisie, **à la création** :

```
┌─ BoondManager ──────────────────────────────────── liée ─────┐
│  AO4127 · Consultant AMOA Trade Finance          lu à 14:02 ↻ │
│  Client : Banque Delta   ·   Réf. client : DELTA-2026-17      │
│                                                               │
│  Pré-remplir la fiche de poste à partir de l'opportunité ?    │
│   · intitulé, lieu, démarrage          repris tels quels      │
│   · missions, compétences, séniorité   extraits du descriptif │
│   · pondérations                       SUGGÉRÉES, à traiter   │
│  Rien n'est repris du contrat ni du salaire : l'opportunité   │
│  ne les porte pas.                                            │
│                         [ Repartir à zéro ]  [ Pré-remplir ]  │
│                                                               │
│  Contact client : Claire M. — correspond au donneur d'ordre   │
│  « Claire Martin ». [ L'associer ]                            │
└───────────────────────────────────────────────────────────────┘
```

**En édition**, une fois liée : pas de pré-remplissage, et la phrase « la liaison
n'importe rien dans une fiche déjà rédigée ». Si des synchronisations ont abouti,
`[ Changer d'opportunité ]` ouvre un dialog : « 3 candidats sont déjà positionnés
sur AO4127 ; ils y restent. Les prochains le seront sur la nouvelle
opportunité. »

La référence `AO4127` rejoint la carte de campagne et l'en-tête de la Sheet, à
côté de `CAMP-2026-288` : c'est le fil rouge.

### 7.2 Fiche candidature : le bloc « BoondManager »

Emplacement : `CandidaturePanel`, après « Action » ; `CandidatureFullPage`,
après « Action ». Les états possibles :

```
Non lié      ┌─ BoondManager ───────────────────────────────────────┐
             │  La campagne n'est pas liée à une opportunité Boond. │
             │  → Campagnes › CAMP-2026-288 › BoondManager           │
             └──────────────────────────────────────────────────────┘

En attente   ┌─ BoondManager ───────────────────────────── à venir ─┐
             │  Retenu à 14:12 — envoi vers Boond vers 14:27.        │
             │  Une correction de la décision d'ici là annule l'envoi.│
             └──────────────────────────────────────────────────────┘

Synchronisé  ┌─ BoondManager ─────────────────────── synchronisé ✓ ─┐
             │  Candidat     CAND88213  (fiche existante réutilisée)  │
             │  CV           joint ✓        Note d'analyse   ✓        │
             │  Positionné   sur AO4127 le 15/09/2026 à 14:27         │
             │  Vérifié par relecture dans Boond.                     │
             └──────────────────────────────────────────────────────┘

À trancher   ┌─ BoondManager ─────────────────────────── à trancher ─┐
             │  Deux fiches Boond portent l'adresse de ce candidat : │
             │   ( ) CAND61020 · Jean Dupont · créée le 03/02/2025    │
             │   ( ) CAND77104 · J. Dupont   · créée le 11/06/2026    │
             │  ORQA ne choisit pas à votre place.                    │
             │                    [ Positionner la fiche choisie ]    │
             └──────────────────────────────────────────────────────┘

Nom          ┌─ BoondManager ─────────────────────────── à confirmer ─┐
             │  Boond sépare prénom et nom. Découpage proposé :       │
             │  Prénom [ Jean-Marie   ]   Nom [ Le Gall        ]      │
             │                                    [ Confirmer ]        │
             └──────────────────────────────────────────────────────┘

Erreur       ┌─ BoondManager ───────────────────────────── en échec ─┐
             │  Boond n'a pas conservé l'adresse envoyée (relue vide).│
             │  Rien n'a été renvoyé, pour ne pas créer de doublon.   │
             │  Code 1002 · /data/attributes/email1 · 15/09 à 14:27   │
             │                          [ Réessayer après correction ]│
             └──────────────────────────────────────────────────────┘
```

Chaque état **dit ce qui a été fait et ce qui ne l'a pas été**. Aucun bloc vide :
un bloc absent se lirait « pas vérifié ».

### 7.3 Réglages : section « BoondManager » (admin)

Emplacement : `SettingsHub`, section réservée aux admins, sur le modèle de
« Sourcing ».

```
┌─ BoondManager ───────────────────────────────────── simulation ─┐
│                                                                   │
│  Compte API                                                       │
│   Jeton utilisateur   [ •••••••••••••• enregistré le 15/09 ]      │
│                       [ Remplacer ]  [ Tester la connexion ]      │
│   ✓ Connecté en tant que « API ORQA » — instance delta.boond…      │
│                                                                   │
│  Correspondances (lues dans votre BoondManager)                   │
│   Source des candidats      ( ORQA ▾ )                            │
│   État d'un nouveau candidat( À qualifier ▾ )                     │
│   Type de la note d'analyse ( Note interne ▾ )                    │
│   État du positionnement    ( Proposé ▾ )                         │
│     ⚠ Ne choisissez pas un état « gagné » : Boond rattacherait le  │
│       positionnement à un projet.                                 │
│   Agence                    ( Paris ▾ )     (si exigée)           │
│   Opportunités proposées    [✓] En cours  [✓] Ouverte  [ ] Perdue │
│                                                                   │
│  Déclenchement                                                    │
│   Envoi au GO définitif, après   [ 15 ] min de délai              │
│                                                                   │
│  Recruteurs ↔ ressources Boond   Sami B. → ( Sami BENALI ▾ )      │
│                                  Jane R. → ( — non lié — ▾ )      │
│                                                                   │
│  Activation                                                       │
│   [ ] Activer la synchronisation                                  │
│       BoondManager recevra les données des candidats retenus.     │
│       Cette transmission doit figurer à l'annexe sous-traitants   │
│       de votre DPA.                                               │
└───────────────────────────────────────────────────────────────────┘
```

Les listes sont **lues du dictionnaire** du client (`/application/dictionary`,
mis en cache avec son heure de lecture). Un code enregistré qui a disparu du
dictionnaire rend les réglages **incomplets** : la synchronisation gèle, avec un
signal. Le bandeau « simulation » est affiché tant que `BOOND_MODE` n'est pas
`live`.

### 7.4 Admin : carte « Synchronisations Boond »

Emplacement : `/admin/dashboard`, à côté de `SourcingCostsCard`, avec la même
structure.

```
┌─ Synchronisations BoondManager ───────────────── 30 derniers jours ─┐
│  Synchronisés  42     dont fiches réutilisées  17   déjà positionnés  3 │
│  En cours       2     À trancher  2     En échec  1     Abandonnés  0    │
│                                                                        │
│  À traiter                                                             │
│   Jean Dupont        CAMP-2026-288 · AO4127   deux fiches Boond    ›   │
│   Amina K.           CAMP-2026-301 · AO4150   nom à confirmer      ›   │
│   Lucas P.           CAMP-2026-288 · AO4127   adresse non conservée ›  │
│                                                                        │
│  Dernier appel réussi : 15/09 à 14:27   ·   Débit : aucun 429 sur 24 h │
└────────────────────────────────────────────────────────────────────────┘
```

Les compteurs sont en `count: exact`, jamais la longueur d'une liste. Chaque
ligne ouvre la fiche candidature.

---

## 8. Découpage proposé pour la Phase 2

| Lot | Contenu | Réel ? |
|---|---|---|
| **0** | Fondations pures et testées : types du port, JWT, mapping JSON:API, `splitCandidateName`, clé de corrélation, re-filtrages exacts, validation locale + schémas versionnés, `MockBoondTransport` avec ses défauts réels, garde `no-real-calls` | non |
| **1** | Sonde `boond:probe` en **lecture seule** : connexion, dictionnaire, opportunités, recherche par adresse, dérive des schémas. Réponses du support intégrées en `§nbis`. | **oui, par le DO** |
| **2** | Flux (1) : `ats_campaign_links`, recherche et liaison, pré-remplissage via l'extracteur existant, réglages + userToken chiffré, flag | simulation |
| **3** | Flux (2) : `ats_sync`, rail, relectures, bloc fiche, geste manuel, journal, signaux, carte admin, registre RGPD + purge ; régression S25 | simulation |
| **4** | Sonde en écriture sur la **sandbox** (ou un candidat de test nommé), puis `BOOND_MODE=live` sur décision du DO | **oui, par le DO** |

Le lot 1 est placé **avant** tout écran. La moitié des questions du §9 conditionne
la forme des lots 2 et 3, et c'est le seul moyen d'y répondre qui ne dépende pas
du support.

---

## 9. Questions

### 9.1 Au support BoondManager — bloc prêt à envoyer

> Bonjour,
>
> Nous intégrons notre plateforme de recrutement ORQA à l'instance BoondManager
> d'un client commun, via l'API externe : lecture des opportunités, puis création
> de candidats, de leur CV, d'une note et d'un positionnement. Pourriez-vous nous
> confirmer les points suivants ?
>
> **Authentification**
> 1. Pour une intégration éditeur déployée chez plusieurs clients, faut-il
>    utiliser le JWT **Client** (clientToken/clientKey issus de l'Espace
>    développeur **de chaque client**) ou le JWT **App** ? Dans le second cas,
>    quelle est la procédure de publication d'une app, et quel est le nom exact de
>    la clé dans le jeton (`appToken` ou `clientToken`) ?
> 2. Quel est le contenu normatif du jeton : `{userToken, clientToken}` seul, ou
>    avec `time` et `mode` ? Que signifie `mode: "god"` ? Existe-t-il une
>    tolérance sur `time`, et `exp` est-il pris en compte ?
>
> **Limites et environnement**
> 3. Quels sont les seuils de débit (par minute, par 10 s) et le quota mensuel
>    pour l'offre de notre client ? Le décompte est-il par instance, par
>    utilisateur ou par application ? Quels en-têtes renseignent la consommation ?
> 4. Une sandbox exige-t-elle l'offre ADVANCED ? Ses clientToken et clientKey
>    sont-ils distincts de ceux de la production ? Existe-t-il un environnement de
>    test si le client n'a pas cette offre ?
>
> **Candidats**
> 5. Sur `POST /candidates`, que vaut `mainManager`, et surtout `agency`, quand ces
>    relations sont absentes ? L'une d'elles est-elle exigée en pratique, malgré le
>    schéma ?
> 6. Existe-t-il un champ de **référence externe** (ou un champ personnalisé
>    accessible par l'API) permettant de stocker et de **rechercher** un
>    identifiant tiers sur un candidat ?
> 7. `GET /candidates?keywordsType=emails` fait-il une correspondance exacte ou
>    partielle ? Couvre-t-il `email1`, `email2` et `email3` ? Est-il sensible à la
>    casse ?
> 8. Quel est le schéma exact du corps de `PUT /candidates/{id}/information` ?
>
> **Documents**
> 9. Pour `POST /documents` avec `parentType=candidateResume` : quels formats sont
>    acceptés (PDF, DOCX, DOC ?), et quelle est la taille maximale ?
> 10. `parsing=true` : quel moteur est utilisé, est-il soumis à une option
>     contractuelle, est-il synchrone, et **modifie-t-il les champs de la fiche
>     candidat** ? Quel est son comportement si `parsing` est omis ?
> 11. L'enchaînement `temporary=true` puis `tmpFile` à la création du candidat
>     est-il supporté et recommandé ?
>
> **Positionnements**
> 12. Le serveur empêche-t-il deux positionnements du même candidat sur la même
>     opportunité ?
> 13. Quelle est la valeur par défaut de `sendMailToDependsOnManager` et de
>     `sendMailToOpportunityManager` ? Quels états déclenchent des effets de bord
>     (création de projet pour `won`, notifications, autres) ?
>
> **Validation**
> 14. Vos schémas déclarent `additionalProperties: false`, mais des attributs non
>     conformes semblent acceptés avec une réponse 200 puis ignorés. Est-ce le
>     comportement attendu ? Existe-t-il un moyen (en-tête, `meta`, mode strict)
>     de savoir qu'un attribut a été ignoré ?
> 15. Quel brouillon JSON Schema (draft-04, 07, 2019-09…) vos schémas
>     suivent-ils ? Existe-t-il un index public ou une politique de versionnement
>     des schémas, pour détecter un changement ?
>
> **Opportunités**
> 16. La lecture d'une opportunité peut-elle inclure la raison sociale de la
>     société et le contact (`included`), ou faut-il des appels séparés ? Quelle
>     est l'unité de `duration`, et que signifient les valeurs 1 à 4 de `mode` ?
>
> Merci par avance.

### 9.2 Questions internes (au DO, et au client)

- **A.** Le déclencheur : **GO définitif**, comme recommandé au §6.1, ou
  acceptation ? Le délai de rétractation de 15 min vous convient-il ?
- **B.** Un candidat **déjà présent** dans Boond : on ne modifie jamais son
  identité, et on ajoute CV, note et positionnement (§3.2). Le client
  souhaite-t-il au contraire que le téléphone manquant soit complété ?
- **C.** Campagne liée **après** des GO : pas de rattrapage automatique, seulement
  le geste manuel par candidat (§6.2). À confirmer.
- **D.** Une table `ats_campaign_links` plutôt que la colonne
  `campaigns.boond_opportunity_id` (§4.1). À confirmer.
- **E.** L'URL LinkedIn d'un candidat sourcé part-elle dans
  `socialNetworks` ? Le profil sourcing est supprimé à la clôture, mais Boond, lui,
  le conserverait.
- **F.** Faut-il faire figurer l'identifiant `CAND<id>` dans le rapport de purge
  RGPD (§4.3) ? Question pour le DPO.
- **G.** Le DPA du client : la ligne « BoondManager — destinataire » est-elle
  ajoutée avant la mise en service ?
