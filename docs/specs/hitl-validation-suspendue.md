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

## 8. Settings

Section **« Validation humaine »** dans `/settings` : deux toggles
(*Mails de refus*, *Mails d'acceptation*), lus/écrits via `hitl_config`
(GET/PUT `/api/settings`). Défaut ON. Extensible (diffusion, shortlist plus tard).

## 9. Découpage en phases (incréments livrables)

- **P1 — Données** : `migrate.sql` (table + `hitl_config`), types, repo, store + sync.
- **P2 — Settings** : `hitl_config` lecture/écriture + UI 2 toggles.
- **P3 — Gating** : split composer/envoyer dans `dispatchPostAnalysisOutreach` ;
  enqueue quand ON ; auto-send quand OFF (inchangé).
- **P4 — Page Validation suspendue** : 2 listes + carte + machine à 3 boutons (sans
  l'envoi réel d'abord : Valider→déverrouille, Vérifier le mail = aperçu).
- **P5 — Envoi** : route send + commit statut/métriques/journal + retrait de la file.
- **P6 — Switcher** : route switch + régénération chaîne inverse + migration de liste.
- **P7 — Métriques** : état « à valider » dans derive-metrics + dashboard.
- **P8 — Badge nav + E2E** : compteur + scénarios bout-en-bout.

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
