# Script de démonstration — la boucle complète en rendez-vous

**Pour qui** : le commercial qui présente ORQA à un prospect.
**Ce qu'on montre** : une annonce rédigée par l'IA, publiée en un clic sur une
plateforme d'emploi, une candidature déposée par le prospect lui-même, et le
dossier qui revient **analysé, scoré et classé** dans ORQA — sur la campagne
dont il vient de lire la référence sur l'annonce.

**Durée du parcours** : environ 2 minutes, dont **une minute d'attente**
assumée pendant la relève du courrier. Cette attente n'est pas un défaut à
masquer : c'est la preuve que rien n'est truqué. Voir §5 pour quoi en faire.

---

## 1. Avant le rendez-vous (10 minutes, la veille de préférence)

**À vérifier une fois pour toutes sur l'instance de démonstration :**

- [ ] `DEMO_JOBBOARD_ENABLED=1` est posée **et le déploiement a été refait**
      (Vercel attache les variables par déploiement).
- [ ] La relève du courrier tourne **à la minute**. Sur l'instance de
      démonstration, c'est le cron externe qui appelle `/api/cron/imap-poll` —
      s'il est réglé plus lentement, l'attente en rendez-vous s'allonge d'autant.
- [ ] La boîte mail de démonstration est **légère** : une boîte encombrée coûte
      des secondes à chaque ouverture, et c'est du temps ajouté à l'attente.
      Idéalement une boîte dédiée, ou un dossier dédié alimenté par une règle.

**À préparer pour la démonstration :**

- [ ] Une campagne **`active`**, avec une **fiche de scoring validée** et la
      **boîte mail associée**. Sans ces trois-là, le CV n'est pas analysé.
      (Le canal se coche quand même — c'est le CV qui n'arrivera pas.)
- [ ] **Deux CV synthétiques**, un bon et un moyen, pour montrer les deux
      issues : l'acceptation automatique et la validation humaine.

> ⚠️ **Les adresses des CV.** L'invitation part à l'adresse **écrite dans le
> CV**, pas à celle saisie dans le formulaire. Les CV de démonstration doivent
> donc porter une adresse **que vous contrôlez**, en sous-adressage de la boîte
> de démonstration : `demo+jean.dupont@votre-domaine.fr`,
> `demo+claire.martin@…`. Jamais l'adresse d'une vraie personne — le mail
> partirait pour de bon. Jamais non plus un domaine inventé type
> `@demo.local` : il rebondirait, et un rebond se voit.

---

## 2. Publier l'annonce (≈ 45 s, devant le prospect)

1. **Campagnes** → ouvrir la campagne → section **« Canaux de diffusion »**.
2. Activer **« Annonce générique »**.
   > *« Je coche le canal, et pendant qu'on parle l'agent rédacteur écrit
   > l'annonce à partir de la fiche de poste. »*
3. Le panneau se déploie, l'annonce apparaît **déjà rédigée**, dans un champ
   modifiable.
4. **Ajuster une phrase devant lui.** C'est le moment le plus important de la
   séquence : montrer que l'IA propose et que l'humain décide. Changer un mot
   du chapeau suffit.
   > *« Ce que je corrige ici part tel quel. Le système ne réécrira jamais mon
   > texte derrière moi. »*
5. **Publier**. Le statut passe à « ● Publiée le … » et la référence
   `CAMP-2026-XXX` s'affiche en tête du panneau.

**Montrer la référence, à voix haute.** C'est le fil rouge de toute la
démonstration.

---

## 3. Candidater (≈ 30 s)

1. **« Voir l'annonce ↗ »** — ouvre `/jobs/CAMP-2026-XXX` dans un second onglet.
   Ou : demander au prospect d'ouvrir `…/jobs` **sur son téléphone**, ce qui est
   nettement plus frappant.
2. Laisser un temps sur la page.
   > *« Voilà ce que voit un candidat. Rien n'indique ORQA — c'est une annonce
   > sur une plateforme d'emploi. Et là, la référence : la même que tout à
   > l'heure. »*
3. **Candidater** : nom, email, téléphone, le CV synthétique. **Envoyer.**
4. Écran de confirmation sobre.

---

## 4. Le retour dans ORQA (≈ 1 min d'attente, puis 30 s)

Retourner dans ORQA, onglet **Candidatures**.

Au bout d'une minute environ, la candidature apparaît : **nom, score, zone**.

- CV **bon** → acceptation automatique, l'invitation à l'entretien est partie.
- CV **moyen** → **« À examiner »** : le dossier attend une décision humaine.
  C'est souvent l'argument qui porte le plus.

> *« Aucun refus ne part tout seul. Le système propose, vous tranchez. »*

**Bonus, si vous avez le temps** : ouvrir la boîte de démonstration et montrer
le mail d'invitation réellement reçu — c'est le CV qui l'a déclenché, personne
ne l'a écrit.

---

## 5. Que faire de la minute d'attente

Ne pas la subir : elle est le meilleur moment pour expliquer ce qui se passe.

> *« Là, le système relève la boîte mail comme il le ferait chez vous. Il
> reconnaît la référence de la campagne dans l'objet, ouvre le CV, l'extrait,
> le compare à la grille de scoring que vous avez validée, et applique vos deux
> seuils. Aucun raccourci n'a été pris pour la démonstration — c'est
> exactement ce qui tournerait en production. »*

C'est aussi le moment de montrer la fiche de scoring de la campagne, pour que
le score qui va s'afficher ait un sens.

---

## 6. Si quelque chose ne se passe pas

| Symptôme | Cause la plus probable | Quoi faire |
|---|---|---|
| Le panneau d'annonce n'apparaît pas | `DEMO_JOBBOARD_ENABLED` absente ou déploiement non refait | Rien à faire en séance — vérifier avant |
| `/jobs` répond « page introuvable » | idem | idem |
| « Cette offre ne peut pas recevoir de candidature » | aucune boîte associée à la campagne | Associer la boîte, republier n'est pas nécessaire |
| La candidature n'arrive pas au bout de 3 min | campagne non `active`, ou fiche de scoring non validée | Enchaîner sur autre chose ; le CV n'est pas perdu, il sera traité dès la validation |
| Le candidat s'appelle « Candidat anonyme », score 0 | le fichier envoyé n'était pas un CV | Reprendre avec le bon fichier |

**Où regarder après coup** : le journal porte une ligne
`demo_jobboard_application_sent` par candidature déposée, avec l'état de la
campagne **au moment du dépôt** (`campaignStatus`, `scoringSheetValidated`) et
l'adresse destinataire. C'est là qu'on voit, sans deviner, pourquoi un CV n'est
jamais arrivé.

---

## 7. Après le rendez-vous

- **Dépublier** l'annonce depuis le panneau (« Dépublier ») : elle disparaît de
  `/jobs`, le texte relu reste disponible pour la prochaine fois.
- **Remise à zéro** des annonces : `npm run reset:demo-jobboard`.
- Les **candidatures** déposées ne sont pas effacées par ce script : elles sont
  arrivées par la boîte mail comme n'importe quelle candidature. Passer par la
  clôture de campagne, qui propose de classer les dossiers en cours.
