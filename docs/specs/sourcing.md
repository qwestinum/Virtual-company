# Module Sourcing — spécification (Phase 1 consolidée)

> Statut : **étude close, rien d'implémenté, aucune migration**. Rédigée le 13/09/2026 sur la
> base du brief « Phase 1 consolidée », qui remplace tous les briefs précédents. Mesures
> faites en dev : sonde Exa (11 appels) puis étude du requêtage (41 appels Exa, 3
> générations LLM). Les réponses brutes d'Exa — profils de personnes réelles — sont restées
> dans le scratchpad de la session ; **aucun nom n'est cité ici**, les entreprises des
> maquettes sont fictives.
>
> **Validée le 13/09/2026** avec six ajustements de périmètre (§1.6). Prochaine étape
> (Phase 2, lot 0) : le **préalable RGPD** (§12.3), puis les tables.

Sommaire : 1 Décisions · 2 Exa mesuré · 3 Requêtage · 4 Disponibilité · 5 Mentions ·
6 Coordonnées du titulaire · 7 Données · 8 Approche · 9 Page d'atterrissage ·
10 Manifestation · 11 Briefing et rapports · 12 Purge et RGPD · 13 Flag et proxy ·
14 Maquettes · 15 Journal · 16 Tests · 17 Coût de l'étude, incertitudes, indicateurs ·
18 Backlog

---

## 1. Décisions fixées (non négociables)

### 1.1 Source et appels
- Source unique : **Exa** `POST /search`, `category: "people"`, `contents: { text:
  { maxCharacters: 10000 }, highlights }`. Clé `EXA_API_KEY` en variable d'environnement,
  jamais côté client.
- **Un seul appel Exa par requête : 100 résultats, dans l'ordre Exa.** 50 affichés, 50 en
  réserve ; « 50 de plus » puise dans la réserve **sans appel**. Réserve épuisée ⇒
  « 100 profils examinés — modifiez la requête pour relancer ».
- Une requête modifiée (autre formulation, bascule FR/EN) = **un nouvel appel choisi par le
  recruteur**, dédoublonné par empreinte contre tout ce qu'il a déjà vu sur la campagne.
  **Aucune cascade automatique** (ni anglais, ni `deep`).
- **Aucun accès direct à LinkedIn, aucun tiers d'enrichissement, aucun envoi automatisé vers
  un profil sourcé, sur aucun canal.**

### 1.2 Analyse et décision
- **Aucune analyse LLM au sourcing.** Zéro appel par profil. La liste est celle d'Exa.
- **Une seule analyse, à la manifestation**, par le pipeline normal, sur le CV joint s'il
  existe, sinon sur le **CV structuré** construit par ORQA (`art_src_cv_<approachId>`, rendu
  déterministe, mention d'origine et de confirmation). **Zone forcée en accepté** quel que soit
  le score ; le score sert le dossier et le briefing. Libellé : « Score calculé le [date] sur
  le profil confirmé ».
- **`decided_by = 'user'` + identité du recruteur** qui a cliqué. Pas de valeur `sourcing`.
  L'origine est `candidate.source = 'sourcing'` (nouveau littéral de `CVSourceSchema`), clé
  des rapports « issus du sourcing ».
- Appels LLM du module, et seulement ceux-là : **le message d'approche**, au clic, pour le
  profil choisi ; **la génération de la requête**, un appel par recherche (retenu au §3.3).

### 1.3 Données conservées et affichées
- Retenu du profil : nom, localisation, intitulé actuel, parcours complet avec dates,
  formation, résumé et extraits, **et l'email présent dans le texte du profil** — uniquement
  s'il est clairement attribuable au **titulaire** (règle §6) ; ceux des recommandations ou
  citant des tiers sont jetés, **dans le doute on jette**. Photo exclue. Le téléphone n'est
  **pas** retenu (§1.6).
- **La section `## Social` est exclue de l'ingestion** : ni stockée, ni lue — y compris pour
  la disponibilité et les mentions. C'est le garde-fou le plus important de l'ingestion (§7.3).
- Stockage **dans `exa_snapshot` uniquement** ; jamais copié au vivier ni ailleurs.
- **Rétention jusqu'à la clôture de la campagne** : toute clôture ⇒ purge des profils non
  manifestés, empreintes seules conservées. Décliner ⇒ purge immédiate + exclusion campagne.
  Suspension ⇒ conservé. Filet de purge sur le rail en plus du hook de clôture.
- Empreinte = `HMAC-SHA256(SOURCING_FINGERPRINT_PEPPER, URL normalisée)` ; exclusions sans
  donnée ; **opposition = exclusion globale** (toutes campagnes).

### 1.4 Approche
Deux actions selon ce que le profil expose, chacune créant une **approche** + un **jeton
nominatif** (128 bits, stocké haché), `channel: 'linkedin' | 'email'` dans
`sourcing_approaches` et le journal :
- **Se connecter** : ouvre le profil LinkedIn **et** copie le message (même handler de clic) —
  ≤ 300 caractères en note de connexion, format long en InMail (préférence du recruteur).
- **Contacter par email** (si email retenu) : `mailto:` pré-rempli (objet, accroche, lien)
  envoyé depuis **la messagerie du recruteur**.

Rien ne part de la part d'ORQA avant la manifestation.

### 1.6 Ajustements de la validation (13/09/2026)
1. **« Appeler » sort du périmètre** : aucun téléphone réel sur 306 profils. Pas d'action, pas
   de colonne, pas de canal `phone`. La règle d'extraction reste documentée, **dormante**
   (§6.3). « Contacter par email » reste (7/306, rare mais réel).
2. **`## Social` exclue de l'ingestion**, jamais stockée ni lue, avec un test dédié : une
   section Social portant une expression de disponibilité ou un terme de critère ne déclenche
   **ni badge ni mention** (§7.3, §16).
3. Génération **(b) avec repli (a)** validée, avec l'indicateur « écart requête générée /
   requête envoyée » et son seuil de bascule (§17.3).
4. Réglage « domaine fin » : backlog, à mesurer avec des recruteurs (§18).
5. Profil purgé = **ligne supprimée**, états `reserve` / `to_review` / `contacted` (§7.2).
6. **Couverture limitée dite au recruteur** : quand une recherche rend peu de profils dans la
   zone demandée, l'écran l'explique plutôt que de laisser une liste qui semble mauvaise (§3.6,
   §14.3).

### 1.5 Réponses actées
Pas de geste de ré-analyse (backlog) · page neutre après désactivation · opposition globale ·
un manifesté entre au vivier comme toute candidature (CV structuré ou joint, sans URL) ·
compteur « issus du sourcing » par `candidate.source`.

---

## 2. Exa, mesuré

### 2.1 Structure réelle de la réponse

```jsonc
{
  "requestId": "…", "searchTime": 931.9,
  "costDollars": { "total": 0.097, "search": { "neural": 0.097 } },   // contenus NON facturés à part
  "results": [{
    "id": "https://exa.ai/library/person/<id>",        // = entities[0].id
    "url": "https://www.linkedin.com/in/<slug>",      // 100 % des résultats observés
    "title": "<nom complet>",                         // le « title » Exa est le NOM
    "publishedDate": "2026-07-28T05:30:48.000Z",      // date d'indexation du profil
    "image": "https://…",                             // PHOTO — jamais stockée
    "text": "# <Nom>\n<titre de profil>\n…\n## About\n…\n## Experience\n…\n## Education\n…\n## Skills\n…\n## Social\n…",
    "highlights": ["<extrait ≤ maxCharacters le plus proche de la requête>"],   // toujours 1
    "entities": [{ "type": "person", "properties": {
      "name": "…", "firstName": "…", "lastName": "…",
      "location": "Greater Paris Metropolitan Region",
      "workHistory": [{ "title": "…", "location": "…",
                        "dates": { "from": "2021-10-01", "to": null },     // to null = poste actuel
                        "company": { "id": "…", "name": "…" } }],
      "educationHistory": [{ "degree": "…", "dates": { "from": "2015", "to": "2017" },
                             "institution": { "id": "…", "name": "…" } }],
      "research": null } }]
  }]
}
```

### 2.2 Couverture (306 profils distincts)

| Donnée | Couverture | Remarque |
|---|---|---|
| URL LinkedIn | 100 % | clé de l'empreinte |
| `workHistory` | 98,7 % | médiane 6 postes, max 16 ; `from` présent sur 100 % des postes |
| `educationHistory` | 92 à 100 % selon la requête | années seules |
| `location` | 92 à 100 % | libellé LinkedIn |
| résumé `## About` | 305/306 | |
| compétences `## Skills` | 94/306 ; **39/50 à 10 000 caractères, invisibles à 4 000** | d'où 10 000 |
| langues, certifications | 21 et 23 sur 306 | texte seulement |
| **`## Social`** | **56/306** | publications et **republications de tiers** (opinions, santé, religion observées) ⇒ **jamais stockée, jamais lue** |
| `## Recommendations` | 8/306 | noms de tiers ⇒ jamais stockée |
| **email attribuable au titulaire** | **7/306 (2,3 %)** | règle §6 |
| **téléphone** | **0/306** | le « 10/150 » annoncé le 13/09 au matin était **faux** : identifiants de publications LinkedIn dans `## Social` (152 occurrences sur 45 profils) |
| fraîcheur `publishedDate` | médiane 38 j, p90 56 j, max 191 j | affichée sur la carte |

### 2.3 Latence et coût

| Appel | Reçus | Latence | Coût mesuré |
|---|---|---|---|
| `auto`, 25 résultats | 25 | 0,9 à 2,3 s | 0,022 $ |
| `auto`, 50 | 50 | 1,7 à 3,7 s | 0,047 $ |
| **`auto`, 100** | **100** | **2,5 à 2,8 s** | **0,097 $** |
| `deep`, 100 demandés | 13-14 | 3,7 à 4,5 s | 0,015 $ |

Formule vérifiée : 0,007 $ + 0,001 $ par résultat au-delà de 10 ; `text` et `highlights`
gratuits, longueur indifférente.

### 2.4 Stabilité

- **Requête identique ⇒ résultats identiques** : 25/25 profils, même ordre, sur les 3 fiches
  (contrôle `main-bis`, §3.2).
- **Changer `numResults` change la tête de liste** : top 25 d'un appel à 25 vs d'un appel à 50 :
  18-20 communs ; top 50 vs 50 premiers d'un appel à 100 : 39 communs. D'où la règle « un
  appel à 100, jamais un appel à 50 puis un autre ».
- **Paraphraser la requête** (même contenu, autre ordre) : 9 à 15 profils communs sur 25, et
  le nombre de pertinents bouge de **1 à 3**. C'est le **seuil de bruit** retenu pour lire le §3.

### 2.5 Français ou anglais

Sonde du 13/09 : sur un métier à vocabulaire français (AMOA Trade Finance), le français trouve
la spécialité (7 profils Trade Finance sur 25 contre 2 en anglais) ; sur un métier à vocabulaire
international (développeur), équivalent. Les deux langues trouvent des populations différentes
(1 commun sur 25). ⇒ **FR par défaut**, bascule EN = geste du recruteur.

---

## 3. Requêtage

### 3.1 Protocole

- **Fiches** : 3 campagnes de dev (la base de dev n'a ni AMOA, ni full-stack assurance, ni
  paie — choix validé) : **BA** = « Business Analyst (Digital ESR) – Expérimenté », Paris
  (CAMP-2026-293) ; **Back-end** = « développeur back end », localisation « Télétravail
  partiel » (CAMP-2026-095) ; **Directeur** = « Directeur de Département Opérations
  Industrielles (H/F) », Belfort, 10 à 15 ans (CAMP-2026-275).
- **Requêtes** par fiche : (a) déterministe, (b) LLM, `main` écrite à la main selon B1, une
  **ablation par règle** (une seule règle changée), et deux **contrôles de bruit** :
  `main-bis` (rejouée à l'identique) et `main-para` (paraphrasée).
- **Mesure** : 25 premiers, `auto`, FR.
  - **P1 (protocole)** = intitulé cohérent **et** localisation compatible (BA : Île-de-France ;
    Back-end : France, la fiche ne donne pas de ville ; Directeur : ≤ ~100 km de Belfort —
    Franche-Comté, Haut-Rhin).
  - **P2 (spécialité)** = P1 **et** le cœur de la fiche : BA ⇒ secteur financier (banque,
    assurance, gestion d'actifs, épargne) ; Back-end ⇒ Node.js ou Python présent dans le profil.
    Ajouté parce que P1 seul récompense les requêtes creuses (voir R7).
- **Jugement** : grille appliquée par script (motifs fermés sur intitulé et lieu), **puis relue
  ligne à ligne** sur (a), (b), `main` et R7 des trois fiches. Relecture : grille confirmée
  pour BA et Back-end ; **corrigée pour Directeur** (la grille comptait « Responsable
  industrialisation méthodes » ou « Chef production » à Belfort ; un Directeur de site à
  Aspach-le-Haut, près de Mulhouse, était manqué). Pour les ablations Directeur non relues,
  la grille **surcompte d'environ 3**.

### 3.2 B1 — effet mesuré de chaque règle

Lecture : écart à `main`. **|écart| ≤ 3 = neutre** (bruit de paraphrase, §2.4).

| Règle | Ablation | BA P1 / P2 | Back-end P1 / P2 | Directeur P1 (grille) | Verdict |
|---|---|---|---|---|---|
| — | `main` | 18 / 15 | 21 / 21 | 8 (relu : 5) | référence |
| contrôle | `main-bis` identique | 18 / 15 | 21 / 21 | 8 | déterministe |
| contrôle | `main-para` paraphrase | 17 / 14 | 18 / 18 | 7 | bruit : −1 à −3 |
| R1 personne, pas poste | écrite comme une annonce | **22** / 22 | 21 / 21 | 9 | **neutre** (non démontrée ; BA +4 à la limite du bruit, dans le mauvais sens) |
| R2 vocabulaire des profils | intitulé brut de l'annonce | 19 / 19 | 22 / 22 | 7 | **neutre** — Exa absorbe « (H/F) », « – Expérimenté » |
| R2 deux variantes | une seule variante | 18 / 18 | 21 / 21 | 7 | **neutre** |
| R3 2 à 4 compétences distinctives | toutes les compétences de la fiche | 20 / 19 | 19 / 19 | 8 | **neutre** |
| R4 années explicites | sans années | — | — | 7 | **neutre** (et non vérifiable par la grille) |
| R5 exclure administratif et savoir-être | ajoutés | 22 / 16 | 19 / 19 | 5 | **légèrement négatif** (−2 et −3 sur 2 fiches) |
| **R6 localisation en clair** | **sans localisation** | 18 / 16 — lieu 22 vs 25 | 19 / 19 — lieu 22 vs 25 | **1** | **CONFIRMÉE** : −7 quand la région est rare, −3 sur le lieu ailleurs |
| **R7 une phrase de 15 à 30 mots** | **3-4 mots** (« Business Analyst Paris ») | 25 / 18 | 21 / **13** | 8 | **CONFIRMÉE sur P2** : P1 monte (tout le monde s'appelle « Business Analyst »), la spécialité s'effondre (Back-end −8) |
| **R8 secteur** | sans secteur (BA) | 17 / **9** | — | — | **CONFIRMÉE** : −6 sur la spécialité |

Et un constat qui ne figurait pas dans B1 :

- **La précision du domaine se paie en intitulés.** `main` BA encode « épargne salariale et
  retraite » (pris dans les **missions** de la fiche, pas dans ses critères) : P1 tombe à 18
  contre 23 pour (a), mais la relecture compte **7 profils de l'épargne, de la retraite ou de
  l'assurance de personnes** dans `main` contre **2 à 3** dans (a) et (b). Le moteur rend ce
  qu'on lui décrit : une requête fine rend moins de profils « au bon titre » et plus de profils
  « du bon métier ». C'est au recruteur de régler ce curseur, d'où le champ éditable.

**Règles retenues** (celles qui ont un effet) : localisation en clair · secteur · 2 à 4
compétences distinctives dans une phrase de 15 à 30 mots · pas d'administratif ni de
savoir-être. **Conservées sans gain mesuré**, pour la lisibilité du champ : forme « personne »,
intitulé au vocabulaire des profils, années quand la fiche les porte. **Aucune règle ne
justifie à elle seule un appel LLM.**

### 3.3 B2 — (a) déterministe, (b) LLM, main

Requêtes produites :

| Fiche | (a) déterministe | (b) LLM |
|---|---|---|
| BA | Business Analyst expérimenté, secteur financier, Parcours digitaux et sensibilité UX, basé à Paris | Business Analyst confirmé, expertises fonctionnelles secteur financier, parcours digitaux et UX, basé à Paris |
| Back-end | Développeur back end confirmé, Node.js ou Python, API RESTful, SQL ou NoSQL, Docker | Développeur back-end confirmé, Node.js ou Python, API RESTful, SQL et NoSQL, Docker, basé en France |
| Directeur | Directeur de Département Opérations Industrielles confirmé, 10 à 15 ans d'expérience, transformation industrielle ou projet d'automatisation majeur, l'excellence opérationnelle, pilotage de la performance industrielle, basé à Belfort | Directeur des opérations industrielles confirmé, 10 à 15 ans d'expérience, transformation industrielle, excellence opérationnelle, performance industrielle, basé à Belfort |

Résultats (25 premiers) :

| Fiche | (a) P1 / P2 | (b) P1 / P2 | main P1 / P2 | Communs a∩b | Communs a∩main |
|---|---|---|---|---|---|
| BA | **23** / 23 | 22 / 22 | 18 / 15 (spécialité épargne : 7 vs 2-3) | 13 | 2 |
| Back-end | 21 / 21 | 21 / 20 | 21 / 21 | 15 | 18 |
| Directeur (relu) | 4 | **5** | 5 | 10 | 14 |

**Verdict mesuré : égalité.** Sur les trois fiches, (a) et (b) sont dans le bruit l'une de
l'autre (écarts de 0 à 1). La mesure ne départage pas la méthode ; elle départage le
**contenu** (§3.2).

**Ce qui départage, observé et non mesuré** : (a) produit des défauts visibles là où la fiche
est rédigée en phrases — intitulé brut « Directeur de Département… », article résiduel
« l'excellence opérationnelle », « SQL **ou** NoSQL » là où la fiche dit « et » (issu des
mots-clés), fragment de 27 mots — et **omet la localisation** quand la fiche ne donne que
« Télétravail partiel », là où (b) écrit « basé en France » comme la règle le demande. Or la
requête s'affiche **dans un champ que le recruteur lit et corrige** : une phrase bancale y coûte
une correction manuelle à chaque recherche, et la fiche en phrases est le cas courant (45 des
60 critères critiques et très importants de la base de dev n'ont pas de mots-clés).

**Décision : (b), repli (a)** en cas d'échec du LLM ou de sortie invalide (la validation vérifie
la longueur 15-30 mots et que chaque critère est dans `encoded` ou `notEncoded`). Coût mesuré
**0,006 $ et 1,8 à 2,3 s** par génération (gpt-4o, 1 850 tokens avec les exemples). Le champ
**`query_generated`** et la requête réellement envoyée au premier lancement sont stockées : si
l'indicateur du §17.3 montre que (b) n'est pas moins corrigé que ne le serait (a), on bascule
sur (a) sans regret — l'égalité mesurée le permet.

### 3.4 Prompt retenu (b) — livrable

**Système :**

```
Tu rédiges UNE requête pour un moteur de recherche sémantique de profils professionnels (type LinkedIn).

La requête décrit la PERSONNE idéale, comme la première ligne de son profil — jamais le poste ni l'entreprise qui recrute.

Règles, toutes obligatoires :
1. Une seule phrase, 15 à 30 mots, en français, sans guillemets, sans opérateurs (AND, OR, -, parenthèses).
2. Ordre : séniorité → intitulé → 2 à 4 compétences distinctives → secteur → localisation.
3. Intitulé : le vocabulaire que les professionnels écrivent sur LEUR profil, pas l'intitulé de l'annonce. Retire « (H/F) », les codes internes, les sigles propres au client. Tu peux donner DEUX variantes courantes séparées par « / » (ex. « Consultant AMOA / Business Analyst »), jamais trois.
4. Années d'expérience : écris-les UNIQUEMENT si la fiche les porte (ex. « 10 à 15 ans d'expérience »). N'en invente jamais.
5. Compétences : uniquement des savoir-faire DISTINCTIFS du métier, pris dans les critères critiques et très importants. Exclus : savoir-être (leadership, rigueur, relationnel…), compétences génériques (pack Office, anglais, Git pour un développeur…), administratif (contrat, salaire, disponibilité, autorisation de travail, télétravail), toute négation.
6. Secteur : seulement s'il est explicite dans la fiche ou déductible sans doute d'un sigle métier expliqué dans la fiche.
7. Localisation : la ville ou la région en clair (« basé à Lyon », « région de Belfort »). Si la fiche ne donne que « télétravail » ou rien, écris « basé en France ».
8. Tu n'inventes RIEN qui ne soit dans la fiche : ni technologie, ni secteur, ni ville.

Rends un JSON : { "query": string, "encoded": [libellés EXACTS des critères encodés], "notEncoded": [{ "label": libellé EXACT, "reason": raison courte }] }. Chaque critère de la fiche apparaît dans encoded OU notEncoded.
```

**Entrée** (une par recherche) : `Intitulé : … | Séniorité : … | Localisation : …` puis
`Critères :` une ligne `- <niveau> | <libellé>` par critère. Température 0. Les 3 fiches de
l'étude ne figurent **pas** dans les exemples.

**Les 5 exemples fiche → requête** (passés en tours user/assistant) :

| # | Fiche (résumé) | Requête attendue | Non encodés (raison) |
|---|---|---|---|
| 1 | Consultant AMOA Trade Finance (H/F), senior, Paris La Défense ; critique 8 ans AMOA financement du commerce international ; critique crédits documentaires et garanties ; TI SWIFT MT7xx ; important anglais ; souhaitable esprit d'équipe | Consultant AMOA / Business Analyst senior, 8 ans d'expérience en Trade Finance, crédits documentaires et garanties internationales, SWIFT MT7xx, banque, basé à Paris | anglais (générique) ; esprit d'équipe (savoir-être) |
| 2 | Développeur Full Stack JS – Pôle Assurance Vie, confirmé, Lyon (69) ; critique TypeScript React Node.js ; critique secteur assurance ; TI API REST ; TI Git ; important autonomie et rigueur | Développeur full-stack confirmé TypeScript, React et Node.js, conception d'API REST, secteur assurance, basé à Lyon | Git (générique) ; autonomie et rigueur (savoir-être) |
| 3 | Responsable Paie & ADP, confirmé, Boulogne-Billancourt ; rédhibitoire autorisation de travail ; critique 5 ans paie multi-conventions ; critique Syntec ; TI logiciel de paie ADP/Silae/SAP HR ; important management de 3 gestionnaires | Responsable paie et administration du personnel confirmé, 5 ans d'expérience, paie multi-conventions, convention Syntec, ADP ou Silae, basé en Île-de-France à Boulogne-Billancourt | autorisation de travail (administratif) ; management (niveau important) |
| 4 | Project Manager – Data Protection, confirmé, Nanterre ; critique piloter le programme ; critique structurer les initiatives de protection des données critiques ; TI business case, ROI, budget ; important technologies chiffrement/DLP/IAM | Chef de projet / Program Manager confirmé en protection des données, pilotage de programme data protection, business case et budget, basé en Île-de-France à Nanterre | technologies (niveau important) |
| 5 | Chargé(e) de recrutement IT – CDD 6 mois, junior, Télétravail 100 % ; critique sourcing de profils techniques ; TI cabinet de recrutement ; TI disponibilité immédiate ; important excellent relationnel | Chargé de recrutement IT / Talent Acquisition junior, sourcing de profils techniques développeurs et DevOps, expérience en cabinet de recrutement, basé en France | disponibilité (administratif) ; relationnel (savoir-être) |

Le texte intégral des exemples (libellés exacts) sera versé dans
`src/lib/sourcing/query-prompt.ts` en Phase 2 ; ce tableau en est la source.

### 3.5 Ligne « critères encodés »

L'écran de requête affiche `encoded` et `notEncoded` avec leur raison (maquette §14.2) : le
recruteur voit **ce que la requête ne cherche pas** avant de lancer. En repli (a), les raisons
sont celles du code (niveau, administratif, savoir-être, au-delà de 4).

### 3.6 Couverture limitée d'une zone — le dire au recruteur

Mesuré (§3.3) : autour de Belfort, **5 directeurs pertinents sur 25 quelle que soit la
requête** ; 9 profils sur 25 seulement sont dans la zone, contre 25 sur 25 à Paris. La limite
est l'index, pas la formulation. Sans explication, le recruteur voit une liste mauvaise et
réécrit sa requête en vain.

**Règle (déterministe, sans géocodage) :**
1. **Zone demandée** = la ville de la fiche (`location`, nettoyée comme pour la requête). Fiche
   sans ville (« Télétravail », vide) ⇒ **pas de contrôle**.
2. **Termes de zone** = la ville + la **région** lue dans les localisations Exa qui contiennent
   cette ville (format LinkedIn « Ville, Région, Pays » : « Belfort, Bourgogne-Franche-Comté,
   France » donne « Bourgogne-Franche-Comté »). Aucune table de communes à maintenir.
3. Un profil est **dans la zone** si sa localisation (profil ou poste actuel) contient un terme
   de zone, comparaison repliée (casse, accents).
4. **Moins de 40 % des profils affichés dans la zone** ⇒ bandeau en tête de liste (maquette
   §14.3), et chaque carte hors zone porte sa localisation en évidence. Le seuil sépare les cas
   mesurés, recomptés avec cette règle sur les 25 premiers : Belfort **28 %** (7/25 ; « Greater
   Besancon Area » n'a pas de région et ne compte pas — imperfection assumée), Lyon **88 %**
   (sonde du matin), Paris **100 %**.

Le bandeau n'est ni un filtre ni un tri : l'ordre Exa est conservé. Il propose deux gestes
réels — élargir la zone dans la requête (région), ou garder la liste en assumant la mobilité —
et ne suggère jamais de relancer la même requête (identique ⇒ résultats identiques, §2.4).

---

## 4. Disponibilité « en recherche » (B3)

### 4.1 Mesure (306 profils)

Zones lues : **intitulé du poste actuel**, **titre de profil** (lignes 2-3 du texte ; la
ligne 1, le nom, n'est jamais lue), **section About**. Jamais `## Social` : une republication
« je recherche un poste » y est la phrase d'un tiers.

- **13 profils sur 306 (4,2 %)** portent une formulation de disponibilité.
- Zones : About 11, titre de profil 3 (un profil peut cumuler).
- Langue : 9 occurrences en français, 5 en anglais.
- Formulations observées : « à la recherche d'un nouveau challenge » (avec « activement »),
  « actuellement ouvert à des opportunités », « à la recherche d'opportunités », « je
  recherche un poste de … », « Recherche d'un poste en … », « souhaite aujourd'hui relever un
  nouveau défi professionnel », « disponible immédiatement », « Disponible » et « Available »
  en segment isolé du titre, « seeking an exciting opportunity », « Available ASAP »,
  « available for freelance or consulting assignments », « Available for new … opportunities »,
  « à la recherche d'une opportunité internationale (VIE…) ».

Conséquence à dire : le badge sera **rare** (≈ 2 profils par paquet de 50). Il signale, il ne
trie presque rien.

### 4.2 Liste fermée (expressions complètes, insensibles à la casse)

| Langue | Expression |
|---|---|
| FR | `(je suis) (actuellement\|activement\|aujourd'hui\|désormais) à la recherche d'un·e (nouveau·elle) poste \| emploi \| CDI \| challenge \| défi \| opportunité \| mission \| collaboration \| expérience professionnelle` (aussi « en recherche d'un… ») |
| FR | `à la recherche (active) de nouvelles opportunités \| d'opportunités` — sauf suivi de « de financement \| de marché \| business \| de croissance » |
| FR | `je recherche (activement\|actuellement) un·e (nouveau·elle) poste \| emploi \| CDI \| opportunité \| mission \| challenge` |
| FR | `Recherche d'un poste \| d'un emploi \| d'un CDI` en début de phrase ou de segment |
| FR | `ouvert·e à (de nouvelles \| des \| toutes) opportunités` |
| FR | `souhaite (aujourd'hui \| désormais) relever un nouveau défi \| challenge professionnel` |
| FR | `disponible immédiatement \| dès maintenant \| dès aujourd'hui \| rapidement \| de suite` |
| FR | `en recherche active \| en recherche d'emploi` |
| FR | `à l'écoute du marché \| d'opportunités` |
| FR | `Disponible` seul, en segment du titre délimité par `\|`, `•`, `·`, `–`, `-` |
| EN | `open to (new \| exciting) opportunities \| roles \| positions \| work \| job offers` ; `#OpenToWork` |
| EN | `(currently \| actively \| now) (looking \| seeking \| searching) for a \| an \| my \| new (new \| exciting \| full-time \| permanent) role \| position \| job \| opportunity \| challenge` |
| EN | `(I am \| I'm \| am now \| now) seeking a \| an \| my next (new \| exciting) opportunity \| role \| position \| challenge` |
| EN | `available for (new \| freelance \| consulting) … opportunities \| missions \| assignments \| projects \| roles` |
| EN | `available immediately \| ASAP \| now` ; `Available` seul en segment du titre |

**Faux amis — excluent la phrase même si une expression y figure** :

| Motif | Exemple observé ou typique |
|---|---|
| stage, internship, alternance, apprentissage, fin d'études | « à la recherche d'un stage de fin d'études » (autre population) |
| ingénieur de recherche, research engineer, recherche et développement, R&D | « Ingénieur de recherche au CNRS » |
| recherche de financements \| solutions \| moyens \| performance | « Recherche de financements : crédits documentaires » (observé) |
| êtes-vous \| si vous (êtes \| recherchez) \| vous recherchez \| looking for a … developer? | « Êtes-vous à la recherche d'un développeur React ? » (observé, démarchage de freelance) |
| constamment \| toujours \| always (à la recherche \| seeking \| looking \| open) | « constamment à la recherche de nouveaux défis » (observé, trait de caractère) |

**Non retenus, délibérément** : « recherche » seul ; « Freelance » (fréquent dans les
intitulés observés, non compté : un statut, pas une recherche) ; « let's connect and explore opportunities » (observé, formule de
réseautage) ; « Disponible en remote » (observé, modalité de travail).

### 4.3 Comportement
- Détection **déterministe à l'ingestion**, rien dans la requête. Résultat stocké dans
  `exa_snapshot.availability = { matched: true, expression, zone }`.
- Badge **« En recherche »** sur la carte, avec l'expression en infobulle.
- Case **« En recherche d'abord »**, **cochée par défaut, mémorisée par recruteur**
  (`recruiters.sourcing_available_first`). Tri **stable** : groupe « en recherche » puis le
  reste, **ordre Exa conservé dans chaque groupe**. Jamais un filtre : décocher remet l'ordre
  Exa pur, rien n'est jamais masqué.

### 4.4 Cas de test (21 cas, tous passés sur le détecteur de l'étude)

- **Positifs** : « Je suis actuellement à la recherche d'un nouveau poste de chef de projet. » ·
  « En recherche active, disponible immédiatement. » · « Ouverte à de nouvelles opportunités en
  AMOA. » · « I am currently looking for a new role in data engineering. » · « Open to new
  opportunities. » · « #OpenToWork » · « Je suis à la recherche d'une opportunité internationale
  (VIE ou contrat local). » · titre « Lead Developer | React | Disponible ».
- **Négatifs** : « Let's connect and explore opportunities to collaborate. » · « Disponible en
  remote depuis Lyon. » · « Always open to discussing technical challenges. » · « Le jeu est
  disponible ici. »
- **Faux amis** : « Ingénieur de recherche au CNRS, spécialiste de la recherche et
  développement. » · « Research engineer at INRIA. » · « Je recherche des solutions innovantes
  pour mes clients. » · « Constamment à la recherche de nouveaux défis pour enrichir mon
  savoir. » · « Êtes-vous à la recherche d'un développeur expérimenté en React ? » · « Si vous
  recherchez un collaborateur passionné, contactez-moi. » · « Actuellement à la recherche d'un
  stage de fin d'études. » · « Looking for a Node, Symfony, Laravel developer? » · « Recherche de
  financements : crédits documentaires. »

---

## 5. Mentions déterministes (B4)

### 5.1 Mesure

Sur les 25 profils de la requête (b) de chaque fiche, critères critiques et très importants :

| Fiche | Source des termes | Profils avec mention, par critère |
|---|---|---|
| Back-end | **mots-clés** de la fiche | Node.js/Python 22 · API 13 · SQL/NoSQL 22 · Docker 22 · Git 7 |
| BA | libellé, amorces retirées | « secteur financier » 1 · « parcours digitaux » 0 · « UX » 1 |
| Directeur | libellé, amorces retirées | « 10 à 15 ans » — · « transformation industrielle » 1 · « projet d'automatisation majeur » 0 · « excellence opérationnelle » 6 · « pilotage de la performance industrielle » 0 |

Retirer les accents des deux côtés ne change aucun compte sur ces fiches ; on normalise
quand même (un « developpement » sans accent existe). Base de dev : **15 des 60 critères
critiques et très importants ont des mots-clés**.

**Constat** : les mentions valent quelque chose **quand la fiche a des mots-clés ou nomme des
technologies** ; sur une fiche rédigée en phrases fonctionnelles, elles sont presque toujours
vides. Le libellé entier ne se retrouve jamais tel quel ; seul l'**atomiser** en termes courts
donne une chance.

### 5.2 Règle

1. Critère critique ou très important **avec mots-clés** ⇒ termes = mots-clés.
2. **Sans mots-clés** ⇒ libellé → amorces retirées (§5.3) → découpé sur `,` `;` `/` « et »
   « ou » et les parenthèses → articles de tête retirés → on garde les termes de **1 à 4 mots**.
   Un terme de 3 caractères ou moins (UX, SQL, ROI) n'est retenu que s'il est **en majuscules
   dans le libellé**, et se cherche alors **sensible à la casse** (« Prince » ≠ « prince »).
3. **Aucun terme** — libellé de durée (« 10 à 15 ans »), libellé verbal (« Piloter le
   programme… », « Définir la vision… »), ou tous les termes > 4 mots ⇒ la carte affiche
   **« — pas de mention (critère rédigé en phrase) »** pour ce critère.
4. Recherche : matcher existant `findMatchedKeywords` (`src/lib/scoring/keyword-matcher.ts:87`,
   frontières de mot Unicode) sur texte et termes **repliés** (NFD sans diacritiques, `’`→`'`),
   dans parcours, formation, titre de profil, About, Skills — jamais `## Social`.
5. Affichage : `✓ terme` pour chaque terme trouvé, `—` pour un critère sans terme trouvé,
   légende fixe « mots de la fiche retrouvés dans le profil — indice de lecture, pas une
   évaluation ». **Sans effet sur l'ordre, pas de compteur, pas de filtre.**

### 5.3 Amorces retirées (liste fermée, appliquée en tête, jusqu'à 3 passes)

| Famille | Formes |
|---|---|
| expérience | (une \| un) (solide \| bonne \| excellente \| forte) (première) expérience(s) (confirmée \| significative \| solide \| réussie \| avérée \| opérationnelle) (de \| d' \| d'un·e \| en \| du \| des \| dans le·la·les·l' \| avec \| sur (le \| la)) (la \| le \| les \| l') |
| maîtrise | (parfaite \| bonne \| excellente) maîtrise (du \| de la \| de l' \| des \| de \| d') |
| connaissance | (bonne \| solide) connaissance(s) (approfondie(s) \| solide(s) \| opérationnelle(s)) (du \| de la \| de l' \| des \| de \| d' \| en) |
| culture | (solide \| forte) culture (de \| du \| de la \| de l' \| des) |
| pratique, utilisation | pratique \| utilisation (du \| de la \| de l' \| des \| de \| d') |
| compétence | compétence(s) (en \| sur \| dans) |
| capacité, sensibilité | capacité à ; sensibilité (aux \| à la \| à l' \| au \| à) |
| expertise | expertise(s) (fonctionnelle(s) \| technique(s)) (dans le·la·les·l' \| en \| sur) |
| aptitudes | savoir \| aptitude à \| goût pour \| appétence pour |
| **suffixes** | (exigé·e·s \| requis·e·s \| souhaité·e·s \| obligatoire(s) \| indispensable(s) \| apprécié·e·s \| un plus \| impératif), entre parenthèses ou non |

Exemples sur la base de dev : « Solide culture de l'excellence opérationnelle » → excellence
opérationnelle · « Compétences en RGPD, CMDB, ITIL V3, PMP, Prince, CIS, NIST, Anglais » →
RGPD · CMDB · ITIL V3 · PMP · Prince · CIS · NIST · Anglais · « Expérience confirmée de 10 à 15
ans » → aucune mention · « Piloter le programme Data Protection » → aucune mention.

---

## 6. Coordonnées du titulaire

### 6.1 Règle d'extraction (déterministe, à l'ingestion)

1. **Sections lues** : titre de profil (lignes 2-3) et `## About`. **Jamais** : Experience
   (on y cite des clients, des équipes), Education, Recommendations, Social, ni aucune autre.
2. **Email retenu** si les trois conditions tiennent :
   - la partie locale n'est **pas fonctionnelle** (`contact`, `info`, `rh`, `hr`, `jobs`,
     `recrutement`, `careers`, `hello`, `admin`, `support`, `team`, `candidature`…) ;
   - les 80 caractères qui précèdent ne portent **pas d'indice de tiers** (recommand-, manager,
     collègue, notre équipe, recruteur, « candidatures à », « envoyez votre CV », « apply at ») ;
   - **et** soit la partie locale contient le **prénom ou le nom** du titulaire (repliés, > 2
     caractères), soit les 80 caractères qui précèdent portent une **formule à la première
     personne** (« contactez-moi », « me contacter », « me joindre », « écrivez-moi », « reach
     me », « connect with me … at », « email me », « par e-mail », « 📧 », « ✉️ »).
3. **Tout le reste est jeté**, et d'abord le doute. Les adresses jetées ne sont **ni stockées
   ni comptées par personne** ; seul un compteur agrégé est journalisé à l'ingestion.

### 6.2 Taux observé (306 profils)

| | Trouvés | Retenus | Rejetés |
|---|---|---|---|
| Email | 9, **tous dans About** | **7** (6 par nom, 1 par formule à la 1re personne) | **2** « non attribuable » : un en tête d'About sans formule ni nom, un précédé du nom d'une autre personne |
| Téléphone | **0** avec libellé | 0 | — |

Conséquence : « Contacter par email » apparaîtra sur **≈ 1 profil sur 45** ; l'écran ne doit
pas laisser croire que c'est courant.

### 6.3 Téléphone — règle DORMANTE (hors périmètre, §1.6)

Aucune action, aucune colonne, aucun champ de `exa_snapshot`. Règle conservée pour le jour où
un volume réel de téléphones serait observé : retenu seulement dans le titre de profil ou
About, et **précédé d'un libellé** (« tél », « téléphone », « mobile », « portable », « phone »,
« WhatsApp ») — une suite de chiffres sans libellé n'est jamais un téléphone (c'est ce qui a
fabriqué le faux « 10/150 » : des identifiants de publications dans `## Social`). Mesure du
13/09 : **0 sur 306**. La projection ne le lit pas.

---

## 7. Données

### 7.1 Empreinte et exclusions
`fingerprint = HMAC-SHA256(SOURCING_FINGERPRINT_PEPPER, url)` — URL en minuscules, sans query ni
`/` final ; repli sur l'`id` Exa. Pepper absent ⇒ module désactivé. Dédoublonnage d'un nouvel
appel contre : **tous les profils de la campagne** (quel que soit leur état, réserve comprise),
les exclusions de la campagne, les oppositions globales.

### 7.2 Tables (brouillon — entreront dans `migrate.sql` en Phase 2, après le préalable RGPD)

```sql
create table if not exists public.sourcing_searches (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      text not null references public.campaigns(id) on delete cascade,
  query            text not null,                       -- envoyée
  query_generated  text not null,                       -- produite (b) ou (a)
  query_method     text not null check (query_method in ('llm','deterministic')),
  language         text not null check (language in ('fr','en')),
  returned         int  not null,
  new_after_dedup  int  not null,
  exa_request_id   text,
  exa_cost_usd     numeric(10,5),
  llm_cost_usd     numeric(10,5),
  created_by       uuid,
  created_at       timestamptz not null default now()
);

create table if not exists public.sourcing_profiles (
  id                 uuid primary key default gen_random_uuid(),
  search_id          uuid not null references public.sourcing_searches(id) on delete cascade,
  campaign_id        text not null references public.campaigns(id) on delete cascade,
  fingerprint        text not null,
  exa_rank           int  not null,
  state              text not null,
  exa_snapshot       jsonb not null,                    -- projection §7.3 ; la ligne est SUPPRIMÉE à la purge
  decided_at         timestamptz,
  decided_by_user_id uuid,
  created_at         timestamptz not null default now(),
  unique (campaign_id, fingerprint)
);
alter table public.sourcing_profiles drop constraint if exists sourcing_profiles_state_chk;
alter table public.sourcing_profiles add constraint sourcing_profiles_state_chk
  check (state in ('reserve','to_review','contacted'));   -- declined / manifested / clôture ⇒ ligne supprimée

create table if not exists public.sourcing_exclusions (
  fingerprint  text not null,
  campaign_id  text references public.campaigns(id) on delete cascade,   -- NULL = opposition globale
  reason       text not null check (reason in ('declined','contacted','manifested','opposed')),
  created_at   timestamptz not null default now()
);
create unique index if not exists sourcing_exclusions_uq
  on public.sourcing_exclusions (fingerprint, coalesce(campaign_id, ''));

create table if not exists public.sourcing_approaches (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid references public.sourcing_profiles(id) on delete set null,
  campaign_id     text not null references public.campaigns(id) on delete cascade,
  fingerprint     text not null,
  recruiter_id    uuid not null,
  channel         text not null check (channel in ('linkedin','email')),
  message_format  text check (message_format in ('connection_note','inmail','email')),
  token_hash      text not null unique,
  status          text not null default 'active',
  initiated_at    timestamptz not null default now(),
  first_opened_at timestamptz,
  submitted_at    timestamptz,
  analysis_id     text,
  created_at      timestamptz not null default now()
);
alter table public.sourcing_approaches drop constraint if exists sourcing_approaches_status_chk;
alter table public.sourcing_approaches add constraint sourcing_approaches_status_chk
  check (status in ('active','submitted','admission_pending','revoked'));

alter table public.recruiters add column if not exists sourcing_message_format text;
alter table public.recruiters add column if not exists sourcing_available_first boolean not null default true;
alter table public.app_settings add column if not exists sourcing_config jsonb;
```

Supprimer la ligne profil à la purge (plutôt que la vider) suit le verdict **EFFACER** : le
dédoublonnage n'en a pas besoin, il vit dans `sourcing_exclusions`. Les compteurs de l'onglet
(vus / approchés / manifestés) se lisent sur les profils vivants, les exclusions et les
approches. RLS activée sans policy. Double application en dev avant tout déploiement.

### 7.3 `exa_snapshot` — projection stockée (pure, testée)

```ts
type ExaSnapshot = {
  url: string;                       // pour « Ouvrir le profil » ; part avec la ligne
  name: string; firstName: string | null;
  location: string | null;
  headline: string | null;           // lignes 2-3 du texte
  current: { title: string; company: string | null; since: string | null } | null;
  workHistory: { title: string; company: string | null; location: string | null; from: string | null; to: string | null }[];
  education: { degree: string | null; institution: string | null; from: string | null; to: string | null }[];
  about: string | null;
  skills: string | null;             // section Skills brute
  languages: string | null; certifications: string | null;
  highlight: string | null;
  indexedAt: string | null;          // publishedDate
  contacts: { emails: string[] };    // §6 — titulaire seulement ; pas de téléphone (§6.3)
  availability: { expression: string; zone: 'title' | 'headline' | 'about' } | null;   // §4
  mentions: { criterionId: string; found: string[] }[];                                // §5
};
```

**Jamais** : `image`, `## Recommendations`, `## Honors`, `## Projects`, `## Publications`,
`## Organizations`, ids d'organisation Exa. Test : un champ Exa **inconnu** fait échouer la
projection (on ne stocke pas ce qu'on n'a pas décidé de stocker).

**`## Social` — le garde-fou le plus important de l'ingestion.** La section est **coupée du
texte AVANT toute autre étape** : la projection, la détection de disponibilité, les mentions et
l'extraction d'email ne reçoivent que le texte déjà amputé, jamais le texte brut Exa. Un seul
point de découpe (`stripExcludedSections`), appelé en tête de l'ingestion ; aucune fonction
aval n'accepte le texte brut en paramètre. Raison : 56 profils sur 306 portent cette section,
faite de publications et de **republications de tiers** — opinions, santé, religion observées —
et un « je recherche un poste » republié y est la phrase de quelqu'un d'autre. Test dédié
(§16) : un profil dont seule la section Social porte une expression de disponibilité **et** un
terme de critère ⇒ ni badge, ni mention, et aucune chaîne de la section dans `exa_snapshot`.

---

## 8. Approche

### 8.1 Message (seul appel LLM par profil, au clic)
Entrée : poste, localisation, prénom et intitulé actuel du profil, 1 à 2 lignes du parcours
qui justifient l'approche, prénom du recruteur, lien. Sortie contrainte par format :

| Format | Contrainte | Canal |
|---|---|---|
| `connection_note` | ≤ 300 caractères **lien compris**, vérifié par le code (tronque puis réessaie une fois, sinon modèle déterministe) | LinkedIn |
| `inmail` | ≤ 1 200 caractères, objet ≤ 80 | LinkedIn |
| `email` | objet + corps ≤ 1 200 caractères, **ligne d'information obligatoire** ajoutée par le code : « Vos données proviennent de votre profil professionnel public ; le lien ci-dessous explique leur usage et comment vous y opposer. » | `mailto:` |

Aucun message ne contient de score, de mention ou de critère. Le recruteur peut éditer avant de
copier. Coût estimé ≈ 0,002 $.

### 8.2 Jeton
128 bits base64url (générateur de `src/lib/scheduling/tokens.ts:13-25`), **stocké haché**
(`token_hash`). Composé une fois au clic. « Recopier » réémet et révoque l'ancien **tant que le
lien n'a jamais été ouvert** ; après ouverture, on recopie sans réémettre.

### 8.3 Gestes
- **Se connecter** : `window.open(url)` puis `navigator.clipboard.writeText(message)` dans le
  **même** handler. Si la copie échoue (permission), le panneau affiche le message sélectionné
  pour un Ctrl+C, jamais un échec muet.
- **Contacter par email** : `mailto:` avec `subject` et `body` encodés ; si l'URL dépasse
  ~1 800 caractères, on copie le corps et le `mailto:` ne porte que l'objet.
- Chaque geste : profil ⇒ `contacted`, exclusion `contacted`, journal
  `sourcing_contact_initiated { channel }`.

---

## 9. Page d'atterrissage `/s/[token]`

### 9.1 Gardes
Jeton inconnu, révoqué, module désactivé ⇒ **page neutre** « Cette invitation n'est plus
disponible. » (jamais 404 sur un lien reçu). Campagne clôturée ⇒ « Cette offre n'est plus
ouverte. », aucune donnée affichée. Campagne suspendue ⇒ « Ce recrutement est
momentanément suspendu, votre lien reste valable. »

### 9.2 Contenu
Branding du cabinet · message du recruteur en rappel · poste · **bandeau d'information
(art. 14)** « Pré-rempli à partir de votre profil professionnel public · supprimé à la clôture
de ce recrutement · responsable de traitement : <client> · contact : <DPO> ·
[je ne souhaite pas être recontacté·e] » (⇒ opposition globale, page de confirmation dédiée) ·
récapitulatif **en lecture seule** : parcours, formation, résumé, avec **« corriger ✎ » ligne à
ligne** · email **pré-rempli s'il est connu, à confirmer** · téléphone optionnel · CV
facultatif (PDF ou DOCX, 10 Mo) · **une case obligatoire** « Ces informations sont exactes et
peuvent être utilisées pour ma candidature » · bouton « Envoyer ma candidature ».

Jamais affichés : photo, mentions, disponibilité détectée, données hors parcours/formation/résumé.

### 9.3 Proxy et débit
`/api/sourcing/approach` dans `API_SELF_AUTHENTICATED` ; `/s/` au régime `noindex` + `no-store` +
`no-referrer` ; ouverture et soumission limitées **fail-closed** en base
(`src/lib/jobboard/rate-limit.ts:43-70`). `sourcing_link_opened` à la **première** ouverture.

---

## 10. Manifestation — `admitSourcedCandidate`

1. **Réservation conditionnelle** (`submitted_at is null and status = 'active'`).
2. **Garde** : campagne `active` + `canInviteForCampaign`
   (`src/lib/agents/server/interview-mail.ts:100`) ; sinon réservation relâchée et page
   « offre plus ouverte ».
3. **CV** : joint ⇒ `art_src_cvfile_<approachId>` ; sinon **CV structuré** déterministe
   (projection + corrections) ⇒ `art_src_cv_<approachId>`, mention « Profil confirmé par le
   candidat le [date] — source initiale : profil professionnel public ».
4. **Une analyse** : `analyzeCVApplication` (`src/lib/agents/server/cv-application-analyze.ts:213`)
   sur le texte du CV retenu, `source: 'sourcing'`.
5. **Zone forcée** : `decisionZone = 'auto_accept'`, `status = 'accepted'`, score et breakdown
   inchangés ; `persistCandidateAnalysisStrict` (`src/lib/db/repos/candidate-analyses.ts:325`),
   `id = uid = 'can_src_<approachId>'`, `decidedBy: 'user'` + recruteur de l'approche
   (`insertCandidateAnalysis` doit accepter `decided_by_user_*`, aujourd'hui forcés à `null`
   `:228-229`). Email et téléphone = **ceux saisis ou confirmés sur la page**.
6. **Outreach** : `dispatchCandidateOutreach(input, keys)` — refactor sans changement IMAP de
   `dispatchImapCandidateOutreach` (`src/lib/imap/outreach.ts:97`) ; clés sourcing `{ claim:
   { mailboxId: 'sourcing', uid: approachId }, analysisId: 'can_src_<approachId>' }` ; zone
   `auto_accept` ⇒ envoi direct, **aucune ligne HITL** ; lien de réservation natif idempotent
   sur l'`analysisId` ; briefing en file.
7. **Vivier** comme toute candidature, sans URL.
8. Profil : ligne **supprimée**, exclusion `manifested`, journal.
9. **Panne LLM** à l'étape 4 : la personne voit « Candidature bien reçue » ; approche
   `admission_pending`, reprise sur le rail ; jamais de décision en panne.

**Page de confirmation** : maquette §14.6.

---

## 11. Briefing et rapports

- CV joint au briefing **depuis l'artefact** quand le vivier ne l'a pas
  (`src/lib/interview/deliver-brief.ts:112-135`).
- **Tableau critères → verdict → citation**, pour **toute** candidature.
- Paragraphe « repêché sous le seuil » (`src/lib/agents/server/interview-brief-mail.ts:102`)
  remplacé, pour `source = 'sourcing'`, par « Profil approché par [recruteur] le [date] ».
- Compteur « issus du sourcing » par `candidate.source` (inventaire des lecteurs de `source`
  en Phase 2).

---

## 12. Purge et RGPD

### 12.1 Déclencheurs

| Évènement | Effet |
|---|---|
| Décliner | ligne supprimée, exclusion campagne |
| Manifestation | ligne supprimée, exclusion `manifested` |
| Opposition | lignes de l'empreinte supprimées sur toutes campagnes, exclusion globale |
| **Clôture** (toute) | hook sur `POST /api/campaigns/[id]/close` : lignes de la campagne supprimées ; exclusions gardées |
| Filet | rail de drain (`src/lib/scheduling/events.ts:89`) : campagne ni `active` ni `paused` portant encore des lignes ⇒ même purge, fail-soft |

Journal `sourcing_profiles_purged { campaignId, count, byState }` si `count > 0`.

### 12.2 Script `purge:candidate`
Reconnaît `can_src_` (`src/lib/gdpr/resolve.ts:42` ne connaît que `can_imap_`) et `art_src_` ;
`sourcing_approaches` d'un manifesté pseudonymisée ; option **`--linkedin-url`** pour un profil
non manifesté (empreinte ⇒ lignes supprimées + opposition). Verdicts : `sourcing_searches`
**CONSERVER** · `sourcing_profiles` **EFFACER** · `sourcing_exclusions` **CONSERVER** ·
`sourcing_approaches` **PSEUDONYMISER**.

### 12.3 Préalable Phase 2
Registre typé `table → EFFACER | PSEUDONYMISER | CONSERVER` + test qui parse les `create table`
de `scripts/migrate.sql` et échoue sur une table sans verdict ou un verdict orphelin. Signalera
d'emblée `job_postings` (09/09), absente de `docs/ops/purge-rgpd-candidat.md`.

---

## 13. Flag et proxy

Deux étages **fail-closed** : `SOURCING_ENABLED === '1'` + `EXA_API_KEY` +
`SOURCING_FINGERPRINT_PEPPER` (modèle `src/lib/jobboard/flag.ts:19-21`), **et**
`app_settings.sourcing_config = { enabled, defaultLanguage: 'fr', batchSize: 50 }` (section admin
de `SettingsHub`). Désactivé ⇒ onglet absent (prop serveur filtrant `WorkspacePane.tsx:34-42`),
404 sur `/api/sourcing/**` sauf la route publique du jeton, page `/s/` neutre.

---

## 14. Maquettes

### 14.1 Onglet « Sourcing »

```
┌ Recrutement ─ Campagnes · Candidatures · Validations · Entretiens · [Sourcing] ──────────┐
│ Mes approches ce mois : 12  (LinkedIn 10 · email 2)                                      │
│                                                                                          │
│ Campagnes actives                                                                        │
│ ┌──────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ CAMP-2026-293  Business Analyst (Digital ESR)      Réf. Jane R.                       │ │
│ │ 150 vus · 7 approchés · 2 manifestés · dernière recherche il y a 3 j   [ Sourcer ]   │ │
│ ├──────────────────────────────────────────────────────────────────────────────────────┤ │
│ │ CAMP-2026-275  Directeur Opérations Industrielles  Réf. Sami B.                      │ │
│ │ Jamais sourcée                                                          [ Sourcer ]  │ │
│ └──────────────────────────────────────────────────────────────────────────────────────┘ │
│ Les campagnes suspendues gardent leurs profils ; la clôture les supprime.                │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 14.2 Écran de requête

```
┌ Sourcer — CAMP-2026-293 Business Analyst (Digital ESR) ─────────────────────────────────┐
│ Requête                                                                                  │
│ ┌──────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ Business Analyst confirmé, expertises fonctionnelles secteur financier, parcours     │ │
│ │ digitaux et UX, basé à Paris                                                          │ │
│ └──────────────────────────────────────────────────────────────────────────────────────┘ │
│ ↺ Revenir à la requête générée                    Langue  (•) Français  ( ) Anglais      │
│                                                                                          │
│ Critères encodés : Expertises fonctionnelles dans le secteur financier ·                 │
│                    Parcours digitaux et sensibilité UX                                   │
│ Non encodés : Méthodologies Agile (niveau important) · Outils GenAI appliqués (niveau    │
│               important) · Analyse et synthèse (savoir-être) · … 4 de plus ▾            │
│                                                                                          │
│ ⓘ Une localisation et un secteur précis changent nettement les résultats ;              │
│   une requête courte ramène des intitulés justes mais des métiers vagues.                │
│                                                                                          │
│ 100 profils par recherche · coût ≈ 0,10 $                              [ Lancer ]        │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 14.3 Liste et carte de profil

```
┌ CAMP-2026-293 · « Business Analyst confirmé, expertises fonctionnelles… » ──────────────┐
│ 50 affichés · 50 en réserve · 3 déjà vus écartés    [x] En recherche d'abord            │
│ Mes approches sur cette campagne : 7                              [ 50 de plus ]        │
│ ┌──────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ Claire M.                                             [En recherche] ⓘ              │ │
│ │ Business Analyst digital — Banque X — Paris · depuis 2 ans 4 mois                    │ │
│ │ profil indexé il y a 38 jours           ⓘ Peut-être déjà dans votre vivier          │ │
│ │ ── Parcours ───────────────────────────────────────────────────────────────────────── │ │
│ │ 05/2023 – auj.     Business Analyst digital — Banque X — Paris                        │ │
│ │ 09/2019 – 04/2023  Consultante AMOA épargne salariale — Cabinet Y — Paris             │ │
│ │ 2016 – 2019        Analyste fonctionnelle — Assureur Z             ▾ 3 postes de plus │ │
│ │ ── Formation ──────────────────────────────────────────────────────────────────────── │ │
│ │ 2014 – 2016        Master Systèmes d'information — Université W                       │ │
│ │ ── Résumé ─────────────────────────────────────────────────────────────────────────── │ │
│ │ « Business Analyst sur les parcours digitaux de l'épargne salariale, du cadrage à la │ │
│ │ recette… »                                                          voir plus ▾      │ │
│ │ Compétences · Langues · Certifications                                    voir ▾     │ │
│ │ ── Contact ────────────────────────────────────────────────────────────────────────── │ │
│ │ ✉ claire.m…@exemple.fr   (indiqué par la personne sur son profil)                    │ │
│ │ ── Mots de la fiche retrouvés ─────────────────────────────────────────────────────── │ │
│ │ Secteur financier  —          Parcours digitaux et UX  ✓ UX                          │ │
│ │ indice de lecture, pas une évaluation                                                │ │
│ │                                                                                      │ │
│ │ [ Ouvrir le profil ↗ ]  [ Décliner ]  [ Se connecter ▸ ]  [ Contacter par email ▸ ]  │ │
│ └──────────────────────────────────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ Hugo D.   Consultant AMOA — Mutuelle V — Courbevoie · depuis 6 mois                  │ │
│ │ …                                                     (pas de contact · pas de badge)│ │
│ │ [ Ouvrir le profil ↗ ]  [ Décliner ]  [ Se connecter ▸ ]                             │ │
│ └──────────────────────────────────────────────────────────────────────────────────────┘ │
│ Ordre : pertinence du moteur de recherche, profils « en recherche » d'abord si coché.   │
└──────────────────────────────────────────────────────────────────────────────────────────┘

Réserve épuisée :
│ 100 profils examinés — modifiez la requête pour relancer.   [ Modifier la requête ]     │
```

Couverture limitée (§3.6) — liste Directeur, fiche localisée à Belfort :

```
┌ CAMP-2026-275 · « Directeur des opérations industrielles confirmé, 10 à 15 ans… » ──────┐
│ ┌ ⓘ Couverture limitée pour cette zone ──────────────────────────────────────────────┐   │
│ │ 14 profils sur 50 sont dans la zone de Belfort (Bourgogne-Franche-Comté).          │   │
│ │ L'index public des profils couvre moins bien les régions peu peuplées : ce n'est   │   │
│ │ pas votre requête qui est en cause.                                                │   │
│ │ [ Élargir à la région dans la requête ]     [ Garder cette liste (mobilité) ]      │   │
│ └────────────────────────────────────────────────────────────────────────────────────┘   │
│ 50 affichés · 50 en réserve                          [x] En recherche d'abord           │
│ ┌──────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ Directeur d'usine — Industriel X — Belfort · depuis 3 ans                             │ │
│ │ …                                                                                    │ │
│ ├──────────────────────────────────────────────────────────────────────────────────────┤ │
│ │ Directeur des opérations industrielles — Groupe Y · ⚑ Nantes, hors zone               │ │
│ │ …                                                                                    │ │
│ └──────────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

« Élargir » remplace la ville par la région dans le champ de requête **sans lancer** : le
recruteur relit et lance (un nouvel appel, dédoublonné). « Garder » replie le bandeau pour
cette recherche ; les cartes hors zone restent marquées.

### 14.4 Panneau « Message copié »

```
┌ Message copié — collez-le dans l'invitation LinkedIn ─────────────────────────────┐
│ ┌───────────────────────────────────────────────────────────────────────────────┐ │
│ │ Bonjour Claire, votre parcours sur les parcours digitaux de l'épargne         │ │
│ │ salariale correspond à un poste de Business Analyst que nous ouvrons à Paris. │ │
│ │ Si cela vous intéresse : <lien>/s/…                                           │ │
│ └───────────────────────────────────────────────────────────────────────────────┘ │
│ 231 / 300 caractères                                                               │
│ Format  (•) Note de connexion   ( ) InMail          (préférence enregistrée)       │
│ [ Recopier ]            Le profil s'est ouvert dans un nouvel onglet.              │
└────────────────────────────────────────────────────────────────────────────────────┘
Copie refusée par le navigateur : le texte reste sélectionné — Ctrl+C pour copier.
```

### 14.5 Page d'atterrissage

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [logo du cabinet]                                                        │
│ « Bonjour Claire, votre parcours sur les parcours digitaux… » — Jane R.  │
│ ──────────────────────────────────────────────────────────────────────── │
│ Business Analyst (Digital ESR) · Paris · CDD                             │
│                                                                          │
│ ┌ Information ─────────────────────────────────────────────────────────┐ │
│ │ Pré-rempli à partir de votre profil professionnel public · supprimé  │ │
│ │ à la clôture de ce recrutement · responsable de traitement : <client>│ │
│ │ · contact : <DPO>  ·  [ je ne souhaite pas être recontacté·e ]       │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│ Votre parcours                                                           │
│   05/2023 – auj.     Business Analyst digital — Banque X     corriger ✎ │
│   09/2019 – 04/2023  Consultante AMOA — Cabinet Y            corriger ✎ │
│ Formation                                                                │
│   2014 – 2016        Master SI — Université W                corriger ✎ │
│ Résumé               « Business Analyst sur les parcours… »  corriger ✎ │
│   + ajouter une expérience                                               │
│                                                                          │
│ Email *        [ claire.m…@exemple.fr        ]  à confirmer              │
│ Téléphone      [                              ]                          │
│ CV (facultatif) [ Choisir un fichier ]   PDF ou DOCX, 10 Mo              │
│                                                                          │
│ [ ] Ces informations sont exactes et peuvent être utilisées pour ma      │
│     candidature *                                                        │
│                                        [ Envoyer ma candidature ]        │
└──────────────────────────────────────────────────────────────────────────┘
```

### 14.6 Pages de confirmation

```
Candidature envoyée                          Panne d'analyse (reprise sur le rail)
┌───────────────────────────────────────┐    ┌───────────────────────────────────────┐
│ ✓ Merci Claire, votre candidature     │    │ ✓ Merci Claire, votre candidature     │
│   est bien reçue.                     │    │   est bien reçue.                     │
│ Vous allez recevoir un email pour     │    │ Nous revenons vers vous par email     │
│ choisir un créneau d'entretien avec   │    │ très prochainement.                   │
│ Jane R.                               │    │                                       │
│ Vos données : utilisées pour ce       │    │ Vos données : utilisées pour ce       │
│ recrutement · <contact DPO>           │    │ recrutement · <contact DPO>           │
│                          [ Fermer ]   │    │                          [ Fermer ]   │
└───────────────────────────────────────┘    └───────────────────────────────────────┘

Opposition enregistrée
┌───────────────────────────────────────────────────────────────┐
│ C'est noté. Vos données de profil ont été supprimées et vous  │
│ ne serez plus contacté·e pour les recrutements de <client>.   │
│ Seule une empreinte technique, qui ne permet pas de vous      │
│ identifier, est conservée pour garantir ce choix.  [ Fermer ] │
└───────────────────────────────────────────────────────────────┘
```

`[ Fermer ]` suit la règle des écrans terminaux (tentative `window.close()` puis repli « vous
pouvez fermer cet onglet »).

---

## 15. Journal

| Action | Payload (aucune donnée personnelle hors candidature créée) |
|---|---|
| `sourcing_search_run` | `searchId, campaignId, language, queryMethod, queryEdited, returned, newAfterDedup, exaCostUsd, llmCostUsd, contactsKept, contactsRejected` |
| `sourcing_profile_declined` | `fingerprint, campaignId, actorUserId` |
| `sourcing_contact_initiated` | `approachId, fingerprint, campaignId, recruiterId, channel, messageFormat` |
| `sourcing_link_opened` | `approachId` — première ouverture |
| `sourcing_opposition_recorded` | `fingerprint` |
| `sourcing_candidate_manifested` | `approachId, analysisId, campaignId, recruiterId, channel` |
| `sourcing_admission_deferred` | `approachId, cause` |
| `sourcing_profiles_purged` | `campaignId, count, byState` — si `count > 0` |

`approachId` et `fingerprint` n'entrent pas dans `LINK_KEYS` (`src/lib/gdpr/journal-scope.ts:54-63`).

---

## 16. Tests (Phase 2)

- **Purs** :
  - **garde-fou Social (test dédié, en tête de la suite)** : profil dont seule la section
    `## Social` porte « je suis à la recherche d'un nouveau poste », un mot-clé de critère et une
    adresse email ⇒ **aucun badge, aucune mention, aucun email retenu, et aucune sous-chaîne de
    la section dans `exa_snapshot`** ; même profil avec la phrase déplacée dans About ⇒ badge
    présent (le test prouve qu'il mord, pas seulement qu'il se tait) ;
  - projection `exa_snapshot` : photo et Recommendations exclues, champ inconnu refusé, aucun
    champ téléphone ;
  - coordonnées du titulaire : les 9 cas de l'étude reconstitués sans données réelles, plus
    une adresse fonctionnelle et un contexte tiers ;
  - couverture de zone : Belfort 7/25 ⇒ bandeau, Lyon 22/25 ⇒ pas de bandeau, fiche
    « Télétravail » ⇒ pas de contrôle ; région lue dans « Ville, Région, Pays » ;
  - disponibilité : les 21 cas du §4.4 ;
  - mentions : amorces, atomisation, acronymes sensibles à la casse, « pas de mention » ;
  - repli (a) : les défauts connus du §3.3 figés comme cas ;
  - validation de sortie (b) : longueur 15-30 mots, couverture `encoded` + `notEncoded` ;
  - tri stable « en recherche d'abord » ;
  - empreinte et dédoublonnage ;
  - message ≤ 300 caractères lien compris.
- **Régression S19** (routes réelles sur DEV, Exa, LLM et email mockés) :
  - profil décliné qui ne réapparaît pas à la relance ;
  - clôture ⇒ lignes supprimées, empreintes gardées ;
  - lien après clôture ⇒ « offre plus ouverte » ;
  - soumission ⇒ une seule analyse, `auto_accept` quel que soit le score,
    `decided_by='user'` + recruteur, `source='sourcing'`, zéro ligne `pending_validations`,
    invitation partie, vivier sans URL ;
  - double soumission ⇒ une candidature et un mail ;
  - opposition ⇒ exclu de toutes les campagnes ;
  - flag absent ⇒ 404 et page neutre ;
  - `purge:candidate` d'un manifesté ;
  - exhaustivité des verdicts par table.

---

## 17. Coût de l'étude, incertitudes, indicateurs

### 17.1 Coût

| Poste | Appels | Coût |
|---|---|---|
| Sonde Exa (13/09 matin) | 11 | 0,43 $ |
| Étude du requêtage | 41 Exa à 25 résultats (38 retenus + 3 relancés après un défaut du générateur) | 0,90 $ |
| Génération (b) | 3 appels gpt-4o, 5 550 tokens | 0,017 $ (prix catalogue, calculé sur les tokens) |
| **Total** | | **≈ 1,35 $** |

En production : **≈ 0,10 $ par recherche** (0,097 $ Exa + 0,006 $ génération), ≈ 0,002 $ par
message d'approche, une analyse CV habituelle par manifestation.

### 17.2 Ce qui reste incertain

- **Jugement de pertinence** : fait par l'étude sur intitulé et lieu, pas par un recruteur ;
  3 fiches de dev seulement ; bruit de ±3 sur 25 qui masque tout effet plus fin.
- **(a) contre (b)** : égalité mesurée ; le choix de (b) repose sur la lisibilité observée, pas
  sur un gain de pertinence.
- **Régions peu peuplées** : 5 directeurs pertinents sur 25 autour de Belfort, quelle que soit
  la requête. Le plafond est l'index Exa, pas la formulation — et l'écran le dit (§3.6).
- **Couverture des coordonnées** : 7 emails sur 306 ; l'action email sera marginale. Aucun
  téléphone : action retirée, règle dormante (§6.3).
- **Disponibilité** : 4,2 % ; le badge est un signal rare.
- **Mentions** : quasi vides sur une fiche rédigée en phrases fonctionnelles.
- **Fraîcheur** : un profil a en médiane 38 jours ; poste actuel parfois déjà quitté.
- **Tarif et comportement d'Exa** : tarif public du 13/09 ; le « même résultat pour la même
  requête » est observé sur un jour, pas garanti.
- **Réglementaire** : la base légale de la collecte (intérêt légitime du client), l'usage
  d'un email trouvé sur un profil public pour une sollicitation directe, et le texte du
  bandeau art. 14 sont **à faire valider par le DPO du client** avant la première campagne.

### 17.3 Indicateurs de production

| Indicateur | Calcul | Seuil de réaction |
|---|---|---|
| **Correction de la requête générée** | par recherche : `query_generated` ≠ première requête envoyée ; distance en mots normalisée | > 60 % des recherches corrigées ⇒ revoir le prompt ; si (a) ferait aussi bien, basculer sur (a) |
| Relances par campagne | recherches par campagne ; part des relances en anglais | > 3 relances en moyenne ⇒ la requête générée ne suffit pas |
| Arbitrage | déclinés / approchés sur les profils affichés | approchés < 5 % ⇒ liste peu pertinente |
| Conversion | manifestés / approchés, par canal | à observer ; aucun seuil a priori |
| Réserve | part des recherches allant jusqu'à « 100 profils examinés » | information |
| Badge et contacts | part des profils « en recherche », avec email retenu | écart fort à 4 % et 2 % ⇒ vérifier les détecteurs |

---

## 18. Backlog

- Geste de ré-analyse manuel d'une candidature.
- Encoder les **missions** de la fiche dans la requête (le domaine fin, §3.2) : à mesurer avec
  des recruteurs avant d'en faire une règle.
- Mentions calculées aussi sur la durée d'expérience (dates du parcours) — hors « textuel », à
  décider.
