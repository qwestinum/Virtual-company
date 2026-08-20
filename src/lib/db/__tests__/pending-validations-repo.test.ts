import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/supabase-server', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/db/supabase-server')
  >('@/lib/db/supabase-server');
  return { ...actual, requireServerSupabase: vi.fn() };
});

import {
  listPendingValidations,
  patchPendingValidation,
  upsertPendingValidation,
} from '@/lib/db/repos/pending-validations';
import { requireServerSupabase } from '@/lib/db/supabase-server';
import type { PendingValidation } from '@/types/hitl';

const requireServerSupabaseMock = vi.mocked(requireServerSupabase);

function domain(over: Partial<PendingValidation> = {}): PendingValidation {
  return {
    id: 'PV-1',
    campaignId: 'CAMP-1',
    candidateName: 'Imad B.',
    candidateEmail: 'imad@mail.fr',
    score: 82,
    decision: 'accept',
    cvArtifactId: 'art-cv',
    reportArtifactId: 'art-report',
    mailDraftArtifactId: 'art-mail',
    confirmed: false,
    status: 'pending',
    payload: { foo: 'bar' },
    createdAt: '2026-06-08T09:00:00Z',
    updatedAt: '2026-06-08T09:00:00Z',
    decidedAt: null,
    decidedBy: null,
    decidedByUser: null,
    ...over,
  };
}

const ROW = {
  id: 'PV-1',
  campaign_id: 'CAMP-1',
  candidate_name: 'Imad B.',
  candidate_email: 'imad@mail.fr',
  score: 82,
  decision: 'accept',
  cv_artifact_id: 'art-cv',
  report_artifact_id: 'art-report',
  mail_draft_artifact_id: 'art-mail',
  confirmed: false,
  status: 'pending',
  payload: { foo: 'bar' },
  created_at: '2026-06-08T09:00:00Z',
  updated_at: '2026-06-08T09:00:00Z',
  decided_at: null,
  decided_by: null,
  decided_by_user_id: null,
  decided_by_user_email: null,
};

/**
 * Chaîne PostgREST d'une lecture keyset : select → in/eq → [gt] → order → limit.
 * `pages` est servi dans l'ordre, une page par appel de `limit`.
 */
function keysetQuery(
  pages: Record<string, unknown>[][],
  error: { code: string } | null = null,
) {
  let call = 0;
  const limit = vi.fn().mockImplementation(async () => ({
    data: error ? null : (pages[call++] ?? []),
    error,
  }));
  const order = vi.fn().mockReturnValue({ limit });
  const gt = vi.fn().mockReturnValue({ order, limit });
  const inFilter = vi.fn().mockReturnValue({ gt, order, limit });
  const eq = vi.fn().mockReturnValue({ gt, order, limit });
  const select = vi.fn().mockReturnValue({ in: inFilter, eq, gt, order, limit });
  return { select, inFilter, eq, gt, order, limit };
}

describe('pending-validations repo', () => {
  beforeEach(() => requireServerSupabaseMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('liste les validations EN ATTENTE (pending + sending) mappées en domaine', async () => {
    const q = keysetQuery([[ROW]]);
    const from = vi.fn().mockReturnValue({ select: q.select });
    requireServerSupabaseMock.mockReturnValue({ from } as never);

    const result = await listPendingValidations();
    expect(from).toHaveBeenCalledWith('pending_validations');
    // `sending` = réservation d'envoi en cours (audit C6) : encore « en
    // attente » pour TOUS les lecteurs, jamais un état terminal.
    expect(q.inFilter).toHaveBeenCalledWith('status', ['pending', 'sending']);
    // Pagination KEYSET : curseur sur la PK, ordre PK ASC, page bornée — sans
    // quoi PostgREST plafonnerait la file à 1000 lignes SANS le dire.
    expect(q.order).toHaveBeenCalledWith('id', { ascending: true });
    expect(q.limit).toHaveBeenCalledWith(1000);
    expect(result).toHaveLength(1);
    expect(result[0]!.campaignId).toBe('CAMP-1');
    expect(result[0]!.decision).toBe('accept');
    expect(result[0]!.payload).toEqual({ foo: 'bar' });
  });

  it('pagine au-delà d’une page pleine (zéro troncature silencieuse)', async () => {
    // Page 1 PLEINE (1000 lignes) → la boucle DOIT redemander après le curseur.
    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      ...ROW,
      id: `PV-${String(i).padStart(4, '0')}`,
    }));
    const page2 = [{ ...ROW, id: 'PV-1000' }];
    const q = keysetQuery([page1, page2]);
    requireServerSupabaseMock.mockReturnValue({
      from: vi.fn().mockReturnValue({ select: q.select }),
    } as never);

    const result = await listPendingValidations();
    expect(result).toHaveLength(1001);
    // Le curseur repart de la DERNIÈRE ligne de la page précédente.
    expect(q.gt).toHaveBeenCalledWith('id', 'PV-0999');
  });

  it('liste → [] si la table est absente (migration HITL pas passée)', async () => {
    const q = keysetQuery([], { code: '42P01' });
    requireServerSupabaseMock.mockReturnValue({
      from: vi.fn().mockReturnValue({ select: q.select }),
    } as never);
    expect(await listPendingValidations()).toEqual([]);
  });

  it('upsert avec onConflict id', async () => {
    const single = vi.fn().mockResolvedValue({ data: ROW, error: null });
    const selectAfter = vi.fn().mockReturnValue({ single });
    const upsert = vi.fn().mockReturnValue({ select: selectAfter });
    requireServerSupabaseMock.mockReturnValue({
      from: vi.fn().mockReturnValue({ upsert }),
    } as never);

    const result = await upsertPendingValidation(domain());
    const args = upsert.mock.calls[0]!;
    expect(args[0]).toMatchObject({ id: 'PV-1', campaign_id: 'CAMP-1' });
    expect(args[1]).toEqual({ onConflict: 'id' });
    expect(result.id).toBe('PV-1');
  });

  it('patch ne met à jour que les champs fournis', async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { ...ROW, status: 'sent' }, error: null });
    const selectAfter = vi.fn().mockReturnValue({ maybeSingle });
    const eq = vi.fn().mockReturnValue({ select: selectAfter });
    const update = vi.fn().mockReturnValue({ eq });
    requireServerSupabaseMock.mockReturnValue({
      from: vi.fn().mockReturnValue({ update }),
    } as never);

    const result = await patchPendingValidation('PV-1', { status: 'sent' });
    expect(update).toHaveBeenCalledWith({ status: 'sent' });
    expect(eq).toHaveBeenCalledWith('id', 'PV-1');
    expect(result?.status).toBe('sent');
  });

  it('patch vide → null (rien à écrire)', async () => {
    requireServerSupabaseMock.mockReturnValue({ from: vi.fn() } as never);
    expect(await patchPendingValidation('PV-1', {})).toBeNull();
  });

  it('patch confirmation : écrit decided_by + identité (id + email)', async () => {
    const confirmedRow = {
      ...ROW,
      confirmed: true,
      decided_by: 'user',
      decided_by_user_id: 'usr-uuid-1',
      decided_by_user_email: 'rh@client.fr',
    };
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: confirmedRow, error: null });
    const eq = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ maybeSingle }) });
    const update = vi.fn().mockReturnValue({ eq });
    requireServerSupabaseMock.mockReturnValue({
      from: vi.fn().mockReturnValue({ update }),
    } as never);

    const result = await patchPendingValidation('PV-1', {
      confirmed: true,
      decidedBy: 'user',
      decidedByUser: { userId: 'usr-uuid-1', email: 'rh@client.fr' },
    });
    expect(update).toHaveBeenCalledWith({
      confirmed: true,
      decided_by: 'user',
      decided_by_user_id: 'usr-uuid-1',
      decided_by_user_email: 'rh@client.fr',
    });
    expect(result?.decidedBy).toBe('user');
    expect(result?.decidedByUser).toEqual({
      userId: 'usr-uuid-1',
      email: 'rh@client.fr',
    });
  });

  it('rowToDomain : colonnes identité NULL (enqueue / historique) → null', () => {
    // Vérifie le mapping de lecture via upsert qui renvoie une row sans identité.
    const single = vi.fn().mockResolvedValue({ data: ROW, error: null });
    const upsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ single }),
    });
    requireServerSupabaseMock.mockReturnValue({
      from: vi.fn().mockReturnValue({ upsert }),
    } as never);
    return upsertPendingValidation(domain()).then((v) => {
      expect(v.decidedBy).toBeNull();
      expect(v.decidedByUser).toBeNull();
    });
  });
});
