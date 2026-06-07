# Ops — exploitation & déploiement

Documentation opérationnelle du prototype Virtual Enterprise (QWESTINUM).

- **[configuration-client.md](configuration-client.md)** — inventaire exhaustif de
  tout ce qui se configure par client (secrets/env, réglages applicatifs, boîtes
  IMAP, réglages par campagne). Sert de fiche d'onboarding client.
- **[deploiement-client.md](deploiement-client.md)** — modèle d'isolation
  (**Voie A** : une instance par client) + runbook de provisioning + plan de
  **déploiement réel en production** (avec les points durs à régler avant).

## Rappel d'architecture (état actuel)

- **Mono-tenant.** Aucune colonne `user_id`, aucune RLS, aucun cloisonnement par
  utilisateur dans le schéma (`scripts/migrate.sql`). Le serveur accède à Supabase
  avec la `service_role_key` (qui bypasse la RLS) et les requêtes ne filtrent pas
  par utilisateur. → **Tous les comptes d'une même instance partagent les mêmes
  données.** L'isolation par client passe donc par **une instance par client**
  (Voie A), pas par un cloisonnement applicatif (= Voie B, multi-tenant, non
  implémenté — cf. backlog).
- **Auth = simple portier.** Le middleware (`src/proxy.ts`) protège `/app`, `/rh`,
  `/settings` et redirige vers `/login`. Pas de liste blanche → **désactiver
  l'inscription publique** côté Supabase Auth.
- **Mode dégradé.** Sans variables Supabase, l'app tourne en mémoire volatile (pas
  de persistance) sans planter. À proscrire en prod.
