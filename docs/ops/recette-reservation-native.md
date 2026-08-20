# Recette fonctionnelle — réservation native (lot 3)

> Parcours de bout en bout, à faire **dans l'ordre**, sur l'environnement de
> dev. Chaque point dit ce qu'on fait, ce qu'on doit voir, et **ce qui est
> prouvé** — parce qu'un test manuel qui passe sans qu'on sache ce qu'il
> protège ne protège rien.
>
> Compter ~45 min. Les points 1 à 3 sont bloquants pour tout le reste.

---

## 0. Préalable — migrations (⚠️ à faire AVANT tout)

Le lot 3 ajoute **deux colonnes et une table**. Tant qu'elles manquent, la
bascule répond `db_error`.

1. Appliquer `scripts/migrate.sql` **en entier** (fichier d'état final).
2. L'appliquer une **seconde fois** : il doit passer sans erreur (règle projet).
3. Supabase → **Reload schema cache** (sinon « column not found in schema
   cache » alors que la colonne existe).
4. Contrôler :

```bash
npm run check:scheduling
```

Attendu : `TOUT EST EN PLACE`. Le script nomme précisément ce qui manque —
`campaigns.scheduling_native`, `app_settings.branding_config`,
`interview_booking_events`.

### URL publique (⚠️ en prod, avant d'activer le natif)

Les liens envoyés aux candidats (`/r/…`, `/b/…`) sont construits sur
`NEXT_PUBLIC_APP_URL` (repli `NEXT_PUBLIC_SITE_URL`, puis `VERCEL_URL`, puis
`localhost`). **Poser la variable explicitement sur l'alias de PRODUCTION** avant
de basculer une campagne en natif : le repli `VERCEL_URL` rend l'hôte du
*déploiement*, que Deployment Protection rend inaccessible au candidat et
qu'un rollback change sous les liens déjà partis. Un lien de réservation qui
n'ouvre pas est un candidat perdu en silence.

Pas besoin d'un domaine acheté : un projet Vercel expose déjà un alias de
production stable `<projet>.vercel.app` (ici `https://orqa-bia-prod.vercel.app`),
qui ne bouge pas d'un déploiement à l'autre. C'est celui-là qu'on pose — pas
l'URL de déploiement `<projet>-<hash>-<équipe>.vercel.app` de `VERCEL_URL`.

**Prouve** : le schéma est là ET visible de PostgREST. Les deux se ratent
séparément.

---

## 1. Disponibilités du recruteur référent

Paramètres → **Agendas & disponibilités** (section accessible à tout le monde ;
un administrateur peut y ouvrir l’agenda d’un autre recruteur).

- Poser une durée (45 min), un battement (15 min), un préavis (0 h pour la
  recette — sinon aucun créneau proche), un horizon (30 j).
- **Plusieurs plages sur un même jour** : ajouter « 09:00 → 12:00 » puis
  « 14:00 → 18:00 » sur lundi. Vérifier qu'on peut en ajouter une troisième et
  en retirer une au milieu.
- Déclarer une **absence** (une date), puis la retirer.
- Choisir un **lieu** : « Par téléphone », instruction « Nous vous appelons au
  numéro indiqué ».
- Enregistrer.

**Attendu** : le bloc « Prochains créneaux proposés » se remplit, et les
créneaux tombent DANS les plages déclarées, en respectant la durée.

**Prouve** : l'aperçu vient du **même moteur** que la page candidat. Une grille
qui n'offre rien se voit ici, pas dans le mail d'un candidat.

> Essai utile : mettre le préavis à 48 h et enregistrer — les créneaux des deux
> prochains jours disparaissent. Le remettre à 0.

---

## 2. Identité du cabinet

Paramètres → **Identité du cabinet** : coller une URL de logo (n'importe quelle
image publique) et choisir une couleur d'accent. Enregistrer.

Vérifier au passage, dans « Entretiens — messages candidat », que le **nom
d'organisation** est renseigné : c'est lui qui s'affiche au candidat.

**Prouve** : logo et couleur sont une configuration d'INSTALLATION ; le nom
n'est pas dupliqué (il reste dans les réglages d'entretien).

---

## 3. Bascule d'une campagne de test

Créer (ou reprendre) une campagne active avec fiche de scoring validée.

1. Édition → **Recruteur référent** : choisir un recruteur **sans**
   disponibilités configurées.
2. Édition → **Réservation d'entretien** → cocher « Réservation native ORQA ».

**Attendu** : refus explicite — « Cette campagne a besoin d'un recruteur
référent actif dont les disponibilités sont configurées ». La case reste
décochée.

3. Remettre comme référent le recruteur du point 1, puis re-cocher.

**Attendu** : la case reste cochée, le sous-titre passe à « Native ORQA
(disponibilités du référent) ».

4. Renseigner un **lieu propre à la campagne** (ex. « Sur place », adresse du
   client) et l'enregistrer.

**Prouve** : le garde-fou d'activation (pas de campagne basculée qui produirait
des invitations bloquées, une par candidat) et la surcharge de lieu par
campagne.

---

## 4. CV fort → invitation à lien natif

Déposer un CV clairement au-dessus du seuil haut (chat ou boîte mail de la
campagne).

**Attendu** dans le mail reçu par le candidat :

- un lien `…/r/<jeton>` — **ni** `cal.com`, **ni** le lien global des
  paramètres ;
- l'objet et le corps sont ceux du modèle habituel (seul le lien change).

**Prouve** : l'émission passe par le **point de résolution unique**. Le
template, le sujet, le gate n'ont pas bougé.

---

## 5. Réservation côté candidat

Ouvrir le lien dans une fenêtre privée (aucune session).

- Le logo et la couleur du point 2 sont là ; le nom du cabinet et l'intitulé du
  poste s'affichent ; le prénom du candidat pré-remplit le formulaire.
- Le sélecteur de fuseau propose l'heure locale du navigateur.
- Choisir un créneau, confirmer.

**Attendu** : page de confirmation **immédiate**, avec le lieu, un fichier
d'agenda, et un lien de gestion. Un mail de confirmation arrive au candidat.

**Prouve** : le candidat n'attend AUCUN traitement métier (le briefing part par
le drain). C'est le chemin critique, et il est court.

> Rouvrir le même lien : la page dit que le rendez-vous est déjà pris et le
> rappelle — elle n'affiche pas un mur.

---

## 6. Briefing, onglet Entretiens, journal

Attendre le passage du cron (ou ouvrir simplement l'onglet **Entretiens**, qui
draine).

- **Mail** : le briefing arrive aux adresses de synthèse (référent en tête),
  avec **le CV en pièce jointe, la synthèse, le verdict, la trame d'entretien,
  le créneau et le lieu/lien**, plus l'invitation d'agenda (CV embarqué). C'est
  le SEUL message reçu pour ce rendez-vous — le module ne double plus avec sa
  propre notification, plus pauvre et plus rapide.
- **Onglet Entretiens** : le rendez-vous apparaît, groupé par jour, avec le nom
  du candidat, la campagne, le recruteur et le lieu.
- **Menu Candidatures** : la candidature porte « RDV pris ».
- **Journal** : `interview_brief_delivered` avec `analysisId`, `uid` et
  `resourceRef`.

**Prouve** : le briefing est retrouvé **par la candidature** (contexte du lien),
pas par l'email — un même candidat sur deux campagnes ne se mélange plus.

---

## 7. Zone grise : le preview est le point de vérité

Déposer un CV en zone grise. Onglet **Validation suspendue** :

1. Cliquer **Accepter** → le brouillon s'affiche : relever le jeton du lien.
2. Fermer, rouvrir, re-cliquer **Accepter** : **le jeton doit être identique**.
3. Envoyer.

**Attendu** : le mail parti porte **exactement** ce jeton.

**Prouve** : émission idempotente par candidature — le relecteur relit le lien
qui partira vraiment, et un second preview ne crée pas un second lien.

### 7 bis. Refus après avoir ouvert l'acceptation

Sur une autre candidature grise : cliquer **Accepter** (le lien est émis),
puis changer d'avis et **Refuser**. Envoyer.

**Attendu** : ouvrir le lien relevé → page « lien inactif ». Et le mail de refus
ne contient **aucun** lien de réservation, même si le modèle de refus contient
le marqueur `[lien d'agenda]` (à tester en le collant volontairement dans le
modèle, puis à retirer).

**Prouve** : révocation au refus, et le verrou « un refus ne mint jamais ».

---

## 8. Annulation par le candidat

Depuis le mail de confirmation du point 5, ouvrir le lien de gestion `…/b/…` et
annuler.

**Attendu** : l'onglet Entretiens montre la ligne « annulé par le candidat »
avec un bouton **Renvoyer un lien** ; le briefing est repassé « en attente de
réservation » ; journal `interview_booking_cancelled`.

Cliquer **Renvoyer un lien**.

**Attendu** : le candidat reçoit **un seul** message — « Nouveau créneau à
choisir » — avec un lien **différent** du premier (le premier est consommé), et
il fonctionne.

**Prouve** : aucune réémission automatique — un candidat qui annule a peut-être
renoncé, c'est un humain qui décide. Et la réinvitation crée bien une nouvelle
génération de jeton.

### 8 bis. Replanifier (le cabinet reprend le créneau)

Sur un rendez-vous confirmé, cliquer **Replanifier**.

**Attendu** : le candidat reçoit **UN SEUL** mail, objet « Nouveau créneau à
choisir », qui s'excuse de devoir décaler et porte un nouveau lien. Il ne reçoit
**ni** avis d'annulation, **ni** message lui réannonçant qu'il est retenu.
Côté équipe : un mail « Entretien annulé » avec une invitation d'agenda qui
**retire** le créneau du calendrier.

**Prouve** : un seul geste côté serveur (annulation silencieuse + réinvitation),
donc un seul message — et pas deux dont un qui répète une nouvelle déjà reçue.

---

## 9. Classement sans suite

Sur une candidature ayant un rendez-vous confirmé : **Classer sans suite**
(raison « candidat retiré »), avec mail d'information.

**Attendu** :

- le lien de la candidature est mort (page « lien inactif ») ;
- le rendez-vous est annulé côté Entretiens ;
- le candidat reçoit **UN SEUL** message : celui du classement. **Pas** d'avis
  d'annulation du module.

Puis **Rouvrir** la candidature.

**Attendu** : le briefing revient « en attente de réservation » (et non « RDV
pris » : le rendez-vous a bien été décommandé).

**Prouve** : une seule voix vers le candidat, et une réouverture qui ne ment pas
sur l'état du rendez-vous.

---

## 10. Changement de référent

Prendre une campagne native avec **au moins un lien actif** (candidat invité
n'ayant pas réservé) **et un rendez-vous déjà pris**.

Édition → **Recruteur référent** → choisir un autre recruteur (avec
disponibilités).

**Attendu** : un dialog annonce « X liens de réservation actifs basculeront sur
l'agenda de [nouveau] » **et** « Y rendez-vous déjà pris ne bougent pas : … chez
[ancien] ». Confirmer.

Vérifier ensuite :

- ouvrir le lien encore actif → les créneaux sont ceux du **nouveau** référent ;
- l'onglet Entretiens montre le rendez-vous déjà pris **toujours** au nom de
  l'ancien.

**Prouve** : l'indirection par la cible — les liens en vol suivent sans
réémission, un engagement pris ne se déplace pas tout seul.

### 10 bis. Cible orpheline

Désactiver le référent (Paramètres → Recruteurs → Désactiver).

**Attendu** : l'onglet Entretiens affiche un bandeau ambre « … n'a plus de
recruteur référent actif : N candidats voient une page momentanément
indisponible ». Ouvrir un lien actif → page dégradée propre (pas une erreur).

Réactiver le référent, le bandeau disparaît.

**Prouve** : on découvre le problème avant le candidat.

---

## 11. Retour au régime Cal.com

Sur la campagne de test : décocher « Réservation native ORQA ».

**Attendu** : le prochain CV fort reçoit une invitation avec le lien **Cal.com**
(personnel du référent, sinon celui des paramètres) — exactement comme avant le
lot 3. Les rendez-vous déjà pris en natif restent visibles et intacts.

Vérifier aussi qu'une réservation Cal.com faite sur un lien **déjà envoyé**
délivre toujours son briefing (webhook inchangé).

**Prouve** : la réversibilité. Rien n'est démonté avant le lot 5 ; le flag est
un interrupteur, pas un aller simple.

---

---

# Recette — page Entretiens v2 (pilotage)

> À faire après la recette ci-dessus, avec au moins **une campagne native** et
> **une campagne restée sur Cal.com** : c'est la coexistence qu'on vérifie
> autant que les actions.

## 12. Les trois onglets, les deux régimes

Onglet **Entretiens**. Il s'ouvre sur **« Entretiens »** (l'agenda), puis
« En attente de réservation » et « En attente de verdict », chacun avec son
compteur.

**Vérifier d'abord les compteurs** : le nombre affiché sur chaque onglet doit
être EXACTEMENT le nombre de lignes visibles dedans. S'ils divergent, c'est un
défaut — le compteur compte les lignes rendues, pas la table.

- Vérifier qu'un candidat invité sur une campagne **Cal.com** ET un invité sur
  une campagne **native** apparaissent tous deux dans « En attente de
  réservation ».
- Sur la ligne native : `lien actif` (ou `lien expiré`). Sur la ligne Cal.com :
  `lien d'agenda Cal.com` — pas une colonne vide.
- L'ancienneté se lit « invité il y a N j », en ambre au-delà du seuil.

**Prouve** : une source unique (`interview_briefs`), aucun filtre par régime.
La page sert la coexistence par construction, pas par un branchement.

> Essai utile : replanifier un rendez-vous natif (§8 bis) puis revenir ici — le
> candidat réapparaît en attente avec un **lien actif** et une ancienneté
> repartie de zéro, pas « en retard de trois semaines ».

## 13. Renvoyer une invitation — dans les deux régimes

Cliquer **Renvoyer une invitation** sur la ligne **Cal.com**.

**Attendu** : le candidat reçoit le message « Nouveau créneau à choisir » avec
le lien d'agenda Cal.com. Aucun bouton grisé.

**Prouve** : pendant la coexistence, la page n'a pas deux vitesses.

## 14. Pointer un entretien passé

Prendre (ou fabriquer) un rendez-vous dont l'heure de fin est passée depuis
plus de 24 h. Onglet **Programmés**.

**Attendu** : il est **en tête**, section « À pointer », sur fond ambre — avant
les rendez-vous à venir. Une pastille ambre est posée sur l'onglet Entretiens,
et le toast métier annonce « N entretiens passés attendent votre pointage ».

Cliquer **Entretien réalisé**.

**Attendu** : la ligne quitte l'onglet « Entretiens » pour « En attente de
verdict » (les deux compteurs bougent d'une unité) ; le ruban Candidatures
compte un `Entretien fait` de plus ; la pastille ambre perd 1.

**Prouve** : le marquage est celui qui fait déjà foi partout — rien n'est
recâblé, et le signal s'éteint par construction.

> Ne PAS pointer un autre rendez-vous passé, et revenir plus tard : il est
> toujours là. Le système signale, il ne transitionne jamais tout seul.

## 15. Le no-show : le fait, puis la décision

Sur un rendez-vous passé, cliquer **Candidat absent**.

**Attendu** : un dialog s'ouvre — rien n'a encore été enregistré. Deux choix :
`Classer non retenu` (par défaut) et `Re-proposer un créneau`.

a. **Annuler le dialog** → vérifier dans Candidatures que le candidat n'a PAS
   changé d'étape. Rien n'a été décidé.
b. Rouvrir, choisir **Re-proposer un créneau** → le candidat reçoit une
   invitation, la ligne repasse dans « En attente de réservation », et son
   étape est inchangée.
c. Sur un autre dossier, choisir **Classer non retenu** → étape `Non retenu`
   dans le ruban, la ligne quitte la page.

**Prouve** : constater une absence n'est pas décider d'écarter. Le marquage
n'est posé qu'après le clic — c'est ce qui rend le refus imputable.

## 16. Verdict et cascade

Onglet **En attente de verdict**, cliquer **GO définitif**.

**Attendu** : étape `Retenu` ; le dialog « poste pourvu » propose de classer
les candidatures restantes de la campagne (flux existant), et **décliner ne
défait pas le GO**.

## 17. Classer sans suite depuis la page

Sur n'importe quelle ligne, **Classer sans suite** : le dialog s'ouvre avec la
raison **« sans réponse »** pré-sélectionnée.

**Attendu** : c'est le MÊME dialog que dans Candidatures (mêmes raisons, même
matrice de mails). Après confirmation, la ligne quitte les deux onglets, le
lien natif est révoqué et un rendez-vous à venir est décommandé.

**Prouve** : un seul chemin de classement, pas un second qui divergerait à la
première évolution de la matrice.

## Points de contrôle rapides

| Symptôme | Où regarder |
| --- | --- |
| La bascule répond une erreur base | `npm run check:scheduling` (migration / cache PostgREST) |
| « Invitation bloquée » sur une campagne native | Le référent a-t-il des **plages** ? (§1) |
| Le briefing n'arrive pas | Le drain tourne-t-il ? (cron en prod, tick en dev) — ouvrir l'onglet Entretiens force un passage |
| Le lien du preview ≠ lien du mail | Ne devrait plus arriver : émission idempotente par candidature (§7) |
| Page candidat sans logo | Identité du cabinet (§2) ; l'URL doit être publiquement accessible |
