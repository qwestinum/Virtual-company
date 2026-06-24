# How-to — Import en masse de CV dans le vivier

Script interne pour importer un **stock existant de CV** (centaines/milliers) dans le
vivier d'un projet, **depuis ta machine** (hors app, hors Vercel). Le glisser-déposer de
l'app n'est pas conçu pour ce volume (timeouts, faux « indexé », rejeu unitaire) — ce
script corrige les trois.

> Source du script : `scripts/import-vivier.ts` — lancé via `npm run import:vivier`.
> Il **réutilise le pipeline d'indexation de l'app** (mêmes fonctions que `/api/vivier`),
> il ne le duplique pas.

---

## 1. Ce que fait le script (garanties)

- **Statut honnête.** Un CV n'est compté `réussi` qu'après **toutes** les étapes
  confirmées : extraction → identité → écriture base → indexation → **embedding titre
  présent dans le bon espace** (re-vérifié en base). Jamais de faux « indexé ».
- **Reprise idempotente.** Un journal JSON local (`<dossier>/.import-vivier-journal.json`)
  est écrit après **chaque** fichier. Relancer **saute** les réussis + doublons, **retente**
  les échecs et les non-traités. Pas de rejeu manuel fichier par fichier.
- **Déduplication par email.** Un email déjà **indexé** dans le vivier est ignoré
  (« doublon »). Un dossier existant mais **non indexé** (échec précédent, ou dossier creux)
  est **réindexé** (sans réécrire son contenu).
- **Rate-limits OpenAI.** Le provider de l'app ne retente pas les 429 ; le script les
  **absorbe** avec un backoff qui respecte l'indice « try again in Xs ». Sur une org bas
  palier (ex. Tier-1 = 30 000 TPM) l'import **s'auto-régule et peut être long** — c'est
  attendu, la durée n'est pas un problème.
- **Sécurité projet.** Le script écrit dans la base que désigne `.env.local`. Il **affiche**
  le projet cible et exige que tu **tapes son `project ref`** avant toute écriture.

---

## 2. Pré-requis

`.env.local` renseigné et **pointé sur le bon projet** :

| Variable | Rôle |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | projet cible (`https://<ref>.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | écriture base (service_role) |
| `OPENAI_API_KEY` | extraction identité + indexation |
| `OPENAI_EMBEDDING_MODEL` | **doit** correspondre au modèle déjà utilisé dans le vivier cible |

> ⚠️ Si `OPENAI_EMBEDDING_MODEL` diverge du modèle déjà présent dans le vivier, le
> **contrôle pré-vol refuse de démarrer** (mélanger deux espaces d'embedding casserait la
> présélection). Aligne le modèle, ou réindexe le vivier d'abord.

### Cibler un autre projet que ton dev (swap d'env)

Si ton `.env.local` est en dev et que tu importes chez un client :

```bash
cp .env.local .env.dev.local            # backup dev (gitignoré)
#  … édite .env.local avec les valeurs CLIENT (URL, service_role, OpenAI, modèle) …
#  … lance l'import (voir plus bas) …
cp .env.dev.local .env.local && rm .env.dev.local   # RESTAURE le dev après
```

> Tant que tu n'as pas restauré, ton environnement local pointe sur la base client —
> ne lance pas `npm run dev` entre-temps sans en être conscient.

---

## 3. Procédure

### Étape A — Simulation (dry-run) sur un échantillon

Fait tout **sauf écrire** (extraction, identité, dédup en lecture, rapport). Aucune
confirmation demandée (lecture seule). Journal séparé `.import-vivier-journal.dryrun.json`.

```bash
npm run import:vivier -- "/chemin/vers/dossier-cv" --dry-run --limit=20
```

👉 **Lis la bannière** : `Project ref` et `Supabase URL` doivent être ceux du **bon
projet**. Le `Pré-vol` doit être ✅. Le rapport te donne le taux attendu (réussis / sans
email / doublons / échecs) avant d'engager le lot complet.

### Étape B — Import réel

```bash
npm run import:vivier -- "/chemin/vers/dossier-cv"
```

La bannière te demande de **taper le `project ref`** pour confirmer, puis écrit + indexe.
Des lignes `⏳ … rate-limit … pause Xs` sont **normales** (auto-régulation). Laisse
tourner.

> **Chemin Windows sous WSL** : `C:\Users\toi\Downloads\CV` → `"/mnt/c/Users/toi/Downloads/CV"`
> (guillemets obligatoires si le chemin contient un espace).

### Étape C — Reprise (si des échecs subsistent)

Relancer la **même commande** retente automatiquement les échecs + non-traités (saute les
réussis). Pour ne reprendre **que** les échecs :

```bash
npm run import:vivier -- "/chemin/vers/dossier-cv" --retry-failed-only
```

C'est idempotent : « rejouer tous les ratés » = relancer.

---

## 4. Options

| Option | Défaut | Rôle |
|---|---|---|
| `--dry-run` | off | simulation, aucune écriture |
| `--limit=N` | tout | n'échantillonne que les N premiers fichiers (utile en dry-run) |
| `--retry-failed-only` | off | ne traite que les échecs du journal |
| `--batch-size=N` | `3` | fichiers traités en parallèle par lot |
| `--delay-ms=N` | `2000` | pause entre lots (ms) |
| `--max-retries=N` | `6` | reprises max sur rate-limit (429) par appel/indexation |
| `--confirm-project=<ref>` | — | confirme le projet sans prompt (run non-interactif / CI) |

Org OpenAI bas palier (30k TPM) : les défauts conviennent ; au besoin `--batch-size=2`
réduit encore les allers-retours 429.

---

## 5. Lire le rapport

En fin de run :

```
[import-vivier] terminé : 38 réussis · 0 échecs · 0 sans email · 2 doublons ignorés (sur 40 traités).
```

- **réussis** : créés/réindexés + embedding titre confirmé.
- **échecs** : avec motif (`extract:…`, `identity:…`, `index:…`, `embedding_absent`,
  `embedding_space_mismatch:…`). Repris à la prochaine relance.
- **sans email** : CV sans adresse exploitable (`no_email`) ou document non-CV
  (`not_a_cv`) → **inspection manuelle**, une relance n'y changera rien.
- **doublons ignorés** : `exists` (déjà indexé dans le vivier) ou `intra_run` (même email
  deux fois dans le lot).

Détail complet par fichier dans `<dossier>/.import-vivier-journal.json` (statut + motif +
`candidateId` + tentatives + horodatage). **Ce journal contient des emails de candidats
(donnée personnelle) — il est gitignoré, ne le commite jamais.**

---

## 6. Dépannage

| Symptôme | Cause / Action |
|---|---|
| `Invalid API key` (pré-vol) | `SUPABASE_SERVICE_ROLE_KEY` ne correspond pas au projet, ou **caractère parasite** au copier-coller (un JWT valide commence par `eyJ`). Re-colle la clé proprement (une seule ligne, sans espace ni saut). |
| `PRÉ-VOL : … espace … ≠ modèle courant` | `OPENAI_EMBEDDING_MODEL` diffère du vivier cible. Aligne-le (puis redémarre) ou réindexe le vivier. |
| `Le journal existant cible le projet « X » ≠ … « Y »` | Le `.import-vivier-journal.json` du dossier vient d'un autre projet. Supprime-le si tu changes volontairement de cible. |
| Beaucoup d'échecs `429` | Org OpenAI saturée. Le backoff gère, mais c'est lent : baisse `--batch-size`, ou **monte le rate-limit de l'org** (le plus efficace pour de gros volumes). |
| Échec `embedding_space_mismatch` | Un embedding a été écrit dans un autre espace. Réindexe le vivier (`npm run reindex:vivier`) avec un modèle homogène. |

---

## 7. Limite connue (côté app, hors script)

Le glisser-déposer de l'app peut marquer un dossier `indexed` **sans embedding titre**
(faux « indexé », couche 2). Ce script n'en est **pas** victime (il re-vérifie l'embedding),
mais il ne **répare pas** ces dossiers app (ils sont `indexed`, donc vus comme doublons).
Correctif app suivi dans `docs/BACKLOG.md`.
