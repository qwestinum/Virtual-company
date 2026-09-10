/**
 * Le client HTTP du panneau APEC.
 *
 * Un seul comportement compte ici, et c'est celui qui a fait passer deux
 * boutons pour morts : un refus de l'Apec arrive avec un corps JSON
 * parfaitement lisible et un statut 409. Se contenter de « le corps a été
 * parsé » avalait le refus, l'écran restait identique, et le bouton paraissait
 * ne rien faire.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadAdepState, publishToApec, transitionApec } from '../panel-client';

function respond(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('transitionApec', () => {
  it('LÈVE sur un refus de l’Apec, en reprenant son message', async () => {
    respond(409, {
      outcome: { kind: 'refused', issues: [] },
      message: 'Offre publiée il y a plus de 30 jours : republication impossible.',
      posting: null,
    });

    await expect(transitionApec('CAMP-2026-288', 'republish')).rejects.toThrow(
      /plus de 30 jours/,
    );
  });

  it('LÈVE quand l’Apec est injoignable (503), même avec un corps valide', async () => {
    respond(503, { outcome: { kind: 'unavailable', reason: 'Délai dépassé.' }, posting: null });

    await expect(transitionApec('CAMP-2026-288', 'suspend')).rejects.toThrow();
  });

  it('rend la réponse quand tout va bien', async () => {
    respond(200, {
      outcome: { kind: 'changed', status: null },
      posting: { id: 'JOBP-1' },
      simulated: true,
      changed: true,
    });

    const result = await transitionApec('CAMP-2026-288', 'suspend');
    expect(result.outcome?.kind).toBe('changed');
    expect(result.simulated).toBe(true);
  });
});

describe('loadAdepState', () => {
  // 09/09/2026 : activer le canal « APEC » ne déclenchait RIEN. Le manifeste de
  // routes du serveur de développement était périmé et ignorait
  // `/api/campaigns/[id]/adep` ; Next rendait 404 ; le client rendait `null` ;
  // le panneau se retirait sans un mot. Aucune trace, aucun message, rien à
  // corriger — le symptôme entier tenait dans « il ne se passe rien ».
  it('LÈVE sur un 404 au lieu de faire disparaître le panneau', async () => {
    respond(404, { error: 'not_found' });

    await expect(loadAdepState('CAMP-2026-288')).rejects.toThrow(/introuvable/);
  });

  it('LÈVE sur une panne serveur, en reprenant ce que la route en dit', async () => {
    respond(503, { error: 'supabase_not_configured' });

    await expect(loadAdepState('CAMP-2026-288')).rejects.toThrow(
      /supabase_not_configured/,
    );
  });

  it('rend l’état quand tout va bien', async () => {
    respond(200, { clientReference: 'CAMP-2026-288', blockers: [] });

    await expect(loadAdepState('CAMP-2026-288')).resolves.toMatchObject({
      clientReference: 'CAMP-2026-288',
    });
  });
});

describe('publishToApec', () => {
  const OFFER = {} as Parameters<typeof publishToApec>[1];

  // 10/09/2026, première publication réelle : l'écran n'a affiché que
  // « HTTP 500 ». La route avait pourtant nommé son motif — mais le client
  // lisait le corps DEUX fois (`res.json()` puis `readError(res)`), et
  // `Response.json()` consomme le flux. La seconde lecture levait « Body is
  // unusable », l'erreur était avalée, et il ne restait que le code HTTP.
  it('reprend le motif d’un 500 au lieu de rendre « HTTP 500 »', async () => {
    respond(500, { error: 'publish_failed' });

    await expect(publishToApec('CAMP-2026-267', OFFER)).rejects.toThrow(
      'publish_failed',
    );
  });

  it('préfère la phrase qui dit quoi faire au code d’erreur', async () => {
    respond(409, {
      error: 'numero_dossier_missing',
      message: "Le recruteur référent de la campagne n'a pas d'identifiant Apec.",
    });

    await expect(publishToApec('CAMP-2026-267', OFFER)).rejects.toThrow(
      /identifiant Apec/,
    );
  });

  it('énumère le rapport de validation, pas seulement « offer_invalid »', async () => {
    respond(422, {
      error: 'offer_invalid',
      errors: [{ message: 'Le lieu de poste est absent.' }, { message: 'Salaire manquant.' }],
    });

    await expect(publishToApec('CAMP-2026-267', OFFER)).rejects.toThrow(
      /lieu de poste est absent.*Salaire manquant/,
    );
  });

  it('rend l’outcome d’un refus de l’Apec, qui arrive en 422 et n’est pas une panne', async () => {
    respond(422, {
      outcome: { kind: 'rejected', issues: [{ code: '323', message: 'Aucun lieu de poste valide.' }] },
      posting: null,
      simulated: false,
    });

    await expect(publishToApec('CAMP-2026-267', OFFER)).resolves.toMatchObject({
      outcome: { kind: 'rejected' },
    });
  });
});
