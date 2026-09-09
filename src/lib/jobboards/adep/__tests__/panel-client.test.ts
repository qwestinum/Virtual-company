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

import { loadAdepState, transitionApec } from '../panel-client';

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
