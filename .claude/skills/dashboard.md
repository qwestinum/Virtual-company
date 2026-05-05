---
name: dashboard
description: Dashboard de métriques et monitoring des agents
---
# Dashboard

## Composants
- KPIRow : 6 métriques globales (tâches, actifs, succès, GO, conversion, coût)
- AgentPerformance : barres par agent avec métriques
- ActivityFeed : flux temps réel des actions
- CampaignCards : campagnes avec stats et actions

## Data source
- Supabase tables : agent_metrics, candidates, campaigns, audit_log
- Supabase Realtime pour les mises à jour live
- Store Zustand comme cache local

## Style
- Palette : warm light theme (Notion/Linear inspired)
- Fonts : Plus Jakarta Sans (titres), Nunito (body), JetBrains Mono (data)
- Animations : compteurs animés, fade-in en cascade
- Responsive : grid adaptatif 6 → 3 → 2 colonnes
