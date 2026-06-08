# HITL — Validation suspendue (refus / acceptation candidats)

Spec fonctionnelle + plan d'implémentation. Périmètre **limité** : mise sous
validation humaine des **mails de refus** et des **mails d'acceptation** envoyés
aux candidats après scoring. Pose la mécanique d'approbation réutilisable ensuite
(diffusion, shortlist…).

## 1. Problème

Aujourd'hui `dispatchPostAnalysisOutreach` (`src/lib/chat/manager-flow.ts:488`)
envoie **automatiquement**, juste après le scoring : refus aux candidats sous le
seuil, invitations (+ Cal.com + brief DRH) aux candidats au-dessus. Aucun
garde-fou humain. Le champ `AgentContract.humanValidation` existe mais n'est **pas
câblé**.

## 2. Principe

Doctrine « le LLM propose, le code verrouille » : avant tout envoi, le **code**
consulte la config HITL. Si la section est gardée, il **compose le brouillon mais
NE l'envoie pas** — il crée une **validation suspendue** que l'humain traite.

- Toggle **OFF** (par section) → comportement actuel : envoi automatique.
- Toggle **ON** → mise en file, rien ne part avant action humaine.
- **Défaut = ON** pour les deux sections (refus, acceptation).

## 3. Cycle de vie d'une ligne (machine à états)

Décision de l'IA = `accept` | `reject`. Une ligne = un candidat en attente.

```
[Valider la décision]   [Switcher]   [Vérifier le mail — grisé]
        │                    │
        │                    └─► régénère TOUTE la chaîne inverse (+ artefacts),
        │                        la ligne quitte sa liste et réapparaît dans la
        │                        liste opposée comme une ligne normale (3 boutons).
        │                        NON terminal — rien n'est envoyé. (cf. §6 mixte → b)
        │
        └─► déverrouille « Vérifier le mail » (anti-envoi-en-1-clic)
                    │
                    └─► ouvre le mail DRAFT déjà généré (éditable) + [Envoyer]
                                │
                                └─► ENVOI = SEULE action terminale :
                                    envoie le(s) mail(s), acte statut + métriques
                                    + journal. AVANT ça, RIEN n'est comptabilisé.
```

Règles :
- **Valider la décision** : confirme la décision, déverrouille la revue. N'envoie rien.
- **Switcher** : flip **non terminal**, régénère la chaîne complète de l'inverse,
  déplace la ligne dans la liste opposée.
- **Vérifier le mail** : relit le brouillon (refus ou acceptation, déjà généré),
  édition libre, **Envoyer** = terminal.
- Pas de bouton « Ignorer » : **l'inaction = la ligne reste en file** (aucun envoi).

## 4. Affichage — page « Validation suspendue »

**Deux listes distinctes, côte à côte** (desktop ; empilées/onglets en étroit) :

- **Refusés par le système** (badge compte)
- **Acceptés par le système** (badge compte)

Choix du côte-à-côte : « Switcher » fait **migrer la carte** d'une liste à l'autre →
le geste « je bascule ce candidat » est visuel et mimétique.

**Carte (par ligne)** — re-contextualisation :
- Nom du candidat
- Score (réutiliser `ScoreRing`)
- Campagne (chip/lien)
- **Rapport de notation** (AttachmentChip → artefact de notation existant)
- Accès CV candidat (artefact)
- Rangée de **3 boutons** (cf. §3) ; « Vérifier le mail » grisé tant que « Valider »
  n'a pas été cliqué.

États visuels de carte : `en attente` (3 boutons) → `décision confirmée`
(Vérifier le mail actif) → à l'envoi, la carte **quitte la liste** (historique
« traités » optionnel, hors MVP).

En-tête de page : « N actions en attente ». Filtre par campagne (optionnel).
Lien + **badge de compteur** depuis le dashboard / la nav.

États vides par liste. Les deux listes peuvent contenir des items : analyse (selon
toggles ON) **et** arrivées par Switcher (décision b — reste en file même si la
section cible est OFF).

## 5. Modèle de données

**Table Supabase `pending_validations`** (persistée — survit au refresh/session) :

| Colonne | Type | Rôle |
|---|---|---|
| `id` | text PK | id de la validation |
| `campaign_id` | text | campagne |
| `candidate_name` | text | nom affiché |
| `candidate_email` | text | destinataire (résolu au scoring) |
| `score` | int | note |
| `decision` | text `accept`\|`reject` | décision courante (flippe au Switcher) |
| `cv_artifact_id` | text null | CV candidat |
| `report_artifact_id` | text null | rapport de notation |
| `mail_draft_artifact_id` | text null | brouillon du mail courant (refus/accept) |
| `confirmed` | bool | « Valider la décision » cliqué (déverrouille la revue) |
| `status` | text `pending`\|`sent` | sent = terminal |
| `payload` | jsonb | snapshot nécessaire à l'envoi (MailCandidate, liens Cal.com…) |
| `created_at` / `updated_at` / `decided_at` | timestamptz | audit |

**`app_settings.hitl_config jsonb`** (à côté de `flux_config`/`channels_config`) :
```json
{ "rejectionMail": true, "acceptanceMail": true }
```

Côté front : store Zustand `pending-validations-store` + sync (calqué sur
`campaigns-store` / `campaigns-sync`).

## 6. Changements de flux

1. **Gating (`dispatchPostAnalysisOutreach`)** : découpler **composer** / **envoyer**.
   - Section ON → composer le brouillon (mail-composer) **sans envoyer** + insérer
     une `pending_validation`. Pour une acceptation, générer aussi les artefacts de
     la chaîne (invitation + brief) en draft, **sans envoyer**.
   - Section OFF → comportement actuel (composer + envoyer).
2. **Envoi (nouvelle route `/api/validations/[id]/send`)** : prend la ligne,
   envoie le(s) mail(s) ; pour un accept → invitation Cal.com + brief DRH ; acte
   **statut candidat + métriques + journal** ; `status = sent`.
3. **Switcher (`/api/validations/[id]/switch`)** : flip `decision`, régénère la
   chaîne inverse (drafts), reset `confirmed=false`, garde `status=pending`. La
   carte change de liste. **Décision (b)** : reste en file même si la section cible
   est OFF (une fois en mode HITL, tout sortant passe par la revue).
4. **Édition du mail** : « Vérifier le mail » ouvre l'éditeur du
   `mail_draft_artifact` ; l'édition **réécrit le draft** ; « Envoyer » envoie la
   version éditée.

## 7. Métriques & statut (le point sensible)

Sous HITL, un candidat scoré n'est **ni accepté ni refusé** tant que l'envoi n'a
pas eu lieu → **3ᵉ état « en attente de validation »**.
- La dérivation des métriques (`src/lib/dashboard/derive-metrics.ts`) ne doit
  compter accepté/refusé **qu'au moment de l'envoi** (nouvelle action journal, ex.
  `validation_sent` avec `decision`), pas à l'analyse.
- Le dashboard (funnel, shortlist) affiche les candidats HITL-pending comme
  **« à valider »**, pas dans accepté/refusé.

> **Précisé à l'implémentation (cf. §12.2)** : l'action réelle est
> `hitl_validation_sent` (pas `validation_sent`), le rapprochement se fait **par
> `uid`**, et un candidat en attente est **exclu** de la liste/du compteur (KPI
> « À valider » séparé) plutôt qu'affiché comme 3ᵉ état du funnel.

## 8. Settings

Section **« Validation humaine »** dans `/settings` : deux toggles
(*Mails de refus*, *Mails d'acceptation*), lus/écrits via `hitl_config`
(GET/PUT `/api/settings`). Défaut ON. Extensible (diffusion, shortlist plus tard).

## 9. Découpage en phases (incréments livrables) — ✅ TOUTES LIVRÉES

- **P1 — Données** ✅ : `migrate.sql` (table + `hitl_config`), types, repo, store + sync.
- **P2 — Settings** ✅ : `hitl_config` lecture/écriture + UI 2 toggles.
- **P3 — Gating** ✅ : split composer/envoyer dans `dispatchPostAnalysisOutreach` ;
  enqueue quand ON ; auto-send quand OFF (inchangé).
- **P4 — Page Validation suspendue** ✅ : 2 listes + carte + machine à 3 boutons.
- **P5 — Envoi** ✅ : route send + commit statut/métriques/journal + retrait de la file.
- **P6 — Switcher** ✅ : route PATCH + régénération chaîne inverse + migration de liste.
- **P7 — Métriques** ✅ : état « à valider » dans derive-metrics + dashboard.
- **P8 — Badge nav + E2E** ✅ : compteur + 5 scénarios bout-en-bout déterministes.

## 10. Tests

- Unit : repo `pending_validations`, store, `hitl_config` round-trip.
- Logic : gating (ON enqueue / OFF auto-send), switch (flip + régénération + liste),
  derive-metrics (pending non compté ; compté à l'envoi).
- E2E (store/route déterministe) : analyse → enqueue → Valider → Vérifier → Envoyer
  (compté) ; analyse → Switcher (migre + régénère) → Envoyer l'inverse ; toggle OFF
  → envoi auto inchangé.

## 11. Points ouverts (mineurs, à trancher au fil de l'eau)

- Historique des « traités » (hors MVP ?).
- Édition du mail : éditeur riche ou textarea simple (MVP = textarea).
- Cal.com au flip→accept : génère le lien d'invitation en draft, envoyé seulement à
  l'« Envoyer ».

---

## 12. Implémentation réelle — détails fonctionnels & écarts vs §1-11

Ce que le code fait réellement (cristallisé après tests donneur d'ordre). **À jour fait foi sur §3/§5/§7.**

### 12.1 Identité d'une candidature = PAR ANALYSE (`uid`), pas par candidat
- Chaque analyse de CV est un **traitement distinct**, clé par `uid` (= `taskId`
  généré côté client, journalisé en `imap_cv_analyzed.uid`). Le **même CV/email
  ré-analysé — même sur la même campagne — produit plusieurs entrées**, aucune
  fusion/dédup. (Une dédup par email avait cassé le cross-campagne → révoquée.)
- Le `uid` est propagé : analyse → `payload.uid` de la validation → préservé au
  Switcher → journalisé dans `hitl_validation_sent.uid`. **Tout le rapprochement
  métrique se fait par `uid`.** Cf. mémoire `project_candidate_identity_per_analysis`.

### 12.2 Métriques (§7 précisé) — exclusion, pas « 3ᵉ état » dans le funnel
- Action journal réelle = **`hitl_validation_sent`** (et non `validation_sent`).
- Une analyse **en attente** (uid ∈ `pendingUids`, construit depuis
  `pending_validations`) est **EXCLUE** de la liste candidats du dashboard ET du
  compteur « shortlisté/invité ». Elle ne vit que dans l'onglet « Validation
  suspendue » + un **KPI « À valider »** (profondeur de file). Ce n'est donc pas un
  3ᵉ état affiché dans le funnel, mais une **exclusion jusqu'à l'envoi**.
- À l'envoi, `hitl_validation_sent` **rattaché par `uid`** réintègre le candidat et
  **override l'issue de l'analyse** : un refus switché en accept envoyé compte
  « invité » (`recommendation:'go'`) ; un accept switché en refus → rejeté. Coût du
  mail comptabilisé via `COST_PER_ACTION['hitl_validation_sent']`.

### 12.3 « Envoyer » finalise TOUJOURS (mail best-effort)
- « Envoyer » = **la validation humaine de la décision**. La validation passe
  `status=sent` + journalise **quoi qu'il advienne du mail**. Si Resend n'est pas
  configuré (`skipped_no_config`) ou pas d'email candidat, la décision est quand
  même enregistrée (sinon HITL indémoable sans Resend). Seul un échec de la route
  de finalisation `/api/validations/[id]/send` bloque.

### 12.4 Switcher (non terminal)
- Flip `decision`, régénère le **brouillon de la décision inverse** (mail-composer
  `draft:true`, jamais d'envoi), `confirmed=false`, **préserve le payload (dont
  `uid`)**. La carte change de liste (remount via clé `${id}-${decision}`).
  Décision (b) : reste en file même si la section cible est OFF.

### 12.5 Repêchage (ajout non prévu au §1-11)
- Un candidat **sous le seuil** (`aboveThreshold=false`) qui reçoit un brief
  d'entretien = **repêché** par décision humaine. Le brief (template scheduler **et**
  questions LLM) ne le présente **plus jamais comme « écarté »** : la section
  « Verdict CV Analyzer » est remplacée par une note « Repêché par le recruteur ».
- **Anti-hallucination** durci sur la trame d'entretien : interdiction d'attribuer
  une expérience/domaine non écrit, questions de **vérification** jamais
  d'affirmation, aucune extrapolation par analogie.

### 12.6 Cartes de validation enrichies (au-delà du §4)
- Chaque carte affiche : **Poste**, **Score**, **Synthèse**, et liens **Rapport
  d'analyse** + **Fiche de poste** qui **s'ouvrent** dans un onglet (publicUrl,
  jamais de téléchargement). `reportArtifactId` est rattaché à la validation ; le Hub
  hydrate les artefacts par campagne pour résoudre les liens après reload.

### 12.7 Comportement OFF / offline (§8 précisé)
- `fetchHitlConfig` renvoie **OFF** si `/api/settings` est offline/échoue
  (garde-fou « ne pas perdre les mails ») → envoi auto. **Conséquence assumée** :
  si Supabase est intermittent au moment de l'analyse, la validation humaine peut
  être contournée silencieusement (cf. §13).

---

## 13. Revue de code — limites connues (juin 2026)

Revue adversariale post-livraison. Aucune n'est bloquante pour la démo mono-utilisateur,
mais à traiter avant un usage réel/multi-utilisateur. (Backlog.)

| # | Sévérité | Limite | Fichier |
|---|---|---|---|
| ~~L1~~ | ✅ **Corrigé** | Incohérence dashboard ON/OFF : la route `mail-composer` journalise désormais `imap_outreach_mail` (avec `uid`) pour l'envoi AUTO (ni draft, ni override HITL) → le candidat auto-envoyé avance « invité »/« rejeté » comme via HITL. | `api/mail-composer/route.ts`, `manager-flow.ts` |
| ~~L2~~ | ✅ **Corrigé** | `payload.uid` désormais **obligatoire** (zod) au POST `/api/validations` ; plus de faux uid fabriqué — un uid d'analyse manquant fait sauter le candidat (log) au lieu de casser le rapprochement. | `api/validations/route.ts`, `manager-flow.ts` |
| L3 | Robustesse | **Double-clic « Envoyer »** : l'idempotence ne couvre que la finalisation `/send` (court-circuit `status==='sent'`), **pas** l'envoi mail qui la précède → risque de 2 mails réels au candidat avant le 1ᵉʳ `/send`. Le `disabled={sending}` atténue sans garantir. | `send-validation.ts`, `ValidationsHub.tsx` |
| L4 | Edge | **Switch sans Cal.com** : si la régénération du brouillon inverse échoue (503), `mailSubject/Body` sont écrasés à `null` → carte « brouillon indisponible », édits éventuels perdus, cul-de-sac. | `send-validation.ts` (switchValidation) |
| L5 | Fragile | La détection **repêchage** repose sur `aboveThreshold`, jamais resynchronisé après switch. Correct aujourd'hui (couplage decision↔seuil à la création), à dériver explicitement si le couplage évolue. | `mail-composer-prompts.ts`, `scheduler/route.ts` |
| L6 | Mineur | Les **500** des routes validations renvoient `err.message` brut (noms de tables Supabase). À logger serveur + message générique. | `api/validations/*` |
| L7 | Mineur | Lien **FDP** = premier `kind==='fdp'` trouvé pour la campagne (pas de versionnage). | `ValidationsHub.tsx` |
