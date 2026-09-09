# Questions au support ADEP — bloc prêt à envoyer

> Destinataire : **supportadep@apec.fr**
> Contexte : intégration ADEP V5 / HR-XML **SEP**, multi-diffuseur QWESTINUM.
> État au 08/09/2026 : connecteur développé contre la documentation v1.0.12 et
> le WSDL de l'environnement de test ; **aucun appel réel n'a encore été fait**.
>
> Chaque point indique l'**hypothèse retenue** en attendant votre réponse : le
> développement n'attend personne, mais il dit ce qu'il suppose. Si une
> hypothèse est fausse, dites-le simplement — nous corrigerons avant le premier
> envoi réel.

---

## 1. Authentification

**1.1 — Un vecteur de test Argon2.**
La documentation donne deux implémentations (Java et Python) mais aucun couple
(mot de passe, sel, paramètres) → clé attendue. Nous ne pouvons donc pas
vérifier notre calcul hors ligne. Pourriez-vous nous fournir un jeu d'essai,
même fictif ?

*Notre hypothèse* : Argon2id, mémoire 4096 Kio, version 19, itérations et
parallélisme reçus par courriel, sel **décodé depuis le base64** avant usage,
longueur de sortie **256 octets**, encodage base64 **sans padding** — soit une
clé de 342 caractères. Nous avons croisé deux implémentations indépendantes
(bibliothèque Rust et `argon2-cffi`, celle du code de votre documentation) :
elles produisent le même résultat.

**1.2 — L'exemple du §IV.**
L'`atsPassword` littéral du chapitre IV fait 128 caractères hexadécimaux, ce
qui ne correspond pas à une sortie Argon2 de 256 octets ; les exemples de flux
portent d'ailleurs le placeholder `PASSWORD_SHA_512`. Nous les avons traités
comme des reliquats de la V4. Est-ce bien le cas ?

---

## 2. Espace de noms

**2.1 — Requêtes en `http://` ou `https://` ?**
Deux des exemples de flux SEP fournis (`sep_openPositionRequest.xml`,
`sep_getPositionStatusRequest.xml`) déclarent
`xmlns:ns2="https://adep.apec.fr/hrxml/sep`", alors que
`sep_getPositionRequest.xml` et toutes les réponses utilisent `http://`.

*Notre hypothèse* : `http://adep.apec.fr/hrxml/sep`, conformément au
`targetNamespace` du WSDL de test. Nous avons vérifié qu'un flux en `https://`
est effectivement rejeté par vos schémas. **Confirmez-vous que le WSDL de
PRODUCTION déclare la même valeur ?**

---

## 3. Domaines de valeurs et bornes

**3.1 — `GLOBAL_EXPERIENCE_LEVEL`.**
Le chapitre XII.3 indique « 1 caractère » pour `CompetencyEvidence/StringValue`,
alors que `NIVEAU_EXPERIENCE_DOMAIN` va jusqu'à **12**. Les valeurs 10, 11 et 12
sont-elles utilisables ?
*Notre hypothèse* : oui, le domaine fait foi.

**3.2 — `UserArea/Duration`.**
Le chapitre X.1.4 indique « la durée doit être exprimée en mois dont la valeur
minimum est de 0 (0 correspond à la valeur < 1 mois) », tandis que
`API_394_INVALID_DURATION_ERROR` dit « un nombre entre 1 et 99 ».
*Notre hypothèse* : nous appliquons la borne la plus stricte (1 à 99). Une durée
« moins d'un mois » est-elle possible, et sous quelle valeur ?

**3.3 — Fonction du contact de suivi.**
Le chapitre X.1.2 indique 128 caractères maximum pour
`howToApply.PersonName.Affix[type='qualification']`, l'erreur `API_404` indique
80.
*Notre hypothèse* : 80.

**3.4 — `Competency name="INTERNATIONAL_PROFILE"`.**
L'élément figure, vide, dans votre exemple officiel ; il n'apparaît dans aucun
tableau de champs, mais l'erreur `API_335_INVALID_PRF_INN_ERROR` existe.
Est-il obligatoire, facultatif, ou ignoré ?
*Notre hypothèse* : nous reproduisons l'exemple — élément présent et vide.

**3.5 — Les expressions régulières `URL_CANDIDATURE` et `URL_VIDEO`.**
Elles sont annoncées « décrites ci-après dans le document » (catalogue des
erreurs, §418) mais n'y figurent que sous forme d'images, illisibles par un
programme. Pourriez-vous nous en transmettre le texte ?
*Notre hypothèse* : URL de candidature en `http(s)://` ; vidéo restreinte à
YouTube, Vimeo et Dailymotion.

---

## 4. Acquittements et cycle de vie

**4.1 — `apecPositionNumero` sur un rejet.**
Le schéma le déclare `minOccurs="0"` dans `OpenPositionResponseTypeApec`. Sur un
acquittement portant une exception `Fatal`, est-il absent, ou présent et à
ignorer ?
*Notre hypothèse* : absent. Nous forçons la valeur à « aucun numéro » dès qu'une
exception `Fatal` est présente, pour que notre reprise par référence client
reste possible.

**4.2 — Reprise après incident de communication.**
Notre règle : si un `openPosition` n'aboutit pas proprement (délai dépassé,
coupure), **nous ne le rejouons jamais**. Nous appelons `getPositionStatus` avec
la référence client pour savoir si l'offre existe. De même, nous interprétons un
`API_390_MORE_THAN_ONE_REF_FOUND_ERROR` en réponse à un `openPosition` comme
« cette référence est déjà prise », et nous allons lire l'offre correspondante.
**Cette lecture est-elle la bonne façon de procéder de votre point de vue ?**
Y a-t-il un délai après lequel une offre créée devient interrogeable ?

**4.3 — Unicité de la référence client.**
Nous comprenons qu'un `ProfileId` ne peut jamais être réutilisé, même après
fermeture de l'offre. Nos republications prennent donc une référence neuve
(`CAMP-2026-288`, puis `CAMP-2026-288-2`). Est-ce correct ?

**4.4 — Fenêtre de republication.**
`API_361` indique qu'une offre publiée il y a plus de 30 jours ne peut plus être
republiée. Ces 30 jours courent-ils depuis la **publication initiale** ou depuis
la **suspension** ? Nous avons retenu la publication initiale, qui est la
lecture littérale du message.

---

## 5. Habilitations

**5.1 — Mode client.**
Notre compte de test est en mode direct (`relationship="self"`). Notre modèle
cible est le mode **indirect** (`broker`), pour publier au nom de nos clients.
Quelles démarches faut-il engager, et quelle convention faut-il détenir ?

**5.2 — Types de contrat autorisés.**
`API_320` mentionne que « en fonction de la société, un recruteur peut se voir
refuser certains types de contrat ». Pouvez-vous nous indiquer les types de
contrat ouverts à notre convention, afin que nous les proposions — et seulement
ceux-là — dans notre interface ?

---

## 5ter. Les paramètres Argon2 sont-ils communs aux deux environnements ?

Vous nous avez transmis, pour la **production**, un `atsId` et un numéro de
dossier — mais pas de mot de passe ni de paramètres Argon2 (sel, itérations,
parallélisme), que nous n'avons que pour l'environnement de **test**.

Deux lectures possibles, et nous préférons demander plutôt que supposer :

- les paramètres Argon2 sont **communs** à l'intégrateur, seuls l'`atsId` et le
  numéro de dossier changent d'un environnement à l'autre ;
- un jeu **distinct** est prévu pour la production et nous ne l'avons pas encore.

Laquelle est la bonne ? Dans le second cas, merci de nous transmettre le mot de
passe et les paramètres de production — un sel différent produit une clé
entièrement différente, il ne s'agit pas d'un simple ajustement.

---

## 5bis. Une offre de test à fermer

Notre sonde technique a créé, sur l'environnement de test, l'offre
**`179240002W`** intitulée « SONDE TECHNIQUE ADEP — ne pas traiter »
(confidentielle, ODC). Elle est en statut `AVALIDER` et nous ne pouvons pas la
retirer nous-mêmes : `updatePositionStatus SUSPENDUE` rend `API_352`
(« changement de statut non autorisé depuis l'état actuel »).

Pourriez-vous la fermer ? Et, si possible, nous confirmer la règle : une offre
en attente de validation n'accepte-t-elle **aucun** changement de statut, y
compris une fermeture par le diffuseur ? Nous avons retiré le bouton
correspondant de notre interface en conséquence.

---

## 6. Point d'organisation

Nous avons développé et validé le connecteur hors ligne :

* le flux `openPositionRequest` est **conforme aux schémas** de votre WSDL de
  test (validé par `xmllint` contre les XSD embarqués) ;
* les règles de gestion du catalogue d'erreurs sont vérifiées **avant** envoi
  (longueurs, communes interdites, cohérence contrat/durée, dates…), pour que
  vos rejets restent l'exception.

Notre premier appel réel sera un `openPosition` unique sur l'environnement de
test, avec une offre explicitement intitulée « SONDE TECHNIQUE ADEP — ne pas
traiter », en offre confidentielle (ODC). **Souhaitez-vous être prévenus avant,
et faut-il une démarche particulière pour la faire retirer ensuite ?**
