# Lexique ORQA — les mots de l'interface

> **Statut : RÉFÉRENCE.** Source de vérité exécutable : `src/lib/lexique/phrases-ecran.ts`.
> Ce document publie la règle et la liste ; le code publie les phrases. Toute phrase lue
> par un utilisateur — écran, Manager, mail de synthèse, documentation client — vient de
> là. Une phrase recopiée ailleurs finirait par diverger, et personne ne verrait la
> divergence.

---

## 1. Les deux règles

1. **Un titre est une phrase complète** — sujet, verbe, objet — que le recruteur pourrait
   dire lui-même. « À décider » n'est pas une phrase, c'est une étiquette de tiroir.
2. **Du point de vue du recruteur, jamais de l'outil.** Et quand l'outil intervient, on le
   DIT (« l'outil vous propose de… », « l'outil ne tranche pas »). Un produit qui décrit
   ses propres mécanismes comme s'ils allaient de soi oblige son lecteur à apprendre sa
   plomberie.

**Test de recevabilité :** la phrase lue à quelqu'un qui ne connaît pas ORQA doit être
comprise sans question.

---

## 2. Les mots bannis

Ce sont les mots du **modèle interne**. Ils décrivent fidèlement le code et ne décrivent
rien de ce que la personne devant l'écran essaie de faire.

| Banni | Ce qu'on dit à la place |
|---|---|
| seuil | « vos repères », « vos critères », ou le nom exact de la section : « Seuils de décision » |
| zone | « ce qui attend votre validation », « ce que l'outil propose d'écarter » |
| dossier | « la candidature », « le candidat » |
| file, fiche de validation | « ce qui attend votre validation » |
| arbitrer, arbitrage | « décider », « trancher » |
| pointer, pointage | « confirmer » (l'entretien a-t-il eu lieu ?) |
| bande de validation | — (n'a jamais rien voulu dire hors du code) |
| non décidable, cohérent, incohérent | dire ce qui manque, concrètement |

**Correspondance par frontière de mot** : « file » ne doit pas accuser « fichier », ni
« zone » accuser « horizon ».

Le test négatif porte sur le **rendu**, commentaires retirés : un commentaire a le devoir
d'expliquer un mécanisme avec ses vrais mots — c'est à l'écran que ces mots n'ont rien à
faire.

### L'exception assumée : « analyse »

Le mot est banni **au sens interne** — « l'analyse » comme objet de base, celui qui porte
un uid et une zone. Il reste juste quand il décrit ce que la personne demande :
« relancer l'analyse de ce CV » se comprend sans rien connaître d'ORQA, et le proscrire
obligerait à dire moins bien. **Aucune règle automatique ne sépare les deux** : les deux
emplois s'écrivent pareil. Il se tient donc à la relecture, pas par un test — inscrire une
règle qu'on ne peut pas faire respecter reviendrait à la désactiver.

---

## 3. Les mots de la navigation

Cinq entrées, et elles seules :

**Aujourd'hui** · **Campagnes** · **Candidatures** · **Entretiens** · **Pilotage**

Anciens noms, à ne plus employer comme destination : *Bureau* (→ Aujourd'hui),
*Reporting* (→ Pilotage), *Arbitrage* / *Validations* (→ Candidatures, carte « À
valider »), *Validations vivier* (→ sous Campagnes). Les anciennes adresses continuent de
fonctionner et mènent d'elles-mêmes au bon écran.

---

## 4. Les mots des états d'une candidature

Dans l'ordre du ruban : **À valider · Invité · RDV pris · Entretien fait · Retenu · Non
retenu · Refusé (historique) · Sans suite**.

« Sans suite » est **terminal et orthogonal au refus** : une candidature classée sans
suite n'a pas été refusée, elle n'a pas été traitée (campagne clôturée, poste pourvu,
candidat retiré…). Le ton reste neutre partout — jamais « refus ».

---

## 5. Qui applique le lexique

| Surface | Garde |
|---|---|
| Assistant de création | `src/lib/campagnes/__tests__/assistant-steps.test.ts` — test négatif sur les libellés d'étape |
| Cartographie du Manager | `src/lib/agents/__tests__/manager-cartography.test.ts` — test négatif sur la prose **et** vérification que chaque libellé cité existe verbatim dans l'UI |
| Écran *Aujourd'hui* | `src/lib/lexique/__tests__/phrases-ecran.test.ts` |

Une garde écrite sur la **forme** d'une phrase rougit à chaque retouche et finit
désactivée : elles portent donc sur les **mots interdits** et sur l'**existence** des
libellés, jamais sur la rédaction exacte.
