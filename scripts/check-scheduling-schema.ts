/**
 * Vérifie que le schéma du module de réservation est bien en place sur
 * l'environnement pointé par `.env.local` — tables ET fonction de débit.
 *
 * Pourquoi un script plutôt qu'un coup d'œil au dashboard : une requête
 * `select(head: true)` ne remonte PAS l'absence d'une table, et une migration
 * appliquée mais dont le cache PostgREST n'a pas été rechargé se comporte
 * exactement comme une migration oubliée. Le contrôle porte donc un vrai
 * SELECT, et une table TÉMOIN inexistante : si elle passe pour « OK », c'est
 * la méthode de détection qui est en cause, pas le schéma.
 *
 *   npm run check:scheduling
 */
import { loadEnvConfig } from '@next/env';
import { createClient } from '@supabase/supabase-js';

loadEnvConfig(process.cwd());

const TABLES = [
  // Témoin : cette table n'existe pas. Si elle rend « OK », la méthode de
  // détection est en cause, pas le schéma.
  'sched_table_qui_nexiste_pas',
  'sched_resources',
  'sched_availability_rules',
  'sched_availability_exceptions',
  'sched_targets',
  'sched_booking_links',
  'sched_bookings',
  'sched_events',
  'sched_rate_limits',
  // Lot 3 — intégration ORQA (idempotence de la consommation d'événements).
  'interview_booking_events',
];

/**
 * Colonnes ajoutées par le lot 3. Une table présente mais sans sa colonne, ou
 * une colonne posée sans rechargement du cache PostgREST, produit exactement
 * le même symptôme qu'une migration oubliée — d'où le contrôle explicite.
 */
const COLUMNS: { table: string; column: string }[] = [
  { table: 'campaigns', column: 'scheduling_native' },
  { table: 'app_settings', column: 'branding_config' },
];

async function main(): Promise<void> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    { auth: { persistSession: false } },
  );
  let missing = 0;
  for (const table of TABLES) {
    // `head: true` ne remonte PAS l'absence de table : il faut un vrai SELECT.
    const { error } = await client.from(table).select('*').limit(1);
    const expected = table.includes('nexiste_pas');
    if (error && !expected) missing += 1;
    console.log(table.padEnd(34), error ? `ABSENTE — ${error.message.slice(0, 60)}` : 'OK');
  }

  for (const { table, column } of COLUMNS) {
    const { error } = await client.from(table).select(column).limit(1);
    if (error) missing += 1;
    console.log(
      `${table}.${column}`.padEnd(34),
      error ? `ABSENTE — ${error.message.slice(0, 60)}` : 'OK',
    );
  }

  // La fonction de limitation de débit compte autant que les tables.
  const { error: rpcError } = await client.rpc('sched_rate_limit_hit', {
    p_key: 'probe:check',
    p_window_start: new Date().toISOString(),
    p_limit: 1_000_000,
  });
  if (rpcError) missing += 1;
  console.log(
    'sched_rate_limit_hit()'.padEnd(34),
    rpcError ? `ABSENTE — ${rpcError.message.slice(0, 60)}` : 'OK',
  );

  console.log(missing === 0 ? '\nTOUT EST EN PLACE' : `\n${missing} ÉLÉMENT(S) MANQUANT(S)`);
}

void main();
