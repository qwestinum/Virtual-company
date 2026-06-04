# Backlog — dette technique & améliorations différées

Items identifiés hors périmètre de la session courante, à traiter plus tard.
Format : titre, contexte, risque, piste de résolution.

---

## Robustesse du parsing PDF (extraction CV) — à durcir avant prod VPS

**Statut** : fonctionnel, mais repose sur des hypothèses fragiles.
**Échéance cible** : avant le déploiement VPS Hostinger (Session 8).
**Code concerné** : `src/lib/agents/cv-extract.ts`, `next.config.ts`.

### Contexte

L'extraction de texte des CV PDF passe par `pdf-parse@2` → `pdfjs-dist@5`, qui
exige les globals navigateur `DOMMatrix` / `ImageData` / `Path2D`. On les
polyfille manuellement depuis `@napi-rs/canvas` (binaire natif) **avant** de
charger `pdf-parse`, parce que l'auto-polyfill de pdfjs
(`require("@napi-rs/canvas")` via `createRequire(import.meta.url)`) ne survit
pas à l'encapsulation « external module » de Next en build de production.

La solution actuelle marche (vérifiée en `next build && next start` : HTTP 200)
et **dégrade proprement** (message métier `pdf_engine_unavailable` si le moteur
est indisponible, pas de crash ni de fuite technique dans le chat).

### Fragilités résiduelles (par ordre d'importance)

1. **Binaire natif `@napi-rs/canvas` spécifique plateforme.** OK sur
   linux x64 glibc (binaire installé : `canvas-linux-x64-gnu`). Casse
   silencieusement si la cible est **Alpine/musl** ou **arm64**, ou si le
   déploiement fait `npm ci --omit=optional`, ou build sur une machine ≠
   exécution (Docker multi-stage). → PDF KO en prod (mais message dégradé).
   **À valider au premier déploiement VPS.**

2. **Liste de globals codée en dur** (`DOMMatrix/ImageData/Path2D`). Si une
   future version de pdfjs réclame un 4ᵉ global, la précondition passe mais le
   parsing lève un `ReferenceError` que le filet `isMissingPdfGlobalError` ne
   reconnaît pas → fuite technique dans le chat. Couplage de version implicite.

3. **Chemin du worker pdfjs en dur** (`process.cwd()/node_modules/pdfjs-dist/
   legacy/build/pdf.worker.mjs`). Suppose un `node_modules` classique sur
   disque. Casse potentiellement si on passe à `output: 'standalone'`
   (recommandé pour un VPS — pruning de `node_modules`).

### Pistes de résolution

- **Durcissements cheap (~15 min)** sans changer d'archi :
  - Élargir `isMissingPdfGlobalError` pour attraper tout `… is not defined`
    lié au moteur PDF (couvre #2).
  - Logguer un warning serveur explicite quand `@napi-rs/canvas` ne se charge
    pas (« binaire PDF manquant pour cette plateforme ») → diagnostic #1 immédiat.

- **Solution robuste définitive (~1 h)** : migrer vers **`unpdf`** (wrapper
  pdfjs conçu pour serverless/Node, sans canvas ni binaire natif). Élimine #1,
  #2 et #3 d'un coup. API d'extraction texte simple.

**Recommandation** : garder l'actuel pour le prototype ; faire les durcissements
cheap OU migrer vers `unpdf` avant la mise en prod VPS (Session 8).
