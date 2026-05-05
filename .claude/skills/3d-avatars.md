---
name: 3d-avatars
description: Création et animation des avatars 3D pour le bureau virtuel
---
# 3D Avatars

## Stack
- React Three Fiber (@react-three/fiber)
- Drei (@react-three/drei) pour les helpers
- Modèles : Ready Player Me ou stylisés low-poly

## Approche MVP
Pour le prototype, utiliser des avatars stylisés simples :
- Corps : géométries simples (capsule + sphère)
- Visage : expressions via morph targets ou textures
- Animation : oscillation idle, mouvement bras pour "working"
- Distinction par couleur/accessoire par rôle

## Structure
- src/components/office/Scene.tsx — Scène principale
- src/components/office/Desk.tsx — Bureau individuel
- src/components/office/AgentAvatar.tsx — Avatar générique
- src/components/office/FlowLine.tsx — Flux entre agents

## Performance
- Max 6 agents visibles simultanément (MVP)
- Utiliser instances (InstancedMesh) si > 10 agents
- Shadows désactivées sur mobile
- LOD si nécessaire
