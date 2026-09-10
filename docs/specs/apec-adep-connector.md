# Connecteur APEC ADEP V5

> **Statut au 09/09/2026 : lots 0 à 4 LIVRÉS, et le PREMIER APPEL RÉEL a
> abouti** en environnement de test (§6quinquies). La PRODUCTION a été sondée en
> lecture seule le même jour : son WSDL concorde, mais elle exige des paramètres
> Argon2 dédiés (§6quinquies.3). Le connecteur tourne en mode simulation tant
> que `ADEP_ENABLED` n'est pas posé, et il le dit à l'écran. Mise en service :
> `docs/ops/apec-mise-en-service.md`.
>
> Les sections 0 à 6 restent l'ÉTUDE telle qu'elle a été rendue avant tout code
> (Phase 1) : elles disent ce que la documentation contient et ce qu'elle
> contredit, et c'est à ce titre qu'on les relit. Ce que le code a appris ensuite
> est en §6bis et §6ter, jamais réécrit par-dessus l'étude.
>
> Sources lues : `docs/apec/dsiapec-ADEP - Spécifications-techniques.docx` (v1.0.12,
> modifiée le 17/06/2026), `docs/apec/dsiapec-ADEP - Catalogue des erreurs.pdf`
> (+ version anglaise), `docs/apec/apec-adep-nomenclature.xlsx`, et les 12 exemples
> de flux SEP/SIDES. **Le `ADEP-V5-Recapitulatif.md` mentionné au brief n'existe
> nulle part dans le dépôt** — les points ci-dessous confirment ou corrigent ce que
> le brief énonce comme étant son contenu.

---

## 0. Ce qui change par rapport au récapitulatif

Cinq corrections, par ordre de conséquence.

**0.1 — Le hachage : Argon2 confirmé, mais la longueur est 256 OCTETS, pas 256 bits.**
Le code Java de la spec alloue `new byte[256]` avec un commentaire faux
(`// 32 bytes = 256 bits`) ; le code Python, lui, est sans ambiguïté :
`hash_len=256`. Deux implémentations indépendantes qui disent la même chose contre
un commentaire qui dit l'inverse : c'est 256 octets. L'`atsPassword` est donc une
chaîne base64 **sans padding de 342 caractères**, pas les 64 ou 128 caractères
qu'on attendrait d'un condensat ordinaire.

**0.2 — Il n'y a AUCUN vecteur de test dans la documentation.** Le brief demande de
tester le calcul Argon2 « contre l'exemple de la doc ». Cet exemple n'existe pas :
la spec fournit deux bouts de code, jamais un couple (mot de passe, sel) → clé
attendue. Pire, le seul `atsPassword` littéral du document
(`<atsPassword>6e32e2…f5128</atsPassword>`, §IV) fait **128 caractères
hexadécimaux** — c'est un reliquat SHA-512 de la V4, comme les placeholders
`PASSWORD_SHA_512` qui traînent dans les quatre exemples de flux. Ce ne sont pas
des contre-exemples, ce sont des restes. Conséquence pratique : la seule
vérification possible avant le premier appel réel est de **croiser deux
implémentations** (Node et `argon2-cffi` en Python, sur les mêmes paramètres) et de
constater qu'elles produisent le même octet. La validation finale est l'appel à
l'environnement de test — une clé fausse rend `API_102_ATS_PASSWORD_INVALID_ERROR`,
qui est un diagnostic net.

**0.3 — Le sel reçu par mail est en base64 et doit être DÉCODÉ avant usage.** Les
deux implémentations de la spec appellent `b64decode(salt)` avant de le passer à
Argon2. Le passer en UTF-8 brut donnerait une clé silencieusement fausse. Le
Python complète même le padding manquant (`salt + "=" * ((4 - len(salt) % 4) % 4)`)
— le mail d'Apec envoie donc vraisemblablement un sel base64 sans padding.

**0.4 — L'espace de noms des requêtes était incertain. ✅ TRANCHÉ PAR LE WSDL.**
Les exemples fournis ne concordaient pas :

| Fichier | Espace de noms |
|---|---|
| `sep_openPositionRequest.xml` | `https://adep.apec.fr/hrxml/sep` ❌ |
| `sep_getPositionStatusRequest.xml` | `https://adep.apec.fr/hrxml/sep` ❌ |
| `sep_getPositionRequest.xml` | `http://adep.apec.fr/hrxml/sep` ✅ |
| toutes les réponses | `http://adep.apec.fr/hrxml/sep` ✅ |

Le WSDL de test (`docs/apec/adepsep-test.wsdl`, première ligne) tranche :

```xml
<wsdl:definitions … xmlns:tns="http://adep.apec.fr/hrxml/sep"
                    name="AdepSepService"
                    targetNamespace="http://adep.apec.fr/hrxml/sep">
```

**En HTTP.** Les deux exemples de requête en HTTPS sont faux. Ce n'était pas un
détail : vérifié en soumettant un flux en `https://` aux schémas réels via
xmllint, il est REJETÉ (« No matching global declaration available »), ce qui se
serait manifesté chez l'Apec en `API_023_VALIDATION_XML_ERROR` — une erreur qui
ne dit pas laquelle des cinquante balises est en cause. La constante vit dans
`src/lib/jobboards/adep/namespaces.ts` avec la citation du WSDL, et un test la
compare au fichier réel plutôt qu'à une valeur recopiée.

⚠️ Le WSDL de PRODUCTION n'a toujours pas été vu. `adep:probe` compare le
`targetNamespace` réellement servi par l'endpoint configuré à la constante et
refuse de continuer s'ils diffèrent.

**0.5 — Le signal « J+30 » n'est pas ce que le brief suppose.** Ce n'est pas une
péremption de l'annonce, c'est une **fenêtre de republication** :
`API_361_INVALID_PUBLICATION_DELAYS` — « Votre offre a été publiée il y a plus de
30 jours. Elle ne peut pas être republiée. » Une offre suspendue au-delà de 30
jours après sa publication initiale est donc **définitivement suspendue** : plus
aucun geste ADEP ne la remet en ligne. Cela change le message et le moment du
signal (§6.4). À noter aussi : `API_362` interdit la republication des offres
cadre du secteur public, quelle que soit la date.

---

## 1. La documentation, telle qu'elle est

### 1.1 Accès

| | SEP |
|---|---|
| Test | `https://testadepsep.apec.fr/v5/positions?wsdl` |
| Production | `https://adepsep.apec.fr/v5/positions?wsdl` |

SOAP sur HTTP, UTF-8, messages synchrones. Langue : `fr` uniquement. Devise : EUR
uniquement (le `currencyCode` est ignoré de toute façon).

### 1.2 Authentification

Bloc `authentication` sur **tous** les services :

| Champ | Contenu | Origine |
|---|---|---|
| `atsId` | identifiant du multi-diffuseur | fourni par l'Apec, **un pour ORQA** |
| `numeroDossier` | identifiant du recruteur (ex. `100248886W`) | fourni par l'Apec, **un par recruteur** |
| `atsPassword` | clé Argon2id | calculée par nous |

Le brief a raison sur le stockage : `atsId` est une constante d'installation
(variable d'environnement), `numeroDossier` désigne une **personne physique**
(« le recruteur est le destinataire des candidatures générées sur son offre ») et
appartient donc à la fiche recruteur. Un exemple de flux porte le placeholder
`EMAIL_INTERLOCUTEUR` au lieu de `NUMERO_DOSSIER_INTERLOCUTEUR` — c'est une
coquille, le tableau normatif du §IV dit « Identifiant de l'interlocuteur (ou
recruteur) fourni par l'Apec. Exemple : 123456789W ».

Paramètres Argon2 :

| | Valeur | Source |
|---|---|---|
| Variante | Argon2**id** | constante |
| Mémoire | 4096 (Kio) | constante |
| Version | 19 (0x13) | constante |
| Longueur de sortie | **256 octets** | code de la spec (§0.1) |
| Encodage de sortie | base64 **sans padding** | code de la spec |
| Itérations | *reçu par courriel* | par partenaire |
| Parallélisme | *reçu par courriel* | par partenaire |
| Sel | *reçu par courriel*, **base64 à décoder** | par partenaire |

Le mot de passe lui-même est choisi par le contact du cabinet lors de
l'initialisation (premier mail Apec) ; le second mail apporte sel et paramètres.
La clé étant **constante** pour un triplet (mot de passe, sel, paramètres), elle se
calcule une fois et se stocke telle quelle : d'où `ADEP_ATS_PASSWORD_HASH` en
variable d'environnement, et **aucune dépendance Argon2 dans le runtime de
l'application** (§5.4).

### 1.3 Transactions et acquittement

`UniquePayloadTrackingId` : généré par nous, **différent à chaque requête**
(`API_108_ID_TRANS_NOT_UNIQUE_ERROR` sinon), ≤ 100 caractères alphanumériques.
Caractères interdits : `?|,=<>:"[]\/(){}!;'` + les backticks, `@#$~+*&^`, plus tous
les caractères de contrôle (U+0000–U+001F, U+007F–U+009F). La spec recommande
`<idPartenaire>-<timestamp>`. Attention : **le tiret est autorisé, les deux-points
ne le sont pas** — un ISO 8601 comme identifiant est donc exclu, il faut un
epoch en millisecondes.

L'acquittement (`AcknowledgeType`) se lit ainsi :

- `PayloadResponseSummary.UniquePayloadTrackingId` renvoie **notre** identifiant —
  c'est un contrôle de corrélation gratuit, on le vérifie.
- `PayloadDisposition` contient **une liste** d'`EntityDisposition`, une par entité
  analysée. Chacune porte **soit** `<EntityNoException>true</EntityNoException>`,
  **soit** un `<EntityException>` avec un ou plusieurs `<Exception>` :
  `ExceptionIdentifier` (le code, ex. `330`), `ExceptionSeverity`
  (`Informational` | `Warning` | `Fatal`), `ExceptionMessage` (le nom, ex.
  `API_330_CLIENT_INDIRECT_ACCESS_ERROR`).
- **Règle de lecture, mot pour mot :** « Un acquittement contenant pour chaque
  entité `EntityNoException:true`, ou des exceptions de sévérité inférieure à
  Fatal, sera considéré comme étant un succès. Par contre une exception `Fatal`
  annulera **toute** transaction réalisée par le web service. »

Donc : **la présence d'un seul `Fatal` où que ce soit = échec de la transaction
entière**, rien n'a été créé. C'est le verdict, pas un compte d'entités en erreur.

Il existe un **second** chemin d'échec, distinct : la *faute de service* SOAP
(`soap:Fault`), pour les erreurs bloquantes qui n'atteignent même pas la couche
métier. Les deux doivent être traités, et distingués dans le journal — une faute
SOAP ne dit rien sur l'offre, un acquittement Fatal dit précisément quel champ est
en cause.

### 1.4 Cycle de vie d'une offre

```
                openPosition
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
   « A VALIDER »              « PUBLIEE »          (contrôle juridique passé
   (attente consultant)            │                ⇒ publication directe)
        └──────────►───────────────┤
                                   │ updatePositionStatus(SUSPENDUE)
                                   ▼
                             « SUSPENDUE »
                                   │ updatePositionStatus(PUBLIEE)
                                   │   ⚠ refusé si > 30 j après publication (361)
                                   │   ⚠ refusé pour le cadre public (362)
                                   ▼
                             « FERMEE »  ← état terminal, plus aucune action
```

Domaine `STATUT_OFFRE_DOMAIN` : `PUBLIEE`, `SUSPENDUE`, `AMODIFIER`, `AVALIDER`,
`FERMEE`. Les deux seules transitions offertes par `updatePositionStatus` sont
« dépublier » et « republier ».

`updatePosition` **existe encore dans le WSDL mais ne fait rien**
(`API_398_UPDATE_POSITION_NOT_AVAILABLE`). Le contenu d'une offre publiée n'est
modifiable que sur `www.apec.fr` ou par mail à `supportadep@apec.fr`. La décision
« contenu figé à la publication » du brief est donc la seule possible, et elle doit
être **dite à l'écran** (§6.3).

### 1.5 Services utiles

| Service | Usage ORQA |
|---|---|
| `openPosition` | publier |
| `getPositionStatus` | statut + `isEditable` + **URL publique de l'offre** |
| `updatePositionStatus` | dépublier / republier |
| `getPosition` | relire l'offre telle qu'Apec la détient (diagnostic) |
| `listRecruiterPositionOpenings` | inventaire par recruteur (réconciliation) |
| `updatePosition` | *désactivé, ne pas appeler* |

`getPositionStatus` accepte `clientPositionId` **ou** `apecPositionNumero` (au
moins l'un des deux ; si les deux sont fournis et divergent, c'est une erreur).
Ce détail est ce qui rend la reprise après incident possible — voir §3.3.

---

## 2. Mapping campagne → offre SEP

### 2.1 La structure, champ par champ

Ce que produit `openPositionRequest` en SEP, avec la provenance ORQA. `⛔` = ORQA
ne possède pas la donnée aujourd'hui.

**`authentication`**

| Élément | Contrainte | Provenance |
|---|---|---|
| `atsId` | — | `ADEP_ATS_ID` (env) |
| `numeroDossier` | — | ⛔ fiche recruteur (référent de campagne), chiffré |
| `atsPassword` | — | `ADEP_ATS_PASSWORD_HASH` (env) |

**`UniquePayloadTrackingId`** — `idOwner="CLIENT"`, ≤ 100 car., unique par
requête. Généré : `orqa-<campagne>-<epoch ms>`.

**`position` / `PositionSupplier@relationship`** — `self` (client direct) ou
`broker` (client indirect). ⛔ réglage cabinet.

**`position` / `PositionProfile`**

| Élément | Contrainte | Provenance |
|---|---|---|
| `@xml:lang` | `fr` | constante |
| `ProfileId/IdValue` | **≤ 20 car., unique chez Apec** | `CAMP-YYYY-NNN` (13 car.) — voir §3.2 |
| `ProfileName` | `APEC` | constante |
| `PositionDateInfo` | exigé par le schéma, **ignoré** par ADEP | élément vide |
| `Organization` | 1 seul | §2.2 |
| `PositionDetail` | | ci-dessous |
| `FormattedPositionDescription` × n | | ci-dessous |
| `HowToApply/ApplicationMethod/InternetEmailAddress` | ≤ 240 car. | `resolveCampaignReceptionAddress(campaignId)` — **la boîte IMAP de la campagne** |
| `HowToApply/…/InternetWebAddress` | ≤ 2000, **interdit en ODC** (1336) | optionnel, vide |
| `HowToApply/PersonName` | facultatif, mais **tout ou rien** | non renseigné en v1 |
| `NumberToFill` | **entier 1–10** | ⛔ formulaire, défaut 1 |

**`PositionDetail`**

| Élément | Contrainte | Provenance |
|---|---|---|
| `IndustryCode@classificationName="INSEE"` | code NAF, ≤ 5 car., obligatoire | ⛔ réglage cabinet |
| `PhysicalLocation` #1 | `Name=LOCATION_CODE`, `Area@type="INSEE"` = code commune | ⛔ formulaire (dérivé du site / de `location`) |
| `PhysicalLocation` #2 | `Name=LOCATION_ZONE_DEPLACEMENT`, `Area@type="APEC"` ∈ {`AUCUN`,`DEPARTEMENT`,`REGIONAL`,`NATIONAL`,`UE`,`HORS_UE`} | ⛔ formulaire, défaut réglage |
| `PositionTitle` | ≤ 80 car., **doit contenir « H/F »** (ajouté par Apec si ≤ 76) | FDP `job_title` + suffixe |
| `PositionClassification` | ignoré | omis |
| `Competency@name="GLOBAL_EXPERIENCE_LEVEL"` → `CompetencyEvidence/StringValue` | `NIVEAU_EXPERIENCE_DOMAIN` (1–12) | ⛔ dérivé de `seniority`, **confirmé par un humain** |
| `Competency@name="INTERNATIONAL_PROFILE"` | présent vide dans l'exemple | élément vide, comme l'exemple |
| `RemunerationPackage/BasePay/BasePayAmountMin` | entier ≤ 9 chiffres, en € | ⛔ parsé de `salary_range`, **confirmé** |
| `RemunerationPackage/BasePay/BasePayAmountMax` | idem, obligatoire pour un emploi | ⛔ idem |
| `UserArea/StatusJob` | `CADRE_PRIVE` \| `CADRE_PUBLIC` \| `AGENT_DE_MAITRISE` (\| `STAGE`) | ⛔ formulaire, défaut réglage |
| `UserArea/DisplayedPay` | `SALAIRE_TEXTE_DOMAIN` 1–6 | ⛔ formulaire, défaut réglage |
| `UserArea/JobType` | `TYPE_CONTRAT_DOMAIN` | dérivé de `contract_type` — **incomplet, §2.3** |
| `UserArea/PartTime` | booléen, obligatoire | ⛔ formulaire, défaut `false` |
| `UserArea/PartTimeDuration` | `TEMPS_PARTIEL_DUREE_DOMAIN`, obligatoire si temps partiel | ⛔ formulaire |
| `UserArea/Duration` | mois — obligatoire en CDD/intérim/stage, **interdit en CDI** (397) | ⛔ formulaire |
| `UserArea/RemoteWork` | `PONCTUEL_AUTORISE` \| `PARTIEL_POSSIBLE` \| `TOTAL_POSSIBLE` | ⛔ formulaire, facultatif |
| `UserArea/DatePositionTaken` | ≥ aujourd'hui | FDP `start_date` (si future) |
| `UserArea/ReleaseDate` | ≥ aujourd'hui, ≤ +60 j, < prise de poste | ⛔ formulaire, facultatif |
| `UserArea/UrlVideo` | YouTube/Vimeo/Dailymotion | ⛔ facultatif |

**`FormattedPositionDescription`** — paires `Name`/`Value`. La prose de la spec dit
« trois occurrences obligatoires » ; son propre tableau en liste **cinq**
obligatoires, et l'exemple officiel en envoie cinq. Le tableau et l'exemple
l'emportent.

| `Name` | Obligatoire | Longueur | Provenance |
|---|---|---|---|
| `POSITION_TYPE` | oui | `ODD` \| `ODC` | ⛔ formulaire, défaut `ODD` |
| `POSITION_DESCRIPTION` | oui | **200 – 3000** | annonce validée (corps) |
| `PROFILE_DESCRIPTION` | oui | **100 – 3000** | FDP (missions + compétences) |
| `ORGANIZATION_DESCRIPTION` | oui | **100 – 3000** | ⛔ réglage cabinet |
| `ORGANIZATION_NAME` | oui | ≤ 255 | `interviewConfig.organisationName` |
| `POSITION_DISPLAY_LOGO` | oui | `true` \| `false` | ⛔ réglage cabinet |
| `PRESENTATION_DESCRIPTION` | non | ≤ 500 | ⛔ facultatif |
| `RECRUITMENT_DESCRIPTION` | non | ≤ 500 | ⛔ facultatif |

Chaque nom ne doit apparaître **qu'une fois** (erreurs 1408–1412). Balises HTML de
mise en forme simple tolérées (gras, italique, souligné, retour chariot, puces) —
l'exemple officiel utilise `<br/>` dans un `CDATA`.

### 2.2 Le bloc client réel (mode indirect)

C'est le mode cible du cabinet, même si le compte de test est en direct. Il est
prévu dès maintenant :

- **Direct** (`relationship="self"`) : `Organization` ne porte qu'un
  `ContactInfo/ContactMethod/InternetEmailAddress` **facultatif** (≤ 120 car.) ; à
  défaut, Apec utilise le courriel par défaut de l'interlocuteur. Autrement dit :
  en direct, `Organization` peut être un élément **vide** — c'est exactement ce que
  fait l'exemple officiel.
- **Indirect** (`relationship="broker"`) : `Organization` porte le **client réel** et
  doit être fourni intégralement :

  | Élément | Contrainte |
  |---|---|
  | `OrganizationName` | **≤ 38 caractères** |
  | `LegalId` `idOwner="INSEE"` / `IdValue` | SIRET, **14 chiffres**, un seul |
  | `IndustryCode@classificationName="INSEE"` | NAF du client réel, un seul |

  ⚠️ **`OrganizationName` (38 car.) et `ORGANIZATION_NAME` (255 car.) sont deux
  champs différents** : le premier est la raison sociale qui sert à retrouver
  l'entreprise dans la base Apec, le second est l'enseigne affichée sur l'annonce.
  Les confondre donne `API_1373_MORE_THAN_ONE_ENTREPRISE_ERROR` ou
  `API_1372_ENTREPRISE_DIRECTE_NOT_FOUND_ERROR`, deux erreurs qui renvoient au
  support et non à un champ.

  Le mode indirect n'est ouvert qu'aux conventions Cabinets / ETT / PRISME
  (`API_330` sinon), et il est **incompatible avec l'intérim**
  (`API_1398_SEP_ORGANIZATION_CONTRACT_TYPE_ERROR`). Il ne permet pas non plus deux
  adresses distinctes (intermédiaire + client réel) : une seule.

### 2.3 Les traductions qui ne tombent pas juste

Trois endroits où ORQA a une donnée mais où elle ne se convertit pas toute seule.
Aucun ne doit être deviné en silence.

**Type de contrat.** `TYPE_CONTRAT_DOMAIN` : 1 CDI · 2 CDI-alternance-apprentissage
· 3 CDI-alternance-professionnalisation · 4 CDI intérimaire · 5 CDD ·
6 CDD-alternance-apprentissage · 7 CDD-alternance-professionnalisation ·
8 mission d'intérim · 9 stage.

| ORQA `contract_type` | Apec |
|---|---|
| `CDI` | 1 |
| `CDD` | 5 |
| `stage` | 9 |
| `intérim` | 8 |
| `apprentissage` | **2 ou 6** — base CDI ou CDD, ORQA ne le sait pas |
| `alternance` | **2, 3, 6 ou 7** — ni la base, ni le type de contrat |
| `freelance` | **aucun équivalent** |
| `portage salarial` | **aucun équivalent** |
| `CDI de chantier` | **aucun équivalent** |

De plus, le champ ORQA est **multi-valeur** (« CDI ou CDD ») alors qu'Apec n'accepte
qu'une valeur. Conclusion : le type de contrat est **un choix du formulaire de
publication**, pré-sélectionné quand la correspondance est certaine, à trancher
sinon, et **bloquant** pour les trois contrats sans équivalent (message explicite :
« l'Apec ne diffuse pas ce type de contrat », pas une erreur 320 renvoyée trois
secondes plus tard).

**Niveau d'expérience.** `seniority` vaut `junior | confirmé | senior` ;
`NIVEAU_EXPERIENCE_DOMAIN` va de « tous niveaux acceptés » à « minimum 10 ans » en
douze crans. La conversion est une perte d'information dans les deux sens.
Proposition affichée, humain qui confirme : junior → 2 (aucune expérience exigée),
confirmé → 5 (minimum 3 ans), senior → 7 (minimum 5 ans).

**Salaire.** `salary_range` est du texte libre (« 45–55 k€ », « selon profil »).
Apec veut deux entiers en euros **et** un mode d'affichage
(`SALAIRE_TEXTE_DOMAIN`). Le montant est converti en k€ arrondis au millier et
**n'est pas affiché** — il sert à la recherche d'offres. On propose un couple
parsé, l'humain confirme ; si le texte ne se parse pas, les deux champs sont vides
et bloquants (le mode « à négocier » (3) reste possible côté affichage, mais les
montants restent obligatoires pour une offre d'emploi).

**Lieu.** `location` est du texte libre ; Apec veut un **code commune INSEE**, et
une seule ville. Trois pièges :
- Paris (75056), Lyon (69123) et Marseille (13055) sont **interdits**
  (`API_356`) — il faut l'arrondissement (75101…, 69381…, 13201…) ;
- le nombre de lieux ne doit pas dépasser `NumberToFill` (`API_324`) ;
- la Suisse est interdite (`API_364`/`365`).

Le code INSEE se saisit une fois sur le **site** (§2.4) et se surcharge par offre.

### 2.4 Où saisir ce qu'ORQA n'a pas

**Réglages du cabinet — une fois, dans `/settings`, nouveau bloc « Diffusion APEC »**

| Champ | Pourquoi ici |
|---|---|
| Code NAF du cabinet | ne change jamais |
| Description de l'entreprise (100–3000 car.) | texte de marque, réécrit rarement |
| Affichage du logo (oui/non) | politique de marque |
| Mode client (direct / indirect) | déterminé par la convention Apec signée |
| Zone de déplacement par défaut | défaut raisonnable, surchargeable |
| Statut du poste par défaut | idem |
| Mode d'affichage du salaire par défaut | idem |

**Fiche recruteur (`/settings` → recruteurs)**

| Champ | Note |
|---|---|
| `numeroDossier` Apec | **chiffré** via `encryptCredential` (AES-256-GCM, `MAILBOX_ENCRYPTION_KEY`) comme les identifiants IMAP. Un recruteur sans numéro ne peut pas publier — et on le dit dans le panneau, pas au moment de l'envoi. |

**Site (`/settings` → sites)**

| Champ | Note |
|---|---|
| Code commune INSEE | le site porte déjà `city` et `postalCode` ; le code INSEE est la clé qu'Apec attend, et il est stable. Surchargeable par offre. |

**Formulaire de publication (par offre, dans le panneau APEC)**

Type de contrat (+ durée), statut du poste, niveau d'expérience, salaire min/max +
mode d'affichage, temps partiel (+ modalité), nombre de postes, type d'offre
(ODD/ODC), commune INSEE, zone de déplacement, télétravail, date de prise de poste,
date de publication souhaitée, et — en mode indirect — le bloc client réel
(raison sociale ≤ 38, SIRET, NAF).

**Le client réel n'a pas d'entité dans ORQA.** Le « donneur d'ordre » est une
*personne*, le « site » est une implantation du cabinet : ni l'un ni l'autre ne
porte une entreprise cliente avec SIRET et NAF. Trois options :

1. **saisie par offre** — zéro modèle, ressaisie à chaque offre du même client ;
2. **table `apec_clients`** alimentée par le formulaire, proposée en autocomplétion
   ensuite — une table, un CRUD léger ;
3. étendre `sites` — mauvais : un site est une implantation du cabinet, y loger un
   client tiers rendrait le reporting par site faux.

**Recommandation : (1) en Phase 2** — le compte de test est en mode direct, le bloc
n'est même pas envoyé, et écrire un référentiel client avant d'avoir publié une
offre serait construire sur une hypothèse. (2) devient évidente à la deuxième offre
du même client ; elle se pose alors sans rien casser, le formulaire restant la
source.

---

## 3. Modèle de données

### 3.1 La table

```sql
create table if not exists public.job_postings (
  id                  text primary key,          -- JOBP-<slug>
  campaign_id         text not null references public.campaigns(id) on delete cascade,
  channel             text not null,             -- 'apec' (PUBLICATION_CHANNELS)

  -- Référence CLIENT : ≤ 20 car., unique chez Apec ET chez nous (§3.2).
  client_reference    text not null unique,

  -- Identité côté Apec, connue seulement après l'acquittement.
  apec_position_numero text,

  -- Notre transaction : réservée AVANT l'appel, jamais après (§3.3).
  attempt_state       text not null default 'reserved'
    check (attempt_state in ('reserved','sent','acknowledged','failed')),
  tracking_id         text,

  -- L'offre telle qu'elle est PARTIE. Figée, comme demo_job_posts.
  request_snapshot    jsonb,                     -- l'offre mappée, sans secret
  request_xml         text,                      -- le XML exact, atsPassword CAVIARDÉ
  ack_raw             text,                      -- l'acquittement brut, tel quel

  -- L'état chez Apec. Un CACHE, jamais une vérité locale (§3.4).
  remote_status       text,                      -- AVALIDER|PUBLIEE|SUSPENDUE|FERMEE|AMODIFIER
  remote_status_at    timestamptz,
  remote_is_editable  boolean,
  remote_url          text,

  published_at        timestamptz,
  suspended_at        timestamptz,
  closed_at           timestamptz,

  last_error_code     text,                      -- '330'
  last_error_message  text,                      -- 'API_330_CLIENT_INDIRECT_ACCESS_ERROR'

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table public.job_postings enable row level security;

create index if not exists job_postings_campaign_idx
  on public.job_postings (campaign_id, channel);
-- Le signal J+30 balaie les offres republiables : on indexe ce qu'il lit.
create index if not exists job_postings_live_idx
  on public.job_postings (remote_status, published_at)
  where remote_status in ('PUBLIEE','SUSPENDUE');
```

Migration d'état final idempotente, appliquée à la main, avec **double
application** avant tout déploiement (règle absolue).

Deux invariants portés par la structure elle-même :

- **`job_postings` n'entre JAMAIS dans le snapshot campagne.** Ni `campaignToRow`,
  ni le PUT `/api/campaigns`. C'est le piège déjà payé deux fois
  (`scheduling_native`, `demo_job_posts`) : un onglet ouvert avant la publication
  réécrirait son état périmé au premier autosave. Le type l'interdit à la
  compilation, sur le modèle de
  `CampaignSnapshot = Omit<ActiveCampaign,'schedulingNative'>`.
- **Plusieurs lignes par campagne sont possibles** (une republication après
  fermeture crée une nouvelle offre chez Apec, avec une nouvelle référence). D'où
  un `id` propre plutôt qu'une clé primaire `(campaign_id, channel)`.

### 3.2 La référence client est la clé d'idempotence

`ProfileId` ≤ 20 caractères, **unique chez Apec pour toujours** :
`API_390_MORE_THAN_ONE_REF_FOUND_ERROR` si elle est réutilisée. `CAMP-YYYY-NNN`
fait 13 caractères — largement dans la borne, et c'est la même chaîne que celle qui
voyage dans l'objet des mails de candidature, sur le jobboard de démonstration et
dans ORQA. Le fil de traçabilité reste entier, exactement comme pour le jobboard.

Une **republication après fermeture** exige une référence neuve : `CAMP-2026-288-2`
(15 car.), `-3`… jusqu'à `-999` (17 car.). Le suffixe est le rang de la ligne
`job_postings` pour cette campagne, calculé au moment de la réservation. C'est la
même idée que la génération `analysisId#r2` du module de réservation : ré-émettre
avec la clé d'origine rendrait fidèlement un refus.

### 3.3 Réservation avant l'appel — parce que `openPosition` n'est pas idempotent

Un double clic, un retry après timeout, deux instances serverless : trois façons de
créer deux offres chez Apec pour une même campagne. Le remède est celui déjà en
place pour l'outreach IMAP et les webhooks Cal.com — **la base est la seule chose
partagée entre instances** :

1. `insert` de la ligne `job_postings` en `attempt_state='reserved'`. La contrainte
   `unique(client_reference)` fait le verrou : le perdant sait qu'il a perdu.
2. Appel `openPosition`.
3. `attempt_state='sent'`, puis `'acknowledged'` avec le numéro Apec, ou
   `'failed'` avec le code d'erreur.

Et une reprise que la structure d'Apec offre gratuitement : **si l'appel casse sans
réponse lisible (timeout réseau), on ne rejoue pas `openPosition` — on appelle
`getPositionStatus(clientPositionId)`.** Soit l'offre existe et on récupère son
numéro et son statut, soit elle n'existe pas et on peut rejouer. De même, un
`API_390` en retour d'un rejeu ne signifie pas « échec » mais « elle est déjà
créée, va la lire ». C'est ce qui évite de laisser une offre orpheline chez Apec
qu'ORQA ignore et ne dépubliera jamais.

### 3.4 Le statut est un cache, jamais une vérité

`remote_status` est ce que `getPositionStatus` a dit, avec l'horodatage de la
lecture. Un consultant Apec peut valider, un recruteur peut modifier sur apec.fr :
ORQA ne l'apprend qu'en demandant. L'écran affiche donc toujours « statut au
*heure* », jamais un statut nu.

Rafraîchissement : à l'ouverture du panneau, et après chaque action. **Pas de
sondage périodique** — et surtout, `apec_offer_status_checked` **ne se journalise
que sur TRANSITION**, jamais à chaque lecture. C'est la leçon du 21/08 :
`imap_mailbox_skipped`, réécrite à chaque relève, a vidé le fil d'activité du
Bureau en évinçant 475 lignes sur 500. Le mécanisme est déjà en place
(`mailboxes.last_skip_reason`) et se transpose tel quel : la dernière valeur lue
est déjà dans `remote_status`, la comparaison est gratuite.

Journal (actions à inscrire **dans les deux registres** `ACTIVITY_RENDERERS` et,
si l'on veut les compter, `ACTION_TO_AGENT` — ils dérivent par `Object.keys`, une
liste tenue à côté finirait par diverger en silence) :
`apec_offer_published`, `apec_offer_publish_failed`, `apec_offer_status_changed`,
`apec_offer_suspended`, `apec_offer_republished`.

---

## 4. Validation locale avant envoi

Le principe : **un rejet Apec doit être l'exception**, parce qu'un rejet arrive
après coup, en anglais de code, devant un client. Toutes les règles ci-dessous
sont vérifiables sans réseau et appartiennent à un module **pur et testé**
(`src/lib/jobboards/adep/validate.ts`), qui rend une liste de problèmes ciblant
chacun un champ de l'écran.

### 4.1 Longueurs et bornes

| Champ | Règle | Erreur évitée |
|---|---|---|
| `ProfileId` | ≤ 20 car. | 309 |
| `UniquePayloadTrackingId` | ≤ 100 car., caractères interdits, unique | 105, 108 |
| `PositionTitle` | ≤ 76 sans « H/F », ≤ 80 avec | 316 |
| `POSITION_DESCRIPTION` | 200 – 3000 | 331, 332, 337 |
| `PROFILE_DESCRIPTION` | 100 – 3000 | 408 |
| `ORGANIZATION_DESCRIPTION` | 100 – 3000 | 407 |
| `PRESENTATION_DESCRIPTION` | ≤ 500 si présent | 409 |
| `RECRUITMENT_DESCRIPTION` | ≤ 500 si présent | 410 |
| `ORGANIZATION_NAME` | ≤ 255, non vide | 406 |
| `OrganizationName` (indirect) | ≤ 38 | 375 |
| `InternetEmailAddress` | ≤ 240, format valide, **non vide** | 308, 378, 379 |
| `NumberToFill` | entier 1 – 10 | 321 |
| `BasePayAmountMin/Max` | entiers, ≤ 9 chiffres, min ≤ max | 317, 318 |
| `LegalId` | 14 chiffres (+ clé de Luhn SIRET) | 310 |
| `IndustryCode` | ≤ 5 car., forme NAF `\d{4}[A-Z]` | 311 |

### 4.2 Lieux

- exactement **deux** `PhysicalLocation` : `LOCATION_CODE` et
  `LOCATION_ZONE_DEPLACEMENT` ;
- `Area@type` = `INSEE` pour le premier, `APEC` pour le second (354) ;
- zone ∈ `{AUCUN, DEPARTEMENT, REGIONAL, NATIONAL, UE, HORS_UE}` (355) ;
- **75056 / 69123 / 13055 refusés en local**, avec le message qui dit quoi faire :
  « Paris, Lyon et Marseille se publient par arrondissement » (356) ;
- une seule ville, et nombre de lieux ≤ `NumberToFill` (324) ;
- Suisse refusée (364, 365).

### 4.3 Cohérences

- CDI ⇒ **pas** de `Duration` ; CDD / intérim / stage ⇒ `Duration` **obligatoire**
  (397, 394) ;
- `PartTime=true` ⇒ `PartTimeDuration` obligatoire (400, 405) ;
- `ODC` ⇒ `InternetWebAddress` interdit (1336) ;
- `ReleaseDate` ≥ aujourd'hui, ≤ +60 j, et < `DatePositionTaken` (403) ;
- `DatePositionTaken` ≥ aujourd'hui (402) ;
- mode indirect ⇒ `Organization` complet **et** type de contrat ≠ intérim (1398) ;
- mode direct ⇒ `relationship="self"` (329/330 sont des refus d'habilitation, pas
  de format : on les traduit en « votre convention Apec n'autorise pas ce mode »).

### 4.4 Contraintes qui ne sont pas des longueurs

- `HowToApply/PersonName` : **tout ou rien** — civilité, prénom, nom, fonction
  ensemble ou aucun (404) ;
- chaque `FormattedPositionDescription` en un seul exemplaire (1408–1412) ;
- balises HTML : on **filtre** avant d'envoyer plutôt que de laisser Apec rejeter
  (338). L'annonce ORQA est du texte ; la conversion des retours à la ligne en
  `<br/>` et l'échappement du reste sont le seul traitement.

### 4.5 Validation XSD — correction du brief

Le brief demande « validation XSD locale contre les schémas du WSDL ». C'est
souhaitable et ce n'est pas raisonnable **dans l'application** : l'écosystème
TypeScript n'a pas de validateur XSD utilisable sans binding natif
(`libxmljs` demande une compilation C++, mal supportée sur Vercel), et la porter
au runtime coûterait plus qu'elle ne protège. Proposition en deux temps, honnête
sur ce qu'elle couvre :

- **dans l'application** : le validateur de règles ci-dessus. C'est lui qui évite
  les rejets réels — un XSD ne vérifie ni « 200 caractères minimum », ni
  « Paris interdit », ni « CDI sans durée ». Il n'attrape que la structure, que
  notre constructeur produit de toute façon ;
- **dans la commande `adep:probe`** : si `xmllint` est présent sur la machine de
  l'opérateur, valider le XML contre les XSD téléchargés depuis le WSDL, et le dire
  quand il est absent plutôt que de laisser croire à une vérification. Les XSD sont
  versionnés dans `docs/apec/xsd/` une fois récupérés.

---

## 5. Client SOAP

### 5.1 Construction du XML : à la main

Pas de génération depuis le WSDL, pas de bibliothèque SOAP. Trois raisons : le flux
est **plat** (une enveloppe, un corps, pas d'en-tête WS-Security, pas de MTOM), les
générateurs TypeScript rendent des types approximatifs sur du HR-XML à espaces de
noms multiples, et le brief demande de pouvoir **afficher le XML qui partirait** —
ce qu'un client opaque rend pénible. Un `buildOpenPositionXml(offer): string` pur
et testé sur les exemples officiels est plus court et plus lisible que
l'alternative.

Points d'attention : échappement XML systématique (les descriptions viennent d'un
LLM et d'un humain), `CDATA` pour les trois blocs de description comme dans
l'exemple officiel, et le respect strict des deux préfixes
(`ns2` = ADEP SEP, `ns3` = HR-XML CPO `http://ns.hr-xml.org/2006-02-28`) — car
`UserArea` mélange les deux : `<ns3:UserArea>` contenant `<ns2:StatusJob>`.

### 5.2 Lecture des réponses

`fast-xml-parser` (pur JS, sans dépendance native, ~50 ko). L'acquittement contient
une **liste** d'`EntityDisposition` dont le nombre varie ; le lire à la regex
serait exactement le genre de raccourci qui casse en silence sur la deuxième
exception. Le parseur doit être configuré pour **toujours** rendre des tableaux sur
`EntityDisposition` et `Exception` (sans quoi une occurrence unique arrive en
objet), et pour ignorer les préfixes d'espace de noms à la lecture.

Le parseur d'acquittement est **pur**, testé sur les exemples fournis et sur un
acquittement à exception `Fatal` recomposé depuis le §VI.2.2 de la spec. Il rend :

```
{ ok: boolean,
  trackingId: string | null,       // à comparer au nôtre
  apecPositionNumero: string | null,
  exceptions: [{ code, severity, message, xpath, entity }] }
```

`ok` est vrai si et seulement si **aucune** exception `Fatal` n'est présente. Les
`Warning` et `Informational` sont conservés et affichés — ce sont des remarques
utiles (« champ facultatif vide ») que l'on veut voir sans qu'elles bloquent.

### 5.3 Transport

`fetch` avec `AbortSignal.timeout(30_000)`, `Content-Type: text/xml; charset=utf-8`,
en-tête `SOAPAction` (valeur à lire dans le WSDL). Une seule tentative : `openPosition`
n'étant pas idempotent, un retry automatique est un doublon potentiel. Le rejeu est
un **geste humain**, informé par `getPositionStatus` (§3.3).

### 5.4 Secrets

- `ADEP_ATS_ID`, `ADEP_WSDL_URL`, `ADEP_ATS_PASSWORD_HASH`, `ADEP_ENABLED` :
  variables d'environnement, jamais `NEXT_PUBLIC_*`, jamais dans le dépôt.
- Le `numeroDossier` est chiffré en base (`encryptCredential`), déchiffré au moment
  de l'appel, jamais renvoyé au navigateur.
- **`request_xml` est stocké avec `<atsPassword>` remplacé par `[redacted]`**, et
  la fonction de caviardage s'applique aussi aux logs et aux messages d'erreur.
  Le `numeroDossier` est également caviardé : c'est un identifiant de personne.
- Le calcul Argon2 vit dans un **script**, pas dans l'application :
  `npm run adep:hash -- --env <fichier>` lit mot de passe, sel et paramètres depuis
  le fichier d'environnement et affiche la clé à recopier dans
  `ADEP_ATS_PASSWORD_HASH`. La dépendance Argon2 (`@node-rs/argon2`, qui expose
  `hashRaw` avec `outputLen` — les 256 octets sont indispensables) reste une
  **devDependency** : rien de nouveau ne part en production.

### 5.5 Traduction des erreurs

Une table `code → message français orienté action`, dérivée du catalogue, dans
`src/lib/jobboards/adep/errors.ts`. Le principe est celui du Manager : on ne montre
jamais `API_397_INVALID_CON_AND_DURATION_ERROR` au recruteur, on montre « un CDI ne
peut pas avoir de durée de contrat » **et** on ouvre le champ concerné. Les erreurs
qui ne sont pas de sa responsabilité (`002`, `100`, `312`, `399`, `1371`–`1373`)
disent « l'Apec doit intervenir » avec le code, pour le message au support. Le code
brut reste dans le journal, jamais perdu.

---

## 6. Panneau « APEC »

### 6.1 Où il vit

À côté d'« Annonce générique », dans la section **« Canaux de diffusion »** déjà
existante de la Sheet d'édition de campagne (`ChannelsEditBlock`). Ce bloc a déjà le
précédent : « le canal générique est le seul à déployer un panneau, parce qu'il
porte un CONTENU ». APEC est le second, pour la même raison. Aucune nouvelle route,
aucun nouvel onglet — la navigation reste homogène.

Le panneau se retire de lui-même quand `ADEP_ENABLED` est absent, sur le même
mécanisme que le jobboard : la route rend 404, le panneau rend `null`, le flag ne
voyage jamais jusqu'au navigateur.

### 6.2 Avant publication

```
┌─ APEC ────────────────────────────────────── non publiée ─┐
│                                                            │
│  Recruteur référent   Sami B.  ·  dossier Apec ✓           │
│  Référence            CAMP-2026-288                        │
│  Candidatures vers    recrutement@cabinet.fr               │
│                                                            │
│  ── L'annonce ────────────────────────────────────────────  │
│  Intitulé      [ Consultant AMOA Trade Finance H/F     ] 38/80
│  Descriptif    [ …                                     ] 1 240/3 000
│  Profil        [ …                                     ]   860/3 000
│  Entreprise    [ … (réglages du cabinet)               ]   410/3 000
│                                                            │
│  ── Ce que l'Apec demande en plus ────────────────────────  │
│  Contrat       ( CDI ▾ )        Durée   —  (sans objet)     │
│  Statut        ( Cadre privé ▾ )                            │
│  Expérience    ( Minimum 3 ans ▾ )   ← déduit de « confirmé »
│  Salaire       [45 000] à [55 000] €   Affiché ( X–Y k€ ▾ ) │
│  Lieu          ( Tours (37261) ▾ )   Déplacement ( Régional ▾ )
│  Temps partiel ( non ▾ )                                    │
│  Postes        [ 1 ]            Type   ( Offre standard ▾ ) │
│                                                            │
│  ⚠ Une fois publiée, l'annonce n'est plus modifiable       │
│    depuis ORQA. Toute correction passe par apec.fr ou par   │
│    le support Apec.                                         │
│                                                            │
│                              [ Vérifier ]  [ Publier ]     │
└────────────────────────────────────────────────────────────┘
```

Trois choses délibérées :

- **les champs déduits sont affichés déduits.** « Minimum 3 ans ← déduit de
  *confirmé* » : le recruteur voit d'où vient la valeur et peut la changer. C'est
  le geste du pré-remplissage par document, où une valeur suggérée doit être
  *traitée* avant de partir ;
- **« Vérifier » est distinct de « Publier ».** Il lance le validateur local et
  liste les problèmes, chacun cliquable vers son champ. Publier sans vérifier reste
  possible — la validation tourne de toute façon avant l'envoi — mais l'existence
  du bouton dit que la vérification est locale et gratuite ;
- **les préalables bloquants sont annoncés en haut, pas au moment de l'envoi** :
  recruteur sans numéro de dossier, campagne sans boîte associée, contrat sans
  équivalent Apec. Le bouton est désarmé et dit pourquoi.

Comme sur le jobboard, **le bouton se désarme dès le clic** : `openPosition` n'est
pas idempotent, deux clics feraient deux offres (la réservation en base rattrape,
mais on ne compte pas sur le filet).

### 6.3 Après publication

```
┌─ APEC ─────────────────────────────────── publiée · J+12 ─┐
│                                                            │
│  Numéro Apec    177596708W       Référence  CAMP-2026-288  │
│  Statut         Publiée          lu il y a 3 min  ↻        │
│  En ligne       apec.fr/…/177596708W  ↗                    │
│  Publiée le     26/08/2026 à 14:12                         │
│                                                            │
│  L'annonce n'est plus modifiable depuis ORQA. Pour la      │
│  corriger : apec.fr, ou supportadep@apec.fr.               │
│                                                            │
│  Republication possible jusqu'au 25/09/2026.               │
│                                                            │
│                                          [ Dépublier ]     │
└────────────────────────────────────────────────────────────┘
```

En `SUSPENDUE`, `[ Republier ]` remplace `[ Dépublier ]` — et **disparaît** passé
les 30 jours, avec la phrase qui explique : « la fenêtre de republication de l'Apec
est fermée depuis le 25/09 ; il faut créer une nouvelle offre ». Un bouton qui
échoue en silence ferait douter du reste de l'écran ; un bouton retiré sans
explication ne déplace pas le besoin, il le supprime.

En `AVALIDER` : « en attente de validation par un consultant Apec — aucune action
n'est possible d'ici là », qui est littéralement ce que dit la spec.

Le statut porte **toujours** son heure de lecture (§3.4).

### 6.4 Signal métier

Registre existant (`BUSINESS_SIGNALS`, une entrée `{ key, compute }`), cible
`{ route: '/rh/recrutement?tab=campagnes' }` — la variante `route` existe déjà pour
les signaux qui ne visent pas un onglet du workspace.

**`apec_republication_window_closing`** — offres `SUSPENDUE` dont la publication
date de plus de 23 jours : « 2 offres APEC suspendues ne pourront plus être
republiées après le 25/09. » S'éteint par construction (republiée, fermée, ou
fenêtre passée). Une semaine d'avance : assez pour agir, pas assez pour devenir du
bruit.

Je propose un **second** signal, qui me paraît porter plus de valeur métier que le
J+30 :

**`apec_offer_live_on_closed_campaign`** — offre `PUBLIEE` dont la campagne est
`closed`. C'est la vraie faute : des candidats postulent à un poste pourvu, et
reçoivent au mieux un classement sans suite. Il s'éteint dès que l'offre est
dépubliée.

### 6.5 Dépublication automatique à la clôture — proposition, pas décision

Le brief demande de proposer sans trancher. Voici les trois options telles qu'elles
se présentent :

1. **Dépublier automatiquement à la clôture.** Cohérent avec « poste pourvu », mais
   c'est une action *sortante et visible du public* déclenchée sans geste — et le
   projet a déjà renversé exactement cette règle pour les refus (« aucun refus n'est
   envoyé automatiquement »). Une clôture par erreur retirerait l'annonce d'apec.fr,
   et si la republication n'est plus possible (J+30), le retour arrière n'existe pas.
2. **Ne rien faire**, et compter sur le signal `apec_offer_live_on_closed_campaign`.
   Sûr, mais laisse l'offre en ligne le temps que quelqu'un voie le signal.
3. **Le proposer dans le dialogue de clôture.** `CampaignDismissFlowDialog` est déjà
   le passage obligé des trois chemins de clôture et énumère déjà ce qui va être
   fait ; y ajouter « dépublier l'annonce APEC (177596708W) » cochée par défaut est
   une ligne de plus dans un écran que le recruteur lit déjà, et le geste reste le
   sien.

**Je recommande (3)**, pour la même raison que le no-show ouvre un dialogue avant de
poser son marqueur : ce qui ressemble à un constat est en fait une décision, et
elle appartient à l'humain. Avec (3), le signal (2) reste utile — il rattrape les
campagnes clôturées avant l'arrivée du connecteur, et celles où la case a été
décochée.

---

## 6bis. Lot 0 — livré (08/09/2026)

Fondations posées avant toute UI. Six modules purs, testés, sans réseau ; aucun
n'est encore branché à une route.

| Fichier | Rôle |
|---|---|
| `src/lib/jobboards/adep/namespaces.ts` | espaces de noms + `SOAPAction` du WSDL, garde de cohérence |
| `src/lib/jobboards/adep/domains.ts` | nomenclature ADEP (9 domaines) |
| `src/lib/jobboards/adep/argon2.ts` | clé `atsPassword` (dépendance OPTIONNELLE) |
| `src/lib/jobboards/adep/xml.ts` | échappement, CDATA, affichage |
| `src/lib/jobboards/adep/build-open-position.ts` | flux SEP des 3 opérations + caviardage |
| `src/lib/jobboards/adep/parse-ack.ts` | acquittement et statut |
| `src/lib/jobboards/adep/errors.ts` | 96 codes → messages français |
| `src/lib/jobboards/adep/validate.ts` | règles métier, chacune portant son code |
| `src/types/adep.ts` | `AdepOffer`, acquittement, statuts |
| `scripts/adep-hash.ts` | `npm run adep:hash` |
| `scripts/lib/adep-xsd.ts` | validation XSD — HORS `src/`, sonde seulement |

**132 tests** (7 sautés quand `xmllint` est absent). Typecheck et build verts,
lint inchangé par rapport à la référence.

### 6bis.1 Argon2 — le croisement a eu lieu

`npm run adep:hash -- --cross-check`, sur un couple arbitraire :

```
  Node (@node-rs/argon2, Rust)          342 caractères  empreinte 2df25d49d3591fa4
  Python (argon2-cffi, C de référence)  342 caractères  empreinte 2df25d49d3591fa4
  ✅ CROISEMENT CONCORDANT
```

Deux implémentations indépendantes rendent le même octet. **Ce que cela prouve :**
notre paramétrage est conforme à ce que la spécification DÉCRIT. **Ce que cela
ne prouve pas :** ce que l'Apec ATTEND — il n'existe aucun vecteur de test
officiel, et le seul `atsPassword` littéral de la documentation (128 caractères
hexadécimaux, §IV) est un reliquat SHA-512 de la V4, comme les placeholders
`PASSWORD_SHA_512` des exemples de flux. La validation finale reste l'appel réel,
où une clé fausse rend `API_102_ATS_PASSWORD_INVALID_ERROR`.

**Découverte du lot 0 :** une sortie de 32 octets n'est **pas un préfixe** de
celle de 256 — Argon2 dérive une sortie de longueur N d'un seul bloc, changer N
change tout. Se tromper de longueur ne produit donc pas une clé tronquée mais une
clé entièrement fausse, et il n'y a aucun rattrapage possible sans recalcul.
D'où un contrôle DUR de la longueur (342 caractères) dans `adep:hash`.

La dépendance `@node-rs/argon2` est une **devDependency**, chargée par un
spécifieur indirect (`createRequire`) que le bundler de Next ne peut pas
résoudre au build. Sans cette précaution, la première route touchant à ce
fichier aurait fait échouer la compilation de production au lieu de dégrader
vers un message qui dit quoi faire.

### 6bis.2 Ce que les schémas ont appris — et que la prose ne disait pas

Les XSD sont **inline dans le WSDL** (aucun fichier à télécharger) : trois
schémas dans `<wsdl:types>` — ADEP SEP, HR-XML CPO, `xml:lang`. Tous les types
en jeu sont des `<xs:sequence>` : **l'ordre est imposé**, et le document de
spécifications, qui présente les champs en tableaux, n'en dit rien. Trois
conséquences qu'aucune lecture de la prose n'aurait données :

1. **`PositionDateInfo` est obligatoire.** C'est le seul enfant non optionnel de
   `PositionProfileType` — alors même que la spec le déclare « ignoré par ADEP ».
   Ses propres enfants étant tous optionnels, on l'émet **vide**. L'omettre
   invalide le document.
2. **`Education` se place entre `Competency` et `RemunerationPackage`.** La spec
   ne le mentionne qu'au chapitre « offre de stage », bien plus loin.
3. **Les enfants de `UserArea` doivent être hors HR-XML.** Le type est
   `<xs:any namespace="##other">` : d'où le mélange des deux préfixes dans un
   même bloc (`<hr:UserArea><sep:StatusJob>`). Ce n'était pas une coquetterie de
   l'exemple officiel, c'est le schéma qui l'exige.

Deux noms confirmés au passage : `newPositionStatus` (la spec l'imprime coupé
sur deux lignes) et l'`apecPositionNumero` de la réponse, déclaré
`minOccurs="0"` — il est donc **absent** quand rien n'a été créé, ce qui répond
en partie à la question 8.

Le WSDL révèle aussi un service `listDomainValues` : les domaines de valeurs
peuvent être LUS chez l'Apec. On ne s'en sert pas (une dépendance réseau sur le
chemin d'un formulaire), mais `adep:probe` est l'endroit naturel pour comparer
notre nomenclature à celle servie, le jour où l'on soupçonne une dérive.

### 6bis.3 Validation XSD — mesurée, et sondée

Le flux généré est **conforme aux schémas réels**, en mode direct comme en mode
indirect, vérifié par `xmllint` (validateur indépendant de notre code). Et le
contrôle mord : quatre altérations délibérées sont toutes détectées —
`PositionDateInfo` retiré, deux éléments permutés, un enfant de `UserArea` remis
dans HR-XML, l'espace de noms passé en `https`.

Le partage des rôles est net, et le lot 0 le démontre : soumise aux XSD, une
offre portant **neuf** fautes de gestion (Paris en commune globale, un CDI avec
durée, un descriptif de 23 caractères, aucune adresse de candidature…) est
déclarée **conforme**. Le XSD ne connaît que la structure ; c'est `validate.ts`
qui évite les rejets réels. Le XSD reste un filet lors d'une évolution du flux —
d'où sa place dans la sonde, jamais dans l'application.

### 6bis.4 Ce que les gardes ont trouvé pendant le lot

Trois défauts attrapés par les tests, pas par relecture :

- **les codes INSEE corses** (`2A004`, `2B033`) étaient refusés par un motif
  « cinq chiffres » — le validateur aurait bloqué des communes valides ;
- **`ERECRUT_STAGE_418_EDUCATION_LEVEL_ERROR`** est le seul code du catalogue à
  ne pas porter le préfixe `API_` : la lecture du code depuis le nom le rendait
  introuvable ;
- **l'affichage indenté cassait autour des CDATA** (tout le document partait en
  escalier à partir de la première description) — cosmétique, mais c'est ce que
  l'opérateur lit avant d'autoriser un envoi réel.

### 6bis.5 Reste du lot 0

Une chose n'a pas pu être faite ici et attend la sonde du lot 3 : **récupérer le
WSDL de production** — ✅ **fait le 09/09, il concorde** (§6quinquies.3). Le
WSDL de test est en place et fait autorité pour tout ce
qui précède ; la garde de cohérence de `adep:probe` (§6bis, `namespaces.ts`) est
écrite et testée, elle s'exécutera au premier appel réel.

---

## 6ter. Lots 1 à 4 — livrés (08/09/2026)

### 6ter.1 Le port, et où passe la couture

`JobBoardPublisher` (`src/lib/jobboards/types.ts`) connaît quatre gestes et cinq
issues. Il ignore l'Apec, le SOAP et les codes d'erreur : `AdepSepPublisher`
traduit avant de rendre la main.

**La couture du mock est au TRANSPORT, pas au publisher.** Un faux
`JobBoardPublisher` rendant des objets tout faits aurait donné une recette
d'écran verte sans qu'une seule ligne de construction XML, de lecture
d'acquittement ou de reprise ne s'exécute. En la plaçant au niveau du transport
(`AdepTransport`, une méthode), le mock ne fabrique que ce qui vient du réseau —
des chaînes XML enregistrées — et **tout le reste est le code de production**.
Corollaire assumé : le mock tient un ÉTAT, parce que l'Apec en tient un.

Cinq issues de publication, et la cinquième est celle qui compte :

| Issue | Sens | Rejeu automatique ? |
|---|---|---|
| `published` | créée à l'instant | — |
| `already_published` | elle existait, on est allé la lire | — |
| `rejected` | examinée et refusée, rien n'a été créé | après correction |
| `unavailable` | **vérifié** : rien n'existe | oui, tel quel |
| `uncertain` | **on ne sait pas** | **JAMAIS** |

Confondre `uncertain` et `unavailable` est exactement le raccourci qui
fabriquerait des doublons. C'est pourquoi ce sont deux issues et non un booléen.

### 6ter.2 La règle centrale, mesurée

**Jamais un second `openPosition`.** Trois chemins mènent à la même
réconciliation par référence client : transport en échec sans certitude, `API_390`
(« référence déjà prise » — ce n'est pas un échec, c'est la preuve que l'offre
existe), acquittement illisible. Le seul cas rejouable tel quel est
`certainlyNotSent` : la requête n'a pas quitté la machine.

Le test qui porte le lot compte les appels. Sondé en cassant délibérément la
règle : `expected 2 to be 1`. La garde mord.

⚠️ Un `API_390` dont la lecture ne retrouve RIEN n'est pas notre doublon : la
référence appartient à une offre qu'on ne voit pas. C'est alors un **vrai refus**
— il faut une référence neuve, pas une reprise.

### 6ter.3 Ce que le lot 2 a ajouté

- **Migration `job_postings`** (état final, idempotente, contrainte en bloc
  canonique) + `recruiters.adep_numero_dossier` (chiffré AES-256-GCM, mécanisme
  des identifiants IMAP) + `app_settings.adep_config` + **`sites.insee_code`**
  (l'Apec veut un code commune, pas un nom de ville).
- **La réservation est le verrou.** `reserveJobPosting` INSÈRE la ligne avant
  l'appel ; l'unicité de `client_reference` sérialise deux instances
  serverless. Un conflit **n'envoie rien** — testé.
- **Mapping campagne → brouillon** (`mapping.ts`, pur) : `certain` / `derived` /
  `missing`, chaque valeur portant sa provenance à l'écran. Une conversion qui
  se présenterait comme un fait ferait publier « minimum 3 ans » sur un poste
  ouvert aux débutants.
- **Panneau APEC** à côté d'« Annonce générique », dans le bloc « Canaux » ;
  « Vérifier » distinct de « Publier » ; bouton désarmé dès le clic ;
  avertissement d'immutabilité avant ET après.
- **Deux signaux métier** et la **case de dépublication** à la clôture.

### 6ter.4 Ce que les tests ont trouvé pendant le lot

Deux défauts réels, tous deux du genre qui ne se voit pas :

- **« 45 - 55 k€ »** — le `k` porte sur les DEUX bornes. En lisant « 45 » tel
  quel, il tombe sous le seuil de plausibilité, la fourchette s'écrase sur
  55 000 – 55 000, et le salaire minimum publié est faux. Rien ne le signale : le
  résultat reste un nombre crédible. C'est la forme la plus courante en français.
- **Le XSD recevait l'enveloppe au lieu du corps** — découvert en lançant la
  sonde en dry-run. Deux déclarations XML empilées, et un message qui parlait de
  syntaxe là où le problème était de périmètre.

Un troisième, attrapé par la revue de taille : la case « dépublier l'annonce
APEC » était à l'intérieur de la branche « il reste des candidatures ». Une
campagne sans candidature en cours mais avec une offre en ligne — le cas d'un
poste pourvu par une autre voie — ne l'aurait jamais vue.

### 6ter.5 Lot 3 — l'adaptateur réel et la sonde

`createHttpAdepTransport` : **une seule tentative, jamais de retry**, pour aucune
opération. C'est une différence assumée avec le provider LLM (`maxRetries: 4`) :
là-bas un rejeu coûte des jetons, ici il coûte une offre en double sur apec.fr.

`resolveTransport` est le point de fail-closed : sans `ADEP_ENABLED`, mode
simulation **annoncé** (`simulated: true`, l'écran le dit) ; avec le drapeau mais
sans `ADEP_WSDL_URL`, **échec franc** — retomber sur le mock rendrait un faux
succès sur une offre réelle.

`npm run adep:probe -- --env <fichier>` : dry-run par défaut. Elle dit à qui elle
parle, **vérifie le `targetNamespace` du WSDL réellement servi**, affiche la
LONGUEUR de la clé (jamais sa valeur), valide (règles puis XSD, en disant quand
`xmllint` manque), et montre le XML caviardé. `--execute` exige en plus la
recopie manuelle de l'`atsId`. Elle **n'écrit rien en base** : elle vérifie le
tuyau, elle ne publie pas une campagne.

**Garde structurelle** `no-real-calls.test.ts` (sondée) : aucun test n'importe la
sonde, seul son propre test touche au transport HTTP et il injecte `fetchImpl`,
aucun test ne pose `ADEP_ENABLED` sur le `process.env` réel.

### 6ter.6 Reste à faire, honnêtement

- ~~**Le WSDL de production n'a jamais été vu.**~~ ✅ **Vu le 09/09, il
  concorde** (§6quinquies.3).
- **Le bloc client réel (mode indirect) n'a pas de formulaire.** Il est construit,
  validé et testé de bout en bout ; l'écran ne le saisit pas encore, parce que le
  compte de test est en mode direct et que ce serait bâtir sur une hypothèse
  (§2.4). Le mode `broker` se choisit dans les réglages du cabinet — c'est le
  déclencheur naturel du formulaire, à ajouter quand la convention sera signée.
- ~~**Le corps de l'annonce n'est pas pré-rempli depuis le canal générique.**~~
  **Fait le 09/09** — §6quater.

---

## 6quater. Pré-remplissage depuis l'annonce générique (09/09/2026)

**Ce que le recruteur a validé ne se ressaisit pas.** Une campagne dont
l'annonce générique est publiée porte déjà un titre et un corps RELUS par un
humain ; ouvrir le panneau APEC devant deux zones vides lui demandait de
réécrire ce qu'il venait d'écrire — et deux textes rédigés séparément pour un
même poste finissent toujours par diverger.

### 6quater.1 Deux sources, jamais au même titre

`prefillFromJobPost` lit `demo_job_posts` à l'ouverture du panneau (fail-soft :
une installation qui n'a jamais activé la démonstration n'a pas la table, et un
panneau vide vaut mieux qu'un panneau en erreur). Une annonce **dépubliée** sert
quand même de source — `unpublishJobPost` retire l'annonce de la vitrine sans
effacer le texte, et ce qu'un humain a relu reste ce qu'il a relu — mais elle ne
se fait pas passer pour une annonce en ligne (`generic_unpublished`, et l'écran
l'écrit).

Le **repli** est `POST …/adep/draft-text` : le même chemin que le canal
générique (`executeJobWriter`, canal `generic`, mention RGPD déterministe),
mais **déclenché par un bouton**. Générer à l'ouverture écrirait à la place du
recruteur sans qu'il l'ait demandé, et le referait à chaque rechargement de
l'écran — un appel au modèle par coup d'œil. La route **n'écrit rien** et ne
dépend **pas** de `DEMO_JOBBOARD_ENABLED` : l'Apec est un canal réel, il n'a pas
à s'éteindre avec une démonstration commerciale.

La nuance entre les deux est portée jusque dans la provenance affichée : un
texte publié est un **fait** (`certain`), une pré-rédaction reste une
**proposition** (`derived`, « brouillon pré-rédigé, à relire »).

Le **titre** repris prime sur l'intitulé brut de la fiche de poste : « Comptable
général » côté fiche et « Comptable général confirmé » côté annonce coexistent
souvent, et publier deux libellés pour un même poste est précisément ce qu'on
cherche à éviter. Le **profil recherché**, lui, reste vide : l'annonce générique
n'a qu'un corps unique, et le découper au jugé pour remplir deux champs
fabriquerait du texte que personne n'a écrit.

### 6quater.2 Ni troncature, ni reformatage — on DIT

Le descriptif APEC est plafonné à 3 000 caractères et une annonce générique peut
les dépasser. Couper au caractère 3 000 rendrait une offre amputée en plein mot,
et — plus grave — **personne ne le saurait**. Le texte est donc recopié TEL QUEL
et l'écart est dit (`prefillIssues`), à charge du recruteur de raccourcir. C'est
« zéro troncature silencieuse » appliqué à un formulaire.

Même refus pour le Markdown : le corps générique porte des `##` et des `**` que
l'Apec affichera bruts. Les retirer serait réécrire un texte validé sur une
supposition de mise en forme ; on le **signale**, l'humain tranche.

⚠️ `prefillIssues` est **borné aux deux champs pré-remplis**. Faire tourner le
rapport complet à l'ouverture afficherait aussi le code INSEE manquant et le
statut du poste à trancher — des champs que personne n'a encore eu l'occasion de
saisir. Un écran qui crie avant qu'on ait touché à quoi que ce soit finit par ne
plus être lu.

Corollaire attrapé pendant le lot : le feu vert « prête à partir » ne peut plus
être donné par `issues.length === 0`, puisque des écarts s'affichent désormais
AVANT toute vérification. Un drapeau `verified` distingue « le rapport complet a
tourné » de « il n'y a rien à signaler sur le texte repris » — sans lui, un
simple avertissement de mise en forme aurait annoncé une offre prête que
personne n'avait validée.

### 6quater.3 Le snapshot APEC est distinct, et figé

Il n'y a **aucun lien vivant** entre l'annonce générique et l'offre Apec. Le
texte est repris à l'ouverture ; ce qui part est figé à SA publication, comme le
snapshot du canal générique l'est à la sienne. Modifier l'annonce générique
ensuite ne change rien à une offre déjà publiée — et le panneau le DIT
(`ADEP_PREFILL_SNAPSHOT_NOTICE`), avant comme après la publication. Sans cette
phrase, on corrigerait une coquille dans l'annonce générique en croyant corriger
les deux, et on découvrirait l'écart une fois l'offre en ligne, quand elle n'est
plus modifiable.

Le brouillon, lui, reste vivant : il reflète le texte du jour, c'est-à-dire ce
qu'on republierait. Un test de la route tient les deux bouts — l'offre partie ne
bouge pas, le brouillon suit.

**Sondes** (deux, toutes deux mordantes) : une troncature silencieuse dans
`prefillFromJobPost` fait tomber les deux tests de longueur ; un brouillon
construit sans le pré-remplissage en fait tomber trois.

### 6quater.4 « Inconnu » après un succès se lit comme un échec

Défaut trouvé en recette : le statut affiché juste après une publication
réussie disait « inconnu ». Cause : `openPosition` **acquitte**, il ne renseigne
pas l'état de l'offre — son acquittement ne porte qu'un numéro. La ligne était
donc écrite avec `remote_status = null`, et l'écran traduisait ce vide en
« inconnu », mot qui envoie chercher un problème inexistant.

Deux correctifs, et l'ordre compte :

1. **L'écran ne peut plus mentir.** `remote_status_at` distinguait déjà « jamais
   lu » de « lu et vide » ; la carte s'en sert : sans lecture, elle dit
   « créée — statut pas encore lu chez l'Apec » et renvoie au bouton. « Inconnu »
   ne subsiste que pour le cas où l'Apec a répondu SANS statut.
2. **Une lecture est enchaînée** après une création (`getPositionStatus`), pour
   que le cas nominal montre un statut daté plutôt qu'une attente.

Le second sans le premier n'aurait rien réglé : il suffit que la lecture échoue
— latence de propagation, réseau — pour retomber sur le vide. C'est le premier
qui tient la garantie ; le second améliore le cas nominal.

**Best-effort strict**, et deux filets qui ne couvrent pas la même chose :
`getStatus` rend un VERDICT pour tout ce qui est prévu (transport, faute SOAP,
référence inconnue) — d'où le test sur `found` ; le `catch` ne couvre que
l'imprévu. Une lecture ratée ne doit JAMAIS emporter une publication réussie :
l'offre existe chez l'Apec, son numéro est en base, et perdre cette vérité
ferait reposter une SECONDE offre à la reprise.

Sonde : faire lever la lecture non aboutie fait tomber le test. ⚠️ Une première
version du test passait sans rien prouver — il injectait une panne
`kind: 'transport'` qui n'existe pas dans le mock (`timeout | not_sent |
respond`), donc aucune panne n'était injectée. C'est le typecheck qui l'a dit,
et la sonde qui l'a confirmé : un test vert qui ne mord pas ne prouve rien.

### 6quater.5 Deux boutons qui « ne font rien » — deux causes, aucune commune

Recette : « Relire le statut » et « Dépublier » restaient sans effet, en
silence. Deux défauts empilés, indépendants, et le second vaut aussi en RÉEL.

**(1) La simulation était amnésique.** `resolveTransport` construisait un
`new MockAdepTransport()` **vierge à chaque requête HTTP**. L'offre publiée à la
requête précédente n'existait donc plus pour la suivante : `getPositionStatus`
rendait `not_found` (aucun patch, écran figé) et `suspend` rendait `refused`.
Le mock tient un état — c'est délibéré, l'Apec en tient un — mais son état ne
survivait pas à la requête.

⚠️ **Les tests ne pouvaient pas le voir** : ils injectent la MÊME instance du
début à la fin, ce que la vraie vie ne fait jamais. Le correctif amorce le mock
depuis `job_postings` (`mockSeedFromPosting`), et non depuis un singleton de
process : entre deux invocations serverless, seule la base est partagée — un
singleton mentirait exactement de la même façon, une instance plus tard. Le
statut absent du cache est DÉDUIT des dates (`suspendedAt` / `publishedAt`)
plutôt que de laisser le mock ignorer une offre qui existe ; sans numéro Apec,
aucun amorçage — prétendre le contraire ferait « réussir » une dépublication sur
une offre jamais partie.

**(2) L'échec était silencieux, et ça vaut en production.** `transitionApec` ne
regardait que le CORPS de la réponse : la route rend 409 (refusé par l'Apec —
fenêtre de republication fermée) ou 503 (injoignable) avec un JSON parfaitement
lisible, donc `data` n'était jamais `null` et rien n'était levé. Le hook posait
un `posting` inchangé et l'écran restait identique. Désormais `res.ok` compte
autant que le corps, et le hook DIT l'issue : le message de refus, la raison
d'indisponibilité, et — cas nominal qu'il ne faut pas déguiser en panne — un
« Statut relu — il n'a pas changé » neutre quand la lecture aboutit sans
changement.

Sondes : retirer l'amorçage fait tomber les deux tests de service ; ignorer
`res.ok` fait tomber deux des trois tests du client.

---

## 6quinquies. Premier appel réel — 09/09/2026, environnement de test

```
  openPosition     published
  Numéro Apec      179240002W
  Statut           AVALIDER
  Modifiable       non
  URL              —
```

**Ce que cet appel prouve**, et qu'aucun test ne pouvait établir :

- **la clé Argon2 est celle que l'Apec attend.** C'était la plus grosse inconnue
  du chantier — il n'existe aucun vecteur de test, et le croisement
  Node/`argon2-cffi` ne prouvait que notre conformité à ce que la spec DÉCRIT.
  L'hypothèse (256 OCTETS, base64 sans padding, sel décodé) est confirmée ;
- l'`atsId`, le numéro de dossier et l'espace de noms en `http://` ;
- **l'ORDRE des éléments du flux**, que les `xs:sequence` imposent et que la
  prose ne disait pas — validé par le destinataire lui-même ;
- le parseur d'acquittement (numéro lu correctement) et le chaînage
  `openPosition` → `getPositionStatus` ajouté le 09/09.

**`AVALIDER` est nominal** : l'offre attend un consultant Apec. `isEditable` à
faux et une URL vide en découlent — il n'y a pas encore de page publique. Le
libellé existait déjà (`ADEP_STATUS_LABELS`), l'écran dit « En attente de
validation par un consultant Apec ».

### 6quinquies.1 Ce que la sonde ne savait pas faire — et le piège qu'elle tendait

La sonde créait sans pouvoir retirer, et comme elle n'écrit rien en base, l'offre
créée est invisible pour l'interface : impossible de la dépublier depuis ORQA.
D'où `--suspend <référence>` (dry-run par défaut, `--execute` pour agir, même
confirmation d'`atsId`). La RÉFÉRENCE CLIENT suffit — exiger le numéro Apec
obligerait à le retrouver dans un journal pour retirer une offre qu'on vient de
créer.

**Deux clés désignent la même offre, et l'opérateur n'a pas toujours celle qu'on
croit.** Première version : `--suspend` n'acceptait que la référence CLIENT.
Or elle est régénérée à chaque exécution de la sonde (`Date.now().slice(-4)`) et
le compte rendu d'une création ne l'affichait **pas** — seul le numéro Apec y
figurait. Retirer l'offre supposait donc de retrouver la bonne référence dans un
historique de terminal, et reprendre celle d'un dry-run antérieur rend
`API_391` (« référence inconnue »), ce qui se lit à tort comme « l'offre n'a
jamais existé ». Les deux clés sont désormais acceptées — la forme
`\d{9}[A-Za-z]` part en `apecPositionNumero`, le reste en `clientPositionId` —
et l'écran DIT laquelle. Le compte rendu d'une création affiche la référence ET
la commande de retrait toute faite.

⚠️ **Défaut trouvé en s'en servant** : un drapeau inconnu était **ignoré en
silence**. `--suspend REF` sur la version qui ne le connaissait pas retombait
sur le comportement par défaut, c'est-à-dire une CRÉATION. En dry-run cela n'a
rien cassé ; avec `--execute`, l'opérateur aurait publié une SECONDE offre en
croyant en retirer une. D'où `checkArgs()` : liste blanche, un inconnu arrête
tout. Un outil qui parle à l'Apec ne fait jamais « autre chose » que ce qu'on
lui demande. Corollaire d'affichage : l'en-tête annonce désormais le GESTE
(« SUSPENDRE … » / « CRÉER une offre de sonde »), et le chemin de suspension est
séparé — afficher le flux d'une création sous un en-tête « SUSPENDRE » serait la
même confusion, en pire.

### 6quinquies.2 `API_352` — une offre en attente de validation ne se retire pas

Mesuré en tentant de retirer l'offre de sonde : `updatePositionStatus SUSPENDUE`
sur une offre en **`AVALIDER`** rend **`API_352`** (« changement de statut non
autorisé depuis l'état actuel »). La relecture, elle, la retrouve — l'offre
existe bien, c'est la TRANSITION qui est refusée.

C'est logique après coup (on ne retire pas de la diffusion ce qui n'y est pas
encore), mais rien dans la documentation ne le disait, et **le panneau proposait
le bouton** : `adepPhase` regroupe `AVALIDER` et `AMODIFIER` sous
`awaiting_validation`, et la carte offrait « Dépublier » sur cette phase comme
sur `published`.

Correctif : `canSuspend` n'accepte plus que `published`, et
`suspendUnavailableNotice` DIT pourquoi le bouton a disparu — la carte suivait
déjà cette règle pour la republication (« un bouton retiré dit pourquoi »), elle
ne la suivait pas pour celui-ci. Proposer un geste que la plateforme refusera
systématiquement fait porter à l'utilisateur le coût de notre ignorance.

⚠️ Mesuré sur `AVALIDER` seulement ; `AMODIFIER` est traité pareil par prudence
(les deux états sont « pas en diffusion »), sans que ce soit vérifié.

### 6quinquies.3 La PRODUCTION, sondée en lecture seule — 09/09/2026

Deux réponses d'un seul appel `--check-auth` contre
`https://adepsep.apec.fr/v5/positions`, sans rien créer :

1. **Le WSDL de production a enfin été vu, et il CONCORDE.** Le
   `targetNamespace` servi est `http://adep.apec.fr/hrxml/sep`, identique à
   celui du test et à notre constante. La question ouverte n°1 est close pour
   les DEUX environnements — la garde de `adep:probe` a fait exactement ce
   pour quoi elle avait été écrite, et n'a rien eu à bloquer.
2. **Les paramètres Argon2 ne sont PAS communs aux deux environnements.** La
   clé calculée avec le mot de passe et le sel de test rend `API_102` sur la
   production (« clé d'authentification refusée »). L'Apec ayant transmis un
   `atsId` et un numéro de dossier de production **sans** paramètres Argon2, il
   en faut un jeu dédié — et un recalcul complet, un sel différent produisant
   une clé entièrement différente.

⚠️ Ce diagnostic n'a coûté aucune offre parasite : c'est précisément ce que
`--check-auth` existe pour faire. Un `--execute` de reconnaissance aurait laissé
sur le compte RÉEL une offre « SONDE TECHNIQUE » impossible à retirer tant
qu'elle est en `AVALIDER` (§6quinquies.2).

### 6quinquies.4 Reste ouvert

- **les paramètres Argon2 de PRODUCTION** (mot de passe, sel, itérations,
  parallélisme) — demandés au support ;
- l'offre de sonde `179240002W` reste en `AVALIDER` : elle n'est pas diffusée,
  et l'Apec refuse de la retirer dans cet état (`API_352`). Sa fermeture est à
  demander au support ADEP — à joindre au bloc de questions ;
- le **mode indirect** attend sa convention.

---

## 6sexies. Première publication en PRODUCTION — 10/09/2026

```
  Campagne         CAMP-2026-628 « ingénieur data »
  openPosition     published            12h49
  Numéro Apec      179400306W
  Statut           PUBLIEE  ← immédiat, sans phase d'attente
  Candidatures     2 reçues par IMAP    12h55, 12h57
  suspend          changed              12h59  ← l'annonce disparaît d'apec.fr
```

Le cycle complet — publier, recevoir, dépublier — a tourné de bout en bout sur
`adepsep.apec.fr`. Trois enseignements, dont deux **corrigent** ce que la recette
nous avait fait croire.

### 6sexies.1 Il n'y a PAS de phase « à valider » en production

L'environnement de test place toute offre neuve en `AVALIDER` et y refuse le
retrait (`API_352`, §6quinquies). Nous en avions déduit qu'une offre fraîche ne
pouvait pas être dépubliée. **C'est faux en production** : le contrôle juridique
étant passé pour un compte en règle, `openPosition` rend directement `PUBLIEE`,
et `updatePositionStatus(SUSPENDUE)` fonctionne dans la foulée. Les deux branches
du diagramme §1.4 sont donc bien réelles — mais chaque environnement en emprunte
une seule, systématiquement.

Le code n'a pas à changer : `canSuspend` n'offre le retrait que sur `PUBLIEE`, ce
qui est juste des deux côtés. Ce qui doit changer, c'est ce qu'on RACONTE — la
gêne du §6quinquies (« une offre fraîche ne se retire pas ») est un artefact de
recette, et l'annoncer comme une limite du produit serait un contresens.

### 6sexies.2 `ADEP_ATS_PASSWORD_HASH` est OBLIGATOIRE partout où l'app tourne

La clé Argon2 est CONSTANTE pour un triplet (mot de passe, sel, paramètres) :
elle se calcule une fois, hors ligne, et se pose en variable. `@node-rs/argon2`
est délibérément une **devDependency** — le chemin de service ne hache rien.

Poser `ADEP_ATS_PASSWORD` + `ADEP_ARGON2_*` **sans** `ADEP_ATS_PASSWORD_HASH`
compile, démarre, et affiche un panneau APEC parfaitement normal. Puis échoue au
seul clic qui compte : `resolveAtsPasswordFromEnv` tente alors de charger le
module natif depuis le bundle, et la publication rend 500. Le panneau, lui, ne
s'en aperçoit pas — **la route de lecture n'appelle jamais `credentials()`**, et
c'est précisément ce décalage qui rend le défaut difficile à lire.

Geste d'installation, une fois par environnement (local compris) :

```
npm run adep:hash -- --env <fichier>     # puis coller ADEP_ATS_PASSWORD_HASH
```

Sur Vercel la question ne se pose même pas : le module natif n'y sera pas.

### 6sexies.3 Le journal doit dire À QUEL Apec il parle

`simulated: false` vaut autant pour la recette que pour la production. Deux
offres acquittées à un jour d'intervalle — `179240011W` en recette,
`179400306W` en production — ont laissé au journal des lignes rigoureusement
identiques, et retrouver laquelle vivait où a demandé de remonter aux dates de
modification d'un fichier `.env`.

`apecEnvironment` porte désormais `simulation` ou **l'hôte tel quel**
(`adepEndpointHost`, pur/testé). On ne l'interprète pas : deviner « recette »
d'un préfixe `test` marcherait sur les deux hôtes connus aujourd'hui et
mentirait au troisième.

### 6sexies.4 Un 500 ne laissait AUCUNE trace

L'exception survient avant `reserveJobPosting` : ni ligne `job_postings`, ni
entrée au journal — celle-ci n'était écrite qu'après un retour réussi de
`publishToAdep`. Le seul témoignage vivait dans la console d'un serveur de
développement, inaccessible en production et perdu à la fermeture de la fenêtre.
Retrouver la cause a demandé de raisonner par élimination sur ce qui n'avait
PAS été écrit.

Le chemin d'exception journalise maintenant `apec_offer_publish_failed` avec
`outcome: 'exception'` et le message. Le fil d'activité distingue les deux —
« refusée » vient de l'Apec et se corrige dans l'offre, « échec technique » vient
de chez nous et se corrige dans l'installation ; les confondre enverrait relire
une annonce parfaitement valide.

### 6sexies.5 Les candidatures arrivent bien, et par le CORPS

Les deux candidatures sont parties d'adresses relais
`…@candidature.apec.fr`, sujet « Candidature sur offre d'emploi N° 179400306W —
QWESTINUM — ingénieur data F/H ». La référence `CAMP-XXXX` n'y figure pas : le
rapprochement s'est fait sur le **corps** (`matchSource: "body"`), exactement le
repli prévu. À retenir avant d'envisager de durcir le rapprochement au seul
sujet — ce serait perdre toutes les candidatures venues de l'Apec.

---

## 7. Phase 2 — lots révisés

L'ordre du brief tient. Trois ajustements issus de l'étude.

**Lot 0 (nouveau, une heure) — lever les deux inconnues.** Récupérer le WSDL et ses
XSD depuis l'environnement de test (`curl`), fixer l'espace de noms (§0.4), les
verser dans `docs/apec/xsd/`. Et calculer la clé Argon2 avec les paramètres reçus
par mail, en croisant Node et Python (§0.2). Sans ces deux réponses, le lot 1 code
contre une hypothèse.

**Lot 1 — le noyau pur.** Port `JobBoardPublisher` (`publish`, `getStatus`,
`suspend`, `republish`), adaptateur mock, constructeur XML SEP, validateur local,
parseur d'acquittement, table des erreurs. Tests purs sur les exemples fournis, dont
un acquittement `Fatal`. Le calcul Argon2 part dans `scripts/adep-hash.ts`, pas dans
l'application (§5.4).

**Lot 2 — modèle et écran.** Migration `job_postings`, réservation avant appel,
panneau APEC, publication **via le mock**. Recette complète sans l'Apec : succès,
`Warning`, `Fatal`, timeout puis reprise par `getPositionStatus`. Le mock rejoue des
acquittements réels enregistrés.

**Lot 3 — l'adaptateur réel.** `AdepSepPublisher` derrière `ADEP_ENABLED`
(fail-closed strict, comme `DEMO_JOBBOARD_ENABLED`), et
`npm run adep:probe -- --env <fichier>` : dry-run par défaut (XML caviardé + projet
ciblé + résultat du validateur), `--execute` pour l'appel réel, suivi automatique
d'un `getPositionStatus` sur le numéro reçu. `--env` obligatoire, aucun repli, et
confirmation du projet ciblé par saisie de la référence — comme `purge:candidate`.
Aucun appel réel depuis les tests automatisés ; une garde structurelle le vérifie,
sur le modèle de `frontier.test.ts`.

**Lot 4 — signaux et clôture.** Les deux signaux du §6.4, et la case de
dépublication dans `CampaignDismissFlowDialog` (§6.5).

---

## Questions ouvertes pour l'Apec

À poser au support avant le lot 3 — chacune est un point où la documentation se
contredit ou se tait. **Chacune porte l'hypothèse de travail retenue en
attendant la réponse** : le code n'attend personne, mais il dit ce qu'il suppose.
Le bloc rédigé pour le support est l'objet du lot 4.

1. ~~**Espace de noms exact des requêtes SEP.**~~ **RÉPONDU par le WSDL de
   test** : `http://adep.apec.fr/hrxml/sep` (§0.4). Reste à confirmer que le
   WSDL de PRODUCTION porte la même valeur — ✅ **confirmé le 09/09**.
2. ~~**Un vecteur de test Argon2**~~ **SANS OBJET — tranché par l'appel réel du
   09/09.** L'Apec a accepté la clé : 256 octets, base64 sans padding, sel
   base64 décodé. L'hypothèse était juste, et c'est l'`openPosition` qui l'a
   prouvée, pas un vecteur de test (il n'en existe toujours aucun).
3. **`GLOBAL_EXPERIENCE_LEVEL`** : la spec dit « 1 caractère » alors que
   `NIVEAU_EXPERIENCE_DOMAIN` va jusqu'à 12. Les valeurs 10 à 12 sont-elles
   utilisables ?
   *Hypothèse : le domaine fait foi, les douze valeurs passent ; « 1 caractère »
   est une coquille.*
4. **`UserArea/Duration`** : la spec dit « valeur minimum 0 (= moins d'un mois) »,
   l'erreur 394 dit « un nombre entre 1 et 99 ». Laquelle fait foi ?
   *Hypothèse : le plus STRICT, 1 à 99. Refuser en local un 0 qui serait passé
   se répare en une seconde ; laisser partir un 0 qui casse coûte un
   aller-retour devant le client.*
5. **`Competency name="INTERNATIONAL_PROFILE"`** : obligatoire, facultatif, ou
   ignoré ? L'exemple l'envoie vide, le tableau ne le mentionne pas, et l'erreur
   335 existe.
   *Hypothèse : on reproduit l'exemple officiel — élément présent et vide.*
6. **Fonction du contact de candidature** : 128 caractères (spec §X.1.2) ou 80
   (erreur 404) ?
   *Hypothèse : 80, la borne du catalogue.*
7. **Les expressions régulières `URL_CANDIDATURE` et `URL_VIDEO`** : annoncées
   « décrites ci-après dans le document », elles n'y figurent que sous forme
   d'images. En obtenir le texte.
   *Hypothèse : URL de candidature en `http(s)://` ; vidéo limitée aux hôtes
   YouTube, Vimeo et Dailymotion cités par le catalogue.*
8. **Acquittement `Fatal`** : `apecPositionNumero` est-il absent, ou présent et
   à ignorer ? Le schéma le déclare `minOccurs="0"`, ce qui plaide pour
   l'absence — à confirmer sur un rejet réel.
   *Hypothèse : un échec ne rend JAMAIS de numéro. Le parseur le force à `null`,
   pour que la reprise par référence (§3.3) reste possible.*

---

## Provenance

Les documents Apec ont été copiés depuis `~/Downloads/APEC` vers `docs/apec/`
(13 Mo, non versionnés à ce stade — les `.docx`/`.pdf` sont volumineux et
binaires ; à arbitrer avant commit). Le texte extrait ayant servi à cette étude
n'est pas conservé : tout ce qui compte est cité ici.

Le WSDL de test a été déposé le 08/09/2026 (sauvegarde navigateur de
`https://testadepsep.apec.fr/v5/positions?wsdl`) et installé sous
`docs/apec/adepsep-test.wsdl` — 130 Ko, texte, **celui-là mérite d'être
versionné** : il porte les schémas dont dépendent le constructeur et les tests,
et un connecteur dont on ne peut pas rejouer la validation hors ligne est un
connecteur qu'on ne peut pas faire évoluer sereinement.
