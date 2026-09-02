/**
 * Accès base DIRECT pour la suite de régression : assertions d'état final et
 * nettoyage. Les PARCOURS passent par les routes API ; ce module ne sert qu'à
 * VÉRIFIER ce que la base contient et à revenir à l'état initial.
 *
 * Toutes les données de test sont MARQUÉES :
 *   - campagnes  : id préfixé `CAMP-TREG-`
 *   - candidats  : email en `@test.local`
 *   - boîtes mail: adresse en `@test.local`
 * → `cleanAll()` supprime PAR MARQUEURS (requêtes, pas mémoire de run) : le
 * clean est idempotent et fonctionne même après un crash au milieu d'un test.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const TEST_CAMPAIGN_PREFIX = 'CAMP-TREG-';
export const TEST_EMAIL_DOMAIN = 'test.local';

let client: SupabaseClient | null = null;

/** Client service-role direct (assertions + clean). Jamais pour les parcours. */
export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase non configuré (.env.local)');
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

/** Id de campagne de test unique (marqué + anti-collision entre runs). */
export function newTestCampaignId(slug: string): string {
  return `${TEST_CAMPAIGN_PREFIX}${slug}-${Math.random().toString(36).slice(2, 8)}`;
}

type DelFilter =
  | { col: string; in: string[] }
  | { col: string; like: string };

/**
 * Codes d'une TABLE absente : migration pas encore passée sur cet
 * environnement. C'est le seul cas tolérable.
 *   42P01 = undefined_table · PGRST205 = table introuvable au cache PostgREST
 */
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205']);

/**
 * DELETE filtré, tolérant à une TABLE absente uniquement.
 *
 * ⚠️ La tolérance portait avant sur le message (`/does not exist/`), donc elle
 * avalait aussi « column x.y does not exist » — une COLONNE mal nommée dans le
 * nettoyage passait pour un environnement en retard. Conséquence réelle :
 * `mailboxes.email` (la colonne s'appelle `user_email`) n'a jamais rien
 * supprimé, et 30 boîtes de test se sont accumulées sur l'environnement de dev
 * entre le 26/07 et le 17/08/2026, sans qu'aucun run ne le signale.
 * Un nom de colonne faux est une faute du nettoyage : il doit ÉCHOUER.
 */
async function del(table: string, filter: DelFilter): Promise<void> {
  const base = db().from(table).delete();
  const q =
    'in' in filter ? base.in(filter.col, filter.in) : base.like(filter.col, filter.like);
  const { error } = await q;
  if (!error) return;
  if (MISSING_TABLE_CODES.has(error.code)) return;
  throw new Error(`clean ${table}.${filter.col}: ${error.message}`);
}

/**
 * Supprime TOUTES les données marquées de test, dans l'ordre FK-safe.
 * Appelé en beforeAll (pré-clean : un run précédent a pu crasher) ET en
 * afterAll de chaque scénario.
 */
export async function cleanAll(): Promise<void> {
  const supabase = db();

  // Ids des campagnes de test (pivot de la plupart des suppressions).
  const { data: camps } = await supabase
    .from('campaigns')
    .select('id')
    .like('id', `${TEST_CAMPAIGN_PREFIX}%`);
  const campIds = (camps ?? []).map((c) => c.id as string);

  // Candidats vivier de test (pivot des tables d'embeddings).
  const { data: vcands } = await supabase
    .from('vivier_candidates')
    .select('id')
    .like('email', `%@${TEST_EMAIL_DOMAIN}`);
  const vivierIds = (vcands ?? []).map((c) => c.id as string);

  if (vivierIds.length > 0) {
    for (const table of [
      'vivier_skill_embeddings',
      'vivier_anchor_embeddings',
      'vivier_embeddings',
      'vivier_preselections',
    ]) {
      await del(table, { col: 'candidate_id', in: vivierIds });
    }
    await del('vivier_candidates', { col: 'id', in: vivierIds });
  }

  if (campIds.length > 0) {
    for (const table of [
      'pending_validations',
      'interview_briefs',
      'candidate_analyses',
      'journal',
      'artifacts_meta',
      'vivier_preselections',
      'fdps_archived',
      'imap_unmatched_cvs',
    ]) {
      await del(table, { col: 'campaign_id', in: campIds });
    }
  }

  // Filets par email marqué (données créées hors campagne de test).
  await del('candidate_analyses', {
    col: 'candidate_email',
    like: `%@${TEST_EMAIL_DOMAIN}`,
  });
  await del('pending_validations', {
    col: 'candidate_email',
    like: `%@${TEST_EMAIL_DOMAIN}`,
  });
  // Les BRIEFINGS aussi, et pas seulement par campagne : le filtre par
  // campagne ne voit que les campagnes ENCORE présentes, donc un briefing dont
  // la campagne a déjà été supprimée devient inatteignable et survit à tous les
  // nettoyages suivants. Conséquence observée le 02/09/2026 : S17 réutilise un
  // `booking_uid` fixe (`cal-s17-booking`) et l'index unique le refusait
  // — un scénario juste qui échouait sur un résidu de la veille.
  await del('interview_briefs', {
    col: 'candidate_email',
    like: `%@${TEST_EMAIL_DOMAIN}`,
  });

  // Boîtes mail de test. La colonne est `user_email` — pas `email` (les
  // associations `campaign_mailboxes` partent en cascade).
  await del('mailboxes', { col: 'user_email', like: `%@${TEST_EMAIL_DOMAIN}` });

  // Claims d'envoi des tests (pseudo-mailboxes hitl/dismissal) — sans ce
  // nettoyage, un run suivant verrait « duplicate » et n'enverrait plus.
  await del('imap_outreach_claims', { col: 'uid', like: 'treg_%' });
  await del('imap_outreach_claims', { col: 'uid', like: 'val_treg_%' });

  // Les campagnes en dernier (cibles des FK).
  if (campIds.length > 0) {
    await del('campaigns', { col: 'id', in: campIds });
  }
}

/** Lit une ligne unique (assertion d'état final). Échoue si absente. */
export async function readRow<T = Record<string, unknown>>(
  table: string,
  id: string,
): Promise<T> {
  const { data, error } = await db().from(table).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`readRow ${table}/${id}: ${error.message}`);
  if (!data) throw new Error(`readRow ${table}/${id}: ligne absente`);
  return data as T;
}

/** Lignes filtrées (assertions). */
export async function readRows<T = Record<string, unknown>>(
  table: string,
  match: Record<string, unknown>,
): Promise<T[]> {
  let q = db().from(table).select('*');
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v as never);
  const { data, error } = await q;
  if (error) throw new Error(`readRows ${table}: ${error.message}`);
  return (data ?? []) as T[];
}
