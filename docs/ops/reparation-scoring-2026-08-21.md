# Réparation du parc — veto du pré-filtre (21/08/2026)

Compte rendu factuel de l'incident, de sa réparation et de ce qui reste à
décider. Le correctif de fond est commité séparément (`fix(scoring): le
pré-filtre par mots-clés perd son droit de veto`).

---

## 1. Ce qui s'est passé

Jusqu'au 21/08/2026, un critère de fiche muni d'une liste de mots-clés était
tranché **en local, sans appel au modèle** : mot-clé trouvé ⇒ « satisfait »,
mot-clé absent ⇒ **« non »**. Cette seconde règle était le défaut. L'absence
d'un mot n'est pas l'absence d'une compétence.

Cas de découverte, CAMP-2026-288 : un consultant SI de quatre ans, AMOA et
Trade Finance, a obtenu **0/100, quatre critères sur quatre à « non »**. Le CV
disait « Consultant SI & AMOA » quand la fiche cherchait « Consultant MOA », et
« Trade Finance — Société Générale » quand elle cherchait « secteur financier ».
Ni l'extraction (3 197 caractères parfaitement lisibles) ni le prompt n'étaient
en cause : **aucun modèle n'a ouvert ce CV**.

Après correctif, le même dossier obtient **70/100**, avec citations :

```
[critique]        MOA                              → satisfait   « Spécialisé en AMOA »
[très important]  Expertise secteur financier      → satisfait   « Banque & Finance (Trade Finance, KYC) »
[important]       Parcours digitaux et UX          → non_verifiable
[souhaitable]     Outils GenAI appliqués           → non_verifiable
```

Les deux critères réellement absents sont marqués `non_verifiable` — « non
évalué » — et non « non ». C'est le comportement attendu : on n'affirme rien
contre un candidat sans preuve.

## 2. Ampleur constatée

**53 analyses** touchées, **105 critères** éteints sans lecture, dont **53 de
criticité « critique »**, réparties sur 5 campagnes actives (CAMP-2026-200,
-009, -894, -288, -045). Sur 80 analyses portant un barème, **deux tiers**
étaient concernées.

## 3. Ce qui a été réparé — 18 dossiers ouverts

Re-scorés le 21/08 (`npm run rescore -- --apply --replayable`). **Aucun envoi
n'a été déclenché**, vérifié : 0 ligne d'outreach dans le journal sur la
fenêtre du traitement.

| | avant → après |
|---|---|
| Yassine Boukhrissi (288) | **0 → 70** — franchit le seuil bas, passe en zone grise |
| MOHAMED LAMINE DIALLO (200) | 28 → 100 |
| Kevin NGUYEN (045) | 59 → 100 |
| Asma Zghonda (288) | 47 → 90 |
| Nobout / Rodal / Mariem / SONIA / Aziz / Ahmed… | hausses de +5 à +31 |
| Nissaf BALDI (288), BILAL KADDOURI (288) | 50 → 30, 37 → 30 (baisses, cf. §6) |
| Remy FRANCISCO (894) | **non rejouable — binaire absent** (cf. §7) |

Trois dossiers passent en `auto_accept`. **Ils n'ont déclenché aucune
invitation** et restent en file de validation humaine, score à jour. C'est
voulu : une invitation partie deux semaines après coup, sur une campagne
peut-être pourvue, ferait plus de mal que le refus initial.

## 4. Ce qui n'a PAS été touché — 33 dossiers déjà tranchés

Un humain a décidé en connaissance de cause. Recalculer par-dessus créerait une
incohérence entre le score affiché et la décision prise, et rouvrirait des
dossiers clos. Ils ont donc été **simulés en lecture seule**.

**Sur ces 33 : 28 ont été REFUSÉS par un humain, 5 acceptés.**

Ce sont ces 28 refus qui constituent le préjudice potentiel : la personne qui a
tranché voyait un score amputé. Les écarts les plus larges :

| Candidat | Campagne | score vu | score réel (simulé) |
|---|---|---|---|
| Nkelé ESOH | 009 | 38 | **100** |
| Armel MEFO | 200 | 22 | **83** |
| Pascale Huard | 200 | 39 | **89** |
| Ahmed Iheb Ayed | 894 | 36 | **71** |
| Yvan Bisseg | 200 | 28 | **61** |
| Dylan KOUAKEP | 009 | 69 | **100** |
| Alexander Rikhard A. | 045 | 76 | **100** |
| Nobout Marcel BONY | 009 | 54 | **85** |
| Omar SABIR | 200 | 50 | **81** |
| MONIQUE KOUPMO | 045 | 53 | **82** |
| THIAM SALIMATA | 200 | 39 | **69** |
| Sirine KHEMISSI | 009 | 42 | **69** |

**14 dossiers gagnent 20 points ou plus.** Trois passeraient en acceptation
automatique. Aucun ne franchit un seuil BAS (ils étaient tous déjà en zone
grise, donc soumis à un humain) : le bug n'a pas provoqué de refus
automatique ici, il a **faussé le jugement humain** en lui présentant un
mauvais chiffre.

## 5. Les deux refus réellement partis

Zone `auto_reject` (valeur legacy, d'avant la bascule RGPD du 18/08) : ces deux
candidats **ont reçu un mail de refus**, sans validation humaine.

| Candidat | Campagne | score vu | simulé | lecture |
|---|---|---|---|---|
| Mahmoud GAZBAR | 894 | 14 | **36** | franchissait le seuil bas (20) — **refus injustifié** |
| MOHAMED ABBASSI | 894 | 11 | **0** | le refus tenait — la relecture le confirme |

Un seul des deux a subi un préjudice. Ils sont **délibérément exclus du rejeu
automatique** (`reject_sent`) : recalculer un score ne dé-refuse personne, et
le faire remonter en silence donnerait l'illusion que l'affaire est réglée.

## 6. Réserve de lecture — la simulation rejoue TOUT le dossier

Le re-scoring relance l'analyse **complète**, pas seulement les critères
éteints. Les critères qui avaient déjà été jugés par le modèle sont donc
re-jugés, et le modèle n'est pas parfaitement déterministe : une partie des
écarts (dans les deux sens) vient de là, pas du correctif.

C'est un choix assumé : un dossier issu d'une seule passe cohérente vaut mieux
qu'un assemblage de deux exécutions différentes, dont le relevé de faits ne
serait même pas le même. **Conséquence pratique : lire les hausses de +20 et
plus comme un signal solide, et les écarts de ±10 comme du bruit.** Six
dossiers baissent ; aucun ne change de zone de décision.

## 7. Un CV irrécupérable — signal d'un autre sujet

**Remy FRANCISCO (CAMP-2026-894)** : le binaire du CV est absent du stockage.
Il est tracé « NON REJOUABLE : binaire absent » plutôt que silencieusement
omis — un dossier qu'on ne peut plus relire doit se voir.

Pourquoi ce binaire manque est une **question ouverte, à instruire à part**.
Piste connue : le bucket `artifacts` refuse le MIME DOCX, ce qui fait échouer
l'archivage de certains CV sans casser l'analyse (cf. `project_bucket_mime_docx`).
Si c'est la cause, d'autres CV sont dans le même cas sans qu'on le sache.

## 8. Outillage

`npm run rescore` — script de re-scoring hors ligne (`scripts/rescore-analyses.ts`).

```
npm run rescore -- --simulate               # rapport, N'ÉCRIT RIEN (défaut)
npm run rescore -- --simulate --verbose     # + verdicts et citations, critère par critère
npm run rescore -- --apply --replayable     # dossiers ouverts uniquement
npm run rescore -- --apply --only=<id>,…    # dossiers nommés
```

Trois garanties, indépendantes des options passées :

1. **Aucun envoi, jamais.** Le script ne touche ni l'outreach, ni les claims,
   ni les briefs — même quand le nouveau score passe en acceptation automatique.
2. **Aucune décision écrasée.** La garde est en SQL (`rescoreCandidateAnalysis`
   conditionne sur `decided_by = 'auto'` et `dismissed_at is null`), pas dans
   l'appelant : un script lancé à la main ne peut pas la contourner.
3. **Sélection auto-limitante.** Le repérage lit la signature de l'époque
   (verdict négatif + méthode à mots-clés + aucun mot-clé + chemin ≠ `llm`).
   Un dossier réparé porte désormais `decidedBy: 'llm'` et sort de la
   sélection — le parc touché est passé de 53 à 36 après la première vague,
   sans qu'aucune liste ne soit tenue à la main.

Trace : action `analysis_rescored` au journal (scores avant/après, zones,
critères rejoués, `outreach: 'untouched'`).

## 9. Ce qui reste à décider

- **Les 28 refusés par un humain sur un score faussé** : faut-il en parler au
  client, et à quel périmètre ? Les 12 du tableau §4 sont les plus défendables.
- **Mahmoud GAZBAR** : refus parti, injustifié à la relecture.
- **Remy FRANCISCO** : CV irrécupérable, et le sujet du binaire manquant.
