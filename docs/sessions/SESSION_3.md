# Session 3 — Chat Manager : refonte design et logique d'intention

> **Statut** : en cours
> **Pré-requis** : Sessions 1 (types, store, registre, OpenAI wrapper, 42 tests verts) et 2 (interface 2D, fond sand, cartes d'agents) complétées.
> **Spec de référence** : `docs/specs/entreprise-virtuelle-rh.md` — sections §1.1, §3 (R1), §3.2, §4.1.

## Objectif de la session

Rendre le chat avec le Manager RH **crédible** sur deux axes simultanément :

1. **Visuellement** : le chat passe à droite (plus de superposition), avec bulles, animations, états de chargement, transcription voix lisible. Style Notion/Linear, fond sand (cohérence avec Session 2).
2. **Fonctionnellement** : le Manager classe l'intention du donneur d'ordre, fait la pré-recherche (vide pour l'instant), collecte les champs obligatoires un par un, et n'autorise le passage à la phase suivante (R2 lancement de campagne) qu'une fois la FDP complète et validée explicitement.

À la fin de la session, on doit pouvoir tenir une conversation crédible avec le Manager pour cadrer une campagne de recrutement, du premier message à la validation de la FDP.

---

## Périmètre IN — à implémenter

### 1. Refonte design du chat

- **Layout** : panneau de chat fixé à droite (largeur ~400px), pas en superposition. La scène 2D reste visible à gauche.
- **Bulles différenciées** : Manager (côté gauche du panneau, accent visuel) vs donneur d'ordre (côté droit). Avatar Manager visible.
- **Animations** : entrée des bulles (fade + légère translation), indicateur de saisie (« Manager rédige... »), transitions fluides entre les états.
- **Voix** : transcription Whisper visible en temps réel pendant l'enregistrement, conversion finale en bulle envoyée. Bouton micro avec feedback visuel d'enregistrement.
- **Champs collectés** : panneau ou indicateur visuel qui montre où on en est dans la collecte de la FDP (champs remplis vs manquants). Format à proposer — possibilité de checklist latérale ou progress bar contextuelle.

### 2. Logique d'intention du Manager

Le Manager applique l'**heuristique en 4 temps** définie en §4.1 de la spec.

**Temps 1 — Détection d'intention.** Le Manager classe le premier message du donneur d'ordre dans une de ces catégories :

- `new_campaign` : nouvelle campagne (« je veux recruter un X »)
- `campaign_followup` : suivi d'une campagne existante (« où en est CAMP-XXX »)
- `out_of_campaign_task` : sollicitation hors campagne (« prépare-moi une FDP type pour... »)
- `reporting_request` : demande de reporting (« fais-moi un point »)
- `other` : autre — le Manager engage la conversation pour préciser

**Implémentation suggérée** : appel LLM dédié à la classification, avec prompt système qui retourne un JSON `{ intent, confidence, reasoning }`. Pour le MVP, ne pas faire de machine à états complexe — un appel par tour suffit, recalculé si besoin en cours de conversation.

**Temps 2 — Classification du périmètre.** Si l'intention est `new_campaign` ou `out_of_campaign_task` mais ambiguë, le Manager pose la question explicitement : « Voulez-vous lancer une campagne complète, ou simplement préparer une fiche que vous publierez plus tard vous-même ? ».

**Temps 3 — Pré-recherche.** Le Manager appelle systématiquement `searchExistingJobDescriptions(query)`. En Session 3, cette fonction retourne `[]` — c'est attendu. Le code doit être en place pour que la Session 5 n'ait qu'à remplacer l'implémentation. Le Manager dit alors une phrase comme « Je n'ai pas trouvé de fiche existante pour ce type de poste, on va la construire ensemble. » (cette phrase changera quand le storage sera réel).

**Temps 4 — Collecte progressive.** Une question à la fois. Ordre suggéré :
1. Intitulé exact du poste
2. Séniorité (junior / confirmé / senior)
3. Type de contrat (CDI / CDD / freelance)
4. Localisation (et télétravail accepté ?)
5. Fourchette de rémunération
6. Date cible de prise de poste
7. Missions principales (3 à 5)
8. Compétences clés (techniques + soft skills)

Cet ordre est indicatif — si le donneur d'ordre fournit plusieurs informations en une fois, le Manager prend tout, met à jour son état interne, et reprend par la prochaine question manquante.

**Détection d'incohérences.** Si le donneur d'ordre fournit des données contradictoires (ex. « CDD 2 ans pour comptable senior à 25k€ »), le Manager signale et demande arbitrage avant de continuer.

### 3. Suggestions du Manager — chips cliquables

Le Manager propose des suggestions sous forme de **chips cliquables** qui accélèrent les réponses du donneur d'ordre sans contraindre la saisie libre. Le format est choisi par le Manager selon la nature de la question.

**Trois formats de chips, pas exclusifs.**

| Format | Quand l'utiliser | Exemple |
|---|---|---|
| **Chips de réponse fermée** sous la bulle du Manager | Question à choix limité avec options canoniques | « Quel type de contrat ? » → chips `CDI` / `CDD` / `Freelance` / `Stage` |
| **Chips de relance** au-dessus de la zone de saisie | Actions méta sur la conversation | `Continuer` / `Voir un exemple` / `Passer cette question` |
| **Chips de proposition** intégrés dans la bulle du Manager | Quand le Manager suggère une valeur par défaut argumentée | « Pour un comptable senior à Paris, je vois 50-65k€ » → chip `Utiliser cette fourchette` |

Le Manager n'affiche **jamais les trois en même temps** — il choisit le format approprié à la question en cours. Le LLM décide quel format utiliser via le format de sortie structuré (cf. §Prompts système).

**Comportement au clic.**

Cliquer sur un chip envoie son texte comme un message du donneur d'ordre. La bulle apparaît dans l'historique exactement comme si le donneur d'ordre l'avait tapée. L'historique reste auditable, et la conversation conserve sa cohérence narrative — c'est exactement ce que ferait un humain qui répond brièvement.

Pas d'option « clic silencieux qui remplit le champ sans bulle » — ça casserait l'illusion de conversation.

**Coexistence avec la saisie libre.**

Quand des chips sont affichés, la zone de saisie texte et le bouton micro restent **actifs et utilisables**. Les chips sont des accélérateurs, pas des contraintes. Le donneur d'ordre peut toujours taper « plutôt CDI mais ouvert au CDD si profil exceptionnel » s'il veut être nuancé. Les chips disparaissent dès qu'un message est envoyé (chip ou texte libre).

**Génération des chips par le LLM.**

Les chips sont générés par le prompt conversationnel principal du Manager. Le format de sortie structuré inclut un champ `chips` :

```typescript
interface ManagerResponse {
  message: string;              // texte de la bulle
  chips?: {
    placement: 'below_bubble' | 'above_input' | 'inline';
    options: string[];          // 2 à 5 chips max
  };
  fieldExtractions?: Partial<Record<FieldKey, unknown>>;
}
```

Limite : **2 à 5 chips maximum** par message. Au-delà, c'est un menu, pas une suggestion.

**Quand ne pas afficher de chips.**

- Question ouverte qui appelle une réponse riche (« Quelles sont les missions principales ? »)
- Demande de validation finale (« Confirmez-vous la fiche de poste ? » → bouton dédié, pas chip)
- Conversation libre hors collecte structurée

Le Manager doit savoir s'abstenir — afficher des chips à chaque tour est plus agaçant qu'utile.

### 4. Tracking des champs remplis

L'état de collecte est **visible en permanence** dans l'UI :

- Liste des champs avec icône statut (vide / rempli / en cours de collecte).
- Mise à jour en temps réel à chaque tour de conversation où le Manager extrait une information.
- Quand tous les champs obligatoires sont remplis, l'UI fait apparaître un bouton ou bloc « Valider la fiche de poste » qui est l'équivalent visuel du jalon de validation bloquante (cf. spec §6.1).
- Pas de validation = pas de R2 = pas de transition vers la phase suivante.

### 5. Différenciation visuelle campagne / hors campagne

L'interface doit montrer clairement laquelle des deux modalités est en cours :

- **Campagne** : bandeau ou indicateur « Campagne CAMP-XXXX en cours de cadrage » (ID généré dès la classification d'intention `new_campaign`).
- **Hors campagne** : bandeau « Sollicitation TASK-XXXX » avec format simplifié (pas de progress bar de campagne, juste l'attente du livrable).

---

## Périmètre OUT — à NE PAS implémenter

Ces éléments sont dans la spec mais **hors session 3** :

- **Implémentation réelle des autres agents** (Job Writer, Publisher, CV Analyzer, Scheduler, Rejection Writer). Ils existent dans le store comme cartes statiques avec leurs métadonnées, mais ne sont pas exécutables en Session 3.
- **Actions directes UI** sur seuils, toggles d'agents, désactivation de campagne. Toute la mécanique chat / actions directes est documentée mais reportée en Session 5.
- **Prise d'acte du Manager** sur actions UI. Pas d'actions UI en Session 3 = pas de prise d'acte à implémenter.
- **Pré-recherche réelle** dans le storage. La fonction existe et retourne `[]` — c'est tout.
- **Niveaux L2 et L3 de pré-recherche** (suggestions multiples, génération d'inspirations). Hors MVP.
- **Storage hybride Supabase + Drive**. Aucun appel à Supabase ou Drive en Session 3.
- **Multi-campagnes simultanées**. Une seule campagne ou tâche active à la fois.
- **Persistance entre rechargements**. L'état du chat est volatile en Session 3 — un refresh remet à zéro.
- **Reporting / point hebdomadaire** (R5). Pas de cron, pas de génération de compte-rendu.
- **Génération du brief de campagne validé** comme artefact (PDF ou structure exportée). En Session 3, la FDP validée est juste un objet en mémoire dans le store.

Si Claude Code identifie un besoin qui relève de cette liste, il **signale** et **reporte** à la session correspondante — il n'implémente pas.

---

## Architecture technique attendue

### Fichiers nouveaux ou modifiés

```
src/
  components/
    chat/
      ManagerChat.tsx          (panneau principal, layout droite)
      ChatBubble.tsx           (bulle avec variantes manager/user)
      ChatInput.tsx            (input texte + bouton micro)
      ChatChips.tsx            (chips cliquables, 3 placements)
      VoiceTranscript.tsx      (transcription temps réel)
      FieldChecklist.tsx       (tracking des champs remplis)
      ValidateFDPButton.tsx    (apparaît quand FDP complète)
      CampaignHeader.tsx       (bandeau CAMP-XXXX ou TASK-XXXX)
  lib/
    agents/
      manager.ts               (logique intention + collecte)
      manager-prompts.ts       (prompts système)
    storage/
      job-descriptions.ts      (stub vide, contrat à respecter)
  types/
    intent.ts                  (Intent, IntentClassification)
    field-collection.ts        (FieldStatus, FDPInProgress)
  store/
    chat-slice.ts              (état chat, messages, intention courante)
    fdp-slice.ts               (état FDP en cours de construction)
```

### Contrats clés

```typescript
// src/types/intent.ts
type Intent = 'new_campaign' | 'campaign_followup' | 'out_of_campaign_task' | 'reporting_request' | 'other';

interface IntentClassification {
  intent: Intent;
  confidence: number;          // 0..1
  reasoning: string;           // pour debug et logs
  needsClarification: boolean; // true si intent ambigu
}

// src/types/field-collection.ts
type FieldKey =
  | 'job_title'
  | 'seniority'
  | 'contract_type'
  | 'location'
  | 'salary_range'
  | 'start_date'
  | 'main_missions'
  | 'key_skills';

interface FieldStatus {
  key: FieldKey;
  label: string;
  status: 'empty' | 'in_progress' | 'filled';
  value?: unknown;
  required: boolean;
}

interface FDPInProgress {
  campaignId: string;          // CAMP-XXXX
  fields: Record<FieldKey, FieldStatus>;
  isComplete: boolean;
  isValidated: boolean;        // true après validation explicite du donneur d'ordre
}

// src/types/manager-response.ts
type ChipPlacement = 'below_bubble' | 'above_input' | 'inline';

interface ChipSet {
  placement: ChipPlacement;
  options: string[];           // 2 à 5 chips
}

interface ManagerResponse {
  message: string;             // texte de la bulle
  chips?: ChipSet;             // optionnel, jamais de force
  fieldExtractions?: Partial<Record<FieldKey, unknown>>;
}
```

### Prompts système

Le Manager a deux prompts distincts pour cette session :

1. **Prompt de classification d'intention** : retourne strictement un JSON `IntentClassification`. Court, factuel.
2. **Prompt conversationnel principal** : reçoit l'intention classée + l'état courant de la FDP + l'historique de conversation. Génère la prochaine réponse au format `ManagerResponse` (message + chips optionnels + extractions de champs). Respecte les comportements de la spec §4.1 (une question à la fois, ton métier, pas de jargon technique). Le LLM décide lui-même quand afficher des chips et quel placement choisir, en suivant les règles du périmètre IN §3.

---

## Critères de fin de session

La Session 3 est terminée quand :

1. **Démo conversationnelle complète** : on peut ouvrir l'app, parler ou écrire au Manager, lui dire « je veux recruter un comptable senior à Paris », et avoir une conversation cohérente jusqu'à la validation explicite de la FDP. Le Manager pose une question à la fois, met à jour la checklist visuelle, propose des chips contextuels pertinents.
2. **Chips fonctionnels sur les trois placements** : au moins une question avec chips `below_bubble` (ex. type de contrat), au moins une avec chips `above_input` (ex. relance « Voir un exemple »), au moins une avec chip `inline` (ex. proposition de fourchette salariale). Le clic sur un chip envoie une bulle utilisateur. La saisie libre coexiste sans conflit.
3. **Pré-recherche en place** : `searchExistingJobDescriptions` est appelée, retourne `[]`, et le Manager produit une phrase appropriée. Le code de la Session 5 ne touchera pas le Manager.
4. **Trois cas testés en bout en bout** : nouvelle campagne, sollicitation hors campagne, intention ambiguë (Manager pose la question de clarification).
5. **Bouton « Valider la fiche de poste »** apparaît uniquement quand tous les champs requis sont remplis, et son clic génère un événement `fdp_validated` qui sera l'input de la future R2 (mais R2 elle-même n'est pas implémentée).
6. **Tests vitest verts** : couverture sur la classification d'intention, l'extraction des champs, la transition vers l'état « FDP validée », et le rendu conditionnel des chips selon le `ChipPlacement`.
7. **Aucun élément hors périmètre n'a été implémenté.** Vérification par diff de fichiers : tout fichier modifié appartient à la liste de l'architecture attendue ci-dessus.

---

## Pièges à éviter

- **Ne pas implémenter une machine à états trop complexe pour la classification.** Un appel LLM par tour suffit pour le MVP. Une vraie machine à états explicite côté Next.js sera utile en Session 4 quand on ajoutera l'orchestration multi-agents.
- **Ne pas ignorer la voix.** Le micro Whisper fonctionne déjà depuis la Session 3 précédente — la refonte design doit le rendre **plus** lisible, pas le casser.
- **Ne pas mélanger refonte design et logique fonctionnelle dans les mêmes commits.** Faire d'abord la logique sur l'UI existante, puis la refonte design, ou vice-versa — mais isoler. Cela facilite le débogage et la review.
- **Ne pas inventer de champs.** Les 8 champs listés ci-dessus sont la liste fermée pour le MVP. Si un client veut un 9e champ, ce sera une feature post-MVP.
- **Ne pas afficher de chips à chaque tour.** Le Manager doit savoir s'abstenir. Une question ouverte (« quelles sont les missions principales ? ») n'a pas de chips. Imposer des chips partout transforme la conversation en formulaire déguisé — l'inverse de l'effet recherché.
- **Ne pas dépasser 5 chips par message.** Au-delà, c'est un menu déroulant — pas une suggestion. Le LLM doit être contraint par le prompt.
- **Ne pas afficher de jargon technique** dans la checklist ni dans le bandeau de campagne. `CAMP-2026-014` est OK (c'est une référence métier). `intent: new_campaign confidence: 0.94` n'est pas OK — c'est de la donnée interne.

---

## Ce qui vient après

**Session 4** : implémentation réelle du CV Analyzer (cf. spec §4.5). C'est l'agent qui rendra le système vivant — c'est lui qui produit du volume sur la durée et qui alimentera le dashboard de la Session 5.

**Session 5** : dashboard + storage hybride Supabase + Drive. C'est là que la pré-recherche L1 / L2 du Manager devient réelle, et que les actions directes UI sont implémentées.
