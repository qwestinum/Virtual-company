/**
 * Rejeu partagé des CV non traités (C11 + C4) — réservation avant effet,
 * revert sur échec, drain idempotent gardé par « active + fiche validée ».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActiveCampaign } from '@/stores/campaigns-store';
import type { UnmatchedCvRow } from '@/lib/db/repos/imap-unmatched-cvs';

vi.mock('@/lib/db/repos/imap-unmatched-cvs', () => ({
  listPendingSheetCvs: vi.fn(),
  reserveUnmatchedReplay: vi.fn(),
  revertUnmatchedReplay: vi.fn(),
}));
vi.mock('@/lib/db/repos/journal', () => ({
  appendJournalEntry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/db/repos/mailboxes', () => ({
  getMailboxWithSecrets: vi.fn(),
}));
vi.mock('@/lib/imap/poller', () => ({
  processEmailAttachment: vi.fn(),
}));
vi.mock('@/lib/storage/blob', () => ({
  downloadArtifact: vi.fn(),
}));

import {
  listPendingSheetCvs,
  reserveUnmatchedReplay,
  revertUnmatchedReplay,
} from '@/lib/db/repos/imap-unmatched-cvs';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { getMailboxWithSecrets } from '@/lib/db/repos/mailboxes';
import { processEmailAttachment } from '@/lib/imap/poller';
import { downloadArtifact } from '@/lib/storage/blob';

import {
  canReceiveReplay,
  drainPendingSheetCvs,
  replayUnmatchedCv,
} from '../unmatched-replay';

function makeRow(overrides: Partial<UnmatchedCvRow> = {}): UnmatchedCvRow {
  return {
    id: 'row-1',
    mailbox_id: 'mbx-1',
    uid: '42',
    from_addr: 'candidat@example.com',
    subject: 'Candidature CAMP-0001',
    file_name: 'cv.pdf',
    mime: 'application/pdf',
    storage_bucket: 'artifacts',
    storage_path: 'unmatched/mbx-1/42/cv.pdf',
    status: 'pending',
    campaign_id: 'CAMP-0001',
    reason: 'pending_sheet',
    replayed_campaign_id: null,
    replayed_at: null,
    received_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

function makeCampaign(
  overrides: Partial<{ status: string; isValidated: boolean | null }> = {},
): ActiveCampaign {
  const { status = 'active', isValidated = true } = overrides;
  return {
    id: 'CAMP-0001',
    status,
    scoringSheet:
      isValidated === null ? null : { isValidated },
  } as unknown as ActiveCampaign;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMailboxWithSecrets).mockResolvedValue({
    id: 'mbx-1',
  } as never);
  vi.mocked(reserveUnmatchedReplay).mockResolvedValue(true);
  vi.mocked(downloadArtifact).mockResolvedValue(Buffer.from('pdf') as never);
  vi.mocked(processEmailAttachment).mockResolvedValue(undefined);
});

describe('canReceiveReplay', () => {
  it('accepte uniquement active + fiche validée', () => {
    expect(canReceiveReplay(makeCampaign())).toBe(true);
    expect(canReceiveReplay(makeCampaign({ status: 'draft' }))).toBe(false);
    expect(canReceiveReplay(makeCampaign({ status: 'paused' }))).toBe(false);
    expect(canReceiveReplay(makeCampaign({ isValidated: false }))).toBe(false);
    expect(canReceiveReplay(makeCampaign({ isValidated: null }))).toBe(false);
  });
});

describe('replayUnmatchedCv', () => {
  it('rejoue : réserve AVANT le traitement, journalise avec l’acteur', async () => {
    const row = makeRow();
    const outcome = await replayUnmatchedCv({
      row,
      campaign: makeCampaign(),
      actor: 'system',
    });
    expect(outcome).toEqual({ kind: 'done' });
    expect(reserveUnmatchedReplay).toHaveBeenCalledWith('row-1', 'CAMP-0001');
    expect(processEmailAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ matchSource: 'replay', uid: '42' }),
    );
    expect(appendJournalEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'imap_unmatched_replayed',
        actor: 'system',
        payload: expect.objectContaining({
          trigger: 'scoring_sheet_validated',
          reason: 'pending_sheet',
        }),
      }),
    );
    expect(revertUnmatchedReplay).not.toHaveBeenCalled();
  });

  it('réservation perdue → already_consumed, aucun traitement', async () => {
    vi.mocked(reserveUnmatchedReplay).mockResolvedValue(false);
    const outcome = await replayUnmatchedCv({
      row: makeRow(),
      campaign: makeCampaign(),
      actor: 'user',
    });
    expect(outcome).toEqual({ kind: 'already_consumed' });
    expect(processEmailAttachment).not.toHaveBeenCalled();
  });

  it('sans binaire stocké → binary_unavailable, sans réserver', async () => {
    const outcome = await replayUnmatchedCv({
      row: makeRow({ storage_path: null }),
      campaign: makeCampaign(),
      actor: 'user',
    });
    expect(outcome).toEqual({ kind: 'binary_unavailable' });
    expect(reserveUnmatchedReplay).not.toHaveBeenCalled();
  });

  it('download KO → revert + download_failed', async () => {
    vi.mocked(downloadArtifact).mockResolvedValue(null as never);
    const outcome = await replayUnmatchedCv({
      row: makeRow(),
      campaign: makeCampaign(),
      actor: 'user',
    });
    expect(outcome).toEqual({ kind: 'download_failed' });
    expect(revertUnmatchedReplay).toHaveBeenCalledWith('row-1');
  });

  it('traitement KO → revert, ligne re-rejouable', async () => {
    vi.mocked(processEmailAttachment).mockRejectedValue(new Error('boom'));
    const outcome = await replayUnmatchedCv({
      row: makeRow(),
      campaign: makeCampaign(),
      actor: 'user',
    });
    expect(outcome).toMatchObject({ kind: 'failed', retryable: false });
    expect(revertUnmatchedReplay).toHaveBeenCalledWith('row-1');
    expect(appendJournalEntry).not.toHaveBeenCalled();
  });
});

describe('drainPendingSheetCvs', () => {
  it('ne draine PAS une campagne inéligible (fiche non validée)', async () => {
    await drainPendingSheetCvs(makeCampaign({ isValidated: false }));
    expect(listPendingSheetCvs).not.toHaveBeenCalled();
  });

  it('draine chaque ligne séquentiellement, un échec ne bloque pas les suivantes', async () => {
    const rows = [makeRow({ id: 'row-1' }), makeRow({ id: 'row-2', uid: '43' })];
    vi.mocked(listPendingSheetCvs).mockResolvedValue(rows);
    vi.mocked(processEmailAttachment)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    await drainPendingSheetCvs(makeCampaign());
    expect(processEmailAttachment).toHaveBeenCalledTimes(2);
    expect(revertUnmatchedReplay).toHaveBeenCalledWith('row-1');
    expect(appendJournalEntry).toHaveBeenCalledTimes(1);
  });

  it('file vide → no-op silencieux', async () => {
    vi.mocked(listPendingSheetCvs).mockResolvedValue([]);
    await drainPendingSheetCvs(makeCampaign());
    expect(reserveUnmatchedReplay).not.toHaveBeenCalled();
  });

  it('panne DB (migration absente) → loggée, jamais levée', async () => {
    vi.mocked(listPendingSheetCvs).mockRejectedValue(
      new Error('column reason does not exist'),
    );
    await expect(drainPendingSheetCvs(makeCampaign())).resolves.toBeUndefined();
  });
});
