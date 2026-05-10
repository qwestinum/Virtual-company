# Architecture — Mode audio (appel WhatsApp-like)

> **Statut** : cadrage. Pas d'implémentation prévue avant Session 6+.
> **Origine** : feedback Session 4 — le DRH doit pouvoir piloter le système purement à la voix, sans regarder l'écran (en voiture, en marche, en réunion off-screen).
> **Portée** : ce document est une **grille de validation** pour toute évolution du chat Manager. Aucune décision UX/code ne doit fermer la voie au mode audio.

---

## 1. Vision

Le mode audio est un **appel continu bidirectionnel** entre le DRH et le Manager RH virtuel. Le DRH parle, le Manager écoute (Whisper streaming) ; le Manager parle (TTS), le DRH écoute. L'expérience cible est celle d'un appel WhatsApp avec un collaborateur RH humain : pas de boutons, pas de clavier, pas d'écran requis.

**Conséquence directe** : tout élément interactif du chat texte (chip, block, bouton de validation, sélecteur de campagne) doit avoir une **projection vocale équivalente**. Si une fonctionnalité ne peut s'utiliser qu'à l'écran, elle est cassée pour le mode audio.

---

## 2. Contraintes structurantes

Toute évolution du chat doit respecter les huit règles suivantes. Elles servent de checklist en code review.

### R1 — Speakable message
Le champ `ManagerResponse.message` doit être **lisible à voix haute sans transformation**. Pas de markdown lourd (tableaux, code blocks), pas de symboles non prononçables (`✓ ✗ ▸`), pas d'icône inline. Les listes à puces sont OK (le TTS les lit comme des pauses).

**Convention** : si le message en chat texte contient un rendu visuel structuré (tableau, sous-listes profondes), prévoir un champ parallèle `voiceMessage?: string` qui dit la même chose en prose lisible. Au runtime audio, on lit `voiceMessage` ; en chat texte, on rend `message`.

### R2 — Chips énonçables
Les libellés de chips (`ChipSet.options`) doivent être :
- **Courts** (≤ 6 mots) — pour éviter de surcharger la mémoire auditive du DRH.
- **Prononçables** sans équivoque (`50-65K`, `LinkedIn`, `Garder cette liste`) — pas d'abréviation ambiguë (`WTTJ` se prononce mal, écrire `Welcome to the Jungle`).
- **Distincts** entre eux à l'écoute — éviter deux options proches phonétiquement.

**Énoncé Manager** : en mode audio, le Manager énumère les chips dans une formulation naturelle : « Vous voulez **garder cette fourchette**, ou plutôt **plus haut** à 60-75K, ou plutôt **plus bas** à 45-58K ? ». La réponse vocale du DRH est matchée contre les options par similarité sémantique (pas exact match).

### R3 — Blocks avec narration
Tout `ChatBlock` (cv-route-picker, campaign-picker, source-picker, cv-progress, cv-batch-summary) doit déclarer un champ `voiceNarration: string` ou une fonction `toVoice(payload): string` qui produit une équivalence vocale. **Pas de block sans narration audio.**

Exemple — `campaign-picker` rendu visuel = liste cliquable. Narration audio = « Vous avez deux campagnes actives : Comptable senior et Développeur Python. Sur laquelle voulez-vous rattacher ces CV ? ».

### R4 — Validation vocale
La validation FDP / fiche de scoring / autre artefact ne peut **jamais** dépendre exclusivement d'un clic bouton. Le LLM doit interpréter les intentions de validation vocale (« oui je valide », « c'est bon pour moi », « parfait », « envoie ») et déclencher l'action côté serveur.

**Implémentation** : ajouter au prompt système une règle d'extraction d'intention de validation. Quand détectée et que l'artefact courant est `isComplete`, retourner un signal `validateRequest` qui déclenche la même action que le clic bouton. Le bouton reste affiché en chat texte — mais c'est un raccourci, pas l'unique chemin.

### R5 — Switch de campagne audible
Le sélecteur de campagne (à venir en sub-phase 1.4) a un **équivalent vocal** :
- Le Manager peut annoncer le contexte spontanément (« On parle de la campagne Comptable senior » au début d'un nouveau tour si silence > N secondes).
- Le DRH peut switcher vocalement (« reprends sur Développeur Python », « passe à la nouvelle campagne »).
- Le switch déterministe (sub-phase 1.3) doit produire des chips audibles (« je démarre une nouvelle campagne ou je reste sur Comptable senior ? »).

### R6 — Persona unique
Le Manager parle **pareil** en texte et en audio. Même ton, mêmes phrasés caractéristiques, même registre. Conséquence : pas de prompt système séparé pour l'audio. Un seul prompt, lu une fois, projeté sur deux médias.

L'historique conversationnel est **indépendant du média** : si un échange a démarré en audio puis bascule en texte, le LLM voit le même fil sans rupture.

### R7 — Upload CV en mode asynchrone
L'upload de fichiers est **impossible en pur audio**. Stratégie : quand le DRH évoque un envoi de CV en mode audio, le Manager propose un **canal asynchrone** :
- Email entrant dédié (`cv@<domaine-client>.qwestinum.io` — Session 5+).
- Dossier Drive partagé (Session 5+).
- Lien d'upload one-shot envoyé par SMS (Session 6+).

Le Manager dit : « Envoyez-moi les CV par email à l'adresse que vous connaissez, je les ramasse dès qu'ils arrivent et je vous appelle au retour. » Pas de blocage du flux audio.

**Conséquence design dès maintenant** : ne pas câbler le flux d'analyse CV à la présence physique des fichiers dans le chat. La pipeline doit accepter des CV provenant de canaux externes — ce qui est de toute façon nécessaire pour la persistence Session 5.

### R8 — Artefacts résumables + lien
Tout artefact produit (annonce Job Writer, fiche de scoring, rapport CV Analyzer) doit avoir :
- Un **résumé vocal court** (3-5 phrases max) lu sur demande (« lis-moi l'annonce »).
- Un **lien d'accès complet** envoyé par email/SMS pour la lecture intégrale plus tard.

Le Manager dit : « L'annonce est prête — Comptable senior, CDI, Paris, 50-65K. Je vous l'ai envoyée par email. Vous voulez que je vous la lise en entier maintenant ? ».

---

## 3. Points de friction actuels (à garder en tête)

État du code Session 4 vs. exigences audio :

| Élément | État actuel | Conformité audio | Action requise |
|---|---|---|---|
| `ManagerResponse.message` | string libre, parfois markdown | Partielle (R1) | Ajouter `voiceMessage?` quand markdown lourd |
| `ChipSet.options` | strings libres | Partielle (R2) | Audit des libellés existants en sub-phase 1.4 |
| `ChatBlock` (5 variantes) | rendu UI uniquement | **Non conforme** (R3) | Ajouter `voiceNarration` à chaque variante |
| Validation FDP (`ValidateFDPButton`) | clic uniquement | **Non conforme** (R4) | Ajouter détection vocale dans manager-prompts |
| `CampaignHeader` (à refactor) | bandeau visuel | **Non conforme** (R5) | Sub-phase 1.4 doit livrer l'équivalent audio |
| Persona Manager | un seul prompt, OK | Conforme (R6) | RAS |
| Upload CV (`handleFilesSelected`) | trombone UI | **Non conforme par nature** (R7) | Documenter canal asynchrone, fallback explicite |
| Artefacts (annonce, rapport) | attachment chip téléchargeable | **Non conforme** (R8) | Ajouter résumé vocal + envoi email (Session 5+) |

Ce tableau évolue à chaque sub-phase — il devient le suivi de conformité.

---

## 4. Architecture cible (vue d'ensemble, indicative)

```
┌─────────────────────────┐
│  DRH (audio + texte)    │
└──────┬───────────┬──────┘
       │           │
   ┌───▼───┐   ┌───▼───┐
   │ Voix  │   │ Texte │
   │stream │   │ chat  │
   └───┬───┘   └───┬───┘
       │           │
   ┌───▼───────────▼───┐
   │ Whisper streaming │ ← VAD + segmentation
   │ + media adapter   │
   └───────┬───────────┘
           │ (texte normalisé)
   ┌───────▼───────────┐
   │ runManagerTurn()  │ ← UN SEUL POINT D'ENTRÉE
   │ (inchangé)        │
   └───┬───────────┬───┘
       │           │
   ┌───▼───┐   ┌───▼───────┐
   │ Texte │   │ TTS Manager│ ← voix unique
   │ render│   │ (audio out)│
   └───┬───┘   └───┬───────┘
       │           │
   ┌───▼───────────▼───┐
   │ DRH               │
   └───────────────────┘
```

**Point clé** : `runManagerTurn` reste l'unique point d'entrée. Le mode audio n'ajoute pas un deuxième cerveau — il branche un adapter Whisper en entrée et un adapter TTS en sortie. La logique métier ne sait pas si elle est sollicitée par texte ou par voix.

---

## 5. Hors scope

Ces points sont **acceptés comme non couverts** par le mode audio pur :

- **Lecture de l'annonce intégrale à voix haute** (>200 mots) — trop long, on résume + envoi email.
- **Upload de fichiers** — exclusivement asynchrone via email/Drive (R7).
- **Sélection précise de critères** dans une fiche de scoring de 20+ items — on lit un résumé groupé par niveau, le DRH dit « augmente le poids des compétences techniques » et le système recalcule.
- **Téléchargement de rapport CV** — résumé vocal + envoi email (R8).

Ces zones d'asynchrone sont **conscientes**, pas des oublis.

---

## 6. Critères de validation pour toute nouvelle feature

Avant d'ajouter un élément interactif au chat (chip, block, bouton, sélecteur), répondre à :

1. **Est-ce que le DRH peut accomplir cette action sans regarder l'écran ?** Si non, prévoir l'équivalent vocal **avant** le merge.
2. **Le LLM peut-il interpréter la réponse vocale équivalente ?** Si l'option est ambiguë à l'oral, simplifier ou reformuler.
3. **Le block/artefact a-t-il un texte de narration ?** Si non, ajouter `voiceNarration` ou bloquer la PR.
4. **Le flux est-il bloquant en audio ?** (ex. attendre un upload). Si oui, prévoir un fallback asynchrone explicite.

Si une feature ne peut pas répondre oui à ces 4 questions, elle doit soit être **explicitement marquée "écran-only"** dans la doc (ex. dashboard de métriques), soit retravaillée.

---

## 7. Lien avec les sub-phases en cours

- **Sub-phase 1.3** (switch déterministe) : les chips de switch (`Démarrer nouvelle / Rester sur <X>`) doivent passer R2 (énonçables). Le message pré-écrit doit passer R1 (speakable).
- **Sub-phase 1.4** (sélecteur campagne) : R5 conditionne le design — équivalent vocal du dropdown obligatoire.
- **Phase 2** (chips toujours) : règle "toujours des chips" doit aussi tenir en audio — un Manager qui n'énonce jamais d'options force le DRH à improviser, ce qui dégrade la conversation.
- **Phase 3** (Job Writer réseaux) : la sélection de réseau via chip doit être énonçable (LinkedIn, Indeed, Welcome to the Jungle, APEC, Annonce générique — tous OK).
- **Phase 4** (fiche de scoring) : R8 critique — la fiche peut faire 15-20 critères, un résumé groupé par niveau de criticité est obligatoire.

---

## 8. Prochaines étapes (post-sub-phase 1.5)

Aucune implémentation audio n'est prévue avant **Session 6 minimum**. Les sub-phases 1.3, 1.4 et les Phases 2-4 doivent simplement **respecter le cadre** ci-dessus pour ne pas créer de dette structurante.

Quand l'audio sera implémenté :
1. Choix d'un fournisseur TTS (OpenAI TTS, ElevenLabs, ou Azure) — ajustement de la voix Manager.
2. Whisper streaming (déjà en place côté serveur, à étendre côté client pour le mode call continu).
3. VAD (voice activity detection) côté client pour segmenter les énoncés DRH.
4. UI minimale d'appel : un bouton "appeler le Manager", un indicateur de qui parle, un bouton de raccrochage.
5. Audit complet des règles R1-R8 contre l'état du code.

---

**Référence rapide pour les PR** : avant tout merge sur le chat Manager, vérifier les 8 règles en checklist. Une PR qui en casse une doit soit fixer le problème, soit documenter explicitement la dette dans cette page.
