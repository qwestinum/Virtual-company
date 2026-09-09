# Mail au support ADEP — version du 09/09/2026

> **Prêt à envoyer**, tel quel, à `supportadep@apec.fr`.
>
> Deux règles de rédaction, à conserver si le message évolue :
> **(1)** chaque question porte l'**hypothèse retenue** en attendant la réponse —
> le développement n'attend personne, mais il dit ce qu'il suppose ;
> **(2)** aucun secret dans le corps du message (ni mot de passe, ni sel, ni clé,
> ni numéro de dossier). L'`atsId` y figure : il identifie le compte et n'est pas
> un élément d'authentification.
>
> Historique : les questions sur l'espace de noms et sur le vecteur de test
> Argon2 ont été **retirées** — les appels réels du 09/09 y ont répondu.

---

**Objet :** ADEP V5 / SEP — paramètres Argon2 de production, fermeture d'une offre de test, et questions d'intégration

Bonjour,

Nous intégrons ADEP V5 (flux **SEP**, multi-diffuseur) pour le compte de
QWESTINUM. Le connecteur est développé et fonctionne de bout en bout sur votre
environnement de test : nous avons créé, le 9 septembre, l'offre
**179240002W** (référence `SONDE-20260909-…`), puis relu son statut
(`AVALIDER`).

Trois demandes concrètes, puis quelques questions d'intégration.

---

## 1. Paramètres Argon2 pour la PRODUCTION — bloquant

Vous nous avez transmis, pour la production, un `atsId` (**138**) et un numéro
de dossier, mais **pas** de mot de passe ni de paramètres Argon2 (sel, nombre
d'itérations, degré de parallélisme) : nous n'en disposons que pour
l'environnement de test (`atsId` 139).

Nous avons vérifié **en lecture seule**, sans créer aucune offre — en
interrogeant le statut d'une référence inexistante : la clé calculée avec les
paramètres de test est **refusée en production**
(`API_102_ATS_PASSWORD_INVALID_ERROR`). La même vérification répond « offre
inconnue » sur l'environnement de test, ce qui confirme que notre calcul est
correct.

**Pourriez-vous nous transmettre le mot de passe et les paramètres Argon2 du
compte de production ?** Un sel différent produisant une clé entièrement
différente, il ne s'agit pas d'un ajustement mais d'un recalcul complet de notre
côté.

Nous confirmons au passage que le WSDL de production déclare bien le même espace
de noms que celui de test (`http://adep.apec.fr/hrxml/sep`).

## 2. Fermeture de l'offre de test 179240002W

L'offre **179240002W** (« SONDE TECHNIQUE ADEP — ne pas traiter »,
confidentielle, ODC) est en statut `AVALIDER` sur l'environnement de test. Nous
ne pouvons pas la retirer nous-mêmes : `updatePositionStatus` avec
`newPositionStatus = SUSPENDUE` rend
`API_352_INVALID_STATUS_TRANSITION_ERROR`.

**Pourriez-vous la fermer ?** Et nous confirmer la règle : une offre en attente
de validation refuse-t-elle **tout** changement de statut, y compris une
fermeture demandée par le diffuseur ? Nous avons retiré le bouton correspondant
de notre interface en conséquence.

## 3. Habilitations

**3.1 — Mode client.** Notre compte est en mode direct (`relationship="self"`).
Notre modèle cible est le mode **indirect** (`broker`), pour publier au nom de
nos clients. Quelles démarches engager, et quelle convention faut-il détenir ?

**3.2 — Types de contrat autorisés.** `API_320` indique qu'« en fonction de la
société, un recruteur peut se voir refuser certains types de contrat ».
Pourriez-vous nous indiquer ceux qui sont ouverts à notre convention, afin que
nous ne proposions que ceux-là dans notre interface ?

---

## 4. Domaines de valeurs et bornes

**4.1 — `GLOBAL_EXPERIENCE_LEVEL`.** Le chapitre XII.3 indique « 1 caractère »
pour `CompetencyEvidence/StringValue`, alors que `NIVEAU_EXPERIENCE_DOMAIN` va
jusqu'à **12**. Les valeurs 10 à 12 sont-elles utilisables ?
*Hypothèse retenue : oui, le domaine fait foi.*

**4.2 — `UserArea/Duration`.** Le chapitre X.1.4 indique une valeur minimum de
**0** (« 0 correspond à moins d'un mois »), tandis que `API_394` annonce « un
nombre entre **1** et 99 ». Laquelle fait foi, et comment exprimer une durée de
moins d'un mois ?
*Hypothèse retenue : la borne la plus stricte, 1 à 99.*

**4.3 — Fonction du contact de suivi.** Le chapitre X.1.2 indique 128 caractères
pour `howToApply.PersonName.Affix[type='qualification']` ; l'erreur `API_404`
indique 80.
*Hypothèse retenue : 80.*

**4.4 — `Competency name="INTERNATIONAL_PROFILE"`.** L'élément figure, vide,
dans votre exemple officiel ; il n'apparaît dans aucun tableau de champs, mais
l'erreur `API_335` existe. Obligatoire, facultatif, ou ignoré ?
*Hypothèse retenue : nous reproduisons l'exemple — élément présent et vide.*

**4.5 — Expressions régulières `URL_CANDIDATURE` et `URL_VIDEO`.** Elles sont
annoncées « décrites ci-après » (catalogue des erreurs, §418) mais n'y figurent
que sous forme d'images, illisibles par un programme. Pourriez-vous nous en
transmettre le texte ?
*Hypothèse retenue : candidature en `http(s)://` ; vidéo restreinte à YouTube,
Vimeo et Dailymotion.*

## 5. Acquittements et cycle de vie

**5.1 — `apecPositionNumero` sur un rejet.** Le schéma le déclare
`minOccurs="0"`. Sur un acquittement portant une exception `Fatal`, est-il
absent, ou présent et à ignorer ?
*Hypothèse retenue : absent. Nous forçons « aucun numéro » dès qu'une exception
`Fatal` est présente, afin que notre reprise par référence client reste
possible.*

**5.2 — Reprise après incident de communication.** Notre règle : si un
`openPosition` n'aboutit pas proprement (délai dépassé, coupure), **nous ne le
rejouons jamais**. Nous appelons `getPositionStatus` avec la référence client
pour savoir si l'offre existe. De même, nous interprétons un `API_390` en
réponse à un `openPosition` comme « cette référence est déjà prise », et nous
allons lire l'offre correspondante. **Est-ce la bonne façon de procéder de votre
point de vue ?** Existe-t-il un délai après lequel une offre créée devient
interrogeable ?

**5.3 — Unicité de la référence client.** Nous comprenons qu'un `ProfileId` ne
peut jamais être réutilisé, même après fermeture de l'offre. Nos republications
prennent donc une référence neuve (`CAMP-2026-288`, puis `CAMP-2026-288-2`).
Est-ce correct ?

**5.4 — Fenêtre de republication.** `API_361` indique qu'une offre publiée il y
a plus de 30 jours ne peut plus être republiée. Ces 30 jours courent-ils depuis
la **publication initiale** ou depuis la **suspension** ?
*Hypothèse retenue : la publication initiale, lecture littérale du message.*

---

Nous restons à votre disposition pour tout élément complémentaire, et vous
remercions par avance.

Bien cordialement,

QWESTINUM — intégration ADEP V5
`atsId` test 139 · `atsId` production 138
