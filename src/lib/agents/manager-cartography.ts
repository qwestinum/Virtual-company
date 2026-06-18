/**
 * Cartographie produit ORQA — service Recrutement (QWESTINUM).
 *
 * Source de vérité NAVIGATION pour le Manager RH (agent lecture seule). Le
 * prompt système réfère à ce document comme seule autorité pour les chemins :
 * le Manager n'invente jamais un menu ; s'il ne trouve pas un chemin ici, il
 * avoue son incertitude (cf. `buildManagerReadOnlyPrompt`).
 *
 * Libellés EXACTS de l'interface (relevés dans le code UI). Structure pensée
 * « une tâche = une entrée » pour devenir, en V2, un corpus RAG indexable —
 * d'ici là il est injecté intégralement en contexte.
 *
 * À tenir à jour quand un libellé d'UI change : un chemin faux ici se traduit
 * par une orientation fausse côté donneur d'ordre.
 */

export const MANAGER_CARTOGRAPHY = `# CARTOGRAPHIE PRODUIT — ORQA, service Recrutement

## Repères de navigation
- Workspace Recrutement : 5 onglets en haut — « Bureau », « Campagnes »,
  « Dashboard », « Validation suspendue » (badge = nombre de mails en attente),
  « Reporting ».
- Bandeau supérieur : liens « Validations vivier » (badge si en attente),
  « Paramètres », « Se déconnecter ». L'engrenage mène aussi à « Paramètres ».
- Chat Manager : tablette verte « Chat Manager » au bord droit ; le trombone
  « Joindre des fichiers » accepte PDF, DOCX, txt, md.

## Tâches courantes (où les faire)

### Créer une campagne
Onglet « Campagnes » → bouton « Nouvelle campagne ». Parcours : étape 1 (saisie
du poste), puis 5 sections — « Fiche de poste », « Fiche de scoring », « Canaux
de diffusion », « Flux de réception », « Seuil d'acceptation » —, puis bouton
« Créer la campagne ». Pourquoi : tout se cadre AVANT le lancement, et c'est le
donneur d'ordre qui crée (jamais le Manager).

### Créer une campagne à partir d'un document
Onglet « Campagnes » → « Nouvelle campagne » → étape 1 → bouton « Démarrer à
partir d'un document (appel d'offres, notes) » (PDF ou DOCX). Cela pré-remplit un
brouillon à relire et valider ; rien n'est créé sans l'accord du donneur d'ordre.

### Configurer le scoring / les pondérations
À la création OU l'édition d'une campagne, section « Fiche de scoring ». On y
ajoute des critères (« + Nouveau critère »), chacun avec un niveau d'importance —
« Rédhibitoire », « Obligatoire », « Critique », « Très important », « Important »,
« Souhaitable » — et un poids. Le bouton « Proposer la grille » génère une
proposition par l'IA. Pourquoi : cette grille sert au CV Analyzer ; on la fixe
avant le lancement pour que chaque CV reçu soit scoré sur la bonne base dès le
départ.

### Définir les canaux de diffusion
Création/édition d'une campagne, section « Canaux de diffusion ». C'est là où
l'annonce sera publiée.

### Configurer les flux de réception / associer une boîte mail
Création/édition d'une campagne, section « Flux de réception » : activer la source
« email » fait apparaître le sélecteur « Boîtes mail » pour en associer. La
gestion des boîtes elles-mêmes se fait dans « Paramètres » → « Boîtes de réception
des CV ».

### Régler le seuil d'acceptation
Création/édition d'une campagne, section « Seuil d'acceptation » (note minimale
pour qu'un CV soit retenu).

### Activer / lancer une campagne
Onglet « Campagnes » → carte de la campagne → bouton « Activer » (ou, juste après
la création, « Activer la campagne »). L'activation n'est possible que si les
phases obligatoires sont faites et les pondérations suggérées par l'IA ont été
traitées.

### Suspendre, reprendre ou clôturer une campagne
Onglet « Campagnes » → carte de la campagne : « Suspendre » (campagne active),
« Reprendre » (campagne suspendue), « Clôturer » (action définitive).

### Éditer une campagne existante
Onglet « Campagnes » → carte de la campagne → bouton « Éditer » (mêmes 5 sections
que la création).

### Filtrer les campagnes par statut
Onglet « Campagnes », chips de filtre : « Actives », « Suspendues », « Brouillon »,
« Clôturées », « Toutes ».

### Déposer un CV pour le faire analyser
Chat Manager (tablette verte) → trombone « Joindre des fichiers ». Le CV est
analysé par rapport à une campagne existante.

### Traiter les prises de contact issues du vivier
Bandeau → « Validations vivier » → choisir une campagne → pour chaque candidat,
« Accepter » (envoie une invitation à postuler) ou « Rejeter ».

### Valider les mails en attente (refus / acceptation)
Onglet « Validation suspendue » (le badge indique le nombre en attente). Ce mode
de validation humaine s'active dans « Paramètres » → « Validation humaine (Human
in the loop) ».

### Consulter un bilan ou un rapport
Onglet « Reporting » → sous-onglets « Rapport de campagne », « Rapport
multi-campagnes », « Audit ».

### Voir les KPIs, les candidats, l'activité récente
Onglet « Dashboard ».

### Voir l'équipe d'agents
Onglet « Bureau ».

### Réglages globaux (Paramètres)
Bandeau → « Paramètres ». Sections disponibles : « Validation humaine (Human in
the loop) », « Vivier de candidats », « Entretiens — messages candidat », « Boîtes
de réception des CV », « Donneurs d'ordre », « Sites », « Adresses de synthèse »,
« Adresses expéditeur », « Service email (Resend) », « Intégrations — Flux
d'arrivée », « Intégrations — Canaux de diffusion ».`;
