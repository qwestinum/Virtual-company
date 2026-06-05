# Virtual Enterprise — QWESTINUM

## Projet

Prototype d'entreprise virtuelle où des agents IA jouent les rôles d'une équipe RH. Le donneur d'ordre dialogue avec un Manager RH virtuel qui est à la fois son **point de contact unique (SPOC)** et l'**orchestrateur** de l'équipe d'agents spécialisés (Job Writer, Publisher, CV Analyzer, Scheduler, Rejection Writer) qu'il dispatche et coordonne. Il n'y a pas d'agent Orchestrateur séparé.

Le MVP couvre le département RH avec deux modalités de travail : **campagnes complètes de recrutement** (cycle R1 à R6) et **sollicitations hors campagne** (livrables atomiques). Le donneur d'ordre interagit par deux canaux : **conversation avec le Manager** et **actions directes via l'interface** (toggles, sliders, clics).

**Positionnement QWESTINUM** : Process First — l'IA appliquée à des processus métier réels. Le projet sert à démontrer le concept à des clients en cabinet de conseil. La mimétique avec le fonctionnement d'une vraie équipe RH est le différenciateur principal face à la concurrence (Limova).

## Spécification fonctionnelle de référence

**`docs/specs/entreprise-virtuelle-rh.md`** est la source de vérité fonctionnelle. Tout comportement métier (rôles des agents, rituels, validations, artefacts, actions directes, escalades) y est défini. Claude Code consulte ce document avant toute décision de design fonctionnel.

**Brief de la session courante** : voir `docs/sessions/SESSION_3.md` pour le périmètre exact de ce qui doit être implémenté maintenant et ce qui ne doit pas l'être.

## Stack

- **Framework** : Next.js 16 (App Router, TypeScript strict)
- **UI** : Tailwind CSS + shadcn/ui
- **State** : Zustand (store unique pour MVP)
- **AI** : OpenAI API (GPT-4o pour les agents, Whisper pour la transcription voix)
- **Storage hybride (à partir de la Session 5)** : Supabase pour les données opérationnelles (tables, métriques, journal, RLS), Google Drive pour les artefacts visibles client (FDP, annonces, bilans) — voir §5.2 de la spec.
- **Communication temps réel (à partir de la Session 7)** : Supabase Realtime
- **Migration future post-MVP** : n8n + Supabase comme cerveau externe (non implémenté actuellement)
- **Déploiement** : VPS Hostinger (Session 8)

## Décisions architecturales déjà prises

- **Pas de 3D.** La scène 3D a été abandonnée en Session 2 au profit d'une interface 2D Notion/Linear avec cartes d'agents, lignes de flux SVG, panneau détail. Fond sand. Avatars PNG placeholder avec initiales.
- **MVP = Next.js seul.** Pour le MVP actuel, types, store, agents, UI tournent dans Next.js. Pas de n8n, pas de microservice externe, pas d'event bus distribué. Communication agents = appels de fonction côté client + état dans Zustand.
- **Storage différé.** En Session 3, les fonctions d'accès au storage (`searchExistingJobDescriptions`, etc.) existent mais retournent des valeurs vides ou mockées. Implémentation réelle hybride Supabase + Drive en Session 5.
- **Pas d'auth utilisateur dans le MVP.** Le système est mono-utilisateur (le donneur d'ordre = la personne devant l'écran).

## Règles absolues

- **TypeScript strict, jamais de `any`.** Si un type est complexe, on le définit dans `src/types/`.
- **Chaque agent implémente le contrat `AgentContract`** défini dans `src/types/agent.ts`. La prise d'acte des actions UI fait partie du contrat du Manager (voir spec §4.1).
- **Chaque composant React = un fichier, max 200 lignes.** Au-delà, on découpe.
- **Tous les appels AI passent par `src/lib/ai/provider.ts`**, jamais directement à OpenAI. Cela centralise les retries, le logging, et la mesure des coûts.
- **Les clés API sont dans `.env.local`**, jamais hardcodées, jamais commitées.
- **Tests vitest avant commit.** Le projet a déjà 42 tests verts en Session 1 — on ne régresse pas.
- **Commits conventionnels** : `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.

## Architecture agents

- Chaque agent = `{ id, name, role, skills[], inputs[], outputs[], trigger, humanValidation, individualToggle }`
- Le **Manager RH** est le seul interlocuteur du donneur d'ordre (SPOC) **et** l'orchestrateur de l'équipe : il classe l'intention, fait la pré-recherche, collecte progressivement, prend acte des actions UI, **et** dispatche aux agents exécutants en gérant les dépendances. Il n'y a pas d'agent Orchestrateur séparé — l'orchestration est une responsabilité du Manager, déterministe et pilotée par le code (machine d'états du cycle de vie), jamais par le LLM.
- Les agents communiquent via **appels de fonction internes** dans le MVP. Les hooks Zustand exposent l'état nécessaire à chaque agent.
- Chaque exécution d'agent produit des **métriques** (durée, tokens, coût, statut, queue depth) — le contrat `AgentMetrics` est défini dans `src/types/agent.ts`.
- Chaque agent expose un **toggle d'activation individuel** et un **toggle de validation humaine indépendant** — voir spec §6.3 (actions directes UI).

## Pré-recherche du Manager — contrat à respecter dès la Session 3

Le Manager doit **toujours** appeler `searchExistingJobDescriptions(query)` avant de lancer la collecte des champs manquants, même quand le storage est vide. Cela cristallise le contrat d'interface dès maintenant pour que l'implémentation réelle (Session 5) ne nécessite aucun changement de code dans le Manager.

```typescript
// src/lib/storage/job-descriptions.ts (MVP Session 3)
export async function searchExistingJobDescriptions(query: string): Promise<JobDescription[]> {
  // MVP : retourne toujours [] tant que le storage n'est pas implémenté
  // Session 5 : interroge Supabase + Drive
  return [];
}
```

Trois niveaux progressifs (L1 récupération, L2 suggestion, L3 inspiration) — voir spec §4.1.

## Conventions de nommage

- **Composants React** : PascalCase (`AgentCard.tsx`, `ManagerChat.tsx`)
- **Fonctions/variables** : camelCase
- **Types/Interfaces** : PascalCase préfixé (`AgentContract`, `TaskInput`, `CampaignBrief`)
- **Fichiers utilitaires** : kebab-case (`ai-provider.ts`, `job-descriptions.ts`)
- **Identifiants métier** : `CAMP-XXXX` pour les campagnes, `TASK-XXXX` pour les sollicitations hors campagne (voir spec §3.2)

## Ce que Claude Code doit savoir

- **Le projet est un prototype client-facing.** Il doit être visuellement crédible en démo. L'effet wow compte autant que la fonctionnalité — un client doit voir « une équipe » au travail, pas un dashboard technique.
- **La mimétique entreprise réelle est le différenciateur.** Quand un comportement est ambigu, demande-toi : que ferait un responsable RH humain dans cette situation ? Si la réponse est « il ne ferait jamais ça comme ça », c'est que le design est à revoir.
- **Le Manager parle métier, jamais technique.** Pas de « tâche dispatchée », pas de « erreur 401 ». Même quand il orchestre en coulisse, côté donneur d'ordre cela se résume à « je m'en occupe, je reviens vers vous » et « la diffusion sur LinkedIn semble en panne, je publie sur les autres canaux en attendant ».
- **Une seule question à la fois** dans les phases de collecte. Jamais de rafale de questions, jamais de formulaire déguisé.
- **Priorité actuelle** : fonctionnel > beau > performant. C'est un prototype — le code doit être propre et lisible, pas optimisé prématurément.
- **Toujours respecter le périmètre de la session courante** (`SESSION_X.md`). La spec couvre tout, mais une session n'implémente qu'un sous-ensemble. Si une fonctionnalité hors session semble nécessaire, on l'ajoute au backlog plutôt qu'à la session en cours.

## Workflow de session

1. Lire `CLAUDE.md` (ce fichier)
2. Lire `docs/specs/entreprise-virtuelle-rh.md` (spec fonctionnelle)
3. Lire `docs/sessions/SESSION_X.md` (périmètre courant)
4. Implémenter strictement ce qui est dans le périmètre IN
5. Si une question relève du périmètre OUT, le signaler et reporter
6. Tester (vitest), commit conventionnel

## Concurrence et inspiration

**Limova** (concurrent identifié, contrat non signé) propose un SaaS RH classique où tout passe par chat IA. La différenciation QWESTINUM repose sur :

- La **mimétique organisationnelle** (équipe, pas chatbot)
- La **dualité chat / actions directes** (Limova force tout par chat — le donneur d'ordre clique sur ses propres outils)
- L'**option Drive** (le client voit ses livrables apparaître dans son Drive partagé — Limova garde tout en silo)
- Le **positionnement Process First** (cabinet de conseil, pas SaaS — le système s'adapte au processus client, pas l'inverse)

Ces différenciateurs doivent transparaître dans le code et l'UI.
