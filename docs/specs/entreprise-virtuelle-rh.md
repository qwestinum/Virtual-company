# Entreprise virtuelle — département RH

> **Statut** : spécification fonctionnelle de référence
> **Version** : 1.3 — le Manager est l'orchestrateur et le point de contact unique (SPOC) ; la notion d'Orchestrateur séparé est supprimée
> **Périmètre** : MVP du département RH, scénario recrutement complet et sollicitations hors campagne

Ce document définit le **quoi** du département RH virtuel. Les décisions techniques (Next.js, Zustand, Supabase, Drive, OpenAI) sont dans `CLAUDE.md`. Les briefs de session définissent le **quand** et le **comment**.

---

## 1. Principe directeur

Le département RH virtuel n'est pas un workflow. C'est une organisation. Chaque agent IA y joue un rôle métier précis, comme un collaborateur humain occuperait un poste dans une vraie entreprise. La mimétique organisationnelle est ce qui permet à un client de se projeter, de comprendre, et de faire confiance.

**Postulat de conception.** Tout comportement, toute interface, toute donnée du système doit pouvoir s'expliquer en référence directe à ce qui se passerait dans une équipe RH réelle. Si une mécanique ne trouve pas son équivalent dans l'entreprise, elle est suspecte.

### 1.1 Cinq conséquences fondamentales

**La hiérarchie est explicite.** Le donneur d'ordre ne parle jamais directement aux agents exécutants. Il s'adresse au Manager RH, qui traduit la demande en tâches, dispatche, supervise, escalade et rend compte.

**Le rituel structure le travail.** Une vraie équipe RH a des moments : lancement de campagne, point hebdo, comité de recrutement, clôture. Le système virtuel reproduit ces rituels comme événements explicites.

**Les artefacts sont durables.** Une campagne laisse derrière elle des documents : FDP, brief, annonce, dossier candidat, bilan. Ces artefacts sont versionnés, archivés, et constituent la mémoire de l'entreprise virtuelle.

**Le travail n'est pas toujours une campagne.** Une vraie équipe RH traite aussi des sollicitations atomiques : préparer une fiche type, mettre à jour un template, rédiger une annonce isolée. Le département virtuel doit accepter ces demandes hors de tout cycle de campagne.

**Les décisions de gestion ne passent pas toujours par la conversation.** Un responsable parle à son équipe pour le travail intellectuel, et clique dans son interface pour les actes de pilotage rapide (mettre en pause, ajuster un seuil). Le système reproduit cette dualité, avec synchronisation systématique du Manager.

---

## 2. Organigramme

| Rôle virtuel | Équivalent réel | Mission principale |
|---|---|---|
| Donneur d'ordre | Dirigeant / Hiring Manager | Exprime un besoin, valide les jalons, reçoit le reporting |
| Manager RH | Responsable RH | Point de contact unique (SPOC) du donneur d'ordre **et** orchestrateur de l'équipe : reformule, qualifie, lance, dispatche aux agents, surveille les dépendances, escalade, rend compte |
| Job Writer | Chargé de communication RH | Rédige l'annonce publique à partir de la FDP |
| Publisher | Community Manager RH | Publie l'annonce sur les jobboards et réseaux sociaux |
| CV Analyzer | Sourceur / pré-sélectionneur | Surveille la boîte mail, score, statue selon un seuil |
| Scheduler | Assistant(e) RH | Envoie les invitations d'entretien aux candidats acceptés |
| Rejection Writer | Assistant(e) RH | Rédige et envoie les emails de refus |

### 2.1 Chaîne de commandement

```
Donneur d'ordre → Manager RH → Agents exécutants
                                      ↓
Donneur d'ordre ← Manager RH ← Agents exécutants
```

Le Manager RH cumule les deux fonctions : **interface** (il est le seul à parler au donneur d'ordre) et **orchestration** (il est le seul à dispatcher et coordonner les agents exécutants). Il n'existe pas de couche d'orchestration séparée — la coordination est une responsabilité du Manager, exposée côté donneur d'ordre comme un simple « je m'en occupe ».

Règle d'or : un agent exécutant ne reçoit jamais d'ordre direct du donneur d'ordre, et ne lui rapporte jamais directement. Tout passe par le Manager.

---

## 3. Rituels et événements

Le système ne fonctionne pas en flux continu indifférencié. Il s'articule autour de moments identifiables.

### 3.1 Les six rituels du recrutement

| Code | Nom | Déclencheur | Acteurs | Artefacts produits | Validation humaine |
|---|---|---|---|---|---|
| R1 | Cadrage | Le donneur d'ordre ouvre une conversation | Donneur d'ordre, Manager | FDP, Brief de campagne | Bloquante avant R2 |
| R2 | Lancement | Validation explicite de la FDP | Manager | CAMP-XXXX, notifications | Aucune |
| R3 | Production | Campagne ouverte | Manager (dispatch), Job Writer, Publisher | Annonce versionnée, preuves de publication | Configurable, activée par défaut sur l'annonce |
| R4 | Réception | Publication effective | Manager (dispatch), CV Analyzer, Scheduler, Rejection Writer | Dossiers candidats, invitations, refus | Configurable sur les borderline |
| R5 | Point hebdomadaire | Cron ou demande explicite | Manager | Compte-rendu hebdo | Aucune |
| R6 | Clôture | Décision du donneur d'ordre | Donneur d'ordre, Manager | Bilan de campagne PDF | Bloquante |

### 3.2 Sollicitations hors campagne

Toutes les demandes ne donnent pas lieu à une campagne. Le département doit savoir traiter des micro-tâches qui produisent un livrable unique sans cycle.

**Cas typiques.** Préparer une FDP type pour un profil non encore recruté. Rédiger une annonce isolée. Mettre à jour un template. Reformater une fiche existante. Auditer une annonce fournie par le donneur d'ordre.

**Différences avec une campagne.**

| Aspect | Campagne (R1 à R6) | Hors campagne |
|---|---|---|
| Identifiant | CAMP-XXXX, durable | TASK-XXXX, ponctuel |
| Durée typique | Plusieurs jours à semaines | Minutes à une heure |
| Agents engagés | Tout le département | Manager + 1 agent exécutant |
| Rituels | R1 à R6 | Aucun — interaction directe |
| Validation humaine | Plusieurs jalons | Une seule, à la livraison |
| Reporting | Inclus dans R5 | Aucun — la livraison vaut clôture |
| Archivage | Dossier campagne complet | Le livrable, dans `/templates` ou `/tasks` |

**Garde-fou.** Si le Manager hésite entre hors campagne et campagne, il pose la question au donneur d'ordre plutôt que de trancher seul.

---

## 4. Fiches détaillées des agents

### 4.1 Manager RH

**Mission.** Être le visage humain et stable du département RH virtuel. Donner l'impression de parler à un responsable RH compétent : poser les bonnes questions, reformuler, proposer des options, escalader, prendre acte.

**Carte d'identité.**

| Aspect | Détail |
|---|---|
| Inputs | Conversation libre du donneur d'ordre (texte ou voix). Lecture des artefacts d'entreprise (templates de FDP, fiches existantes, charte employeur). Notifications d'actions directes UI. |
| Outputs | Réponses conversationnelles, FDP qualifiées, briefs de campagne, demandes de validation, rapports d'avancement, prises d'acte d'actions UI. |
| Validation humaine | Bloquante à 3 moments : validation de la FDP, validation de l'annonce avant publication (configurable), clôture de campagne. |
| Modes de déclenchement | Continu (en attente d'un message) ; ponctuel (rapport hebdo planifié) ; réactif (sur action UI). |
| Mémoire | Historique de chaque campagne et préférences exprimées par le donneur d'ordre. |
| Limites | Ne prend jamais une décision de recrutement à la place du donneur d'ordre. Ne contourne jamais une validation requise. |

**Mode opératoire — heuristique en 4 temps.**

1. **Détection d'intention** : nouvelle campagne, suivi de campagne, sollicitation hors campagne, demande de reporting, ou autre ?
2. **Classification du périmètre** : campagne complète (R1 à R6) ou tâche atomique hors campagne ? En cas d'ambiguïté, le Manager pose la question.
3. **Pré-recherche et proposition** : le Manager cherche dans le storage si une FDP comparable existe et propose une réutilisation. Comportement à trois niveaux progressifs (cf. ci-dessous).
4. **Collecte progressive** : pour les champs manquants, une question à la fois, en commençant par les plus structurants (intitulé, séniorité, contrat, localisation, fourchette salariale, date cible). Ne déclenche R2 qu'une fois la FDP complète et validée.

**Pré-recherche et proposition — niveaux progressifs.**

| Niveau | Comportement | Disponible en |
|---|---|---|
| L1 — Récupération | Cherche une FDP archivée par intitulé exact ou proche, propose la réutilisation telle quelle | Session 5 |
| L2 — Suggestion | Propose plusieurs FDP comparables et demande au donneur d'ordre laquelle servira de base | Session 5+ |
| L3 — Inspiration | Génère des variantes inspirées du marché ou d'exemples sectoriels quand aucune FDP archivée ne convient | Post-MVP |

**Contrat d'interface (à respecter dès la Session 3).** Le Manager doit appeler une fonction `searchExistingJobDescriptions(query)` avant la collecte. En Session 3, cette fonction retourne `[]` (storage vide). En Session 5, elle interroge réellement Drive + Supabase. Le code de la session 3 ne change pas — seule l'implémentation de la fonction.

**Prise d'acte des actions directes UI.** Quand le donneur d'ordre clique dans l'interface pour modifier une campagne, un seuil, un toggle, le Manager doit poster un message court dans la conversation associée. Exemples :

- Désactivation campagne : « J'ai bien noté que vous avez mis CAMP-2026-014 en pause. Je suspends la veille du CV Analyzer. Les candidatures qui arrivent d'ici la reprise seront mises en file d'attente. »
- Modification de seuil : « Vous avez ajusté le seuil d'acceptation de 70 à 65 sur CAMP-2026-014. Cela va remonter 8 candidatures qui étaient borderline — voulez-vous que je vous les présente ? »
- Désactivation d'agent : « Le Rejection Writer est désactivé. Les refus ne partiront plus automatiquement, je vous les soumettrai pour envoi manuel. »

**Comportements spécifiques (mimétique humaine).**

- Le Manager confirme par une phrase de prise en charge (« Je vous prépare ça ») avant de lancer une action interne.
- Une seule question à la fois en cas d'info manquante critique. Jamais de rafale.
- Les blocages internes (échec d'un agent, dépendance non satisfaite) sont traduits en termes métier, jamais techniques (« la diffusion sur LinkedIn est en attente, le compte semble déconnecté », pas « erreur 401 »).
- Propose des alternatives plutôt que de signaler des erreurs.

### 4.2 Orchestration (responsabilité du Manager)

Il n'existe pas d'agent Orchestrateur séparé. **Le Manager EST l'orchestrateur.** La coordination des agents exécutants est une de ses responsabilités, invisible du donneur d'ordre : côté conversation elle se résume à « je m'en occupe, je reviens vers vous ». Cette fonction garantit qu'aucune tâche ne tombe entre deux chaises et que les dépendances sont respectées.

**Responsabilités d'orchestration du Manager.**

- Génération des identifiants (CAMP-XXXX, TASK-XXXX) — pivot du système.
- Routage : pour chaque événement (mail reçu, publication réussie, créneau réservé), décider quel agent agit avec quels inputs.
- Gestion des dépendances (Publisher après Job Writer, etc.).
- Surveillance des SLA internes et des statuts des agents.
- Tenue à jour des métriques.

**Frontière déterministe.** L'orchestration est de la mécanique, pas de la conversation : le routage, l'ordre des phases et les dépendances sont **déterministes et pilotés par le code** (machine d'états du cycle de vie, cf. `CLAUDE.md`), jamais par le LLM. Le LLM du Manager ne possède que le dialogue (intention, collecte FDP, formulation) ; il ne décide jamais quel agent s'exécute ni dans quel ordre. Doctrine : « le LLM propose, le code verrouille ».

### 4.3 Job Writer

**Mission.** Transformer la FDP interne en annonce publique attractive, en y ajoutant les éléments de marque employeur.

| Aspect | Détail |
|---|---|
| Inputs | FDP validée, template de marque employeur, préférences de ton/longueur. |
| Outputs | Annonce multi-format (long pour jobboards, court pour réseaux sociaux). |
| Validation humaine | Activée par défaut sur l'annonce avant publication. |
| Modes de déclenchement | Ponctuel — déclenché à l'ouverture de campagne. |
| Mémoire | Aucune — stateless. |
| Limites | N'invente jamais d'avantages ou éléments factuels absents du template. |

### 4.4 Publisher

**Mission.** Diffuser l'annonce sur les canaux choisis. Gère l'authentification auprès de chaque plateforme.

| Aspect | Détail |
|---|---|
| Inputs | Annonce validée, liste des canaux cibles, credentials chiffrés. |
| Outputs | Confirmations par canal (URL, ID, timestamp). Erreurs détaillées. |
| Validation humaine | Aucune — la validation a eu lieu en amont. |
| Modes de déclenchement | Ponctuel — après validation de l'annonce. |
| Mémoire | Aucune. |
| Limites | Si un canal échoue, publie sur les autres et escalade le canal défaillant. Jamais de contournement. |

### 4.5 CV Analyzer

**Mission.** Lire, comprendre et noter les candidatures qui arrivent par mail. Agent le plus actif et le plus visible dans le dashboard.

| Aspect | Détail |
|---|---|
| Inputs | Identifiant de campagne, critères d'évaluation, seuil d'acceptation, boîte mail à surveiller. |
| Outputs | Pour chaque candidature : score 0-100, points forts (3-5 lignes), points d'attention, statut, résumé exécutif (3 phrases). |
| Validation humaine | Activée par défaut sur les borderline (zone d'incertitude autour du seuil). |
| Modes de déclenchement | Continu — veille tant que la campagne est active. |
| Mémoire | Liste des candidatures déjà traitées (déduplication par hash). Métriques agrégées. |
| Limites | Ne classe jamais les acceptés entre eux. Ne lit jamais hors du périmètre des critères demandés. |

**Critères — origine et structure.**

- **Critères durs** : diplôme requis, expérience minimale, certifications obligatoires, mobilité. Échec = score plafonné, statut « à arbitrer » (jamais auto-rejeté).
- **Critères mous** : compétences techniques, secteurs d'expérience, langues. Pondération configurable.
- **Critères de signal** : qualité de la lettre, cohérence de parcours, parcours atypique. Bonus, jamais malus.

### 4.6 Scheduler

**Mission.** Inviter les candidats acceptés à réserver un entretien et tracer la réservation.

| Aspect | Détail |
|---|---|
| Inputs | Dossier candidat accepté, lien de réservation associé à la campagne. |
| Outputs | Email d'invitation avec lien personnalisé. Confirmation de réservation. Mise à jour du dossier. |
| Validation humaine | Aucune — l'acceptation par le CV Analyzer fait foi. |
| Modes de déclenchement | Réactif — à chaque acceptation. |
| Mémoire | Statut de chaque invitation (envoyée / ouverte / réservée / expirée). |
| Limites | Ne relance jamais plus d'une fois automatiquement. Seconde relance via le Manager. |

### 4.7 Rejection Writer

**Mission.** Envoyer un email de refus respectueux et personnalisé aux candidats sous le seuil.

| Aspect | Détail |
|---|---|
| Inputs | Dossier candidat refusé, template de refus, tonalité préférée. |
| Outputs | Email de refus envoyé. Trace dans le dossier candidat. |
| Validation humaine | Configurable. Désactivée par défaut une fois le template approuvé. |
| Modes de déclenchement | Réactif ou groupé (batch en fin de journée pour limiter l'effet machine). |
| Mémoire | Aucune. |
| Limites | Ne donne jamais le détail des raisons du refus. Reste dans le registre du remerciement. |

---

## 5. Artefacts de l'entreprise virtuelle

### 5.1 Inventaire

| Artefact | Producteur | Moment | Forme |
|---|---|---|---|
| Fiche de poste (FDP) | Manager RH | R1 — Cadrage | Document structuré, archivable |
| Brief de campagne | Manager RH | R2 — Lancement | Document interne, non exposé |
| Annonce publique | Job Writer | R3 — Production | Versionnée, multi-format |
| Preuves de publication | Publisher | R3 — Production | URL + timestamp par canal |
| Dossier candidat | CV Analyzer | R4 — Réception | Un par candidature, enrichi au fil de l'eau |
| Compte-rendu hebdo | Manager RH | R5 — Point hebdo | Synthèse PDF ou message structuré |
| Bilan de campagne | Manager RH | R6 — Clôture | PDF archivable, livrable client |

### 5.2 Storage — architecture hybride

L'arborescence logique mime un système de partage de fichiers d'entreprise. Elle est implémentée en hybride **Supabase + Google Drive** :

- **Supabase** : données opérationnelles, métadonnées, état système, journal d'actions, scores, métriques. Tables Postgres + RLS.
- **Google Drive** : artefacts visibles client (FDP, annonces, bilans, comptes-rendus). Le client les voit apparaître dans son Drive partagé comme si une équipe humaine les y déposait — c'est l'effet wow différenciant.

**Arborescence logique (mappée sur les deux backends).**

```
/entreprise/
  /templates/         → Drive (FDP type, charte employeur, template de refus)
  /campagnes/CAMP-XXXX/  → Drive (artefacts) + Supabase (métadonnées + état)
  /tasks/TASK-XXXX/      → Drive (livrable hors campagne)
  /candidats/         → Supabase (base + dossiers) + Drive (CV originaux)
  /credentials/       → Supabase chiffré (secrets jobboards)
  /journal/           → Supabase (audit des actions directes UI)
  /archives/          → Drive (lecture seule, campagnes clôturées)
```

**Convention de nommage Drive** : un dossier par campagne, structure interne identique à l'arborescence logique. Ce qui apparaît dans le Drive du client est lisible par lui, ouvrable, partageable.

**MVP Session 3** : aucun storage réel. Les fonctions d'accès (`searchExistingJobDescriptions`, etc.) retournent des valeurs vides ou mockées. Implémentation réelle en Session 5.

---

## 6. Validation humaine — règles transverses

### 6.1 Trois niveaux

**Validation bloquante.** L'agent ne peut pas continuer sans accord explicite. Activée par défaut sur :
- Validation de la FDP (avant R2)
- Validation de l'annonce avant publication (configurable)
- Décision sur les candidats borderline
- Clôture de campagne

**Validation par défaut implicite (timeout).** L'agent agit après un délai sans réponse, le silence vaut accord. Activée par défaut sur :
- Envoi des emails de refus (24h après acceptation du template)
- Envoi des invitations d'entretien (immédiat, configurable)

**Pas de validation.** L'agent agit en autonomie complète :
- Routages internes du Manager (dispatch aux agents)
- Métriques et dashboard
- Déduplication

### 6.2 Configuration

Chaque type de validation est un toggle indépendant, configurable par campagne et par agent. Le donneur d'ordre peut ajuster sur une campagne donnée.

### 6.3 Actions directes via l'interface

Pour les décisions de gestion qui demandent une réponse rapide ou un ajustement à la volée, le donneur d'ordre dispose de contrôles directs dans l'interface — exactement comme un manager dispose de boutons dans son outil RH habituel. La conversation reste pour le travail intellectuel ; les clics sont pour le pilotage opérationnel.

**Actions disponibles en clic direct.**

| Cible | Action directe | Effet immédiat |
|---|---|---|
| Campagne | Activer / Désactiver / Mettre en pause / Clôturer | Suspend ou reprend la veille du CV Analyzer ; bloque les actions sortantes |
| Seuil d'acceptation | Slider ou champ numérique | Recalcule les statuts des candidats déjà analysés |
| Agent individuel | Activer / Désactiver | L'agent ne reçoit plus de tâche ; bascule sur livraison manuelle |
| Validation humaine d'un agent | Activer / Désactiver le toggle | Bascule l'agent en mode autonome ou validation requise |
| Canal de diffusion | Activer / Désactiver / Réordonner | Le Publisher arrête ou démarre la diffusion |
| Candidat individuel | Forcer accepté / refusé / arbitrage | Court-circuite le score automatique |

**Règle de synchronisation chat / interface.** Toute action directe qui modifie l'état d'une campagne ou d'un agent produit automatiquement un message du Manager dans la conversation associée. Sans synchronisation, le Manager devient un interlocuteur déconnecté de la réalité, et l'illusion de l'équipe se brise dès la première démo.

- **Action déclenchant une prise d'acte** : désactivation, modification de seuil, modification de validation, forçage de statut candidat, modification de canal.
- **Action silencieuse** : navigation, filtrage du dashboard, changement de tri, ouverture en lecture.

**Réversibilité.** Les actions directes sont par défaut réversibles. Les actions irréversibles (clôture définitive, suppression d'un dossier) demandent une confirmation explicite.

---

## 7. Escalade et gestion des blocages

| Type de blocage | Action immédiate | Escalade |
|---|---|---|
| Credentials jobboard expirés | Publication sur les autres canaux ; mise en file d'attente du canal défaillant | Le Manager prévient le donneur d'ordre par message |
| Boîte mail injoignable | Pause de la veille ; retentes toutes les 5 min | 30 min → Manager ; 2h → donneur d'ordre |
| CV illisible / format inattendu | Tentative OCR si scan ; statut « à arbitrer » si échec | Inclus dans le point hebdo |
| Score borderline systématique (>30%) | Le Manager suggère un ajustement de seuil | Proposition au donneur d'ordre |
| Aucune candidature après 7 jours | Aucune action automatique | Alerte au point hebdo + propositions |

**Principe de communication.** Le Manager parle au donneur d'ordre comme un humain. Pas de jargon technique. Toute traduction technique → métier.

---

## 8. Métriques et dashboard

### 8.1 Métriques par campagne

- **Activité** : candidatures reçues, taux d'acceptation, créneaux réservés.
- **Vélocité** : délai entre réception et statut, délai entre acceptation et réservation.
- **Qualité** : score moyen des acceptés, écart-type, % de borderline.
- **Distribution** : candidatures par canal, taux de transformation par canal.

### 8.2 Métriques par agent (vue opérationnelle)

Pour chaque agent : statut (actif/attente/pause/erreur), charge (tâches en file), throughput (par heure/jour), coût (tokens consommés, cumulé), délai moyen de traitement, délai d'attente sur validation.

Cette vue n'est pas montrée par défaut au donneur d'ordre — accessible en mode « expert ». Vue par défaut = vue Manager.

---

## 9. Trajectoire des sessions

| Session | Périmètre | Lien avec ce document |
|---|---|---|
| 3 (en cours) | Chat Manager — refonte design + logique d'intention | §1.1, §3 (R1), §4.1 (Manager RH), §3.2 (hors campagne classification) |
| 4 | CV Analyzer réel | §4.5 — critères durs/mous/signal et statuts |
| 5 | Dashboard + storage hybride | §5.2 (Supabase + Drive), §6.3 (actions directes), §8 (métriques), pré-recherche L1/L2 |
| 6 | Polish | Animations, transitions, effet wow visuel — sans changer la logique métier |
| 7 | Persistance | Activation complète du storage hybride et du journal d'audit |
| 8 | Déploiement VPS Hostinger | Mise en production |

### 9.1 Évolution post-MVP vers n8n

La mimétique reste identique — seule l'implémentation change. Les agents exécutants deviennent des workflows n8n ; la logique d'orchestration du Manager (routage, dépendances, machine d'états) devient un workflow chef d'orchestre, mais reste **conceptuellement portée par le Manager** ; le Manager reste exposé via Next.js. La sémantique métier (rituels, artefacts, validations, escalades) ne bouge pas.

---

## Glossaire

- **Donneur d'ordre** : humain qui exprime un besoin. Seul humain à entrer dans le système.
- **Manager RH** : agent IA, point de contact unique (SPOC) du donneur d'ordre **et** orchestrateur de l'équipe. Cumule interface et coordination ; aucune couche d'orchestration séparée.
- **Orchestration** : responsabilité du Manager (routage, dépendances, identifiants, SLA), pas un agent distinct. Déterministe, pilotée par le code.
- **Agent exécutant** : agent IA spécialisé (Job Writer, Publisher, CV Analyzer, Scheduler, Rejection Writer). Reçoit ses tâches du Manager.
- **Campagne** : instance d'un processus de recrutement complet. CAMP-XXXX. Couvre R1 à R6.
- **Sollicitation hors campagne** : demande atomique produisant un livrable unique sans cycle. TASK-XXXX.
- **FDP** : fiche de poste — document interne décrivant le poste à pourvoir.
- **Brief de campagne** : FDP enrichie de paramètres opérationnels.
- **Annonce** : version publique de la FDP, destinée à la diffusion.
- **Borderline** : candidature dont le score se situe dans une zone d'incertitude autour du seuil. Demande arbitrage.
- **Rituel** : moment structurant du cycle de campagne.
- **Artefact** : document produit, archivé, restituable.
- **Action directe** : modification d'état effectuée par clic dans l'interface, hors conversation. Toujours synchronisée avec une prise d'acte du Manager.
- **Prise d'acte** : message court du Manager qui restitue une action directe et explique sa conséquence.
- **Pré-recherche** : étape du Manager qui cherche des FDP archivées comparables avant de lancer la collecte. Trois niveaux progressifs (L1 récupération / L2 suggestion / L3 inspiration).
