import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildTodayBoard } from '@/lib/today/board';
import { partitionRejectionProposals } from '@/lib/hitl/rejection-proposal';
import {
  BUSINESS_SIGNAL_SURFACES,
  type BusinessSignalKey,
} from '@/types/notifications';
import { BUSINESS_SIGNALS } from '@/lib/notifications/business-signals';
import type { PendingValidation } from '@/types/hitl';
import type { DecisionZone } from '@/types/hitl';

const NOW = Date.parse('2026-09-20T12:00:00.000Z');

function v(
  id: string,
  decision: 'accept' | 'reject',
  campaignId = 'CAMP-2026-221',
): PendingValidation {
  return {
    id,
    campaignId,
    candidateName: `Candidat ${id}`,
    candidateEmail: null,
    score: 70,
    decision,
    cvArtifactId: null,
    reportArtifactId: null,
    mailDraftArtifactId: null,
    confirmed: false,
    status: 'pending',
    payload: {},
    createdAt: new Date(NOW - 86_400_000).toISOString(),
    updatedAt: new Date(NOW - 86_400_000).toISOString(),
    decidedAt: null,
    decidedBy: null,
    decidedByUser: null,
  };
}

describe('les compteurs d’Aujourd’hui égalent ceux de la file d’arbitrage', () => {
  const validations = [
    v('a', 'accept'),
    v('b', 'reject'),
    v('c', 'reject'),
    v('d', 'accept'),
    v('e', 'reject'),
  ];
  const zones: Record<string, DecisionZone | null> = {
    a: 'gray',
    b: 'proposed_reject',
    c: 'proposed_reject',
    d: null,
    e: 'gray',
  };

  it('même partition, aux mêmes nombres', () => {
    // La file d'arbitrage partitionne EXACTEMENT comme ça (c'est la même
    // fonction). Si les deux écrans divergeaient, l'accueil annoncerait un
    // nombre que l'écran de travail ne montrerait pas — et il n'y a rien de
    // plus corrosif qu'un compteur qu'on n'arrive pas à retrouver.
    const hub = partitionRejectionProposals(validations, zones);
    const board = buildTodayBoard({
      validations,
      zoneByValidation: zones,
      coherenceByValidation: {},
      scheduled: [],
      verdict: [],
      signals: [],
      nowMs: NOW,
    });
    expect(board.validation.aLire.total).toBe(hub.toExamine.length);
    expect(board.validation.aEcarter.total).toBe(hub.proposals.length);
    expect(board.validation.aLire.total + board.validation.aEcarter.total).toBe(validations.length);
  });

  it('garde STRUCTURELLE : l’écran n’a pas sa propre règle de partition', () => {
    // Aucun test de valeurs ne peut attraper une SECONDE implémentation qui
    // rendrait, ce jour-là, les mêmes nombres. On lit donc le fichier.
    const src = readFileSync(
      resolve(process.cwd(), 'src/lib/today/board.ts'),
      'utf-8',
    );
    expect(src).toContain("from '@/lib/hitl/rejection-proposal'");
    expect(src).toContain('partitionRejectionProposals(');
    // Et il ne rejuge pas une zone à la main.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code).not.toContain("'proposed_reject'");
    expect(code).not.toContain("'gray'");
  });
});

describe('registre des signaux — aucune clé orpheline, dans aucun sens', () => {
  const declared = Object.keys(BUSINESS_SIGNAL_SURFACES) as BusinessSignalKey[];
  const computed = BUSINESS_SIGNALS.map((d) => d.key);

  it('toute clé déclarée est CALCULÉE par une définition', () => {
    // Sans ça, un signal peut porter une surface et n'être jamais produit :
    // il n'alerterait de rien, en silence.
    expect([...declared].sort()).toEqual([...computed].sort());
  });

  it('toute clé calculée a une SURFACE, donc une place à l’écran', () => {
    // Le défaut symétrique : un signal calculé que personne n'affiche.
    for (const key of computed) {
      expect(BUSINESS_SIGNAL_SURFACES[key]).toMatch(/^(dossier|verification)$/);
    }
  });

  it('aucune définition en double', () => {
    expect(new Set(computed).size).toBe(computed.length);
  });
});
