import { describe, expect, it } from 'vitest';

import { computeInterviewFunnel } from '@/lib/reporting/interview-funnel';

const a = (id: string, status = 'accepted', dismissedAt: string | null = null) => ({
  id,
  uid: `u_${id}`,
  status,
  dismissedAt,
});

const SIGNALS = {
  interviewMarks: new Map([
    ['u_awa', 'realized'],
    ['u_jean', 'realized'],
    ['u_lea', 'realized'],
    ['u_hugo', 'missed'],
    ['u_zoe', 'realized'],
  ] as const),
  validationMarks: new Map([
    ['u_awa', 'validated'],
    ['u_jean', 'validated'],
    ['u_lea', 'rejected'],
  ] as const),
  hiredUids: new Set(['u_jean']),
};
const ANALYSES = [a('awa'), a('jean'), a('lea'), a('hugo'), a('zoe'), a('max', 'rejected'), a('noe')];

describe('entonnoir du CV au recrutement', () => {
  it('des trajectoires : un retenu est aussi un invité et un reçu en entretien', () => {
    const f = computeInterviewFunnel(ANALYSES, SIGNALS, []);
    expect(f).toMatchObject({ received: 7, invited: 6, interviewed: 4, retained: 2, hired: 1 });
  });

  it('taux de placement = recrutés / retenus, seulement si un recruté est désigné', () => {
    expect(computeInterviewFunnel(ANALYSES, SIGNALS, []).placementRate).toBe(50);
    expect(
      computeInterviewFunnel(ANALYSES, { ...SIGNALS, hiredUids: new Set() }, []).placementRate,
    ).toBeNull();
  });

  it('une désignation sur un dossier qui n’est plus retenu ne compte pas', () => {
    const f = computeInterviewFunnel(ANALYSES, { ...SIGNALS, hiredUids: new Set(['u_lea']) }, []);
    expect(f.hired).toBe(0);
  });

  it('informés N/M : reçus en entretien ET décidés ; un envoi raté ne compte pas', () => {
    const f = computeInterviewFunnel(
      [...ANALYSES.slice(0, 4), a('zoe', 'accepted', '2026-09-01')],
      SIGNALS,
      [
        { analysisId: 'awa', channel: 'mail', mailStatus: 'sent' },
        { analysisId: 'jean', channel: 'telephone', mailStatus: null },
        { analysisId: 'lea', channel: 'mail', mailStatus: 'send_failed' },
        // Absent : pas « reçu en entretien », hors du dénominateur.
        { analysisId: 'hugo', channel: 'mail', mailStatus: 'sent' },
      ],
    );
    // awa, jean, lea (verdicts) + zoe (sans suite après entretien) = 4 ; informés : awa, jean.
    expect(f.informed).toEqual({ total: 4, informed: 2 });
  });

  it('lecture des messages indisponible ⇒ l’indicateur se tait', () => {
    expect(computeInterviewFunnel(ANALYSES, SIGNALS, null).informed).toBeNull();
  });
});
