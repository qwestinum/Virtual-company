# Jobboard de démonstration — spec de référence

**État : livré (août 2026).** Surface réservée à l'instance de démonstration,
inexistante ailleurs. Objectif : dérouler en rendez-vous la boucle complète
**annonce → publication → candidature → analyse → décision** sans sortir du
navigateur, et sans jamais quitter le chemin de production.

Le script pas-à-pas pour le commercial vit dans
[`docs/ops/script-demo-jobboard.md`](../ops/script-demo-jobboard.md).

---

## 1. Le principe : la démonstration emprunte le chemin réel

Le formulaire de candidature **n'injecte rien** dans le pipeline. Il compose un
vrai mail de candidature — objet portant la référence de campagne, CV en pièce
jointe — et l'**envoie** à la boîte associée à la campagne. La relève IMAP le
ramasse, le rapproche, analyse le CV, applique les seuils, et met en file ou
invite.

C'est un choix, pas une facilité : une démonstration qui court-circuite le
transport démontre le pipeline mais pas le produit. Le prix est la latence — la
candidature apparaît dans la minute qui suit, pas instantanément — et c'est ce
qui impose une cadence de relève à la minute sur l'instance (§7).

```
Campagne ORQA                       TalentBoard (/jobs)
─────────────                       ───────────────────
canal « Annonce générique »
   │ Job Writer pré-rédige
   │ le recruteur ajuste
   └─ Publier ──────────────────►  l'annonce paraît, Réf. CAMP-2026-511
                                        │
                                        │ le prospect candidate
                                        ▼
                                   POST /api/jobs/apply
                                        │ compose + sendEmail
                                        ▼
                              boîte mail de la campagne
                                        │ relève IMAP (chemin de prod)
                                        ▼
              rapprochement CAMP-XXXX → analyse → seuils → HITL / invitation
```

## 2. Le canal « Annonce générique »

Le canal existait déjà dans l'énumération (`PublicationChannel.generic`,
libellé « Annonce générique ») ; il n'avait aucun contenu. Le chantier lui en
donne un, **dans la section « Canaux de diffusion » existante** — pas à côté.

Activer le canal déploie un panneau (`GenericJobAdPanel`) qui :

1. **pré-rédige** l'annonce depuis la fiche de poste, via l'agent Job Writer
   déjà en place (`executeJobWriter`, canal `generic`, mention RGPD apposée de
   façon déterministe) ;
2. affiche titre et corps dans des champs **éditables** ;
3. **publie** au clic — et publier veut dire **figer**.

**Deux gestes, deux natures.** Rédiger appelle le générateur et n'enregistre
rien ; publier enregistre le texte **tel qu'il est à l'écran**, sans repasser
par le générateur. C'est le principe du preview HITL des mails : ce que
l'humain a relu part tel quel. Les deux vivent dans deux routes distinctes
(`…/job-post/generate` ne fait qu'écrire une réponse, `PUT …/job-post` est le
seul chemin d'écriture), pour qu'aucune génération ne puisse réécrire une
annonce publiée.

**Le contenu publié ne voyage JAMAIS dans le snapshot campagne.** Il vit dans
sa propre table et n'est écrit que par sa route dédiée — `campaignToRow` ne le
connaît pas (la fonction n'est même pas exportée). Sans cette séparation, un
onglet ouvert avant la publication rejouerait son état périmé au premier
autosave et effacerait l'annonce. C'est exactement le piège déjà rencontré avec
`campaigns.scheduling_native`.

Localisation et type de contrat sont **figés au moment du snapshot**, eux
aussi : éditer la fiche de poste ne doit pas réécrire une annonce déjà sous les
yeux d'un candidat.

## 3. La référence : `CAMP-YYYY-NNN`, la même des deux côtés

L'annonce publique affiche `Réf. CAMP-2026-511` — **littéralement**
l'identifiant de campagne. Pas un second identifiant d'affichage : c'est cette
chaîne que le commercial montre sur l'annonce, qu'on retrouve dans l'objet du
mail, et que le poller cherche pour rattacher le CV. Fabriquer un `REF-…`
cosmétique casserait le fil de traçabilité qui fait toute la démonstration.

L'objet du mail est `Candidature — <titre> (CAMP-2026-511)` : le **sujet** est
le signal fort du rapprochement (`resolveCampaignMatch`, priorité sujet >
corps). Le corps **redit** la référence — repli si un client de messagerie
réécrit l'objet.

## 4. Les surfaces publiques

| Route | Rôle |
|---|---|
| `/jobs` | liste des annonces publiées |
| `/jobs/[id]` | l'annonce (`id` = identifiant de campagne) + formulaire |
| `POST /api/jobs/apply` | compose et envoie le mail de candidature |

Identité visuelle **délibérément étrangère à ORQA** : nom fictif
« TalentBoard », palette froide, CSS brut auto-porté (`JOBBOARD_CSS`), aucun
jeton de design ni police du produit. Le prospect doit percevoir un site
d'emploi tiers ; un seul emprunt casserait l'illusion. Mobile-friendly, pour
pouvoir candidater depuis son propre téléphone en rendez-vous.

Le corps d'annonce est rendu par un découpeur de blocs **pur**
(`renderAdBlocks`) plutôt qu'un moteur Markdown : le Job Writer ne produit que
titres, listes, paragraphes et emphase, et un moteur générique ouvrirait la
porte à du HTML arbitraire sur une page publique.

## 5. Les gardes

**① Le flag, fail-closed.** `DEMO_JOBBOARD_ENABLED=1` — et rien d'autre :
absente, vide, `0`, `true`, `yes` laissent la surface **inexistante** (404 sur
les deux pages et sur la route). Vérifié **dans chaque page et chaque verbe
d'API**, pas seulement dans le layout. Volontairement un 404 et non un 403 : un
403 confirmerait l'existence de la surface. Ce n'est **pas** un
`NEXT_PUBLIC_*` — le préfixe embarquerait la valeur dans le bundle de tous les
déploiements ; le client apprend l'état de la surface par le 404, ce qui est
fail-closed par construction (le panneau ORQA se retire de lui-même).

**② Le proxy.** Une seule entrée nécessaire : `/api/jobs/apply` dans
`API_SELF_AUTHENTICATED` — `/api/*` est deny-by-default, sans quoi le
formulaire public prendrait un 401. Les **pages** n'ont besoin d'aucune
exemption d'authentification : le régime « pages » du proxy est une liste
blanche, donc tout ce qui n'y figure pas est déjà public. Elles y figurent pour
une autre raison — leur poser `noindex` et `no-store`.

**③ Le débit, fail-closed lui aussi.** 3 candidatures par adresse et par
10 minutes, compteur **en base** (fonction SQL atomique `sched_rate_limit_hit`,
réutilisée telle quelle : une clé opaque, une fenêtre, un plafond — rien de
spécifique à la réservation, et déjà purgée par le drain existant). Consommé
**avant** la lecture du corps multipart : une rafale ne doit pas coûter le
décodage de pièces jointes de 10 Mo.

> ⚠️ **Politique de panne inversée** par rapport aux pages de réservation.
> Là-bas, compteur injoignable ⇒ on laisse passer, parce que la limite n'est
> pas le contrôle d'accès (c'est le jeton) et qu'un refus empêcherait quelqu'un
> de confirmer un vrai rendez-vous. Ici il n'y a aucun jeton, la limite **est**
> la seule borne, et chaque requête acceptée envoie un **vrai mail avec pièce
> jointe**. Le coût d'un refus injustifié est un nouvel essai ; celui d'une
> rafale non bornée est un domaine d'envoi grillé.

**④ L'upload.** 10 Mo (plus bas que les 15 Mo de `/api/cv-analyzer` : ici la
pièce jointe traverse en plus un fournisseur d'envoi, dont les limites sont
plus basses). Formats PDF/DOCX, détectés par **MIME ou extension** — même porte
que le chemin IMAP (`isSupportedCvAttachment`), parce qu'accepter ici un format
que l'analyse ne saura pas lire reviendrait à confirmer une candidature qui
n'arrivera nulle part.

**⑤ Le double-clic.** Il n'y a **pas** de jeton d'idempotence sur ce chemin :
deux soumissions produisent deux mails, donc deux candidatures analysées. Le
bouton est donc désarmé dès le clic et ne se réarme qu'en cas d'échec ; le
débit par adresse est la seconde borne.

**⑥ L'annonce doit être publiée.** `POST /api/jobs/apply` vérifie que l'offre
est **visible** avant d'envoyer quoi que ce soit — sans cela, une campagne
dépubliée resterait ouverte aux dépôts pour qui connaîtrait son identifiant.

**⑦ Aucun faux succès.** Pas de boîte de réception résolue ⇒ 503 explicite et
trace `demo_jobboard_application_failed` ; transport en échec ⇒ 502 et trace.
Le candidat ne voit « Candidature envoyée » que si le mail est parti.

## 6. Le point d'injection directe — analysé, écarté, conservé

Un mode **instantané** (candidature injectée dans le pipeline sans transport)
a été étudié puis retiré du périmètre au profit du transport réel. L'analyse
est consignée ici : elle resservira telle quelle si la latence d'une minute
devenait gênante en rendez-vous.

**Le point d'entrée serait `processEmailAttachment`**
(`src/lib/imap/poller.ts`), déjà exporté pour le rejeu d'un CV non rattaché.
C'est le seul endroit où **analyse + gate d'outreach + brief** tiennent dans
une **fonction serveur unique** : extraction → `analyzeCVApplication` →
artefacts → `persistCandidateAnalysisStrict` → vivier →
`dispatchImapCandidateOutreach` → `gateCandidateOutreach`.

**Ce ne serait pas `/api/cv-analyzer`**, et pas pour la raison qu'on croit. La
route s'arrête bien à l'analyse — elle ne contient aucune occurrence de gate,
de file HITL ni d'envoi. Mais l'aval **existe** sur le chemin du chat : il est
orchestré **côté client**, après le retour de la route, par
`dispatchPostAnalysisOutreach` (`src/lib/chat/manager-flow.ts`), qui appelle le
même `gateCandidateOutreach` que le poller. Les vraies raisons de l'écarter
sont ailleurs :

1. **La fiche de scoring et les seuils viennent du client.** `dispatchCVBatch`
   les lit dans les stores du navigateur et les met dans le `FormData` ; la
   route ne les recoupe jamais avec la campagne. Sur une route publique, on
   posterait ses propres seuils — `thresholdHigh: 0` mettrait tout le monde en
   acceptation automatique.
2. **L'aval du chat est inatteignable depuis le serveur.** `manager-flow.ts`
   pilote sept stores Zustand. Reprendre son contrat obligerait à réécrire
   l'aval côté serveur, donc à créer une **troisième** orchestration du gate —
   la duplication que le projet interdit.
3. **L'idempotence par `(mailbox_id, uid)`** est offerte par le chemin IMAP
   (id d'analyse insert-only, claims deux-phases, artefact CV en id
   déterministe) et absente du contrat cv-analyzer.

**Ce qu'il faudrait pour l'implémenter** : une ligne `mailboxes` synthétique
`mb_demo_jobboard` avec `is_enabled = false` — le critère de sélection du
poller est `is_enabled = true` **et rien d'autre**, donc elle ne serait jamais
relevée ; elle servirait uniquement d'espace de noms pour l'id d'analyse et les
claims.

**Un écueil à connaître dans les deux régimes** : l'adresse du candidat est
extraite **du texte du CV** (`resolveCandidateEmail`), jamais de l'expéditeur du
mail ni du formulaire. Si le CV porte une autre adresse que celle saisie,
l'invitation part à celle du CV. C'est pour cela que les CV de démonstration
doivent porter une adresse maîtrisée (§7).

## 7. Prérequis d'exploitation

La boucle ne se ferme que si **quatre** conditions sont réunies — les trois
premières sont celles de tout flux email, la dernière est propre au rythme
d'une démonstration :

1. la boîte mail est **associée à la campagne** ;
2. la campagne est **`active`** ;
3. la **fiche de scoring est validée** (sinon le CV est stocké et drainé plus
   tard — correct, mais invisible pendant le rendez-vous) ;
4. la **relève est cadencée à la minute** sur l'instance.

Le journal `demo_jobboard_application_sent` enregistre `campaignStatus` et
`scoringSheetValidated` **au moment du dépôt** : un « CV jamais arrivé » se
diagnostique sur pièces, pas à l'aveugle.

Les CV de démonstration doivent porter une adresse **en sous-adressage de la
boîte de démonstration** (`demo+jean.dupont@…`) : jamais l'adresse d'un tiers
réel, jamais un domaine inexistant type `@demo.local` qui rebondirait.

## 8. Nettoyage

`npm run reset:demo-jobboard` supprime les **annonces** (`demo_job_posts`), et
rien d'autre. Périmètre volontairement étroit : depuis le passage au transport
réel, une candidature issue du jobboard est un mail ordinaire — elle a suivi le
même chemin qu'une candidature spontanée et **rien ne la distingue en base**.
La supprimer « parce qu'elle vient de la démo » demanderait de deviner, et
l'effacement d'une candidature réelle est irrattrapable. Les campagnes de
démonstration se ferment par la clôture normale, qui sait déjà quoi faire des
dossiers en cours.

## 9. Hors périmètre

- **QR code** sur la page campagne. Écarté faute de dépendance de génération
  dans le projet — écrire un encodeur QR à la main pour un confort de
  démonstration serait un mauvais échange. Au backlog.
- **Recherche, filtres, pagination** sur `/jobs` : la liste est bornée à 200
  annonces publiées ; au-delà, c'est un ménage qui manque, pas une pagination.
- **Candidature sans CV**, lettre de motivation, questions personnalisées.
- Toute persistance des candidatures côté jobboard : le mail EST la trace.
