# Spécification — Fiche de scoring hybride (méthode de vérification par critère)

Document de spécification fonctionnelle. Source de vérité pour la fonctionnalité
« fiche de scoring hybride » d'ORQA.

## 1. Contexte et motivation

### 1.1. Problème identifié

L'analyse actuelle des CV par ORQA repose intégralement sur un LLM qui interprète
chaque critère de la grille de scoring face au texte du CV. Cette approche
fonctionne bien pour les critères contextuels et interprétatifs, mais montre ses
limites sur deux types de critères :

- **Critères techniques nommables.** Pour des compétences précises (technologies,
  certifications, diplômes), l'analyse LLM introduit de la variance et du risque
  d'extrapolation alors que la vérification est en réalité binaire : le terme est
  présent dans le CV ou il ne l'est pas.
- **Critères à domaine spécifique.** Le LLM peut extrapoler une expérience d'un
  domaine à un autre (par exemple compter 15 ans en qualité logicielle comme
  expérience valable pour un poste de recrutement), produisant des verdicts faux
  mais stables.

Les benchs menés en juin 2026 ont confirmé que la variance LLM reste maîtrisée sur
les CV synthétiques tranchés, mais que des CV réels en zone grise peuvent produire
des oscillations significatives. Plus important, certains verdicts stables se
révèlent factuellement faux par défaut de discipline sémantique.

### 1.2. Solution proposée

Introduire une **fiche de scoring hybride** dans laquelle chaque critère se voit
attribuer, au moment du cadrage, une **méthode de vérification** parmi plusieurs
options possibles. Le choix de la méthode est fait selon la nature du critère, pas
par défaut systémique.

L'objectif n'est pas de remplacer l'analyse LLM mais de **diversifier les méthodes
de vérification** pour appliquer la bonne méthode au bon type de critère. Le LLM
reste central pour l'analyse contextuelle ; le matching déterministe prend le relais
pour les critères factuels.

### 1.3. Bénéfices attendus

- Fiabilité accrue sur les critères techniques (verdict 100% déterministe, citation
  100% fidèle)
- Coût réduit (moins d'appels LLM par campagne sur les critères techniques)
- Traçabilité enrichie (chaque verdict mentionne la méthode de vérification
  appliquée)
- Argument commercial différenciant face aux ATS classiques (mots-clés uniquement)
  et aux solutions IA récentes (LLM uniquement)
- Cohérence renforcée avec le positionnement **Process First** (l'humain choisit la
  méthode adaptée à chaque critère)

## 2. Méthodes de vérification proposées

Quatre méthodes sont introduites dans le système. Chaque critère de la grille en
utilise une.

### 2.1. Méthode `keywords_exact` — Recherche par mots-clés exacts

**Principe.** Le critère est défini par un mot-clé principal et éventuellement une
courte liste de variantes textuelles strictes. La vérification consiste à rechercher
la présence de l'un de ces termes dans le texte du CV, sans interprétation.

**Verdict produit :**

- `satisfait` si au moins un mot-clé est présent dans le CV
- `non` si aucun mot-clé n'est présent

Le verdict `non_verifiable` n'est pas produit par cette méthode : la présence ou
l'absence d'une chaîne de caractères est par nature vérifiable.

**Citation produite.** Extrait du CV contenant le ou les premiers mots-clés trouvés,
avec contexte de quelques mots autour pour le confort de lecture.

**Cas d'usage idéal.** Certifications nommées (« AWS Solutions Architect », « PMP »,
« Scrum Master »), technologies précises (« React », « Kubernetes », « PostgreSQL »),
diplômes spécifiques (« Master AES », « INSA Lyon »).

**Limites assumées.** Risque de faux négatif si le candidat utilise une formulation
alternative non listée. Risque de faux positif si le mot-clé apparaît dans un
contexte non pertinent (par exemple « React » dans « j'ai réagi à »).

### 2.2. Méthode `keywords_with_variants` — Recherche par mots-clés avec variantes étendues

**Principe.** Extension de la méthode précédente avec une liste de variantes plus
riche, incluant synonymes courants, abréviations, et formulations alternatives. Les
variantes sont définies au moment du cadrage du critère, avec proposition assistée
par le Manager RH.

**Verdict produit.** Identique à `keywords_exact` (`satisfait` ou `non`).

**Citation produite.** Identique à `keywords_exact`, avec mention de la variante
effectivement trouvée.

**Cas d'usage idéal.** Compétences techniques aux multiples appellations
(« JavaScript » + « JS » + « ECMAScript » + « Node.js »), secteurs d'activité avec
dénominations multiples (« aéronautique » + « aérospatial » + « aviation »),
technologies de famille (« cloud » + « AWS » + « Azure » + « GCP »).

**Différence fonctionnelle vs `keywords_exact`.** Au moment du cadrage, lors de la
définition d'un critère avec cette méthode, le Manager RH propose automatiquement une
liste de variantes sur la base du libellé du critère, que l'utilisateur valide ou
ajuste. C'est le **seul appel LLM lié à cette méthode**, et il est **unique** (à la
création du critère), pas répété à chaque CV.

### 2.3. Méthode `llm_with_quote` — Vérification LLM avec citation (méthode actuelle)

**Principe.** La méthode utilisée aujourd'hui par ORQA. Le LLM lit le CV, juge si le
critère est satisfait, fournit un verdict parmi `satisfait` / `partiel` / `non` /
`non_verifiable`, et accompagne sa décision d'une citation littérale du CV.

**Verdict produit.** Les quatre verdicts standards (`satisfait`, `partiel`, `non`,
`non_verifiable`).

**Citation produite.** Extrait littéral du CV justifiant le verdict, conforme aux
règles de discipline de domaine durcies (cf. spec `cv-extraction-prompts.ts`).

**Cas d'usage idéal.** Expérience à durée minimale dans un domaine, niveau de
responsabilité, contexte particulier, soft skills mentionnées explicitement,
compétences transverses qui exigent compréhension du texte.

Cette méthode reste la **méthode par défaut** pour tout critère pour lequel
l'utilisateur ne choisit pas explicitement une autre méthode.

### 2.4. Méthode `hybrid_keywords_llm` — Hybride mots-clés gardiens + LLM contextuel

**Principe.** La méthode la plus rigoureuse. Le système recherche d'abord les
mots-clés définis dans le CV. Si aucun mot-clé n'est trouvé, le verdict est
immédiatement `non` (sans appel LLM). Si au moins un mot-clé est trouvé, le LLM est
appelé pour valider le contexte d'apparition et produire un verdict nuancé.

**Verdict produit.** Les quatre verdicts standards, avec discipline particulière :
`non` immédiat si aucun mot-clé présent.

**Citation produite.** Citation contenant le mot-clé trouvé, validée contextuellement
par le LLM.

**Cas d'usage idéal.** Critères où la présence du mot-clé est nécessaire mais pas
suffisante. Exemple : « Expérience en management » avec mots-clés « manager »,
« management », « chef d'équipe », « responsable d'équipe ». Le système élimine
immédiatement les CV qui ne mentionnent aucun de ces termes (très probablement non
pertinents), et confie au LLM la nuance pour les CV qui les mentionnent (le candidat
est-il sujet ou objet du management ?).

**Avantage économique.** Pour un critère qui n'est satisfait que par 20% du vivier,
cette méthode économise 80% des appels LLM par rapport à `llm_with_quote` pur, sans
dégrader la qualité d'analyse.

## 3. Modèle de données

### 3.1. Extension de l'entité Criterion

L'entité `Criterion` existante de la grille de scoring est étendue avec deux nouveaux
champs :

- **Champ `verification_method`** : énumération à valeurs `keywords_exact`,
  `keywords_with_variants`, `llm_with_quote`, `hybrid_keywords_llm`. Valeur par
  défaut : `llm_with_quote` (rétro-compatibilité avec les grilles existantes).
- **Champ `keywords`** : tableau de chaînes de caractères, contenant les mots-clés et
  variantes définis pour ce critère. Tableau vide pour les critères en méthode
  `llm_with_quote`. Au moins un mot-clé pour les autres méthodes.

### 3.2. Extension de l'entité Verdict

L'entité `Verdict` (résultat de l'analyse d'un critère pour un candidat donné) est
étendue avec un champ :

- **Champ `verification_method_used`** : enregistre quelle méthode a effectivement été
  appliquée pour produire ce verdict. Permet de tracer dans le rapport candidat la
  méthode utilisée. Valeur reprise du champ `verification_method` du critère au moment
  de l'analyse.

### 3.3. Migration des données existantes

Toutes les fiches de scoring existantes voient leurs critères marqués automatiquement
avec `verification_method = 'llm_with_quote'` et `keywords = []`. Le comportement
reste strictement identique à l'existant. Aucune campagne en cours n'est impactée.

## 4. Interface utilisateur — Cadrage de la grille de scoring

### 4.1. Vue de définition d'un critère

L'interface de définition d'un critère est enrichie avec la sélection de la méthode de
vérification.

Disposition proposée pour un critère :

```
Critère :        [Libellé du critère]
Criticité :      [Rédhibitoire ▼]
Poids :          [10 pts]
Méthode :        [Vérification LLM avec citation ▼]
                 ▾ Choisir la méthode
                   ○ Vérification LLM avec citation (par défaut)
                   ○ Mots-clés exacts
                   ○ Mots-clés avec variantes
                   ○ Hybride mots-clés + LLM
```

Selon la méthode choisie, des champs complémentaires apparaissent.

### 4.2. Champs spécifiques par méthode

Pour `keywords_exact` :

```
Mots-clés :      [React, ReactJS, React.js]
                 (un par ligne ou séparés par des virgules)
```

Pour `keywords_with_variants` :

```
Mots-clés :      [JavaScript, JS, ECMAScript, Node.js]
                 [+ Suggérer des variantes par IA]
                 (un par ligne ou séparés par des virgules)
```

Le bouton « Suggérer des variantes par IA » déclenche un appel au LLM (Manager RH) qui
propose une liste enrichie de variantes basée sur le libellé du critère. L'utilisateur
peut accepter, modifier, ou compléter cette liste.

Pour `llm_with_quote` :

Aucun champ supplémentaire. Méthode par défaut sans paramétrage spécifique.

Pour `hybrid_keywords_llm` :

```
Mots-clés gardiens : [manager, management, chef d'équipe, responsable d'équipe]
                     [+ Suggérer des mots-clés par IA]
Note : un CV ne contenant aucun de ces termes sera automatiquement
       marqué "non" sans appel LLM. Si au moins un terme est trouvé,
       le LLM analysera le contexte pour produire un verdict nuancé.
```

### 4.3. Assistance du Manager RH au moment du cadrage

Le Manager RH, dans son rôle conversationnel, propose une méthode par défaut adaptée à
la nature détectée de chaque critère qu'il aide à formuler.

Exemples de comportement attendu :

- Critère « Maîtrise de Python » → suggestion `keywords_with_variants` avec proposition
  de variantes (Python, Python 3, Django, Flask, FastAPI)
- Critère « Certification AWS Solutions Architect » → suggestion `keywords_exact` avec
  variantes (AWS Solutions Architect, AWS SA, Solutions Architect AWS)
- Critère « Excellentes compétences relationnelles » → suggestion `llm_with_quote`
  (critère trop subjectif pour les mots-clés)
- Critère « Expérience en management d'équipe » → suggestion `hybrid_keywords_llm`
  (présence d'un mot-clé manager nécessaire, contexte à valider par LLM)

L'utilisateur garde la main et peut ajuster chaque suggestion. Cohérent avec la
philosophie Process First.

### 4.4. Vue de récapitulatif de la grille

La grille de scoring affiche pour chaque critère un badge visuel indiquant la méthode
appliquée :

- **LLM** pour `llm_with_quote`
- **MOTS-CLÉS** pour `keywords_exact` et `keywords_with_variants`
- **HYBRIDE** pour `hybrid_keywords_llm`

Permet à l'utilisateur de visualiser d'un coup d'œil la composition de sa grille et
d'ajuster si nécessaire.

## 5. Moteur d'analyse

### 5.1. Orchestration par critère

Le moteur d'analyse de CV est refactorisé pour dispatcher chaque critère vers la
méthode de vérification appropriée. Le résultat reste un `Verdict` standardisé quelle
que soit la méthode utilisée, ce qui assure la compatibilité avec le scoreur existant.

Pseudo-flux :

```
Pour chaque candidat reçu :
  Pour chaque critère de la grille :
    selon critère.verification_method :
      'keywords_exact'         → verifyKeywordsExact(cv, critère.keywords)
      'keywords_with_variants' → verifyKeywordsWithVariants(cv, critère.keywords)
      'llm_with_quote'         → verifyByLLM(cv, critère.label)  (méthode actuelle)
      'hybrid_keywords_llm'    → verifyHybrid(cv, critère.keywords, critère.label)

  Score = appliquer scoreur classique sur l'ensemble des verdicts
```

### 5.2. Helpers de vérification déterministe

- **`verifyKeywordsExact(cv, keywords)`** : recherche textuelle stricte (insensible à
  la casse) de chacun des mots-clés dans le texte du CV. Retourne `satisfait` +
  citation si trouvé, `non` sinon.
- **`verifyKeywordsWithVariants(cv, keywords)`** : identique à `verifyKeywordsExact`
  (la richesse de la liste fait la différence, pas la mécanique de recherche).
- **`verifyHybrid(cv, keywords, criterionLabel)`** : recherche d'abord les mots-clés.
  Si absents, retourne `non` sans appel LLM. Si présents, déclenche un appel LLM
  contextuel avec un prompt spécifique qui rappelle les mots-clés trouvés et demande au
  LLM de valider le contexte d'apparition.

**Recherche textuelle.** Pour la v1, recherche par sous-chaîne insensible à la casse
avec délimiteurs de mots (pour éviter que « JS » matche dans « jsdom »). Pas de
stemming ni de fuzzy matching en v1 (gardés en backlog).

### 5.3. Prompt LLM spécifique pour la méthode hybride

Quand `verifyHybrid` déclenche l'appel LLM (parce qu'au moins un mot-clé a été trouvé),
le prompt est spécifique :

```
Le critère à évaluer est « [libellé du critère] ».
Le CV mentionne au moins un des termes suivants : [liste des mots-clés trouvés].
Pour chaque occurrence de ces termes, vérifie le contexte d'apparition et juge si
l'occurrence soutient effectivement le critère « [libellé] » ou si elle est
trompeuse (par exemple si le candidat est l'objet et non le sujet de l'action, si le
contexte est marginal, ou si l'occurrence est dans un domaine étranger).
Tu produis l'un des verdicts : satisfait / partiel / non / non_verifiable, avec
citation littérale et discipline de domaine standard.
```

Ce prompt s'appuie sur les règles de durcissement déjà en place
(`buildVerdictsSystemPrompt` durci) mais ajoute le contexte spécifique de la méthode
hybride.

## 6. Affichage des verdicts et traçabilité

### 6.1. Rapport candidat enrichi

Pour chaque critère évalué d'un candidat, le rapport candidat affiche désormais :

- Le libellé du critère
- La criticité
- Le poids
- Le verdict
- **La méthode de vérification appliquée (nouveau)**
- La citation (issue du CV)
- La contribution au score

La méthode de vérification est indiquée par un libellé court et un éventuel
pictogramme :

- **Vérification LLM** pour `llm_with_quote`
- **Mots-clés détectés** pour `keywords_exact` et `keywords_with_variants` (avec liste
  des mots trouvés)
- **Mots-clés validés par LLM** pour `hybrid_keywords_llm`

### 6.2. Traçabilité dans l'audit candidat

L'audit candidat (sous-onglet Reporting) reprend cet enrichissement et permet de
filtrer les critères par méthode appliquée. Utile pour vérifier la cohérence du
paramétrage de la grille en production.

## 7. Cas limites et points d'attention

### 7.1. Critère avec méthode déterministe mais mots-clés vides

Erreur de paramétrage qui doit être **bloquée à la sauvegarde de la grille**.
Validation côté UI et côté serveur : un critère en méthode `keywords_exact`,
`keywords_with_variants` ou `hybrid_keywords_llm` doit avoir au moins un mot-clé.

### 7.2. CV au format non textuel (image, PDF scanné)

Pour la v1, l'extraction textuelle est supposée disponible (ORQA gère déjà l'OCR si
nécessaire en amont). Les méthodes déterministes opèrent sur le même texte extrait que
la méthode LLM. Si l'extraction textuelle a échoué, le critère retourne
`non_verifiable` quelle que soit la méthode.

### 7.3. Détection de bourrage de mots-clés

**Hors périmètre v1.** À traiter dans une session ultérieure : détecteur de densité
anormale de mots-clés, mots en couleur cachée, mots en bas de CV en taille réduite.
Pour l'instant, le risque est documenté et le cabinet sait que les méthodes
déterministes peuvent être contournées par un candidat malveillant.

### 7.4. Insensibilité à la casse et caractères spéciaux

La recherche est insensible à la casse. Les caractères spéciaux des mots-clés (accents,
tirets, points) sont préservés tels quels (« C++ » cherche bien « C++ », pas « C » ou
« C plus plus »). Documentation utilisateur claire sur ce point.

### 7.5. Comportement sur les grilles existantes

Toutes les campagnes en cours et toutes les grilles déjà créées avant la mise en
production de cette fonctionnalité conservent strictement le comportement actuel
(`llm_with_quote` partout). Aucune régression possible.

## 8. Phasage de développement

**Phase 1 — Modèle de données et méthodes déterministes.**
Migration du schéma. Implémentation de `verifyKeywordsExact` et
`verifyKeywordsWithVariants`. Refonte du dispatcher dans le moteur d'analyse pour
orchestrer selon la méthode. Tests de non-régression sur les campagnes existantes.

**Phase 2 — Interface de cadrage.**
Enrichissement de l'interface de définition d'un critère pour permettre le choix de la
méthode et la saisie des mots-clés. Badges visuels dans la vue récapitulative de la
grille.

**Phase 3 — Méthode hybride et suggestion par IA.**
Implémentation de `verifyHybrid` avec son prompt LLM spécifique. Implémentation du
bouton « Suggérer des variantes par IA » dans l'interface de cadrage.

**Phase 4 — Affichage et traçabilité.**
Enrichissement du rapport candidat et de l'audit candidat pour afficher la méthode de
vérification appliquée. Filtrage par méthode dans l'audit.

**Phase 5 — Bench de validation.**
Bench comparatif sur les CV de test (CV1 à CV5) entre grille tout-LLM et grille
hybride. Mesure des gains en fiabilité et en coût.
