/**
 * Repo — dernière lecture de l'agenda publié d'un recruteur
 * (`recruiter_busy_snapshots`, une ligne par recruteur).
 *
 * Ne contient que des bornes horaires. Déployable AVANT la migration : table
 * absente ⇒ les lectures rendent « aucune copie » et les écritures sont
 * ignorées — le connecteur retombe alors sur le comportement du lot A (lecture
 * fraîche à chaque fois, aucune tolérance), jamais sur « libre ».
 *
 * Spec : docs/specs/agenda-externe.md §4.
 */
import { chunk } from '@/lib/db/paginate';
import {
  requireServerSupabase,
  SupabaseNotConfiguredError,
} from '@/lib/db/supabase-server';
import type { BusyInterval } from '@/lib/scheduling';

const TABLE = 'recruiter_busy_snapshots';

export type BusyCalendarState = 'healthy' | 'tolerated' | 'blocked';

export type BusySnapshot = {
  recruiterId: string;
  intervals: BusyInterval[];
  windowFrom: string | null;
  windowTo: string | null;
  occurrenceCount: number;
  /** Dernière lecture RÉUSSIE. */
  readAt: string | null;
  attemptedAt: string | null;
  /** null ⇔ la dernière tentative a réussi. */
  failingSince: string | null;
  failureCode: string | null;
  lastState: BusyCalendarState | null;
};

type Row = {
  recruiter_id: string;
  intervals: unknown;
  window_from: string | null;
  window_to: string | null;
  occurrence_count: number;
  read_at: string | null;
  attempted_at: string | null;
  failing_since: string | null;
  failure_code: string | null;
  last_state: string | null;
};

function toSnapshot(row: Row): BusySnapshot {
  return {
    recruiterId: row.recruiter_id,
    intervals: parseIntervals(row.intervals),
    windowFrom: iso(row.window_from),
    windowTo: iso(row.window_to),
    occurrenceCount: row.occurrence_count,
    readAt: iso(row.read_at),
    attemptedAt: iso(row.attempted_at),
    failingSince: iso(row.failing_since),
    failureCode: row.failure_code,
    lastState:
      row.last_state === 'healthy' || row.last_state === 'tolerated' || row.last_state === 'blocked'
        ? row.last_state
        : null,
  };
}

/** Postgres rend `+00:00` : on ramène tout à l'ISO canonique `…Z`. */
function iso(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function parseIntervals(value: unknown): BusyInterval[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2) return [];
    const [start, end] = entry as unknown[];
    return typeof start === 'string' && typeof end === 'string' ? [{ startAt: start, endAt: end }] : [];
  });
}

function isTableMissing(err: { code?: string; message?: string }): boolean {
  if (err.code === '42P01' || err.code === 'PGRST205') return true;
  return (err.message ?? '').includes(TABLE);
}

function isClaimColumnMissing(err: { code?: string; message?: string }): boolean {
  return err.code === '42703' || err.code === 'PGRST204' || (err.message ?? '').includes('refresh_claimed_at');
}

/** La copie d'un recruteur, ou `null` (aucune, ou table absente). Lève sur une vraie panne. */
export async function getBusySnapshot(recruiterId: string): Promise<BusySnapshot | null> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('recruiter_id', recruiterId)
    .maybeSingle();
  if (error) {
    if (isTableMissing(error)) return null;
    throw new Error(`getBusySnapshot: ${error.code ?? 'db_error'}`);
  }
  return data ? toSnapshot(data as Row) : null;
}

/** Copies de plusieurs recruteurs, par tranches (jamais sous le plafond silencieux de 1000 lignes). */
export async function listBusySnapshots(recruiterIds: readonly string[]): Promise<BusySnapshot[]> {
  if (recruiterIds.length === 0) return [];
  const supabase = requireServerSupabase();
  const out: BusySnapshot[] = [];
  for (const slice of chunk([...recruiterIds], 500)) {
    const { data, error } = await supabase.from(TABLE).select('*').in('recruiter_id', slice);
    if (error) {
      if (isTableMissing(error)) return [];
      throw new Error(`listBusySnapshots: ${error.code ?? 'db_error'}`);
    }
    out.push(...((data ?? []) as Row[]).map(toSnapshot));
  }
  return out;
}

/** Lecture réussie : la copie est REMPLACÉE d'un bloc, et la panne effacée. */
export async function recordBusyReadSuccess(input: {
  recruiterId: string;
  intervals: BusyInterval[];
  windowFrom: string;
  windowTo: string;
  occurrenceCount: number;
  readAt: string;
}): Promise<void> {
  await bestEffort('recordBusyReadSuccess', async (supabase) =>
    supabase.from(TABLE).upsert(
      {
        recruiter_id: input.recruiterId,
        intervals: input.intervals.map((i) => [i.startAt, i.endAt]),
        window_from: input.windowFrom,
        window_to: input.windowTo,
        occurrence_count: input.occurrenceCount,
        read_at: input.readAt,
        attempted_at: input.readAt,
        failing_since: null,
        failure_code: null,
        updated_at: input.readAt,
      },
      { onConflict: 'recruiter_id' },
    ),
  );
}

/**
 * Lecture en échec : la copie est GARDÉE (c'est elle qui sert la tolérance),
 * `failing_since` n'est posé qu'à la PREMIÈRE panne d'une série.
 *
 * Rend le début de panne réellement en base (le sien ou un antérieur).
 */
export async function recordBusyReadFailure(input: {
  recruiterId: string;
  code: string;
  attemptedAt: string;
  previous: BusySnapshot | null;
}): Promise<string> {
  const failingSince = input.previous?.failingSince ?? input.attemptedAt;
  await bestEffort('recordBusyReadFailure', async (supabase) =>
    input.previous
      ? supabase
          .from(TABLE)
          .update({
            attempted_at: input.attemptedAt,
            failure_code: input.code,
            failing_since: failingSince,
            updated_at: input.attemptedAt,
          })
          .eq('recruiter_id', input.recruiterId)
      : supabase.from(TABLE).upsert(
          {
            recruiter_id: input.recruiterId,
            attempted_at: input.attemptedAt,
            failure_code: input.code,
            failing_since: failingSince,
            updated_at: input.attemptedAt,
          },
          { onConflict: 'recruiter_id', ignoreDuplicates: true },
        ),
  );
  return failingSince;
}

/**
 * Pose le nouvel état SEULEMENT s'il diffère de celui déjà journalisé.
 * `true` ⇒ cet appel a gagné la transition (c'est lui qui la trace) ; deux
 * instances concurrentes ne la tracent pas deux fois.
 */
export async function claimBusyStateTransition(
  recruiterId: string,
  state: BusyCalendarState,
): Promise<boolean> {
  try {
    const supabase = requireServerSupabase();
    const { data, error } = await supabase
      .from(TABLE)
      .update({ last_state: state })
      .eq('recruiter_id', recruiterId)
      .or(`last_state.is.null,last_state.neq.${state}`)
      .select('recruiter_id');
    if (error) return false;
    return ((data ?? []) as unknown[]).length > 0;
  } catch {
    return false;
  }
}

/**
 * Réserve la relève d'un recruteur pour `ttlMs`. `true` ⇒ cette passe lit ;
 * `false` ⇒ une autre passe s'en charge déjà. Crée la ligne au besoin (un
 * agenda jamais lu n'en a pas encore).
 *
 * Table absente ⇒ `true` : sans elle il n'y a rien à protéger, et refuser
 * reviendrait à ne jamais relire.
 */
export async function claimBusyRefresh(recruiterId: string, nowIso: string, ttlMs: number): Promise<boolean> {
  try {
    const supabase = requireServerSupabase();
    const staleBefore = new Date(Date.parse(nowIso) - ttlMs).toISOString();
    const updated = await supabase
      .from(TABLE)
      .update({ refresh_claimed_at: nowIso })
      .eq('recruiter_id', recruiterId)
      .or(`refresh_claimed_at.is.null,refresh_claimed_at.lt.${staleBefore}`)
      .select('recruiter_id');
    // Table OU colonne absente (code du lot C déployé avant sa migration) : pas
    // de réservation possible, mais jamais « ne pas relire ».
    if (updated.error) return isTableMissing(updated.error) || isClaimColumnMissing(updated.error);
    if (((updated.data ?? []) as unknown[]).length > 0) return true;

    const inserted = await supabase
      .from(TABLE)
      .upsert(
        { recruiter_id: recruiterId, refresh_claimed_at: nowIso },
        { onConflict: 'recruiter_id', ignoreDuplicates: true },
      )
      .select('recruiter_id');
    if (inserted.error) return isTableMissing(inserted.error) || isClaimColumnMissing(inserted.error);
    return ((inserted.data ?? []) as unknown[]).length > 0;
  } catch (err) {
    return err instanceof SupabaseNotConfiguredError;
  }
}

/** Oublie la copie — l'URL a changé : les plages de l'ancien agenda ne valent rien pour le nouveau. */
export async function deleteBusySnapshot(recruiterId: string): Promise<void> {
  await bestEffort('deleteBusySnapshot', async (supabase) =>
    supabase.from(TABLE).delete().eq('recruiter_id', recruiterId),
  );
}

async function bestEffort(
  operation: string,
  run: (
    supabase: ReturnType<typeof requireServerSupabase>,
  ) => PromiseLike<{ error: { code?: string; message?: string } | null }>,
): Promise<void> {
  try {
    const { error } = await run(requireServerSupabase());
    if (error && !isTableMissing(error)) {
      // Code seulement : aucune donnée de la ligne n'a sa place dans un log.
      console.error(`[busy-snapshots] ${operation} failed`, error.code ?? 'db_error');
    }
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error(`[busy-snapshots] ${operation} failed`);
    }
  }
}
