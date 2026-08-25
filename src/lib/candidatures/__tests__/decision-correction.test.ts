/**
 * Le cœur de la correction : ce qu'elle écrit, et surtout ce qu'elle
 * n'envoie JAMAIS.
 *
 * L'invariant n°1 est négatif — « aucun mail, quel que soit le nouvel état ».
 * On le tient de deux façons : au RUNTIME (transport mocké, zéro appel sur
 * toutes les cibles) et STRUCTURELLEMENT (le module n'importe aucun émetteur).
 * La seconde survit à un refactor que la première laisserait passer si
 * quelqu'un déplaçait l'envoi derrière une couche.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DecisionCorrectionContext } from '@/types/decision-correction';
import type { CandidateAnalysisSummary } from '@/types/reporting';

type JournalCall = { action: string; payload: Record<string, unknown> };
const appendJournalEntry = vi.fn(async (_entry: JournalCall) => undefined);
const updateCandidateAnalysisDecision = vi.fn(
  async (_args: { uid: string; status: string }) => undefined,
);
const reopenCandidature = vi.fn(async () => 'reopened' as const);
const revokeCampaignBookingLink = vi.fn(async () => undefined);
const sendEmail = vi.fn(async () => ({ ok: true }));
const stageFor = vi.fn(() => 'invite' as const);

vi.mock('@/lib/db/repos/journal', () => ({
  appendJournalEntry: (entry: JournalCall) => appendJournalEntry(entry),
  listJournalEntriesByActions: vi.fn(async () => []),
}));
vi.mock('@/lib/db/repos/candidate-analyses', () => ({
  getCandidateAnalysis: vi.fn(async () => null),
  updateCandidateAnalysisDecision: (args: { uid: string; status: string }) =>
    updateCandidateAnalysisDecision(args),
}));
vi.mock('@/lib/candidatures/dismissal', () => ({
  reopenCandidature: () => reopenCandidature(),
}));
vi.mock('@/lib/scheduling-host/campaign-booking', () => ({
  revokeCampaignBookingLink: () => revokeCampaignBookingLink(),
  bookingLinkStateForAnalysis: vi.fn(async () => null),
}));
vi.mock('@/lib/reporting/stage-signals', () => ({
  loadStageSignals: vi.fn(async () => ({
    pendingUids: new Set(),
    scheduledUids: new Set(),
    interviewMarks: new Map(),
    interviewMarkedAt: new Map(),
    validationMarks: new Map(),
  })),
  stageFor: () => stageFor(),
}));
// Transport : présent, mocké, et JAMAIS appelé.
vi.mock('@/lib/email/client', () => ({ sendEmail: () => sendEmail() }));

const analysis = {
  id: 'can_imap_box_102',
  uid: 'uid-malaka',
  campaignId: 'CAMP-2026-288',
  candidateName: 'Malaka Diarra',
  candidateEmail: 'malaka@example.com',
  dismissalReason: null,
  dismissedAt: null,
} as unknown as CandidateAnalysisSummary;

function contextWith(
  over: Partial<DecisionCorrectionContext>,
): DecisionCorrectionContext {
  return {
    analysisId: analysis.id,
    uid: analysis.uid,
    candidateName: analysis.candidateName,
    campaignId: analysis.campaignId,
    stage: 'entretien_fait',
    stageLabel: 'Entretien fait',
    current: { kind: 'interview', value: 'realized' },
    decidedAt: '2026-08-21T14:32:00.000Z',
    decidedBy: null,
    sideEffects: [],
    options: [
      { target: 'interview_missed', label: '', detail: '' },
      { target: 'interview_cleared', label: '', detail: '' },
    ],
    notices: [],
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('aucun envoi, jamais', () => {
  it('le module n’importe AUCUN émetteur (garde structurelle)', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/lib/candidatures/decision-correction.ts'),
      'utf8',
    );
    const imports = source
      .split('\n')
      .filter((l) => l.trimStart().startsWith('import') || l.includes("from '@/"));
    const forbidden = [
      '@/lib/email/client',
      '@/lib/hitl/send-validation',
      'emitCampaignBookingLink',
      'sendEmail',
    ];
    for (const needle of forbidden) {
      expect(imports.join('\n')).not.toContain(needle);
    }
  });

  it('zéro appel au transport sur TOUTES les cibles, y compris celles qui enverraient normalement', async () => {
    const { applyDecisionCorrection } = await import(
      '@/lib/candidatures/decision-correction'
    );
    const cases = [
      {
        target: 'interview_missed' as const,
        context: contextWith({}),
      },
      {
        // Requalifier en accepté = « invité » : le chemin normal enverrait
        // une invitation. Ici, rien ne part.
        target: 'screening_accepted' as const,
        context: contextWith({
          stage: 'non_retenu',
          current: { kind: 'screening_decision', value: 'rejected', auto: false },
          options: [{ target: 'screening_accepted', label: '', detail: '' }],
        }),
      },
      {
        // Requalifier en non retenu : le chemin normal enverrait un refus.
        target: 'screening_rejected' as const,
        context: contextWith({
          stage: 'invite',
          current: { kind: 'screening_decision', value: 'accepted', auto: false },
          options: [{ target: 'screening_rejected', label: '', detail: '' }],
        }),
      },
      {
        target: 'dismissal_reopen' as const,
        context: contextWith({
          stage: 'sans_suite',
          current: { kind: 'dismissal', reason: null },
          options: [{ target: 'dismissal_reopen', label: '', detail: '' }],
        }),
      },
    ];
    for (const c of cases) {
      const out = await applyDecisionCorrection({
        analysis,
        context: c.context,
        target: c.target,
        reason: null,
        actor: { userId: 'u-sarah', email: 'sarah@qwestinum.fr' },
      });
      expect(out.status).toBe('corrected');
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('writers canoniques, aucun chemin parallèle', () => {
  it('un marqueur passe par le journal, jamais par les colonnes', async () => {
    const { applyDecisionCorrection } = await import(
      '@/lib/candidatures/decision-correction'
    );
    await applyDecisionCorrection({
      analysis,
      context: contextWith({}),
      target: 'interview_cleared',
      reason: 'mauvaise ligne',
      actor: { userId: 'u-sarah', email: 'sarah@qwestinum.fr' },
    });
    expect(updateCandidateAnalysisDecision).not.toHaveBeenCalled();
    const marker = appendJournalEntry.mock.calls[0][0];
    expect(marker.action).toBe('candidate_interview_marked');
    expect(marker.payload.status).toBe('cleared');
  });

  it('une décision de screening passe par le writer canonique', async () => {
    const { applyDecisionCorrection } = await import(
      '@/lib/candidatures/decision-correction'
    );
    await applyDecisionCorrection({
      analysis,
      context: contextWith({
        stage: 'non_retenu',
        current: { kind: 'screening_decision', value: 'rejected', auto: false },
        options: [{ target: 'screening_accepted', label: '', detail: '' }],
      }),
      target: 'screening_accepted',
      reason: null,
      actor: { userId: 'u-sarah', email: 'sarah@qwestinum.fr' },
    });
    expect(updateCandidateAnalysisDecision).toHaveBeenCalledWith(
      expect.objectContaining({ uid: analysis.uid, status: 'accepted' }),
    );
  });
});

describe('journal decision_corrected', () => {
  it('porte ancien/nouvel état, motif et auteur', async () => {
    const { applyDecisionCorrection } = await import(
      '@/lib/candidatures/decision-correction'
    );
    stageFor.mockReturnValue('invite');
    await applyDecisionCorrection({
      analysis,
      context: contextWith({}),
      target: 'interview_cleared',
      reason: 'erreur de manipulation',
      actor: { userId: 'u-sarah', email: 'sarah@qwestinum.fr' },
    });
    const correction = appendJournalEntry.mock.calls
      .map((c) => c[0])
      .find((e) => e.action === 'decision_corrected');
    expect(correction).toBeDefined();
    expect(correction!.payload).toMatchObject({
      uid: analysis.uid,
      analysisId: analysis.id,
      previousStage: 'entretien_fait',
      nextStage: 'invite',
      previousLabel: 'Entretien réalisé',
      nextLabel: 'Marquage d’entretien retiré',
      reason: 'erreur de manipulation',
      by: 'sarah@qwestinum.fr',
    });
  });
});

describe('lien de réservation', () => {
  it('révoqué UNIQUEMENT quand la correction écarte, et seulement s’il était actif', async () => {
    const { applyDecisionCorrection } = await import(
      '@/lib/candidatures/decision-correction'
    );
    // Écarte + lien actif annoncé au dialog ⇒ révocation.
    await applyDecisionCorrection({
      analysis,
      context: contextWith({
        stage: 'invite',
        current: { kind: 'screening_decision', value: 'accepted', auto: false },
        options: [{ target: 'screening_rejected', label: '', detail: '' }],
        sideEffects: [{ code: 'link_active', text: '', emphasis: 'warning' }],
      }),
      target: 'screening_rejected',
      reason: null,
      actor: null,
    });
    expect(revokeCampaignBookingLink).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    // Correction POSITIVE : on ne touche à aucun lien.
    await applyDecisionCorrection({
      analysis,
      context: contextWith({
        stage: 'non_retenu',
        current: { kind: 'screening_decision', value: 'rejected', auto: false },
        options: [{ target: 'screening_accepted', label: '', detail: '' }],
        sideEffects: [{ code: 'link_active', text: '', emphasis: 'warning' }],
      }),
      target: 'screening_accepted',
      reason: null,
      actor: null,
    });
    expect(revokeCampaignBookingLink).not.toHaveBeenCalled();
  });
});

describe('garde de cible', () => {
  it('refuse une cible absente des options relues côté serveur', async () => {
    const { applyDecisionCorrection } = await import(
      '@/lib/candidatures/decision-correction'
    );
    const out = await applyDecisionCorrection({
      analysis,
      context: contextWith({}),
      target: 'verdict_validated',
      reason: null,
      actor: null,
    });
    expect(out.status).toBe('invalid_target');
    expect(appendJournalEntry).not.toHaveBeenCalled();
  });

  it('refuse un dossier sans décision courante', async () => {
    const { applyDecisionCorrection } = await import(
      '@/lib/candidatures/decision-correction'
    );
    const out = await applyDecisionCorrection({
      analysis,
      context: contextWith({ current: null, options: [] }),
      target: 'interview_cleared',
      reason: null,
      actor: null,
    });
    expect(out.status).toBe('not_correctable');
    expect(appendJournalEntry).not.toHaveBeenCalled();
  });
});
