/**
 * Le transport HTTP : ce qu'il ose affirmer, et ce qu'il refuse de conclure.
 *
 * Tout tient dans `certainlyNotSent`. Le mettre à `true` à tort autorise un
 * rejeu, donc une seconde offre sur apec.fr que rien ne pourra fusionner.
 * Le mettre à `false` à tort ne coûte qu'une requête de vérification.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  adepEndpointHost,
  createHttpAdepTransport,
  endpointFromWsdlUrl,
} from '../http-transport';
import { AdepTransportError } from '../transport';
import { SOAP_ACTIONS } from '../namespaces';

const REQUEST = {
  operation: 'openPosition' as const,
  soapAction: SOAP_ACTIONS.openPosition,
  envelope: '<soapenv:Envelope/>',
};

function transportWith(impl: typeof fetch) {
  return createHttpAdepTransport({
    endpoint: 'https://testadepsep.apec.fr/v5/positions',
    fetchImpl: impl,
  });
}

describe('endpoint', () => {
  it('accepte l’URL avec ou sans ?wsdl', () => {
    // C'est celle-là qu'un exploitant a sous la main : elle est dans la
    // documentation, et c'est celle qu'on ouvre dans un navigateur.
    expect(endpointFromWsdlUrl('https://testadepsep.apec.fr/v5/positions?wsdl')).toBe(
      'https://testadepsep.apec.fr/v5/positions',
    );
    expect(endpointFromWsdlUrl('https://testadepsep.apec.fr/v5/positions')).toBe(
      'https://testadepsep.apec.fr/v5/positions',
    );
    expect(endpointFromWsdlUrl('  https://x/v5/positions?WSDL ')).toBe(
      'https://x/v5/positions',
    );
  });
});

describe('en-têtes', () => {
  it('pose le SOAPAction et le type SOAP 1.1', async () => {
    const impl = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('<Envelope/>', { status: 200 }),
    );
    await transportWith(impl as unknown as typeof fetch).post(REQUEST);
    const headers = impl.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers.SOAPAction).toBe('http://adep.apec.fr/hrxml/sep/openPosition');
    expect(headers['Content-Type']).toContain('text/xml');
  });

  it('n’envoie la requête QU’UNE FOIS — jamais de rejeu automatique', async () => {
    // `openPosition` n'est pas idempotent : un retry créerait une seconde
    // offre. La reprise est la réconciliation par référence, ailleurs.
    const impl = vi.fn(async () => {
      throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    });
    await expect(
      transportWith(impl as unknown as typeof fetch).post(REQUEST),
    ).rejects.toThrow(AdepTransportError);
    expect(impl).toHaveBeenCalledTimes(1);
  });
});

describe('classification des pannes', () => {
  const cases: Array<[string, string, boolean]> = [
    // Prouvent que RIEN n'est parti.
    ['DNS inexistant', 'ENOTFOUND', true],
    ['DNS temporaire', 'EAI_AGAIN', true],
    ['port fermé', 'ECONNREFUSED', true],
    // Ne prouvent rien : l'Apec a pu traiter.
    ['coupure en cours', 'ECONNRESET', false],
    ['pipe rompu', 'EPIPE', false],
    ['délai TCP', 'ETIMEDOUT', false],
  ];

  it.each(cases)('%s → certainlyNotSent = %s', async (_label, code, expected) => {
    const impl = async () => {
      throw Object.assign(new Error('boom'), { cause: { code } });
    };
    try {
      await transportWith(impl as unknown as typeof fetch).post(REQUEST);
      throw new Error('aurait dû lever');
    } catch (err) {
      expect(err).toBeInstanceOf(AdepTransportError);
      expect((err as AdepTransportError).certainlyNotSent).toBe(expected);
    }
  });

  it('un délai dépassé n’est JAMAIS « rien n’est parti »', async () => {
    // C'est le cas central : la requête est partie, la réponse s'est perdue.
    const impl = async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    };
    try {
      await transportWith(impl as unknown as typeof fetch).post(REQUEST);
      throw new Error('aurait dû lever');
    } catch (err) {
      expect((err as AdepTransportError).certainlyNotSent).toBe(false);
      expect((err as AdepTransportError).message).toContain('secondes');
    }
  });

  it('une cause inconnue tombe dans le DOUTE, pas dans la certitude', async () => {
    const impl = async () => {
      throw new Error('quelque chose d’inattendu');
    };
    try {
      await transportWith(impl as unknown as typeof fetch).post(REQUEST);
      throw new Error('aurait dû lever');
    } catch (err) {
      expect((err as AdepTransportError).certainlyNotSent).toBe(false);
    }
  });
});

describe('réponses HTTP', () => {
  it('rend le corps d’un 500 qui porte une enveloppe SOAP', async () => {
    // Une faute de service arrive en 500 et son corps porte le CODE d'erreur
    // qui explique le refus. La traiter comme une panne le perdrait.
    const fault =
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
      '<soap:Body><soap:Fault><faultstring>API_391_REF_NOT_FOUND_ERROR</faultstring>' +
      '</soap:Fault></soap:Body></soap:Envelope>';
    const impl = async () => new Response(fault, { status: 500 });
    const body = await transportWith(impl as unknown as typeof fetch).post(REQUEST);
    expect(body).toContain('API_391');
  });

  it('lève sur un 502 de passerelle, sans affirmer que rien n’est parti', async () => {
    const impl = async () => new Response('<html>Bad Gateway</html>', { status: 502 });
    try {
      await transportWith(impl as unknown as typeof fetch).post(REQUEST);
      throw new Error('aurait dû lever');
    } catch (err) {
      expect(err).toBeInstanceOf(AdepTransportError);
      // Le serveur a répondu : la requête est bien partie.
      expect((err as AdepTransportError).certainlyNotSent).toBe(false);
    }
  });

  it('reprend le corps d’un 503 au lieu de le jeter', async () => {
    // Mesuré le 09/09/2026 : `testadepsep.apec.fr` rend 62 octets, et ils
    // disent tout — un frontal sans backend derrière. On affichait pourtant
    // « sans message exploitable », en face d'un message exploitable.
    const impl = async () =>
      new Response('<html><body><b>Http/1.1 Service Unavailable</b></body> </html>', {
        status: 503,
      });
    try {
      await transportWith(impl as unknown as typeof fetch).post(REQUEST);
      throw new Error('aurait dû lever');
    } catch (err) {
      expect(err).toBeInstanceOf(AdepTransportError);
      const message = (err as AdepTransportError).message;
      expect(message).toContain('Service Unavailable');
      // Et il DIT ce que l'opérateur a besoin de savoir : rien à corriger
      // chez lui.
      expect(message).toMatch(/indisponible/);
      expect(message).not.toMatch(/sans message exploitable/);
      // La classification, elle, ne bouge pas : une passerelle rend aussi 503
      // sur un backend trop lent, qui a peut-être créé l'offre.
      expect((err as AdepTransportError).certainlyNotSent).toBe(false);
    }
  });

  it('garde « sans message exploitable » pour un corps réellement vide', async () => {
    const impl = async () => new Response('', { status: 418 });
    await expect(
      transportWith(impl as unknown as typeof fetch).post(REQUEST),
    ).rejects.toThrow(/418 sans message exploitable/);
  });

  it('lève sur un corps vide', async () => {
    const impl = async () => new Response('   ', { status: 200 });
    await expect(
      transportWith(impl as unknown as typeof fetch).post(REQUEST),
    ).rejects.toThrow(/vide/);
  });
});

describe('adepEndpointHost', () => {
  // `simulated: false` vaut autant pour la recette que pour la production :
  // le 09 et le 10/09/2026, deux offres acquittées sur DEUX environnements ont
  // laissé au journal des lignes identiques. Retrouver laquelle vivait où a
  // demandé de remonter aux dates de modification d'un fichier `.env`.
  it('rend l’hôte, qui suffit à savoir où l’offre est partie', () => {
    expect(adepEndpointHost('https://adepsep.apec.fr/v5/positions?wsdl')).toBe(
      'adepsep.apec.fr',
    );
    expect(adepEndpointHost('https://testadepsep.apec.fr/v5/positions?wsdl')).toBe(
      'testadepsep.apec.fr',
    );
  });

  it('rend null plutôt que d’inventer, sur une URL absente ou illisible', () => {
    expect(adepEndpointHost(undefined)).toBeNull();
    expect(adepEndpointHost('   ')).toBeNull();
    expect(adepEndpointHost('pas-une-url')).toBeNull();
  });
});
