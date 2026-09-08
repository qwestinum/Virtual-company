/**
 * Le service — l'ordre réservation / appel / mise à jour.
 *
 * Ce qui se joue ici n'est pas la logique ADEP (elle est testée sur le
 * publisher) mais la DISCIPLINE : on réserve avant d'appeler, un conflit de
 * réservation n'envoie rien, et un doute laisse la ligne dans un état qui
 * interdit le rejeu automatique.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/repos/job-postings', () => ({
  listJobPostings: vi.fn(),
  getCurrentJobPosting: vi.fn(),
  reserveJobPosting: vi.fn(),
  patchJobPosting: vi.fn(),
  findByClientReference: vi.fn(),
  listLiveJobPostings: vi.fn(),
}));
vi.mock('@/lib/db/repos/recruiters', () => ({ getAdepNumeroDossier: vi.fn() }));

import {
  getCurrentJobPosting,
  listJobPostings,
  patchJobPosting,
  reserveJobPosting,
  type JobPosting,
} from '@/lib/db/repos/job-postings';
import { getAdepNumeroDossier } from '@/lib/db/repos/recruiters';

import { MockAdepTransport } from '../mock-transport';
import {
  AdepCredentialsError,
  isAdepEnabled,
  publishToAdep,
  resolveAdepCredentials,
  resolveTransport,
  transitionAdepPosting,
} from '../service';
import { SAMPLE_CREDENTIALS, SAMPLE_OFFER } from './fixtures/sample-offer';

const list = vi.mocked(listJobPostings);
const current = vi.mocked(getCurrentJobPosting);
const reserve = vi.mocked(reserveJobPosting);
const patch = vi.mocked(patchJobPosting);
const numeroDossier = vi.mocked(getAdepNumeroDossier);

function posting(patchIn: Partial<JobPosting> = {}): JobPosting {
  return {
    id: 'JOBP-CAMP-2026-288',
    campaignId: 'CAMP-2026-288',
    channel: 'apec',
    clientReference: 'CAMP-2026-288',
    apecPositionNumero: null,
    attemptState: 'reserved',
    trackingId: 'trk',
    requestSnapshot: null,
    requestXml: null,
    ackRaw: null,
    remoteStatus: null,
    remoteStatusAt: null,
    remoteIsEditable: null,
    remoteUrl: null,
    publishedAt: null,
    suspendedAt: null,
    closedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: '2026-09-08T09:00:00.000Z',
    updatedAt: '2026-09-08T09:00:00.000Z',
    ...patchIn,
  };
}

const OFFER = (() => {
  const { clientPositionId: _r, trackingId: _t, ...rest } = SAMPLE_OFFER;
  return rest;
})();

beforeEach(() => {
  vi.clearAllMocks();
  list.mockResolvedValue([]);
  reserve.mockResolvedValue({ kind: 'reserved', posting: posting() });
  patch.mockImplementation(async (_id, p) => posting(p as Partial<JobPosting>));
});

function deps(transport: MockAdepTransport) {
  return {
    transport,
    credentials: async () => SAMPLE_CREDENTIALS,
    trackingId: () => 'trk-test',
    now: () => new Date('2026-09-08T10:00:00Z'),
  };
}

describe('ordre des opérations', () => {
  it('réserve AVANT d’appeler l’Apec', async () => {
    const transport = new MockAdepTransport({ numeros: ['177596708W'] });
    const order: string[] = [];
    reserve.mockImplementation(async () => {
      order.push('reserve');
      return { kind: 'reserved', posting: posting() };
    });
    const originalPost = transport.post.bind(transport);
    transport.post = async (req) => {
      order.push(`post:${req.operation}`);
      return originalPost(req);
    };

    await publishToAdep({
      campaignId: 'CAMP-2026-288',
      ownerUserId: 'u-1',
      offer: OFFER,
      deps: deps(transport),
    });

    // La réservation est le verrou : après l'appel, elle ne sérialiserait
    // plus rien, et deux instances créeraient deux offres.
    expect(order[0]).toBe('reserve');
    expect(order[1]).toBe('post:openPosition');
  });

  it('marque la ligne acquittée, avec le numéro Apec', async () => {
    const transport = new MockAdepTransport({ numeros: ['177596708W'] });
    const result = await publishToAdep({
      campaignId: 'CAMP-2026-288',
      ownerUserId: 'u-1',
      offer: OFFER,
      deps: deps(transport),
    });

    expect(result.outcome.kind).toBe('published');
    expect(patch).toHaveBeenCalledWith(
      'JOBP-CAMP-2026-288',
      expect.objectContaining({
        attemptState: 'acknowledged',
        apecPositionNumero: '177596708W',
      }),
    );
  });
});

describe('conflit de réservation', () => {
  it('n’envoie RIEN quand la référence est déjà réservée', async () => {
    // Deux instances serverless concurrentes : le perdant doit s'arrêter net.
    const transport = new MockAdepTransport();
    reserve.mockResolvedValue({ kind: 'taken', existing: posting() });

    const result = await publishToAdep({
      campaignId: 'CAMP-2026-288',
      ownerUserId: 'u-1',
      offer: OFFER,
      deps: deps(transport),
    });

    expect(result.outcome.kind).toBe('uncertain');
    expect(transport.countOf('openPosition')).toBe(0);
  });
});

describe('après un incident', () => {
  it('un doute laisse la ligne en « sent » — jamais « failed »', async () => {
    // `failed` inviterait à republier ; or on ne SAIT PAS si l'offre existe.
    // La ligne doit dire « envoyé, issue inconnue » pour que l'écran envoie
    // vérifier chez l'Apec plutôt que proposer un nouveau bouton.
    const transport = new MockAdepTransport({
      failures: { openPosition: [{ kind: 'timeout' }], getPositionStatus: [{ kind: 'timeout' }] },
    });

    const result = await publishToAdep({
      campaignId: 'CAMP-2026-288',
      ownerUserId: 'u-1',
      offer: OFFER,
      deps: deps(transport),
    });

    expect(result.outcome.kind).toBe('uncertain');
    expect(patch).toHaveBeenCalledWith(
      'JOBP-CAMP-2026-288',
      expect.objectContaining({ attemptState: 'sent' }),
    );
  });

  it('une reprise réussie est enregistrée comme une publication', async () => {
    const transport = new MockAdepTransport({
      numeros: ['177596708W'],
      failures: { openPosition: [{ kind: 'timeout' }] },
    });

    const result = await publishToAdep({
      campaignId: 'CAMP-2026-288',
      ownerUserId: 'u-1',
      offer: OFFER,
      deps: deps(transport),
    });

    expect(result.outcome.kind).toBe('already_published');
    expect(patch).toHaveBeenCalledWith(
      'JOBP-CAMP-2026-288',
      expect.objectContaining({ attemptState: 'acknowledged', apecPositionNumero: '177596708W' }),
    );
    expect(transport.countOf('openPosition')).toBe(1);
  });
});

describe('référence de republication', () => {
  it('la première tentative porte l’identifiant de campagne', async () => {
    const transport = new MockAdepTransport();
    await publishToAdep({
      campaignId: 'CAMP-2026-288',
      ownerUserId: 'u-1',
      offer: OFFER,
      deps: deps(transport),
    });
    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({ clientReference: 'CAMP-2026-288' }),
    );
  });

  it('la suivante prend une référence NEUVE', async () => {
    // Réutiliser la référence d'une offre fermée rendrait API_390 : chez
    // l'Apec, une référence sert une fois pour toutes.
    list.mockResolvedValue([posting({ attemptState: 'failed' })]);
    const transport = new MockAdepTransport();
    await publishToAdep({
      campaignId: 'CAMP-2026-288',
      ownerUserId: 'u-1',
      offer: OFFER,
      deps: deps(transport),
    });
    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({ clientReference: 'CAMP-2026-288-2' }),
    );
  });
});

describe('le flux stocké est caviardé', () => {
  it('ni mot de passe ni numéro de dossier dans request_xml', async () => {
    const transport = new MockAdepTransport();
    await publishToAdep({
      campaignId: 'CAMP-2026-288',
      ownerUserId: 'u-1',
      offer: OFFER,
      deps: deps(transport),
    });
    const call = reserve.mock.calls[0]![0];
    expect(call.requestXml).not.toContain(SAMPLE_CREDENTIALS.atsPassword);
    expect(call.requestXml).not.toContain(SAMPLE_CREDENTIALS.numeroDossier);
    // Mais le reste doit rester diagnosticable.
    expect(call.requestXml).toContain('CAMP-2026-288');
  });
});

describe('transitions', () => {
  it('dépublie la tentative courante et met le cache à jour', async () => {
    const transport = new MockAdepTransport({
      seed: [
        {
          clientPositionId: 'CAMP-2026-288',
          apecPositionNumero: '177596708W',
          status: 'PUBLIEE',
          isEditable: true,
          positionUrl: 'https://www.apec.fr/…',
        },
      ],
    });
    current.mockResolvedValue(
      posting({ attemptState: 'acknowledged', apecPositionNumero: '177596708W', remoteStatus: 'PUBLIEE' }),
    );

    const result = await transitionAdepPosting({
      campaignId: 'CAMP-2026-288',
      ownerUserId: 'u-1',
      action: 'suspend',
      deps: deps(transport),
    });

    expect(result.outcome.kind).toBe('changed');
    expect(patch).toHaveBeenCalledWith(
      'JOBP-CAMP-2026-288',
      expect.objectContaining({ remoteStatus: 'SUSPENDUE' }),
    );
  });

  it('dit franchement qu’il n’y a rien à dépublier', async () => {
    current.mockResolvedValue(null);
    const result = await transitionAdepPosting({
      campaignId: 'CAMP-2026-288',
      ownerUserId: 'u-1',
      action: 'suspend',
      deps: deps(new MockAdepTransport()),
    });
    expect(result.outcome.kind).toBe('unavailable');
  });
});

describe('identité d’appel', () => {
  const ENV = {
    ADEP_ATS_ID: '50',
    ADEP_ATS_PASSWORD_HASH: 'x'.repeat(342),
  };

  it('prend le numéro de dossier du recruteur référent', async () => {
    numeroDossier.mockResolvedValue('123456789W');
    const creds = await resolveAdepCredentials('u-1', ENV);
    expect(creds.numeroDossier).toBe('123456789W');
    expect(numeroDossier).toHaveBeenCalledWith('u-1');
  });

  it('accepte le numéro de test HORS production', async () => {
    numeroDossier.mockResolvedValue(null);
    const creds = await resolveAdepCredentials(null, {
      ...ENV,
      ADEP_TEST_NUMERO_DOSSIER: '999999999W',
    });
    expect(creds.numeroDossier).toBe('999999999W');
  });

  it('IGNORE le numéro de test dès que ADEP_ENABLED vaut 1', async () => {
    // Sinon un numéro de test partirait en production sous l'identité d'un
    // recruteur réel, et les candidatures arriveraient chez quelqu'un d'autre.
    numeroDossier.mockResolvedValue(null);
    await expect(
      resolveAdepCredentials(null, {
        ...ENV,
        ADEP_ENABLED: '1',
        ADEP_TEST_NUMERO_DOSSIER: '999999999W',
      }),
    ).rejects.toThrow(AdepCredentialsError);
  });

  it('dit ce qui manque plutôt que de partir sans identité', async () => {
    numeroDossier.mockResolvedValue(null);
    await expect(resolveAdepCredentials('u-1', { ADEP_ATS_PASSWORD_HASH: 'x' })).rejects.toThrow(
      /ADEP_ATS_ID/,
    );
  });
});

describe('le drapeau', () => {
  it('est fail-closed strict', () => {
    expect(isAdepEnabled({ ADEP_ENABLED: '1' })).toBe(true);
    for (const value of ['', '0', 'true', 'yes', undefined]) {
      expect(isAdepEnabled({ ADEP_ENABLED: value })).toBe(false);
    }
  });

  it('sans drapeau, le transport est le mock, et c’est DIT', () => {
    const resolved = resolveTransport({});
    expect(resolved.simulated).toBe(true);
    expect(resolved.transport).toBeInstanceOf(MockAdepTransport);
  });

  it('avec le drapeau, le transport est RÉEL — jamais le mock', () => {
    const resolved = resolveTransport(
      {},
      { ADEP_ENABLED: '1', ADEP_WSDL_URL: 'https://testadepsep.apec.fr/v5/positions?wsdl' },
    );
    expect(resolved.simulated).toBe(false);
    expect(resolved.transport).not.toBeInstanceOf(MockAdepTransport);
  });

  it('avec le drapeau et sans URL, il ÉCHOUE — jamais de repli sur le mock', () => {
    // Retomber sur le mock rendrait un faux succès sur une offre réelle : le
    // recruteur croirait son poste diffusé.
    expect(() => resolveTransport({}, { ADEP_ENABLED: '1' })).toThrow(/ADEP_WSDL_URL/);
  });
});
