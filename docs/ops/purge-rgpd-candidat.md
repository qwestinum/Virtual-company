# Effacement des données d'un candidat — procédure ORQA

> **À qui s'adresse ce document.** Aux délégués à la protection des données et
> aux responsables de traitement qui veulent savoir *ce qui est effacé, ce qui
> est conservé, et pourquoi* — et aux développeurs qui maintiennent l'outil.
> Les deux publics lisent le même texte : ce qui est vrai pour l'un doit l'être
> pour l'autre.
>
> Dernière révision : 02/09/2026. Outil : `npm run purge:candidate`.

---

## 1. Le cadre

ORQA est un **sous-traitant** au sens de l'article 28 du RGPD. Il traite des
candidatures pour le compte d'un **responsable de traitement** — le cabinet ou
l'entreprise cliente, seul interlocuteur du candidat.

Conséquence pratique, et elle gouverne tout le reste :

- **ORQA n'exécute jamais un effacement de sa propre initiative.** Il l'exécute
  sur **instruction écrite** du responsable de traitement, dont la référence est
  consignée.
- **ORQA ne décide pas des arbitrages.** Quand l'effacement entre en conflit
  avec un engagement en cours — un entretien programmé demain — l'outil
  **s'arrête** et renvoie la décision au responsable de traitement.
- **ORQA n'atteint pas tout.** Une partie des données du candidat vit hors de
  son périmètre (§8). Le rapport de confirmation le dit, plutôt que de laisser
  croire à un effacement complet qui ne le serait pas.

L'effacement s'appuie sur l'**article 17** (droit à l'effacement). Les
conservations résiduelles décrites au §5 s'appuient sur l'**article 17.3.e**
(constatation d'un droit) et sur l'obligation de **démontrer la conformité**
(article 5.2) : on ne peut pas prouver qu'on a effacé si l'on efface aussi la
preuve de l'effacement.

---

## 2. Ce que fait l'outil, en une phrase

À partir d'une adresse électronique, `purge:candidate` retrouve **tout** ce
qu'un candidat a laissé dans un environnement ORQA, **efface** ce qui le
désigne, **pseudonymise** ce qui doit rester pour prouver ce qui a été fait, et
produit un **rapport de confirmation** en français destiné au responsable de
traitement puis au candidat.

**Il ne fait rien tant qu'on ne le lui a pas explicitement demandé.** Sans
`--execute`, il lit, compte, et imprime ce qu'il ferait.

---

## 3. Les trois verdicts

Chaque emplacement de données reçoit l'un de trois verdicts. Il n'y en a pas de
quatrième, et aucun emplacement n'est laissé sans verdict.

| Verdict | Signification | Réversible ? |
|---|---|---|
| **EFFACER** | La donnée disparaît : ligne supprimée, fichier supprimé du stockage. | Non |
| **PSEUDONYMISER** | L'enregistrement reste, l'identité en sort. Le nom, l'adresse électronique, le téléphone, l'objet du message, le nom de fichier sont remplacés par un marqueur ; l'événement, sa date et son résultat demeurent. | Non (le remplacement est destructif) |
| **CONSERVER** | Rien à faire : l'emplacement ne contient aucune donnée du candidat, ou ne contient qu'un identifiant technique non rattachable. | — |

Le **marqueur** est une chaîne stable et lisible :

```
[effacé — demande RGPD <référence de l'instruction>]
```

Deux exceptions de forme, toutes deux justifiées au §6.3 :

- les **noms de fichier** dans la file de résilience reçoivent un marqueur
  **ordinal** (`[effacé-rgpd-1]`, `[effacé-rgpd-2]`…) et jamais `NULL` ;
- les **identifiants techniques** (`uid`, identifiant d'analyse, référence de
  campagne) sont conservés tels quels — §5.3 explique pourquoi et à quelle
  condition.

---

## 4. Inventaire — où vivent les données d'un candidat

### 4.1 Base de données

| Emplacement | Ce qu'il contient du candidat | Verdict |
|---|---|---|
| `candidate_analyses` | Nom, adresse électronique, téléphone, nom du fichier de CV, et l'analyse complète : langue détectée, localisation, synthèse rédigée, points forts et points d'attention, **citations littérales du CV** critère par critère. | **PSEUDONYMISER** (§6.1) — `--purge-analyses` pour effacer |
| `pending_validations` | File d'attente de décision humaine : nom, adresse, téléphone, synthèse. | **EFFACER** |
| `interview_briefs` | Trame d'entretien générée à partir de son CV, nom, adresse, instantané de candidature. | **EFFACER** |
| `vivier_candidates` | Le dossier de vivier : nom, prénom, téléphone, adresse, **texte intégral du CV**, titre, compétences, intitulés de postes. | **EFFACER** |
| `vivier_embeddings`, `vivier_entities`, `vivier_skill_embeddings`, `vivier_anchor_embeddings`, `vivier_preselections` | Vecteurs et entités **dérivés du texte du CV**. | **EFFACER** (cascade) — un vecteur dérivé d'un CV se supprime, il ne se « nettoie » pas |
| `imap_unmatched_cvs` | Expéditeur, objet du message, nom du fichier joint, chemin du CV stocké. | **PSEUDONYMISER**, ligne conservée (§6.3) |
| `artifacts_meta` | Noms de fichiers nominatifs (`invitation-<nom>.md`, `refus-<nom>.md`), et dans les métadonnées : nom, adresse, expéditeur, objet du message. | **EFFACER** |
| `sched_booking_links` | Prénom et adresse affichés sur la page de réservation. | **EFFACER** |
| `sched_bookings` | Nom, adresse, téléphone du participant ; jeton de gestion du rendez-vous. | **EFFACER** |
| `sched_events` | Copie du participant dans la charge utile de l'événement. | **EFFACER** (cascade) |
| `journal` | Sur 28 actions : nom, adresse, téléphone, expéditeur, destinataire, objet, nom de fichier. | **PSEUDONYMISER** (§5.2) |
| `imap_cv_retries` | Message d'erreur pouvant citer un nom de fichier. | **PSEUDONYMISER** le message, ligne conservée |
| `imap_outreach_claims` | Rien de nominatif — boîte, identifiant de message, type d'envoi. | **CONSERVER** (§6.4) |
| `calcom_webhook_events`, `interview_booking_events` | Identifiants techniques d'événements. | **CONSERVER** |
| `sched_rate_limits` | Adresses IP, dans une clé opaque non rattachable à un candidat. | **CONSERVER** — purge automatique en moins d'une heure |
| `campaigns`, `fdps_archived`, `scoring_sheets_archived`, `tasks_archived`, `sites`, `donneurs_ordre`, `recruiters`, `mailboxes`, `app_settings`, `demo_job_posts`, `campaign_mailboxes`, `sched_resources`, `sched_targets`, `sched_availability_*` | Aucune donnée de candidat. | **CONSERVER** |

> **Le recruteur n'est pas le candidat.** Les champs `actorEmail`, `by`,
> `decided_by_user_email` désignent l'**agent du responsable de traitement** qui
> a pris une décision. Les pseudonymiser effacerait l'auteur de l'acte,
> c'est-à-dire précisément la preuve que l'acte a été pris par un humain
> identifié. Ils sont **conservés**.

### 4.2 Stockage de fichiers

| Emplacement | Contenu | Verdict |
|---|---|---|
| `campagnes/<campagne>/<CV>` | Le CV d'origine. | **EFFACER** |
| `campagnes/<campagne>/rapport-cv-imap-<nom>-<n>.md` | Rapport d'analyse d'un candidat : nom, adresse, téléphone, citations du CV. | **EFFACER** |
| `campagnes/<campagne>/rapport-cv-<campagne>-<horodatage>.md` | Rapport d'analyse **groupé** — peut concerner **plusieurs candidats**. | **RÉÉCRIRE** : la section du candidat est retirée, le fichier ré-enregistré (§6.2) |
| `campagnes/<campagne>/{invitation,refus}-<nom>.md` | Le message envoyé au candidat. | **EFFACER** |
| `campagnes/<campagne>/brief-entretien-*.md` | Trame d'entretien. | **EFFACER** |
| `campagnes/<campagne>/rapport-campagne-*.pdf` | Bilan de campagne — **agrégé, aucun candidat nommé**. | **CONSERVER** |
| `vivier/<dossier>/<CV>` | Le CV du dossier de vivier. | **EFFACER** |
| `unmatched/<boîte>/<n>/<fichier>` | CV reçu sans campagne reconnue. | **EFFACER** le fichier |
| `tasks/<tâche>/…` | Mêmes formes, hors campagne. | Mêmes verdicts |

> **Pourquoi l'outil balaie le stockage par dossier et pas par métadonnées.**
> Supprimer une campagne efface ses lignes de métadonnées en cascade et **laisse
> les fichiers en place**. Mesuré sur l'environnement de développement le
> 02/09/2026 : plus de mille dossiers de campagne dans le stockage pour douze
> campagnes en base, et une campagne effacée qui conservait vingt-et-un fichiers
> sans aucune métadonnée. Un effacement qui suivrait les seules métadonnées
> raterait ces fichiers **en silence**. L'outil parcourt donc les dossiers, et
> **ouvre** les fichiers texte pour reconnaître ceux dont le nom ne dit rien.

---

## 5. Ce qui survit, et sur quelle base

### 5.1 La trace de la demande — table `gdpr_erasure_requests`

Une ligne par demande exécutée :

| Champ | Contenu |
|---|---|
| `request_ref` | La référence de l'**instruction écrite** du responsable de traitement. |
| `subject_hash` | Une **empreinte salée** de l'adresse effacée. **Pas l'adresse.** |
| `received_at`, `instructed_by` | Date de réception, auteur de l'instruction côté client. |
| `executed_at`, `executed_by` | Date d'exécution, opérateur ORQA. |
| `environment` | L'environnement visé (une demande peut en concerner plusieurs). |
| `scope` | Les **compteurs** par catégorie. Aucun contenu, aucun extrait. |
| `status` | `dry_run`, `executed` ou `partial`. |

**Pourquoi une empreinte et non l'adresse.** ORQA est sous-traitant : la
correspondance nominative « qui a demandé quoi » appartient au responsable de
traitement, qui la conserve de son côté. ORQA doit seulement pouvoir démontrer
qu'une demande *référencée* a bien été exécutée, et reconnaître qu'une même
personne fait l'objet d'une nouvelle exécution. L'empreinte salée suffit aux
deux, et ne reconstitue pas l'identité effacée.

### 5.2 Le journal — l'événement reste, l'identité part

Le journal est le support de la démonstration de conformité. En effacer les
lignes reviendrait à effacer la preuve de ce qui a été fait pour le candidat —
y compris la preuve de son effacement.

Ce qui reste d'une ligne pseudonymisée : **l'action, sa date, la campagne, le
résultat** (message parti ou non, décision prise ou non), **l'auteur recruteur**.
Ce qui en part : nom, adresse, téléphone, objet du message, destinataire, nom de
fichier — remplacés par le marqueur.

Lecture typique après effacement :

```
2026-07-14 09:12  imap_cv_received   candidate: [effacé — demande RGPD …]
2026-07-14 09:13  imap_outreach_pending  candidateEmail: [effacé — demande RGPD …]
2026-07-18 16:40  hitl_validation_sent   mailSent: true · by: recruteur@client.fr
2026-09-02 11:05  gdpr_erasure_executed  requestRef: … · counts: {…}
```

### 5.3 Les identifiants techniques — et la condition qui les rend acceptables

L'outil conserve les identifiants techniques : `uid` (le numéro du message dans
la boîte relevée), l'identifiant d'analyse, la référence de campagne. Sans eux,
la chaîne de causalité du journal se rompt et la preuve devient illisible.

**Il faut dire franchement ce qu'ils valent.** Le `uid` désigne un message précis
dans la boîte du client. **Tant que ce message existe, le `uid` reste un
identifiant indirect** : quelqu'un qui a accès à la boîte peut remonter au
candidat. Deux éléments rendent la conservation acceptable :

1. La ré-identification exige l'accès à un système que **le responsable de
   traitement contrôle** — et c'est ce même système où il doit lui-même
   supprimer le message source, qui porte le CV en pièce jointe. Le `uid` ne
   crée donc aucune exposition que la suppression du message ne referme.
2. **Le rapport de confirmation l'exige explicitement** (§8) : supprimer le
   message d'origine dans la boîte relevée. Une fois fait, le `uid` est un
   nombre pendant, réellement anonyme.

C'est pourquoi le contrôle final de l'outil (§7.4) ne se contente pas de
chercher le nom : il **part du `uid` et tente de remonter à une personne** par
tous les chemins internes. Si un seul aboutit, l'effacement est déclaré
incomplet.

---

## 6. Quatre décisions de conception, et leur raison

### 6.1 Les analyses sont vidées, pas supprimées

Supprimer les lignes d'analyse ferait **bouger les chiffres de bilans déjà
transmis au client** : une campagne close annoncée à 58 candidatures en
afficherait 57. Réécrire l'histoire d'un rapport signé n'est pas un effet de
bord acceptable.

L'outil conserve donc une **ligne statistique anonyme** — date de réception,
campagne, score, zone de décision, qui a décidé — et **détruit tout le reste** :
nom, adresse, nom de fichier, et la totalité de l'analyse détaillée (synthèse,
points forts, points d'attention, justifications, **citations du CV**).

Ce qui reste du détail par critère : l'intitulé du critère et le verdict
(`satisfait` / `partiel` / `non`), sans une ligne de texte issue du CV.

La formulation employée dans le rapport au candidat :

> « Vos candidatures ont été réduites à une ligne statistique anonyme — date,
> campagne, score — afin de ne pas fausser les bilans déjà transmis. Aucune
> donnée permettant de vous identifier n'y subsiste. »

L'option `--purge-analyses` supprime ces lignes pour un responsable de
traitement qui retient la lecture maximaliste. Le rapport le mentionne alors, et
signale que les compteurs historiques s'en trouvent modifiés.

**Garantie de mise en œuvre.** La liste des champs conservés est **exhaustive et
vérifiée par le compilateur** : ajouter un champ au modèle d'analyse sans dire
s'il est conservé ou détruit **empêche le projet de compiler**. Une vigilance ne
protège rien ; un typage, si.

### 6.2 Les rapports groupés sont réécrits, pas supprimés

Un rapport d'analyse issu d'un dépôt groupé contient **plusieurs candidats**, et
son nom de fichier ne dit pas lesquels. Le supprimer effacerait les données
d'autres personnes qui n'ont rien demandé — et les priverait de l'analyse qui
justifie la décision les concernant.

L'outil retire donc **la section du candidat** et ré-enregistre le fichier. Si le
candidat était le seul du rapport, le fichier est supprimé.

> **Deux précautions, l'une et l'autre issues d'une mesure.**
>
> **Le fichier est supprimé puis redéposé**, jamais simplement écrasé, et la
> nouvelle version est posée sans mise en cache. Un écrasement laisse le service
> de diffusion continuer à livrer l'ancienne version pendant la durée de cache
> du fichier d'origine — une heure par défaut. Pour un effacement, cela
> signifierait livrer encore le nom d'une personne après l'avoir déclaré effacé.
>
> **La vérification passe par le catalogue, pas par une relecture.** Mesuré le
> 02/09/2026 : une relecture immédiate après l'écriture ramène encore l'ancien
> contenu (371 caractères) alors que le catalogue annonce déjà la nouvelle
> taille (232 octets). Prendre cette relecture pour vérité conduirait à
> conclure « la réécriture a échoué » et à **supprimer un rapport parfaitement
> réécrit**, avec l'analyse des autres candidats dedans. Le catalogue, lui,
> reflète l'origine immédiatement.
>
> Limite résiduelle, assumée et bornée : pendant au plus une heure, une lecture
> de ce fichier précis peut encore renvoyer une copie en cache. Le stockage est
> **privé** — cet accès n'existe que pour un opérateur interne authentifié,
> jamais pour un tiers.

### 6.3 La file de résilience garde ses lignes — le garde-fou anti-résurrection

Les CV reçus sans campagne reconnue sont gardés en file pour être rejoués. Cette
file porte une contrainte d'unicité sur (boîte, message, nom de fichier) qui
**empêche qu'un même message soit réingéré**.

Si l'outil supprimait ces lignes, un message repassant un jour devant le
relevé recréerait la candidature : **la personne effacée reviendrait**. La ligne
est donc conservée, vidée de son contenu nominatif.

> **Le piège évité.** Mettre le nom de fichier à `NULL` casserait le garde-fou :
> une base de données considère deux valeurs nulles comme distinctes dans un
> index d'unicité, la contrainte cesserait de mordre. D'où un marqueur
> **ordinal** (`[effacé-rgpd-1]`), qui est une valeur, stable d'un rejeu à
> l'autre, et sans entropie exploitable — contrairement à une empreinte de nom
> de fichier, qui se retrouve par force brute en quelques secondes.

**Corollaire, et il compte.** L'outil bloque la résurrection **d'un message**,
jamais **une personne**. Aucune liste d'opposition n'est constituée. Si la même
personne dépose une nouvelle candidature demain, c'est un traitement neuf et
légitime : il n'est pas entravé.

### 6.4 Les verrous d'envoi sont conservés

La table qui mémorise « ce message a déjà donné lieu à un envoi » ne contient
rien de nominatif. La supprimer autoriserait un nouvel envoi — un message de
refus expédié à une personne dont on vient d'effacer le dossier. Elle est
**conservée**.

---

## 7. La procédure

### 7.1 Avant de lancer quoi que ce soit

1. **Obtenir l'instruction écrite** du responsable de traitement et noter sa
   référence (`--request-ref`).
2. **Vérifier l'identité de la personne** : cette vérification appartient au
   responsable de traitement, jamais à ORQA.
3. **Recenser les adresses** : le candidat a pu postuler depuis plusieurs
   adresses, ou son CV porter une adresse différente de celle de l'expéditeur
   (§7.3). Le responsable de traitement les fournit ; l'outil ne les devine pas.

### 7.2 Exécution

```bash
# 1. Constat — n'écrit rien. À faire sur CHAQUE environnement.
npm run purge:candidate -- --env .env.localX --email jean.dupont@exemple.fr

# 2. Exécution — sur les environnements où le constat a trouvé quelque chose.
npm run purge:candidate -- --env .env.localX --email jean.dupont@exemple.fr \
    --execute --confirm-project <ref-du-projet> \
    --request-ref "courriel DRH du 27/08/2026" \
    --report rapport-effacement.md
```

- **`--env` est obligatoire.** Il n'y a **aucun repli automatique** : l'outil
  refuse de démarrer sans qu'on ait nommé l'environnement.
- **`--confirm-project` est obligatoire en exécution.** Il faut retaper la
  référence du projet visé. Sans ce jeton, l'outil demande la confirmation au
  clavier. Un effacement appliqué au mauvais projet ne se rattrape pas.
- **Le constat est le mode par défaut.** `--execute` est le seul chemin qui
  écrit.
- **Le rejeu est sans risque.** Relancer sur un candidat déjà effacé ne lève
  aucune erreur et produit un rapport cohérent (« 0 à effacer, N déjà
  effacés »). Une demande peut donc être exécutée en deux temps.

### 7.3 Comment la personne est retrouvée — et les angles morts

L'outil part de l'adresse, **sans distinction de casse**, et en déduit un
ensemble d'identifiants (analyses, messages, campagnes, dossiers de vivier,
réservations, fichiers). **Tout le reste se rattache à cet ensemble**, jamais à
une nouvelle recherche par le nom.

> **L'adresse est le seul signal qui désigne une personne et une seule.**
> Le nom, évidemment, ne l'est pas. Le téléphone non plus, et c'est moins
> intuitif : un fixe de foyer, un standard d'entreprise, un numéro
> professionnel partagé appartiennent légitimement à plusieurs personnes.
> Ni l'un ni l'autre ne fait donc entrer une donnée dans le périmètre. Les
> deux servent en revanche à **caviarder** à l'intérieur de ce qui y est déjà
> entré, et une occurrence en dehors est signalée comme homonyme probable —
> à trancher par un humain, jamais supprimée d'office.

Les angles morts sont connus et nommés :

| Situation | Conséquence | Réponse |
|---|---|---|
| Le CV porte une adresse différente de celle de l'expéditeur (candidature déposée par un cabinet, un proche, une seconde adresse) | La file de résilience et le message d'origine ne sont pas retrouvés | `--also-email` (répétable), alimenté par l'instruction |
| Le CV ne portait **aucune** adresse exploitable | Le dossier est invisible à une recherche par adresse | `--analysis-id` ou `--uid <boîte>:<numéro>` |
| Variantes d'adresse (points, alias `+`) | Sous-effacement | **L'outil ne devine pas** : supposer que deux adresses sont la même personne ferait effacer les données d'un tiers. Il faut les déclarer |
| Fichiers restés dans le stockage d'une campagne supprimée | Inatteignables par l'ensemble d'identifiants | `--deep-storage-scan` : parcours complet du stockage, lecture des fichiers texte. Lent, donc facultatif |
| **Homonyme, ou adresse voisine** | Sur-effacement — le risque le plus grave | **Ni le nom ni le téléphone ne sont un critère à eux seuls.** Ils ne servent qu'à l'intérieur du périmètre déjà établi par l'adresse : les campagnes du candidat, ses propres noms de fichiers. Une personne dont le nom se ressemble, ou qui partage un numéro, mais dont l'adresse diffère n'est jamais touchée — et un test de non-débordement le vérifie à chaque livraison |

### 7.4 Le contrôle final

Après exécution, l'outil exécute un contrôle qui doit rendre **zéro**, et qui
travaille dans les deux sens :

1. **Absence littérale** — le nom, l'adresse et le téléphone sont cherchés dans
   les colonnes de texte et les charges utiles structurées des lignes **du
   périmètre de la demande**. Une occurrence de l'**adresse** est un échec, tout
   comme un champ nominatif resté non caviardé. Une occurrence du seul **nom**
   ou du seul **téléphone** sur une ligne du périmètre est également un
   résidu — on sait déjà que cette ligne concerne la personne.
2. **Ré-identification** — l'outil **part des identifiants techniques
   conservés** (`uid`, identifiant d'analyse) et tente de remonter à un nom par
   chaque chemin interne : file d'attente, entretiens, métadonnées de fichiers,
   liens de réservation, file de résilience, stockage. **Aucun chemin ne doit
   aboutir.**

Le second contrôle est le vrai. Le premier vérifie qu'on a bien effacé les
chaînes de caractères ; le second vérifie qu'on ne peut plus reconstituer la
personne — ce qui est la question posée par l'article 17.

#### Le contrôle ne lit que le périmètre de la demande

Trois règles encadrent ce que le contrôle a le droit de regarder. Elles ne sont
pas théoriques : elles viennent d'un incident de production du 2 septembre 2026,
où le rejeu d'une demande sur un périmètre **déjà effacé** a rendu
« résidus nominatifs : 6525 » en listant tous les **autres** candidats de la
base. Le contrôle balayait les tables entières avant de juger chaque ligne, si
bien que toute personne portant un nom devenait un « résidu ».

1. **Jamais de recherche sans terme.** Si rien ne se rattache à la personne dans
   cet environnement — le résultat normal d'un rejeu — le contrôle **ne
   s'exécute pas**. Il le dit (« sans objet »), et le rapport le dit aussi. Il
   ne cherche pas « au cas où » : sans identifiant, il n'a plus rien pour
   distinguer cette personne des autres.
2. **On ne rapatrie que par un identifiant de la personne** : les identifiants
   résolus au début de la commande, ou des motifs dérivés de son **adresse**
   seule — jamais de son nom.
3. **On n'audite que ce qui lui appartient.** Une requête sert à ne pas tout
   rapatrier ; elle ne prouve pas qu'une ligne est la sienne. L'appartenance est
   vérifiée ligne par ligne, et une ligne hors périmètre n'est **pas lue** :
   rien d'elle ne peut donc être retenu, nommé, ni recopié nulle part.

**Corollaire, et il est important pour le responsable de traitement** : un rejeu
sur un périmètre vide ne démontre rien. « Je ne retrouve plus rien aujourd'hui »
n'est pas « l'effacement d'hier était complet ». La démonstration repose sur le
rapport de l'exécution d'origine et sur la trace `gdpr_erasure_requests`.

#### Les homonymes probables

Le contrôle signale à part les lignes qui portent le **nom** de la personne hors
de son périmètre. Ce sont, très probablement, les dossiers de **tiers**. Ils ne
sont ni effacés, ni audités, et **aucune de leurs valeurs n'est recopiée** :
seul l'emplacement s'affiche sur la console de l'opérateur, pour qu'un humain
aille voir. La liste est bornée, et le dit quand elle l'est.

#### Le rapport ne peut pas nommer un tiers

Deux ceintures, parce que l'incident a montré qu'une seule ne suffit pas :

- **structurelle** — le rendu du rapport ne reçoit que des **compteurs**. Il n'a
  aucun champ où déposer un constat, un extrait ou un emplacement ;
- **une garde dure avant l'écriture** — le texte rendu est relu, et la commande
  **refuse d'écrire le fichier** s'il porte une identité (celle du sujet, ou
  l'un des extraits relevés par le contrôle). L'effacement, lui, a bien eu
  lieu : seul le document n'est pas produit.

Seule exception : la **référence de la demande** est recopiée telle quelle. Si
le responsable de traitement l'a formulée avec le nom de la personne
(« demande de Jean Dupont du 27/08 » — la forme naturelle), le rapport le
portera, et la commande le signale pour qu'une référence neutre soit choisie si
le document doit circuler.

### 7.5 Les arrêts

L'outil **s'interrompt avant d'écrire quoi que ce soit** si l'effacement entre
en conflit avec un engagement en cours. Le message est destiné au responsable de
traitement, pas à un développeur :

> Un entretien est programmé le 03/09/2026 à 10 h 00 (campagne CAMP-2026-051).
> L'effacement est suspendu : le responsable de traitement doit annuler
> l'entretien, ou confirmer par écrit que l'effacement prime.

Trois arrêts existent : entretien programmé à venir, réservation confirmée à
venir, message de décision en cours d'expédition. Le troisième se lève seul en
quelques minutes ; les deux premiers appellent une décision humaine.

**Ce n'est pas la décision d'ORQA.** L'outil ne passe pas outre, même avec une
option — il faut lever la cause, puis relancer.

### 7.6 Si une étape échoue

L'outil **s'arrête** et dit exactement où il en est : ce qui a été effacé, ce
qui ne l'a pas été, et l'erreur. Il n'y a pas d'effacement à moitié silencieux.
Les étapes déjà passées ne sont pas défaites — elles sont idempotentes, la
reprise se fait en relançant la même commande.

L'ordre est fixe et va des dépendances vers les racines, pour ne jamais laisser
d'orphelin : liens et réservations, entretiens, file de validation, vivier,
fichiers, métadonnées, analyses, **journal en dernier**.

---

## 8. Ce que l'outil n'atteint pas

Un effacement honnête dit ce qu'il ne couvre pas. Ces points figurent dans le
rapport de confirmation, avec l'indication de qui doit agir.

| Où | Quoi | Qui agit |
|---|---|---|
| **La boîte relevée** (messagerie du client) | Le message d'origine **et le CV en pièce jointe** | Le responsable de traitement |
| **Les boîtes des recruteurs** et adresses de synthèse | La trame d'entretien reçue **avec le CV joint**, les copies de bilans | Le responsable de traitement |
| **Le prestataire d'envoi de courriels** | Journaux d'envoi, corps des messages, pièces jointes | Demande au sous-traitant |
| **Le fournisseur de modèles de langage** | Le **texte intégral du CV** lui a été transmis à chaque analyse | Selon la politique de rétention contractuelle |
| **L'hébergeur applicatif** | Journaux d'exécution | Rotation de la plateforme |
| **Les sauvegardes de la base** | Copies antérieures à l'effacement | **Rotation — durée à vérifier sur le contrat de l'environnement concerné avant d'annoncer un délai au candidat** |
| **Le poste de l'opérateur** | Journal d'import de vivier (adresses, chemins de fichiers) et **dossier des CV source** | L'opérateur, manuellement |

> La dernière ligne mérite d'être dite : un dossier d'import de CV et son
> journal local sont, aujourd'hui, la copie la moins gouvernée de toutes. Elle
> ne relève pas de l'outil, mais elle relève de la procédure.

---

## 9. Les environnements

Une demande d'effacement porte sur **une personne**, pas sur une base. Il faut
donc passer l'outil sur **chaque** environnement où ses données ont pu être
copiées.

| Environnement | Fichier de configuration |
|---|---|
| Développement / recette | `.env.local` |
| Client (pilote) | `.env.localX` |

> ⚠️ Un troisième fichier, `.env.dev.local`, porte un nom de développement mais
> **pointe la base du client**. Tant qu'il existe, ne s'y fier sous aucun
> prétexte. L'outil imprime toujours la référence du projet réellement visé et
> exige qu'on la retape avant d'écrire — c'est la parade.

**La question « des données de production ont-elles atterri en développement ? »
ne se tranche pas par déduction : elle se tranche par le constat.** Lancer
l'outil sans `--execute` sur chaque environnement répond factuellement, candidat
par candidat.

---

## 10. Le rapport de confirmation

C'est le livrable. Il est rédigé en français, sans jargon, et se transmet tel
quel au responsable de traitement, qui le relaie au candidat.

Il contient, dans cet ordre :

1. **La référence de la demande** et les dates de réception et d'exécution.
2. **Ce qui a été effacé**, par catégorie et en volumes : candidatures, CV,
   rapports d'analyse, messages, dossier de vivier, réservations, fichiers.
3. **Ce qui a été pseudonymisé et pourquoi** : le journal d'audit, en une
   phrase compréhensible — l'événement reste, l'identité part, parce que c'est
   la preuve que l'effacement a eu lieu.
4. **Ce qui est conservé et sur quelle base légale** : la trace de la demande
   (démonstration de conformité), les verrous techniques qui empêchent qu'un
   ancien message ne recrée le dossier.
5. **Les sauvegardes**, purgées par rotation — avec le délai réel de
   l'environnement, jamais un délai supposé.
6. **Ce qui reste à faire hors ORQA** (§8), avec le destinataire de chaque
   action.

Le rapport ne contient **pas** le nom ni l'adresse du candidat : il est identifié
par la référence de la demande. C'est le responsable de traitement qui, chez
lui, fait le lien avec la personne — et qui le lui transmet.

---

## 11. Pour les développeurs

| Élément | Emplacement |
|---|---|
| Commande | `npm run purge:candidate` → `scripts/purge-candidate.ts` |
| Parcours exhaustifs (pagination, stockage) | `src/lib/gdpr/scan.ts` |
| Marqueur, reconnaissance, ordinaux | `src/lib/gdpr/marker.ts` (pur) |
| Squelette d'analyse conservé | `src/lib/gdpr/application-skeleton.ts` (pur, **exhaustivité vérifiée à la compilation**) |
| Pseudonymisation des charges utiles | `src/lib/gdpr/payload-pseudonymize.ts` (pur) |
| Arrêts et leurs messages | `src/lib/gdpr/blockers.ts` (pur) |
| Résolution de l'ensemble d'identifiants | `src/lib/gdpr/resolve.ts` |
| Exécution ordonnée | `src/lib/gdpr/execute.ts` |
| Contrôle final et ré-identification | `src/lib/gdpr/verify.ts` |
| Rapport | `src/lib/gdpr/report.ts` (pur) |
| Table de suivi | `gdpr_erasure_requests` — `scripts/migrate.sql`, repo `src/lib/db/repos/gdpr-requests.ts` |
| Tests unitaires | `src/lib/gdpr/__tests__/` |
| Scénario de régression | `tests/regression/s18-purge-rgpd.test.ts` |

**Trois règles à ne pas défaire :**

1. Le squelette d'analyse est une **liste blanche vérifiée par le compilateur**.
   Un champ ajouté au modèle sans décision explicite casse la compilation. Ne
   jamais remplacer par une liste noire.
2. Le marqueur de nom de fichier de la file de résilience est **ordinal, jamais
   `NULL`, jamais une empreinte** (§6.3).
3. Le contrôle final teste la **ré-identification**, pas seulement l'absence
   littérale (§7.4). Un test qui cherche le nom et ne le trouve pas ne prouve
   rien tout seul.
4. `strongIdentifiersOnly` est le **point de vérité unique** de « qu'est-ce
   qui désigne une seule personne ». Trois copies de `{ ...fp, nameTokens: [] }`
   dans `journal-scope`, `storage-plan` et `verify` auraient divergé, et la
   divergence aurait été silencieuse.
5. **Une liste d'identifiants vide ne devient JAMAIS une requête sans filtre.**
   `ids.length > 0 ? [{ op: 'in', … }] : []` rend, dans le cas vide, la table
   ENTIÈRE — défaut observé le 02/09/2026, qui faisait entrer tout le vivier
   dans le périmètre d'un seul candidat. Le filtre `in` est toujours posé ;
   c'est `pageAllByText` qui court-circuite. Test dédié dans `scan.test.ts`.
6. **Après une écriture dans le stockage, on vérifie par le catalogue**, jamais
   par une relecture (§6.2).
