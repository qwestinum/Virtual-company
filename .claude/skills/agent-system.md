---
name: agent-system
description: Architecture et patterns pour le système d'agents IA
---
# Agent System Architecture

## Principes
- Tout agent implémente AgentContract (src/types/agent.ts)
- L'orchestrateur (Manager RH) est lui-même un agent avec isOrchestrator=true
- Les agents communiquent via le store Zustand, jamais directement
- Chaque appel agent produit un TaskOutput avec métriques

## Pattern d'exécution
1. Le store reçoit un dispatch(agentId, taskInput)
2. L'agent vérifie : enabled? humanValidation?
3. Si validation requise et activée → status = 'awaiting_validation'
4. Sinon → exécute via src/lib/ai/provider.ts
5. Résultat écrit dans le store + Supabase
6. Si nextAgents[] non vide → dispatch chaîné

## Fichiers clés
- src/types/agent.ts — Contrats TypeScript
- src/lib/agents/registry.ts — Registre des agents
- src/lib/agents/orchestrator.ts — Manager RH / dispatch
- src/lib/agents/executor.ts — Exécution générique
- src/store/agents.ts — Store Zustand
