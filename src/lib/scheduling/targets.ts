/**
 * Cibles — l'indirection qui rend le module vivable dans la durée.
 *
 * Un lien ne pointe JAMAIS une ressource : il pointe une cible, que l'hôte
 * re-pointe librement. Conséquences, sans aucun cas particulier :
 *   - re-pointer ⇒ tous les liens déjà émis montrent le nouvel agenda, sans
 *     réémission ni mail de rattrapage ;
 *   - les rendez-vous DÉJÀ PRIS ne bougent pas (ils ont figé leur ressource) —
 *     un RDV est un engagement, le déplacer est une replanification explicite ;
 *   - une cible sans ressource active ⇒ page dégradée, jamais une erreur.
 *
 * `version` est le témoin du re-pointage : la séquence de confirmation la
 * relit et compense si elle a bougé pendant qu'un invité confirmait.
 */
import { assertOk, chunk, fetchAllKeyset, table } from './store';
import { nowIso } from './runtime';
import { TABLES, toTarget, type TargetRow } from './rows';
import type { MeetingLocation, Target, TargetImpact } from './types';

const TARGET_COLUMNS =
  'id, external_ref, resource_id, meeting_location_override, version, created_at, updated_at';

/**
 * Même projection, avec la clé de la ressource JOINTE dans la même requête
 * (clé étrangère `resource_id`). Lire la cible puis la clé de sa ressource
 * coûtait deux allers-retours pour une seule information.
 */
export const TARGET_COLUMNS_WITH_RESOURCE_REF = `${TARGET_COLUMNS}, resource:sched_resources(external_ref)`;

export type TargetRowWithResourceRef = TargetRow & {
  resource: { external_ref: string } | null;
};

/** `null` si la ressource est absente — même repli que l'ancienne lecture séparée. */
export function toTargetWithRef(row: TargetRowWithResourceRef): Target {
  return toTarget(row, row.resource?.external_ref ?? null);
}

export async function createTarget(input: {
  externalRef: string;
  resourceExternalRef?: string | null;
  meetingLocationOverride?: MeetingLocation | null;
}): Promise<Target> {
  const resourceId = input.resourceExternalRef
    ? await resourceIdByRef(input.resourceExternalRef)
    : null;

  const { data, error } = await table(TABLES.targets)
    .insert({
      external_ref: input.externalRef,
      resource_id: resourceId,
      meeting_location_override: input.meetingLocationOverride ?? null,
    })
    .select(TARGET_COLUMNS)
    .single<TargetRow>();
  assertOk('createTarget', error);
  return toTarget(data as TargetRow, input.resourceExternalRef ?? null);
}

export async function getTarget(externalRef: string): Promise<Target | null> {
  const { data, error } = await table(TABLES.targets)
    .select(TARGET_COLUMNS_WITH_RESOURCE_REF)
    .eq('external_ref', externalRef)
    .maybeSingle<TargetRowWithResourceRef>();
  assertOk('getTarget', error);
  return data ? toTargetWithRef(data) : null;
}

export async function getTargetById(id: string): Promise<Target | null> {
  const { data, error } = await table(TABLES.targets)
    .select(TARGET_COLUMNS_WITH_RESOURCE_REF)
    .eq('id', id)
    .maybeSingle<TargetRowWithResourceRef>();
  assertOk('getTargetById', error);
  return data ? toTargetWithRef(data) : null;
}

/**
 * Plusieurs cibles en une passe, indexées par clé externe. Une clé inconnue
 * est simplement absente de la carte. Exhaustif : les clés sont uniques, une
 * tranche de N clés rend au plus N lignes.
 */
export async function getTargets(externalRefs: readonly string[]): Promise<Map<string, Target>> {
  const refs = [...new Set(externalRefs)];
  const slices = await Promise.all(
    chunk(refs, 200).map(async (slice) => {
      const { data, error } = await table(TABLES.targets)
        .select(TARGET_COLUMNS_WITH_RESOURCE_REF)
        .in('external_ref', slice);
      assertOk('getTargets', error);
      // Jointure « plusieurs vers un » : PostgREST rend un objet (le typage
      // inféré sans schéma généré la voit comme un tableau).
      return (data ?? []) as unknown as TargetRowWithResourceRef[];
    }),
  );
  return new Map(slices.flat().map((row) => [row.external_ref, toTargetWithRef(row)]));
}

/**
 * Re-pointe une cible et INCRÉMENTE sa version. L'update est conditionné à la
 * version lue (contrôle optimiste) : deux re-pointages concurrents ne peuvent
 * pas se perdre l'un l'autre, le perdant relit et réessaie.
 */
export async function repointTarget(
  externalRef: string,
  resourceExternalRef: string | null,
): Promise<{ target: Target; activeLinks: number } | null> {
  const resourceId = resourceExternalRef
    ? await resourceIdByRef(resourceExternalRef)
    : null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await getTarget(externalRef);
    if (!current) return null;

    const { data, error } = await table(TABLES.targets)
      .update({ resource_id: resourceId, version: current.version + 1 })
      .eq('external_ref', externalRef)
      .eq('version', current.version)
      .select(TARGET_COLUMNS)
      .maybeSingle<TargetRow>();
    assertOk('repointTarget', error);
    if (data) {
      return {
        target: toTarget(data, resourceExternalRef),
        activeLinks: await countActiveLinks(data.id),
      };
    }
  }
  throw new Error(`repointTarget: version instable pour ${externalRef}`);
}

export async function setTargetLocationOverride(
  externalRef: string,
  override: MeetingLocation | null,
): Promise<Target | null> {
  const { data, error } = await table(TABLES.targets)
    .update({ meeting_location_override: override })
    .eq('external_ref', externalRef)
    .select(TARGET_COLUMNS_WITH_RESOURCE_REF)
    .maybeSingle<TargetRowWithResourceRef>();
  assertOk('setTargetLocationOverride', error);
  return data ? toTargetWithRef(data) : null;
}

/**
 * Ce qu'un changement de titulaire va réellement produire. Alimente le dialog
 * d'impact de l'hôte : « X liens actifs basculeront · Y RDV pris ne bougent
 * pas » — on montre l'effet AVANT d'écrire, jamais après.
 */
export async function getTargetImpact(
  /** Clé externe, ou la cible déjà lue par l'appelant (aucune relecture). */
  targetOrRef: string | Target,
): Promise<TargetImpact | null> {
  const target =
    typeof targetOrRef === 'string' ? await getTarget(targetOrRef) : targetOrRef;
  if (!target) return null;

  // Rendez-vous à venir et liens actifs sont indépendants : lus ensemble.
  const [rows, activeLinks] = await Promise.all([
    fetchAllKeyset<{ id: string; resource_id: string }>(
      'getTargetImpact.bookings',
      (after, limit) => {
        let query = table(TABLES.bookings)
          .select('id, resource_id')
          .eq('target_id', target.id)
          .eq('status', 'confirmed')
          .gte('start_at', nowIso());
        if (after !== null) query = query.gt('id', after);
        return query.order('id', { ascending: true }).limit(limit);
      },
      (row) => row.id,
    ),
    countActiveLinks(target.id),
  ]);

  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.resource_id, (counts.get(row.resource_id) ?? 0) + 1);
  }

  const refs = await resourceRefsByIds([...counts.keys()]);
  const confirmedUpcomingBookings = [...counts.entries()].map(([resourceId, count]) => ({
    resourceExternalRef: refs.get(resourceId) ?? resourceId,
    count,
  }));

  return { activeLinks, confirmedUpcomingBookings };
}

/**
 * Cibles qui ont des liens actifs mais AUCUNE ressource active derrière : des
 * invités reçoivent une page dégradée en ce moment même. C'est le signal que
 * l'hôte affiche à son équipe — un lien orphelin ne doit jamais être découvert
 * par l'invité avant l'organisation.
 */
export async function listOrphanTargets(): Promise<
  { target: Target; activeLinks: number }[]
> {
  // Trois lectures indépendantes, lancées ensemble : la ressource et le compte
  // de liens ne dépendent pas de la liste des cibles.
  const [targets, activeResources, linkCounts] = await Promise.all([
    fetchAllKeyset<TargetRowWithResourceRef>(
      'listOrphanTargets',
      (after, limit) => {
        let query = table(TABLES.targets).select(TARGET_COLUMNS_WITH_RESOURCE_REF);
        if (after !== null) query = query.gt('external_ref', after);
        return query.order('external_ref', { ascending: true }).limit(limit);
      },
      (row) => row.external_ref,
    ),
    activeResourceIds(),
    countActiveLinksByTarget(),
  ]);
  if (targets.length === 0) return [];

  const orphanRows = targets
    .map((row) => ({ row, activeLinks: linkCounts.get(row.id) ?? 0 }))
    .filter(
      ({ row, activeLinks }) =>
        activeLinks > 0 &&
        !(row.resource_id !== null && activeResources.has(row.resource_id)),
    );
  return orphanRows.map(({ row, activeLinks }) => ({
    target: toTargetWithRef(row),
    activeLinks,
  }));
}

// ─── Internes ───────────────────────────────────────────────────────────

async function countActiveLinks(targetId: string): Promise<number> {
  const { count, error } = await table(TABLES.links)
    .select('token', { count: 'exact', head: true })
    .eq('target_id', targetId)
    .eq('status', 'active');
  assertOk('countActiveLinks', error);
  return count ?? 0;
}

async function countActiveLinksByTarget(): Promise<Map<string, number>> {
  const rows = await fetchAllKeyset<{ token: string; target_id: string }>(
    'countActiveLinksByTarget',
    (after, limit) => {
      let query = table(TABLES.links).select('token, target_id').eq('status', 'active');
      if (after !== null) query = query.gt('token', after);
      return query.order('token', { ascending: true }).limit(limit);
    },
    (row) => row.token,
  );
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.target_id, (counts.get(row.target_id) ?? 0) + 1);
  }
  return counts;
}

async function activeResourceIds(): Promise<Set<string>> {
  const rows = await fetchAllKeyset<{ id: string }>(
    'activeResourceIds',
    (after, limit) => {
      let query = table(TABLES.resources).select('id').eq('is_active', true);
      if (after !== null) query = query.gt('id', after);
      return query.order('id', { ascending: true }).limit(limit);
    },
    (row) => row.id,
  );
  return new Set(rows.map((row) => row.id));
}

async function resourceIdByRef(externalRef: string): Promise<string> {
  const { data, error } = await table(TABLES.resources)
    .select('id')
    .eq('external_ref', externalRef)
    .maybeSingle<{ id: string }>();
  assertOk('resourceIdByRef', error);
  if (!data) throw new Error(`ressource inconnue : ${externalRef}`);
  return data.id;
}

/** Clés externes de plusieurs ressources, en une lecture par tranche. */
async function resourceRefsByIds(ids: readonly string[]): Promise<Map<string, string>> {
  const slices = await Promise.all(
    chunk([...new Set(ids)], 200).map(async (slice) => {
      const { data, error } = await table(TABLES.resources)
        .select('id, external_ref')
        .in('id', slice);
      assertOk('resourceRefById', error);
      return (data ?? []) as { id: string; external_ref: string }[];
    }),
  );
  return new Map(slices.flat().map((row) => [row.id, row.external_ref]));
}
