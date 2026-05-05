---
name: review
description: Revue de code complète avant commit
---
Effectue une revue de code complète sur les changements en cours : $ARGUMENTS

1. Liste tous les fichiers modifiés (git status / git diff)
2. Vérifie le respect des règles définies dans CLAUDE.md :
   - TypeScript strict, pas de `any`
   - Composants < 200 lignes
   - Conventions de nommage
   - Pas de clés API hardcodées
   - Appels AI via src/lib/ai/provider.ts uniquement
3. Vérifie que chaque agent respecte le contrat AgentContract
4. Identifie les bugs potentiels et edge cases manqués
5. Suggère des améliorations de lisibilité
6. Vérifie que les tests existent pour la logique critique
7. Produis un rapport structuré : OK / À corriger / Suggestions

Ne fais AUCUNE modification de code. Revue uniquement.
