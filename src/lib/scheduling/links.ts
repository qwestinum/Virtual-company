/**
 * Liens de réservation nominatifs.
 *
 * Trois propriétés qui manquaient au lien statique qu'on remplace :
 *   - IDEMPOTENT à l'émission — ré-émettre avec la même clé rend le MÊME
 *     jeton. C'est ce qui permet à l'hôte de pré-visualiser un message autant
 *     de fois qu'il veut : le relecteur voit le lien qui partira vraiment ;
 *   - à USAGE UNIQUE — une fois consommé, il ne réserve plus rien ;
 *   - RÉVOCABLE — on peut tuer un lien déjà envoyé.
 *
 * L'expiration est résolue à la LECTURE (pas de tâche de fond) : un lien
 * périmé bascule en `expired` la première fois qu'on le regarde.
 */
import { isUniqueViolation, SchedulingStoreError } from './errors';
import { bookingUrl, nowIso } from './runtime';
import {
  TABLES,
  toLink,
  toResource,
  toTarget,
  type LinkRow,
  type ResourceRow,
  type TargetRow,
} from './rows';
import { assertOk, fetchAllKeyset, table } from './store';
import { generateToken, isTokenShaped } from './tokens';
import type {
  BookingLink,
  Resource,
  Target,
  CreateLinkInput,
  CreateLinkResult,
  RevokeLinkVerdict,
} from './types';

const LINK_COLUMNS =
  'token, target_id, idempotency_key, status, expires_at, context, display, ' +
  'revoked_reason, created_at';

/** Même projection, clé de la cible JOINTE (clé étrangère `target_id`). */
const LINK_COLUMNS_WITH_TARGET_REF = `${LINK_COLUMNS}, target:sched_targets(external_ref)`;

type LinkRowWithTargetRef = LinkRow & { target: { external_ref: string } | null };

/**
 * Émet (ou retrouve) le lien d'une clé d'idempotence.
 *
 * On TENTE l'insertion et on traite la violation d'unicité comme le cas
 * nominal du rejeu — plutôt qu'un SELECT-puis-INSERT, qui laisse une fenêtre
 * où deux appels concurrents créent deux jetons pour le même destinataire.
 */
export async function createBookingLink(
  input: CreateLinkInput,
): Promise<CreateLinkResult> {
  const target = await targetByRef(input.targetExternalRef);
  const token = generateToken();

  const { data, error } = await table(TABLES.links)
    .insert({
      token,
      target_id: target.id,
      idempotency_key: input.idempotencyKey,
      context: input.context ?? {},
      display: input.display ?? {},
      expires_at: input.expiresAt ?? null,
    })
    .select(LINK_COLUMNS)
    .single<LinkRow>();

  if (!error && data) {
    const link = toLink(data, input.targetExternalRef);
    return { token: link.token, url: bookingUrl(link.token), reused: false, link };
  }
  if (!isUniqueViolation(error)) {
    assertOk('createBookingLink', error);
  }

  // Rejeu : le lien existe déjà pour cette clé — on rend l'existant tel quel.
  const existing = await findLinkByKey(target.id, input.idempotencyKey);
  if (!existing) {
    throw new SchedulingStoreError(
      'createBookingLink',
      'conflit d’unicité sans lien retrouvable',
      error?.code ?? null,
    );
  }
  const link = toLink(existing, input.targetExternalRef);
  return { token: link.token, url: bookingUrl(link.token), reused: true, link };
}

/** Lecture d'un lien AVEC résolution paresseuse de l'expiration. */
export async function getBookingLink(token: string): Promise<BookingLink | null> {
  if (!isTokenShaped(token)) return null;
  const { data, error } = await table(TABLES.links)
    .select(LINK_COLUMNS_WITH_TARGET_REF)
    .eq('token', token)
    .maybeSingle<LinkRowWithTargetRef>();
  assertOk('getBookingLink', error);
  if (!data) return null;

  const row = await expireIfNeeded(data);
  // Repli sur l'identifiant interne si la cible est introuvable — comme la
  // lecture séparée qu'elle remplace.
  return toLink(row, data.target?.external_ref ?? row.target_id);
}

/**
 * Lien + cible + ressource complète, en UNE requête (clés étrangères
 * `target_id` puis `resource_id`). La page publique, la liste des créneaux et
 * la confirmation lisaient ces trois lignes l'une après l'autre, plus deux
 * relectures de clé. L'expiration reste résolue à la lecture, comme
 * `getBookingLink`. Interne au module (non exporté par l'index).
 */
export async function getBookingLinkChain(token: string): Promise<{
  link: BookingLink;
  target: Target | null;
  resource: Resource | null;
} | null> {
  if (!isTokenShaped(token)) return null;
  const { data, error } = await table(TABLES.links)
    .select(
      `${LINK_COLUMNS}, target:sched_targets(id, external_ref, resource_id, ` +
        'meeting_location_override, version, created_at, updated_at, resource:sched_resources(*))',
    )
    .eq('token', token)
    .maybeSingle<
      LinkRow & { target: (TargetRow & { resource: ResourceRow | null }) | null }
    >();
  assertOk('getBookingLink', error);
  if (!data) return null;

  const row = await expireIfNeeded(data);
  const targetRow = data.target;
  const resourceRow = targetRow?.resource ?? null;
  return {
    link: toLink(row, targetRow?.external_ref ?? row.target_id),
    target: targetRow ? toTarget(targetRow, resourceRow?.external_ref ?? null) : null,
    resource: resourceRow ? toResource(resourceRow) : null,
  };
}

export async function revokeLink(
  token: string,
  reason: string,
): Promise<RevokeLinkVerdict> {
  if (!isTokenShaped(token)) return 'not_found';
  const { data, error } = await table(TABLES.links)
    .update({ status: 'revoked', revoked_reason: reason })
    .eq('token', token)
    .in('status', ['active', 'expired'])
    .select('token')
    .maybeSingle<{ token: string }>();
  assertOk('revokeLink', error);
  if (data) return 'revoked';

  // Rien mis à jour : soit le lien n'existe pas, soit il est déjà consommé ou
  // révoqué. On distingue, parce que « déjà utilisé » veut dire qu'un rendez-vous
  // existe — l'appelant a peut-être un RDV à annuler en plus.
  const existing = await getBookingLink(token);
  if (!existing) return 'not_found';
  return existing.status === 'used' ? 'already_used' : 'already_revoked';
}

/**
 * Révocation par clé d'idempotence — la forme qu'utilise l'hôte quand il
 * ferme un dossier sans avoir gardé le jeton sous la main.
 */
export async function revokeLinkByKey(
  targetExternalRef: string,
  idempotencyKey: string,
  reason: string,
): Promise<RevokeLinkVerdict> {
  const target = await targetByRef(targetExternalRef);
  const existing = await findLinkByKey(target.id, idempotencyKey);
  if (!existing) return 'not_found';
  return revokeLink(existing.token, reason);
}

export async function listLinksForTarget(
  /** Clé externe, ou la cible déjà lue par l'appelant (aucune relecture). */
  targetOrRef: string | Pick<Target, 'id' | 'externalRef'>,
  options?: { status?: BookingLink['status'] },
): Promise<BookingLink[]> {
  const targetExternalRef =
    typeof targetOrRef === 'string' ? targetOrRef : targetOrRef.externalRef;
  const target =
    typeof targetOrRef === 'string' ? await targetByRef(targetOrRef) : targetOrRef;
  const rows = await fetchAllKeyset<LinkRow>(
    'listLinksForTarget',
    (after, limit) => {
      let query = table(TABLES.links).select(LINK_COLUMNS).eq('target_id', target.id);
      if (options?.status) query = query.eq('status', options.status);
      if (after !== null) query = query.gt('token', after);
      return query.order('token', { ascending: true }).limit(limit);
    },
    (row) => row.token,
  );
  return rows
    .map((row) => toLink(row, targetExternalRef))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Marque le lien consommé. Conditionné à `active` : le perdant le sait. */
export async function markLinkUsed(token: string): Promise<boolean> {
  const { data, error } = await table(TABLES.links)
    .update({ status: 'used' })
    .eq('token', token)
    .eq('status', 'active')
    .select('token')
    .maybeSingle<{ token: string }>();
  assertOk('markLinkUsed', error);
  return data !== null;
}

/** Rend un lien consommé à l'état actif — compensation d'une séquence avortée. */
export async function restoreLinkActive(token: string): Promise<void> {
  const { error } = await table(TABLES.links)
    .update({ status: 'active' })
    .eq('token', token)
    .eq('status', 'used');
  assertOk('restoreLinkActive', error);
}

// ─── Internes ───────────────────────────────────────────────────────────

async function expireIfNeeded(row: LinkRow): Promise<LinkRow> {
  if (row.status !== 'active' || !row.expires_at) return row;
  if (Date.parse(row.expires_at) > Date.parse(nowIso())) return row;

  const { error } = await table(TABLES.links)
    .update({ status: 'expired' })
    .eq('token', row.token)
    .eq('status', 'active');
  assertOk('expireLink', error);
  return { ...row, status: 'expired' };
}

async function findLinkByKey(
  targetId: string,
  idempotencyKey: string,
): Promise<LinkRow | null> {
  const { data, error } = await table(TABLES.links)
    .select(LINK_COLUMNS)
    .eq('target_id', targetId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle<LinkRow>();
  assertOk('findLinkByKey', error);
  return data ?? null;
}

async function targetByRef(externalRef: string): Promise<{ id: string }> {
  const { data, error } = await table(TABLES.targets)
    .select('id')
    .eq('external_ref', externalRef)
    .maybeSingle<{ id: string }>();
  assertOk('targetByRef', error);
  if (!data) throw new Error(`cible inconnue : ${externalRef}`);
  return data;
}
