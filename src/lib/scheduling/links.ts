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
import { TABLES, toLink, type LinkRow } from './rows';
import { assertOk, fetchAllKeyset, table } from './store';
import { generateToken, isTokenShaped } from './tokens';
import type {
  BookingLink,
  CreateLinkInput,
  CreateLinkResult,
  RevokeLinkVerdict,
} from './types';

const LINK_COLUMNS =
  'token, target_id, idempotency_key, status, expires_at, context, display, ' +
  'revoked_reason, created_at';

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
    .select(LINK_COLUMNS)
    .eq('token', token)
    .maybeSingle<LinkRow>();
  assertOk('getBookingLink', error);
  if (!data) return null;

  const row = await expireIfNeeded(data);
  return toLink(row, await targetRefById(row.target_id));
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
  targetExternalRef: string,
  options?: { status?: BookingLink['status'] },
): Promise<BookingLink[]> {
  const target = await targetByRef(targetExternalRef);
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

async function targetRefById(id: string): Promise<string> {
  const { data, error } = await table(TABLES.targets)
    .select('external_ref')
    .eq('id', id)
    .maybeSingle<{ external_ref: string }>();
  assertOk('targetRefById', error);
  return data?.external_ref ?? id;
}
