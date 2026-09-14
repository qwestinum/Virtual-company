/**
 * Contexte de réservation d'une campagne — résolu UNE fois par requête.
 *
 * Diagnostic de latence du 14/09/2026 : une relance de lien relisait campagne,
 * cible, liens et ressource à chaque sous-étape (48 allers-retours). Ces tests
 * tiennent les trois garanties du contexte : une lecture par élément, l'OUBLI
 * après une écriture (jamais une valeur périmée), et aucune mémoire partagée
 * entre deux contextes — donc entre deux requêtes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/repos/campaigns', () => ({ getCampaign: vi.fn() }));
vi.mock('@/lib/db/repos/recruiters', () => ({ getRecruiter: vi.fn() }));
vi.mock('@/lib/scheduling-host/configure', () => ({ ensureSchedulingConfigured: vi.fn(async () => {}) }));
vi.mock('@/lib/scheduling', () => ({
  cancelBookingByOrganizer: vi.fn(),
  createBookingLink: vi.fn(),
  createTarget: vi.fn(),
  getBooking: vi.fn(),
  getResource: vi.fn(),
  getTarget: vi.fn(),
  listConfirmedBookingsByLinkTokens: vi.fn(),
  listLinksForTarget: vi.fn(),
  listWeeklyRules: vi.fn(),
  repointTarget: vi.fn(),
  resolveMeetingLocation: vi.fn(),
  revokeLink: vi.fn(),
}));

import { getCampaign } from '@/lib/db/repos/campaigns';
import {
  cancelBookingByOrganizer,
  createTarget,
  getTarget,
  listConfirmedBookingsByLinkTokens,
  listLinksForTarget,
  revokeLink,
  type Booking,
  type BookingLink,
  type Target,
} from '@/lib/scheduling';
import {
  cancelBookingForAnalysis,
  createCampaignBookingContext,
  ensureCampaignTarget,
  pickConfirmedBookingForLinks,
  revokeCampaignBookingLink,
} from '@/lib/scheduling-host/campaign-booking';

const CAMP = 'CAMP-2026-900';
const target = { id: 't1', externalRef: CAMP, resourceExternalRef: 'u1' } as Target;
const link = (token: string, key: string, status: BookingLink['status'] = 'used') =>
  ({ token, idempotencyKey: key, status }) as BookingLink;
const booking = (id: string, linkToken: string, createdAt: string) =>
  ({ id, linkToken, status: 'confirmed', createdAt, startAt: '2026-09-20T09:00:00.000Z' }) as Booking;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCampaign).mockResolvedValue({ id: CAMP, ownerUserId: 'u1' } as never);
  vi.mocked(getTarget).mockResolvedValue(target);
  vi.mocked(listLinksForTarget).mockResolvedValue([link('tok1', 'an1'), link('tok2', 'an1#r2', 'active')]);
  vi.mocked(listConfirmedBookingsByLinkTokens).mockResolvedValue([]);
  vi.mocked(cancelBookingByOrganizer).mockResolvedValue('cancelled');
  vi.mocked(revokeLink).mockResolvedValue('revoked');
});

describe('createCampaignBookingContext', () => {
  it('lit campagne, cible et liens UNE fois, quel que soit le nombre de consommateurs', async () => {
    const ctx = createCampaignBookingContext(CAMP);
    await Promise.all([ctx.campaign(), ctx.campaign(), ctx.target(), ctx.links(), ctx.links()]);
    expect(getCampaign).toHaveBeenCalledTimes(1);
    expect(getTarget).toHaveBeenCalledTimes(1);
    expect(listLinksForTarget).toHaveBeenCalledTimes(1);
    // Les liens partent sur la cible DÉJÀ lue, pas sur sa clé.
    expect(listLinksForTarget).toHaveBeenCalledWith(target);
  });

  it('aucune mémoire entre deux contextes (donc entre deux requêtes)', async () => {
    await createCampaignBookingContext(CAMP).campaign();
    await createCampaignBookingContext(CAMP).campaign();
    expect(getCampaign).toHaveBeenCalledTimes(2);
  });

  it('une campagne fournie par l’appelant n’est pas relue', async () => {
    const ctx = createCampaignBookingContext(CAMP, { campaign: { id: CAMP } as never });
    await ctx.campaign();
    expect(getCampaign).not.toHaveBeenCalled();
  });

  it('une écriture de cible OUBLIE la cible et les liens lus avant elle', async () => {
    vi.mocked(getTarget).mockResolvedValueOnce(null).mockResolvedValueOnce(target);
    const ctx = createCampaignBookingContext(CAMP);
    await ensureCampaignTarget(CAMP, 'u1', ctx);
    expect(createTarget).toHaveBeenCalledTimes(1);
    expect(await ctx.target()).toBe(target);
    expect(getTarget).toHaveBeenCalledTimes(2);
  });

  it('un contexte frère partage campagne et cible mais RELIT les liens', async () => {
    const ctx = createCampaignBookingContext(CAMP);
    await ctx.links();
    const sibling = ctx.fork();
    await sibling.links();
    await sibling.campaign();
    expect(getTarget).toHaveBeenCalledTimes(1);
    expect(getCampaign).toHaveBeenCalledTimes(1);
    expect(listLinksForTarget).toHaveBeenCalledTimes(2);
  });

  it('révoquer puis décommander : une seule lecture de cible et de liens', async () => {
    vi.mocked(listConfirmedBookingsByLinkTokens).mockResolvedValue([booking('b1', 'tok1', '2026-09-01T10:00:00Z')]);
    const ctx = createCampaignBookingContext(CAMP);
    await revokeCampaignBookingLink(CAMP, 'an1', 'test', ctx);
    await cancelBookingForAnalysis({ campaignId: CAMP, analysisId: 'an1', reason: 'r', notifyAttendee: false, context: ctx });
    expect(revokeLink).toHaveBeenCalledWith('tok2', 'test');
    expect(getTarget).toHaveBeenCalledTimes(1);
    // Une révocation a eu lieu : les liens sont relus pour l'étape suivante.
    expect(listLinksForTarget).toHaveBeenCalledTimes(2);
    // La réservation lue est transmise, pas relue par son identifiant.
    expect(vi.mocked(cancelBookingByOrganizer).mock.calls[0]![0]).toMatchObject({ id: 'b1' });
  });
});

describe('pickConfirmedBookingForLinks — même choix que la lecture lien par lien', () => {
  it('le lien le plus récent qui porte un rendez-vous gagne', () => {
    const links = [link('new', 'an1#r2'), link('old', 'an1')];
    const picked = pickConfirmedBookingForLinks(links, [
      booking('b-old', 'old', '2026-09-01T10:00:00Z'),
      booking('b-new', 'new', '2026-09-02T10:00:00Z'),
    ]);
    expect(picked?.id).toBe('b-new');
  });

  it('pour un même lien : la réservation la plus récente (order created_at desc, limit 1)', () => {
    const picked = pickConfirmedBookingForLinks([link('tok', 'an1')], [
      booking('first', 'tok', '2026-09-01T10:00:00Z'),
      booking('second', 'tok', '2026-09-03T10:00:00Z'),
    ]);
    expect(picked?.id).toBe('second');
  });

  it('un lien récent sans rendez-vous cède la place au suivant', () => {
    const picked = pickConfirmedBookingForLinks([link('new', 'k2'), link('old', 'k1')], [
      booking('b-old', 'old', '2026-09-01T10:00:00Z'),
    ]);
    expect(picked?.id).toBe('b-old');
  });

  it('aucun rendez-vous confirmé ⇒ null', () => {
    expect(pickConfirmedBookingForLinks([link('a', 'k')], [])).toBeNull();
  });
});
