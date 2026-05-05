# Virtual Enterprise — QWESTINUM

## Projet
Prototype d'entreprise virtuelle avec agents IA représentés par des employés 3D.
Le MVP couvre le département RH avec un manager et des agents spécialisés.

## Stack
- Framework : Next.js 16 (App Router, TypeScript)
- UI : Tailwind CSS + shadcn/ui
- 3D : Three.js via React Three Fiber + Drei
- State : Zustand
- AI : OpenAI API (GPT-4o + Whisper)
- DB : Supabase (Postgres + Realtime)
- Deploy : VPS Hostinger existant

## Règles absolues
- TypeScript strict, jamais de `any`
- Chaque agent implémente le contrat AgentContract (voir types/agent.ts)
- Chaque composant a un seul fichier, max 200 lignes
- Les appels AI passent par src/lib/ai/provider.ts, jamais directs
- Les clés API sont dans .env.local, jamais hardcodées
- Tester avec vitest avant commit
- Commits conventionnels : feat:, fix:, refactor:

## Architecture agents
- Chaque agent = { id, name, role, skills[], inputs[], outputs[], trigger, humanValidation }
- L'orchestrateur (Manager RH) reçoit les requêtes et dispatch aux agents
- Les agents communiquent via un event bus (Zustand + Supabase Realtime)
- Chaque exécution d'agent produit des métriques (durée, tokens, coût, statut)

## Conventions de nommage
- Composants : PascalCase (AgentCard.tsx)
- Fonctions/variables : camelCase
- Types/Interfaces : PascalCase préfixé (AgentContract, TaskInput)
- Fichiers utilitaires : kebab-case (ai-provider.ts)

## Ce que Claude Code doit savoir
- Le projet est un prototype pour démontrer le concept à des clients
- L'effet "wow" visuel est aussi important que la fonctionnalité
- Les avatars 3D doivent être expressifs et professionnels
- L'interface doit fonctionner en temps réel (WebSocket via Supabase)
- Priorité : fonctionnel > beau > performant (c'est un prototype)
