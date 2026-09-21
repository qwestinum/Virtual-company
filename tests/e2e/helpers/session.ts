/**
 * Identité d'essai de la suite E2E — créée, utilisée, supprimée.
 *
 * On NE réutilise JAMAIS un compte réel : un mot de passe de recruteur n'a rien
 * à faire dans un fichier de test, et un test qui se connecte sous l'identité
 * du DRH pollue les traces d'audit avec des gestes que personne n'a faits.
 *
 * Le compte est créé par l'API d'administration Supabase (aucun mail envoyé),
 * inscrit dans `recruiters` (l'application lit le rôle LÀ, pas dans le jeton),
 * puis effacé en fin de fichier. Adresse en `@orqa-e2e.invalid` : le TLD
 * `.invalid` est réservé par la RFC 2606 — il ne peut appartenir à personne, et
 * un mail qui partirait par erreur ne trouverait aucun destinataire.
 */
import { randomBytes, randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type TestRecruiter = { id: string; email: string; password: string };

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Suite E2E : NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants.');
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function createTestRecruiter(): Promise<TestRecruiter> {
  const db = adminClient();
  const email = `e2e-${randomUUID().slice(0, 8)}@orqa-e2e.invalid`;
  const password = randomBytes(18).toString('base64url');

  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Suite E2E : création du compte d'essai impossible — ${error?.message}`);
  }

  // Rôle admin : la suite ouvre des écrans dont certaines routes techniques
  // sont réservées aux administrateurs. Un `member` ferait échouer des lectures
  // sans rapport avec ce qu'on teste.
  const { error: rowError } = await db.from('recruiters').insert({
    id: data.user.id,
    display_name: 'Test E2E',
    email,
    role: 'admin',
    is_active: true,
  });
  if (rowError) {
    await db.auth.admin.deleteUser(data.user.id).catch(() => {});
    throw new Error(`Suite E2E : inscription dans recruiters impossible — ${rowError.message}`);
  }

  return { id: data.user.id, email, password };
}

/** Ne lève jamais : un nettoyage qui échoue ne doit pas masquer le verdict. */
export async function deleteTestRecruiter(recruiter: TestRecruiter): Promise<void> {
  try {
    const db = adminClient();
    await db.from('recruiters').delete().eq('id', recruiter.id);
    await db.auth.admin.deleteUser(recruiter.id);
  } catch (err) {
    console.warn('[e2e] nettoyage du compte d’essai incomplet :', err);
  }
}
