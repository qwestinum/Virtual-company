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

import { MOCK_ACKS, MockAdepTransport } from '../mock-transport';
import {
  AdepCredentialsError,
  isAdepEnabled,
  publishToAdep,
  resolveAdepCredentials,
  resolveTransport,
  refreshAdepStatus,
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

describe('statut juste après la publication', () => {
  it('enchaîne une LECTURE : le statut est daté, jamais blanc', async () => {
    // `openPosition` acquitte, il ne renseigne pas l'état de l'offre — son
    // acquittement ne porte qu'un numéro. Sans cette lecture, l'écran affichait
    // « inconnu » juste après un succès, ce qui se lit comme un échec.
    const transport = new MockAdepTransport({ numeros: ['177596708W'] });
    await publishToAdep({
      campaignId: 'CAMP-2026-288',
      ownerUserId: 'u-1',
      offer: OFFER,
      deps: deps(transport),
    });

    expect(transport.calls.map((c) => c.operation)).toEqual([
      'openPosition',
      'getPositionStatus',
    ]);
    expect(patch).toHaveBeenCalledWith(
      'JOBP-CAMP-2026-288',
      expect.objectContaining({
        attemptState: 'acknowledged',
        remoteStatus: expect.any(String),
        remoteStatusAt: expect.any(String),
      }),
    );
  });

  it('une lecture qui échoue n’emporte PAS la publication réussie', async () => {
    // L'offre existe chez l'Apec et son numéro est en base : faire échouer la
    // publication parce que la relecture a raté serait perdre cette vérité —
    // et la reprise reposterait une seconde offre.
    const transport = new MockAdepTransport({
      numeros: ['177596708W'],
      failures: { getPositionStatus: [{ kind: 'not_sent' }] },
    });
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
        // Jamais lu ⇒ l'écran dira « statut pas encore lu », pas « inconnu ».
        remoteStatusAt: null,
      }),
    );
  });
});

describe('le mock ne se souvient de rien d’une requête à l’autre', () => {
  // Défaut de recette : « Relire le statut » et « Dépublier » ne faisaient
  // RIEN. `resolveTransport` construit un `new MockAdepTransport()` VIERGE à
  // chaque appel de route ; l'offre publiée à la requête précédente n'existait
  // donc plus pour la suivante. Les tests ne l'avaient pas vu parce qu'ils
  // injectent la MÊME instance du début à la fin — ce que la vraie vie ne fait
  // jamais. La seule chose partagée entre deux requêtes est la BASE : le mock
  // doit donc être amorcé depuis `job_postings`.
  const LIVE = posting({
    apecPositionNumero: '177596708W',
    attemptState: 'acknowledged',
    remoteStatus: 'PUBLIEE',
    remoteStatusAt: '2026-09-08T09:00:00.000Z',
    publishedAt: '2026-09-08T09:00:00.000Z',
  });

  it('relire le statut d’une offre connue de la BASE la retrouve', async () => {
    current.mockResolvedValue(LIVE);
    const result = await refreshAdepStatus({
      campaignId: 'CAMP-2026-288',
      ownerUserId: 'u-1',
      // Pas de transport injecté : on prend le chemin RÉEL de la route, celui
      // qui fabrique son mock à partir de rien.
      deps: { credentials: async () => SAMPLE_CREDENTIALS, trackingId: () => 'trk' },
    });

    expect(result.simulated).toBe(true);
    expect(result.posting?.remoteStatus).toBe('PUBLIEE');
    expect(patch).toHaveBeenCalledWith(
      LIVE.id,
      expect.objectContaining({ remoteStatus: 'PUBLIEE' }),
    );
  });

  it('dépublier une offre connue de la BASE la dépublie', async () => {
    current.mockResolvedValue(LIVE);
    const result = await transitionAdepPosting({
      campaignId: 'CAMP-2026-288',
      ownerUserId: 'u-1',
      action: 'suspend',
      deps: { credentials: async () => SAMPLE_CREDENTIALS, trackingId: () => 'trk' },
    });

    expect(result.outcome.kind).toBe('changed');
    expect(patch).toHaveBeenCalledWith(
      LIVE.id,
      expect.objectContaining({ remoteStatus: 'SUSPENDUE' }),
    );
  });
});

describe('identifiant de transaction', () => {
  // Incident du 09/09/2026, en production de recette. L'Apec a refusé
  // l'`openPosition` (`API_103`, recruteur inconnu) ; le publisher est allé
  // lire pour savoir si une offre avait tout de même été créée ; cette lecture
  // repartait avec l'identifiant de transaction de l'envoi qui venait
  // d'échouer, et l'Apec l'a refusée (`API_108`). Résultat : `uncertain`, et
  // un opérateur envoyé vérifier à la main. Le défaut n'était pas dans le
  // publisher mais dans le service, qui figeait la fabrique d'identifiants.
  it('la vérification qui suit un envoi douteux ne rejoue pas l’identifiant de l’envoi', async () => {
    const transport = new MockAdepTransport({
      failures: { openPosition: [{ kind: 'respond', xml: MOCK_ACKS.soapFault() }] },
    });

    const result = await publishToAdep({
      campaignId: 'CAMP-2026-288',
      ownerUserId: 'u-1',
      offer: OFFER,
      // Aucun `trackingId` injecté : c'est la fabrique RÉELLE qu'on exerce,
      // celle que la route utilise. L'injecter ici masquerait exactement le
      // défaut qu'on veut tenir.
      deps: {
        transport,
        credentials: async () => SAMPLE_CREDENTIALS,
        now: () => new Date('2026-09-08T10:00:00Z'),
      },
    });

    expect(transport.calls.map((c) => c.operation)).toEqual([
      'openPosition',
      'getPositionStatus',
    ]);
    const [sent, checked] = transport.calls.map((c) => c.trackingId);
    expect(sent).toBeTruthy();
    expect(checked).toBeTruthy();
    expect(checked).not.toBe(sent);

    // Et la conséquence qui compte : la lecture ayant PU aboutir, on sait que
    // rien n'existe sous cette référence. L'envoi est rejouable tel quel, au
    // lieu de laisser la campagne dans le doute.
    expect(result.outcome.kind).toBe('unavailable');
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
