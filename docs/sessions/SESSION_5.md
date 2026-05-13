# Session 5 — Persistance Supabase (round 1)

> **Statut** : terminée — prolongée en pratique par les rounds 2 (Storage), 3 (artefacts sync), 4 (extraction de CV), 5 (flux IMAP). Voir le code des repos / sync pour le détail. La Session 6 (`SESSION_6.md`) prend le relais avec le dashboard.
> **Pré-requis** : Sessions 1 à 4 complétées (chat manager, CV Analyzer, scoring, isolated criteria, sélecteur de campagne, status workflow).
> **Spec de référence** : `docs/specs/entreprise-virtuelle-rh.md` — §5.2 (storage hybride), §4.1 (pré-recherche L1).

## Objectif de la session

Sortir l'état métier du volatile (Zustand seulement) pour le persister dans **Supabase**. Quand le donneur d'ordre rafraîchit la page, ses campagnes, FDPs archivées, fiches de scoring, tâches isolées et journal d'actions sont retrouvés tels quels. La pré-recherche `searchExistingJobDescriptions` cesse d'être un stub et interroge réellement les FDPs archivées.

À la fin du round 1, on doit pouvoir tenir une démo répétée sur plusieurs jours sans perdre l'état, et le Manager doit annoncer correctement quand il retrouve une FDP comparable à un nouveau brief.

---

## Périmètre IN — à implémenter

### 1. Schéma Supabase

Tables Postgres (création via `scripts/migrate.sql`, exécutable dans le SQL editor Supabase) :

- `campaigns` — une ligne par campagne (`CAMP-XXXX`). Colonnes : `id`, `name`, `status`, `fdp` (jsonb snapshot), `scoring_sheet` (jsonb), `published_channels` (text[]), `sources_confirmed` (bool), `created_at`, `updated_at`.
- `fdps_archived` — une ligne par FDP validée. Colonnes : `campaign_id`, `job_title`, `seniority`, `contract_type`, `location`, `fdp` (jsonb), `archived_at`. Index trigram sur `job_title` pour la recherche.
- `scoring_sheets_archived` — snapshot historique au moment de la validation (nice-to-have ; le snapshot principal vit dans `campaigns.scoring_sheet`).
- `tasks_archived` — symétrique pour les sollicitations `TASK-XXXX`. Colonnes : `id`, `name`, `status`, `criteria` (jsonb), timestamps.
- `journal` — audit des actions directes UI (spec §6.3). Colonnes : `id`, `campaign_id` nullable, `actor`, `action`, `payload` jsonb, `created_at`.

Pas de RLS activée en MVP mono-utilisateur — la `service_role_key` reste côté serveur uniquement, le client passe par les API routes Next.

### 2. Wiring Supabase

```
src/lib/db/
  supabase-browser.ts    (anon, lecture seule éventuelle — non utilisé en round 1)
  supabase-server.ts     (service role, côté API routes uniquement)
  types.ts               (types des rows + mappage row↔domain)
  repos/
    campaigns.ts
    fdps-archived.ts
    scoring-sheets.ts
    tasks-archived.ts
    journal.ts
```

Garde-fou : si `NEXT_PUBLIC_SUPABASE_URL` ou `SUPABASE_SERVICE_ROLE_KEY` manquent, les repos lancent une erreur explicite et les API routes répondent `503 supabase_not_configured`. Le client gère ce 503 en restant en mode volatile (comportement actuel) — pas de crash visible pour la démo locale sans Supabase.

### 3. API routes

```
src/app/api/
  campaigns/route.ts          GET (list), PUT (upsert)
  campaigns/[id]/route.ts     PATCH (status / channels / sources)
  tasks/route.ts              GET (list), PUT (upsert), PATCH status
  fdps/search/route.ts        GET ?q=<query> — pré-recherche L1
  journal/route.ts            POST (append)
```

Les routes valident le payload avec zod en s'appuyant sur les schémas existants (`FDPInProgressSchema`, `ScoringSheetSchema`, etc.).

### 4. Hydratation + persistance des stores

- `campaigns-store` et `tasks-store` gagnent un `hydrateFromServer()` async appelé une fois au mount de l'app (dans un `<HydrationGate />` monté tôt dans le layout).
- Chaque mutation côté store déclenche un push async vers l'API (debounced à 300ms pour éviter la rafale sur un drag de slider, par exemple). Si le push échoue, on logge et on garde l'état local — la prochaine mutation re-tentera.
- L'hydratation est idempotente : on remplace `byId` + `order` par le contenu serveur ; les snapshots de scoring/published/sources reviennent intacts.
- L'hydratation **n'écrase pas** une mutation locale concurrente (race window très courte mais possible) : on garde le `updatedAt` le plus récent.

### 5. Pré-recherche L1 réelle

`searchExistingJobDescriptions(query)` :
- En contexte serveur (Node) : appelle directement le repo `fdps-archived.search(query)`.
- Côté `runManagerTurn` qui tourne dans `/api/manager/chat` (server), on utilise le path serveur.
- Matching : recherche full-text simple sur `job_title` (ilike `%query%`) + filtre tokens communs ; trie par récence d'archivage. Limite 5 résultats. **L2 et L3 hors round 1.**
- Le Manager génère sa phrase : « J'ai retrouvé une fiche pour un poste comparable archivée le X — on s'en sert comme base ou on repart de zéro ? ». Pour cette session, on **ne câble pas** la réutilisation interactive — la phrase est conditionnelle au résultat, c'est tout. La consommation de la FDP retrouvée arrive avec L2 (post-round 1).

### 6. Tests vitest

- Repos : appel mocké de `supabase.from(...).insert/...` → vérifie les bons args et le mapping row↔domain.
- API routes : POST/PUT valides et invalides, gestion du 503 manquant-de-config.
- `searchExistingJobDescriptions` : retourne `[]` quand pas configuré, retourne les bons hits sinon.
- Hydratation : remplace `byId` proprement, respecte l'ordre serveur.

---

## Périmètre OUT — à NE PAS implémenter

- **Drive (artefacts visibles client).** C'est l'étape 4 séparée — service account Google, dossier par campagne, upload FDP/annonce/rapport. Reportée à un round 2 dédié.
- **Pré-recherche L2 / L3** (suggestion multi-fiches, génération d'inspirations).
- **Réutilisation interactive d'une FDP retrouvée** — pour l'instant le Manager mentionne la trouvaille mais le donneur d'ordre reconstruit de zéro.
- **Persistance du chat.** Le chat reste volatile (cohérent avec la règle « reset chat sur switch » et la projection audio-first). Persister le chat demanderait une stratégie de migration de schéma à chaque évolution des `ChatBlock`.
- **RLS et multi-utilisateurs.** Mono-utilisateur en MVP.
- **Realtime Supabase.** C'est la Session 7.
- **Migration des artefacts produits (annonces, rapports CV) vers un blob storage.** Les artefacts restent dans `artifacts-store` volatile en round 1 ; Drive arrive en round 2.

---

## Critères de fin de round 1

1. **Refresh ne perd plus rien.** Crée une campagne, valide FDP + scoring, marque un channel publié, rafraîchis : tout est retrouvé identique.
2. **Pré-recherche annonce les FDPs comparables.** Valide une FDP « comptable senior à Paris », démarre une nouvelle conversation « je cherche un comptable confirmé à Paris » : le Manager dit qu'il a trouvé une fiche comparable.
3. **Démo offline reste fonctionnelle.** Sans variables Supabase, l'app tourne comme avant (mode volatile, log d'info au boot).
4. **Tests verts.** Repos + API + pré-recherche + hydratation.
5. **Aucun jargon technique fuite dans le chat.** Si Supabase tombe, le Manager ne dit pas « erreur 503 » — silence ou phrase métier.

---

## Pièges à éviter

- **Ne pas exposer la `service_role_key` côté client.** Toujours passer par les API routes server.
- **Ne pas hydrater avant que le store soit prêt.** Le `<HydrationGate />` doit attendre la première promesse avant de rendre les enfants — sinon flash d'état vide.
- **Ne pas dupliquer la source de vérité.** `campaigns.fdp` (jsonb) est le snapshot, `fdps_archived` est l'index recherchable. Si on met à jour un statut, on touche `campaigns`, pas `fdps_archived` (qui ne change que sur archivage initial).
- **Ne pas faire de migration de schéma implicite.** Toute évolution du shape JSON (FDP, scoring) doit être backwards-compat en lecture, sinon on casse une démo en cours.
- **Ne pas mettre la pré-recherche L2 dans le scope round 1.** L1 suffit pour démontrer la valeur, L2 demande un modèle de similarité et un parcours UX dédié.
