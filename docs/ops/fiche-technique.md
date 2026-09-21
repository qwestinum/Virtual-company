# ORQA — fiche technique

> Une page, pour répondre à « c'est fait avec quoi, ça tourne où, et qu'est-ce qui sort
> de chez nous ». Destinée à un DSI ou un DPO client. Mise à jour : 21/09/2026.

---

## 1. Ce que c'est

Une application web de recrutement où des agents IA exécutent les tâches d'une équipe RH
— rédiger une fiche de poste, noter des CV, proposer des créneaux, rédiger un refus — et
où **l'humain décide**. Le produit n'envoie jamais un refus de lui-même : il le propose et
attend une validation.

**Cinq entrées** : *Aujourd'hui* (ce qui attend une action), *Campagnes*, *Candidatures*,
*Entretiens*, *Pilotage* (rapports). Chacune a son adresse : on la met en favori, on la
partage, le bouton Précédent fonctionne.

---

## 2. Pile technique

| Couche | Choix |
|---|---|
| Framework | Next.js 16 (App Router), TypeScript strict |
| Interface | React, Tailwind CSS |
| État client | Zustand |
| Base de données | **Supabase** (PostgreSQL + pgvector + Storage + Auth), région **Paris** |
| Modèles de langage | OpenAI (GPT-4o) — tout appel passe par `src/lib/ai/provider.ts` |
| Recherche sémantique | pgvector (vivier de candidats) |
| Envoi d'email | Resend |
| Réception d'email | IMAP, relève périodique |
| Réservation d'entretien | **Module natif** (`src/lib/scheduling/`), Cal.com en extinction |
| Hébergement | Vercel, fonctions en région **`cdg1` (Paris)** |

---

## 3. Où vivent les données

**Tout le métier est dans la base Supabase du client** — une instance par client, aucune
mutualisation. Candidatures, CV, journaux, campagnes, agendas : rien n'est partagé entre
clients.

**Ce qui sort de l'instance**, et seulement ça :

| Destinataire | Ce qui part | Pourquoi |
|---|---|---|
| Fournisseur de modèle | le texte des CV, des documents déposés, et — si l'option est activée — des transcriptions d'entretien | l'analyse et la rédaction |
| Resend | les mails envoyés aux candidats et aux recruteurs | la remise du courrier |
| Serveur IMAP du client | rien (lecture seule des messages reçus) | la réception des CV |

> ⚠️ **Régions.** Les fonctions Vercel sont épinglées en `cdg1` (Paris) : la région par
> défaut de Vercel est Washington, et y laisser tourner le traitement de CV serait un
> transfert hors UE. Vérification : le 2ᵉ segment de l'en-tête `x-vercel-id` doit être
> `cdg1`, sur dev, démo **et** prod.

---

## 4. Ce qui est conservé, et combien de temps

| Donnée | Conservation |
|---|---|
| CV et candidatures | jusqu'à effacement demandé (procédure `docs/ops/purge-rgpd-candidat.md`) |
| Journal d'activité | conservé, **pseudonymisé** à l'effacement (l'événement et sa date restent : ils prouvent l'effacement) |
| Analyses de CV | **vidées**, pas supprimées (squelette date/campagne/note conservé — supprimer ferait bouger des bilans déjà transmis) |
| Transcriptions d'entretien | **aucune conservation.** Lues en mémoire, abandonnées après usage, y compris en cas d'échec |
| Profils sourcés | supprimés à la clôture de la campagne |

---

## 5. Sécurité et accès

- Authentification Supabase, **inscription publique désactivée** : les comptes sont créés
  par l'administrateur.
- **Deux rôles** : `admin` et `member`. Le rôle est lu en base (`recruiters.role`), pas
  dans le jeton — un jeton ne peut pas se promouvoir.
- Les routes techniques (relève IMAP, métriques, référentiel des recruteurs) sont
  réservées aux administrateurs ; `/admin` est gardé par le proxy, en **fail-closed**.
- Le cron de relève exige un secret (`CRON_SECRET`), comparé en temps constant, **sans
  lequel la relève s'arrête** — on préfère une relève à l'arrêt à une porte ouverte.
- Les mots de passe IMAP sont **chiffrés en base** (`MAILBOX_ENCRYPTION_KEY`), jamais en
  clair.
- Les pages publiques de réservation (`/r/`, `/b/`) et de sourcing (`/s/`) sont
  authentifiées **par le jeton de l'URL** (128 bits, usage unique, expirable, révocable) :
  l'invité n'a pas de compte. Elles sont servies en `noindex` / `no-store` /
  `no-referrer` — le jeton est dans l'URL et ne doit pas partir dans un `Referer`.

---

## 6. Multi-utilisateur

Espace **commun** (campagnes, candidatures, vivier, compteurs : aucun cloisonnement, choix
assumé), **individuels** : l'agenda, l'identité dans les actions tracées, l'accès admin.

Le **filtre « Référent »** (présent sur les cinq entrées, au même endroit) réduit ce qui
s'affiche ; il **ne restreint aucun accès**. Les compteurs écrivent « n sur N » pour qu'un
dossier masqué reste compté, et les alertes ne sont jamais filtrées.

---

## 7. Qualité

| Suite | Ce qu'elle prouve | Lancement |
|---|---|---|
| Tests unitaires | la logique pure (~2 950 tests) | `npm test` |
| Régression | les routes réelles, bout en bout, LLM et email bouchonnés (S1–S25) | `npm run test:regression` (application **fermée**) |
| **Tests de clic** | qu'un bouton, une porte, un lien font ce qu'ils annoncent, dans un vrai navigateur (S29–S35) | `npm run test:e2e` (application **ouverte**) |

> Règle du chantier : **une action d'interface n'est livrée que si un test l'a cliquée.**
> Les tests de logique lisent une valeur ; ils ne voient pas ce que le navigateur en fait.

---

## 8. Documents liés

- Configuration d'un client : `docs/ops/configuration-client.md`
- Déploiement : `docs/ops/deploiement-client.md`
- Effacement RGPD d'un candidat : `docs/ops/purge-rgpd-candidat.md`
- Multi-utilisateur et agendas : `docs/ops/multi-utilisateur.md`
- Lexique de l'interface : `docs/ux/lexique.md`
- Spécification fonctionnelle : `docs/specs/entreprise-virtuelle-rh.md`
