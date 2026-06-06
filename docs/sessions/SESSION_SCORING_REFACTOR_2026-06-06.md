# Note de session — Refactor scoring CV (C1→C6)

**Date** : 2026-06-06
**Branche** : `refactor/campaign-lifecycle` → PR #1
**Périmètre** : refactor du module de scoring CV (séparation extraction / scoring / narration).

---

## Contexte & objectif

Le scoring du CV reposait sur **un seul appel LLM** qui faisait tout (extraction +
calcul du score + rédaction). On l'inverse en trois phases, le **code** redevenant
le seul à calculer le score.

## Arc de la session (17 commits)

| Phase | Commit | Essence |
|---|---|---|
| C1 | `4dbf049` | Table de comportements (6 niveaux métier → 4 comportements), matrice de décision, types `ScoreResult` / `JobApplicationData` |
| C1′ | `b3ca631` | Amende C1 : modèle de statuts à **2 valeurs** (`accepted`/`rejected`) |
| gating | `b1257b1` | `out_of_campaign_task` → redirection polie (mode isolé désactivé v1) |
| C2 | `0adf825` | `scoreCandidat` **pur** + banque de fixtures + golden tests (tolérance 0) |
| C3 | `8617eaa` | `chatCompleteJson` déterministe (seed 42 / temp 0 / validation Zod / retry ×3) |
| C4 | `c3231f6` | Phase extraction : `JobApplicationData` + décisions par critère → `scoreCandidat` |
| C5 | `f9b83e2` | Phase narration **depuis** le `ScoreResult` (sans jamais altérer le score) |
| Z1/Z2 | `5707cfd` `89474ab` | Dette tsc démasquée (cache `.tsbuildinfo`) : `partialRecord` zod v4 + comparaisons mortes ; ajout `npm run typecheck` |
| 6a | `058b3e0` | Route → `analyzeCVApplication` + adapter transitoire |
| 6b | `65c68e5` | Rapport enrichi + bloc chat + poller IMAP sur `CVApplication` |
| 6c | `febfac5` | Convergence du seuil sur `campaign.threshold` + shortlist par statut + durcissement `resolveCandidateEmail` |
| 6c-mail | `e04ac44` | mail-composer + scheduler sur `MailCandidate`, suppression de l'adapter |
| 6d | `133a18b` | Suppression `executeCVAnalyzer` + prompts + `CVAnalysisResult` |
| 6e | `ed4a704` | Route reçoit `scoringSheet` direct, suppression `CVAnalysisCriteria` + câblage isolé |

## Décisions structurantes

- **6 niveaux métier conservés** (vocabulaire recruteur) → traduits en comportements
  techniques par une **table unique** `CRITICITY_TO_BEHAVIOR`
  (HARD_KNOCKOUT / HARD_CAP / SOFT_WEIGHTED / SIGNAL_BONUS).
- **Statuts à 2 valeurs** : un knockouté garde son **score réel** (audit/repêchage),
  seul le statut l'exclut.
- **Option B (formule)** : les critères **durs FILTRENT** et sortent de la moyenne
  pondérée ; les SOFT différencient. Pas de fusion conceptuelle.
- **Pureté des tests** : fixtures à décisions pré-extraites, `scoreCandidat` testé
  en **tolérance 0** ; jamais d'appel LLM dans un test de fonction pure.
- **Déterminisme localisé** dans `chatCompleteJson` (pas le défaut global, pour ne
  pas brider les agents créatifs).
- **Convergence du seuil** sur `campaign.threshold` (source unique, éditable
  dashboard, persistée via `campaigns-sync`).
- **Stratégie adapter-first** (Plan X) pour des commits indépendamment relisables ;
  adapter transitoire supprimé en fin de parcours.

---

## ✅ Checklist de revue (focus volet scoring)

**Invariants critiques**
- [ ] `scoreCandidat` est **pure** (`computedAt`/`criteriaVersion` injectés, pas
  d'horloge interne).
- [ ] La **narration n'altère jamais** `scoringResult` (test dédié).
- [ ] **Score réel conservé** en knockout ; dashboard shortliste par **statut**
  (`recommendation === 'go'`), pas par score brut.
- [ ] **Aucune sortie LLM non validée** n'entre dans le scoring (Zod + retry ×3 →
  `AIValidationError` → fallback `non_verifiable`/`llmFailure`).

**Formule (à confirmer côté métier)**
- [ ] Option B : HARD hors moyenne ; `PARTIAL_RATIO=0.5` ; cap = `seuil-1` ; bonus dormant.
- [ ] Décompo des écartés (sous le seuil / cap obligatoire / knockout) cohérente.

**Migration / cohérence**
- [ ] Plus aucune ref à `CVAnalysisResult` / `CVAnalysisCriteria` / `executeCVAnalyzer`
  / `freeText` ; adapter `toLegacyCVResult` supprimé.
- [ ] Route reçoit `scoringSheet` direct ; garde fiche obligatoire (422) OK.
- [ ] Interface étroite `MailCandidate` ; plus de « 0 an(s) » dans briefs/mails.
- [ ] Poller IMAP : comportement (a) sans fiche (reçu marqué `pendingScoringSheet`,
  non analysé).
- [ ] Mode tâche isolée : gating propre + câblage CV-isolé retiré.

**Qualité**
- [ ] `npm run typecheck` (non-incrémental) propre — ⚠️ le tsc incrémental masque
  des erreurs (cache `.tsbuildinfo`).
- [ ] 580 tests verts, eslint clean.

**⚠️ Points d'attention**
- La **vérif end-to-end en vrai (app lancée)** n'a **pas** été faite (tout en
  tests/mocks). Recommandé avant merge : uploader un CV sur une campagne avec fiche
  validée → vérifier rapport enrichi + shortlist dashboard + édition du seuil.
- Le pipeline complet (extraction LLM réelle + scoreur) n'a **pas** de golden ±2 —
  seul le scoreur pur est couvert. Les fixtures portent un `cvText` pour ce golden futur.
- Sans fiche validée, l'UX actuelle est une **erreur 422 générique**, pas le message
  propre « validez d'abord la fiche ».

---

## 🔜 Ce qui reste à faire

**Suite directe du refactor**
1. **C7 — critères versionnés + re-scoring à R4** (avec Session 5 dashboard).
2. **Golden de pipeline (C4 ±2)** : rejouer les `cvText` via extraction LLM
   (mockée/enregistrée) + scoreur. Resserrer la tolérance du scoreur pur à ±1.
3. **Vérification E2E réelle** du rapport + dashboard dans l'app lancée.
4. **Message Manager propre** « validez d'abord la fiche » (remplacer le 422 générique).

**Mode isolé (si réactivation)**
5. Reconstruire le câblage **analyse CV isolée** (supprimé en 6e), retirer le verrou
   `out_of_campaign_task` + `ISOLATED_TASK_ENABLED`.

**Polish / dette mineure**
6. Fraîcheur du seuil IMAP (débounce `campaigns-sync`).
7. `sheet.acceptanceThreshold` (fallback redondant avec `campaign.threshold`) à nettoyer.

**Dette préexistante (déjà au backlog)**
8. Convergence machine d'états, découpage `ManagerChat.tsx` (>2800 lignes).
9. Durcissement parsing PDF avant prod VPS (Session 8).
10. Délivrabilité email (DMARC), naming `imap_*` des actions journal.
