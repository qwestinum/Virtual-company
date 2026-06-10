# Spécification — Module Reporting ORQA

Document de spécification fonctionnelle. Référence du module reporting pour
toutes les sessions à venir.

## 1. Vue d'ensemble

Le module Reporting est un **onglet principal** de la navigation ORQA qui
regroupe l'ensemble des rapports et audits exploitables par les utilisateurs de
la solution.

Le module est structuré en **trois sous-onglets** :

- **Rapport de campagne** — rapport de bilan généré pour une campagne clôturée
  individuelle.
- **Rapport multi-campagnes** — rapport consolidé sur une période choisie
  librement, agrégeant plusieurs campagnes clôturées.
- **Audit** — analyse approfondie à la demande sur un objet précis (candidat,
  campagne, ou grille de scoring).

Chaque sous-onglet partage des principes ergonomiques communs (filtres, boutons
Générer / Envoyer, modale d'envoi standardisée, journal d'audit des envois).

## 2. Pré-requis du modèle de données

Avant le développement du module reporting, deux entités doivent être
introduites dans le modèle de données ORQA.

> Voir aussi l'entrée backlog « Préparation modèle de données pour le module
> reporting (donneur d'ordre + site) » dans `docs/BACKLOG.md`.

### 2.1. Donneur d'ordre

Personne (interne à l'organisation cliente) qui a **initié** une campagne de
recrutement. **Distinct de l'utilisateur ORQA** qui manipule l'interface.

Champs :

- Identifiant
- Nom et prénom
- Email professionnel
- Rôle ou fonction (texte libre)

Une campagne a un **seul** donneur d'ordre. Champ **nullable** pour les
campagnes historiques.

### 2.2. Site

Entité géographique ou organisationnelle à laquelle une campagne est rattachée.
Pertinent pour les organisations multi-sites.

Champs :

- Identifiant
- Nom du site
- Type ou catégorie (texte libre)
- Localisation (ville, code postal optionnel)

Une campagne a un **seul** site associé. Champ **nullable**. Pour les
organisations mono-site, un site « par défaut » est créé automatiquement.

## 3. Sous-onglet 1 — Rapport de campagne

### 3.1. Vue principale

Liste filtrable des campagnes au statut **clôturée uniquement**. Les campagnes
actives, en cours ou suspendues sont exclues.

Tri par défaut : **date de clôture décroissante**. Tris alternatifs
disponibles : date de clôture croissante, nom de campagne A-Z, durée totale.

### 3.2. Filtres

Trois filtres combinés (**ET logique**) :

**Filtre période de clôture** : sélection d'une plage temporelle pour borner les
résultats. Implémentée via deux date pickers (Date début / Date fin) + chips
raccourcis cliquables :

- Cette semaine
- Semaine précédente
- Ce mois
- Mois précédent
- Cette année

Le clic sur un chip remplit automatiquement les date pickers ; l'utilisateur
peut ensuite ajuster manuellement.

**Filtre recherche libre** : champ texte qui filtre sur le nom du poste,
l'intitulé de la campagne, ou le donneur d'ordre. Recherche immédiate sans
bouton de validation.

**Filtre donneur d'ordre** : liste déroulante des donneurs d'ordre ayant initié
au moins une campagne dans le périmètre accessible à l'utilisateur.

Un compteur en haut indique le nombre de résultats : « 12 campagnes clôturées
sur la période sélectionnée ».

### 3.3. Carte de campagne

Chaque campagne est représentée par une carte (ou ligne enrichie) contenant le
rappel des informations essentielles :

- Intitulé de la campagne et poste recruté
- Date de lancement → date de clôture, durée totale
- Donneur d'ordre
- Site
- Volume traité : candidatures reçues, retenus, écartés, cas arbitrés
  manuellement
- Issue : recrutement(s) finalisé(s), campagne abandonnée, campagne sans suite
- Deux boutons d'action : **Générer le rapport** et **Envoyer le rapport**

### 3.4. Action « Générer le rapport »

Le système produit un rapport **PDF** contenant :

- Synthèse du déroulé (dates clés, volumes, décisions)
- Performance globale (candidatures, taux de retenue, time-to-hire effectif)
- Performance par canal de diffusion (volume et taux de conversion par canal)
- Synthèse du scoring (distribution des scores, écart-type, taux de cas limites
  arbitrés)
- Enseignements et recommandations (3 à 5 recommandations argumentées pour la
  prochaine campagne similaire)
- Mention RGPD (durée de conservation, planification de suppression)

Comportement :

- Téléchargement immédiat sur le poste, format PDF.
- Convention de nommage :
  `ORQA-rapport-campagne-[nom-poste]-[date-cloture].pdf`
- Mise en cache côté serveur à la première génération.
- Sur clic ultérieur, le rapport en cache est resservi (mention discrète :
  « Rapport généré le 15 juin 2026 »).
- Menu secondaire « Régénérer » disponible pour forcer un recalcul si une
  décision a évolué après clôture.

### 3.5. Action « Envoyer le rapport »

Ouvre une **fenêtre modale d'envoi** contenant :

- Champ destinataires (multiples, séparés par virgules ou sélecteur de contacts)
- Sujet pré-rempli modifiable : « Rapport de campagne — [intitulé poste] »
- Message d'accompagnement pré-rempli modifiable (texte standard professionnel)
- Choix de l'attachement : PDF joint au mail
- Boutons **Envoyer** et **Annuler**

Si le rapport n'a pas encore été généré, le système le génère **automatiquement
avant l'envoi**.

**Traçabilité de l'envoi** : chaque envoi est consigné dans l'historique de la
campagne (date, expéditeur, destinataires, sujet). Indication discrète sur la
carte : « Rapport envoyé 2 fois — dernier envoi le 18 juin 2026 ». Journal
d'audit RGPD consigné.

### 3.6. Cas particuliers

- **Campagne sans recrutement finalisé** : rapport générable, section issue
  mentionne « Campagne clôturée sans recrutement finalisé » avec motif si
  disponible.
- **Campagne à faible volume (<5 candidats)** : mention en haut du rapport que
  les statistiques sont peu significatives.
- **Campagne réouverte puis re-clôturée** : seul le dernier état de clôture
  compte pour l'apparition dans la liste.
- **Droits d'accès** : l'utilisateur ne voit que les campagnes auxquelles il a
  accès selon son rôle.

### 3.7. État d'implémentation (Phase 2 — livré)

Le sous-onglet est **fonctionnel** (onglet interne au `ReportingHub`, pas de
route Next dédiée — cohérent avec l'audit candidat). Le **clic sur une carte**
ouvre une vue détail (`CampaignReportDetail`) consultable à l'écran — toutes
les sections du rapport en HTML — en plus des actions Générer / Envoyer /
Régénérer (route `GET /api/reporting/campaigns/[id]`). L'**objet du mail**
rappelle la campagne (intitulé distinct + identifiant), pas seulement le poste.
Décisions et proxies retenus, à connaître pour les évolutions :

- **Dates de cycle de vie** : colonnes `campaigns.launched_at` / `closed_at`
  (nullable), posées par `patchCampaign` sur transition de statut (`closed_at`
  ré-écrit à chaque clôture → « seul le dernier état compte » ; `launched_at`
  au 1ᵉʳ passage `active`). Repli `created_at` / `updated_at` pour l'historique.
- **Volumes** : dérivés de `candidate_analyses` (reçues / retenues / écartées)
  + parcours HITL pour les **arbitrées** (intervention humaine).
- **Issue** : `recruited` (≥ 1 recrutement finalisé) vs `no_hire`. La nuance
  « abandonnée / sans suite » nécessiterait un motif saisi (non disponible).
- **Performance par canal** : proxy = canal de **réception** du CV (`source`),
  faute d'attribution diffusion → candidat.
- **Time-to-hire** : proxy lancement → clôture (jours) quand recrutement.
- **Recommandations** : par **règles** (pas de LLM cette session). Référence
  time-to-hire = constante documentée (pas de baseline historique).
- **Cache PDF stable** : Supabase Storage (`campagnes/<id>/<fichier>.pdf`,
  upsert), re-servi tel quel ; `?force=1` régénère. Traçabilité génération /
  envoi via le **journal** (`campaign_report_generated` / `campaign_report_sent`).
- **Droits d'accès** : MVP mono-utilisateur sans auth → toutes les campagnes
  clôturées sont visibles (règle de rôle non implémentée).

## 4. Sous-onglet 2 — Rapport multi-campagnes

### 4.1. Vue principale

Interface de sélection de période avec aperçu réactif des campagnes
correspondantes, suivie des actions Générer / Envoyer.

Mécanique unifiée pour les analyses hebdomadaires, mensuelles, trimestrielles,
annuelles ou sur toute période personnalisée : l'utilisateur choisit librement
ses bornes temporelles.

### 4.2. Sélection de période

Composant central : deux date pickers — **Date début / Date fin**.

Chips raccourcis cliquables sous les date pickers :

- Semaine en cours
- Semaine précédente
- Mois en cours
- Mois précédent
- Trimestre en cours
- Trimestre précédent
- Année en cours
- Année précédente

Le clic sur un chip remplit automatiquement les date pickers. L'utilisateur peut
ensuite ajuster.

### 4.3. Filtres complémentaires

- Recherche libre (nom de poste, intitulé de campagne)
- Donneur d'ordre
- Site

Combinés en **ET logique** avec la période.

### 4.4. Zone d'aperçu réactive

Mise à jour immédiate à chaque ajustement des bornes ou des filtres :

- Nombre de campagnes correspondantes
- Liste compacte des campagnes (intitulé, donneur d'ordre, site, date de
  clôture, statut)
- Volumes agrégés en aperçu : candidatures traitées, retenus, recrutements
  finalisés

### 4.5. Cas particuliers d'aperçu

- **Aucune campagne sur la période** : message clair « Aucune campagne clôturée
  sur la période sélectionnée » avec suggestion d'étendre.
- **Une seule campagne** : suggestion d'utiliser plutôt le sous-onglet 1 pour
  plus de détails.

### 4.6. Actions Générer / Envoyer

Mêmes mécaniques que le sous-onglet 1, avec une **différence importante** :

**Pas de cache stable** sur les rapports multi-campagnes (contrairement aux
rapports de campagne individuels qui sont figés à la clôture). Chaque génération
produit un nouveau PDF avec la **date et l'heure de génération** marquées en
première page.

### 4.7. Contenu du PDF généré

- **En-tête** : période analysée, nombre de campagnes, date de génération
- **Vue d'ensemble agrégée** : volumes totaux, taux moyens, indicateurs de
  marque employeur
- **Répartition par campagne** : tableau récapitulatif des campagnes (intitulé,
  donneur d'ordre, site, durée, volume, taux de retenue, time-to-hire, issue)
- **Performance par canal de diffusion** : analyse transverse des canaux sur
  l'ensemble de la période
- **Analyse du scoring** : distribution des scores, écart-type, taux d'arbitrage
- **Enseignements et recommandations** : 3 à 5 recommandations transverses
  argumentées
- **Conformité et traçabilité** : mention RGPD synthétique, référence aux audit
  logs

### 4.8. État d'implémentation (Phase 3 — livré)

Sous-onglet **fonctionnel** (onglet interne au `ReportingHub`). Différences clés
avec le rapport de campagne :

- **Période libre** (défaut « Ce mois ») via `PeriodFilter` (8 chips :
  semaine/mois/trimestre/année, en cours + précédent).
- **Génération à la volée, sans cache stable** : chaque appel à
  `GET /api/reporting/multi-campaigns/report` re-rend le PDF (`Cache-Control:
  no-store`) avec la date+heure de génération en page 1. Idem envoi.
- **Aperçu réactif client-side** : un fetch unique de `GET /reporting/campaigns`
  (campagnes clôturées), filtré/agrégé côté client (pas de saturation API).
- **Périmètre** : `closed_at` ∈ [début, fin] (repli `updated_at`). Une campagne
  ré-ouverte puis re-clôturée n'est incluse que par son dernier `closed_at`.
- **Traçabilité (Option A)** : envoi consigné au journal
  (`multi_campaign_report_sent`, payload période + filtres + destinataires).
  Pas d'historique UI (le rapport multi n'a pas d'objet permanent) — un
  historique « 5 derniers envois » reste en backlog, faisable sans refactor.

#### Agrégation

- **Volumes cumulés** sur toutes les campagnes du périmètre (reçues, retenus,
  écartés, arbitrés). **Taux** : retenue = retenus/reçues ; arbitrage =
  arbitrés/reçues ; réponse = candidats contactés/reçues.
- **Time-to-hire moyen** = moyenne **sur les campagnes ayant abouti à un
  recrutement** uniquement (mention explicite sous le KPI dans le PDF).
- **Performance par canal** = proxy canal de **réception** (faute d'attribution
  diffusion → candidat), agrégée sur toute la période.
- **Marque employeur agrégée** ≈ **taux de réponse aux candidats** pour cette
  session. Limitation : métriques plus fines (NPS, délai de réponse, taux de
  désistement) à enrichir ultérieurement.

#### Seuils de référence (recommandations transverses)

Constantes nommées et exportées depuis `src/lib/reporting/aggregations.ts`.
**Statut : hypothèses initiales, à recalibrer sur données réelles.**

| Constante | Valeur | Intention métier (ce qu'on signale) |
|---|---|---|
| `TIME_TO_HIRE_REFERENCE_DAYS` | 45 j | ≥ 2 campagnes au-delà → goulots d'étranglement à investiguer |
| `ARBITRATION_HIGH_RATE` | 0,20 | arbitrage manuel global élevé → décalage grilles ↔ marché |
| `CHANNEL_DOMINANT_SHARE` | 0,40 | un canal ≥ 40 % des retenus → à privilégier |
| `SITE_RETENTION_GAP_PTS` | 20 pts | écart de taux de retenue entre 2 sites → harmonisation |

Les recommandations sont produites par **règles** (pas de LLM cette session) ;
au moins une recommandation est toujours émise (fallback « pilotage conforme »).

## 5. Sous-onglet 3 — Audit

### 5.1. Vue d'accueil du sous-onglet

Page d'accueil présentant trois cartes correspondant aux trois types d'audit
disponibles :

```
┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
│  Audit candidat      │ │  Audit campagne      │ │  Audit scoring       │
│                      │ │                      │ │                      │
│  Comprendre pourquoi │ │  Analyser le déroulé │ │  Évaluer la          │
│  un candidat a été   │ │  temporel d'une      │ │  calibration d'une   │
│  retenu ou écarté    │ │  campagne            │ │  grille de scoring   │
└──────────────────────┘ └──────────────────────┘ └──────────────────────┘
```

Le clic sur une carte ouvre l'interface dédiée au type d'audit choisi.

Nomenclature retenue : « Audit candidat », « Audit campagne », « Audit
scoring ».

### 5.2. Principes communs aux trois types d'audit

- Bouton de retour en haut à gauche : « ← Choisir un autre type d'audit » pour
  revenir à la vue d'accueil du sous-onglet.
- Boutons **Générer le rapport** / **Envoyer le rapport** toujours en bas à
  droite, identiques aux sous-onglets 1 et 2 pour cohérence ergonomique.
- Mention de date de génération sur tous les rapports d'audit : « Audit généré
  le 15 juin 2026 ».
- **Pas de cache stable** sur les audits (chaque génération produit un nouveau
  rapport).

### 5.3. Audit candidat (priorité de développement)

Sélection du candidat à auditer parmi tous les candidats traités par ORQA, via :

- Recherche libre (nom, prénom, email, ou numéro de candidature)
- Filtres : campagne, statut (Retenu / Écarté / Arbitrage manuel), période

Une fois le candidat sélectionné, vue détaillée contenant :

- Profil du candidat (extrait du CV, données principales)
- Grille de scoring appliquée
- Détail critère par critère : verdict, citation extraite du CV, poids,
  contribution au score
- Score global, statut final, motif principal d'arbitrage si cas limite
- Historique des actions (réception, scoring, arbitrages, communications,
  décision finale)
- Boutons **Générer** / **Envoyer**

Ce rapport matérialise la **traçabilité native d'ORQA**. Cas d'usage type :
contestation candidat, audit DPO, démonstration de gouvernance auprès d'un
client ou d'une autorité.

### 5.4. Audit campagne (phase ultérieure)

À spécifier ultérieurement. Concept général : analyse temporelle approfondie du
déroulé d'une campagne (frise temporelle, durées par phase, goulots
d'étranglement, recommandations sur les phases qui ont dérivé).

### 5.5. Audit scoring (phase ultérieure)

À spécifier ultérieurement. Concept général : analyse de calibration d'une
grille de scoring sur l'historique de son usage (distribution des verdicts,
critères inutiles, corrélation score / issue, suggestions de recalibration).

## 6. Phasage de développement recommandé

- **Phase 1** — Pré-requis modèle de données (donneur d'ordre, site) +
  adaptation des écrans de cadrage de campagne. ✅ _livré_
- **Phase 2** — Sous-onglet 1 (Rapport de campagne). ✅ _livré (cf. §3.7)_
- **Phase 3** — Sous-onglet 2 (Rapport multi-campagnes), en réutilisant les
  briques du sous-onglet 1. ✅ _livré (cf. §4.8)_
- **Phase 4** — Sous-onglet 3 / Audit candidat uniquement (en priorité
  commerciale forte pour les démonstrations).
- **Phase 5** — Audit campagne et Audit scoring, dans un ordre à arbitrer
  ultérieurement.
