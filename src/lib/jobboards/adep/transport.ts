/**
 * Le transport SOAP, en tant que PORT injecté.
 *
 * ── POURQUOI LA COUTURE EST ICI ─────────────────────────────────────────────
 *
 * L'adaptateur `AdepSepPublisher` porte toute la logique qui peut se tromper :
 * construction du flux, lecture de l'acquittement, reconnaissance du « ça
 * existe déjà », enchaînement de reprise. Mettre la couture au niveau du
 * PUBLISHER (un faux publisher qui rend des objets tout faits) donnerait un
 * mock qui n'exerce rien : la recette d'écran passerait sans qu'une seule ligne
 * de cette logique ne tourne.
 *
 * En la plaçant au niveau du transport, le mock ne fabrique que ce qui vient
 * VRAIMENT du réseau — des réponses XML enregistrées — et tout le reste est le
 * code de production. C'est le même principe que le harnais de démonstration du
 * module de réservation : on simule le monde extérieur, jamais le nôtre.
 *
 * ── CLASSIFICATION DES PANNES : CONSERVATRICE ───────────────────────────────
 *
 * `certainlyNotSent` est le seul cas où l'on peut rejouer un `openPosition`
 * sans risque de doublon : la requête n'a PAS quitté la machine (DNS,
 * connexion refusée). Tout le reste — délai dépassé, coupure en cours de
 * lecture, 502 — est « on ne sait pas », parce qu'une requête peut très bien
 * avoir été traitée par l'Apec alors que la réponse s'est perdue.
 *
 * Au moindre doute sur l'origine, on classe en « on ne sait pas ». C'est la
 * même règle conservatrice que la classification d'erreur du poller IMAP, et
 * pour la même raison : le coût d'une réconciliation inutile est une requête de
 * lecture ; le coût d'une erreur inverse est une offre en double sur apec.fr,
 * qu'ORQA ne saura jamais dépublier.
 */

import type { AdepOperation } from './namespaces';

export type AdepTransportRequest = {
  operation: AdepOperation;
  soapAction: string;
  /** L'enveloppe SOAP complète, secrets INCLUS — elle part telle quelle. */
  envelope: string;
};

/** Le port. Une seule méthode : poster une enveloppe, rendre la réponse. */
export interface AdepTransport {
  post(request: AdepTransportRequest): Promise<string>;
}

export class AdepTransportError extends Error {
  constructor(
    message: string,
    /**
     * `true` UNIQUEMENT si la requête n'a pas pu quitter la machine. Un
     * transport qui n'en sait rien laisse `false` — c'est le défaut, et c'est
     * voulu.
     */
    public readonly certainlyNotSent: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AdepTransportError';
  }
}
