# Spécification — Le Vivier de candidats

Document de spécification fonctionnelle. À enregistrer dans `docs/specs/vivier.md` du projet ORQA.

## 1. Contexte et objectif

### 1.1. Le besoin métier

Les organisations qui recrutent en volume (cabinets de placement, ETI multi-recrutements) accumulent un stock de CV au fil du temps. Quand une nouvelle campagne s'ouvre, le réflexe métier naturel est de chercher d'abord dans ce stock interne avant d'attendre les flux entrants.

Le problème : réanalyser tout le stock avec le pipeline LLM à chaque campagne est rédhibitoire en coût et en temps. Il faut une présélection à coût quasi nul, suivie d'une évaluation approfondie sur un sous-ensemble réduit.

### 1.2. Le principe architectural fondateur

**Séparation présélection / évaluation.**

- **Présélection** : réduire le vivier à une short-list de candidats potentiellement pertinents, en quelques secondes, sans appel LLM au moment de la recherche. Le coût d'intelligence est payé une seule fois, à l'entrée du CV dans le vivier (indexation).
- **Évaluation** : les candidats du vivier ne sont jamais scorés sur leur dossier vivier. Ils sont invités à postuler. S'ils répondent, leur candidature entre dans le pipeline standard (fiche de scoring hybride, verdicts, citations) comme n'importe quelle candidature.

### 1.3. Le principe juridique fondateur

Un candidat du vivier n'a pas postulé. Le système ne prend aucune décision de scoring sur une personne qui n'est pas en démarche active. Le mécanisme retenu — l'invitation à postuler — transforme le contact en acte de consentement explicite et frais : si le candidat répond avec sa candidature, il entre dans le flux normal avec une base légale propre.

## 2. Le vivier comme entité

### 2.1. Définition

Le vivier est un espace interne à ORQA, unique par organisation cliente. Il contient des dossiers candidats persistants, indépendants des campagnes.

Le vivier n'est pas un dossier de drive externe. ORQA est la source de vérité unique : fichiers CV dans le Storage, métadonnées et index dans la base. Cette centralisation garantit la fiabilité de l'indexation, la cohérence des recherches et la capacité de suppression effective.

### 2.2. Le dossier candidat vivier

Chaque candidat du vivier est représenté par un dossier contenant :

- **Identité** : nom, prénom, email (clé d'unicité du vivier), téléphone si disponible
- **CV** : le fichier le plus récent (Storage), texte extrait
- **Index** : embedding sémantique, entités structurées extraites (cf. section 3)
- **Tags libres** : liste de chaînes posées par les utilisateurs (famille de poste, séniorité, remarque…)
- **Métadonnées** : date d'entrée au vivier, date de dernière mise à jour, source d'entrée (upload manuel / candidature campagne X)
- **Historique de contacts vivier** : liste des sollicitations (campagne, date, décision) — cf. section 6

### 2.3. Déduplication par email

L'email est la clé d'unicité du vivier. À toute entrée (upload manuel ou candidature entrante) :

- Si l'email existe déjà au vivier → mise à jour du dossier existant : remplacement du CV par le plus récent, réindexation complète, rafraîchissement de la date de mise à jour. Pas de doublon.
- Sinon → création d'un nouveau dossier.

Bénéfice induit : la fraîcheur des dossiers se maintient automatiquement au fil des candidatures.

## 3. Les portes d'entrée et l'indexation

### 3.1. Deux portes d'entrée (v1)

**Porte 1 — Upload manuel.** Interface vivier permettant de déposer un ou plusieurs CV (PDF, DOCX, TXT). Pour chaque fichier : extraction du texte, extraction de l'identité (nom, email — par le pipeline d'extraction candidat existant), création ou mise à jour du dossier, indexation. Usage : injection du stock historique + ajouts ponctuels.

**Porte 2 — Alimentation automatique depuis les flux.** Toute candidature entrante sur n'importe quelle campagne alimente automatiquement le vivier (création ou mise à jour par email). C'est ce qui crée l'effet d'accumulation : le vivier grossit seul, chaque campagne enrichit le stock.

### 3.2. L'indexation : automatique, systématique, asynchrone

Règle absolue : tout dossier qui entre ou se met à jour au vivier est indexé. Tout dossier supprimé est désindexé dans la même transaction. L'indexation est un comportement de l'entité vivier, pas une action des chemins d'entrée.

L'indexation est asynchrone et non-bloquante : elle ne ralentit ni ne fait échouer le traitement de la candidature elle-même. En cas d'échec, elle est rejouée (mécanisme de retry simple). Un dossier non encore indexé est marqué **indexation en attente** et exclu des recherches jusqu'à indexation réussie.

### 3.3. Les trois représentations indexées

**a. Embedding sémantique.** Vecteur généré à partir du texte du CV, stocké en pgvector (Supabase). Permet la recherche par similarité de sens.

**b. Entités structurées.** Extraction par LLM (un appel à l'indexation, coût mutualisé sur la vie du dossier) : technologies et outils, certifications, diplômes, secteurs d'activité, langues, durée d'expérience totale estimée, localisation. Stockées en colonnes/JSONB requêtables. Permet les filtres déterministes.

**c. Métadonnées de fraîcheur.** Dates d'entrée et de mise à jour. Permet la modulation par ancienneté.

### 3.4. Abstraction du fournisseur d'embeddings

Même pattern que l'adaptateur multi-provider du CV Analyzer :

- Interface unique : `embed(text) → vector`
- Variable d'environnement `EMBEDDING_PROVIDER` (défaut `openai`, modèle `text-embedding-3-small`)
- Implémentations futures branchables (Mistral, modèle local) sans toucher au reste du code

Contrainte documentée : les embeddings de deux fournisseurs ne sont pas comparables (espaces vectoriels différents). Tout changement de fournisseur impose une réindexation complète du vivier. Un script de réindexation batch (`reindex-vivier`) est livré dès la v1 : il parcourt tous les dossiers actifs et régénère leurs embeddings avec le provider courant. Le modèle et le provider ayant généré chaque embedding sont stockés avec le vecteur, pour détecter les incohérences.

## 4. La source « Vivier » dans la campagne

### 4.1. À la création de la campagne (Temps 1)

Dans l'écran de sélection des sources/canaux de la campagne, une nouvelle option cochable apparaît : **Vivier**. Elle se présente comme les autres canaux de diffusion. Aucun autre changement dans le flux de cadrage.

### 4.2. À l'activation de la campagne

Si la source Vivier est cochée, l'activation de la campagne déclenche le traitement de présélection :

**Étape 1 — Filtres durs.** Les critères de la fiche de scoring dont la criticité est redhibitoire ou obligatoire ET qui sont vérifiables sur les entités structurées (certifications, diplômes, langues, technologies) sont appliqués comme filtres sur la base des entités. Les critères durs non mappables sur les entités sont ignorés à cette étape (ils seront évalués au scoring réel si le candidat postule).

**Étape 2 — Tri sémantique.** Un embedding de requête est construit à partir de la fiche de poste et des libellés des critères pondérés. Similarité cosinus contre les embeddings des survivants de l'étape 1. Classement décroissant.

**Étape 3 — Modulation fraîcheur.** Pondération du score de pertinence par l'ancienneté de la dernière mise à jour (dégressif au-delà de 12 mois, paramètre interne documenté).

**Étape 4 — Exclusions.** Sont exclus de la short-list : les candidats sous cooldown (cf. section 7), les candidats ayant déjà une candidature active sur cette campagne (rapprochement par email), les dossiers en attente d'indexation.

**Sortie** : une short-list ordonnée, plafonnée par le paramètre de settings (défaut 50). Chaque entrée porte son explication de pertinence : score de similarité, filtres durs passés, fraîcheur, historique de sollicitation éventuel.

Le traitement est relançable manuellement à tout moment pendant la campagne active (bouton « Relancer la recherche vivier »), par exemple après enrichissement du vivier.

### 4.3. Recherche libre complémentaire

En complément de la requête construite depuis la fiche, l'utilisateur dispose d'un champ de recherche libre : un texte saisi (« profil devops senior habitué aux environnements bancaires ») est embeddé et utilisé comme requête sémantique alternative ou complémentaire. Même cascade, même short-list.

## 5. La section « Validation vivier »

### 5.1. Emplacement

L'interface de validation existante de la campagne est enrichie d'une troisième section : **Validation vivier**. Elle liste les candidats de la short-list en attente de décision.

### 5.2. Présentation : enrichie, à affichage progressif

**Vue compacte par défaut** (une ligne par candidat) : nom, titre/fonction extraite, score de pertinence, fraîcheur (« CV mis à jour il y a 4 mois »), badge d'historique le cas échéant (« contacté il y a 7 mois pour la campagne X »).

**Vue détaillée au clic** (dépliable) : explication complète de pertinence (similarité, filtres durs satisfaits avec les entités correspondantes), tags du dossier, aperçu du CV, historique de sollicitations complet.

### 5.3. Les décisions

Pour chaque candidat : **Accepter la prise de contact** ou **Rejeter**. Actions unitaires et en masse (sélection multiple). Chaque décision est tracée (qui, quand) au journal.

### 5.4. Mode automatique (settings)

Si le mode « contact automatique » est activé en settings, la section Validation vivier est court-circuitée : les candidats de la short-list sont contactés directement à l'issue de la présélection (dans la limite du plafond). La section reste visible en lecture pour suivre qui a été contacté. Mode par défaut : validation manuelle — cohérent avec le principe de validation humaine systématique.

## 6. Le contact et le cycle factuel

### 6.1. Le message d'invitation à postuler

Le message envoyé n'est pas une invitation à un entretien. C'est une invitation à candidater. Template par défaut (modifiable en settings, avec variables) :

> Bonjour [prénom],
>
> Nous avons été en contact par le passé et nous nous permettons de revenir vers vous. Nous avons actuellement une opportunité qui pourrait correspondre à votre profil : [intitulé du poste].
>
> Si cette opportunité vous intéresse, envoyez-nous votre candidature à [adresse de réception], en mentionnant « [nom de la campagne] » en objet.
>
> Bien cordialement,
> [Organisation]

Le message intègre la mention d'information sur la conservation des données et la possibilité de demander la suppression (cf. section 8).

### 6.2. Le cycle factuel — trois états, pas de cycle de vie

Le système n'enregistre que des faits vérifiables résultant d'actions internes :

- **identifié** — ressorti de la présélection pour une campagne donnée
- **rejeté** — prise de contact refusée en validation (avec date et auteur)
- **contacté** — invitation envoyée (avec date)

Aucun statut spéculatif (a postulé, sans réponse, a décliné) n'est géré : ces informations ne sont pas vérifiables automatiquement, on assume leur absence.

### 6.3. Le rapprochement opportuniste par email

Quand une candidature entre dans une campagne, le système vérifie si son email correspond à un candidat vivier contacté pour cette même campagne. Si oui :

- La candidature reçoit une annotation factuelle : « Candidat issu du vivier — contacté le [date] », visible par le recruteur
- Le dossier vivier reçoit : « A postulé à la campagne [X] le [date] »
- Le candidat sort du périmètre du cooldown pour cette campagne

Le rapprochement est exact ou inexistant : pas de fuzzy matching sur le nom, pas d'heuristique. Si le candidat postule avec un autre email, on ne le sait pas, et c'est assumé.

### 6.4. La métrique de conversion

Le reporting de campagne (et le multi-campagnes) peut désormais afficher : nombre de candidats vivier contactés, nombre de candidatures rapprochées (« au moins N ont postulé »). C'est la métrique de valeur du vivier.

## 7. Le cooldown anti-sollicitation

Un candidat contacté n'est pas re-proposé dans une short-list (toutes campagnes confondues) pendant la durée du cooldown. Paramètre en settings, défaut 90 jours. Un candidat rejeté en validation pour une campagne n'est pas re-proposé pour cette même campagne (mais reste éligible aux autres).

L'historique de sollicitation reste visible dans la vue détaillée pour que l'humain décide en connaissance quand le cooldown est échu.

## 8. RGPD — périmètre v1 minimal et défendable

Deux obligations seulement en v1, le reste en Phase B :

### 8.1. Information

Les annonces générées par ORQA intègrent une mention : « Vos données pourront être conservées dans notre vivier de candidatures afin de vous proposer des opportunités futures. Vous pouvez demander leur suppression à tout moment à [contact]. » Le message d'invitation vivier porte la même mention.

### 8.2. Suppression manuelle à la demande

L'interface vivier offre un bouton « Supprimer du vivier » par dossier. La suppression est une cascade complète et transactionnelle : fichier CV (Storage) + embedding (pgvector) + entités + métadonnées + dossier. Reste une trace anonymisée au journal d'audit (« un dossier vivier a été supprimé le [date] par [utilisateur], motif : [demande candidat / décision interne] ») — preuve d'exécution sans données personnelles. Confirmation demandée avant exécution (action irréversible).

**Hors périmètre v1 (Phase B)** : archivage réversible, durée de conservation maximale avec suppression automatique, re-sollicitation avant échéance, module de consentement.

## 9. La page Settings — paramètres vivier

Nouvelle section « Vivier » dans les settings de l'organisation :

- **Mode de contact** : validation manuelle (défaut) / contact automatique
- **Template du message d'invitation** : éditable, avec variables ([prénom], [intitulé du poste], [nom de la campagne], [adresse de réception], [Organisation])
- **Cooldown** : durée en jours (défaut 90)
- **Plafond de short-list** : nombre maximum de candidats proposés par recherche (défaut 50)

## 10. Hors périmètre v1 (Phase B et au-delà)

- Import en masse depuis un dossier drive externe (one-shot)
- Archivage réversible, échéances de conservation, re-sollicitation automatique
- Exploration libre du vivier hors campagne (écran de recherche autonome)
- Segmentation du vivier (multi-viviers, par site ou famille de poste)
- Sourcing externe (CVthèques à API officielles — jamais de scraping)
- Notifications proactives de match (nouveau candidat ↔ campagnes actives)

## 11. Phasage de développement

- **Session V1 — Socle** ✅ *livré* : entité vivier, modèle de données, upload manuel, indexation (embedding + entités + abstraction provider), déduplication par email, suppression cascade, script de réindexation.
- **Session V2 — Alimentation automatique depuis les flux + intégration campagne** ✅ *livré* : source Vivier à la création, traitement de présélection à l'activation, short-list (cf. §12).
- **Session V3 — Validation vivier + contact** ✅ *livré* : section validation, message d'invitation, cycle factuel, rapprochement par email, cooldown, settings, mention RGPD dans les annonces (cf. §13).

## 12. Notes d'implémentation (V1–V2)

Décisions et constantes figées à l'implémentation — à respecter par les sessions ultérieures.

### 12.1. Alimentation automatique (§3.1 porte 2)

Point d'accroche : **après** la persistance de la candidature (`persistCandidateAnalysis`), aux deux portes de réception — route `POST /api/cv-analyzer` (upload manuel, en `after()`) et poller IMAP (`src/lib/imap/poller.ts`, fire-and-forget). Helper unique `feedVivierFromApplication` (`src/lib/vivier/ingest-application.ts`) : mappe la candidature vers `upsertVivierCandidate` (source `campaign_application`) puis indexe. **Non bloquant de bout en bout** (n'échoue jamais vers l'appelant ; la planification elle-même est best-effort). **Garde email** : sans email résolu, pas d'alimentation. **Périmètre** : toute candidature avec email + CV (campagnes ET tâches). Idempotence = déduplication par email V1.

### 12.2. Source Vivier (§4.1)

`'vivier'` ajouté à `CVSource` (`src/types/cv-source.ts`) : apparaît nativement dans les pickers de sources, persisté dans `campaigns.sources` (text[]), vérif = `sources.includes('vivier')`. **Pas de colonne dédiée.** Source interne : opérationnelle, jamais activée par défaut (pas un canal de diffusion), exclue des intégrations API des settings.

### 12.3. Présélection — cascade (§4.2)

Module `src/lib/vivier/preselection.ts`. RPC pgvector `match_vivier_candidates` (similarité cosinus ; supabase-js ne peut pas exprimer `<=>` en direct).

- **Mapping critère → filtre dur** : pas de champ « type » sur un critère ⇒ un critère est un filtre dur **mappable** ssi sa criticité est dure (`redhibitoire`/`obligatoire`, via `criterionBehavior`) **ET** il porte des mots-clés non vides. Le matching cherche la présence d'au moins un mot-clé (frontière de mot, `findMatchedKeywords` réutilisé) dans le **pool** `technologies ∪ certifications ∪ diplômes ∪ langues`. Un candidat survit ssi il passe **tous** les filtres durs mappables. Critère dur **sans** mots-clés = non mappable, ignoré ici (évalué au scoring réel).
- **Texte de requête sémantique** (`buildVivierQueryText`) : champs FDP (`job_title`, `main_missions`, `key_skills`, `seniority`, `location`) + libellés des critères **triés par poids décroissant**, **sans répétition** (la répétition pour pondérer un embedding est un artefact peu fiable).
- **Modulation fraîcheur** (`freshnessFactor`) : facteur 1 jusqu'à **12 mois**, puis dégressif **−5 %/mois**, **plancher 0,5**. `relevanceScore = similarity × freshnessFactor` (clé de tri).
- **Exclusions** : `pending`/`failed` (implicite — seuls les `indexed` entrent), candidats déjà candidats sur la campagne (rapprochement **exact** par email), cooldown (**point d'extension V3** — paramètre `cooldownEmails`, vide en V2).
- **Plafond** : `SHORTLIST_CAP = 50` (constante en V2, paramétrable en V3).

### 12.4. Persistance de la short-list

Table `vivier_preselections` (PK `(campaign_id, candidate_id)`, `on delete cascade` sur le dossier). Porte un champ **`state`** (`identified` | `contacted` | `rejected`) dès la V2 — substrat du cycle factuel V3. Seule la short-list **issue de la fiche** est persistée ; la **recherche libre** (§4.3) est **éphémère**.

`replacePreselection` (réconciliation pure `reconcilePreselection`) est **idempotent et non destructif des décisions** : il purge les `identified` périmés et upsert le reste, mais ne **ressuscite ni ne supprime jamais** une ligne `contacted`/`rejected`. L'idempotence vit dans la donnée (réconciliation par contenu), pas dans l'hypothèse d'un appel unique.

### 12.5. Déclenchement à l'activation

L'activation est une mutation de store synchronisée (pas de transition serveur). Hook = **déclencheur client** (`triggerVivierPreselection`) dans `onActivate` (si `sources.includes('vivier')`) appelant le **même endpoint idempotent** que la relance manuelle : `POST /api/campaigns/[id]/vivier-preselection` (corps vide = présélection fiche persistée ; `{ freeText }` = recherche libre éphémère ; `GET` = relit la short-list persistée).

## 13. Notes d'implémentation (V3)

### 13.1. Cycle factuel & table de liaison (§6.2)

La table `vivier_preselections` (V2) **est** la liaison campagne↔candidat : le cycle factuel est l'évolution de son `state`. Étendue de faits datés **nullable** : `contacted_at`, `rejected_at`, `decided_by`, `applied_at`. **Cohérence atomique état↔dates** garantie en base (CHECK : `identified` sans date de décision ; `contacted` ⇒ `contacted_at` ; `rejected` ⇒ `rejected_at` + `decided_by`) **et** dans la couche d'accès (`markContacted`/`markRejected` posent état + date en une opération, garde `state = identified` ⇒ idempotent, jamais de spéculatif ni de retour arrière). Transitions autorisées : `identified → contacted | rejected` uniquement (guard pur `proposal-cycle.ts`).

### 13.2. Section Validation vivier (§5)

Vue **org-level dédiée** `/validations-vivier` (lien + badge global dans le `TopBanner`), pas un onglet campagne. Niveau 1 : campagnes ayant ≥1 proposition `identified` (compteur via RPC `vivier_pending_by_campaign`, agrégation en base ; triées par charge ; une campagne sans attente n'apparaît pas). Niveau 2 : candidats `identified` de la campagne, vue compacte/détaillée dépliable, décisions **unitaires + en masse** tracées au journal (`vivier_contact_accepted`/`rejected`). Composant `VivierValidationList` autonome (props).

### 13.3. Message d'invitation (§6.1) & permission d'envoi

Template **déterministe** éditable en settings (renderer pur `invitation-template.ts`, défaut §6.1), variables `[prénom]`/`[intitulé du poste]`/`[référence]`/`[nom de la campagne]`/`[adresse de réception]`/`[Organisation]`, **mention RGPD apposée systématiquement** (partagée avec les annonces via `rgpd-mention.ts`). **`[référence]` = l'ID campagne (`CAMP-XXXX`)** : c'est elle, et non le nom, que le poller IMAP cherche dans l'objet pour rattacher la candidature (`matchCampaignInSubject`). Le template par défaut insiste donc sur la **mention impérative de la référence en objet** comme condition de traitement de la candidature. Ceinture-bretelles : la référence est aussi dans l'objet du mail d'invitation envoyé (`replyTo` = adresse de réception) — un candidat qui se contente de **répondre** conserve « Re: … (réf. CAMP-XXXX) » et reste rattachable. Invitation à **candidater**, jamais à un entretien. Réutilise `sendEmail` (Resend). **L'envoi fait passer à `contacted`** : succès ou email non configuré ⇒ marqué (best-effort) ; échec dur ⇒ re-tentable. **Permission** : en **manuel**, l'acceptation explicite (route `…/decisions`) déclenche l'envoi ; en **auto**, `autoContactIfEnabled` envoie toute la short-list après la présélection (non bloquant, dans la limite du plafond).

### 13.4. Rapprochement par email (§6.3)

Aux deux points d'entrée d'une candidature (route `cv-analyzer` + poller IMAP), `matchVivierApplication` : correspondance **exacte** sur l'email normalisé (jamais de fuzzy) avec un candidat vivier **contacté** pour cette campagne ⇒ `recordApplied` pose `applied_at` (première candidature only) + journal `vivier_application_matched`. Hors campagne / sans email : no-op. **Annotations dérivées à la lecture** (pas d'écho persisté) : candidature « issu du vivier — contacté le [date] » (audit candidat, `findContactedProposalByEmail`) ; dossier « a postulé à la campagne X » (historique des propositions).

### 13.5. Cooldown (§7)

Câblé dans l'étape 4 de la présélection : **contacté ⇒ cooldown GLOBAL** (exclu de toute short-list tant que `contacted_at` est dans la fenêtre ; échéance = `contacted_at + cooldownDays`, via `listContactedEmailsSince`) ; **rejeté ⇒ exclusion PAR campagne** (`listRejectedEmailsForCampaign`, éligible ailleurs) ; **sortie de cooldown à la candidature** automatique (devient « déjà candidat »). Le **plafond** de short-list est désormais lu des settings (remplace la constante V2).

### 13.6. Settings vivier (§9) & métrique de conversion (§8)

`AppSettings.vivierConfig` (jsonb) : mode de contact (manuel/auto), template d'invitation, cooldown (jours), plafond, nom d'organisation — section Settings `VivierConfigManager`. **Métrique de conversion** dans le rapport de campagne : `countVivierMetricsForCampaign` (contactés / candidatures rapprochées), portée par `CampaignReportData.vivier`, rendue au PDF (« au moins N ont postulé »).

### 13.7. Mention RGPD dans les annonces (§7)

`withVivierRgpdMention` appose la mention (libellé partagé) au corps de l'annonce générée, de façon **déterministe** (jamais soumise au LLM ⇒ toujours présente). Contact = intake/expéditeur des settings, repli générique.
