# Import en masse de CV dans le vivier — REMPLACÉ

> **Depuis le 29/09/2026, cette procédure n'existe plus.** L'ancien script
> `npm run import:vivier` (`scripts/import-vivier.ts`) a été retiré et remplacé
> par **`npm run vivier:import`** — procédure : **`docs/ops/configuration-client.md` §5**.

Ce que le nouveau script garde de l'ancien : le pipeline d'indexation de
l'application (réutilisé, jamais dupliqué), le « réussi » honnête (embedding du
titre vérifié en base, dans le bon espace), le contrôle préalable de l'espace
d'embedding, l'absorption des limites de débit (429), la confirmation du projet
visé.

Ce qui change, et pourquoi :

| Avant | Maintenant |
|---|---|
| `.env.local` implicite, swap de fichiers pour viser un client | `--env=<fichier>` **obligatoire**, sans repli |
| Confirmation tapée au clavier | `--execute --confirm-project=<ref>` ; sans eux, **constat** seulement |
| Dry-run qui appelait le modèle | Constat **gratuit** (aucun appel), coût estimé |
| Dédoublonnage par adresse seule | **Empreinte du texte**, puis adresse — sans appel au modèle pour un doublon |
| Un dossier existant non indexé était réindexé | Il est **listé** comme doublon ; l'import ne touche aucun dossier existant (`reindex:vivier` s'en charge) |
| `source = manual_upload` | `source = import` + provenance + date de référence de rétention |
| Journal JSON local dans le dossier de CV (adresses en clair) | Reprise par l'empreinte **en base** ; détail local dans `tmp/vivier-import/` |
| Dossier uniquement | Dossier et/ou archives `.zip` |

Des fichiers `.import-vivier-journal*.json` peuvent encore traîner dans des
dossiers de CV importés avec l'ancien script : ils contiennent des adresses de
candidats, à supprimer.
