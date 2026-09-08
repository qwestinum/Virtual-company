/**
 * Le transport HTTP réel vers ADEP.
 *
 * ── UNE SEULE TENTATIVE, JAMAIS DE RETRY ────────────────────────────────────
 *
 * `openPosition` n'est pas idempotent : un rejeu automatique créerait une
 * seconde offre que l'Apec ne sait pas fusionner. Le transport ne réessaie donc
 * RIEN, jamais, pour aucune opération — la reprise est la réconciliation par
 * référence, dans `AdepSepPublisher`, et elle est délibérée.
 *
 * C'est une différence assumée avec le provider LLM (`maxRetries: 4`) : là-bas
 * un rejeu ne coûte que des jetons ; ici il coûte une offre en double sur
 * apec.fr, visible du public, qu'ORQA ne saura jamais dépublier.
 *
 * ── LA CLASSIFICATION EST CONSERVATRICE ─────────────────────────────────────
 *
 * `certainlyNotSent` n'est vrai que si la requête n'a PAS pu quitter la
 * machine — DNS, connexion refusée. Un délai dépassé, une coupure en cours de
 * lecture, un 502 : « on ne sait pas ». Au moindre doute sur l'origine, on
 * classe dans le doute. Même règle que la classification d'erreur du poller
 * IMAP, pour la même raison : le coût d'une vérification inutile est une
 * requête ; le coût de l'erreur inverse est un doublon indélébile.
 */

import { AdepTransportError, type AdepTransport, type AdepTransportRequest } from './transport';

/** L'Apec traite une création en quelques secondes ; 30 s est confortable. */
export const ADEP_TIMEOUT_MS = 30_000;

export type HttpTransportOptions = {
  /** URL du service (sans `?wsdl`). */
  endpoint: string;
  timeoutMs?: number;
  /** Injecté par les tests — jamais en service. */
  fetchImpl?: typeof fetch;
};

/**
 * Les causes réseau qui prouvent que RIEN n'est parti. La liste est courte
 * exprès : tout ce qui n'y figure pas est un doute.
 */
const NOT_SENT_CAUSES = new Set([
  'ENOTFOUND', // DNS : le nom n'existe pas
  'EAI_AGAIN', // DNS : résolution temporairement impossible
  'ECONNREFUSED', // le port a refusé la connexion
]);

function causeCode(err: unknown): string | null {
  const cause = (err as { cause?: unknown })?.cause;
  const code = (cause as { code?: unknown })?.code ?? (err as { code?: unknown })?.code;
  return typeof code === 'string' ? code : null;
}

export function createHttpAdepTransport(options: HttpTransportOptions): AdepTransport {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? ADEP_TIMEOUT_MS;

  return {
    async post(request: AdepTransportRequest): Promise<string> {
      let response: Response;
      try {
        response = await doFetch(options.endpoint, {
          method: 'POST',
          headers: {
            // SOAP 1.1 : le type est `text/xml`, l'action est un en-tête.
            'Content-Type': 'text/xml; charset=utf-8',
            SOAPAction: request.soapAction,
          },
          body: request.envelope,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const code = causeCode(err);
        if (code && NOT_SENT_CAUSES.has(code)) {
          throw new AdepTransportError(
            `L'Apec est injoignable (${code}).`,
            true,
            { cause: err },
          );
        }
        // Délai dépassé, coupure, tout le reste : ON NE SAIT PAS.
        const isTimeout = err instanceof Error && err.name === 'TimeoutError';
        throw new AdepTransportError(
          isTimeout
            ? `Aucune réponse de l'Apec après ${Math.round(timeoutMs / 1000)} secondes.`
            : `La communication avec l'Apec a été interrompue.`,
          false,
          { cause: err },
        );
      }

      const body = await response.text().catch(() => '');

      // ⚠️ Un 500 SOAP porte une FAUTE exploitable dans son corps : la traiter
      // comme une panne perdrait le code d'erreur qui explique le refus. On ne
      // lève donc que sur un corps vide ou un statut sans contenu utile.
      if (!response.ok && !body.includes('Envelope')) {
        throw new AdepTransportError(
          `L'Apec a répondu ${response.status} sans message exploitable.`,
          // Le serveur a répondu : la requête est bien partie, et elle a
          // peut-être été traitée.
          false,
        );
      }
      if (!body.trim()) {
        throw new AdepTransportError("L'Apec a renvoyé une réponse vide.", false);
      }
      return body;
    },
  };
}

/**
 * Endpoint de service, dérivé de `ADEP_WSDL_URL`.
 *
 * On accepte l'URL avec ou sans `?wsdl` : c'est celle-là qu'un exploitant a
 * sous la main (elle est dans la documentation, et c'est celle qu'on ouvre
 * dans un navigateur pour vérifier). Lui demander de retirer le suffixe à la
 * main serait une source d'erreur gratuite.
 */
export function endpointFromWsdlUrl(wsdlUrl: string): string {
  return wsdlUrl.trim().replace(/\?wsdl$/i, '');
}
