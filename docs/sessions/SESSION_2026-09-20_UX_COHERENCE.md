# Compte rendu — 20/09/2026 : audit UX, maquette de refonte, cohérence de la file HITL

**Branche** : `fix/validations-orphelines` — **7 commits, RIEN n'est poussé** (le DO pousse).
**Vert au moment d'écrire** : `npm run typecheck` propre · **2 707 tests unitaires** ·
**régression S1→S25 232/232, serveur de dev EN MARCHE** · aucune erreur de lint ajoutée
(8 erreurs préexistantes, aucune dans les fichiers touchés).

Deux chantiers sans rapport apparent, menés dans l'ordre demandé. Le second a commencé par une
vérification de l'audit et s'est terminé sur un défaut de production.

---

## 1. Audit UX et maquettes de refonte — ÉTUDE, aucun code

Trois documents, dans `docs/ux/` :

| Document | Ce que c'est |
|---|---|
| `audit-ux-2026-09-20.md` | L'audit par les normes (Nielsen ×10 par écran, densité, WCAG). **Mesuré sur le rendu réel**, pas lu dans le code. |
| `maquette-structure-2026-09-20.md` | v1 — 4 modules. **Supersédée**, conservée pour la trace du raisonnement. |
| `maquette-structure-v2-2026-09-20.md` | **v2 — LA référence de la refonte.** 5 entrées, périmètre réduit, Candidatures et Entretiens conservés. |
| `captures/` | 29 captures du rendu réel (1440/1280/1024). Non commitées. |

Méthode : serveur dev + Chromium piloté, session par lien magique, **aucune écriture**.
Contrastes, tailles de cibles, densité et niveaux typographiques calculés sur le **DOM rendu**.

### Ce que l'audit a établi (les 3 chiffres à retenir)

- **22 à 25 niveaux typographiques distincts sur UN écran** (cible : 3), 5 familles de polices
  simultanées, 27 tailles arbitraires `text-[Npx]` dont des demi-pixels, 52 valeurs de `padding`
  inline, **0 jeton d'espacement**.
- **5 pastilles de statut sur 7 échouent au contraste AA** — et le fichier qui les définit
  contient **déjà** la palette conforme, jamais importée (`STAGE_TONE_*`).
- **Aucune URL dans le produit** : les 8 onglets et tous les sous-onglets sont dans un `useState`.
  Pas de favori, pas de bouton Précédent, rien où pointer. C'est ce qui rend la refonte
  structurante plutôt que cosmétique.

### Le défaut n°1, expliqué mécaniquement

La création de campagne ne dit jamais ce qu'elle attend (8 champs `required` en interne, **0
marqué**), le mot « Enregistrer » ment (il ne persiste rien), et le blocage n'apparaît qu'**après**
la création, dans un vocabulaire absent du formulaire (« les sources de réception » ≠ « Flux de
réception »). §1.1 de l'audit.

---

## 2. Cohérence file HITL ↔ analyse — CODE

Parti d'une vérification de l'audit (« la puce *À valider* compte 14, la file 2 »), terminé sur
un défaut de production. Deux sens d'une même divergence, un mois d'écart.

Modèle de référence : **`docs/specs/hitl-3-zones.md` §6bis**.
Diagnostics : `docs/ops/diagnostic-validations-orphelines-2026-09-20.md` (sens A),
`docs/ops/plan-coherence-file-analyse-2026-09-20.md` (sens B + plan), et
`docs/ops/diagnostic-s20-4-2026-09-20.md` (le sourcing, ci-dessous).

### Ce qui a été livré

| Lot | Contenu |
|---|---|
| **A** (sens A) | Écrivain unique d'OUVERTURE, identifiant déterministe, 3 chemins fermés (chat fire-and-forget, re-scoring entrant, purge RGPD), réparation à l'écran, signal |
| **0** (contenir) | Fiche **désarmée** quand le dossier n'attend plus — jamais masquée. **Les 2 fiches de production ont été closes** (constat puis exécution bornée, analyses intactes, zéro envoi). |
| **1-3** | Écrivain unique de CLÔTURE, branche symétrique du re-scoring, correction de décision, invariant **bidirectionnel** en un seul endroit, identifiant dérivé par la route, garde structurelle sondée |

### Les trois règles à ne pas éroder

1. **Le doute ne conclut JAMAIS.** Analyse introuvable ou zone absente ⇒ `unknown` : la carte
   garde son arbitrage, le signal ne compte aucun écart.
2. **Un seul prédicat pour les deux sens.** En écrire un par direction re-fabrique la divergence
   — c'est arrivé au premier signal, qui a laissé le défaut de prod vivre un mois.
3. **Clore n'est pas refuser.** Aucun mail, verdict/zone/`decided_by` intacts.

### Un défaut du sourcing trouvé au passage, NON corrigé

`docs/ops/diagnostic-s20-4-2026-09-20.md` §2. `admitSourcedCandidate` traite **quatre** causes de
refus de la même façon, dont **deux transitoires** (fiche de scoring non validée, aucun agenda
réservable) : `releaseSubmission` met `submission` à `null` — **la saisie du candidat ET le
pointeur de son CV**. Le candidat qui rouvre son lien retrouve un formulaire vierge, après avoir
lu « votre candidature est bien reçue ».

**Le même produit fait l'inverse sur l'autre porte** : « fiche de scoring non validée ≠ CV perdu »
(audit C4) — reçu par mail, le CV est stocké, mis en file et rejoué. **C'est un arbitrage métier,
il est posé, il n'est pas tranché.**

---

## 3. Ce qui reste ouvert (par ordre de conséquence)

| # | Question | Pourquoi ça ne se décide pas seul |
|---|---|---|
| **S1** | **Le sourcing détruit la saisie d'un candidat sur une cause transitoire.** Corriger = `deferred` au lieu de `closed`, avec une issue signalée après N tentatives. | Arbitrage métier, et il touche une personne réelle |
| **S2** | **Asma Zghonda** (CAMP-2026-288, active) est comptée « Invité » et **n'a été contactée par personne depuis le 21/08**. Clore sa fiche ne la contacte pas. | Décision de recrutement |
| **S3** | **Kevin NGUYEN** a reçu un vrai refus en juillet et s'affiche « Invité ». « Corriger la décision » existe pour ça. | Décision de recrutement |
| **S4** | Personne ne remonte **la liste des dossiers promus par un re-scoring**. Requête en lecture seule, prête à écrire. | Le script n'envoie rien par garantie assumée — mais personne ne reprend le fil |
| **S5** | Statut de clôture : `void` retenu (définition adéquate, pas de migration). Un statut dédié rendrait le motif requêtable sans lire le journal. | Migration + CHECK |

---

## 4. Deux choses apprises, à ne pas réapprendre

**`npm run test:regression` et le serveur de dev partagent la base.** Le rail de maintenance
sourcing du serveur ramassait la fixture de S20.4 et relâchait sa saisie. Corrigé **dans la
fixture** (`admission_attempts: 3` la place dans sa fenêtre de reprise de 15 min) et **pas** par
une exclusion du préfixe de test dans le produit — S23 a BESOIN que le rail traite ses campagnes
de test. Toute fixture posée dans un état que le rail traite doit se protéger elle-même.

**Une fixture qui invente un identifiant teste un état que la production ne peut plus produire.**
14 scénarios sont tombés pour cette seule raison au fil des lots. Ce n'est pas un contournement
de les aligner : ces suites créaient **déjà** deux fiches par dossier.
