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
 *
 * Aligné sur la navigation à CINQ entrées (refonte, lot 1). Restent périmés,
 * et traités au lot 6 : le nombre de sections du formulaire de création (il
 * devient un assistant au lot 5), et les niveaux de scoring.
 */

export const MANAGER_CARTOGRAPHY = `# CARTOGRAPHIE PRODUIT — ORQA, service Recrutement

## Repères de navigation
- Workspace Recrutement : CINQ entrées en haut — « Aujourd'hui » (l'entrée par
  défaut), « Campagnes », « Candidatures » (badge = dossiers à valider),
  « Entretiens », « Pilotage ». Chacune a sa propre adresse : on peut la mettre
  en favori, la partager, et revenir en arrière avec le navigateur.
- Ce qui a changé de porte : l'ancienne file d'arbitrage est devenue la puce
  « À valider » de Candidatures ; « Validations vivier » est passée sous
  Campagnes ; « Reporting » s'appelle « Pilotage » ; le « Bureau » est devenu
  « Aujourd'hui ». Les anciennes adresses continuent de fonctionner : elles
  mènent d'elles-mêmes au bon écran. (Le Dashboard n'est pas une entrée : il
  vit sur la page d'administration.)
- Bandeau supérieur : liens « Paramètres » et « Se déconnecter ». L'engrenage
  mène aussi à « Paramètres ».
- Chat Manager : tablette verte « Chat Manager » au bord droit ; le trombone
  « Joindre des fichiers » accepte PDF, DOCX, txt, md.

## Tâches courantes (où les faire)

### Créer une campagne
Entrée « Campagnes » → bouton « Nouvelle campagne ». Parcours : étape 1 (saisie
du poste), puis 5 sections — « Fiche de poste », « Fiche de scoring », « Canaux
de diffusion », « Flux de réception », « Seuil d'acceptation » —, puis bouton
« Créer la campagne ». Pourquoi : tout se cadre AVANT le lancement, et c'est le
donneur d'ordre qui crée (jamais le Manager).

### Créer une campagne à partir d'un document
Entrée « Campagnes » → « Nouvelle campagne » → étape 1 → bouton « Démarrer à
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
Entrée « Campagnes » → carte de la campagne → bouton « Activer » (ou, juste après
la création, « Activer la campagne »). L'activation n'est possible que si les
phases obligatoires sont faites et les pondérations suggérées par l'IA ont été
traitées.

### Suspendre, reprendre ou clôturer une campagne
Entrée « Campagnes » → carte de la campagne : « Suspendre » (campagne active),
« Reprendre » (campagne suspendue), « Clôturer » (action définitive).

### Éditer une campagne existante
Entrée « Campagnes » → carte de la campagne → bouton « Éditer » (mêmes 5 sections
que la création).

### Filtrer les campagnes par statut
Entrée « Campagnes », chips de filtre : « Actives », « Suspendues », « Brouillon »,
« Clôturées », « Toutes ».

### Déposer un CV pour le faire analyser
Chat Manager (tablette verte) → trombone « Joindre des fichiers ». Le CV est
analysé par rapport à une campagne existante.

### Traiter les prises de contact issues du vivier
Entrée « Campagnes » → « Prises de contact vivier » → choisir une campagne →
pour chaque candidat, « Accepter » (envoie une invitation à postuler) ou
« Rejeter ».

### Arbitrer les candidatures à valider
Entrée « Candidatures » → puce « À valider » (le badge de l'entrée indique le
nombre en attente). Chaque dossier s'y tranche à l'unité. Pour passer en revue
d'un coup les dossiers sous le seuil bas, le lien « Passer en revue en une
fois » ouvre la revue groupée des propositions de refus. Les seuils qui
décident de cette zone se règlent PAR CAMPAGNE (Campagnes → édition →
« Seuils de décision »), pas dans les Paramètres.

### Consulter un bilan ou un rapport
Entrée « Pilotage » → sous-onglets « Rapport de campagne », « Rapport
multi-campagnes », « Audit ».

### Voir ce qui attend une action aujourd'hui
Entrée « Aujourd'hui » : c'est l'écran d'arrivée.

### Voir l'équipe d'agents
Entrée « Aujourd'hui ».

### Réglages globaux (Paramètres)
Bandeau → « Paramètres ». Les sections sont REPLIÉES : on clique sur le titre
pour ouvrir celle qu'on veut, et la ligne sous le titre résume l'état courant.
Sections, dans l'ordre : « Validation humaine (Human in the loop) », « Vivier de
candidats », « Entretiens — messages candidat », « Comptes rendus d'entretien »
(administrateurs seulement), « Identité du cabinet »,
« Agendas & disponibilités », « Recruteurs » (administrateurs seulement),
« Donneurs d'ordre », « Sites », « Boîtes de réception des CV », « Adresses de
synthèse », « Adresses expéditeur », « Service email (Resend) », « Intégrations
— Flux d'arrivée », « Intégrations — Canaux de diffusion ».

### Déclarer ses disponibilités d'entretien
Paramètres → « Agendas & disponibilités ». Chacun y règle SES plages, ses
absences et son lieu de rencontre ; un administrateur peut ouvrir l'agenda d'un
autre recruteur. C'est ce qui alimente les créneaux proposés aux candidats
quand la campagne est en réservation native.

### Voir les rendez-vous d'entretien
Entrée « Entretiens » : les rendez-vous pris, ceux en attente de réservation,
les liens éteints, et les campagnes dont le référent n'est plus actif. Actions :
annuler, replanifier, renvoyer un lien.

### Poser le verdict après un entretien (retenu / non retenu)
Entrée « Entretiens » → sous-onglet « En attente de verdict » → sur la ligne du
candidat, « Décider ». Le même bloc est aussi sur la fiche candidature
(Candidatures → le candidat, section « Action »). Le champ « Pourquoi cette
décision ? » est FACULTATIF. S'il est rédigé, le commentaire est au dossier du
candidat et dans son audit ; il ne se modifie pas ensuite (une erreur se répare
par « Corriger la décision »).

### Rédiger le compte rendu d'un entretien
Même endroit que le verdict (entrée « Entretiens » → « En attente de verdict » →
« Décider », ou la fiche candidature). Deux zones : d'abord « Pourquoi cette
décision ? », puis « Compte rendu d'entretien » — un seul champ libre, prêt à
écrire (le texte d'aide rappelle les repères : sujets abordés, critères de la
campagne, points forts, réserves, à vérifier). Les deux sont facultatifs.
« Enregistrer le brouillon » garde le compte rendu hors du dossier ; « Valider
le compte rendu » le verse au dossier, avec le nom de celui qui l'a validé. Si
l'installation l'autorise (Paramètres → « Comptes rendus d'entretien »),
« Importer une transcription » (en bas à droite de la zone ; .vtt, .srt, .txt,
.docx, .pdf) propose un compte rendu à vérifier, tant que le champ est vide ;
la transcription n'est pas conservée. Après le verdict, il reste
consultable et modifiable sur la fiche candidature.`;
