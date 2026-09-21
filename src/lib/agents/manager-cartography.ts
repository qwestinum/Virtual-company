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
 * Aligné sur la navigation à CINQ entrées (lot 1), sur l'assistant de création
 * en six étapes (lot 5) et sur le lexique (lot 6).
 *
 * ⚠️ DEUX GARDES la tiennent (`manager-cartography.test.ts`, sondées) :
 *   1. la PROSE ne porte aucun mot banni du lexique (`MOTS_BANNIS_A_L_ECRAN`) ;
 *   2. chaque libellé cité entre « … » EXISTE VERBATIM dans le code de l'UI.
 *      C'est la garde anti-hallucination : un onglet disparu, un bouton
 *      renommé, et la garde rougit — au lieu d'envoyer le donneur d'ordre
 *      chercher un menu qui n'existe plus.
 *
 * Un mot banni reste licite DANS un libellé cité : « Seuils de décision » est
 * le nom de la section à l'écran, et l'interdire empêcherait le Manager de
 * désigner l'endroit où aller.
 */

export const MANAGER_CARTOGRAPHY = `# CARTOGRAPHIE PRODUIT — ORQA, service Recrutement

## Repères de navigation
- Workspace Recrutement : CINQ entrées en haut — « Aujourd'hui » (l'entrée par
  défaut), « Campagnes », « Candidatures » (le badge compte les candidatures qui
  attendent une validation),
  « Entretiens », « Pilotage ». Chacune a sa propre adresse : on peut la mettre
  en favori, la partager, et revenir en arrière avec le navigateur.
- Ce qui a changé de porte : les candidatures qui attendaient une décision se
  trouvent maintenant dans « Candidatures », sur la carte « À valider » ;
  « Validations vivier » est passée sous « Campagnes » ; « Reporting » s'appelle
  « Pilotage » ; le « Bureau » est devenu « Aujourd'hui ». Les anciennes
  adresses continuent de fonctionner : elles mènent d'elles-mêmes au bon écran.
  (Le Dashboard n'est pas une entrée : il vit sur la page d'administration.)
- Filtre « Référent » : présent sur « Campagnes », « Candidatures »,
  « Entretiens », « Pilotage » et « Aujourd'hui », toujours au même endroit, en
  tête des réglages. Le raccourci « Mes campagnes » ne montre que les campagnes
  dont on est le recruteur référent. Il RÉDUIT ce qui s'affiche, il n'interdit
  rien — et le choix se retrouve d'un écran à l'autre.
- Bandeau supérieur : liens « Paramètres » et « Se déconnecter ». L'engrenage
  mène aussi à « Paramètres ».
- Chat Manager : tablette verte « Chat Manager » au bord droit ; le trombone
  « Joindre des fichiers » accepte PDF, DOCX, txt, md.

## Tâches courantes (où les faire)

### Créer une campagne
Bouton « Nouvelle campagne », depuis l'entrée « Campagnes » OU depuis
« Aujourd'hui » (le même bouton, le même écran). Un assistant en six étapes :
« Le poste », « Ce qui compte », « La réception », « Le suivi »,
« La réservation », « Récapitulatif ». Dès la première étape validée, la
campagne EXISTE en brouillon : on peut fermer et reprendre plus tard, par
l'action « Continuer la création » sur la carte de la campagne. Il n'y a pas de
bouton « Enregistrer » — passer à l'étape suivante enregistre. Le dernier écran
porte « Activer la campagne ». Pourquoi : tout se cadre AVANT le lancement, et
c'est le donneur d'ordre qui crée (jamais le Manager).

### Créer une campagne à partir d'un document
Bouton « Nouvelle campagne » → étape « Le poste » → bouton « Démarrer à partir
d'un document (appel d'offres, notes) » (PDF ou DOCX). Cela pré-remplit un
brouillon à relire et valider ; rien n'est enregistré tant que le donneur
d'ordre n'est pas passé à l'étape suivante.

### Configurer le scoring / les pondérations
À la création (étape « Ce qui compte ») OU à l'édition d'une campagne, section
« Fiche de scoring ». On y ajoute des critères (« + Ajouter un critère »),
chacun avec un niveau d'importance — « Rédhibitoire », « Critique »,
« Très important », « Important », « Souhaitable » — et un poids. Le bouton
« Proposer la grille » en fait rédiger une par l'outil : chaque ligne proposée
est à confirmer ou à rejeter avant le lancement. Pourquoi : cette grille sert à
noter les CV reçus ; on la fixe avant le lancement pour que chacun soit noté
sur la même base dès le départ.

### Définir les canaux de diffusion
Création/édition d'une campagne, section « Canaux de diffusion ». C'est là où
l'annonce sera publiée.

### Configurer les flux de réception / associer une boîte mail
Création/édition d'une campagne, section « Flux de réception » : activer la source
« email » fait apparaître le sélecteur « Boîtes mail » pour en associer. La
gestion des boîtes elles-mêmes se fait dans « Paramètres » → « Boîtes de réception
des CV ».

### Régler ce qui se décide tout seul et ce qui vous revient
Création (étape « Le suivi ») ou édition d'une campagne, section « Seuils de
décision ». Deux notes à poser, PAR CAMPAGNE : au-dessus de la plus haute, la
candidature est retenue et le candidat reçoit son invitation sans que personne
n'ait à intervenir ; au-dessous de la plus basse, l'outil PROPOSE un refus et
attend votre accord — il n'envoie jamais un refus tout seul ; entre les deux,
la candidature vous est présentée pour que vous tranchiez. Ces réglages ne sont
PAS dans les Paramètres : ils appartiennent à la campagne.

### Activer / lancer une campagne
Entrée « Campagnes » → carte de la campagne → bouton « Activer » (ou, juste après
la création, « Activer la campagne »). L'activation n'est possible que si les
phases obligatoires sont faites et les pondérations suggérées par l'IA ont été
traitées.

### Suspendre, reprendre ou clôturer une campagne
Entrée « Campagnes » → carte de la campagne : « Suspendre » (campagne active),
« Reprendre » (campagne suspendue), « Clôturer » (action définitive).

### Éditer une campagne existante
Entrée « Campagnes » → carte de la campagne → bouton « Éditer ». On y retrouve,
dépliables, tout ce que l'assistant de création demande, plus ce qui ne s'ouvre
qu'une fois la campagne lancée (le contenu publié d'un canal, la recherche dans
le vivier).

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

### Décider des candidatures qui attendent votre validation
Entrée « Candidatures » → carte « À valider » (le badge de l'entrée dit combien
attendent). Chaque candidature s'y décide une par une. Pour voir d'un coup
celles dont l'outil propose un refus, le lien « Passer en revue en une fois »
les rassemble. Ce qui envoie une candidature ici se règle PAR CAMPAGNE
(« Campagnes » → « Éditer » → « Seuils de décision »), jamais dans les
Paramètres.

### Consulter un bilan ou un rapport
Entrée « Pilotage » → « Rapport de campagne », « Multi-campagnes » ou
« Audit ».

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
Entrée « Entretiens ». Trois cartes en tête : « Programmés » (les rendez-vous
pris ; la mention en ambre compte ceux qui sont passés et qu'il reste à
confirmer), « En attente de réservation » (le candidat a reçu son lien et n'a
pas encore choisi de créneau) et « En attente de verdict ». Actions sur une
ligne : « Annuler », « Replanifier », « Renvoyer une invitation »,
« Classer sans suite ».

### Poser le verdict après un entretien (retenu / non retenu)
Entrée « Entretiens » → carte « En attente de verdict » → sur la ligne du
candidat, « Décider ». Le même bloc est aussi sur la fiche candidature
(Candidatures → le candidat, section « Action »). Le champ « Pourquoi cette
décision ? » est FACULTATIF. S'il est rédigé, le commentaire reste attaché à la
candidature et figure dans son audit ; il ne se modifie pas ensuite (une erreur se répare
par « Corriger la décision »).

### Rédiger le compte rendu d'un entretien
Même endroit que le verdict (entrée « Entretiens » → « En attente de verdict »
→ « Décider », ou la fiche candidature). Deux champs : d'abord « Pourquoi cette
décision ? », puis « Compte rendu d'entretien » — un seul champ libre, prêt à
écrire (le texte d'aide rappelle les repères : sujets abordés, critères de la
campagne, points forts, réserves, à vérifier). Les deux sont facultatifs.
« Enregistrer le brouillon » le garde de côté ; « Valider le compte rendu »
l'attache à la candidature, avec le nom de celui qui l'a validé. Si
l'installation l'autorise (Paramètres → « Comptes rendus d'entretien »),
« Importer une transcription » (en bas à droite du champ ; .vtt, .srt, .txt,
.docx, .pdf) propose un compte rendu à vérifier, tant que le champ est vide ;
la transcription n'est pas conservée. Après le verdict, il reste
consultable et modifiable sur la fiche candidature.`;
