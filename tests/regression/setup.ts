/**
 * Setup GLOBAL de la suite de régression — exécuté avant CHAQUE fichier de
 * scénario (setupFiles vitest).
 *
 * 1. Charge .env.local (@next/env — même résolution que Next).
 * 2. GARDE-FOU PROJET : la suite écrit puis nettoie des données réelles — elle
 *    refuse de démarrer si `REGRESSION_PROJECT_REF` est absent de l'env OU ne
 *    correspond pas au ref du projet Supabase pointé par
 *    `NEXT_PUBLIC_SUPABASE_URL`. La prod n'a pas cette variable : impossible
 *    de la viser par accident.
 * 3. Mocks de FRONTIÈRE (vi.mock hoisté ici, appliqué à tous les fichiers) :
 *    - '@/lib/ai/provider'    → LLM à fixtures fixes (tests/regression/helpers/mocks)
 *    - '@/lib/ai/embeddings'  → vecteurs déterministes dérivés du texte
 *    - '@/lib/email/client'   → enregistreur d'envois (aucun vrai mail)
 *    Tout le reste (Supabase, repos, routes, scoring, pgvector) est RÉEL.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { vi } from 'vitest';

// Chargement MANUEL de .env.local : sous vitest NODE_ENV vaut 'test' et
// @next/env refuse .env.local en mode test (codé en dur, dev flag ignoré) —
// or c'est LÀ que vivent les creds dev et l'opt-in REGRESSION_PROJECT_REF.
// Les variables déjà présentes dans l'environnement gardent la priorité.
for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.trim();
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const allowedRef = process.env.REGRESSION_PROJECT_REF ?? '';
const actualRef = url ? new URL(url).hostname.split('.')[0] : '';

if (!allowedRef) {
  throw new Error(
    'Suite de régression REFUSÉE : REGRESSION_PROJECT_REF absent de .env.local. ' +
      'Ajoute REGRESSION_PROJECT_REF=<ref du projet Supabase DEV> pour autoriser ' +
      'explicitement cet environnement (jamais la prod).',
  );
}
if (!actualRef || actualRef !== allowedRef) {
  throw new Error(
    `Suite de régression REFUSÉE : le projet pointé (${actualRef || 'aucun'}) ` +
      `ne correspond pas à REGRESSION_PROJECT_REF (${allowedRef}).`,
  );
}

// ─── Mocks de frontière ────────────────────────────────────────────────────
// Les factories vi.mock ne peuvent référencer que des imports dynamiques :
// toute la logique vit dans helpers/mocks.ts (fixtures versionnées).

// `after()` de next/server exige un scope de requête Next — inexistant quand on
// invoque les handlers en-process. On l'exécute en microtâche (fire-and-forget,
// erreurs loguées) : les effets différés RÉELS des routes (drain C4, vivier,
// rapprochement from_vivier) tournent, les tests les attendent par POLLING.
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return {
    ...actual,
    after: (task: unknown) => {
      void Promise.resolve()
        .then(() => (typeof task === 'function' ? (task as () => unknown)() : task))
        .catch((err) => console.error('[regression] after() a échoué', err));
    },
  };
});

// Le scheduler IMAP se ré-arme en filet de sécurité dans plusieurs routes
// (metrics, mailboxes…) : hors de question que le VRAI poller tourne pendant
// la suite (il traiterait les boîtes réelles de la base dev). No-op.
vi.mock('@/lib/imap/scheduler', async () => {
  const actual = await vi.importActual<typeof import('@/lib/imap/scheduler')>(
    '@/lib/imap/scheduler',
  );
  return { ...actual, ensureSchedulerStarted: () => {} };
});

// Session auth : `cookies()` n'existe pas hors scope de requête Next. L'auth
// n'est pas l'objet de la suite (MVP mono-utilisateur) → utilisateur null,
// même comportement qu'une session anonyme.
vi.mock('@/lib/auth/require-api-user', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/auth/require-api-user')
  >('@/lib/auth/require-api-user');
  return { ...actual, getApiUser: async () => null };
});

vi.mock('@/lib/ai/provider', async () => {
  const { buildProviderMock } = await import('./helpers/mocks');
  const actual = await vi.importActual<typeof import('@/lib/ai/provider')>(
    '@/lib/ai/provider',
  );
  return buildProviderMock(actual);
});

vi.mock('@/lib/ai/embeddings', async () => {
  const { buildEmbeddingsMock } = await import('./helpers/mocks');
  const actual = await vi.importActual<typeof import('@/lib/ai/embeddings')>(
    '@/lib/ai/embeddings',
  );
  return buildEmbeddingsMock(actual);
});

vi.mock('@/lib/email/client', async () => {
  const { buildEmailClientMock } = await import('./helpers/mocks');
  const actual = await vi.importActual<typeof import('@/lib/email/client')>(
    '@/lib/email/client',
  );
  return buildEmailClientMock(actual);
});
