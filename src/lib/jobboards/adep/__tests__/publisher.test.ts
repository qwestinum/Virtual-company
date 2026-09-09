/**
 * L'adaptateur ADEP, derrière le port, sur le transport de recette.
 *
 * Tout ce qui est exercé ici est du code de PRODUCTION : construction du flux
 * SEP, lecture de l'acquittement, reconnaissance du « ça existe déjà »,
 * enchaînement de reprise. Seules les chaînes XML qui viendraient du réseau
 * sont rejouées.
 *
 * Le test qui porte le lot est « le scénario du délai dépassé » : il compte les
 * `openPosition`. Un connecteur qui en fait deux crée deux offres sur apec.fr,
 * et l'Apec n'a aucun moyen de les fusionner.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MockAdepTransport } from '../mock-transport';
import { AdepSepPublisher, defaultTrackingId } from '../publisher';
import { AdepTransportError, type AdepTransport } from '../transport';
import {
  SAMPLE_CREDENTIALS,
  SAMPLE_OFFER,
  SAMPLE_OFFER_BROKER,
} from './fixtures/sample-offer';

const REFERENCE = SAMPLE_OFFER.clientPositionId;

function publisherOn(transport: AdepTransport) {
  return new AdepSepPublisher({
    transport,
    credentials: async () => SAMPLE_CREDENTIALS,
    // Déterministe : un identifiant de transaction basé sur l'horloge rendrait
    // les assertions instables sans rien prouver de plus.
    trackingId: (ref) => `test-${ref}`,
  });
}

describe('publication nominale', () => {
  it('rend le numéro Apec', async () => {
    const transport = new MockAdepTransport({ numeros: ['177596708W'] });
    const outcome = await publisherOn(transport).publish(SAMPLE_OFFER);

    expect(outcome).toEqual({
      kind: 'published',
      remoteId: '177596708W',
      status: null,
    });
    expect(transport.countOf('openPosition')).toBe(1);
  });

  it('fonctionne en mode client indirect — le mode cible', async () => {
    const transport = new MockAdepTransport();
    const outcome = await publisherOn(transport).publish(SAMPLE_OFFER_BROKER);
    expect(outcome.kind).toBe('published');
  });

  it('n’appelle PAS getPositionStatus quand tout se passe bien', async () => {
    // Une lecture de contrôle systématique doublerait le coût de chaque
    // publication sans rien apprendre : le numéro est déjà dans l'acquittement.
    const transport = new MockAdepTransport();
    await publisherOn(transport).publish(SAMPLE_OFFER);
    expect(transport.countOf('getPositionStatus')).toBe(0);
  });
});

describe('LE SCÉNARIO : délai dépassé après création', () => {
  it('ne rejoue JAMAIS openPosition, va lire, et retrouve l’offre', async () => {
    // L'Apec a créé l'offre ; la réponse s'est perdue. C'est le cas où un
    // rejeu naïf produit un doublon indélébile.
    const transport = new MockAdepTransport({
      numeros: ['177596708W'],
      failures: { openPosition: [{ kind: 'timeout' }] },
    });

    const outcome = await publisherOn(transport).publish(SAMPLE_OFFER);

    expect(outcome).toEqual({
      kind: 'already_published',
      remoteId: '177596708W',
      recovered: true,
      status: expect.objectContaining({
        apecPositionNumero: '177596708W',
        clientPositionId: REFERENCE,
        status: 'PUBLIEE',
      }),
    });
    // LA mesure du lot.
    expect(transport.countOf('openPosition')).toBe(1);
    expect(transport.countOf('getPositionStatus')).toBe(1);
    // Et l'Apec n'a bien qu'une offre.
    expect(transport.positions.size).toBe(1);
  });

  it('la lecture se fait par la RÉFÉRENCE CLIENT — le numéro n’est pas connu', async () => {
    // C'est tout l'intérêt d'avoir choisi la référence comme clé
    // d'idempotence : après un délai dépassé, on n'a rien d'autre en main.
    const transport = new MockAdepTransport({
      failures: { openPosition: [{ kind: 'timeout' }] },
    });
    await publisherOn(transport).publish(SAMPLE_OFFER);
    const lookup = transport.calls.find((c) => c.operation === 'getPositionStatus');
    expect(lookup?.clientReference).toBe(REFERENCE);
  });
});

describe('le réseau tombe AVANT l’envoi', () => {
  it('rend unavailable — c’est le seul cas rejouable tel quel', async () => {
    const transport = new MockAdepTransport({
      failures: { openPosition: [{ kind: 'not_sent', message: 'DNS injoignable.' }] },
    });
    const outcome = await publisherOn(transport).publish(SAMPLE_OFFER);

    expect(outcome).toEqual({ kind: 'unavailable', reason: 'DNS injoignable.' });
    // Rien n'a été créé, et on n'a même pas eu besoin d'aller vérifier.
    expect(transport.positions.size).toBe(0);
    expect(transport.countOf('getPositionStatus')).toBe(0);
  });

  it('un transport qui ne SAIT PAS est traité comme un doute', async () => {
    // `certainlyNotSent` par défaut à `false` : au moindre doute sur l'origine
    // de la panne, on réconcilie. Même règle conservatrice que le poller IMAP.
    const transport: AdepTransport = {
      post: async () => {
        throw new AdepTransportError('Coupure.', false);
      },
    };
    const outcome = await publisherOn(transport).publish(SAMPLE_OFFER);
    // La lecture échoue aussi (le transport est mort) ⇒ personne ne rejoue.
    expect(outcome.kind).toBe('uncertain');
  });
});

describe('référence déjà prise (API_390)', () => {
  it('n’est pas un échec quand l’offre est la nôtre', async () => {
    const transport = new MockAdepTransport({
      seed: [
        {
          clientPositionId: REFERENCE,
          apecPositionNumero: '177596708W',
          status: 'PUBLIEE',
          isEditable: true,
          positionUrl: 'https://www.apec.fr/…/177596708W',
        },
      ],
    });
    const outcome = await publisherOn(transport).publish(SAMPLE_OFFER);

    expect(outcome.kind).toBe('already_published');
    if (outcome.kind === 'already_published') {
      expect(outcome.remoteId).toBe('177596708W');
      expect(outcome.recovered).toBe(true);
    }
    expect(transport.countOf('openPosition')).toBe(1);
  });

  it('EST un refus quand la lecture ne retrouve rien', async () => {
    // La référence appartient à une offre qu'on ne voit pas (autre compte,
    // historique). Il faut une nouvelle référence, pas une reprise — et le
    // dire, plutôt que de rendre un `already_published` mensonger.
    const stub = new MockAdepTransport();
    const publisher = new AdepSepPublisher({
      transport: {
        post: async (request) => {
          if (request.operation === 'openPosition') {
            const { MOCK_ACKS } = await import('../mock-transport');
            return MOCK_ACKS.fatal390();
          }
          return stub.post(request); // getPositionStatus ⇒ « inconnue »
        },
      },
      credentials: async () => SAMPLE_CREDENTIALS,
      trackingId: (ref) => `test-${ref}`,
    });

    const outcome = await publisher.publish(SAMPLE_OFFER);
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind === 'rejected') {
      expect(outcome.issues[0]?.code).toBe('390');
      expect(outcome.issues[0]?.message).toContain('déjà utilisée');
    }
  });
});

describe('refus par l’Apec', () => {
  it('traduit une exception Fatal en messages montrables', async () => {
    const { MOCK_ACKS } = await import('../mock-transport');
    const publisher = publisherOn({
      post: async () => MOCK_ACKS.fatal330(),
    });
    const outcome = await publisher.publish(SAMPLE_OFFER_BROKER);

    expect(outcome.kind).toBe('rejected');
    if (outcome.kind === 'rejected') {
      expect(outcome.issues).toHaveLength(1);
      expect(outcome.issues[0]).toMatchObject({
        code: '330',
        blocking: true,
      });
      expect(outcome.issues[0]?.message).toContain('client indirect');
      expect(outcome.issues[0]?.message).not.toContain('API_330');
    }
  });

  it('un acquittement à Warning seul est un SUCCÈS, remarques conservées', async () => {
    const { MOCK_ACKS } = await import('../mock-transport');
    const publisher = publisherOn({ post: async () => MOCK_ACKS.warningOnly() });
    const outcome = await publisher.publish(SAMPLE_OFFER);

    expect(outcome.kind).toBe('published');
    if (outcome.kind === 'published') expect(outcome.remoteId).toBe('177596708W');
  });

  it('un acquittement sans exception ET sans numéro ne conclut PAS', async () => {
    // L'Apec ne dit pas ce qu'elle a fait : on va voir, plutôt que d'inventer
    // un succès sans identifiant — qui laisserait une offre orpheline.
    const stub = new MockAdepTransport();
    const publisher = new AdepSepPublisher({
      transport: {
        post: async (request) =>
          request.operation === 'openPosition'
            ? '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
              '<soap:Body><openPositionResponse/></soap:Body></soap:Envelope>'
            : stub.post(request),
      },
      credentials: async () => SAMPLE_CREDENTIALS,
      trackingId: (ref) => `test-${ref}`,
    });

    const outcome = await publisher.publish(SAMPLE_OFFER);
    expect(outcome.kind).toBe('unavailable'); // vérifié : rien n'existe
  });
});

describe('lecture du statut', () => {
  it('rend l’état, le lien public et l’éditabilité', async () => {
    const transport = new MockAdepTransport({ numeros: ['177596708W'] });
    const publisher = publisherOn(transport);
    await publisher.publish(SAMPLE_OFFER);

    const status = await publisher.getStatus({ clientReference: REFERENCE });
    expect(status.kind).toBe('found');
    if (status.kind === 'found') {
      expect(status.status.status).toBe('PUBLIEE');
      expect(status.status.positionUrl).toContain('177596708W');
      expect(status.status.isEditable).toBe(true);
    }
  });

  it('« référence inconnue » est une réponse VALIDE, pas une panne', async () => {
    // API_391 arrive en faute de service (le schéma exige au moins un
    // `onePosition`, « rien trouvé » ne peut donc pas être une réponse vide).
    // Le confondre avec une panne ferait croire l'Apec en carafe.
    const status = await publisherOn(new MockAdepTransport()).getStatus({
      clientReference: 'CAMP-2026-999',
    });
    expect(status).toEqual({ kind: 'not_found' });
  });

  it('une vraie panne reste une panne', async () => {
    const status = await publisherOn({
      post: async () => {
        throw new AdepTransportError('Passerelle indisponible.', false);
      },
    }).getStatus({ clientReference: REFERENCE });
    expect(status).toEqual({ kind: 'unavailable', reason: 'Passerelle indisponible.' });
  });
});

describe('dépublier et republier', () => {
  it('dépublie, et relit l’état chez l’Apec', async () => {
    const transport = new MockAdepTransport({ numeros: ['177596708W'] });
    const publisher = publisherOn(transport);
    await publisher.publish(SAMPLE_OFFER);

    const outcome = await publisher.suspend({ clientReference: REFERENCE });
    expect(outcome.kind).toBe('changed');
    if (outcome.kind === 'changed') {
      // On affiche ce que l'Apec DIT, pas ce que nous avons demandé.
      expect(outcome.status?.status).toBe('SUSPENDUE');
    }
  });

  it('republie une offre suspendue', async () => {
    const transport = new MockAdepTransport({ numeros: ['177596708W'] });
    const publisher = publisherOn(transport);
    await publisher.publish(SAMPLE_OFFER);
    await publisher.suspend({ clientReference: REFERENCE });

    const outcome = await publisher.republish({ clientReference: REFERENCE });
    expect(outcome.kind).toBe('changed');
    if (outcome.kind === 'changed') expect(outcome.status?.status).toBe('PUBLIEE');
  });

  it('« déjà dans cet état » n’est pas une erreur', async () => {
    const transport = new MockAdepTransport();
    const publisher = publisherOn(transport);
    await publisher.publish(SAMPLE_OFFER);

    const outcome = await publisher.republish({ clientReference: REFERENCE });
    expect(outcome).toEqual({ kind: 'already_in_state' });
  });

  it('une transition interdite est un REFUS traduit, pas une panne', async () => {
    const transport = new MockAdepTransport({
      seed: [
        {
          clientPositionId: REFERENCE,
          apecPositionNumero: '177596708W',
          status: 'FERMEE',
          isEditable: false,
          positionUrl: 'https://www.apec.fr/…/177596708W',
        },
      ],
    });
    const outcome = await publisherOn(transport).republish({
      clientReference: REFERENCE,
    });

    expect(outcome.kind).toBe('refused');
    if (outcome.kind === 'refused') {
      expect(outcome.issues[0]?.code).toBe('352');
      expect(outcome.issues[0]?.message).toContain('pas autorisé');
    }
  });

  it('la fenêtre de republication fermée se dit en français', async () => {
    // API_361 : au-delà de 30 jours, l'Apec refuse. C'est le vrai sens du
    // « J+30 », et le message doit dire quoi faire.
    const outcome = await publisherOn({
      post: async () =>
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
        '<soap:Fault><faultstring>API_361_INVALID_PUBLICATION_DELAYS</faultstring></soap:Fault>' +
        '</soap:Body></soap:Envelope>',
    }).republish({ clientReference: REFERENCE });

    expect(outcome.kind).toBe('refused');
    if (outcome.kind === 'refused') {
      expect(outcome.issues[0]?.message).toContain('30 jours');
      expect(outcome.issues[0]?.message).toContain('nouvelle offre');
    }
  });

  it('un incident de transport ne prétend pas avoir changé l’état', async () => {
    const outcome = await publisherOn({
      post: async () => {
        throw new AdepTransportError('Délai dépassé.', false);
      },
    }).suspend({ clientReference: REFERENCE });
    expect(outcome.kind).toBe('unavailable');
  });
});

describe('identifiant de transaction', () => {
  it('est différent à chaque requête', () => {
    // API_108 sinon. Deux appels dans la même milliseconde sont improbables,
    // mais on vérifie surtout que la référence y figure — c'est ce qui rend
    // un incident traçable dans les journaux de l'Apec.
    const id = defaultTrackingId('CAMP-2026-288');
    expect(id).toContain('CAMP-2026-288');
    expect(id.startsWith('orqa-')).toBe(true);
  });

  it('ne contient AUCUN caractère interdit par l’Apec', () => {
    // Les deux-points sont interdits : un horodatage ISO serait refusé.
    expect(defaultTrackingId('CAMP-2026-288')).not.toContain(':');
    expect(defaultTrackingId('CAMP-2026-288').length).toBeLessThanOrEqual(100);
  });
});

describe('defaultTrackingId', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rend un identifiant différent à chaque appel, même horloge figée', () => {
    // L'unicité est une exigence de l'Apec (API_108), pas une commodité : deux
    // appels d'une même publication peuvent tomber dans la même milliseconde.
    vi.spyOn(Date, 'now').mockReturnValue(1_757_000_000_000);

    const first = defaultTrackingId(REFERENCE);
    const second = defaultTrackingId(REFERENCE);

    expect(second).not.toBe(first);
  });

  it('reste dans ce que l’Apec accepte', () => {
    const id = defaultTrackingId(REFERENCE);

    // 100 caractères (API_105), et aucun des caractères interdits — les
    // deux-points au premier chef.
    expect(id.length).toBeLessThanOrEqual(100);
    expect(id).toMatch(/^[A-Za-z0-9-]+$/);
  });
});
