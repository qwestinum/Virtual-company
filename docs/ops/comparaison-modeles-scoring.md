# Comparaison de modèles pour le scoring — gpt-4o vs gpt-4o-mini

> **Statut (25/09/2026)** : cadré, **non implémenté**. Script hors produit, dry-run pur.
> **Point d'arrêt** : le rapport, avant toute décision de bascule. Le modèle en service ne
> change pas tant que la liste des désaccords n'a pas été relue à la main.

## 1. Objectif

Mesurer si **gpt-4o-mini** peut remplacer **gpt-4o** pour l'analyse des CV, en rejouant les
analyses EXISTANTES de la base de dev et en comparant des **DÉCISIONS**, pas seulement des
scores. Aucune écriture dans les tables du produit, aucun envoi, aucun changement du modèle en
service.

## 2. Script

```
npm run compare:models -- --env=.env.local [--sample=N|all] [--noise=20]
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
  - (e) citations invalides < 1 %.

  Sinon **REFUSÉ**, avec le critère qui échoue. Le verdict est une proposition ; la décision se
  prend sur la liste des désaccords.

## 5. Garde-fous

- **Dry-run pur** : aucune écriture produit, aucun mail, aucun claim. Le modèle en service ne
  change pas (`OPENAI_CHAT_MODEL` intact dans les fichiers d'environnement).
- **Aucun nom ni contenu de CV** dans le rapport : identifiants et chiffres seulement.
- **Coût attendu** : ~100 CV × mini (~0,003 $) + 20 CV × gpt-4o (~0,05 $) ≈ **1,5 $**.
  Affiché avant exécution, confirmation demandée.

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

## 7. Outil voisin

`scripts/bench-cv-analyzer.ts` (`npm run bench:cv`) mesure la **variance** d'un modèle sur
quelques CV fournis en fichiers, avec une fiche de démo. Il ne lit pas la base et ne compare pas
de décisions. Le script de ce document s'en distingue en rejouant des dossiers réels avec leur
vraie grille et leurs vrais seuils.
