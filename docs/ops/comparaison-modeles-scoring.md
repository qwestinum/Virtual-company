# Comparaison de modèles pour le scoring — gpt-4o vs gpt-4o-mini

> **Statut (25/09/2026)** : **implémenté** — `scripts/compare-models.ts`, logique pure dans
> `src/lib/model-comparison/`. Premier run : gpt-4o (référence + bruit) contre gpt-4o-mini sur la
> base de dev. Script hors produit, dry-run pur.
> **Point d'arrêt** : le rapport, avant toute décision de bascule. Le modèle en service ne
> change pas tant que la liste des désaccords n'a pas été relue à la main.

## 1. Objectif

Mesurer si **gpt-4o-mini** peut remplacer **gpt-4o** pour l'analyse des CV, en rejouant les
analyses EXISTANTES de la base de dev et en comparant des **DÉCISIONS**, pas seulement des
scores. Aucune écriture dans les tables du produit, aucun envoi, aucun changement du modèle en
service.

## 2. Script

```
npm run compare:models -- --env=<fichier> --confirm-project=<ref> [--sample=N|all] [--noise=20]
    [--candidate=<nom>,provider=openai|anthropic,model=<m>[,ledger=<m>][,base-url=https://…]]…
    [--include=<id>,…] [--out=<répertoire hors dépôt>] [--max-cost=6] [--yes]
    [--estimate-only] [--report-only]
```

- **`--env` obligatoire, sans repli**, comme `purge:candidate` et `reindex:vivier` : un fichier
  au nom de dev peut pointer la base d'un client.
- Lit les analyses de dev qui ont encore leur CV en artefact (texte extrait disponible), avec
  leur résultat stocké (score, zone, verdicts par critère, citations).
- Rejoue chaque CV avec gpt-4o-mini par le **MÊME chemin** (`analyzeCVApplication`, mêmes
  prompts, même grille, mêmes seuils de campagne), **en mémoire** : rien n'est persisté dans
  `candidate_analyses`, aucun gate d'outreach n'est appelé, aucun claim n'est posé.
- **Garde structurelle** : le script n'importe aucun émetteur ni aucun repo d'écriture. Elle est
  tenue par un test, sur le modèle de `requeue-no-send.test.ts`. Vérifié le 25/09 :
  `cv-application-analyze.ts` n'importe aucun repo, le rejeu à blanc est faisable sans le
  modifier.
- **Bras de bruit** (`--noise=20`) : rejoue 20 CV avec gpt-4o lui-même, pour mesurer l'écart
  gpt-4o vs gpt-4o. C'est le **plancher** sous lequel une différence n'est pas significative.
- **Cas sentinelles inclus d'office** : les dossiers de l'incident du pré-filtre (21/08/2026),
  listés dans [`reparation-scoring-2026-08-21.md`](reparation-scoring-2026-08-21.md). Ce sont les
  CV où une lecture superficielle s'est déjà trompée une fois. Désignés par **identifiant
  d'analyse** dans le script, jamais par nom.

## 3. Ce que le script mesure (par CV, puis en agrégé)

1. **Score** : Δ absolu, moyenne, écart-type, comparés au plancher de bruit.
2. **ZONE** (le critère décisif) : même zone ou zone changée ; matrice de confusion 3×3 —
   `auto_accept` (accepté) · `gray` (à décider) · `proposed_reject` (refus proposé). La zone
   LEGACY `auto_reject` se range avec `proposed_reject` (même bande de score). **Un basculement
   accepté ↔ refus est un échec bloquant à lui seul.**
3. **Verdicts par critère** : taux d'accord sur les quatre valeurs (`satisfait` · `partiel` ·
   `non` · `non_verifiable`). On compte les **`non_verifiable` devenus `non`** : c'est la
   régression interdite (invariant « aucun verdict négatif sans preuve »).
4. **Citations** : chaque citation de mini est-elle retrouvée mot pour mot dans le CV ? Taux de
   citations invalides ; nombre de déclenchements de `assertNoUnprovenNegative`.
5. **Rédhibitoires** : accord exact sur les knockouts. **Un rédhibitoire raté est bloquant.**
6. **Coût et latence** : tokens entrée/sortie, $ par CV, secondes par CV, pour les deux modèles.

## 4. Sortie

- **`comparison.csv`** : une ligne par CV (identifiants, scores, zones, accords, coûts). Écrit
  dans le **scratchpad, jamais dans le dépôt** : ce sont des dossiers de personnes réelles.
- **`rapport.md`** : les agrégats, la matrice de zones, le plancher de bruit, et la **LISTE DES
  DÉSACCORDS** classée par gravité — bascules de zone d'abord, puis rédhibitoires, puis
  `non_verifiable` → `non`, puis citations invalides. Pour chacun, les deux verdicts côte à côte.
  C'est cette liste qui se relit à la main pour dire qui a raison.
- **Un verdict proposé.** mini est **ACCEPTABLE** si :
  - (a) aucun basculement accepté ↔ refus ;
  - (b) accord de zone ≥ 95 % **et** Δscore moyen ≤ plancher de bruit + 3 ;
  - (c) rédhibitoires : 100 % d'accord ;
  - (d) zéro `non_verifiable` → `non` ;
  - (e) ~~citations invalides < 1 %~~ → **verdicts positifs sans preuve tenable ≤ taux de la
    référence + 2 points** (redéfini le 25/09/2026 : gpt-4o lui-même était à 17 %).

  Sinon **REFUSÉ**, avec le critère qui échoue. Le verdict est une proposition ; la décision se
  prend sur la liste des désaccords.

## 5. Garde-fous

- **Dry-run pur** : aucune écriture produit, aucun mail, aucun claim. Le modèle en service ne
  change pas (`OPENAI_CHAT_MODEL` intact dans les fichiers d'environnement).
- **Aucun nom ni contenu de CV** dans le rapport : identifiants et chiffres seulement.
- **Coût** : mesuré au premier essai à **0,05 $ par CV pour gpt-4o** et **0,003 $ pour mini**.
  Avec la référence rejouée (arbitrage 3) : ~100 CV ⇒ ≈ 5 $ + 20 de bruit ≈ 6 $. Estimé et
  affiché avant exécution, confirmation demandée (`--yes` pour la passer, jamais le plafond).

## 6. Points à régler avant d'écrire le script (relevés dans le code le 25/09/2026)

1. **Le modèle est figé au chargement du module.** `src/lib/ai/provider.ts` lit
   `OPENAI_CHAT_MODEL` une seule fois (`DEFAULT_CHAT_MODEL`, repli `gpt-4o-mini`). Un même
   processus ne peut donc pas enchaîner les deux modèles. Recommandé : **un processus par bras**
   (variable posée avant l'import), plutôt que d'ajouter un paramètre de modèle au chemin
   critique de tous les agents. Contrôle obligatoire : **le modèle renvoyé par l'API** est
   inscrit dans chaque ligne du CSV (un bras qui tournerait en réalité sur le mauvais modèle
   rendrait un « accord parfait »).
2. **Le coût OpenAI sort à 0.** `estimateCost` indexe `PRICING` par le modèle renvoyé par l'API,
   qui est DATÉ (`gpt-4o-2024-08-06`) : clé absente, donc coût nul. C'est l'entrée du backlog
   « Aligner les clés `pricing.ts` avec les model strings datés d'OpenAI ». À corriger d'abord
   (petit correctif pur), sinon l'axe coût du rapport est faux.
3. **La référence stockée n'est pas « gpt-4o aujourd'hui ».** Le scoring a changé depuis une
   partie des analyses (pré-filtre du 21/08, re-scoring). Comparer mini d'aujourd'hui au résultat
   stocké mélange l'effet du MODÈLE et l'effet du CODE. Deux options, à trancher avant de lancer :
   - **(A)** restreindre l'échantillon aux analyses postérieures au dernier changement du
     scoring (moins de CV, coût inchangé) ;
   - **(B)** rejouer aussi gpt-4o sur tout l'échantillon et comparer mini à gpt-4o **du jour**,
     la valeur stockée n'étant qu'une troisième colonne (≈ 5 $ au lieu de 1,5 $).

   Recommandé : **(B)**. Le bras de bruit devient alors un simple sous-ensemble.
4. **Non-déterminisme résiduel.** Côté OpenAI, graine 42 + température 0 ne garantissent pas une
   sortie identique d'un appel à l'autre : le bras de bruit le mesure, il ne l'élimine pas. Lire
   un écart de score de ±10 comme du bruit, un écart de +20 comme un signal (même lecture que le
   re-scoring du 21/08).
5. **Le fournisseur doit rester OpenAI** pendant le test (`CV_ANALYZER_PROVIDER` absent ou
   `openai`). En mode `anthropic`, `OPENAI_CHAT_MODEL` n'est pas lu du tout. Le script refuse de
   démarrer sinon.

## 6bis. Arbitrages du donneur d'ordre (25/09/2026) et mise en œuvre

1. **Un processus par modèle, réglages posés par le script** (`--candidate-provider`,
   `--candidate-model`, `--candidate-base-url`, `--reference-model`). L'environnement du
   sous-processus est construit par `childEnv` (`src/lib/model-comparison/arm-env.ts`) : fichier
   `.env` + réglages du bras imposés, et les réglages absents sont RETIRÉS. Le bras **refuse de
   démarrer** si son environnement effectif diffère de ce qu'il demande (`envMismatches`), puis
   vérifie, CV par CV, que le modèle **renvoyé par l'API** est bien celui demandé (`isSameModel` :
   égalité ou suffixe de date seulement — `gpt-4o-mini-2024-07-18` n'est PAS un `gpt-4o`). Au
   premier écart, le bras s'arrête. Le modèle réellement renvoyé est écrit dans chaque ligne du
   CSV.
   **Adaptateur « compatible OpenAI par URL de base »** préparé pour Mistral / OVHcloud / Scaleway
   (`src/lib/ai/openai-endpoint.ts`) : `OPENAI_BASE_URL` (https seulement) +
   `OPENAI_COMPATIBLE_API_KEY` (la clé OpenAI n'est **jamais** envoyée à un tiers). Seuls les appels
   de chat changent de destination, la transcription reste chez OpenAI. **Toute URL deepseek.com
   est refusée**, sous-domaines compris, au seul point où le client est construit. Restent à
   vérifier fournisseur par fournisseur avant un vrai run : graine (`random_seed` chez Mistral),
   mode JSON, nom de modèle renvoyé, tarif (absent de `pricing.ts` ⇒ coût compté 0, signalé à
   l'estimation).
2. **Coût à 0 sur les noms datés** : corrigé à part (`pricingKey`, commit `0b65440`) — c'était
   aussi la carte des coûts de l'administration en production.
3. **Référence = gpt-4o rejoué aujourd'hui** sur tout l'échantillon (même code, même moment) ;
   **bruit = second rejeu gpt-4o** sur `--noise` CV. La valeur stockée en base n'entre pas dans la
   comparaison.
4. **Bruit mesuré, pas éliminé.**

**Ce que le script fait en plus du protocole** :
- **Dédoublonnage** : le même CV envoyé plusieurs fois sur la même campagne (fréquent en recette)
  n'est compté qu'une fois. Sur la base de dev, **27 des 47 analyses rejouables** étaient des
  renvois ; il reste **20 CV distincts**.
- **Candidatures sourcing écartées** : leur zone est FORCÉE à l'admission, ce n'est pas une
  décision du modèle.
- **Phases dégradées** comptées par bras (relevé de faits, extraction candidat, narration en échec
  après réessais) : un modèle qui rate le relevé juge ensuite sans lui.
- **Plafond de coût** (`--max-cost`, défaut 6 $) vérifié sur l'estimation AVANT tout appel ;
  `--estimate-only` pour chiffrer sans lancer ; reprise d'un run interrompu dans le même `--out`.
- **Sortie** : `rapport.md` et `comparison.csv` (identifiants et chiffres) ; `details.json` (les
  deux verdicts côte à côte AVEC citations et justifications, pour la relecture — données
  personnelles). `--out` est refusé s'il pointe dans le dépôt.
- **Garde structurelle** (`src/lib/model-comparison/__tests__/script-guard.test.ts`) : sur TOUT le
  graphe d'imports atteignable depuis le script (imports dynamiques compris), aucun repo, émetteur,
  file HITL, claim ni surface du produit ; seul le script parle à la base, et sans aucun verbe
  d'écriture. Sondée : une écriture directe et un import indirect de la file HITL la font rougir.

**Limite du premier run** : 20 CV, c'est peu. Un seul désaccord de zone fait tomber l'accord à
95 %. Pour conclure, il faut un échantillon plus large — la base de production (lecture seule,
même script, `--env` du client) ou de nouveaux CV de recette. À décider.

## 6ter. Premier run — base de dev, 25/09/2026

20 CV distincts · gpt-4o (référence + bruit) contre gpt-4o-mini · coût réel **1,84 $** (0,045 $ par
CV pour gpt-4o, 0,002 $ pour mini) · 14 s par CV pour gpt-4o, 11 s pour mini. Rapport complet dans
le scratchpad de la session (hors dépôt).

| | gpt-4o contre lui-même (bruit) | gpt-4o-mini contre gpt-4o |
|---|---:|---:|
| CV comparés | 20 | 18 (+ 2 analyses abandonnées) |
| Δscore moyen absolu | 4,6 | **19,0** |
| Accord de zone | 95,0 % | **77,8 %** |
| Basculements accepté ↔ refus | 0 | 0 |
| Accord des verdicts par critère | 93,0 % | 71,2 % |
| « Non vérifiable » devenu « non » | 0 | 0 |
| Accord sur les rédhibitoires | 100 % | 100 % |
| Citations introuvables | 17,3 % | 19,0 % |

**Verdict proposé : REFUSÉ** — (b) zone et écart de score, (e) citations, (f) deux analyses
abandonnées (verdicts inexploitables après réessais, sur des CV que gpt-4o analyse sans peine).

Lecture, avant relecture des désaccords à la main :
- **Le sens des écarts compte plus que leur taille.** Trois dossiers « à décider » passent
  « accepté » chez mini (+19, +44, +46 points), sur des critères SOUPLES (sensibilité UX, challenge
  du besoin, résolution de problèmes) que gpt-4o juge « non vérifiables » et que mini déclare
  « satisfaits ». `auto_accept` est la seule zone qui envoie seule : ce sont des invitations qui
  partiraient sans relecture. L'invariant « aucun négatif sans preuve » tient (0 « non vérifiable » →
  « non ») ; c'est l'invariant SYMÉTRIQUE — aucun positif sans preuve — que mini affaiblit.
- **Le critère (e) tel qu'écrit ne départage rien** : gpt-4o lui-même rend 17 % de citations
  introuvables mot pour mot (un mot changé sur quinze, des lignes recollées — ni ligature ni
  ponctuation, ces deux fausses alertes ont été retirées du contrôle). Le seuil de 1 % est hors
  d'atteinte pour la référence. À redéfinir **relativement au bruit** (ex. « pas pire que gpt-4o
  + 2 points »), ou à traiter comme un défaut du prompt commun aux deux modèles — à décider.
- **20 CV ne suffisent pas à conclure** : l'écart est net (19 points contre un bruit de 4,6), mais
  l'échantillon est petit et ne contient aucun des cas sentinelles.

## 6quater. Décisions du 25/09/2026 et second run — hybride et Haiku

**Décisions.** gpt-4o-mini REFUSÉ pour les verdicts. Deux corrections PRODUIT (branche
`fix/scoring-preuves`) : (1) garde « aucun oui sans preuve » — un satisfait/partiel du modèle sans
citation retrouvée dans le CV devient `non_verifiable`, pour tout modèle
(`src/lib/scoring/quote-evidence.ts`, tracé par `evidenceDowngrade`, citation rejetée recopiée dans
la justification que la purge efface) ; (2) citations exactes exigées par le prompt, vérifiées
après normalisation (NFKC, espaces, ponctuation de bord). Critère (e) redéfini : **≤ taux de la
référence + 2 points**. Aucun CV réel vers Mistral / OVHcloud / Scaleway (jeu synthétique, chantier
du jeu de démonstration). Runs sur deux bras : **hybride** (gpt-4o-mini pour le relevé de faits,
gpt-4o pour le reste) et **claude-haiku-4-5**. `--confirm-project` désormais obligatoire.

**Échantillons.** Dev : **20 CV distincts** (et non 50 — il n'y en a pas davantage). Client, en
LECTURE SEULE sur ses propres comptes de fournisseurs : **19 sentinelles** rejouables (dossiers du
§3-5 de `reparation-scoring-2026-08-21.md`, désignés par identifiant d'analyse ; 1 sans CV conservé,
1 doublon). Coût réel : ≈ 2,70 $ (dev) + ≈ 1,97 $ (client).

| | dev — hybride | dev — Haiku | client — hybride | client — Haiku |
|---|---:|---:|---:|---:|
| Verdict proposé | **ACCEPTABLE** | REFUSÉ | REFUSÉ (e, à 1 verdict) | REFUSÉ |
| Accord de zone (bruit) | 100 % (100 %) | 55 % | 100 % (94,7 %) | 73,7 % |
| Δscore moyen (plafond) | 7,5 (8,3) | 25,1 | 2,7 (4,2) | 18,7 |
| Basculements accepté ↔ refus | 0 | **1** | 0 | 0 |
| « Non vérifiable » → « non » | 0 | 0 | 0 | **1** |
| Positifs sans preuve (référence) | 4,3 % (25,0 %) | 21,4 % (25,0 %) | 4,3 % (2,2 %) | 3,8 % (2,2 %) |
| Coût par CV (référence) | 0,030 $ (0,046) | 0,029 $ | 0,021 $ (0,030) | 0,022 $ |

Lecture :
- **Hybride** : aucun changement de zone sur 39 CV, écart de score dans le bruit, −30 à −35 % de
  coût. Son seul échec (e, côté client) tient à UN verdict : 2/46 contre 1/45 — l'effectif ne
  permet pas de conclure dans un sens ou dans l'autre.
- **Haiku** : écarte trop de dossiers de leur zone sur les deux bases, un basculement accepté →
  refus sur le dev, un « non vérifiable » devenu « non » chez le client.
- **Mesure « 17 % de gpt-4o sous 3 % »** : atteinte sur les CV RÉELS du client (**2,2 %**), PAS sur
  le dev (**25 %**, bruit 19,7 %). Le prompt seul n'explique pas l'écart : ce sont les mêmes
  prompts. Pistes, non vérifiées : mise en page des CV de recette (colonnes entrelacées à
  l'extraction : une phrase logique n'est plus contiguë dans le texte), et le relevé de faits de
  gpt-4o recopié comme citation (le bras hybride, qui ne diffère que par son relevé, tombe à
  4,3 % sur les mêmes CV). La citation rejetée étant désormais recopiée dans la justification, un
  prochain run permet de trancher.
- **Effet de la garde en production** : sur les sentinelles du client, 1 verdict positif sur 45
  rétrogradé ; sur le dev, 1 sur 4. À surveiller avant fusion : c'est le taux du dev qui ferait
  baisser des scores, s'il se retrouvait sur d'autres clients.

## 7. Outil voisin

`scripts/bench-cv-analyzer.ts` (`npm run bench:cv`) mesure la **variance** d'un modèle sur
quelques CV fournis en fichiers, avec une fiche de démo. Il ne lit pas la base et ne compare pas
de décisions. Le script de ce document s'en distingue en rejouant des dossiers réels avec leur
vraie grille et leurs vrais seuils.
