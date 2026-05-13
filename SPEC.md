# Spécification — Virtual Enterprise

## Vision
Une entreprise virtuelle où des employés IA traitent des processus métier réels.
Le donneur d'ordre dialogue avec un Manager RH qui coordonne une équipe d'agents
spécialisés. Positionnement **Process First** : l'IA appliquée aux processus
métier, mimétique avec le fonctionnement d'une vraie équipe RH.

---

## 1. État actuel du projet

### 1.1 Navigation et écrans implémentés

- **Landing page** publique (présentation, accès login)
- **Login** Supabase Auth
- **Lobby des départements** (RH actif, autres départements en placeholder)
- **Département RH** : présentation des services
- **Service recrutement** : accès au workspace
- **Workspace** : bureau virtuel (cartes agents 2D, lignes de flux SVG) + chat
  intégré avec le Manager RH
- **Dashboard** : métriques temps réel par campagne et par agent
- **Settings** : configuration des boîtes mail IMAP, paramètres agents

Toutes les pages partagent un **design dark navy/cyan cohérent**, un TopBanner
translucide partagé et un SiteFooter bleu ciel.

### 1.2 Conversation Manager RH

- Chat conversationnel **texte + vocal (Whisper)** avec le Manager RH
- **Détection d'intent** sur le message d'entrée (campagne complète, sollicitation
  hors campagne, question simple)
- **Collecte progressive** des champs manquants, une seule question à la fois
- Le Manager **cherche les campagnes passées similaires** (`searchExistingJobDescriptions`)
  et **propose les critères existants** en mode éditable avant de partir de zéro
- Prise d'acte des actions UI (toggles, sliders) dans le fil de conversation

### 1.3 Fiche de scoring et campagnes

- **Fiche de scoring configurable** (critères, poids, conditions rédhibitoires)
  **obligatoire** avant lancement de campagne
- Le donneur d'ordre peut éditer/valider les critères suggérés par le Manager
- Lancement de campagne déclenche le **Job Writer** (rédaction d'annonce)

### 1.4 Pipeline candidats

- **CV Analyzer** avec scoring pondéré déterministe :
  - le LLM extrait les informations structurées du CV
  - les règles configurées scorent (le LLM ne note pas, les règles si)
- **Upload multi-CV via trombone** dans le chat
- **Flux email IMAP configurable** (boîtes mail gérées dans Settings) : ingestion
  automatique des CV reçus par mail
- **Mail Composer** avec lien Cal.com pour invitations entretien
- **Scheduler** avec briefing pré-entretien automatique

### 1.5 Persistance et infrastructure

- **Supabase complet** : tables campagnes, candidats, scores, journal, métriques
- **Authentification Supabase Auth** : login, middleware, landing publique
- **Déploiement Vercel** (auto sur main)

---

## 2. Nouvelles fonctionnalités

### 2.1 Agent Comité RH (Comitologie)

Agent de **gouvernance** qui produit automatiquement des rapports de pilotage,
sans intervention manuelle.

**Rôle**
- Synthétiser l'activité RH pour la direction
- Identifier les signaux faibles et alerter
- Recommander des actions concrètes

**Avatar** : costume sobre, tablette à la main, posture analytique.

**Rapport hebdomadaire** (livrable principal)
- État des campagnes en cours (statut, ancienneté, blocages)
- Volumétrie CV : reçus, analysés, shortlistés, rejetés
- Taux de conversion par étape (CV → shortlist → entretien → embauche)
- Postes en difficulté (campagnes avec peu de CV, faible taux de qualification)
- Coût IA cumulé sur la période (par agent, par campagne)

**Recommandations actionnables**
- "Élargir les critères X et Y sur la campagne CAMP-0042"
- "Relancer les invités sans réponse depuis plus de 5 jours"
- "Republier l'annonce CAMP-0038 sur une plateforme supplémentaire"

**Analyse de tendances**
- Comparaison semaine N vs N-1 vs N-4
- Détection de patterns (jours de la semaine, plateformes les plus efficaces)
- Évolution des coûts IA et corrélation avec le volume

**Alertes proactives** (en temps réel, hors cycle hebdomadaire)
- Campagne sans CV reçu depuis plus de 5 jours
- Taux de refus en hausse anormale (>2 écarts-types)
- Coût IA en dépassement par rapport au budget de campagne
- Boîte mail IMAP en erreur depuis plus de 24h

**Architecture déterministe**
- Les données sont extraites par **requêtes SQL déterministes** sur Supabase
  (jamais via le LLM)
- Le LLM **rédige uniquement la narration** à partir des données structurées
- Cela garantit la fiabilité des chiffres et la reproductibilité des rapports

**Livrable**
- Rapport **Markdown/PDF** envoyé par email (paramétrable dans Settings)
- Affichage dans une nouvelle section **"Comitologie"** du Dashboard
- Historique des rapports consultable

**Trigger** : continu (alertes) + planifié hebdomadaire (rapport)

---

### 2.2 Organisation Apprenante

Le système **capitalise** sur les campagnes passées et **s'améliore** au fil du
temps, plutôt que de repartir de zéro à chaque demande.

**Mémoire des campagnes passées**
- Quand le donneur d'ordre lance une nouvelle campagne, le Manager interroge
  les campagnes similaires précédentes (titre, secteur, séniorité)
- Il propose les **critères, pondérations et conditions rédhibitoires** des
  campagnes les plus proches, en mode éditable
- Le donneur d'ordre valide, ajuste ou repart de zéro — son choix devient
  signal pour les futures recommandations

**Amélioration du scoring par feedback**
- À la **clôture d'une campagne**, le donneur d'ordre renseigne le résultat
  réel (candidat retenu, performance en période d'essai, abandon, etc.)
- Le système **compare prédiction (score initial) vs réalité**
- Il **suggère des ajustements de pondération** pour les futures campagnes
  similaires (ex : "le critère X a sur-pondéré, le critère Y a été sous-évalué")
- Les ajustements sont **propositions**, jamais appliqués automatiquement

**Base de connaissances enrichie (RAG)**
- Fiches de poste, annonces validées, trames d'email, mails-types
- Indexation via **pgvector dans Supabase**
- Recherche sémantique (RAG) pour alimenter les agents Job Writer, Mail Composer
- Les artefacts validés par le donneur d'ordre rejoignent automatiquement la base

**Corrections comme signal**
- Quand le donneur d'ordre **modifie un output d'agent** (annonce, email, score)
  avant validation, la modification est **enregistrée**
- Les **patterns récurrents** sont détectés (mêmes formulations changées, mêmes
  pondérations ajustées)
- Ces patterns **enrichissent les prompts système** des agents concernés
  (apprentissage par feedback implicite)

**Benchmarking interne**
- Délai moyen entre publication et premier CV qualifié
- Taux de conversion par plateforme (LinkedIn vs Indeed vs Welcome to the Jungle)
- Corrélation entre critères de scoring et **réussite réelle en période d'essai**
- Affichage dans le Dashboard avec comparaison campagne courante vs historique

---

## 3. Agents

### Manager RH (Orchestrateur visible)
Point d'entrée unique du donneur d'ordre. Collecte, dispatch, prise d'acte des
actions UI. Parle métier, jamais technique. Une question à la fois.

### CV Analyzer
Analyse et score les CV. LLM extrait, règles scorent (déterministe).
Trigger : continu (IMAP) + ponctuel (upload).

### Job Writer
Rédige les annonces d'emploi multi-plateformes. Trigger : validation de campagne.

### Mail Composer
Rédige les emails RH (invitation, refus, relance). Insère liens Cal.com.
Trigger : workflow campagne.

### Scheduler
Planifie les entretiens via Cal.com. Produit le briefing pré-entretien.

### Comité RH *(nouveau — section 2.1)*
Agent de gouvernance. Rapports hebdomadaires, alertes proactives, recommandations.

### Learning Loop *(nouveau — section 2.2)*
Composant transverse, pas un agent visible. Indexation pgvector, détection de
patterns sur les corrections, ajustements suggérés.

---

## 4. Contrat Agent (TypeScript)

```typescript
interface AgentContract {
  id: string;
  name: string;
  role: string;
  department: 'rh' | 'finance' | 'commercial' | 'tech' | 'marketing';

  enabled: boolean;
  status: 'idle' | 'active' | 'error' | 'disabled';

  trigger: {
    type: 'continuous' | 'punctual' | 'scheduled';
    source: string;
  };

  humanValidation: {
    required: boolean;
    enabled: boolean;
  };

  skills: Skill[];
  inputs: IOPort[];
  outputs: IOPort[];

  execute(input: TaskInput): Promise<TaskOutput>;
}
```

Voir `src/types/agent.ts` pour les types complets (Skill, IOPort, TaskInput,
TaskOutput, AgentMetrics).

---

## 5. Priorité d'implémentation

### Phases livrées

1. **Fondations** — types, store Zustand, contrats agents
2. **Workspace 2D** — cartes agents, lignes de flux, design dark navy/cyan
3. **Manager RH conversationnel** — chat texte + Whisper, intent, collecte
4. **CV Analyzer + scoring déterministe** — extraction LLM, règles configurables
5. **Job Writer + Mail Composer + Scheduler** — pipeline campagne complet
6. **Persistance Supabase** — tables, journal, métriques
7. **Auth Supabase** — login, middleware, landing publique
8. **Flux IMAP configurable** — ingestion CV par mail
9. **Dashboard métriques temps réel**
10. **Déploiement Vercel**

### Phase courante et à venir

11. **Agent Comité RH** *(nouveau)*
    - 11.1 Schémas SQL et requêtes déterministes pour extraction des KPIs
    - 11.2 Templates de rapport (Markdown) avec slots à remplir par LLM
    - 11.3 Génération PDF et envoi email programmé
    - 11.4 Section "Comitologie" dans le Dashboard + historique
    - 11.5 Moteur d'alertes proactives (rules engine sur Supabase)

12. **Organisation Apprenante** *(nouveau)*
    - 12.1 Activation pgvector dans Supabase + indexation des artefacts validés
    - 12.2 RAG dans Job Writer et Mail Composer
    - 12.3 Recommandation de critères basée sur campagnes passées (étend la
      pré-recherche existante du Manager)
    - 12.4 Flux de clôture de campagne avec saisie du résultat réel
    - 12.5 Comparateur prédiction vs réalité + suggestion de pondérations
    - 12.6 Capture des corrections DRH comme signal d'apprentissage
    - 12.7 Benchmarking interne dans le Dashboard

### Backlog post-MVP

- Autres départements (Finance, Commercial, Tech, Marketing)
- Migration vers n8n + Supabase comme cerveau externe
- Multi-tenant et rôles utilisateurs étendus
