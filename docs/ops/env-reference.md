# Référence des variables d'environnement

> L'inventaire COMPLET des variables par déploiement est dans
> [configuration-client.md §1](configuration-client.md#1-secrets--infra--envlocal-par-déploiement) —
> une seule liste, pour qu'elles ne divergent pas. Cette page ne porte que la **portée**
> des variables dont la valeur dépend du TYPE d'instance.

| Variable | Portée | Valeur | Effet |
|---|---|---|---|
| `CRON_SECRET` | toutes les instances qui exposent un cron | chaîne aléatoire | Authentification fail-closed des routes de cron ; Vercel l'injecte lui-même (`Authorization: Bearer …`) |
| `CRON_ENABLED` | **instance client et démo** — **jamais la dev** | `1` exactement | Active les crons de `vercel.json` sur ce projet ; absente ou autre valeur ⇒ 200 `{ enabled: false }`, rien n'est lu. La dev partage sa base avec la démo et son minuteur local la relève déjà : un seul déclencheur par base |

Détail, vérification et runbook de migration : [configuration-client.md §1.1](configuration-client.md#11-relève-périodique--vercel-cron-depuis-le-27092026-remplace-cron-joborg).
