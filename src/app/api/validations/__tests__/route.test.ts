/**
 * `GET /api/validations` — enrichissement « référent » de la file.
 *
 * Le référent affiché sur chaque carte est celui de la CAMPAGNE
 * (`campaigns.owner_user_id` → `recruiters`) : il n'existe aucune assignation
 * portée par la validation, et on n'en introduit pas.
 *
 * Ce qui est tenu ici :
 *   - UNE passe pour toute la page (les campagnes distinctes, une fois), et
 *     jamais une requête par carte ;
 *   - un recruteur DÉSACTIVÉ est rendu tel quel, `isActive: false` — c'est
 *     l'affichage qui en fait « référent non défini », pas la couche données,
 *     sans quoi on ne saurait plus distinguer « désactivé » de « jamais
 *     désigné » ;
 *   - FAIL-SOFT : une panne de l'enrichissement ne doit JAMAIS emporter la
 *     file. Le filtre est un confort de lecture, les dossiers sont le métier.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-api-user', () => ({ getApiUser: vi.fn() }));
vi.mock('@/lib/db/repos/pending-validations', () => ({
  getPendingValidation: vi.fn(),
  listPendingValidations: vi.fn(),
  listSentValidations: vi.fn(),
  upsertPendingValidation: vi.fn(),
}));
vi.mock('@/lib/db/repos/candidate-analyses', () => ({
  listAllCandidateAnalyses: vi.fn(),
}));
vi.mock('@/lib/db/repos/campaigns', () => ({ listCampaignSummaries: vi.fn() }));
vi.mock('@/lib/db/repos/recruiters', () => ({ listRecruiters: vi.fn() }));

import { GET } from '@/app/api/validations/route';
import { getApiUser } from '@/lib/auth/require-api-user';
import { listAllCandidateAnalyses } from '@/lib/db/repos/candidate-analyses';
import { listCampaignSummaries } from '@/lib/db/repos/campaigns';
import { listPendingValidations } from '@/lib/db/repos/pending-validations';
import { listRecruiters } from '@/lib/db/repos/recruiters';
import type { PendingValidation } from '@/types/hitl';

const queue = vi.mocked(listPendingValidations);
const owners = vi.mocked(listCampaignSummaries);

/** Projection minimale servie par `listCampaignSummaries`. */
function summary(id: string, ownerUserId: string | null) {
  return { id, name: `Campagne ${id}`, ownerUserId, schedulingNative: false };
}
const recruiters = vi.mocked(listRecruiters);
const analyses = vi.mocked(listAllCandidateAnalyses);
const user = vi.mocked(getApiUser);

function validation(id: string, campaignId: string): PendingValidation {
  return {
    id,
    campaignId,
    candidateName: 'Candidat Test',
    candidateEmail: 'candidat@example.test',
    score: 72,
    decision: 'reject',
    cvArtifactId: null,
    reportArtifactId: null,
    mailDraftArtifactId: null,
    confirmed: false,
    status: 'pending',
    payload: { uid: `uid-${id}` },
    createdAt: '2026-08-27T09:00:00.000Z',
    updatedAt: '2026-08-27T09:00:00.000Z',
    decidedAt: null,
    decidedBy: null,
    decidedByUser: null,
  };
}

function recruiter(id: string, displayName: string, isActive: boolean) {
  return {
    id,
    displayName,
    email: `${id}@example.test`,
    calcomLink: null,
    role: 'member' as const,
    isActive,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const request = new Request('http://localhost/api/validations');

beforeEach(() => {
  vi.clearAllMocks();
  analyses.mockResolvedValue([]);
  owners.mockResolvedValue(new Map());
  recruiters.mockResolvedValue([]);
  user.mockResolvedValue(null);
});

describe('GET /api/validations — contexte référent', () => {
  it('résout le référent de chaque campagne en UNE passe', async () => {
    queue.mockResolvedValue([
      validation('val-1', 'CAMP-2026-001'),
      validation('val-2', 'CAMP-2026-001'),
      validation('val-3', 'CAMP-2026-002'),
    ]);
    owners.mockResolvedValue(
      new Map([
        ['CAMP-2026-001', summary('CAMP-2026-001', 'u-sarah')],
        ['CAMP-2026-002', summary('CAMP-2026-002', null)],
      ]),
    );
    recruiters.mockResolvedValue([recruiter('u-sarah', 'Sarah Dupont', true)]);

    const json = await (await GET(request)).json();

    // Une seule résolution de campagnes, sur les ids DISTINCTS.
    expect(owners).toHaveBeenCalledTimes(1);
    expect(owners.mock.calls[0][0]).toEqual(['CAMP-2026-001', 'CAMP-2026-002']);
    expect(recruiters).toHaveBeenCalledTimes(1);
    expect(json.referentByCampaign).toEqual({
      'CAMP-2026-001': {
        id: 'u-sarah',
        displayName: 'Sarah Dupont',
        isActive: true,
      },
      'CAMP-2026-002': null,
    });
  });

  it('rend un recruteur DÉSACTIVÉ avec isActive:false (pas un null muet)', async () => {
    queue.mockResolvedValue([validation('val-1', 'CAMP-2026-003')]);
    owners.mockResolvedValue(
      new Map([['CAMP-2026-003', summary('CAMP-2026-003', 'u-yann')]]),
    );
    recruiters.mockResolvedValue([recruiter('u-yann', 'Yann Bernard', false)]);

    const json = await (await GET(request)).json();

    expect(json.referentByCampaign['CAMP-2026-003']).toEqual({
      id: 'u-yann',
      displayName: 'Yann Bernard',
      isActive: false,
    });
    // La validation reste servie, donc visible et actionnable.
    expect(json.validations).toHaveLength(1);
  });

  it('rend null quand la campagne est inconnue du référentiel', async () => {
    queue.mockResolvedValue([validation('val-1', 'CAMP-2026-404')]);
    owners.mockResolvedValue(new Map());

    const json = await (await GET(request)).json();
    expect(json.referentByCampaign['CAMP-2026-404']).toBeNull();
  });

  it('rend l’identité du lecteur pour le raccourci « Mes campagnes »', async () => {
    queue.mockResolvedValue([validation('val-1', 'CAMP-2026-001')]);
    // @ts-expect-error — projection minimale : la route ne lit que `id`.
    user.mockResolvedValue({ id: 'u-sarah' });

    const json = await (await GET(request)).json();
    expect(json.currentUserId).toBe('u-sarah');
  });

  it('FAIL-SOFT : une panne de l’enrichissement ne fait pas perdre la file', async () => {
    queue.mockResolvedValue([validation('val-1', 'CAMP-2026-001')]);
    owners.mockRejectedValue(new Error('db down'));
    const silence = vi.spyOn(console, 'error').mockImplementation(() => {});

    const json = await (await GET(request)).json();

    expect(json.validations).toHaveLength(1);
    expect(json.referentByCampaign).toEqual({});
    expect(json.currentUserId).toBeNull();
    silence.mockRestore();
  });

  it('n’interroge pas les campagnes quand la file est vide', async () => {
    queue.mockResolvedValue([]);
    const json = await (await GET(request)).json();
    expect(json.referentByCampaign).toEqual({});
    expect(owners).toHaveBeenCalledWith([]);
  });
});
